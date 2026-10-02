-- M8: tolerance překlepů, odpovědi na otázky, doprovod a děti, host mimo seznam, správcovská strana
-- (seznam hostů, přehled RSVP, ruční zápis), analytika bez identifikátorů.
begin;
select tap.seed();

-- ---------------------------------------------------------------------------
-- Pomocné funkce: bezpečné uuid a vzdálenost slov
-- ---------------------------------------------------------------------------
do $$
begin
  perform tap.ok(app.try_uuid('nesmysl') is null, 'try_uuid: neplatný text je null');
  perform tap.ok(app.try_uuid(null) is null, 'try_uuid: null je null');
  perform tap.ok(app.try_uuid(tap.u('x')::text) = tap.u('x'), 'try_uuid: platné uuid projde');

  perform tap.eq(app.osa_distance('novak', 'novak'), 0, 'osa_distance: shoda je 0');
  perform tap.eq(app.osa_distance('novak', 'novk'), 1, 'osa_distance: chybějící znak je 1');
  perform tap.eq(app.osa_distance('matej', 'matje'), 1, 'osa_distance: prohození sousedních znaků je 1');
  perform tap.eq(app.osa_distance('', 'abc'), 3, 'osa_distance: prázdné slovo');
  perform tap.eq(app.osa_distance('kitten', 'sitting'), 3, 'osa_distance: klasický příklad');

  perform tap.ok(app.names_close('jan novak', 'jan novk'), 'names_close: chybějící znak v příjmení');
  perform tap.ok(app.names_close('matej novak', 'matje novak'), 'names_close: prohozené znaky v křestním jménu');
  perform tap.ok(app.names_close('klara novakova', 'klara novakoba'), 'names_close: záměna znaku');
  perform tap.ok(not app.names_close('jan novak', 'jana novak'), 'names_close: Jan není Jana (krátké slovo přesně)');
  perform tap.ok(not app.names_close('jan novak', 'jon novak'), 'names_close: krátké slovo se musí shodovat přesně');
  perform tap.ok(not app.names_close('petr novak', 'pavel novak'), 'names_close: jiné jméno');
  perform tap.ok(not app.names_close('jan novak', 'novak'), 'names_close: jiný počet slov');
  perform tap.ok(not app.names_close('jan novak', 'jan nowakk'), 'names_close: tolerance je omezená na jednu úpravu ve slově (nowakk je dvě)');
  perform tap.ok(not app.names_close('', ''), 'names_close: prázdný klíč nic neshoduje');
end
$$;

-- ---------------------------------------------------------------------------
-- rsvp_match: překlepy, nejednoznačnost, délka vstupu
-- ---------------------------------------------------------------------------
do $$
declare
  v_shape_many text;
  v_shape_none text;
begin
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.ok(exists (select 1 from public.rsvp_match('Jan Novk') where ticket is not null), 'překlep: chybějící znak v krátkém jménu se toleruje');
  perform tap.ok(exists (select 1 from public.rsvp_match('Marie Novakova') where ticket is not null), 'diakritika a velikost písmen: Nováková');
  perform tap.ok(exists (select 1 from public.rsvp_match('Maire Nováková') where ticket is not null), 'překlep: prohozená písmena');
  perform tap.ok((select ticket from public.rsvp_match('Jana Novák')) is null, 'jiné křestní jméno (Jana) se nepáruje s Janem');
  perform tap.ok((select ticket from public.rsvp_match('Jan Novotný')) is null, 'jiné příjmení se nepáruje');
  perform tap.ok((select ticket from public.rsvp_match('Novák')) is null, 'jen příjmení se nepáruje');
  perform tap.ok((select ticket from public.rsvp_match(repeat('a', 201))) is null, 'příliš dlouhý vstup nevydá lístek');
  perform tap.reset();

  -- dva podobné hosté ve dvou domácnostech: překlep blízký oběma je nejednoznačný
  insert into public.households (id, wedding_id, label) values (tap.u('A:household3'), tap.wa(), 'Další');
  insert into public.guests (id, wedding_id, household_id, display_name)
  values (tap.u('A:guest4'), tap.wa(), tap.u('A:household3'), 'Jan Nowák');
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.ok((select ticket from public.rsvp_match('Jan Novák')) is not null, 'přesná shoda má přednost před podobným jménem');
  select row_to_json(x)::text into v_shape_many from (select ticket from public.rsvp_match('Jan Norák')) x;
  select row_to_json(x)::text into v_shape_none from (select ticket from public.rsvp_match('Zdeněk Nikdo')) x;
  perform tap.ok(v_shape_many = '{"ticket":null}' and v_shape_many = v_shape_none,
    'překlep blízký dvěma domácnostem má stejný tvar odpovědi jako neshoda');
  perform tap.reset();
  delete from public.guests where id = tap.u('A:guest4');
  delete from public.households where id = tap.u('A:household3');
end
$$;

