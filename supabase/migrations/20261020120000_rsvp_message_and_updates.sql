-- Vzkaz pro novomanžele a upozornění hostů na změny (docs/plan-funkci-2026-10.md, fáze 1).
--
-- 1. Vestavěná otázka „message“: volný text do 1000 znaků v `rsvp_responses.answers`, zapíná ji pár
--    (příznak `message` v `enabled_questions`). Vzkazy čte správce přes `admin_rsvp_messages`.
-- 2. Upozornění na změny: host v odpovědi zadá e-mail (a volitelně telefon) se souhlasem, že mu pár
--    pošle zprávu, když se něco změní. Údaje jsou ve vlastní tabulce `rsvp_updates` (ne v `answers`
--    ani v `contact_email`, které má jiný účel a jiná pravidla), mažou se spolu s odpovědí (kaskáda,
--    retence hostů). Souhlas dává jen host sám (`entered_by = 'guest'`); správce ho za hosta zapsat
--    nemůže. Každý záznam má náhodný token pro odhlášení jedním kliknutím z e-mailu.
--
-- Migrace jen přidává (tabulku, sloupec typu e-mailu, funkce) a nahrazuje `rsvp_apply`,
-- `admin_rsvp_settings_save` a `rsvp_get` zpětně kompatibilně: starý kód payload `updates` ani příznaky
-- `message` a `updates` nepošle, takže se chová jako dosud.

create table se_vezmou.rsvp_updates (
  wedding_id uuid not null references se_vezmou.weddings (id) on delete cascade,
  response_id uuid not null,
  email extensions.citext not null check (char_length(email::text) <= 254),
  phone text check (phone is null or phone ~ '^\+?[0-9 ()-]{6,30}$'),
  locale text not null check (locale in ('cs', 'en')),
  -- odhlášení jedním kliknutím z e-mailu; token nic jiného neumí
  unsubscribe_token text not null unique default pg_catalog.encode(extensions.gen_random_bytes(18), 'hex'),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (wedding_id, response_id),
  foreign key (wedding_id, response_id) references se_vezmou.rsvp_responses (wedding_id, id)
    on delete cascade
);

-- přístup jen přes funkce security definer (žádné politiky, žádná práva rolím)
alter table se_vezmou.rsvp_updates enable row level security;
revoke all on se_vezmou.rsvp_updates from public, anon, authenticated, service_role;

alter table se_vezmou.email_log drop constraint email_log_type_check;
alter table se_vezmou.email_log add constraint email_log_type_check
  check (type in ('login_code', 'rsvp_confirmation', 'admin_changed', 'backup_login_notice', 'expiry_notice',
                  'deletion_notice', 'operator_notice', 'waitlist_confirm', 'rsvp_notice', 'guest_update'));

