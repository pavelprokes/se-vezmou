-- M8 / 1: RSVP hostů, host mimo seznam, správcovská strana (seznam, přehled, ruční zápis), analytika.
--
-- Zdroj: docs/data-model.md (kap. 3.4, 3.5, 5.5, 12, 14), docs/security-privacy.md,
-- docs/adr/0010-rate-limiting.md, docs/adr/0007-analytics.md. Odchylky implementace jsou v kap. 15
-- docs/data-model.md.
--
-- Hotové migrace se po sloučení neupravují, proto jsou funkce z M3 (`rsvp_match`, `rsvp_get`,
-- `rsvp_submit`) tady nahrazeny (`create or replace`) se stejným podpisem a stejnými oprávněními.
-- Zásady jako vždy: security definer, prázdný search_path, plně kvalifikované názvy, žádné
-- `execute` pro public a anon, filtr podle app.wedding_id().

-- ---------------------------------------------------------------------------
-- Pomocné funkce: bezpečné přetypování na uuid a tolerance překlepů ve jménech
-- ---------------------------------------------------------------------------

-- Neplatný text není výjimka, ale null (payload z prohlížeče je nedůvěryhodný).
create function app.try_uuid(p_text text) returns uuid
  language plpgsql immutable set search_path = ''
  as $$
begin
  return p_text::uuid;
exception when others then
  return null;
end
$$;

-- Vzdálenost dvou slov (optimal string alignment): vložení, smazání, záměna znaku a prohození
-- sousedních znaků se počítají jako jedna úprava. Slova jsou krátká (jména), nic dalšího se neřeší.
create function app.osa_distance(p_a text, p_b text) returns integer
  language plpgsql immutable strict parallel safe set search_path = ''
  as $$
declare
  la integer := pg_catalog.char_length(p_a);
  lb integer := pg_catalog.char_length(p_b);
  d integer[];
  i integer;
  j integer;
  v_cost integer;
  v_best integer;
begin
  if la = 0 then return lb; end if;
  if lb = 0 then return la; end if;
  if la > 64 or lb > 64 then return greatest(la, lb); end if;

  d := pg_catalog.array_fill(0, array[la + 1, lb + 1], array[0, 0]);
  for i in 0..la loop d[i][0] := i; end loop;
  for j in 0..lb loop d[0][j] := j; end loop;

  for i in 1..la loop
    for j in 1..lb loop
      v_cost := case when pg_catalog.substr(p_a, i, 1) = pg_catalog.substr(p_b, j, 1) then 0 else 1 end;
      v_best := least(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + v_cost);
      if i > 1 and j > 1
         and pg_catalog.substr(p_a, i, 1) = pg_catalog.substr(p_b, j - 1, 1)
         and pg_catalog.substr(p_a, i - 1, 1) = pg_catalog.substr(p_b, j, 1) then
        v_best := least(v_best, d[i - 2][j - 2] + 1);
      end if;
      d[i][j] := v_best;
    end loop;
  end loop;
  return d[la][lb];
end
$$;

-- Jsou dva klíče jmen (`app.name_key`) "skoro stejné"? Stejný počet slov, ve stejném pořadí
-- seřazených slov nejvýš jedna úprava na slovo (dvě u slov od devíti znaků), celkem nejvýš dvě.
-- Slovo kratší než čtyři znaky se musí shodovat přesně (Jan není Jana ani Jon). Slouží jako doplněk
-- trigramů: krátká jména s jedním překlepem trigramy nezachytí ("jan novk" má podobnost 0,58).
create function app.names_close(p_a text, p_b text) returns boolean
  language plpgsql immutable strict parallel safe set search_path = ''
  as $$
declare
  ta text[] := pg_catalog.string_to_array(p_a, ' ');
  tb text[] := pg_catalog.string_to_array(p_b, ' ');
  v_total integer := 0;
  v_d integer;
  v_len integer;
  v_max integer;
  i integer;
begin
  if pg_catalog.cardinality(ta) = 0 or pg_catalog.cardinality(ta) <> pg_catalog.cardinality(tb) then
    return false;
  end if;
  for i in 1..pg_catalog.cardinality(ta) loop
    v_len := greatest(pg_catalog.char_length(ta[i]), pg_catalog.char_length(tb[i]));
    if abs(pg_catalog.char_length(ta[i]) - pg_catalog.char_length(tb[i])) > 2 then
      return false;
    end if;
    v_d := app.osa_distance(ta[i], tb[i]);
    if v_d > 0 and least(pg_catalog.char_length(ta[i]), pg_catalog.char_length(tb[i])) < 4 then
      return false;
    end if;
    v_max := case when v_len >= 9 then 2 else 1 end;
    if v_d > v_max then
      return false;
    end if;
    v_total := v_total + v_d;
  end loop;
  return v_total <= 2;