-- ---------------------------------------------------------------------------
-- rsvp_submit: otázky, doprovod, děti
-- ---------------------------------------------------------------------------
do $$
declare
  v_ticket text;
  g1 uuid := tap.u('A:guest1');
  g2 uuid := tap.u('A:guest2');
  e1 uuid := tap.u('A:event1');
  e2 uuid := tap.u('A:event2');
  v_att1 jsonb := jsonb_build_array(jsonb_build_object('event_id', tap.u('A:event1'), 'attending', true));
  v_att12 jsonb := jsonb_build_array(jsonb_build_object('event_id', tap.u('A:event1'), 'attending', true),
                                     jsonb_build_object('event_id', tap.u('A:event2'), 'attending', true));
  v_people jsonb;
begin
  update public.rsvp_settings
     set enabled_questions = '{"plus_one": true, "children": false, "diet": true, "lodging": true, "transport": true, "song": true}'
   where wedding_id = tap.wa();
  delete from public.rsvp_questions where wedding_id = tap.wa();
  insert into public.rsvp_questions (wedding_id, key, type, label, options, required, event_id, position) values
    (tap.wa(), 'menu', 'choice', '{"cs": "Menu"}', '[{"value": "maso", "label": {"cs": "Maso"}}, {"value": "ryba", "label": {"cs": "Ryba"}}]', true, null, 1),
    (tap.wa(), 'prekvapeni', 'bool', '{"cs": "Překvapení?"}', null, false, null, 2),
    (tap.wa(), 'pisen', 'text', '{"cs": "Píseň na hostinu"}', null, false, e2, 3),
    (tap.wa(), 'vypnuta', 'text', '{"cs": "Vypnutá"}', null, true, null, 4);
  update public.rsvp_questions set enabled = false where wedding_id = tap.wa() and key = 'vypnuta';

  perform tap.become('authenticated', tap.wa(), 'visitor');
  select ticket into v_ticket from public.rsvp_match('Jan Novák');
  v_people := jsonb_build_array(jsonb_build_object('guest_id', g1, 'attendance', v_att12));

  -- povinná otázka
  perform tap.throws(format('select public.rsvp_submit(%L, %L::jsonb)', v_ticket,
    jsonb_build_object('answers', '{}'::jsonb, 'people', v_people)::text), 'answer_required', 'povinná vlastní otázka chybí');
  perform tap.throws(format('select public.rsvp_submit(%L, %L::jsonb)', v_ticket,
    jsonb_build_object('answers', '{"menu": ""}'::jsonb, 'people', v_people)::text), 'invalid_payload', 'volba mimo možnosti se odmítne');
  perform tap.throws(format('select public.rsvp_submit(%L, %L::jsonb)', v_ticket,
    jsonb_build_object('answers', '{"menu": "maso", "prekvapeni": "ano"}'::jsonb, 'people', v_people)::text), 'invalid_payload', 'ano/ne musí být boolean');
  perform tap.throws(format('select public.rsvp_submit(%L, %L::jsonb)', v_ticket,
    jsonb_build_object('answers', '{"menu": "maso", "lodging": "hotel"}'::jsonb, 'people', v_people)::text), 'invalid_payload', 'ubytování mimo možnosti se odmítne');
  perform tap.throws(format('select public.rsvp_submit(%L, %L::jsonb)', v_ticket,
    jsonb_build_object('answers', jsonb_build_object('menu', 'maso', 'song', repeat('x', 201)), 'people', v_people)::text),
    'invalid_payload', 'příliš dlouhá píseň se odmítne');

  -- platná odpověď: vlastní otázka vázaná na událost se uloží jen u toho, kdo přijde
  perform public.rsvp_submit(v_ticket, jsonb_build_object(
    'answers', jsonb_build_object('menu', 'ryba', 'prekvapeni', true, 'pisen', '  Hej, Jude  ', 'lodging', 'need',
                                  'transport', 'offer', 'song', ' Vlak do nebe '),
    'people', v_people));
  perform tap.reset();
  perform tap.ok((select answers ->> 'menu' from public.rsvp_responses where wedding_id = tap.wa()) = 'ryba', 'volba z možností se uloží');
  perform tap.ok((select answers -> 'prekvapeni' from public.rsvp_responses where wedding_id = tap.wa()) = 'true'::jsonb, 'ano/ne se uloží');
  perform tap.ok((select answers ->> 'pisen' from public.rsvp_responses where wedding_id = tap.wa()) = 'Hej, Jude', 'text se ořízne od mezer');
  perform tap.ok((select answers ->> 'song' from public.rsvp_responses where wedding_id = tap.wa()) = 'Vlak do nebe', 'vestavěná píseň se uloží');
  perform tap.ok((select answers ->> 'lodging' from public.rsvp_responses where wedding_id = tap.wa()) = 'need', 'vestavěné ubytování se uloží');
  perform tap.ok((select answers ->> 'transport' from public.rsvp_responses where wedding_id = tap.wa()) = 'offer', 'vestavěná doprava se uloží');

  -- otázka vázaná na událost, na kterou nikdo nepřijde, se zahodí; vypnutá otázka se nevyžaduje
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform public.rsvp_submit(v_ticket, jsonb_build_object(
    'answers', jsonb_build_object('menu', 'maso', 'pisen', 'Nepřijdu', 'vypnuta', 'x'),
    'people', jsonb_build_array(jsonb_build_object('guest_id', g1, 'attendance', jsonb_build_array(
      jsonb_build_object('event_id', e1, 'attending', true), jsonb_build_object('event_id', e2, 'attending', false))))));
  perform tap.reset();
  perform tap.ok(not ((select answers from public.rsvp_responses where wedding_id = tap.wa()) ? 'pisen'),
    'odpověď na otázku k události, na kterou host nepřijde, se nezapíše');

  -- vypnutá vestavěná otázka se zahodí (ne chyba)
  update public.rsvp_settings set enabled_questions = '{"plus_one": true, "diet": true}' where wedding_id = tap.wa();
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform public.rsvp_submit(v_ticket, jsonb_build_object(
    'answers', jsonb_build_object('menu', 'maso', 'lodging', 'need', 'song', 'x'),
    'people', jsonb_build_array(jsonb_build_object('guest_id', g1, 'attendance', v_att1))));
  perform tap.reset();
  perform tap.ok(not ((select answers from public.rsvp_responses where wedding_id = tap.wa()) ?| array['lodging', 'song']),
    'odpovědi na vypnuté vestavěné otázky se nezapíšou');

  -- doprovod: nejvýš jeden, děti jen při zapnutém children a s věkem
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.throws(format('select public.rsvp_submit(%L, %L::jsonb)', v_ticket, jsonb_build_object(
    'answers', jsonb_build_object('menu', 'maso'),
    'people', jsonb_build_array(
      jsonb_build_object('guest_id', g1, 'attendance', v_att1),
      jsonb_build_object('person_name', 'První Doprovod', 'attendance', v_att1),
      jsonb_build_object('person_name', 'Druhý Doprovod', 'attendance', v_att1)))::text),
    'too_many_plus_one', 'víc než jeden doprovod se odmítne');
  perform tap.throws(format('select public.rsvp_submit(%L, %L::jsonb)', v_ticket, jsonb_build_object(
    'answers', jsonb_build_object('menu', 'maso'),
    'people', jsonb_build_array(
      jsonb_build_object('guest_id', g1, 'attendance', v_att1),
      jsonb_build_object('person_name', 'Malý Host', 'is_child', true, 'age', 4, 'attendance', v_att1)))::text),
    'children_not_allowed', 'dítě doplněné ručně se odmítne, když pár děti nepovolil');
  perform tap.reset();

  update public.rsvp_settings set enabled_questions = '{"plus_one": true, "children": true, "diet": true}' where wedding_id = tap.wa();
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.throws(format('select public.rsvp_submit(%L, %L::jsonb)', v_ticket, jsonb_build_object(
    'answers', jsonb_build_object('menu', 'maso'),
    'people', jsonb_build_array(
      jsonb_build_object('guest_id', g1, 'attendance', v_att1),
      jsonb_build_object('person_name', 'Malý Host', 'is_child', true, 'attendance', v_att1)))::text),
    'invalid_payload', 'dítě bez věku se odmítne');
  perform tap.throws(format('select public.rsvp_submit(%L, %L::jsonb)', v_ticket, jsonb_build_object(
    'answers', jsonb_build_object('menu', 'maso'),
    'people', jsonb_build_array(
      jsonb_build_object('guest_id', g1, 'attendance', v_att1),
      jsonb_build_object('person_name', 'Velký Host', 'is_child', true, 'age', 30, 'attendance', v_att1)))::text),
    'invalid_payload', 'dítě starší sedmnácti let se odmítne');
  perform public.rsvp_submit(v_ticket, jsonb_build_object(
    'answers', jsonb_build_object('menu', 'maso'),
    'people', jsonb_build_array(
      jsonb_build_object('guest_id', g1, 'attendance', v_att1),
      jsonb_build_object('person_name', 'Doprovod Hosta', 'attendance', v_att1),
      jsonb_build_object('person_name', 'Malý Host', 'is_child', true, 'age', 4, 'attendance', v_att1, 'diet', 'bez lepku'))));
  perform tap.reset();
  perform tap.ok(exists (select 1 from public.rsvp_people where wedding_id = tap.wa() and is_plus_one and not is_child and person_name = 'Doprovod Hosta'),
    'doprovod je označen jako plus jedna');
  perform tap.ok(exists (select 1 from public.rsvp_people where wedding_id = tap.wa() and is_child and not is_plus_one and age = 4 and guest_id is null),
    'dítě doplněné hostem je označeno jako dítě s věkem');
  perform tap.ok((select count(*) from public.rsvp_health where wedding_id = tap.wa() and diet = 'bez lepku') = 1,
    'dieta dítěte se uloží zvlášť');

  -- neplatné identifikátory a typy nevyvolají surovou chybu přetypování
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.throws(format('select public.rsvp_submit(%L, %L::jsonb)', v_ticket,
    jsonb_build_object('answers', jsonb_build_object('menu', 'maso'), 'people', jsonb_build_array(
      jsonb_build_object('guest_id', 'neni-uuid', 'attendance', v_att1)))::text), 'invalid_payload', 'neplatné guest_id: invalid_payload');
  perform tap.throws(format('select public.rsvp_submit(%L, %L::jsonb)', v_ticket,
    jsonb_build_object('answers', jsonb_build_object('menu', 'maso'), 'people', jsonb_build_array(
      jsonb_build_object('guest_id', g1, 'attendance', jsonb_build_array(jsonb_build_object('event_id', 'neni-uuid', 'attending', true)))))::text),
    'invalid_payload', 'neplatné event_id: invalid_payload');
  perform tap.throws(format('select public.rsvp_submit(%L, %L::jsonb)', v_ticket,
    jsonb_build_object('answers', jsonb_build_object('menu', 'maso'), 'people', jsonb_build_array('text'))::text),
    'invalid_payload', 'osoba, která není objekt, se odmítne');
  perform tap.throws(format('select public.rsvp_submit(%L, %L::jsonb)', v_ticket,
    jsonb_build_object('answers', 'text', 'people', jsonb_build_array(jsonb_build_object('guest_id', g1)))::text),
    'invalid_payload', 'answers, které není objekt, se odmítne');
  perform tap.reset();

  -- g2 (jen obřad) a rodinný člen jiné domácnosti: ruční osoba může odpovědět jen na události domácnosti
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.throws(format('select public.rsvp_submit(%L, %L::jsonb)', v_ticket,
    jsonb_build_object('answers', jsonb_build_object('menu', 'maso'), 'people', jsonb_build_array(
      jsonb_build_object('guest_id', g2, 'attendance', jsonb_build_array(jsonb_build_object('event_id', e2, 'attending', true)))))::text),
    'event_not_invited', 'host bez pozvání na hostinu na ni neodpoví');
  perform tap.reset();
