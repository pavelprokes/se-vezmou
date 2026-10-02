-- Slepé RSVP (rsvp_match, rsvp_get, rsvp_submit), odvozená fáze a get_public_site
-- (data-model.md kap. 12 bod 5, kap. 5.5, kap. 7).
begin;
select tap.seed();

-- ---------------------------------------------------------------------------
-- rsvp_match: jedna odpověď stejného tvaru, žádný seznam, žádný rozdíl neshoda / více shod
-- ---------------------------------------------------------------------------
do $$
declare
  v_ticket text;
begin
  perform tap.become('authenticated', tap.wa(), 'visitor');

  select ticket into v_ticket from public.rsvp_match('Jan Novák');
  perform tap.ok(v_ticket is not null and length(v_ticket) >= 64, 'přesné jméno vydá lístek');
  perform tap.ok(exists (select 1 from public.rsvp_match('Novák Jan') where ticket is not null), 'pořadí jména nehraje roli');
  perform tap.ok(exists (select 1 from public.rsvp_match('  JAN   NOVAK ') where ticket is not null), 'diakritika, velikost písmen a mezery nehrají roli');
  perform tap.ok(exists (select 1 from public.rsvp_match('Jan Novak.') where ticket is not null), 'interpunkce nehraje roli');
  perform tap.ok(exists (select 1 from public.rsvp_match('Jan Novakk') where ticket is not null), 'drobný překlep se toleruje');

  -- žádná shoda, jméno z cizí svatby, příliš krátký vstup: stejný tvar (jeden řádek, ticket null)
  perform tap.eq((select count(*) from public.rsvp_match('Karel Neznámý')), 1, 'neshoda vrací přesně jeden řádek');
  perform tap.ok((select ticket from public.rsvp_match('Karel Neznámý')) is null, 'neshoda: ticket je null');
  perform tap.ok((select ticket from public.rsvp_match('Petr Svoboda')) is null, 'host svatby B se ve svatbě A nenajde');
  perform tap.ok((select ticket from public.rsvp_match('')) is null, 'prázdný vstup: ticket je null');
  perform tap.ok((select ticket from public.rsvp_match(null)) is null, 'null vstup: ticket je null');
  perform tap.ok((select ticket from public.rsvp_match('x')) is null, 'jednoznakový vstup: ticket je null');
  perform tap.reset();
end
$$;

-- Nejednoznačnost: dvě domácnosti se stejným jménem dají odpověď shodnou s neshodou
do $$
declare
  v_shape_none text;
  v_shape_many text;
begin
  insert into public.households (id, wedding_id, label) values (tap.u('A:household2'), tap.wa(), 'Druzí Novákovi');
  insert into public.guests (id, wedding_id, household_id, display_name)
  values (tap.u('A:guest3'), tap.wa(), tap.u('A:household2'), 'Jan Novák');

  perform tap.become('authenticated', tap.wa(), 'visitor');
  select row_to_json(x)::text into v_shape_many from (select ticket from public.rsvp_match('Jan Novák')) x;
  select row_to_json(x)::text into v_shape_none from (select ticket from public.rsvp_match('Zdeněk Nikdo')) x;
  perform tap.ok(v_shape_many = v_shape_none and v_shape_none = '{"ticket":null}',
    'více shod a žádná shoda mají identický tvar odpovědi: ' || v_shape_many);
  -- jednoznačné jméno ve stejné svatbě funguje dál
  perform tap.ok((select ticket from public.rsvp_match('Marie Nováková')) is not null, 'jednoznačné jméno dál vydá lístek');
  perform tap.reset();

  delete from public.guests where id = tap.u('A:guest3');
  delete from public.households where id = tap.u('A:household2');
end
$$;

-- Role: správce a nepodepsaná role nevydají lístek, lístek jedné svatby neplatí v druhé
do $$
declare
  v_ticket text;