end
$$;

revoke all on function app.try_uuid(text), app.osa_distance(text, text), app.names_close(text, text)
  from public, anon;
grant execute on function app.try_uuid(text), app.osa_distance(text, text), app.names_close(text, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- rsvp_match: jako v M3, jen tolerance překlepů je po slovech (ne trigramy) a vstup má strop délky.
-- Odpověď má vždy stejný tvar (jeden řádek, ticket = null při neshodě, více shodách,
-- zavřeném RSVP i chybné roli).
-- ---------------------------------------------------------------------------
create or replace function public.rsvp_match(p_name text) returns table (ticket text)
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := app.wedding_id();
  w public.weddings;
  v_key text;
  v_households uuid[];
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

  if p_name is null or pg_catalog.char_length(p_name) > 200 then
    return query select null::text;
    return;
  end if;
  v_key := app.name_key(p_name);
  if pg_catalog.char_length(v_key) < 2 then
    return query select null::text;
    return;
  end if;

  -- 1. přesná shoda seřazených slov (Novák Matěj = Matěj Novák)
  select pg_catalog.array_agg(distinct g.household_id) into v_households
    from public.guests g where g.wedding_id = v_wedding_id and g.name_key = v_key;

  -- 2. tolerance překlepů po slovech (app.names_close). Trigramová podobnost se nepoužívá:
  --    u krátkých jmen pouští jiného člověka (Jana ~ Jan, podobnost 0,82). Práh
  --    app_settings.rsvp_match_threshold zůstává v nastavení jako rezerva, rsvp_match ho nečte.
  if v_households is null then
    select pg_catalog.array_agg(distinct g.household_id) into v_households
      from public.guests g
     where g.wedding_id = v_wedding_id and app.names_close(g.name_key, v_key);
  end if;

  -- jen jednoznačná shoda (jedna domácnost) vydá lístek; nejednoznačnost = stejná odpověď jako neshoda
  if v_households is null or pg_catalog.cardinality(v_households) <> 1 then
    return query select null::text;
    return;
  end if;

  v_token := pg_catalog.replace(gen_random_uuid()::text, '-', '')
          || pg_catalog.replace(gen_random_uuid()::text, '-', '');
  insert into public.rsvp_tickets (token_hash, wedding_id, household_id, expires_at, purpose)
  values (sha256(convert_to(v_token, 'UTF8')), v_wedding_id, v_households[1],
          pg_catalog.now() + interval '30 minutes', 'edit');
  return query select v_token;
end
$$;

-- ---------------------------------------------------------------------------
-- Pohled na domácnost: co host (nebo správce při ručním zápisu) vidí při vyplňování.
-- Jen události, na které má někdo z domácnosti pozvání; dřívější odpověď včetně diety.
-- ---------------------------------------------------------------------------
create function app.rsvp_household_view(p_household uuid) returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := app.wedding_id();
  v_response public.rsvp_responses;
begin
  select * into v_response from public.rsvp_responses r
   where r.wedding_id = v_wedding_id and r.household_id = p_household;

  return jsonb_build_object(
    'household_id', p_household,
    'wedding', (
      select jsonb_build_object('timezone', w.timezone, 'default_locale', w.default_locale)
        from public.weddings w where w.id = v_wedding_id),
    'guests', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', g.id, 'display_name', g.display_name, 'is_child', g.is_child, 'age', g.age)
        order by g.created_at, g.id), '[]'::jsonb)
        from public.guests g where g.wedding_id = v_wedding_id and g.household_id = p_household),
    'events', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'kind', e.kind, 'title', e.title, 'description', e.description,
        'starts_at', e.starts_at, 'ends_at', e.ends_at) order by e.position, e.starts_at), '[]'::jsonb)
        from public.events e
       where e.wedding_id = v_wedding_id and e.rsvp_enabled
         and exists (
           select 1 from public.invitations i
             join public.guests g on g.id = i.guest_id and g.wedding_id = i.wedding_id
            where i.event_id = e.id and i.wedding_id = v_wedding_id and g.household_id = p_household)),
    'invitations', (
      select coalesce(jsonb_agg(jsonb_build_object('guest_id', i.guest_id, 'event_id', i.event_id)), '[]'::jsonb)
        from public.invitations i
        join public.guests g on g.id = i.guest_id and g.wedding_id = i.wedding_id
       where i.wedding_id = v_wedding_id and g.household_id = p_household),
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
      'entered_by', v_response.entered_by,
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

revoke all on function app.rsvp_household_view(uuid) from public, anon;

