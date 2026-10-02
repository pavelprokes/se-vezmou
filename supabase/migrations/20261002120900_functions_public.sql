-- M3 / 10: funkce pro web páru a hosty: odvozená fáze, get_public_site, slepé RSVP.
-- Volá je server s JWT (role authenticated, wedding_role visitor | guest_pin | preview | admin).
-- Hosté nemají politiky na tabulkách, jen právo execute na tyto funkce a vždy se filtruje podle
-- app.wedding_id() (kap. 5.1 a 5.5).
--
-- TODO M8: rsvp_submit_unlisted (host mimo seznam, allow_unlisted), potvrzovací e-mail,
--          ladění prahů rsvp_match na testovacích datech.

-- ---------------------------------------------------------------------------
-- app.phase: odvozená fáze zveřejněného webu (kap. 7). Čistá funkce stejná jako
-- src/domain/lifecycle; zobrazení fáze nečeká na cron. Den svatby se počítá v pásmu svatby.
-- save_the_date -> rsvp_open -> rsvp_closed -> wedding_day -> thanks
-- ---------------------------------------------------------------------------
create function app.phase(p_wedding public.weddings, p_at timestamptz default pg_catalog.now())
  returns text
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_today date;
  v_first date := p_wedding.starts_on;
  v_last date := coalesce(p_wedding.ends_on, p_wedding.starts_on);
  v_opens timestamptz;
  v_closes timestamptz;
  v_has_settings boolean;
begin
  if p_wedding.status <> 'published' then
    return null;
  end if;
  if p_wedding.phase_override is not null then
    return p_wedding.phase_override;
  end if;
  if v_first is null then
    return 'save_the_date';
  end if;

  v_today := (p_at at time zone p_wedding.timezone)::date;
  if v_today > v_last then
    return 'thanks';
  end if;
  if v_today >= v_first then
    return 'wedding_day';
  end if;

  select true, s.opens_at, s.closes_at into v_has_settings, v_opens, v_closes
    from public.rsvp_settings s where s.wedding_id = p_wedding.id;
  if not coalesce(v_has_settings, false) then
    return 'save_the_date';
  end if;
  if v_closes is not null and p_at >= v_closes then
    return 'rsvp_closed';
  end if;
  -- opens_at null = bez omezení: RSVP je otevřené hned po zveřejnění
  if v_opens is null or p_at >= v_opens then
    return 'rsvp_open';
  end if;
  return 'save_the_date';
end
$$;