-- ---------------------------------------------------------------------------
-- rsvp_apply: navíc vzkaz („message“) a upozornění na změny (payload `updates`):
--   { "action": "set", "email": text, "phone": text|null, "locale": "cs"|"en" }  přihlásit / změnit
--   { "action": "remove" }                                                    odhlásit
--   chybí nebo jiná akce                                                       beze změny
-- ---------------------------------------------------------------------------
create or replace function se_vezmou.rsvp_apply(
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
  v_settings se_vezmou.rsvp_settings;
  v_flags jsonb;
  v_person jsonb;
  v_att jsonb;
  v_guest_id uuid;
  v_guest se_vezmou.guests;
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
  v_question se_vezmou.rsvp_questions;
  v_value jsonb;
  v_text text;
  v_updates jsonb;
  v_upd_email text;
  v_upd_phone text;
  v_upd_locale text;
begin
  v_max_people := case when v_unlisted then c_max_unlisted else c_max_people end;
  select * into v_settings from se_vezmou.rsvp_settings s where s.wedding_id = p_wedding_id;
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
    v_guest_id := se_vezmou.try_uuid(v_person ->> 'guest_id');
    if nullif(v_person ->> 'guest_id', '') is not null and v_guest_id is null then
      raise exception 'invalid_payload' using errcode = '22023';
    end if;
    v_is_child := coalesce(v_person -> 'is_child' = 'true'::jsonb, false);

    if v_guest_id is not null then
      if v_unlisted or not exists (
           select 1 from se_vezmou.guests g
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
      v_event_id := se_vezmou.try_uuid(v_att ->> 'event_id');
      if v_event_id is null or jsonb_typeof(v_att -> 'attending') is distinct from 'boolean' then
        raise exception 'invalid_payload' using errcode = '22023';
      end if;
      if v_unlisted then
        if not exists (select 1 from se_vezmou.events e
                        where e.id = v_event_id and e.wedding_id = p_wedding_id and e.rsvp_enabled) then
          raise exception 'event_not_invited' using errcode = '42501';
        end if;
      elsif not exists (
        select 1
          from se_vezmou.invitations i
          join se_vezmou.guests g on g.id = i.guest_id and g.wedding_id = i.wedding_id
          join se_vezmou.events e on e.id = i.event_id and e.wedding_id = i.wedding_id
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
  -- vzkaz pro novomanžele (vestavěná otázka „message“, do 1000 znaků)
  if v_answers ? 'message' then
    if coalesce((v_flags ->> 'message')::boolean, false) is not true then
      v_answers := v_answers - 'message';
    elsif jsonb_typeof(v_answers -> 'message') is distinct from 'string'
          or pg_catalog.char_length(v_answers ->> 'message') > 1000 then
      raise exception 'invalid_payload' using errcode = '22023';
    elsif pg_catalog.btrim(v_answers ->> 'message') = '' then
      v_answers := v_answers - 'message';
    else
      v_answers := jsonb_set(v_answers, '{message}', to_jsonb(pg_catalog.btrim(v_answers ->> 'message')));
    end if;
  end if;

  -- upozornění na změny: jen od hosta samotného (souhlas dává on), jen při zapnuté volbě páru;
  -- ověří se tady, zapíše až po uložení odpovědi
  v_updates := p_payload -> 'updates';
  if v_updates is not null and jsonb_typeof(v_updates) = 'object'
     and coalesce((v_flags ->> 'updates')::boolean, false) and p_entered_by = 'guest'
     and v_updates ->> 'action' = 'set' then
    v_upd_email := pg_catalog.btrim(coalesce(v_updates ->> 'email', ''));
    v_upd_phone := nullif(pg_catalog.btrim(coalesce(v_updates ->> 'phone', '')), '');
    v_upd_locale := coalesce(v_updates ->> 'locale', '');
    if v_upd_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or pg_catalog.length(v_upd_email) > 254
       or (v_upd_phone is not null and v_upd_phone !~ '^\+?[0-9 ()-]{6,30}$')
       or v_upd_locale not in ('cs', 'en') then
      raise exception 'invalid_payload' using errcode = '22023';
    end if;
  end if;

  for v_question in
    select * from se_vezmou.rsvp_questions q where q.wedding_id = p_wedding_id and q.enabled
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
    insert into se_vezmou.rsvp_responses (wedding_id, household_id, answers, contact_email, entered_by)
    values (p_wedding_id, null, v_answers, v_email::extensions.citext, p_entered_by)
    returning id into v_response_id;
  else
    insert into se_vezmou.rsvp_responses as r (wedding_id, household_id, answers, contact_email, entered_by)
    values (p_wedding_id, p_household, v_answers, v_email::extensions.citext, p_entered_by)
    on conflict (wedding_id, household_id) where household_id is not null
    do update set answers = excluded.answers, contact_email = excluded.contact_email,
                  entered_by = excluded.entered_by, last_edited_at = pg_catalog.now()
    returning r.id into v_response_id;

    delete from se_vezmou.rsvp_people p where p.wedding_id = p_wedding_id and p.response_id = v_response_id;
  end if;

  for v_person in select * from jsonb_array_elements(p_payload -> 'people') loop
    v_guest_id := se_vezmou.try_uuid(v_person ->> 'guest_id');
    v_is_child := coalesce(v_person -> 'is_child' = 'true'::jsonb, false);
    if v_guest_id is not null then
      select * into v_guest from se_vezmou.guests g where g.id = v_guest_id and g.wedding_id = p_wedding_id;
      v_name := v_guest.display_name;
      v_is_child := v_guest.is_child;
      v_age := v_guest.age;
    else
      v_name := pg_catalog.btrim(v_person ->> 'person_name');
      v_age := case when v_is_child then (v_person ->> 'age')::smallint end;
    end if;

    -- clock_timestamp: osoby jedné odpovědi si drží pořadí z payloadu (now() je v transakci stejné)
    insert into se_vezmou.rsvp_people (wedding_id, response_id, guest_id, person_name, is_plus_one, is_child, age, created_at)
    values (p_wedding_id, v_response_id, v_guest_id, v_name,
            v_guest_id is null and not v_unlisted and not v_is_child, v_is_child, v_age,
            pg_catalog.clock_timestamp())
    returning id into v_person_id;

    for v_att in select * from jsonb_array_elements(coalesce(v_person -> 'attendance', '[]'::jsonb)) loop
      insert into se_vezmou.rsvp_attendance (wedding_id, person_id, event_id, attending)
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
        insert into se_vezmou.rsvp_health (person_id, wedding_id, diet, allergies)
        values (v_person_id, p_wedding_id, v_diet, v_allergies);
      end if;
    end if;
  end loop;

  -- 4. upozornění na změny (tabulka rsvp_updates, maže se spolu s odpovědí)
  if v_updates is not null and jsonb_typeof(v_updates) = 'object'
     and coalesce((v_flags ->> 'updates')::boolean, false) and p_entered_by = 'guest' then
    if v_updates ->> 'action' = 'set' then
      insert into se_vezmou.rsvp_updates as u (wedding_id, response_id, email, phone, locale)
      values (p_wedding_id, v_response_id, v_upd_email::extensions.citext, v_upd_phone, v_upd_locale)
      on conflict (wedding_id, response_id) do update
        set email = excluded.email, phone = excluded.phone, locale = excluded.locale,
            updated_at = pg_catalog.now();
    elsif v_updates ->> 'action' = 'remove' then
      delete from se_vezmou.rsvp_updates u
       where u.wedding_id = p_wedding_id and u.response_id = v_response_id;
    end if;
  end if;

  return v_response_id;
end
$$;

-- ---------------------------------------------------------------------------
-- admin_rsvp_settings_save: příznaky `message` a `updates`; klíče jsou vyhrazené pro vestavěné otázky
-- ---------------------------------------------------------------------------
create or replace function se_vezmou.admin_rsvp_settings_save(p_payload jsonb) returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  c_max_questions constant integer := 10;
  c_flags constant text[] := array['plus_one', 'children', 'diet', 'lodging', 'transport', 'song',
    'message', 'updates'];
  c_reserved constant text[] := array['plus_one', 'children', 'diet', 'allergies', 'lodging',
    'transport', 'song', 'contact_email', 'answers', 'people', 'message', 'updates'];
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
  v_ids jsonb := '[]'::jsonb;
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
    select q.key into v_key from se_vezmou.rsvp_questions q where q.id = v_id;
    v_ids := v_ids || jsonb_build_object('key', v_key, 'id', v_id);
  end loop;

  delete from se_vezmou.rsvp_questions q
   where q.wedding_id = v_wedding_id and not (q.id = any (v_kept));

  perform se_vezmou.write_audit('admin', se_vezmou.actor_id(), v_wedding_id, 'rsvp.settings_save',
    'wedding', v_wedding_id, null,
    jsonb_build_object('questions', v_position, 'allow_unlisted', (p_payload ->> 'allow_unlisted')::boolean));
  -- identifikátory otázek (nové dostanou id při uložení), aby další uložení otázky upravilo, ne založilo znovu
  return v_ids;
end
$$;

-- ---------------------------------------------------------------------------
-- rsvp_guest_household_view: pohled hosta (bez zdraví a e-mailu) navíc s příznakem `has_updates`; adresu ani
-- telefon z upozornění host nikdy nedostane. Společný pro lístek (rsvp_get) i kód domácnosti (rsvp_invite_get).
-- ---------------------------------------------------------------------------
create function se_vezmou.rsvp_guest_household_view(p_household uuid) returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_view jsonb := se_vezmou.rsvp_guest_view(se_vezmou.rsvp_household_view(p_household));
begin
  if pg_catalog.jsonb_typeof(v_view -> 'response') = 'object' then
    v_view := pg_catalog.jsonb_set(v_view, '{response,has_updates}', pg_catalog.to_jsonb(exists (
      select 1 from se_vezmou.rsvp_updates u
        join se_vezmou.rsvp_responses r on r.wedding_id = u.wedding_id and r.id = u.response_id
       where r.wedding_id = se_vezmou.wedding_id() and r.household_id = p_household)));
  end if;
  return v_view;
end
$$;

revoke all on function se_vezmou.rsvp_guest_household_view(uuid) from public, anon, authenticated, service_role;

create or replace function se_vezmou.rsvp_get(p_ticket text) returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_household uuid := se_vezmou.ticket_household(p_ticket);
begin
  if v_household is null then
    return null;
  end if;
  return se_vezmou.rsvp_guest_household_view(v_household);
end
$$;

create or replace function se_vezmou.rsvp_invite_get(p_code text) returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_household uuid := se_vezmou.invite_household(p_code);
  w se_vezmou.weddings;
begin
  if v_household is null then
    return null;
  end if;
  select * into w from se_vezmou.weddings x where x.id = se_vezmou.wedding_id();
  if se_vezmou.phase(w) is distinct from 'rsvp_open' then
    return null;
  end if;
  return se_vezmou.rsvp_guest_household_view(v_household);
end
$$;

-- ---------------------------------------------------------------------------
-- admin_rsvp_messages: vzkazy hostů pro správce (nejnovější první)
-- ---------------------------------------------------------------------------
create function se_vezmou.admin_rsvp_messages() returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'household_id', r.household_id,
             'label', h.label,
             'names', (select coalesce(pg_catalog.jsonb_agg(p.person_name order by p.created_at, p.id), '[]'::jsonb)
                         from se_vezmou.rsvp_people p
                        where p.wedding_id = r.wedding_id and p.response_id = r.id),
             'message', r.answers ->> 'message',
             'at', r.last_edited_at)
           order by r.last_edited_at desc, r.id), '[]'::jsonb)
      from se_vezmou.rsvp_responses r
      left join se_vezmou.households h on h.wedding_id = r.wedding_id and h.id = r.household_id
     where r.wedding_id = v_wedding_id
       and pg_catalog.btrim(coalesce(r.answers ->> 'message', '')) <> ''
  );