create or replace function public.rsvp_get(p_ticket text) returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_household uuid := app.ticket_household(p_ticket);
begin
  if v_household is null then
    return null;
  end if;
  return app.rsvp_household_view(v_household);
end
$$;

-- ---------------------------------------------------------------------------
-- app.rsvp_apply: společný zápis odpovědi (host se lístkem, host mimo seznam, ruční zápis správce).
-- Volající už ověřili oprávnění a otevření RSVP; tady se validuje obsah a zapisuje v jedné transakci.
--   p_household: domácnost, nebo null u hosta mimo seznam
--   p_entered_by: 'guest' nebo 'admin' (správce: bez povinných otázek a bez e-mailu)
-- Payload:
--   { "contact_email": text|null, "answers": {...},
--     "people": [ { "guest_id": uuid|null, "person_name": text (jen mimo seznam a u doprovodu),
--                   "is_child": bool, "age": int|null, "diet": text|null, "allergies": text|null,
--                   "attendance": [ { "event_id": uuid, "attending": bool } ] } ] }
-- Zná vestavěné odpovědi lodging (need|own|unsure), transport (need|own|offer), song (text)
-- a vlastní otázky páru (text, choice podle options[].value, bool). Neznámé klíče zůstávají.
-- ---------------------------------------------------------------------------
create function app.rsvp_apply(
  p_wedding_id uuid,
  p_household uuid,
  p_payload jsonb,
  p_entered_by text
) returns uuid
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  c_max_people constant integer := 20;
  c_max_unlisted constant integer := 6;
  v_settings public.rsvp_settings;
  v_flags jsonb;
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
  v_is_child boolean;
  v_age smallint;
  v_age_text text;
  v_plus_ones integer := 0;
  v_unlisted boolean := p_household is null;
  v_max_people integer;
  v_attending uuid[] := '{}';
  v_question public.rsvp_questions;
  v_value jsonb;
  v_text text;