begin
  perform tap.become('authenticated', tap.wa(), 'visitor');
  select ticket into v_ticket from public.rsvp_match('Jan Novák');
  perform tap.reset();

  perform tap.become('authenticated', tap.wa(), 'admin');
  perform tap.ok((select ticket from public.rsvp_match('Jan Novák')) is null, 'správce nevydá lístek přes rsvp_match');
  perform tap.ok(public.rsvp_get(v_ticket) is null, 'správce nečte odpověď přes rsvp_get');
  perform tap.reset();

  perform tap.become('authenticated', tap.wb(), 'visitor');
  perform tap.ok(public.rsvp_get(v_ticket) is null, 'lístek svatby A neplatí ve svatbě B');
  perform tap.throws(format('select public.rsvp_submit(%L, ''{"people": []}'')', v_ticket), 'invalid_ticket', 'lístek svatby A nepovolí zápis ve svatbě B');
  perform tap.reset();

  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.ok(public.rsvp_get('nesmysl') is null, 'neplatný lístek nevrací nic');
  perform tap.ok(public.rsvp_get(null) is null, 'chybějící lístek nevrací nic');
  perform tap.throws('select public.rsvp_submit(''nesmysl'', ''{"people": []}'')', 'invalid_ticket', 'neplatný lístek nepovolí zápis');
  perform tap.reset();

  -- prošlý lístek
  update public.rsvp_tickets set expires_at = now() - interval '1 second' where wedding_id = tap.wa();
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.ok(public.rsvp_get(v_ticket) is null, 'prošlý lístek nevrací nic');
  perform tap.reset();
end
$$;

-- rsvp_get: jen vlastní domácnost, jen pozvané události
do $$
declare
  v_ticket text;
  v_data jsonb;
