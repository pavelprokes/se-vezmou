-- M7b / 1: správa hostů a nastavení RSVP správcem (domácnosti, hosté, pozvání, import, hromadné
-- pozvání, nastavení a vlastní otázky). Zdroj: docs/data-model.md kap. 3.4, 3.5, FR-ADM-4, FR-ADM-5.
--
-- Všechny funkce jsou `security definer` s prázdným `search_path`, mají právo spuštění jen role
-- `authenticated`, vyžadují claimy správce (`is_wedding_admin()`) a pracují jen se svatbou z claimu:
-- žádný argument nenese identifikátor svatby. Audit nese jen počty a identifikátory, nikdy jména hostů.

-- ---------------------------------------------------------------------------
-- Interní zápis jedné domácnosti s hosty a pozváními (volají jen funkce níže, nikdo jiný)
-- ---------------------------------------------------------------------------
create function se_vezmou.household_write(
  p_wedding_id uuid,
  p_household_id uuid,
  p_payload jsonb,
  p_source text,
  p_default_events jsonb default null
) returns uuid
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  c_max_guests constant integer := 20;
  c_max_total constant integer := 1500;
  v_label text;
  v_note text;
  v_household uuid := p_household_id;
  v_guests jsonb;
  v_guest jsonb;
  v_guest_id uuid;
  v_kept uuid[] := '{}';
  v_name text;
  v_child boolean;
  v_age_text text;
  v_age smallint;
  v_events jsonb;
  v_event_text text;
  v_event_id uuid;
  v_event_ids uuid[];
begin
  if p_source not in ('manual', 'import') then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or pg_catalog.length(p_payload::text) > 100000 then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  v_label := pg_catalog.btrim(coalesce(p_payload ->> 'label', ''));
  v_note := nullif(pg_catalog.btrim(coalesce(p_payload ->> 'note', '')), '');
  if pg_catalog.char_length(v_label) > 200 or pg_catalog.char_length(coalesce(v_note, '')) > 500 then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  v_guests := p_payload -> 'guests';
  if jsonb_typeof(v_guests) is distinct from 'array'
     or jsonb_array_length(v_guests) not between 1 and c_max_guests then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;

  if v_household is null then
    insert into se_vezmou.households (wedding_id, label, invited_note)
    values (p_wedding_id, v_label, v_note)
    returning id into v_household;
  else
    update se_vezmou.households h
       set label = v_label, invited_note = v_note
     where h.id = v_household and h.wedding_id = p_wedding_id;
    if not found then
      raise exception 'household_not_found' using errcode = 'P0002';
    end if;
  end if;

  for v_guest in select value from jsonb_array_elements(v_guests) loop
    if jsonb_typeof(v_guest) <> 'object' then
      raise exception 'invalid_payload' using errcode = '22023';
    end if;
    v_name := pg_catalog.btrim(coalesce(v_guest ->> 'display_name', ''));
    if pg_catalog.char_length(v_name) not between 1 and 200 then
      raise exception 'invalid_payload' using errcode = '22023';
    end if;
    v_child := coalesce(v_guest -> 'is_child' = 'true'::jsonb, false);
    v_age := null;
    v_age_text := v_guest ->> 'age';
    if v_child and v_age_text is not null then
      if v_age_text !~ '^[0-9]{1,2}$' or v_age_text::integer > 17 then
        raise exception 'invalid_payload' using errcode = '22023';
      end if;
      v_age := v_age_text::smallint;
    end if;

    v_guest_id := se_vezmou.try_uuid(v_guest ->> 'id');
    if nullif(v_guest ->> 'id', '') is not null and v_guest_id is null then
      raise exception 'invalid_payload' using errcode = '22023';
    end if;
    if v_guest_id is not null then
      update se_vezmou.guests g
         set display_name = v_name, is_child = v_child, age = v_age
       where g.id = v_guest_id and g.wedding_id = p_wedding_id and g.household_id = v_household;
      if not found then
        raise exception 'invalid_guest' using errcode = '42501';
      end if;
    else
      insert into se_vezmou.guests (wedding_id, household_id, display_name, is_child, age, source)
      values (p_wedding_id, v_household, v_name, v_child, v_age, p_source)
      returning id into v_guest_id;
    end if;
    v_kept := v_kept || v_guest_id;

    -- pozvání na události: pole v hostovi, jinak výchozí pole importu
    v_events := coalesce(v_guest -> 'invited_event_ids', p_default_events, '[]'::jsonb);
    if jsonb_typeof(v_events) <> 'array' then
      raise exception 'invalid_payload' using errcode = '22023';
    end if;
    v_event_ids := '{}';
    for v_event_text in select value #>> '{}' from jsonb_array_elements(v_events) loop
      v_event_id := se_vezmou.try_uuid(v_event_text);
      if v_event_id is null or not exists (
           select 1 from se_vezmou.events e where e.id = v_event_id and e.wedding_id = p_wedding_id) then
        raise exception 'invalid_event' using errcode = '22023';
      end if;
      v_event_ids := v_event_ids || v_event_id;
    end loop;
    delete from se_vezmou.invitations i
     where i.guest_id = v_guest_id and i.wedding_id = p_wedding_id
       and not (i.event_id = any (v_event_ids));
    insert into se_vezmou.invitations (wedding_id, guest_id, event_id)
    select p_wedding_id, v_guest_id, x from pg_catalog.unnest(v_event_ids) as x
    on conflict (guest_id, event_id) do nothing;
  end loop;

  -- hosté, kteří v zápisu nejsou, se z domácnosti odeberou (včetně jejich odpovědí)
  delete from se_vezmou.guests g
   where g.household_id = v_household and g.wedding_id = p_wedding_id
     and not (g.id = any (v_kept));

  if (select count(*) from se_vezmou.guests g where g.wedding_id = p_wedding_id) > c_max_total then
    raise exception 'guest_limit_exceeded' using errcode = '22023';
  end if;
  return v_household;