revoke all on function app.phase(public.weddings, timestamptz) from public, anon;
grant execute on function app.phase(public.weddings, timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- get_public_site: zveřejněný snímek. Část sensitive jen pro guest_pin a admin;
-- role preview dostane koncept z pracovních tabulek (včetně citlivých bloků).
-- Pozn.: skrytí darů po svatbě (FR-WEB-4) a chování bez PINu hostů (OQ-24) řeší M6.
-- ---------------------------------------------------------------------------
create function public.get_public_site() returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := app.wedding_id();
  v_role text := app.wedding_role();
  w public.weddings;
  v_version public.site_versions;
  v_sensitive jsonb;
begin
  if v_wedding_id is null or v_role is null or v_role not in ('visitor', 'guest_pin', 'preview', 'admin') then
    return null;
  end if;

  select * into w from public.weddings x where x.id = v_wedding_id and x.deleted_at is null;
  if not found then
    return null;
  end if;

  if v_role = 'preview' then
    if w.status = 'blocked' then
      return null;
    end if;
    return jsonb_build_object(
      'mode', 'preview',
      'wedding', jsonb_build_object(
        'default_locale', w.default_locale, 'locales', w.locales, 'template', w.template,
        'palette', w.palette, 'partner_a_name', w.partner_a_name,
        'partner_b_name', w.partner_b_name, 'starts_on', w.starts_on, 'ends_on', w.ends_on,
        'timezone', w.timezone),
      'pages', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'path', p.path, 'title', p.title, 'position', p.position,
          'blocks', (
            select coalesce(jsonb_agg(jsonb_build_object(
              'id', b.id, 'type', b.type, 'anchor', b.anchor, 'sensitive', b.sensitive,
              'data', b.data) order by b.position), '[]'::jsonb)
              from public.content_blocks b
             where b.wedding_id = w.id and b.page_id = p.id and b.enabled)
        ) order by p.position), '[]'::jsonb)
          from public.pages p where p.wedding_id = w.id and p.enabled),
      'events', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', e.id, 'kind', e.kind, 'title', e.title, 'description', e.description,
          'starts_at', e.starts_at, 'ends_at', e.ends_at, 'venue_id', e.venue_id,
          'rsvp_enabled', e.rsvp_enabled) order by e.position, e.starts_at), '[]'::jsonb)
          from public.events e where e.wedding_id = w.id),
      'venues', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', v.id, 'name', v.name, 'directions', v.directions, 'lat', v.lat, 'lng', v.lng,
          'address', case when v.is_private then null else v.address end,
          'is_private', v.is_private)), '[]'::jsonb)
          from public.venues v where v.wedding_id = w.id)
    );
  end if;

  -- visitor, guest_pin, admin: jen zveřejněná verze
  if w.status <> 'published' or w.published_version_id is null then
    return null;
  end if;
  select * into v_version from public.site_versions v
   where v.id = w.published_version_id and v.wedding_id = w.id;
  if not found then
    return null;
  end if;

  if v_role in ('guest_pin', 'admin') then
    select s.sensitive_content into v_sensitive from public.site_version_sensitive s
     where s.version_id = v_version.id and s.wedding_id = w.id;
  end if;

  return jsonb_build_object(
    'mode', 'published',
    'version_no', v_version.version_no,
    'phase', app.phase(w),
    'content', v_version.public_content,
    'sensitive', v_sensitive,
    'quick_notice', case when w.quick_notice_enabled then w.quick_notice end
  );
end
$$;

revoke all on function public.get_public_site() from public, anon;
grant execute on function public.get_public_site() to authenticated;

-- ---------------------------------------------------------------------------
-- Slepé RSVP: rsvp_match, rsvp_get, rsvp_submit
-- ---------------------------------------------------------------------------

-- Domácnost z platného lístku (jen role visitor a guest_pin, jen vlastní svatba).
create function app.ticket_household(p_ticket text) returns uuid
  language sql stable security definer set search_path = ''
  as $$
  select t.household_id
    from public.rsvp_tickets t
   where p_ticket is not null
     and app.wedding_role() in ('visitor', 'guest_pin')
     and t.wedding_id = app.wedding_id()
     and t.token_hash = sha256(convert_to(p_ticket, 'UTF8'))
     and t.purpose = 'edit' and t.expires_at > pg_catalog.now()
$$;

revoke all on function app.ticket_household(text) from public, anon;

-- rsvp_match: vždy přesně jeden řádek se sloupcem ticket. Žádná shoda, více shod, zavřené RSVP
-- i chybná role vrací stejný tvar (ticket = null), takže nelze zjistit rozdíl ani seznam hostů.
create function public.rsvp_match(p_name text) returns table (ticket text)
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := app.wedding_id();
  w public.weddings;
  v_key text;
  v_households uuid[];
  v_threshold numeric;
  v_token text;
