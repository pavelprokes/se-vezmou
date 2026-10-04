-- Skupiny hostů: štítky domácnosti (např. „Rodina nevěsty“, „Kolegové“), jen pro správce. Slouží k filtru
-- seznamu s počty, k hromadnému pozvání skupiny na událost (= program podle skupiny přes pozvání) a v exportu.
-- Zpětně kompatibilní: nový sloupec s výchozí hodnotou, funkce jen vracejí pole navíc a stará
-- admin_invitations_bulk zůstává.

alter table se_vezmou.households
  add column tags text[] not null default '{}'
    check (pg_catalog.cardinality(tags) <= 10);

-- ---------------------------------------------------------------------------
-- tags_from_payload: pole štítků z JSON (ořez, sloučení mezer, bez prázdných a přesných duplicit, pořadí
-- zachované). Čárka v názvu je zakázaná (editor podle ní skupiny odděluje). Velikost písmen se tu nesjednocuje
-- (lower() závisí na nastavení databáze); jednotný zápis skupiny drží editor, který nabízí už používané.
-- Neplatný vstup = invalid_payload. Volají jen funkce níže.
-- ---------------------------------------------------------------------------
create function se_vezmou.tags_from_payload(p_tags jsonb) returns text[]
  language plpgsql immutable security definer set search_path = ''
  as $$
declare
  c_max_tags constant integer := 10;
  c_max_length constant integer := 40;
  v_item jsonb;
  v_tag text;
  v_result text[] := '{}';