end
$$;

-- ---------------------------------------------------------------------------
-- admin_rsvp_updates: kdo chce upozornění na změny (pro správce: jména, e-mail, telefon, jazyk)
-- ---------------------------------------------------------------------------
create function se_vezmou.admin_rsvp_updates() returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'household_id', r.household_id,
             'label', h.label,
             'names', (select coalesce(pg_catalog.jsonb_agg(p.person_name order by p.created_at, p.id), '[]'::jsonb)
                         from se_vezmou.rsvp_people p
                        where p.wedding_id = r.wedding_id and p.response_id = r.id),
             'email', u.email::text,
             'phone', u.phone,
             'locale', u.locale,
             'since', u.created_at)
           order by u.created_at, u.response_id), '[]'::jsonb)
      from se_vezmou.rsvp_updates u
      join se_vezmou.rsvp_responses r on r.wedding_id = u.wedding_id and r.id = u.response_id
      left join se_vezmou.households h on h.wedding_id = r.wedding_id and h.id = r.household_id
     where u.wedding_id = v_wedding_id
  );
end
$$;

-- ---------------------------------------------------------------------------
-- admin_rsvp_updates_recipients: adresy k odeslání upozornění (jen server, s tokenem pro odhlášení)
-- Zapíše audit odeslání (počet, ne adresy).
-- ---------------------------------------------------------------------------
create function se_vezmou.admin_rsvp_updates_recipients()
  returns table (email text, locale text, unsubscribe_token text)
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
  v_count integer;
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select count(*) into v_count from se_vezmou.rsvp_updates u where u.wedding_id = v_wedding_id;
  perform se_vezmou.write_audit('admin', se_vezmou.actor_id(), v_wedding_id, 'rsvp.updates_sent',
    'wedding', v_wedding_id, null, pg_catalog.jsonb_build_object('recipients', v_count));
  return query
    select u.email::text, u.locale, u.unsubscribe_token
      from se_vezmou.rsvp_updates u
     where u.wedding_id = v_wedding_id
     order by u.created_at, u.response_id;
end
$$;

-- ---------------------------------------------------------------------------
-- rsvp_updates_unsubscribe: odhlášení z odkazu v e-mailu (service role, host bez přihlášení)
-- Vrací true, když se záznam smazal; neznámý token je false (neprozrazuje nic dalšího).
-- ---------------------------------------------------------------------------
create function se_vezmou.rsvp_updates_unsubscribe(p_token text) returns boolean
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_deleted integer;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{36}$' then
    return false;
  end if;
  delete from se_vezmou.rsvp_updates u where u.unsubscribe_token = p_token;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end
$$;

revoke all on function
  se_vezmou.admin_rsvp_messages(),
  se_vezmou.admin_rsvp_updates(),
  se_vezmou.admin_rsvp_updates_recipients(),
  se_vezmou.rsvp_updates_unsubscribe(text)
  from public, anon, authenticated, service_role;
grant execute on function
  se_vezmou.admin_rsvp_messages(),
  se_vezmou.admin_rsvp_updates(),
  se_vezmou.admin_rsvp_updates_recipients()
  to authenticated;
grant execute on function se_vezmou.rsvp_updates_unsubscribe(text) to service_role;