begin
  if v_wedding_id is null or app.wedding_role() not in ('visitor', 'guest_pin') then
    return query select null::text;
    return;
  end if;
  select * into w from public.weddings x where x.id = v_wedding_id and x.deleted_at is null;
  if not found or app.phase(w) is distinct from 'rsvp_open' then
    return query select null::text;
    return;
  end if;

  v_key := app.name_key(coalesce(p_name, ''));
  if length(v_key) < 2 then
    return query select null::text;
    return;
  end if;

  -- 1. přesná shoda seřazených tokenů (Novák Matěj = Matěj Novák)
  select array_agg(distinct g.household_id) into v_households
    from public.guests g where g.wedding_id = v_wedding_id and g.name_key = v_key;

  -- 2. tolerance překlepů (trigramy); práh se ladí na testovacích datech
  if v_households is null then
    v_threshold := coalesce((app.setting('rsvp_match_threshold') #>> '{}')::numeric, 0.7);
    select array_agg(distinct g.household_id) into v_households
      from public.guests g
     where g.wedding_id = v_wedding_id and extensions.similarity(g.name_key, v_key) >= v_threshold;
  end if;

  -- jen jednoznačná shoda (jedna domácnost) vydá lístek; nejednoznačnost = stejná odpověď jako neshoda
  if v_households is null or cardinality(v_households) <> 1 then
    return query select null::text;
    return;
  end if;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.rsvp_tickets (token_hash, wedding_id, household_id, expires_at, purpose)
  values (sha256(convert_to(v_token, 'UTF8')), v_wedding_id, v_households[1],
          pg_catalog.now() + interval '30 minutes', 'edit');
  return query select v_token;
end
$$;

-- rsvp_get: údaje potřebné k vyplnění odpovědi pro domácnost z lístku (nebo null).
create function public.rsvp_get(p_ticket text) returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := app.wedding_id();
  v_household uuid := app.ticket_household(p_ticket);
  v_response public.rsvp_responses;
begin
  if v_household is null then
    return null;
  end if;

  select * into v_response from public.rsvp_responses r
   where r.wedding_id = v_wedding_id and r.household_id = v_household;

  return jsonb_build_object(
    'guests', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', g.id, 'display_name', g.display_name, 'is_child', g.is_child, 'age', g.age)
        order by g.created_at, g.id), '[]'::jsonb)
        from public.guests g where g.wedding_id = v_wedding_id and g.household_id = v_household),
    -- jen události, na které má někdo z domácnosti pozvání
    'events', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'kind', e.kind, 'title', e.title, 'description', e.description,
        'starts_at', e.starts_at, 'ends_at', e.ends_at) order by e.position, e.starts_at), '[]'::jsonb)
        from public.events e
       where e.wedding_id = v_wedding_id and e.rsvp_enabled
         and exists (
           select 1 from public.invitations i
             join public.guests g on g.id = i.guest_id and g.wedding_id = i.wedding_id
            where i.event_id = e.id and i.wedding_id = v_wedding_id and g.household_id = v_household)),
    'invitations', (
      select coalesce(jsonb_agg(jsonb_build_object('guest_id', i.guest_id, 'event_id', i.event_id)), '[]'::jsonb)
        from public.invitations i
        join public.guests g on g.id = i.guest_id and g.wedding_id = i.wedding_id
       where i.wedding_id = v_wedding_id and g.household_id = v_household),
    'settings', (
      select jsonb_build_object('enabled_questions', s.enabled_questions,
        'email_confirmation', s.email_confirmation, 'opens_at', s.opens_at, 'closes_at', s.closes_at)
        from public.rsvp_settings s where s.wedding_id = v_wedding_id),
    'questions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', q.id, 'key', q.key, 'type', q.type, 'label', q.label, 'options', q.options,
        'required', q.required, 'event_id', q.event_id) order by q.position, q.key), '[]'::jsonb)
        from public.rsvp_questions q where q.wedding_id = v_wedding_id and q.enabled),
    'response', case when v_response.id is null then null else jsonb_build_object(
      'answers', v_response.answers,
      'contact_email', v_response.contact_email,
      'people', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'guest_id', p.guest_id, 'person_name', p.person_name, 'is_plus_one', p.is_plus_one,
          'is_child', p.is_child, 'age', p.age,
          'attendance', (
            select coalesce(jsonb_agg(jsonb_build_object('event_id', a.event_id, 'attending', a.attending)), '[]'::jsonb)
              from public.rsvp_attendance a where a.person_id = p.id and a.wedding_id = p.wedding_id),
          'diet', h.diet, 'allergies', h.allergies) order by p.created_at, p.id), '[]'::jsonb)
          from public.rsvp_people p
          left join public.rsvp_health h on h.person_id = p.id and h.wedding_id = p.wedding_id
         where p.wedding_id = v_wedding_id and p.response_id = v_response.id)
    ) end
  );