begin
  perform tap.become('authenticated', tap.wa(), 'visitor');
  select ticket into v_ticket from public.rsvp_match('Marie Nováková');
  v_data := public.rsvp_get(v_ticket);
  perform tap.reset();

  perform tap.eq(jsonb_array_length(v_data -> 'guests'), 2, 'rsvp_get vrací členy domácnosti');
  perform tap.eq(jsonb_array_length(v_data -> 'events'), 2, 'rsvp_get vrací pozvané události');
  perform tap.ok(not (v_data::text like '%Svoboda%'), 'rsvp_get neobsahuje hosty jiné svatby');
  perform tap.ok(not (v_data::text like '%Rodina A%'), 'rsvp_get neprozrazuje popisek domácnosti (jen pro správce)');
  perform tap.ok(v_data #>> '{response,people,0,diet}' = 'vegetariánská', 'rsvp_get vrací dřívější odpověď domácnosti včetně diety');
end
$$;

-- rsvp_submit: úspěšný zápis, nahrazení odpovědi, kontrola pozvání a hostů
do $$
declare
  v_ticket text;
  v_result jsonb;
  v_payload jsonb;
  g1 uuid := tap.u('A:guest1');
  g2 uuid := tap.u('A:guest2');
  e1 uuid := tap.u('A:event1');
  e2 uuid := tap.u('A:event2');
begin
  perform tap.become('authenticated', tap.wa(), 'visitor');
  select ticket into v_ticket from public.rsvp_match('Jan Novák');

  -- host g2 není pozván na event2
  v_payload := jsonb_build_object('answers', '{"ubytovani": false}'::jsonb, 'people', jsonb_build_array(
    jsonb_build_object('guest_id', g1, 'attendance', jsonb_build_array(
      jsonb_build_object('event_id', e1, 'attending', true), jsonb_build_object('event_id', e2, 'attending', true)),
      'diet', 'vegan', 'allergies', 'laktóza'),
    jsonb_build_object('guest_id', g2, 'attendance', jsonb_build_array(
      jsonb_build_object('event_id', e1, 'attending', true), jsonb_build_object('event_id', e2, 'attending', true)))));
  perform tap.throws(format('select public.rsvp_submit(%L, %L::jsonb)', v_ticket, v_payload::text), 'event_not_invited',
    'host nemůže odpovědět na událost, na kterou není pozván');

  -- host z jiné domácnosti / jiné svatby
  perform tap.throws(format('select public.rsvp_submit(%L, %L::jsonb)', v_ticket,
      jsonb_build_object('people', jsonb_build_array(jsonb_build_object('guest_id', tap.u('B:guest1'), 'attendance', '[]'::jsonb)))::text),
    'invalid_guest', 'lístek neumožní odpovídat za hosta jiné svatby');

  -- platná odpověď
  v_payload := jsonb_build_object('answers', '{"ubytovani": false}'::jsonb, 'contact_email', 'jan@example.test', 'people', jsonb_build_array(
    jsonb_build_object('guest_id', g1, 'attendance', jsonb_build_array(
      jsonb_build_object('event_id', e1, 'attending', true), jsonb_build_object('event_id', e2, 'attending', true)),
      'diet', 'vegan', 'allergies', 'laktóza'),
    jsonb_build_object('guest_id', g2, 'attendance', jsonb_build_array(
      jsonb_build_object('event_id', e1, 'attending', false)))));
  v_result := public.rsvp_submit(v_ticket, v_payload);
  perform tap.reset();

  perform tap.ok((v_result ->> 'ok')::boolean, 'platná odpověď se uloží');
  perform tap.eq((select count(*) from public.rsvp_responses where wedding_id = tap.wa()), 1, 'jedna odpověď na domácnost (původní se upravila)');
  perform tap.eq((select count(*) from public.rsvp_people where wedding_id = tap.wa()), 2, 'osoby odpovědi se nahradily novými');
  perform tap.eq((select count(*) from public.rsvp_attendance where wedding_id = tap.wa()), 3, 'účast na událostech je zapsaná');
  perform tap.ok((select diet from public.rsvp_health where wedding_id = tap.wa()) = 'vegan', 'dieta je uložena zvlášť a nahrazena novou');
  perform tap.eq((select count(*) from public.rsvp_health where wedding_id = tap.wa()), 1, 'zdravotní údaje má jen host, který je zadal');
  perform tap.ok((select contact_email from public.rsvp_responses where wedding_id = tap.wa()) is null,
    'e-mail se neuloží, když potvrzení e-mailem není zapnuto');
  perform tap.eq((select count(*) from public.rsvp_responses where wedding_id = tap.wb()), 1, 'odpověď svatby B se nezměnila');
  perform tap.ok((select answers from public.rsvp_responses where wedding_id = tap.wa()) = '{"ubytovani": false}', 'odpovědi jsou zapsány bez zdravotních údajů');

  -- stejný lístek znovu: úprava, ne duplicita
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform public.rsvp_submit(v_ticket, jsonb_build_object('people', jsonb_build_array(
    jsonb_build_object('guest_id', g1, 'attendance', jsonb_build_array(jsonb_build_object('event_id', e1, 'attending', false))))));
  perform tap.reset();
  perform tap.eq((select count(*) from public.rsvp_responses where wedding_id = tap.wa()), 1, 'úprava nevytvoří druhou odpověď');
  perform tap.eq((select count(*) from public.rsvp_people where wedding_id = tap.wa()), 1, 'úprava nahradila osoby');
  perform tap.eq((select count(*) from public.rsvp_health where wedding_id = tap.wa()), 0, 'úprava bez diety smazala dřívější dietu');
end
$$;

-- Potvrzení e-mailem a doprovod podle nastavení; neplatné vstupy
do $$
declare
  v_ticket text;
  g1 uuid := tap.u('A:guest1');
  e1 uuid := tap.u('A:event1');
  v_att jsonb := jsonb_build_array(jsonb_build_object('event_id', tap.u('A:event1'), 'attending', true));
begin
  update public.rsvp_settings set email_confirmation = true where wedding_id = tap.wa();
  perform tap.become('authenticated', tap.wa(), 'visitor');
  select ticket into v_ticket from public.rsvp_match('Jan Novák');
  perform public.rsvp_submit(v_ticket, jsonb_build_object('contact_email', 'jan@example.test',
    'people', jsonb_build_array(jsonb_build_object('guest_id', g1, 'attendance', v_att))));
  perform tap.reset();
  perform tap.ok((select contact_email from public.rsvp_responses where wedding_id = tap.wa()) = 'jan@example.test',
    'e-mail se uloží při zapnutém potvrzení');

  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.throws(format('select public.rsvp_submit(%L, %L::jsonb)', v_ticket,
    jsonb_build_object('contact_email', 'neni-email', 'people', jsonb_build_array(jsonb_build_object('guest_id', g1)))::text),
    'invalid_payload', 'neplatný e-mail se odmítne');
  perform tap.throws(format('select public.rsvp_submit(%L, ''{"people": []}'')', v_ticket), 'invalid_payload', 'prázdný seznam osob se odmítne');
  perform tap.throws(format('select public.rsvp_submit(%L, ''[]'')', v_ticket), 'invalid_payload', 'payload, který není objekt, se odmítne');
  perform tap.throws(format('select public.rsvp_submit(%L, null)', v_ticket), 'invalid_payload', 'chybějící payload se odmítne');
  perform tap.throws(format('select public.rsvp_submit(%L, %L::jsonb)', v_ticket,
    jsonb_build_object('people', jsonb_build_array(jsonb_build_object('guest_id', g1, 'attendance',
      jsonb_build_array(jsonb_build_object('event_id', e1, 'attending', 'ano')))))::text),
    'invalid_payload', 'attending musí být boolean');

  -- doprovod (plus jedna)
  perform public.rsvp_submit(v_ticket, jsonb_build_object('people', jsonb_build_array(
    jsonb_build_object('guest_id', g1, 'attendance', v_att),
    jsonb_build_object('guest_id', null, 'person_name', 'Doprovod Hosta', 'attendance', v_att))));
  perform tap.reset();
  perform tap.ok(exists (select 1 from public.rsvp_people where wedding_id = tap.wa() and is_plus_one and guest_id is null and person_name = 'Doprovod Hosta'),
    'doprovod se zapíše jako osoba bez guest_id');

  update public.rsvp_settings set enabled_questions = '{"plus_one": false, "diet": false}' where wedding_id = tap.wa();
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.throws(format('select public.rsvp_submit(%L, %L::jsonb)', v_ticket,
    jsonb_build_object('people', jsonb_build_array(jsonb_build_object('guest_id', null, 'person_name', 'Doprovod', 'attendance', v_att)))::text),
    'plus_one_not_allowed', 'doprovod se odmítne, když ho pár nepovolil');
  perform public.rsvp_submit(v_ticket, jsonb_build_object('people', jsonb_build_array(
    jsonb_build_object('guest_id', g1, 'attendance', v_att, 'diet', 'vegan'))));
  perform tap.reset();
  perform tap.eq((select count(*) from public.rsvp_health where wedding_id = tap.wa()), 0, 'dieta se neuloží, když ji pár nezapnul');
end
$$;

-- Uzavřené, nezahájené a skončené RSVP
do $$
declare
  v_ticket text;
  v_payload jsonb := jsonb_build_object('people', jsonb_build_array(jsonb_build_object('guest_id', tap.u('A:guest1'))));
  v_state text;
begin
  perform tap.become('authenticated', tap.wa(), 'visitor');
  select ticket into v_ticket from public.rsvp_match('Jan Novák');
  perform tap.reset();

  foreach v_state in array array['zavreno', 'nezahajeno', 'po_svatbe', 'override', 'nezverejneno', 'zablokovano'] loop
    update public.rsvp_settings set opens_at = null, closes_at = null where wedding_id = tap.wa();
    update public.weddings set starts_on = current_date + 200, phase_override = null where id = tap.wa();
    if v_state = 'zavreno' then
      update public.rsvp_settings set closes_at = now() - interval '1 minute' where wedding_id = tap.wa();
    elsif v_state = 'nezahajeno' then
      update public.rsvp_settings set opens_at = now() + interval '1 day' where wedding_id = tap.wa();
    elsif v_state = 'po_svatbe' then
      update public.weddings set starts_on = current_date - 3 where id = tap.wa();
    elsif v_state = 'override' then
      update public.weddings set phase_override = 'rsvp_closed' where id = tap.wa();
    elsif v_state = 'nezverejneno' then
      update public.weddings set status = 'draft' where id = tap.wa();
    elsif v_state = 'zablokovano' then
      update public.weddings set status = 'blocked' where id = tap.wa();
    end if;

    perform tap.become('authenticated', tap.wa(), 'visitor');
    perform tap.throws(format('select public.rsvp_submit(%L, %L::jsonb)', v_ticket, v_payload::text), 'rsvp_closed', 'RSVP je zavřené (' || v_state || ')');
    perform tap.ok((select ticket from public.rsvp_match('Marie Nováková')) is null, 'rsvp_match nevydá lístek (' || v_state || ')');
    perform tap.reset();
    update public.weddings set status = 'published', phase_override = null where id = tap.wa();
  end loop;
end
$$;

-- app.phase: odvozená fáze podle dat a časového pásma (kap. 7)
do $$
declare
  w public.weddings;
  v_tz_edge timestamptz;
begin
  update public.rsvp_settings set opens_at = null, closes_at = null where wedding_id = tap.wa();
  update public.weddings set starts_on = date '2030-06-12', ends_on = date '2030-06-14', timezone = 'Europe/Prague', phase_override = null where id = tap.wa();
  select * into w from public.weddings where id = tap.wa();
  perform tap.ok(app.phase(w, timestamptz '2030-01-01 12:00+00') = 'rsvp_open', 'bez omezení je RSVP otevřené');

  update public.rsvp_settings set opens_at = timestamptz '2030-02-01+00', closes_at = timestamptz '2030-05-01+00' where wedding_id = tap.wa();
  perform tap.ok(app.phase(w, timestamptz '2030-01-15+00') = 'save_the_date', 'před otevřením RSVP: save_the_date');
  perform tap.ok(app.phase(w, timestamptz '2030-03-01+00') = 'rsvp_open', 'v okně RSVP: rsvp_open');
  perform tap.ok(app.phase(w, timestamptz '2030-05-02+00') = 'rsvp_closed', 'po uzavření RSVP: rsvp_closed');
  perform tap.ok(app.phase(w, timestamptz '2030-06-11 21:59:59+00') = 'rsvp_closed', 'těsně před půlnocí v Praze: ještě není den svatby');
  perform tap.ok(app.phase(w, timestamptz '2030-06-11 22:00:00+00') = 'wedding_day', 'půlnoc v pásmu svatby začíná den svatby (UTC+2)');
  perform tap.ok(app.phase(w, timestamptz '2030-06-13 12:00+00') = 'wedding_day', 'vícedenní svatba: druhý den je stále wedding_day');
  perform tap.ok(app.phase(w, timestamptz '2030-06-14 21:59:59+00') = 'wedding_day', 'poslední den svatby');
  perform tap.ok(app.phase(w, timestamptz '2030-06-14 22:00:00+00') = 'thanks', 'po svatbě: thanks');

  update public.weddings set phase_override = 'thanks' where id = tap.wa();
  select * into w from public.weddings where id = tap.wa();
  perform tap.ok(app.phase(w, timestamptz '2030-01-01+00') = 'thanks', 'phase_override má přednost');

  update public.weddings set status = 'draft', phase_override = null where id = tap.wa();
  select * into w from public.weddings where id = tap.wa();
  perform tap.ok(app.phase(w, timestamptz '2030-03-01+00') is null, 'nezveřejněný web nemá fázi');
  update public.weddings set status = 'published' where id = tap.wa();
end
$$;

-- ---------------------------------------------------------------------------
-- get_public_site
-- ---------------------------------------------------------------------------
do $$
declare
  v_site jsonb;
begin
  update public.weddings set starts_on = current_date + 200, ends_on = null where id = tap.wa();
  update public.rsvp_settings set opens_at = null, closes_at = null where wedding_id = tap.wa();

  perform tap.become('authenticated', tap.wa(), 'visitor');
  v_site := public.get_public_site();
  perform tap.reset();
  perform tap.ok(v_site ->> 'mode' = 'published' and v_site #>> '{content,hero,title}' = 'Zveřejněno A', 'návštěvník dostane zveřejněnou verzi své svatby');
  perform tap.ok(v_site -> 'sensitive' = 'null'::jsonb, 'návštěvník nedostane citlivou část');
  perform tap.ok(not (v_site::text like '%123456%' or v_site::text like '%citlivé%'), 'citlivý obsah není nikde v odpovědi návštěvníka');
  perform tap.ok(v_site ->> 'phase' = 'rsvp_open', 'odpověď nese odvozenou fázi');

  perform tap.become('authenticated', tap.wa(), 'guest_pin');
  v_site := public.get_public_site();
  perform tap.reset();
  perform tap.ok(v_site #>> '{sensitive,account}' = 'citlivé A', 'host po PINu dostane citlivou část');

  perform tap.become('authenticated', tap.wa(), 'admin');
  v_site := public.get_public_site();
  perform tap.reset();
  perform tap.ok(v_site #>> '{sensitive,account}' = 'citlivé A', 'správce dostane citlivou část');

  -- rychlá změna
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.ok(public.get_public_site() -> 'quick_notice' = 'null'::jsonb, 'vypnutá rychlá změna se nevrací');
  perform tap.reset();
  update public.weddings set quick_notice = '{"cs": "Změna místa"}', quick_notice_enabled = true where id = tap.wa();
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.ok(public.get_public_site() #>> '{quick_notice,cs}' = 'Změna místa', 'zapnutá rychlá změna se vrací');
  perform tap.reset();

  -- koncept: návštěvník nic, náhled ano
  update public.weddings set status = 'draft', published_version_id = null where id = tap.wb();
  perform tap.become('authenticated', tap.wb(), 'visitor');
  perform tap.ok(public.get_public_site() is null, 'návštěvník konceptu nedostane nic');
  perform tap.reset();
  perform tap.become('authenticated', tap.wb(), 'preview');
  v_site := public.get_public_site();
  perform tap.reset();
  perform tap.ok(v_site ->> 'mode' = 'preview', 'náhled konceptu vrací pracovní kopii');
  perform tap.eq(jsonb_array_length(v_site #> '{pages,0,blocks}'), 2, 'náhled obsahuje zapnuté bloky včetně citlivých');
  perform tap.ok(v_site::text like '%123456%', 'náhled zahrnuje citlivý blok (preview vidí citlivé části)');
  perform tap.ok(not (v_site::text like '%Zveřejněno A%'), 'náhled svatby B neobsahuje obsah svatby A');

  -- zablokovaný web: nic pro návštěvníka ani náhled
  update public.weddings set status = 'blocked' where id = tap.wa();
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.ok(public.get_public_site() is null, 'zablokovaný web návštěvníkovi nic nevrací');
  perform tap.reset();
  perform tap.become('authenticated', tap.wa(), 'preview');
  perform tap.ok(public.get_public_site() is null, 'zablokovaný web nevrací ani náhled');
  perform tap.reset();

  -- smazaný web
  update public.weddings set status = 'deleted' where id = tap.wa();
  perform tap.become('authenticated', tap.wa(), 'admin');
  perform tap.ok(public.get_public_site() is null, 'smazaný web nic nevrací');
  perform tap.reset();
end
$$;

-- resolve_preview: náhled podle tajného odkazu (uložen jako hash)
do $$
begin
  update public.weddings set preview_token_hash = sha256(convert_to('tajny-odkaz', 'UTF8')) where id = tap.wb();
  set local role service_role;
  perform tap.eq((select count(*) from public.resolve_preview('druha-svatba', sha256(convert_to('tajny-odkaz', 'UTF8')))), 1, 'správný odkaz otevře náhled konceptu');
  perform tap.eq((select count(*) from public.resolve_preview('druha-svatba', sha256(convert_to('jiny', 'UTF8')))), 0, 'špatný odkaz nic neotevře');
  perform tap.eq((select count(*) from public.resolve_preview('druha-svatba', null)), 0, 'chybějící odkaz nic neotevře');
  perform tap.eq((select count(*) from public.resolve_preview('klara-a-matej', sha256(convert_to('tajny-odkaz', 'UTF8')))), 0, 'odkaz jedné svatby neotevře jinou');
  perform tap.reset();
end
$$;

rollback;