begin
  if p_tags is null or jsonb_typeof(p_tags) <> 'array' or jsonb_array_length(p_tags) > 50 then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_tags) loop
    if jsonb_typeof(v_item) <> 'string' then
      raise exception 'invalid_payload' using errcode = '22023';
    end if;
    v_tag := pg_catalog.btrim(pg_catalog.regexp_replace(v_item #>> '{}', '\s+', ' ', 'g'));
    if v_tag = '' then
      continue;
    end if;
    if pg_catalog.char_length(v_tag) > c_max_length or pg_catalog.strpos(v_tag, ',') > 0 then
      raise exception 'invalid_payload' using errcode = '22023';
    end if;
    if not (v_tag = any (v_result)) then
      v_result := v_result || v_tag;
    end if;
  end loop;
  if pg_catalog.cardinality(v_result) > c_max_tags then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  return v_result;
end
$$;

revoke all on function se_vezmou.tags_from_payload(jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- admin_household_save: jako dřív, navíc štítky (`tags`), pokud je zápis obsahuje
-- payload: {label, note, tags?, guests: [{id?, display_name, is_child, age, invited_event_ids: [uuid]}]}
-- ---------------------------------------------------------------------------
create or replace function se_vezmou.admin_household_save(p_household_id uuid, p_payload jsonb) returns uuid
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
  v_id uuid;
  v_tags text[];
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- štítky se ověří dřív, než se cokoli zapíše
  if p_payload is not null and jsonb_typeof(p_payload) = 'object' and p_payload ? 'tags' then
    v_tags := se_vezmou.tags_from_payload(p_payload -> 'tags');
  end if;
  -- souběžná uložení téže svatby se řadí za sebou (strop počtu hostů)
  perform 1 from se_vezmou.weddings w where w.id = v_wedding_id for update;
  v_id := se_vezmou.household_write(v_wedding_id, p_household_id, p_payload, 'manual');
  if v_tags is not null then
    update se_vezmou.households h set tags = v_tags where h.id = v_id and h.wedding_id = v_wedding_id;
  end if;
  perform se_vezmou.write_audit('admin', se_vezmou.actor_id(), v_wedding_id, 'guests.household_save',
    'household', v_id, null,
    jsonb_build_object('guests', jsonb_array_length(p_payload -> 'guests'),
                       'created', p_household_id is null));
  return v_id;
end
$$;

-- ---------------------------------------------------------------------------
-- admin_invitations_bulk_tag: pozvat na událost (nebo pozvání zrušit) hosty domácností se štítkem;
-- p_tag null = všichni hosté (jako admin_invitations_bulk). Štítek se porovnává přesně.
-- ---------------------------------------------------------------------------
create function se_vezmou.admin_invitations_bulk_tag(p_event_id uuid, p_invited boolean, p_tag text)
  returns integer
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
  v_tag text := pg_catalog.btrim(p_tag);
  v_count integer;
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_invited is null or not exists (
       select 1 from se_vezmou.events e where e.id = p_event_id and e.wedding_id = v_wedding_id) then
    raise exception 'invalid_event' using errcode = '22023';
  end if;
  if v_tag = '' or pg_catalog.char_length(v_tag) > 40 then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  if p_invited then
    insert into se_vezmou.invitations (wedding_id, guest_id, event_id)
    select g.wedding_id, g.id, p_event_id
      from se_vezmou.guests g
      join se_vezmou.households h on h.id = g.household_id and h.wedding_id = g.wedding_id
     where g.wedding_id = v_wedding_id
       and (v_tag is null or v_tag = any (h.tags))
    on conflict (guest_id, event_id) do nothing;
  else
    delete from se_vezmou.invitations i
     using se_vezmou.guests g, se_vezmou.households h
     where i.event_id = p_event_id and i.wedding_id = v_wedding_id
       and g.id = i.guest_id and g.wedding_id = i.wedding_id
       and h.id = g.household_id and h.wedding_id = g.wedding_id
       and (v_tag is null or v_tag = any (h.tags));
  end if;
  get diagnostics v_count = row_count;
  -- audit bez názvu štítku (může nést jméno rodiny), jen zda šlo o skupinu
  perform se_vezmou.write_audit('admin', se_vezmou.actor_id(), v_wedding_id, 'guests.invite_bulk',
    'event', p_event_id, null,
    jsonb_build_object('invited', p_invited, 'rows', v_count, 'by_tag', v_tag is not null));
  return v_count;
end
$$;

revoke all on function se_vezmou.admin_invitations_bulk_tag(uuid, boolean, text) from public, anon, service_role;
grant execute on function se_vezmou.admin_invitations_bulk_tag(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_guest_list: jako dřív, navíc štítky domácnosti
-- ---------------------------------------------------------------------------
create or replace function se_vezmou.admin_guest_list() returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'events', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'kind', e.kind, 'title', e.title, 'starts_at', e.starts_at,
        'rsvp_enabled', e.rsvp_enabled) order by e.position, e.starts_at), '[]'::jsonb)
        from se_vezmou.events e where e.wedding_id = v_wedding_id),
    'households', (
      select coalesce(jsonb_agg(x.j order by x.label, x.created_at, x.id), '[]'::jsonb)
        from (
          select h.label, h.created_at, h.id, jsonb_build_object(
            'id', h.id, 'label', h.label, 'invited_note', h.invited_note, 'tags', to_jsonb(h.tags),
            'guests', (
              select coalesce(jsonb_agg(jsonb_build_object(
                'id', g.id, 'display_name', g.display_name, 'is_child', g.is_child, 'age', g.age,
                'is_plus_one', g.is_plus_one, 'source', g.source,
                'invited_event_ids', (
                  select coalesce(jsonb_agg(i.event_id order by i.event_id), '[]'::jsonb)
                    from se_vezmou.invitations i where i.guest_id = g.id and i.wedding_id = g.wedding_id),
                'attendance', (
                  select coalesce(jsonb_agg(jsonb_build_object('event_id', a.event_id, 'attending', a.attending)
                                            order by a.event_id), '[]'::jsonb)
                    from se_vezmou.rsvp_people p
                    join se_vezmou.rsvp_attendance a on a.person_id = p.id and a.wedding_id = p.wedding_id
                   where p.guest_id = g.id and p.wedding_id = g.wedding_id)
              ) order by g.created_at, g.id), '[]'::jsonb)
                from se_vezmou.guests g where g.household_id = h.id and g.wedding_id = h.wedding_id),
            'response', (
              select jsonb_build_object(
                'id', r.id, 'submitted_at', r.submitted_at, 'last_edited_at', r.last_edited_at,
                'entered_by', r.entered_by, 'has_email', r.contact_email is not null,
                'attending', exists (
                  select 1 from se_vezmou.rsvp_people p
                    join se_vezmou.rsvp_attendance a on a.person_id = p.id and a.wedding_id = p.wedding_id
                   where p.response_id = r.id and p.wedding_id = r.wedding_id and a.attending))
                from se_vezmou.rsvp_responses r
               where r.household_id = h.id and r.wedding_id = h.wedding_id)
          ) as j
          from se_vezmou.households h where h.wedding_id = v_wedding_id
        ) x),
    -- odpovědi hostů mimo seznam (bez domácnosti)
    'unlisted', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'submitted_at', r.submitted_at,
        'people', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'person_name', p.person_name, 'is_child', p.is_child, 'age', p.age,
            'attendance', (
              select coalesce(jsonb_agg(jsonb_build_object('event_id', a.event_id, 'attending', a.attending)
                                        order by a.event_id), '[]'::jsonb)
                from se_vezmou.rsvp_attendance a where a.person_id = p.id and a.wedding_id = p.wedding_id))
            order by p.created_at, p.id), '[]'::jsonb)
            from se_vezmou.rsvp_people p where p.response_id = r.id and p.wedding_id = r.wedding_id))
        order by r.submitted_at, r.id), '[]'::jsonb)
        from se_vezmou.rsvp_responses r where r.wedding_id = v_wedding_id and r.household_id is null)
  );
end
$$;