begin
  v_max_people := case when v_unlisted then c_max_unlisted else c_max_people end;
  select * into v_settings from public.rsvp_settings s where s.wedding_id = p_wedding_id;
  v_flags := coalesce(v_settings.enabled_questions, '{}'::jsonb);

  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or jsonb_typeof(p_payload -> 'people') is distinct from 'array'
     or jsonb_array_length(p_payload -> 'people') = 0
     or jsonb_array_length(p_payload -> 'people') > v_max_people
     or pg_catalog.length(p_payload::text) > 100000 then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;

  v_answers := coalesce(p_payload -> 'answers', '{}'::jsonb);
  if jsonb_typeof(v_answers) <> 'object' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;

  -- e-mail se uloží jen při zapnutém potvrzení e-mailem a jen u odpovědi samotného hosta
  v_email := nullif(pg_catalog.btrim(coalesce(p_payload ->> 'contact_email', '')), '');
  if v_email is not null then
    if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or pg_catalog.length(v_email) > 254 then
      raise exception 'invalid_payload' using errcode = '22023';
    end if;
    if not coalesce(v_settings.email_confirmation, false) or p_entered_by <> 'guest' then
      v_email := null;
    end if;
  end if;

  -- 1. validace všech osob a událostí před jakýmkoli zápisem
  for v_person in select * from jsonb_array_elements(p_payload -> 'people') loop
    if jsonb_typeof(v_person) <> 'object' then
      raise exception 'invalid_payload' using errcode = '22023';
    end if;
    v_guest_id := app.try_uuid(v_person ->> 'guest_id');
    if nullif(v_person ->> 'guest_id', '') is not null and v_guest_id is null then
      raise exception 'invalid_payload' using errcode = '22023';
    end if;
    v_is_child := coalesce(v_person -> 'is_child' = 'true'::jsonb, false);

    if v_guest_id is not null then
      if v_unlisted or not exists (
           select 1 from public.guests g
            where g.id = v_guest_id and g.wedding_id = p_wedding_id and g.household_id = p_household) then
        raise exception 'invalid_guest' using errcode = '42501';
      end if;
    else
      if not v_unlisted then
        -- doprovod a děti doplněné ručně jen tam, kde je pár povolil
        if v_is_child then
          if coalesce((v_flags ->> 'children')::boolean, false) is not true then
            raise exception 'children_not_allowed' using errcode = '42501';
          end if;
        else
          if coalesce((v_flags ->> 'plus_one')::boolean, false) is not true then
            raise exception 'plus_one_not_allowed' using errcode = '42501';
          end if;
          v_plus_ones := v_plus_ones + 1;
          if v_plus_ones > 1 then
            raise exception 'too_many_plus_one' using errcode = '22023';
          end if;
        end if;
      elsif v_is_child and coalesce((v_flags ->> 'children')::boolean, false) is not true then
        raise exception 'children_not_allowed' using errcode = '42501';
      end if;
      if pg_catalog.char_length(pg_catalog.btrim(coalesce(v_person ->> 'person_name', ''))) not between 1 and 200 then
        raise exception 'invalid_payload' using errcode = '22023';
      end if;
      if v_is_child then
        v_age_text := v_person ->> 'age';
        if v_age_text is null or v_age_text !~ '^[0-9]{1,2}$' or v_age_text::integer > 17 then
          raise exception 'invalid_payload' using errcode = '22023';
        end if;
      end if;
    end if;

    for v_att in select * from jsonb_array_elements(coalesce(v_person -> 'attendance', '[]'::jsonb)) loop
      v_event_id := app.try_uuid(v_att ->> 'event_id');
      if v_event_id is null or jsonb_typeof(v_att -> 'attending') is distinct from 'boolean' then
        raise exception 'invalid_payload' using errcode = '22023';
      end if;
      if v_unlisted then
        if not exists (select 1 from public.events e
                        where e.id = v_event_id and e.wedding_id = p_wedding_id and e.rsvp_enabled) then
          raise exception 'event_not_invited' using errcode = '42501';
        end if;
      elsif not exists (
        select 1
          from public.invitations i
          join public.guests g on g.id = i.guest_id and g.wedding_id = i.wedding_id
          join public.events e on e.id = i.event_id and e.wedding_id = i.wedding_id
         where i.event_id = v_event_id and i.wedding_id = p_wedding_id and e.rsvp_enabled
           and g.household_id = p_household
           and (v_guest_id is null or g.id = v_guest_id)) then
        -- pozvání na událost: host se svým řádkem, doprovod přes kohokoli z domácnosti
        raise exception 'event_not_invited' using errcode = '42501';
      end if;
      if (v_att -> 'attending') = 'true'::jsonb then
        v_attending := v_attending || v_event_id;
      end if;
    end loop;
  end loop;

  -- 2. vestavěné a vlastní otázky (typy, možnosti, povinnost)
  if v_answers ? 'lodging' then
    if coalesce((v_flags ->> 'lodging')::boolean, false) is not true then
      v_answers := v_answers - 'lodging';
    elsif jsonb_typeof(v_answers -> 'lodging') is distinct from 'string'
          or (v_answers ->> 'lodging') not in ('need', 'own', 'unsure') then
      raise exception 'invalid_payload' using errcode = '22023';
    end if;
  end if;
  if v_answers ? 'transport' then
    if coalesce((v_flags ->> 'transport')::boolean, false) is not true then
      v_answers := v_answers - 'transport';
    elsif jsonb_typeof(v_answers -> 'transport') is distinct from 'string'
          or (v_answers ->> 'transport') not in ('need', 'own', 'offer') then
      raise exception 'invalid_payload' using errcode = '22023';
    end if;
  end if;
  if v_answers ? 'song' then
    if coalesce((v_flags ->> 'song')::boolean, false) is not true then
      v_answers := v_answers - 'song';
    elsif jsonb_typeof(v_answers -> 'song') is distinct from 'string'
          or pg_catalog.char_length(v_answers ->> 'song') > 200 then
      raise exception 'invalid_payload' using errcode = '22023';
    elsif pg_catalog.btrim(v_answers ->> 'song') = '' then
      v_answers := v_answers - 'song';
    else
      v_answers := jsonb_set(v_answers, '{song}', to_jsonb(pg_catalog.btrim(v_answers ->> 'song')));
    end if;
  end if;

  for v_question in
    select * from public.rsvp_questions q where q.wedding_id = p_wedding_id and q.enabled
  loop
    v_value := v_answers -> v_question.key;
    -- otázka vázaná na událost se týká jen toho, kdo na ni přijde
    if v_question.event_id is not null and not (v_question.event_id = any (v_attending)) then
      v_answers := v_answers - v_question.key;
      continue;
    end if;
    if v_value is null or v_value = 'null'::jsonb then
      v_answers := v_answers - v_question.key;
      if v_question.required and p_entered_by = 'guest' then
        raise exception 'answer_required' using errcode = '22023';
      end if;
      continue;
    end if;
    if v_question.type = 'text' then
      if jsonb_typeof(v_value) <> 'string' or pg_catalog.char_length(v_value #>> '{}') > 1000 then
        raise exception 'invalid_payload' using errcode = '22023';
      end if;
      v_text := pg_catalog.btrim(v_value #>> '{}');
      if v_text = '' then
        v_answers := v_answers - v_question.key;
        if v_question.required and p_entered_by = 'guest' then
          raise exception 'answer_required' using errcode = '22023';
        end if;
      else
        v_answers := jsonb_set(v_answers, array[v_question.key], to_jsonb(v_text));
      end if;
    elsif v_question.type = 'bool' then
      if jsonb_typeof(v_value) <> 'boolean' then
        raise exception 'invalid_payload' using errcode = '22023';
      end if;
    elsif v_question.type = 'choice' then
      if jsonb_typeof(v_value) <> 'string'
         or not exists (
           select 1 from jsonb_array_elements(v_question.options) o
            where jsonb_typeof(o) = 'object' and o ->> 'value' = v_value #>> '{}') then
        raise exception 'invalid_payload' using errcode = '22023';
      end if;
    end if;
  end loop;

  -- 3. zápis: jedna odpověď na domácnost, osoby a účast se nahrazují
  if v_unlisted then
    insert into public.rsvp_responses (wedding_id, household_id, answers, contact_email, entered_by)
    values (p_wedding_id, null, v_answers, v_email::extensions.citext, p_entered_by)
    returning id into v_response_id;
  else
    insert into public.rsvp_responses as r (wedding_id, household_id, answers, contact_email, entered_by)
    values (p_wedding_id, p_household, v_answers, v_email::extensions.citext, p_entered_by)
    on conflict (wedding_id, household_id) where household_id is not null
    do update set answers = excluded.answers, contact_email = excluded.contact_email,
                  entered_by = excluded.entered_by, last_edited_at = pg_catalog.now()
    returning r.id into v_response_id;

    delete from public.rsvp_people p where p.wedding_id = p_wedding_id and p.response_id = v_response_id;
  end if;

  for v_person in select * from jsonb_array_elements(p_payload -> 'people') loop
    v_guest_id := app.try_uuid(v_person ->> 'guest_id');
    v_is_child := coalesce(v_person -> 'is_child' = 'true'::jsonb, false);
    if v_guest_id is not null then
      select * into v_guest from public.guests g where g.id = v_guest_id and g.wedding_id = p_wedding_id;
      v_name := v_guest.display_name;
      v_is_child := v_guest.is_child;
      v_age := v_guest.age;
    else
      v_name := pg_catalog.btrim(v_person ->> 'person_name');
      v_age := case when v_is_child then (v_person ->> 'age')::smallint end;
    end if;

    -- clock_timestamp: osoby jedné odpovědi si drží pořadí z payloadu (now() je v transakci stejné)
    insert into public.rsvp_people (wedding_id, response_id, guest_id, person_name, is_plus_one, is_child, age, created_at)
    values (p_wedding_id, v_response_id, v_guest_id, v_name,
            v_guest_id is null and not v_unlisted and not v_is_child, v_is_child, v_age,
            pg_catalog.clock_timestamp())
    returning id into v_person_id;

    for v_att in select * from jsonb_array_elements(coalesce(v_person -> 'attendance', '[]'::jsonb)) loop
      insert into public.rsvp_attendance (wedding_id, person_id, event_id, attending)
      values (p_wedding_id, v_person_id, (v_att ->> 'event_id')::uuid, (v_att ->> 'attending')::boolean)
      on conflict (person_id, event_id) do update set attending = excluded.attending;
    end loop;

    -- zdravotní údaje zvlášť a jen pokud je pár zapnul; nepovinné, prázdné se neukládají
    if coalesce((v_flags ->> 'diet')::boolean, false) then
      v_diet := nullif(pg_catalog.btrim(coalesce(v_person ->> 'diet', '')), '');
      v_allergies := nullif(pg_catalog.btrim(coalesce(v_person ->> 'allergies', '')), '');
      if pg_catalog.char_length(coalesce(v_diet, '')) > 1000 or pg_catalog.char_length(coalesce(v_allergies, '')) > 1000 then
        raise exception 'invalid_payload' using errcode = '22023';
      end if;
      if v_diet is not null or v_allergies is not null then
        insert into public.rsvp_health (person_id, wedding_id, diet, allergies)
        values (v_person_id, p_wedding_id, v_diet, v_allergies);
      end if;
    end if;
  end loop;

  return v_response_id;
end
$$;

revoke all on function app.rsvp_apply(uuid, uuid, jsonb, text) from public, anon;

-- ---------------------------------------------------------------------------
-- rsvp_submit: zápis nebo úprava odpovědi domácnosti podle lístku z rsvp_match.
-- Pořadí kontrol: lístek, otevření RSVP, teprve potom obsah.
-- ---------------------------------------------------------------------------
create or replace function public.rsvp_submit(p_ticket text, p_payload jsonb) returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := app.wedding_id();
  v_household uuid := app.ticket_household(p_ticket);
  w public.weddings;
  v_response_id uuid;
begin
  if v_household is null then
    raise exception 'invalid_ticket' using errcode = '28000';
  end if;

  select * into w from public.weddings x where x.id = v_wedding_id and x.deleted_at is null;
  if not found or app.phase(w) is distinct from 'rsvp_open' then
    raise exception 'rsvp_closed' using errcode = '55000';
  end if;

  v_response_id := app.rsvp_apply(v_wedding_id, v_household, p_payload, 'guest');
  return jsonb_build_object('ok', true, 'response_id', v_response_id);
end
$$;

-- ---------------------------------------------------------------------------
-- rsvp_info: otevřenost RSVP a volby páru, které host potřebuje ještě před ověřením jména.
-- Neprozrazuje nic o hostech. Vrací null pro neveřejný web a nesprávnou roli.
-- ---------------------------------------------------------------------------
create function public.rsvp_info() returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := app.wedding_id();
  w public.weddings;
  v_phase text;
  v_settings public.rsvp_settings;
begin
  if v_wedding_id is null or app.wedding_role() not in ('visitor', 'guest_pin') then
    return null;
  end if;
  select * into w from public.weddings x where x.id = v_wedding_id and x.deleted_at is null;
  if not found then
    return null;
  end if;
  v_phase := app.phase(w);
  if v_phase is null then
    return null;
  end if;
  select * into v_settings from public.rsvp_settings s where s.wedding_id = v_wedding_id;
  return jsonb_build_object(
    'phase', v_phase,
    'open', v_phase = 'rsvp_open',
    'allow_unlisted', v_phase = 'rsvp_open' and coalesce(v_settings.allow_unlisted, false),
    'email_confirmation', coalesce(v_settings.email_confirmation, false),
    'closes_at', v_settings.closes_at
  );
end
$$;

-- ---------------------------------------------------------------------------
-- Host mimo seznam (FR-RSVP-7): formulář a zápis jen při zapnutém allow_unlisted.
-- Host není v seznamu, proto nemá pozvání: ptá se na všechny události s rsvp_enabled.
-- Odpověď nejde později upravit (nemá domácnost ani lístek); upozorní na to rozhraní.
-- ---------------------------------------------------------------------------
create function public.rsvp_unlisted_form() returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := app.wedding_id();
  w public.weddings;
  v_settings public.rsvp_settings;
begin
  if v_wedding_id is null or app.wedding_role() not in ('visitor', 'guest_pin') then
    return null;
  end if;
  select * into w from public.weddings x where x.id = v_wedding_id and x.deleted_at is null;
  if not found or app.phase(w) is distinct from 'rsvp_open' then
    return null;
  end if;
  select * into v_settings from public.rsvp_settings s where s.wedding_id = v_wedding_id;
  if not coalesce(v_settings.allow_unlisted, false) then
    return null;
  end if;

  return jsonb_build_object(
    'wedding', jsonb_build_object('timezone', w.timezone, 'default_locale', w.default_locale),
    'events', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'kind', e.kind, 'title', e.title, 'description', e.description,
        'starts_at', e.starts_at, 'ends_at', e.ends_at) order by e.position, e.starts_at), '[]'::jsonb)
        from public.events e where e.wedding_id = v_wedding_id and e.rsvp_enabled),
    'settings', jsonb_build_object('enabled_questions', v_settings.enabled_questions,
      'email_confirmation', v_settings.email_confirmation),
    'questions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', q.id, 'key', q.key, 'type', q.type, 'label', q.label, 'options', q.options,
        'required', q.required, 'event_id', q.event_id) order by q.position, q.key), '[]'::jsonb)
        from public.rsvp_questions q where q.wedding_id = v_wedding_id and q.enabled)
  );