end
$$;

-- ---------------------------------------------------------------------------
-- rsvp_info
-- ---------------------------------------------------------------------------
do $$
declare
  v_info jsonb;
begin
  update public.rsvp_settings set opens_at = null, closes_at = null, allow_unlisted = false, email_confirmation = true
   where wedding_id = tap.wa();
  perform tap.become('authenticated', tap.wa(), 'visitor');
  v_info := public.rsvp_info();
  perform tap.reset();
  perform tap.ok(v_info ->> 'phase' = 'rsvp_open' and (v_info ->> 'open')::boolean, 'rsvp_info: otevřené RSVP');
  perform tap.ok(not (v_info ->> 'allow_unlisted')::boolean, 'rsvp_info: host mimo seznam není povolen');
  perform tap.ok((v_info ->> 'email_confirmation')::boolean, 'rsvp_info: potvrzení e-mailem');
  perform tap.ok(not (v_info::text like '%Nov%'), 'rsvp_info nic neříká o hostech');

  update public.rsvp_settings set allow_unlisted = true, closes_at = now() - interval '1 minute' where wedding_id = tap.wa();
  perform tap.become('authenticated', tap.wa(), 'visitor');
  v_info := public.rsvp_info();
  perform tap.reset();
  perform tap.ok(v_info ->> 'phase' = 'rsvp_closed' and not (v_info ->> 'open')::boolean, 'rsvp_info: uzavřené RSVP');
  perform tap.ok(not (v_info ->> 'allow_unlisted')::boolean, 'rsvp_info: uzavřené RSVP nenabízí hosta mimo seznam');

  perform tap.become('authenticated', tap.wa(), 'admin');
  perform tap.ok(public.rsvp_info() is null, 'rsvp_info: správce nic nedostane');
  perform tap.reset();
  perform tap.become('authenticated', tap.wa(), 'preview');
  perform tap.ok(public.rsvp_info() is null, 'rsvp_info: náhled nic nedostane');
  perform tap.reset();

  update public.weddings set status = 'draft' where id = tap.wa();
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.ok(public.rsvp_info() is null, 'rsvp_info: nezveřejněný web nic nevrací');
  perform tap.reset();
  update public.weddings set status = 'published' where id = tap.wa();
  update public.rsvp_settings set closes_at = null, allow_unlisted = false where wedding_id = tap.wa();