end
$$;

-- rsvp_submit: zápis nebo úprava odpovědi domácnosti. Zkontroluje platnost lístku, otevření
-- a uzavření RSVP, příslušnost hostů k domácnosti, pozvání na události a povolení doprovodu.
-- Payload:
--   { "contact_email": text|null, "answers": {...},
--     "people": [ { "guest_id": uuid|null, "person_name": text (jen u doprovodu), "is_plus_one": bool,
--                   "is_child": bool, "age": int|null, "diet": text|null, "allergies": text|null,
--                   "attendance": [ { "event_id": uuid, "attending": bool } ] } ] }
create function public.rsvp_submit(p_ticket text, p_payload jsonb) returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  c_max_people constant integer := 20;
  v_wedding_id uuid := app.wedding_id();
  v_household uuid := app.ticket_household(p_ticket);
  w public.weddings;
  v_settings public.rsvp_settings;
  v_person jsonb;
  v_att jsonb;
  v_guest_id uuid;
  v_guest public.guests;
  v_event_id uuid;
  v_name text;
  v_email text;
  v_answers jsonb;
  v_response_id uuid;
  v_person_id uuid;
  v_diet text;
  v_allergies text;
  v_is_plus_one boolean;
begin
  if v_household is null then
    raise exception 'invalid_ticket' using errcode = '28000';
  end if;

  select * into w from public.weddings x where x.id = v_wedding_id and x.deleted_at is null;
  if not found or app.phase(w) is distinct from 'rsvp_open' then
    raise exception 'rsvp_closed' using errcode = '55000';
  end if;
  select * into v_settings from public.rsvp_settings s where s.wedding_id = v_wedding_id;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or jsonb_typeof(p_payload -> 'people') is distinct from 'array'
     or jsonb_array_length(p_payload -> 'people') = 0
     or jsonb_array_length(p_payload -> 'people') > c_max_people
     or length(p_payload::text) > 100000 then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;

  v_answers := coalesce(p_payload -> 'answers', '{}'::jsonb);
  if jsonb_typeof(v_answers) <> 'object' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;

  -- e-mail se uloží jen při zapnutém potvrzení e-mailem
  v_email := nullif(btrim(coalesce(p_payload ->> 'contact_email', '')), '');
  if v_email is not null then
    if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(v_email) > 254 then
      raise exception 'invalid_payload' using errcode = '22023';
    end if;
    if not v_settings.email_confirmation then
      v_email := null;
    end if;
  end if;

  -- 1. validace všech osob a událostí před jakýmkoli zápisem
  for v_person in select * from jsonb_array_elements(p_payload -> 'people') loop
    v_guest_id := nullif(v_person ->> 'guest_id', '')::uuid;
    if v_guest_id is not null then
      if not exists (select 1 from public.guests g
                      where g.id = v_guest_id and g.wedding_id = v_wedding_id and g.household_id = v_household) then
        raise exception 'invalid_guest' using errcode = '42501';
      end if;
    else
      if coalesce((v_settings.enabled_questions ->> 'plus_one')::boolean, false) is not true then
        raise exception 'plus_one_not_allowed' using errcode = '42501';
      end if;
      if char_length(btrim(coalesce(v_person ->> 'person_name', ''))) not between 1 and 200 then
        raise exception 'invalid_payload' using errcode = '22023';
      end if;
    end if;

    for v_att in select * from jsonb_array_elements(coalesce(v_person -> 'attendance', '[]'::jsonb)) loop
      v_event_id := (v_att ->> 'event_id')::uuid;
      if jsonb_typeof(v_att -> 'attending') is distinct from 'boolean' then
        raise exception 'invalid_payload' using errcode = '22023';
      end if;
      -- pozvání na událost: host se svým řádkem, doprovod přes kohokoli z domácnosti
      if not exists (
        select 1
          from public.invitations i
          join public.guests g on g.id = i.guest_id and g.wedding_id = i.wedding_id
          join public.events e on e.id = i.event_id and e.wedding_id = i.wedding_id
         where i.event_id = v_event_id and i.wedding_id = v_wedding_id and e.rsvp_enabled
           and g.household_id = v_household
           and (v_guest_id is null or g.id = v_guest_id)) then
        raise exception 'event_not_invited' using errcode = '42501';
      end if;
    end loop;
  end loop;

  -- 2. zápis: jedna odpověď na domácnost, osoby a účast se nahrazují
  insert into public.rsvp_responses as r (wedding_id, household_id, answers, contact_email, entered_by)
  values (v_wedding_id, v_household, v_answers, v_email::extensions.citext, 'guest')
  on conflict (wedding_id, household_id) where household_id is not null
  do update set answers = excluded.answers, contact_email = excluded.contact_email,
                last_edited_at = pg_catalog.now()
  returning r.id into v_response_id;

  delete from public.rsvp_people p where p.wedding_id = v_wedding_id and p.response_id = v_response_id;

  for v_person in select * from jsonb_array_elements(p_payload -> 'people') loop
    v_guest_id := nullif(v_person ->> 'guest_id', '')::uuid;
    v_is_plus_one := v_guest_id is null;
    if v_guest_id is not null then
      select * into v_guest from public.guests g where g.id = v_guest_id and g.wedding_id = v_wedding_id;
      v_name := v_guest.display_name;
    else
      v_name := btrim(v_person ->> 'person_name');
    end if;

    insert into public.rsvp_people (wedding_id, response_id, guest_id, person_name, is_plus_one, is_child, age)
    values (v_wedding_id, v_response_id, v_guest_id, v_name, v_is_plus_one,
            case when v_guest_id is not null then v_guest.is_child
                 else coalesce((v_person ->> 'is_child')::boolean, false) end,
            case when v_guest_id is not null then v_guest.age
                 when coalesce((v_person ->> 'is_child')::boolean, false) then (v_person ->> 'age')::smallint end)
    returning id into v_person_id;

    for v_att in select * from jsonb_array_elements(coalesce(v_person -> 'attendance', '[]'::jsonb)) loop
      insert into public.rsvp_attendance (wedding_id, person_id, event_id, attending)
      values (v_wedding_id, v_person_id, (v_att ->> 'event_id')::uuid, (v_att ->> 'attending')::boolean)
      on conflict (person_id, event_id) do update set attending = excluded.attending;
    end loop;

    -- zdravotní údaje zvlášť a jen pokud je pár zapnul; nepovinné, prázdné se neukládají
    if coalesce((v_settings.enabled_questions ->> 'diet')::boolean, false) then
      v_diet := nullif(btrim(coalesce(v_person ->> 'diet', '')), '');
      v_allergies := nullif(btrim(coalesce(v_person ->> 'allergies', '')), '');
      if v_diet is not null or v_allergies is not null then
        insert into public.rsvp_health (person_id, wedding_id, diet, allergies)
        values (v_person_id, v_wedding_id, v_diet, v_allergies);
      end if;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'response_id', v_response_id);
end
$$;

revoke all on function public.rsvp_match(text), public.rsvp_get(text), public.rsvp_submit(text, jsonb)
  from public, anon;
grant execute on function public.rsvp_match(text), public.rsvp_get(text), public.rsvp_submit(text, jsonb)
  to authenticated;