end
$$;

create function public.rsvp_submit_unlisted(p_payload jsonb) returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := app.wedding_id();
  w public.weddings;
  v_settings public.rsvp_settings;
  v_response_id uuid;
begin
  if v_wedding_id is null or app.wedding_role() not in ('visitor', 'guest_pin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into w from public.weddings x where x.id = v_wedding_id and x.deleted_at is null;
  if not found or app.phase(w) is distinct from 'rsvp_open' then
    raise exception 'rsvp_closed' using errcode = '55000';
  end if;
  select * into v_settings from public.rsvp_settings s where s.wedding_id = v_wedding_id;
  if not coalesce(v_settings.allow_unlisted, false) then
    raise exception 'unlisted_not_allowed' using errcode = '42501';
  end if;

  v_response_id := app.rsvp_apply(v_wedding_id, null, p_payload, 'guest');
  return jsonb_build_object('ok', true, 'response_id', v_response_id);
end
$$;

-- ---------------------------------------------------------------------------
-- Správcovská strana (UI přijde v M7): seznam hostů a domácností, přehled RSVP, ruční zápis.
-- Volá server s JWT role admin; každá funkce vyžaduje app.is_wedding_admin() a filtruje podle
-- app.wedding_id(). Zdravotní údaje vrací jen admin_rsvp_household (pro předvyplnění zápisu).
-- ---------------------------------------------------------------------------
create function public.admin_guest_list() returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := app.wedding_id();
begin
  if not app.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'events', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'kind', e.kind, 'title', e.title, 'starts_at', e.starts_at,
        'rsvp_enabled', e.rsvp_enabled) order by e.position, e.starts_at), '[]'::jsonb)
        from public.events e where e.wedding_id = v_wedding_id),
    'households', (
      select coalesce(jsonb_agg(x.j order by x.label, x.created_at, x.id), '[]'::jsonb)
        from (
          select h.label, h.created_at, h.id, jsonb_build_object(
            'id', h.id, 'label', h.label, 'invited_note', h.invited_note,
            'guests', (
              select coalesce(jsonb_agg(jsonb_build_object(
                'id', g.id, 'display_name', g.display_name, 'is_child', g.is_child, 'age', g.age,
                'is_plus_one', g.is_plus_one, 'source', g.source,
                'invited_event_ids', (
                  select coalesce(jsonb_agg(i.event_id order by i.event_id), '[]'::jsonb)
                    from public.invitations i where i.guest_id = g.id and i.wedding_id = g.wedding_id),
                'attendance', (
                  select coalesce(jsonb_agg(jsonb_build_object('event_id', a.event_id, 'attending', a.attending)
                                            order by a.event_id), '[]'::jsonb)
                    from public.rsvp_people p
                    join public.rsvp_attendance a on a.person_id = p.id and a.wedding_id = p.wedding_id
                   where p.guest_id = g.id and p.wedding_id = g.wedding_id)
              ) order by g.created_at, g.id), '[]'::jsonb)
                from public.guests g where g.household_id = h.id and g.wedding_id = h.wedding_id),
            'response', (
              select jsonb_build_object(
                'id', r.id, 'submitted_at', r.submitted_at, 'last_edited_at', r.last_edited_at,
                'entered_by', r.entered_by, 'has_email', r.contact_email is not null,
                'attending', exists (
                  select 1 from public.rsvp_people p
                    join public.rsvp_attendance a on a.person_id = p.id and a.wedding_id = p.wedding_id
                   where p.response_id = r.id and p.wedding_id = r.wedding_id and a.attending))
                from public.rsvp_responses r
               where r.household_id = h.id and r.wedding_id = h.wedding_id)
          ) as j
          from public.households h where h.wedding_id = v_wedding_id
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
                from public.rsvp_attendance a where a.person_id = p.id and a.wedding_id = p.wedding_id))
            order by p.created_at, p.id), '[]'::jsonb)
            from public.rsvp_people p where p.response_id = r.id and p.wedding_id = r.wedding_id))
        order by r.submitted_at, r.id), '[]'::jsonb)
        from public.rsvp_responses r where r.wedding_id = v_wedding_id and r.household_id is null)
  );