-- ---------------------------------------------------------------------------
-- admin_export_guests: jako dřív, navíc štítky domácnosti u každé osoby (hosté mimo seznam bez štítků)
-- ---------------------------------------------------------------------------
create or replace function se_vezmou.admin_export_guests(p_include_health boolean default false) returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
  v_people jsonb;
  v_count integer;
  v_result jsonb;
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from se_vezmou.weddings w where w.id = v_wedding_id and w.deleted_at is null) then
    raise exception 'wedding_not_found' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(x.j order by x.s1, x.s2, x.s3), '[]'::jsonb), count(*)::integer
    into v_people, v_count
    from (
      select h.label as s1, g.created_at as s2, g.id as s3, jsonb_build_object(
          'household', h.label,
          'tags', to_jsonb(coalesce(h.tags, '{}'::text[])),
          'name', g.display_name,
          'kind', case when g.is_child then 'child' when g.is_plus_one then 'plus_one' else 'guest' end,
          'age', g.age,
          'invited_event_ids', (
            select coalesce(jsonb_agg(i.event_id order by i.event_id), '[]'::jsonb)
              from se_vezmou.invitations i where i.guest_id = g.id and i.wedding_id = g.wedding_id),
          'answered', p.id is not null,
          'attendance', coalesce((
            select jsonb_agg(jsonb_build_object('event_id', a.event_id, 'attending', a.attending)
                             order by a.event_id)
              from se_vezmou.rsvp_attendance a
             where a.person_id = p.id and a.wedding_id = p.wedding_id), '[]'::jsonb),
          'submitted_at', r.submitted_at,
          'entered_by', r.entered_by,
          'contact_email', r.contact_email,
          'answers', coalesce(r.answers, '{}'::jsonb),
          'diet', case when p_include_health then hl.diet end,
          'allergies', case when p_include_health then hl.allergies end) as j
        from se_vezmou.guests g
        join se_vezmou.households h on h.id = g.household_id and h.wedding_id = g.wedding_id
        left join se_vezmou.rsvp_people p on p.guest_id = g.id and p.wedding_id = g.wedding_id
        left join se_vezmou.rsvp_responses r on r.id = p.response_id and r.wedding_id = p.wedding_id
        left join se_vezmou.rsvp_health hl on hl.person_id = p.id and hl.wedding_id = p.wedding_id
       where g.wedding_id = v_wedding_id
      union all
      select coalesce(h.label, ''), p.created_at, p.id, jsonb_build_object(
          'household', h.label,
          'tags', to_jsonb(coalesce(h.tags, '{}'::text[])),
          'name', p.person_name,
          'kind', case when r.household_id is null then 'unlisted' when p.is_child then 'child' else 'plus_one' end,
          'age', p.age,
          'invited_event_ids', '[]'::jsonb,
          'answered', true,
          'attendance', coalesce((
            select jsonb_agg(jsonb_build_object('event_id', a.event_id, 'attending', a.attending)
                             order by a.event_id)
              from se_vezmou.rsvp_attendance a
             where a.person_id = p.id and a.wedding_id = p.wedding_id), '[]'::jsonb),
          'submitted_at', r.submitted_at,
          'entered_by', r.entered_by,
          'contact_email', r.contact_email,
          'answers', coalesce(r.answers, '{}'::jsonb),
          'diet', case when p_include_health then hl.diet end,
          'allergies', case when p_include_health then hl.allergies end)
        from se_vezmou.rsvp_people p
        join se_vezmou.rsvp_responses r on r.id = p.response_id and r.wedding_id = p.wedding_id
        left join se_vezmou.households h on h.id = r.household_id and h.wedding_id = r.wedding_id
        left join se_vezmou.rsvp_health hl on hl.person_id = p.id and hl.wedding_id = p.wedding_id
       where p.wedding_id = v_wedding_id and p.guest_id is null
    ) x;

  v_result := jsonb_build_object(
    'wedding', (
      select jsonb_build_object('partner_a_name', w.partner_a_name, 'partner_b_name', w.partner_b_name,
                                'starts_on', w.starts_on, 'default_locale', w.default_locale)
        from se_vezmou.weddings w where w.id = v_wedding_id),
    'include_health', p_include_health,
    'events', (
      select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at)
                                order by e.position, e.starts_at), '[]'::jsonb)
        from se_vezmou.events e where e.wedding_id = v_wedding_id and e.rsvp_enabled),
    'questions', (
      select coalesce(jsonb_agg(jsonb_build_object('key', q.key, 'type', q.type, 'label', q.label, 'options', q.options)
                                order by q.position, q.key), '[]'::jsonb)
        from se_vezmou.rsvp_questions q where q.wedding_id = v_wedding_id),
    'people', v_people);

  if p_include_health then
    update se_vezmou.rsvp_health hl set exported_at = pg_catalog.now() where hl.wedding_id = v_wedding_id;
  end if;
  perform se_vezmou.write_audit('admin', se_vezmou.actor_id(), v_wedding_id, 'export.guests', 'wedding',
    v_wedding_id, null, jsonb_build_object('people', v_count, 'include_health', p_include_health));
  return v_result;
end
$$;