end
$$;

revoke all on function se_vezmou.household_write(uuid, uuid, jsonb, text, jsonb)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- admin_household_save: nová domácnost (p_household_id null) nebo úprava existující
-- payload: {label, note, guests: [{id?, display_name, is_child, age, invited_event_ids: [uuid]}]}
-- ---------------------------------------------------------------------------
create function se_vezmou.admin_household_save(p_household_id uuid, p_payload jsonb) returns uuid
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
  v_id uuid;
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- souběžná uložení téže svatby se řadí za sebou (strop počtu hostů)
  perform 1 from se_vezmou.weddings w where w.id = v_wedding_id for update;
  v_id := se_vezmou.household_write(v_wedding_id, p_household_id, p_payload, 'manual');
  perform se_vezmou.write_audit('admin', se_vezmou.actor_id(), v_wedding_id, 'guests.household_save',
    'household', v_id, null,
    jsonb_build_object('guests', jsonb_array_length(p_payload -> 'guests'),
                       'created', p_household_id is null));
  return v_id;
end
$$;

-- ---------------------------------------------------------------------------
-- admin_household_delete: smaže domácnost, její hosty, pozvání a odpověď
-- ---------------------------------------------------------------------------
create function se_vezmou.admin_household_delete(p_household_id uuid) returns void
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
  v_guests integer;
  v_answered boolean;
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform 1 from se_vezmou.households h where h.id = p_household_id and h.wedding_id = v_wedding_id
    for update;
  if not found then
    raise exception 'household_not_found' using errcode = 'P0002';
  end if;
  select count(*) into v_guests from se_vezmou.guests g
   where g.household_id = p_household_id and g.wedding_id = v_wedding_id;
  v_answered := exists (select 1 from se_vezmou.rsvp_responses r
                         where r.household_id = p_household_id and r.wedding_id = v_wedding_id);
  delete from se_vezmou.households h where h.id = p_household_id and h.wedding_id = v_wedding_id;
  perform se_vezmou.write_audit('admin', se_vezmou.actor_id(), v_wedding_id, 'guests.household_delete',
    'household', p_household_id, null,
    jsonb_build_object('guests', v_guests, 'answered', v_answered));
end
$$;