end
$$;

create function public.admin_rsvp_overview() returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := app.wedding_id();
begin
  if not app.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'households', jsonb_build_object(
      'total', (select count(*) from public.households h where h.wedding_id = v_wedding_id),
      'answered', (select count(*) from public.households h where h.wedding_id = v_wedding_id
                    and exists (select 1 from public.rsvp_responses r
                                 where r.wedding_id = h.wedding_id and r.household_id = h.id)),
      'pending', (select count(*) from public.households h where h.wedding_id = v_wedding_id
                   and not exists (select 1 from public.rsvp_responses r
                                    where r.wedding_id = h.wedding_id and r.household_id = h.id))),
    'guests', jsonb_build_object(
      'total', (select count(*) from public.guests g where g.wedding_id = v_wedding_id),
      'children', (select count(*) from public.guests g where g.wedding_id = v_wedding_id and g.is_child)),
    'extra_people', jsonb_build_object(
      'plus_ones', (select count(*) from public.rsvp_people p
                     where p.wedding_id = v_wedding_id and p.is_plus_one),
      'unlisted', (select count(*) from public.rsvp_people p
                     join public.rsvp_responses r on r.id = p.response_id and r.wedding_id = p.wedding_id
                    where p.wedding_id = v_wedding_id and r.household_id is null),
      'added_children', (select count(*) from public.rsvp_people p
                          where p.wedding_id = v_wedding_id and p.guest_id is null and p.is_child
                            and exists (select 1 from public.rsvp_responses r
                                         where r.id = p.response_id and r.wedding_id = p.wedding_id
                                           and r.household_id is not null))),
    'events', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'event_id', e.id, 'kind', e.kind, 'title', e.title, 'starts_at', e.starts_at,
        'invited', (select count(*) from public.invitations i
                     where i.event_id = e.id and i.wedding_id = e.wedding_id),
        -- účast se počítá po hlavách: i doprovod, děti doplněné při RSVP a hosté mimo seznam
        'attending', (select count(*) from public.rsvp_attendance a
                       where a.event_id = e.id and a.wedding_id = e.wedding_id and a.attending),
        'declined', (select count(*) from public.rsvp_attendance a
                      where a.event_id = e.id and a.wedding_id = e.wedding_id and not a.attending),
        'attending_extra', (select count(*) from public.rsvp_attendance a
                             join public.rsvp_people p on p.id = a.person_id and p.wedding_id = a.wedding_id
                            where a.event_id = e.id and a.wedding_id = e.wedding_id
                              and a.attending and p.guest_id is null),
        -- pozvaní, kteří na událost zatím neodpověděli
        'pending', (select count(*) from public.invitations i
                     where i.event_id = e.id and i.wedding_id = e.wedding_id
                       and not exists (
                         select 1 from public.rsvp_people p
                           join public.rsvp_attendance a on a.person_id = p.id and a.wedding_id = p.wedding_id
                          where p.guest_id = i.guest_id and p.wedding_id = i.wedding_id
                            and a.event_id = i.event_id))
      ) order by e.position, e.starts_at), '[]'::jsonb)
        from public.events e where e.wedding_id = v_wedding_id and e.rsvp_enabled)
  );