end
$$;

-- ---------------------------------------------------------------------------
-- Host mimo seznam
-- ---------------------------------------------------------------------------
do $$
declare
  v_form jsonb;
  v_result jsonb;
  e1 uuid := tap.u('A:event1');
  e3 uuid := tap.u('A:event3');
  v_att jsonb := jsonb_build_array(jsonb_build_object('event_id', tap.u('A:event1'), 'attending', true));
  v_before bigint;
begin
  update public.rsvp_settings
     set enabled_questions = '{"children": true, "diet": true, "song": true}', allow_unlisted = false, email_confirmation = true
   where wedding_id = tap.wa();
  delete from public.rsvp_questions where wedding_id = tap.wa();
  insert into public.events (id, wedding_id, kind, title, starts_at, rsvp_enabled, position)
  values (e3, tap.wa(), 'other', '{"cs": "Soukromá událost"}', now() + interval '201 days', false, 3);

  -- vypnuto: formulář ani zápis
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.ok(public.rsvp_unlisted_form() is null, 'host mimo seznam vypnut: formulář nic nevrací');
  perform tap.throws(format('select public.rsvp_submit_unlisted(%L::jsonb)', jsonb_build_object(
    'answers', '{}'::jsonb, 'people', jsonb_build_array(jsonb_build_object('person_name', 'Karel Cizí', 'attendance', v_att)))::text),
    'unlisted_not_allowed', 'host mimo seznam vypnut: zápis se odmítne');
  perform tap.reset();
  perform tap.eq((select count(*) from public.rsvp_responses where wedding_id = tap.wa() and household_id is null), 0, 'nic se nezapsalo');

  -- zapnuto
  update public.rsvp_settings set allow_unlisted = true where wedding_id = tap.wa();
  perform tap.become('authenticated', tap.wa(), 'visitor');
  v_form := public.rsvp_unlisted_form();
  perform tap.ok(jsonb_array_length(v_form -> 'events') = 2, 'formulář hosta mimo seznam nabízí jen události s rsvp_enabled');
  perform tap.ok(not (v_form::text like '%Soukromá%') and not (v_form::text like '%Novák%'), 'formulář neobsahuje skrytou událost ani hosty');
  perform tap.ok(v_form #>> '{wedding,timezone}' = 'Europe/Prague' and v_form #>> '{wedding,default_locale}' = 'cs',
    'formulář nese časové pásmo a výchozí jazyk svatby pro zobrazení času a náhradního jazyka');

  v_result := public.rsvp_submit_unlisted(jsonb_build_object(
    'contact_email', 'karel@example.test', 'answers', jsonb_build_object('song', 'Cizí píseň'),
    'people', jsonb_build_array(
      jsonb_build_object('person_name', 'Karel Cizí', 'attendance', v_att, 'diet', 'vegan'),
      jsonb_build_object('person_name', 'Malá Cizí', 'is_child', true, 'age', 6, 'attendance', v_att))));
  perform tap.ok((v_result ->> 'ok')::boolean, 'host mimo seznam: odpověď se uloží');

  perform tap.throws(format('select public.rsvp_submit_unlisted(%L::jsonb)', jsonb_build_object(
    'people', jsonb_build_array(jsonb_build_object('person_name', 'Karel Cizí', 'attendance',
      jsonb_build_array(jsonb_build_object('event_id', e3, 'attending', true)))))::text),
    'event_not_invited', 'host mimo seznam neodpoví na událost bez rsvp_enabled');
  perform tap.throws(format('select public.rsvp_submit_unlisted(%L::jsonb)', jsonb_build_object(
    'people', jsonb_build_array(jsonb_build_object('guest_id', tap.u('A:guest1'), 'attendance', v_att)))::text),
    'invalid_guest', 'host mimo seznam nemůže odpovídat za hosta ze seznamu');
  perform tap.throws(format('select public.rsvp_submit_unlisted(%L::jsonb)', jsonb_build_object(
    'people', jsonb_build_array(jsonb_build_object('attendance', v_att)))::text),
    'invalid_payload', 'host mimo seznam musí uvést jméno');
  perform tap.throws(format('select public.rsvp_submit_unlisted(%L::jsonb)', (
    select jsonb_build_object('people', jsonb_agg(jsonb_build_object('person_name', 'Host ' || n, 'attendance', v_att)))
      from generate_series(1, 7) n)::text),
    'invalid_payload', 'host mimo seznam: nejvýš šest osob');
  perform tap.reset();

  perform tap.eq((select count(*) from public.rsvp_responses where wedding_id = tap.wa() and household_id is null), 1, 'uložena jedna odpověď bez domácnosti');
  perform tap.ok((select entered_by from public.rsvp_responses where wedding_id = tap.wa() and household_id is null) = 'guest', 'odpověď hosta mimo seznam je od hosta');
  perform tap.ok((select contact_email from public.rsvp_responses where wedding_id = tap.wa() and household_id is null) = 'karel@example.test', 'e-mail se uloží při zapnutém potvrzení');
  perform tap.eq((select count(*) from public.rsvp_people p join public.rsvp_responses r on r.id = p.response_id
                   where r.wedding_id = tap.wa() and r.household_id is null and p.guest_id is null and not p.is_plus_one), 2,
    'osoby mimo seznam nejsou ani hosté ze seznamu, ani doprovod');
  perform tap.eq((select count(*) from public.rsvp_health where wedding_id = tap.wa() and diet = 'vegan'), 1, 'dieta hosta mimo seznam je uložena zvlášť');
  perform tap.eq((select count(*) from public.guests where wedding_id = tap.wa()), 2, 'seznam hostů se nezměnil');

  -- druhý zápis je další odpověď (host mimo seznam nemá co upravovat), ne přepsání cizí
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform public.rsvp_submit_unlisted(jsonb_build_object('people', jsonb_build_array(
    jsonb_build_object('person_name', 'Jiný Cizí', 'attendance', v_att))));
  perform tap.reset();
  perform tap.eq((select count(*) from public.rsvp_responses where wedding_id = tap.wa() and household_id is null), 2, 'každý zápis mimo seznam je samostatná odpověď');

  -- role a svatba
  perform tap.become('authenticated', tap.wa(), 'admin');
  perform tap.throws(format('select public.rsvp_submit_unlisted(%L::jsonb)', jsonb_build_object('people', jsonb_build_array(
    jsonb_build_object('person_name', 'X Y', 'attendance', v_att)))::text), 'forbidden', 'správce nezapisuje jako host mimo seznam');
  perform tap.ok(public.rsvp_unlisted_form() is null, 'správce nedostane formulář hosta mimo seznam');
  perform tap.reset();
  perform tap.become('authenticated', tap.wb(), 'visitor');
  perform tap.ok(public.rsvp_unlisted_form() is null, 'svatba B má host mimo seznam vypnutý nezávisle na A');
  perform tap.reset();

  -- zavřeno
  update public.rsvp_settings set closes_at = now() - interval '1 minute' where wedding_id = tap.wa();
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.ok(public.rsvp_unlisted_form() is null, 'uzavřené RSVP: formulář hosta mimo seznam nic nevrací');
  perform tap.throws(format('select public.rsvp_submit_unlisted(%L::jsonb)', jsonb_build_object('people', jsonb_build_array(
    jsonb_build_object('person_name', 'X Y', 'attendance', v_att)))::text), 'rsvp_closed', 'uzavřené RSVP: zápis mimo seznam se odmítne');
  perform tap.reset();
  update public.rsvp_settings set closes_at = null where wedding_id = tap.wa();
  delete from public.rsvp_responses where wedding_id = tap.wa() and household_id is null;
  delete from public.events where id = e3;