-- ---------------------------------------------------------------------------
-- admin_guests_import: hromadný zápis ověřených řádků (jen přidává, nic nepřepisuje)
-- payload: {households: [{label, guests: [{display_name, is_child, age}]}], invited_event_ids: [uuid]}
-- ---------------------------------------------------------------------------
create function se_vezmou.admin_guests_import(p_payload jsonb) returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  c_max_households constant integer := 1000;
  c_max_guests constant integer := 1500;
  v_wedding_id uuid := se_vezmou.wedding_id();
  v_household jsonb;
  v_households integer := 0;
  v_guests integer := 0;
  v_defaults jsonb;
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or jsonb_typeof(p_payload -> 'households') is distinct from 'array'
     or jsonb_array_length(p_payload -> 'households') not between 1 and c_max_households
     or pg_catalog.length(p_payload::text) > 2000000 then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  v_defaults := coalesce(p_payload -> 'invited_event_ids', '[]'::jsonb);
  if jsonb_typeof(v_defaults) <> 'array' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;

  perform 1 from se_vezmou.weddings w where w.id = v_wedding_id for update;

  for v_household in select value from jsonb_array_elements(p_payload -> 'households') loop
    if jsonb_typeof(v_household) <> 'object' then
      raise exception 'invalid_payload' using errcode = '22023';
    end if;
    perform se_vezmou.household_write(v_wedding_id, null, v_household, 'import', v_defaults);
    v_households := v_households + 1;
    v_guests := v_guests + jsonb_array_length(v_household -> 'guests');
    if v_guests > c_max_guests then
      raise exception 'guest_limit_exceeded' using errcode = '22023';
    end if;
  end loop;

  perform se_vezmou.write_audit('admin', se_vezmou.actor_id(), v_wedding_id, 'guests.import',
    'wedding', v_wedding_id, null,
    jsonb_build_object('households', v_households, 'guests', v_guests));
  return jsonb_build_object('households', v_households, 'guests', v_guests);
end
$$;

-- ---------------------------------------------------------------------------
-- admin_invitations_bulk: pozvat všechny hosty na událost, nebo pozvání na ni všem zrušit
-- (nová událost bez pozvání by jinak nikomu nedovolila odpovědět)
-- ---------------------------------------------------------------------------
create function se_vezmou.admin_invitations_bulk(p_event_id uuid, p_invited boolean) returns integer
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
  v_count integer;
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_invited is null or not exists (
       select 1 from se_vezmou.events e where e.id = p_event_id and e.wedding_id = v_wedding_id) then
    raise exception 'invalid_event' using errcode = '22023';
  end if;
  if p_invited then
    insert into se_vezmou.invitations (wedding_id, guest_id, event_id)
    select g.wedding_id, g.id, p_event_id from se_vezmou.guests g where g.wedding_id = v_wedding_id
    on conflict (guest_id, event_id) do nothing;
  else
    delete from se_vezmou.invitations i where i.event_id = p_event_id and i.wedding_id = v_wedding_id;
  end if;
  get diagnostics v_count = row_count;
  perform se_vezmou.write_audit('admin', se_vezmou.actor_id(), v_wedding_id, 'guests.invite_bulk',
    'event', p_event_id, null, jsonb_build_object('invited', p_invited, 'rows', v_count));
  return v_count;
end
$$;