end
$$;

create function public.admin_rsvp_household(p_household_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
begin
  if not app.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.households h
                  where h.id = p_household_id and h.wedding_id = app.wedding_id()) then
    return null;
  end if;
  return app.rsvp_household_view(p_household_id);
end
$$;

-- Ruční zápis odpovědi domácnosti (host odpověděl telefonem, FR-ADM-5). Nezávisí na otevření RSVP
-- (pozdní telefonát po uzavření je běžný), povinné otázky se nevynucují, e-mail se neukládá.
-- Zápis se eviduje v audit_log bez osobních údajů (jen identifikátor domácnosti).
create function public.admin_rsvp_enter(p_household_id uuid, p_payload jsonb) returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := app.wedding_id();
  v_response_id uuid;
begin
  if not app.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from public.weddings w where w.id = v_wedding_id and w.deleted_at is null)
     or not exists (select 1 from public.households h
                     where h.id = p_household_id and h.wedding_id = v_wedding_id) then
    raise exception 'household_not_found' using errcode = 'P0002';
  end if;

  v_response_id := app.rsvp_apply(v_wedding_id, p_household_id, p_payload, 'admin');
  perform app.write_audit('admin', auth.uid(), v_wedding_id, 'rsvp.manual_entry', 'household',
                          p_household_id, null, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'response_id', v_response_id);