end
$$;

-- ---------------------------------------------------------------------------
-- Správcovská strana: oprávnění
-- ---------------------------------------------------------------------------
do $$
declare
  v_role text;
  v_h uuid := tap.u('A:household');
begin
  foreach v_role in array array['visitor', 'guest_pin', 'preview'] loop
    perform tap.become('authenticated', tap.wa(), v_role);
    perform tap.throws('select public.admin_guest_list()', 'forbidden', v_role || ' nevolá admin_guest_list');
    perform tap.throws('select public.admin_rsvp_overview()', 'forbidden', v_role || ' nevolá admin_rsvp_overview');
    perform tap.throws(format('select public.admin_rsvp_household(%L)', v_h), 'forbidden', v_role || ' nevolá admin_rsvp_household');
    perform tap.throws(format('select public.admin_rsvp_enter(%L, %L::jsonb)', v_h, '{"people": []}'), 'forbidden', v_role || ' nevolá admin_rsvp_enter');
    perform tap.reset();
  end loop;

  perform tap.become('anon', null, null);
  perform tap.throws('select public.admin_guest_list()', '42501', 'anon nevolá admin_guest_list');
  perform tap.reset();
  set local role service_role;
  perform tap.throws('select public.admin_guest_list()', '42501', 'service_role nevolá admin_guest_list');
  perform tap.throws('select public.rsvp_submit_unlisted(''{}'')', '42501', 'service_role nevolá rsvp_submit_unlisted');
  perform tap.reset();