-- ---------------------------------------------------------------------------
-- admin_rsvp_settings_get / admin_rsvp_settings_save: otevření a uzavření, otázky, host mimo seznam
-- ---------------------------------------------------------------------------
create function se_vezmou.admin_rsvp_settings_get() returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'timezone', (select w.timezone from se_vezmou.weddings w where w.id = v_wedding_id),
    'locales', (select to_jsonb(w.locales) from se_vezmou.weddings w where w.id = v_wedding_id),
    'default_locale', (select w.default_locale from se_vezmou.weddings w where w.id = v_wedding_id),
    'settings', coalesce((
      select jsonb_build_object('opens_at', s.opens_at, 'closes_at', s.closes_at,
        'allow_unlisted', s.allow_unlisted, 'email_confirmation', s.email_confirmation,
        'enabled_questions', s.enabled_questions)
        from se_vezmou.rsvp_settings s where s.wedding_id = v_wedding_id),
      jsonb_build_object('opens_at', null, 'closes_at', null, 'allow_unlisted', false,
        'email_confirmation', false, 'enabled_questions', '{}'::jsonb)),
    'questions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', q.id, 'key', q.key, 'type', q.type, 'label', q.label, 'options', q.options,
        'required', q.required, 'event_id', q.event_id, 'enabled', q.enabled)
        order by q.position, q.key), '[]'::jsonb)
        from se_vezmou.rsvp_questions q where q.wedding_id = v_wedding_id),
    'events', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'kind', e.kind, 'title', e.title, 'starts_at', e.starts_at,
        'rsvp_enabled', e.rsvp_enabled) order by e.position, e.starts_at), '[]'::jsonb)
        from se_vezmou.events e where e.wedding_id = v_wedding_id)
  );
end
$$;