end
$$;

-- ---------------------------------------------------------------------------
-- Analytika bez identifikátorů (ADR 0007): jen server (service role), uzavřený seznam událostí
-- hlídá kontrolní omezení tabulky. Svatba, jména ani odpovědi se nepředávají.
-- ---------------------------------------------------------------------------
create function public.analytics_record(
  p_event text,
  p_locale text default null,
  p_template text default null,
  p_step smallint default null
) returns void
  language sql volatile security definer set search_path = ''
  as $$
  insert into public.analytics_event (event, locale, template, step)
  values (p_event, p_locale, p_template, p_step)
$$;

revoke all on function
  public.rsvp_info(), public.rsvp_unlisted_form(), public.rsvp_submit_unlisted(jsonb),
  public.admin_guest_list(), public.admin_rsvp_overview(), public.admin_rsvp_household(uuid),
  public.admin_rsvp_enter(uuid, jsonb), public.analytics_record(text, text, text, smallint)
  from public, anon;
revoke all on function public.rsvp_match(text), public.rsvp_get(text), public.rsvp_submit(text, jsonb)
  from public, anon;

grant execute on function
  public.rsvp_info(), public.rsvp_unlisted_form(), public.rsvp_submit_unlisted(jsonb),
  public.admin_guest_list(), public.admin_rsvp_overview(), public.admin_rsvp_household(uuid),
  public.admin_rsvp_enter(uuid, jsonb)
  to authenticated;
grant execute on function public.rsvp_match(text), public.rsvp_get(text), public.rsvp_submit(text, jsonb)
  to authenticated;
grant execute on function public.analytics_record(text, text, text, smallint) to service_role;