end
$$;

-- ---------------------------------------------------------------------------
-- Správcovská strana: seznam, přehled, ruční zápis
-- ---------------------------------------------------------------------------
do $$
declare
  v_list jsonb;
  v_overview jsonb;
  v_view jsonb;
  v_h uuid := tap.u('A:household');
  g1 uuid := tap.u('A:guest1');
  g2 uuid := tap.u('A:guest2');
  e1 uuid := tap.u('A:event1');
  e2 uuid := tap.u('A:event2');
  v_audit bigint;
begin
  -- čistý výchozí stav odpovědí: jen fixtura (g1 přijde na obřad)
  delete from public.rsvp_responses where wedding_id = tap.wa();
  insert into public.households (id, wedding_id, label) values (tap.u('A:household2'), tap.wa(), 'Druzí');
  insert into public.guests (id, wedding_id, household_id, display_name, is_child, age)
  values (tap.u('A:guest5'), tap.wa(), tap.u('A:household2'), 'Tereza Druhá', false, null),
         (tap.u('A:guest6'), tap.wa(), tap.u('A:household2'), 'Tomáš Druhý', true, 9);
  insert into public.invitations (wedding_id, guest_id, event_id)
  values (tap.wa(), tap.u('A:guest5'), e1), (tap.wa(), tap.u('A:guest6'), e1);

  perform tap.become('authenticated', tap.wa(), 'admin');
  v_list := public.admin_guest_list();
  v_overview := public.admin_rsvp_overview();
  perform tap.reset();

  perform tap.eq(jsonb_array_length(v_list -> 'households'), 2, 'seznam: dvě domácnosti své svatby');
  perform tap.eq(jsonb_array_length(v_list -> 'events'), 2, 'seznam: události svatby');
  perform tap.ok(not (v_list::text like '%Svoboda%'), 'seznam neobsahuje hosty jiné svatby');
  perform tap.eq(jsonb_array_length(v_list #> '{households,0,guests}'), 2, 'seznam: členové domácnosti');
  perform tap.ok(v_list #> '{households,0,response}' = 'null'::jsonb, 'seznam: domácnost bez odpovědi nemá response');
  perform tap.ok(v_list::text like '%Jan Novák%' and v_list::text like '%invited_event_ids%', 'seznam nese jména a pozvání');
  perform tap.ok(not (v_list::text like '%diet%'), 'seznam nevrací zdravotní údaje');

  perform tap.eq((v_overview #>> '{households,total}')::bigint, 2, 'přehled: domácností celkem');
  perform tap.eq((v_overview #>> '{households,answered}')::bigint, 0, 'přehled: zatím nikdo neodpověděl');
  perform tap.eq((v_overview #>> '{households,pending}')::bigint, 2, 'přehled: čekající domácnosti');
  perform tap.eq((v_overview #>> '{guests,total}')::bigint, 4, 'přehled: hosté celkem');
  perform tap.eq((v_overview #>> '{guests,children}')::bigint, 1, 'přehled: děti ze seznamu');
  perform tap.eq((v_overview #>> '{events,0,invited}')::bigint, 4, 'přehled: pozvaní na obřad');
  perform tap.eq((v_overview #>> '{events,0,pending}')::bigint, 4, 'přehled: na obřad zatím nikdo neodpověděl');
  perform tap.eq((v_overview #>> '{events,1,invited}')::bigint, 1, 'přehled: pozvaní na hostinu');

  -- ruční zápis telefonického hosta (RSVP může být uzavřené)
  update public.rsvp_settings set closes_at = now() - interval '1 day', email_confirmation = true,
         enabled_questions = '{"plus_one": true, "diet": true}' where wedding_id = tap.wa();
  delete from public.rsvp_questions where wedding_id = tap.wa();
  insert into public.rsvp_questions (wedding_id, key, type, label, required) values (tap.wa(), 'povinna', 'text', '{"cs": "Povinná"}', true);

  perform tap.become('authenticated', tap.wa(), 'admin');
  v_view := public.admin_rsvp_household(v_h);
  perform tap.ok(jsonb_array_length(v_view -> 'guests') = 2 and v_view -> 'response' = 'null'::jsonb, 'admin_rsvp_household: domácnost bez odpovědi');
  perform tap.ok(v_view ->> 'household_id' = v_h::text and v_view #>> '{wedding,timezone}' = 'Europe/Prague',
    'admin_rsvp_household nese domácnost a časové pásmo svatby');
  perform tap.ok(public.admin_rsvp_household(tap.u('B:household')) is null, 'admin_rsvp_household: cizí domácnost je null');
  perform tap.ok((public.admin_rsvp_enter(v_h, jsonb_build_object(
      'contact_email', 'nema@example.test', 'answers', '{}'::jsonb,
      'people', jsonb_build_array(
        jsonb_build_object('guest_id', g1, 'diet', 'bez ořechů', 'attendance', jsonb_build_array(
          jsonb_build_object('event_id', e1, 'attending', true), jsonb_build_object('event_id', e2, 'attending', false))),
        jsonb_build_object('guest_id', g2, 'attendance', jsonb_build_array(jsonb_build_object('event_id', e1, 'attending', false)))))) ->> 'ok')::boolean,
    'ruční zápis uloží odpověď po uzavření RSVP a bez povinné otázky');
  perform tap.throws(format('select public.admin_rsvp_enter(%L, %L::jsonb)', tap.u('B:household'),
    '{"people":[{"guest_id":null,"person_name":"X Y"}]}'), 'household_not_found', 'ruční zápis do domácnosti jiné svatby selže');
  perform tap.throws(format('select public.admin_rsvp_enter(%L, %L::jsonb)', v_h,
    jsonb_build_object('people', jsonb_build_array(jsonb_build_object('guest_id', tap.u('B:guest1'))))::text), 'invalid_guest', 'ruční zápis za hosta jiné svatby selže');
  perform tap.throws(format('select public.admin_rsvp_enter(%L, %L::jsonb)', v_h,
    jsonb_build_object('people', jsonb_build_array(jsonb_build_object('guest_id', g1, 'attendance',
      jsonb_build_array(jsonb_build_object('event_id', tap.u('B:event1'), 'attending', true)))))::text), 'event_not_invited', 'ruční zápis na událost jiné svatby selže');
  v_list := public.admin_guest_list();
  v_overview := public.admin_rsvp_overview();
  v_view := public.admin_rsvp_household(v_h);
  perform tap.reset();

  perform tap.ok((select entered_by from public.rsvp_responses where wedding_id = tap.wa() and household_id = v_h) = 'admin', 'ruční zápis je označen entered_by = admin');
  perform tap.ok((select contact_email from public.rsvp_responses where wedding_id = tap.wa() and household_id = v_h) is null, 'ruční zápis neukládá e-mail');
  perform tap.ok(v_view #>> '{response,people,0,diet}' = 'bez ořechů', 'admin_rsvp_household vrací i dietu pro předvyplnění');
  select max(id) into v_audit from public.audit_log where wedding_id = tap.wa() and action = 'rsvp.manual_entry';
  perform tap.ok(v_audit is not null, 'ruční zápis je v audit_log');
  perform tap.ok((select meta = '{}'::jsonb and actor_type = 'admin' and target_id = v_h from public.audit_log where id = v_audit),
    'audit ručního zápisu nemá osobní údaje (jen identifikátor domácnosti)');

  perform tap.eq((v_overview #>> '{households,answered}')::bigint, 1, 'přehled po zápisu: jedna domácnost odpověděla');
  perform tap.eq((v_overview #>> '{households,pending}')::bigint, 1, 'přehled po zápisu: jedna čeká');
  perform tap.eq((v_overview #>> '{events,0,attending}')::bigint, 1, 'přehled po zápisu: na obřad přijde jedna osoba');
  perform tap.eq((v_overview #>> '{events,0,declined}')::bigint, 1, 'přehled po zápisu: na obřad nepřijde jedna osoba');
  perform tap.eq((v_overview #>> '{events,0,pending}')::bigint, 2, 'přehled po zápisu: na obřad neodpověděli dva pozvaní');
  perform tap.eq((v_overview #>> '{events,1,declined}')::bigint, 1, 'přehled po zápisu: hostinu odmítla jedna osoba');
  perform tap.eq((v_overview #>> '{events,1,pending}')::bigint, 0, 'přehled po zápisu: na hostinu odpověděli všichni pozvaní');
  perform tap.ok(v_list #>> '{households,0,response,attending}' = 'true' or v_list #>> '{households,1,response,attending}' = 'true',
    'seznam: domácnost s odpovědí je označena jako přijde');

  -- úprava správcem nahradí odpověď hosta a nevytvoří druhou
  perform tap.become('authenticated', tap.wa(), 'admin');
  perform public.admin_rsvp_enter(v_h, jsonb_build_object('people', jsonb_build_array(
    jsonb_build_object('guest_id', g1, 'attendance', jsonb_build_array(jsonb_build_object('event_id', e1, 'attending', true))))));
  perform tap.reset();
  perform tap.eq((select count(*) from public.rsvp_responses where wedding_id = tap.wa() and household_id = v_h), 1, 'úprava správcem nevytvoří druhou odpověď');
  perform tap.eq((select count(*) from public.rsvp_people where wedding_id = tap.wa()), 1, 'úprava správcem nahradila osoby');

  -- správce svatby B nevidí ani nezapisuje do svatby A
  perform tap.become('authenticated', tap.wb(), 'admin');
  perform tap.ok(not (public.admin_guest_list()::text like '%Novák%'), 'správce B v seznamu nevidí hosty A');
  perform tap.eq((public.admin_rsvp_overview() #>> '{households,total}')::bigint, 1, 'správce B vidí v přehledu jen svou domácnost');
  perform tap.throws(format('select public.admin_rsvp_enter(%L, %L::jsonb)', v_h, '{"people":[]}'), 'household_not_found', 'správce B nezapíše do domácnosti A');
  perform tap.reset();

  delete from public.guests where id in (tap.u('A:guest5'), tap.u('A:guest6'));
  delete from public.households where id = tap.u('A:household2');
end
$$;

-- ---------------------------------------------------------------------------
-- Analytika bez identifikátorů
-- ---------------------------------------------------------------------------
do $$
declare
  v_cols text;
begin
  select string_agg(column_name, ',' order by ordinal_position) into v_cols
    from information_schema.columns where table_schema = 'public' and table_name = 'analytics_event';
  perform tap.ok(v_cols = 'id,event,locale,template,step,created_at',
    'analytics_event nemá sloupec pro svatbu, osobu, IP ani odpověď: ' || v_cols);

  set local role service_role;
  perform public.analytics_record('rsvp_completed', 'cs');
  perform tap.reset();
  perform tap.eq((select count(*) from public.analytics_event where event = 'rsvp_completed' and locale = 'cs'
                   and template is null and step is null), 1, 'analytics_record zapíše událost bez dalších údajů');

  set local role service_role;
  perform tap.throws('select public.analytics_record(''rsvp_answers'', ''cs'')', '23514', 'událost mimo uzavřený seznam se odmítne');
  perform tap.reset();

  perform tap.become('authenticated', tap.wa(), 'admin');
  perform tap.throws('select public.analytics_record(''rsvp_completed'', ''cs'')', '42501', 'správce nezapisuje analytiku');
  perform tap.reset();
  perform tap.become('anon', null, null);
  perform tap.throws('select public.analytics_record(''rsvp_completed'', ''cs'')', '42501', 'anon nezapisuje analytiku');
  perform tap.reset();
end
$$;

rollback;