-- payload: {opens_at, closes_at, allow_unlisted, email_confirmation,
--           enabled_questions: {plus_one, children, diet, lodging, transport, song},
--           questions: [{id?, key?, type, label, options?, required, event_id?, enabled}]}
create function se_vezmou.admin_rsvp_settings_save(p_payload jsonb) returns void
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  c_max_questions constant integer := 10;
  c_flags constant text[] := array['plus_one', 'children', 'diet', 'lodging', 'transport', 'song'];
  c_reserved constant text[] := array['plus_one', 'children', 'diet', 'allergies', 'lodging',
    'transport', 'song', 'contact_email', 'answers', 'people'];
  v_wedding_id uuid := se_vezmou.wedding_id();
  v_opens timestamptz;
  v_closes timestamptz;
  v_flags jsonb := '{}'::jsonb;
  v_flag text;
  v_questions jsonb;
  v_q jsonb;
  v_position integer := 0;
  v_id uuid;
  v_key text;
  v_type text;
  v_options jsonb;
  v_event uuid;
  v_kept uuid[] := '{}';
  v_option jsonb;
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or pg_catalog.length(p_payload::text) > 100000 then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;

  begin
    v_opens := nullif(p_payload ->> 'opens_at', '')::timestamptz;
    v_closes := nullif(p_payload ->> 'closes_at', '')::timestamptz;
  exception when others then
    raise exception 'invalid_payload' using errcode = '22023';
  end;
  if v_opens is not null and v_closes is not null and v_closes <= v_opens then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload -> 'allow_unlisted') is distinct from 'boolean'
     or jsonb_typeof(p_payload -> 'email_confirmation') is distinct from 'boolean'
     or jsonb_typeof(p_payload -> 'enabled_questions') is distinct from 'object' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  foreach v_flag in array c_flags loop
    if jsonb_typeof(p_payload -> 'enabled_questions' -> v_flag) = 'boolean' then
      v_flags := v_flags || jsonb_build_object(v_flag, p_payload -> 'enabled_questions' -> v_flag);
    end if;
  end loop;

  v_questions := coalesce(p_payload -> 'questions', '[]'::jsonb);
  if jsonb_typeof(v_questions) <> 'array' or jsonb_array_length(v_questions) > c_max_questions then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;

  insert into se_vezmou.rsvp_settings (wedding_id, opens_at, closes_at, allow_unlisted,
                                       email_confirmation, enabled_questions)
  values (v_wedding_id, v_opens, v_closes, (p_payload ->> 'allow_unlisted')::boolean,
          (p_payload ->> 'email_confirmation')::boolean, v_flags)
  on conflict (wedding_id) do update
    set opens_at = excluded.opens_at, closes_at = excluded.closes_at,
        allow_unlisted = excluded.allow_unlisted,
        email_confirmation = excluded.email_confirmation,
        enabled_questions = excluded.enabled_questions;

  for v_q in select value from jsonb_array_elements(v_questions) loop
    if jsonb_typeof(v_q) <> 'object' then
      raise exception 'invalid_payload' using errcode = '22023';
    end if;
    v_type := v_q ->> 'type';
    if v_type not in ('text', 'choice', 'bool')
       or jsonb_typeof(v_q -> 'label') is distinct from 'object'
       or jsonb_typeof(v_q -> 'required') is distinct from 'boolean'
       or jsonb_typeof(v_q -> 'enabled') is distinct from 'boolean' then
      raise exception 'invalid_payload' using errcode = '22023';
    end if;
    v_options := null;
    if v_type = 'choice' then
      v_options := v_q -> 'options';
      if jsonb_typeof(v_options) is distinct from 'array' or jsonb_array_length(v_options) not between 2 and 10 then
        raise exception 'invalid_payload' using errcode = '22023';
      end if;
      for v_option in select value from jsonb_array_elements(v_options) loop
        if jsonb_typeof(v_option) <> 'object' or coalesce(v_option ->> 'value', '') !~ '^[a-z0-9_]{1,40}$'
           or jsonb_typeof(v_option -> 'label') is distinct from 'object' then
          raise exception 'invalid_payload' using errcode = '22023';
        end if;
      end loop;
    end if;
    v_event := null;
    if nullif(v_q ->> 'event_id', '') is not null then
      v_event := se_vezmou.try_uuid(v_q ->> 'event_id');
      if v_event is null or not exists (
           select 1 from se_vezmou.events e where e.id = v_event and e.wedding_id = v_wedding_id) then
        raise exception 'invalid_event' using errcode = '22023';
      end if;
    end if;

    v_id := se_vezmou.try_uuid(v_q ->> 'id');
    if nullif(v_q ->> 'id', '') is not null and v_id is null then
      raise exception 'invalid_payload' using errcode = '22023';
    end if;
    v_position := v_position + 1;
    if v_id is not null then
      update se_vezmou.rsvp_questions q
         set type = v_type, label = (v_q -> 'label')::se_vezmou.i18n_text, options = v_options,
             required = (v_q ->> 'required')::boolean, event_id = v_event,
             position = v_position, enabled = (v_q ->> 'enabled')::boolean
       where q.id = v_id and q.wedding_id = v_wedding_id;
      if not found then
        raise exception 'invalid_question' using errcode = '22023';
      end if;
    else
      v_key := v_q ->> 'key';
      if v_key is null or v_key !~ '^[a-z][a-z0-9_]{0,62}$' or v_key = any (c_reserved) then
        raise exception 'invalid_question' using errcode = '22023';
      end if;
      insert into se_vezmou.rsvp_questions (wedding_id, key, type, label, options, required,
                                            event_id, position, enabled)
      values (v_wedding_id, v_key, v_type, (v_q -> 'label')::se_vezmou.i18n_text, v_options,
              (v_q ->> 'required')::boolean, v_event, v_position, (v_q ->> 'enabled')::boolean)
      returning id into v_id;
    end if;
    v_kept := v_kept || v_id;
  end loop;

  delete from se_vezmou.rsvp_questions q
   where q.wedding_id = v_wedding_id and not (q.id = any (v_kept));

  perform se_vezmou.write_audit('admin', se_vezmou.actor_id(), v_wedding_id, 'rsvp.settings_save',
    'wedding', v_wedding_id, null,
    jsonb_build_object('questions', v_position, 'allow_unlisted', (p_payload ->> 'allow_unlisted')::boolean));
end
$$;

revoke all on function
  se_vezmou.admin_household_save(uuid, jsonb),
  se_vezmou.admin_household_delete(uuid),
  se_vezmou.admin_guests_import(jsonb),
  se_vezmou.admin_invitations_bulk(uuid, boolean),
  se_vezmou.admin_rsvp_settings_get(),
  se_vezmou.admin_rsvp_settings_save(jsonb)
  from public, anon, service_role;
grant execute on function
  se_vezmou.admin_household_save(uuid, jsonb),
  se_vezmou.admin_household_delete(uuid),
  se_vezmou.admin_guests_import(jsonb),
  se_vezmou.admin_invitations_bulk(uuid, boolean),
  se_vezmou.admin_rsvp_settings_get(),
  se_vezmou.admin_rsvp_settings_save(jsonb)
  to authenticated;
