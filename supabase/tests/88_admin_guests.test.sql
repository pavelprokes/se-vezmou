-- M7b: správa hostů, RSVP nastavení a přístup (správci, souhlas s nahlédnutím, smazání webu)
-- a izolace mezi svatbami. Zdroj: docs/data-model.md kap. 19, FR-ADM-4, FR-ADM-5, FR-PRIV-2, OQ-53.
begin;
select tap.seed();

-- ---------------------------------------------------------------------------
-- Oprávnění: jen správce vlastní svatby; návštěvník, host, náhled, anon i service role ne
-- ---------------------------------------------------------------------------
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'admin_household_delete(null)', 'admin_guests_import(null)', 'admin_rsvp_settings_get()',
    'admin_rsvp_settings_save(null)', 'admin_household_save(null, null)',
    'admin_invitations_bulk(null, true)', 'admin_access_load()', 'admin_admin_add(''x@example.test'')',
    'admin_admin_remove(null)', 'admin_backup_email_set(''x@example.test'')',
    'admin_guest_pin_enabled_set(true)', 'grant_operator_access(''Důvod'', 3)',
    'revoke_operator_access(null)', 'admin_wedding_delete()'] loop
    perform tap.become('authenticated', tap.wa(), 'visitor');
    perform tap.throws('select se_vezmou.' || v_fn, '42501', v_fn || ': návštěvník je odmítnut');
    perform tap.become('authenticated', tap.wa(), 'guest_pin', tap.u('guest-session'));
    perform tap.throws('select se_vezmou.' || v_fn, '42501', v_fn || ': host po PINu je odmítnut');
    perform tap.become('authenticated', tap.wa(), 'preview');
    perform tap.throws('select se_vezmou.' || v_fn, '42501', v_fn || ': náhled je odmítnut');
    perform tap.reset();
  end loop;

  perform tap.throws('select se_vezmou.admin_access_load()', '42501', 'authenticated bez claimů je odmítnut');
  set local role anon;
  perform tap.throws('select se_vezmou.admin_access_load()', '42501', 'anon nemá execute');
  perform tap.reset();
  set local role service_role;
  perform tap.throws('select se_vezmou.admin_household_delete(null)', '42501', 'service role nespouští funkce správce');
  perform tap.reset();

  perform tap.ok(
    not has_function_privilege('authenticated', 'se_vezmou.household_write(uuid, uuid, jsonb, text, jsonb)', 'execute')
    and not has_function_privilege('service_role', 'se_vezmou.household_write(uuid, uuid, jsonb, text, jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'se_vezmou.guest_data_notice_recipients(uuid)', 'execute')
    and has_function_privilege('service_role', 'se_vezmou.guest_data_notice_recipients(uuid)', 'execute')
    and not has_function_privilege('anon', 'se_vezmou.admin_wedding_delete()', 'execute'),
    'interní zápis domácnosti nemá nikdo, adresy k oznámení jen service role');
end
$$;

-- ---------------------------------------------------------------------------
-- Domácnosti a hosté: vytvoření, úprava, odebrání hosta, neplatné vstupy, izolace
-- ---------------------------------------------------------------------------
do $$
declare
  v_h uuid;
  v_g1 uuid;
  v_b_guests bigint := (select count(*) from se_vezmou.guests where wedding_id = tap.wb());
  v_b_households bigint := (select count(*) from se_vezmou.households where wedding_id = tap.wb());
begin
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  v_h := se_vezmou.admin_household_save(null, jsonb_build_object('label', 'Rodina Dvořákova', 'note', 'z Plzně',
    'guests', jsonb_build_array(
      jsonb_build_object('display_name', ' Karel Dvořák ', 'is_child', false, 'age', 40,
        'invited_event_ids', jsonb_build_array(tap.u('A:event1'), tap.u('A:event2'))),
      jsonb_build_object('display_name', 'Anička Dvořáková', 'is_child', true, 'age', 8,
        'invited_event_ids', jsonb_build_array(tap.u('A:event1'))))));
  perform tap.reset();

  perform tap.ok(v_h is not null, 'household_save: vrátí identifikátor nové domácnosti');
  perform tap.eq((select count(*) from se_vezmou.guests where household_id = v_h), 2, 'household_save: dva hosté');
  perform tap.ok((select display_name from se_vezmou.guests where household_id = v_h and not is_child) = 'Karel Dvořák',
    'household_save: jméno se ořízne');
  perform tap.ok((select age from se_vezmou.guests where household_id = v_h and not is_child) is null,
    'household_save: dospělému se věk neukládá');
  perform tap.ok((select age from se_vezmou.guests where household_id = v_h and is_child) = 8, 'household_save: věk dítěte');
  perform tap.ok((select bool_and(source = 'manual') from se_vezmou.guests where household_id = v_h), 'household_save: zdroj manual');
  perform tap.eq((select count(*) from se_vezmou.invitations i join se_vezmou.guests g on g.id = i.guest_id
                   where g.household_id = v_h), 3, 'household_save: pozvání podle zápisu');
  perform tap.ok((select invited_note from se_vezmou.households where id = v_h) = 'z Plzně', 'household_save: poznámka');

  -- úprava: přejmenování, změna pozvání, odebrání hosta
  select id into v_g1 from se_vezmou.guests where household_id = v_h and not is_child;
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform se_vezmou.admin_household_save(v_h, jsonb_build_object('label', 'Dvořákovi', 'note', null,
    'guests', jsonb_build_array(
      jsonb_build_object('id', v_g1, 'display_name', 'Karel Dvořák st.', 'is_child', false,
        'invited_event_ids', jsonb_build_array(tap.u('A:event2'))))));
  perform tap.reset();
  perform tap.eq((select count(*) from se_vezmou.guests where household_id = v_h), 1, 'household_save: host, který v zápisu chybí, se odebere');
  perform tap.ok((select display_name from se_vezmou.guests where id = v_g1) = 'Karel Dvořák st.', 'household_save: přejmenování hosta');
  perform tap.eq((select count(*) from se_vezmou.invitations where guest_id = v_g1), 1, 'household_save: pozvání se nahradí');
  perform tap.ok((select label from se_vezmou.households where id = v_h) = 'Dvořákovi'
                 and (select invited_note from se_vezmou.households where id = v_h) is null, 'household_save: štítek a poznámka');

  -- neplatné vstupy a cizí identifikátory
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.throws('select se_vezmou.admin_household_save(null, ''{"label": "x", "guests": []}'')', '22023', 'prázdný seznam hostů se odmítne');
  perform tap.throws('select se_vezmou.admin_household_save(null, ''{"label": "x", "guests": [{"display_name": "  "}]}'')', '22023', 'prázdné jméno se odmítne');
  perform tap.throws('select se_vezmou.admin_household_save(null, ''{"label": "x", "guests": [{"display_name": "Dítě", "is_child": true, "age": 18}]}'')',
    '22023', 'věk dítěte nad 17 se odmítne');
  perform tap.throws(format('select se_vezmou.admin_household_save(null, %L::jsonb)', jsonb_build_object('label', 'x',
    'guests', jsonb_build_array(jsonb_build_object('display_name', 'Host', 'invited_event_ids', jsonb_build_array(tap.u('B:event1')))))::text),
    'invalid_event', 'pozvání na událost cizí svatby se odmítne');
  perform tap.throws(format('select se_vezmou.admin_household_save(%L, ''{"label": "x", "guests": [{"display_name": "Host"}]}'')', tap.u('B:household')),
    'household_not_found', 'cizí domácnost nejde upravit');
  perform tap.throws(format('select se_vezmou.admin_household_save(%L, %L::jsonb)', v_h, jsonb_build_object('label', 'x',
    'guests', jsonb_build_array(jsonb_build_object('id', tap.u('B:guest1'), 'display_name', 'Cizí')))::text),
    'invalid_guest', 'host cizí svatby se do domácnosti nepřidá');
  perform tap.throws(format('select se_vezmou.admin_household_save(%L, %L::jsonb)', v_h, jsonb_build_object('label', 'x',
    'guests', jsonb_build_array(jsonb_build_object('id', tap.u('A:guest1'), 'display_name', 'Jiná domácnost')))::text),
    'invalid_guest', 'host jiné domácnosti se nepřevede');
  perform tap.throws(format('select se_vezmou.admin_household_save(null, %L::jsonb)', jsonb_build_object('label', repeat('x', 201),
    'guests', jsonb_build_array(jsonb_build_object('display_name', 'Host')))::text), '22023', 'příliš dlouhý štítek se odmítne');
  perform tap.reset();

  perform tap.eq((select count(*) from se_vezmou.guests where wedding_id = tap.wb()), v_b_guests, 'svatba B: počet hostů beze změny');
  perform tap.eq((select count(*) from se_vezmou.households where wedding_id = tap.wb()), v_b_households, 'svatba B: počet domácností beze změny');
end
$$;

-- ---------------------------------------------------------------------------
-- Smazání domácnosti: odpověď i pozvání zmizí, cizí domácnost nejde smazat, audit bez jmen
-- ---------------------------------------------------------------------------
do $$
begin
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.throws(format('select se_vezmou.admin_household_delete(%L)', tap.u('B:household')), 'household_not_found', 'cizí domácnost nejde smazat');
  perform se_vezmou.admin_household_delete(tap.u('A:household'));
  perform tap.throws(format('select se_vezmou.admin_household_delete(%L)', tap.u('A:household')), 'household_not_found', 'smazaná domácnost už neexistuje');
  perform tap.reset();
  perform tap.eq((select count(*) from se_vezmou.guests where household_id = tap.u('A:household')), 0, 'delete: hosté zmizeli');
  perform tap.eq((select count(*) from se_vezmou.rsvp_responses where household_id = tap.u('A:household')), 0, 'delete: odpověď zmizela');
  perform tap.eq((select count(*) from se_vezmou.rsvp_health where wedding_id = tap.wa()), 0, 'delete: zdravotní údaje zmizely');
  perform tap.eq((select count(*) from se_vezmou.invitations where wedding_id = tap.wa() and guest_id in (tap.u('A:guest1'), tap.u('A:guest2'))), 0, 'delete: pozvání zmizela');
  perform tap.eq((select count(*) from se_vezmou.guests where wedding_id = tap.wb()), 2, 'svatba B: hosté zůstali');
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where wedding_id = tap.wa() and action = 'guests.household_delete'
                          and meta = '{"guests": 2, "answered": true}'), 'delete: audit nese jen počty');
end
$$;

-- ---------------------------------------------------------------------------
-- Import: přidává, výchozí pozvání, hranice a limity
-- ---------------------------------------------------------------------------
do $$
declare
  r jsonb;
  v_before bigint;
begin
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  r := se_vezmou.admin_guests_import(jsonb_build_object(
    'nonce', gen_random_uuid(), 'invited_event_ids', jsonb_build_array(tap.u('A:event1')),
    'households', jsonb_build_array(
      jsonb_build_object('label', 'Novákovi', 'guests', jsonb_build_array(
        jsonb_build_object('display_name', 'Jan Novák', 'is_child', false),
        jsonb_build_object('display_name', 'Eva Nováková', 'is_child', false),
        jsonb_build_object('display_name', 'Tomáš Novák', 'is_child', true, 'age', 5))),
      jsonb_build_object('label', '', 'guests', jsonb_build_array(
        jsonb_build_object('display_name', 'Petra Samotná', 'is_child', false))))));
  perform tap.reset();
  perform tap.ok(r = '{"households": 2, "guests": 4, "skipped": 0, "duplicate": false}', 'import: vrací počty');
  perform tap.eq((select count(*) from se_vezmou.guests where wedding_id = tap.wa() and source = 'import'), 4, 'import: zdroj import');
  perform tap.eq((select count(*) from se_vezmou.invitations i join se_vezmou.guests g on g.id = i.guest_id
                   where g.wedding_id = tap.wa() and g.source = 'import' and i.event_id = tap.u('A:event1')), 4, 'import: výchozí pozvání na obřad');
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where wedding_id = tap.wa() and action = 'guests.import'
                          and meta = '{"households": 2, "guests": 4, "skipped": 0}'), 'import: audit nese jen počty');

  -- neplatný řádek zruší celý import (transakce)
  v_before := (select count(*) from se_vezmou.guests where wedding_id = tap.wa());
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.throws('select se_vezmou.admin_guests_import(''{"households": [{"label": "a", "guests": [{"display_name": "Dobrý"}]}, {"label": "b", "guests": [{"display_name": ""}]}]}'')',
    '22023', 'import s neplatným řádkem se odmítne');
  perform tap.throws('select se_vezmou.admin_guests_import(''{"households": []}'')', '22023', 'prázdný import se odmítne');
  perform tap.throws(format('select se_vezmou.admin_guests_import(%L::jsonb)', jsonb_build_object('nonce', gen_random_uuid(), 'invited_event_ids', jsonb_build_array(tap.u('B:event1')),
    'households', jsonb_build_array(jsonb_build_object('label', 'a', 'guests', jsonb_build_array(jsonb_build_object('display_name', 'Host')))))::text),
    'invalid_event', 'import s událostí cizí svatby se odmítne');
  -- limit hostů na svatbu
  perform tap.throws((select format('select se_vezmou.admin_guests_import(%L::jsonb)', jsonb_build_object('nonce', gen_random_uuid(), 'include_duplicates', true, 'households',
      (select jsonb_agg(jsonb_build_object('label', 'h' || h, 'guests',
         (select jsonb_agg(jsonb_build_object('display_name', 'Host ' || h || '-' || g)) from generate_series(1, 20) g)))
         from generate_series(1, 76) h))::text)),
    'guest_limit_exceeded', 'import nad strop hostů na svatbu se odmítne');
  perform tap.reset();
  perform tap.eq((select count(*) from se_vezmou.guests where wedding_id = tap.wa()), v_before, 'odmítnutý import nic nezapsal');
end
$$;

-- ---------------------------------------------------------------------------
-- Hromadné pozvání na událost
-- ---------------------------------------------------------------------------
do $$
declare
  v_total bigint := (select count(*) from se_vezmou.guests where wedding_id = tap.wa());
  v_b bigint := (select count(*) from se_vezmou.invitations where wedding_id = tap.wb());
begin
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform se_vezmou.admin_invitations_bulk(tap.u('A:event2'), true);
  perform tap.reset();
  perform tap.eq((select count(*) from se_vezmou.invitations where wedding_id = tap.wa() and event_id = tap.u('A:event2')), v_total,
    'bulk: všichni hosté jsou pozváni na událost');
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform se_vezmou.admin_invitations_bulk(tap.u('A:event2'), false);
  perform tap.throws(format('select se_vezmou.admin_invitations_bulk(%L, true)', tap.u('B:event1')), 'invalid_event', 'bulk: událost cizí svatby se odmítne');
  perform tap.reset();
  perform tap.eq((select count(*) from se_vezmou.invitations where wedding_id = tap.wa() and event_id = tap.u('A:event2')), 0, 'bulk: pozvání se dají zrušit');
  perform tap.eq((select count(*) from se_vezmou.invitations where wedding_id = tap.wb()), v_b, 'bulk: pozvání svatby B beze změny');
end
$$;

-- ---------------------------------------------------------------------------
-- Nastavení RSVP: otevření, otázky, host mimo seznam
-- ---------------------------------------------------------------------------
do $$
declare
  j jsonb;
  v_q uuid;
begin
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  j := se_vezmou.admin_rsvp_settings_get();
  perform tap.reset();
  perform tap.ok(j #>> '{settings,enabled_questions,plus_one}' = 'true', 'settings_get: vlastní nastavení');
  perform tap.ok(jsonb_array_length(j -> 'events') = 2 and j::text not like '%Svoboda%', 'settings_get: události jen vlastní svatby');

  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  j := se_vezmou.admin_rsvp_settings_save(jsonb_build_object(
    'opens_at', '2027-01-01T00:00:00+01:00', 'closes_at', '2027-06-01T00:00:00+02:00',
    'allow_unlisted', true, 'email_confirmation', true,
    'enabled_questions', '{"plus_one": false, "children": true, "diet": true, "lodging": true, "neznamy": true}'::jsonb,
    'questions', jsonb_build_array(
      jsonb_build_object('key', 'doprava_bus', 'type', 'bool', 'label', '{"cs": "Pojedete autobusem?"}'::jsonb,
        'required', false, 'enabled', true),
      jsonb_build_object('key', 'menu', 'type', 'choice', 'label', '{"cs": "Menu", "en": "Menu"}'::jsonb,
        'options', '[{"value": "maso", "label": {"cs": "Maso"}}, {"value": "ryba", "label": {"cs": "Ryba"}}]'::jsonb,
        'required', true, 'event_id', tap.u('A:event2'), 'enabled', true))));
  perform tap.reset();
  perform tap.ok((select allow_unlisted and email_confirmation and closes_at is not null from se_vezmou.rsvp_settings where wedding_id = tap.wa()),
    'settings_save: hodnoty se uloží');
  perform tap.ok(jsonb_array_length(j) = 2 and exists (
      select 1 from jsonb_array_elements(j) x
        join se_vezmou.rsvp_questions q on q.id = (x ->> 'id')::uuid and q.key = x ->> 'key' and q.wedding_id = tap.wa()
       where x ->> 'key' = 'menu'), 'settings_save: vrací identifikátory otázek podle klíče');
  perform tap.ok((select enabled_questions from se_vezmou.rsvp_settings where wedding_id = tap.wa())
    = '{"children": true, "diet": true, "lodging": true, "plus_one": false}'::jsonb, 'settings_save: neznámý příznak se zahodí');
  perform tap.eq((select count(*) from se_vezmou.rsvp_questions where wedding_id = tap.wa()), 2, 'settings_save: otázky se nahradí (původní zmizela)');
  select id into v_q from se_vezmou.rsvp_questions where wedding_id = tap.wa() and key = 'menu';
  perform tap.ok((select event_id from se_vezmou.rsvp_questions where id = v_q) = tap.u('A:event2'), 'settings_save: otázka vázaná na událost');

  -- úprava existující otázky podle id, klíč zůstává
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform se_vezmou.admin_rsvp_settings_save(jsonb_build_object(
    'opens_at', null, 'closes_at', null, 'allow_unlisted', false, 'email_confirmation', false,
    'enabled_questions', '{}'::jsonb,
    'questions', jsonb_build_array(
      jsonb_build_object('id', v_q, 'key', 'zmenene', 'type', 'text', 'label', '{"cs": "Alergie na jídlo?"}'::jsonb,
        'required', false, 'enabled', false))));
  perform tap.reset();
  perform tap.ok((select key = 'menu' and type = 'text' and not enabled and options is null
                    from se_vezmou.rsvp_questions where id = v_q), 'settings_save: klíč otázky se nemění, typ a stav ano');
  perform tap.eq((select count(*) from se_vezmou.rsvp_questions where wedding_id = tap.wa()), 1, 'settings_save: nezmíněné otázky se smažou');

  -- neplatné vstupy
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.throws('select se_vezmou.admin_rsvp_settings_save(''{"opens_at": "2027-06-02T00:00:00Z", "closes_at": "2027-06-01T00:00:00Z", "allow_unlisted": false, "email_confirmation": false, "enabled_questions": {}}'')',
    'invalid_period', 'uzavření před otevřením se odmítne');
  perform tap.throws('select se_vezmou.admin_rsvp_settings_save(''{"opens_at": "nesmysl", "closes_at": null, "allow_unlisted": false, "email_confirmation": false, "enabled_questions": {}}'')',
    '22023', 'neplatné datum se odmítne');
  perform tap.throws('select se_vezmou.admin_rsvp_settings_save(''{"allow_unlisted": false, "email_confirmation": false, "enabled_questions": {}, "questions": [{"key": "diet", "type": "text", "label": {"cs": "x"}, "required": false, "enabled": true}]}'')',
    'invalid_question', 'vyhrazený klíč otázky se odmítne');
  perform tap.throws('select se_vezmou.admin_rsvp_settings_save(''{"allow_unlisted": false, "email_confirmation": false, "enabled_questions": {}, "questions": [{"key": "Velke", "type": "text", "label": {"cs": "x"}, "required": false, "enabled": true}]}'')',
    'invalid_question', 'neplatný klíč otázky se odmítne');
  perform tap.throws('select se_vezmou.admin_rsvp_settings_save(''{"allow_unlisted": false, "email_confirmation": false, "enabled_questions": {}, "questions": [{"key": "vyber", "type": "choice", "label": {"cs": "x"}, "options": [{"value": "a", "label": {"cs": "A"}}], "required": false, "enabled": true}]}'')',
    '22023', 'výběr s jednou možností se odmítne');
  perform tap.throws(format('select se_vezmou.admin_rsvp_settings_save(%L::jsonb)', jsonb_build_object('allow_unlisted', false,
    'email_confirmation', false, 'enabled_questions', '{}'::jsonb, 'questions', jsonb_build_array(jsonb_build_object('key', 'k', 'type', 'text',
    'label', '{"cs": "x"}'::jsonb, 'required', false, 'enabled', true, 'event_id', tap.u('B:event1'))))::text), 'invalid_event', 'otázka s událostí cizí svatby se odmítne');
  perform tap.throws(format('select se_vezmou.admin_rsvp_settings_save(%L::jsonb)', jsonb_build_object('allow_unlisted', false,
    'email_confirmation', false, 'enabled_questions', '{}'::jsonb, 'questions', jsonb_build_array(jsonb_build_object('id', tap.u('B:cizi'), 'type', 'text',
    'label', '{"cs": "x"}'::jsonb, 'required', false, 'enabled', true)))::text), 'invalid_question', 'cizí otázka se nepřepíše');
  perform tap.throws(format('select se_vezmou.admin_rsvp_settings_save(%L::jsonb)', jsonb_build_object('allow_unlisted', false,
    'email_confirmation', false, 'enabled_questions', '{}'::jsonb, 'questions', (select jsonb_agg(jsonb_build_object('key', 'q' || g, 'type', 'text',
    'label', '{"cs": "x"}'::jsonb, 'required', false, 'enabled', true)) from generate_series(1, 11) g))::text), '22023', 'víc než deset otázek se odmítne');
  perform tap.reset();

  -- svatba B nezměněna
  perform tap.ok((select enabled_questions from se_vezmou.rsvp_settings where wedding_id = tap.wb()) = '{"plus_one": true, "diet": true}'::jsonb
                 and (select count(*) from se_vezmou.rsvp_questions where wedding_id = tap.wb()) = 1, 'svatba B: nastavení RSVP beze změny');
end
$$;

-- ---------------------------------------------------------------------------
-- Přístup: načtení stavu bez hashů a cizích údajů
-- ---------------------------------------------------------------------------
do $$
declare
  j jsonb;
begin
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  j := se_vezmou.admin_access_load();
  perform tap.reset();
  perform tap.ok(jsonb_array_length(j -> 'admins') = 1 and (j #>> '{admins,0,is_me}')::boolean, 'access_load: jediný správce a jsem to já');
  perform tap.ok((j ->> 'has_admin_pin')::boolean and (j ->> 'has_guest_pin')::boolean, 'access_load: PINy jen jako příznaky');
  perform tap.ok(j::text not like '%hash-%' and j::text not like '%b-spravce%' and j::text not like '%druha-svatba%', 'access_load: žádné hashe ani cizí údaje');
  perform tap.ok((j ->> 'max_admins')::integer = 3, 'access_load: strop správců z nastavení');
  perform tap.ok(jsonb_array_length(j -> 'grants') = 1 and not (j #>> '{grants,0,active}')::boolean, 'access_load: dřívější souhlas je neaktivní');
  perform tap.ok(j ->> 'backup_email' = 'a-zaloha@example.test', 'access_load: záložní e-mail vlastní svatby');
end
$$;

-- ---------------------------------------------------------------------------
-- Správci: přidání (strop, duplicita, oznámení), odebrání (ne sebe, relace)
-- ---------------------------------------------------------------------------
do $$
declare
  r jsonb;
  v_id uuid;
begin
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.throws('select se_vezmou.admin_admin_add(''bez-zavinace'')', 'invalid_email', 'neplatný e-mail se odmítne');
  r := se_vezmou.admin_admin_add('  Druhy@Example.Test ');
  perform tap.reset();
  v_id := (r ->> 'id')::uuid;
  perform tap.ok((select email::text from se_vezmou.wedding_admins where id = v_id) = 'druhy@example.test', 'admin_add: adresa se normalizuje');
  perform tap.ok((select added_by from se_vezmou.wedding_admins where id = v_id) = tap.u('A:admin'), 'admin_add: eviduje, kdo přidal');
  perform tap.ok(r -> 'notify' @> '"a-spravce@example.test"'::jsonb and r -> 'notify' @> '"a-zaloha@example.test"'::jsonb
                 and not (r -> 'notify' @> '"druhy@example.test"'::jsonb), 'admin_add: oznámit ostatním správcům a na záložní adresu, ne novému');
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where wedding_id = tap.wa() and action = 'admin.add'
                          and meta = '{"admins_after": 2}' and target_id = v_id), 'admin_add: audit bez adresy');

  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.throws('select se_vezmou.admin_admin_add(''DRUHY@example.test'')', 'admin_exists', 'stejná adresa podruhé se odmítne');
  perform se_vezmou.admin_admin_add('treti@example.test');
  perform tap.throws('select se_vezmou.admin_admin_add(''ctvrty@example.test'')', 'max_admins_exceeded', 'strop počtu správců');
  perform tap.reset();

  -- relace odebíraného správce
  insert into se_vezmou.sessions (token_hash, kind, wedding_id, subject_id, idle_seconds, idle_expires_at, absolute_expires_at)
  values (sha256(convert_to('token-druhy', 'UTF8')), 'admin', tap.wa(), v_id, 1209600, now() + interval '14 days', now() + interval '60 days');

  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.throws(format('select se_vezmou.admin_admin_remove(%L)', tap.u('A:admin')), 'cannot_remove_self', 'sám sebe správce neodebere');
  perform tap.throws(format('select se_vezmou.admin_admin_remove(%L)', tap.u('B:admin')), 'admin_not_found', 'správce svatby B nejde odebrat');
  r := se_vezmou.admin_admin_remove(v_id);
  perform tap.reset();
  perform tap.ok(r ->> 'removed' = 'druhy@example.test' and r -> 'notify' @> '"a-zaloha@example.test"'::jsonb
                 and not (r -> 'notify' @> '"druhy@example.test"'::jsonb), 'admin_remove: vrací odebranou adresu a adresy k oznámení');
  perform tap.ok((select removed_at is not null from se_vezmou.wedding_admins where id = v_id), 'admin_remove: správce je odebrán');
  perform tap.ok((select revoked_at is not null from se_vezmou.sessions where subject_id = v_id), 'admin_remove: relace odebraného správce jsou odvolány');
  perform tap.ok((select removed_at is null from se_vezmou.wedding_admins where id = tap.u('B:admin')), 'svatba B: správce zůstal');
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where wedding_id = tap.wa() and action = 'admin.remove' and meta = '{"admins_after": 2}'),
    'admin_remove: audit bez adresy');

  -- po odebrání je místo pro dalšího
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform se_vezmou.admin_admin_add('druhy@example.test');
  perform tap.reset();
  perform tap.eq((select count(*) from se_vezmou.wedding_admins where wedding_id = tap.wa() and removed_at is null), 3, 'admin_add: odebranou adresu lze přidat znovu');
end
$$;

-- ---------------------------------------------------------------------------
-- Záložní e-mail
-- ---------------------------------------------------------------------------
do $$
declare
  r jsonb;
begin
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.throws('select se_vezmou.admin_backup_email_set(''nesmysl'')', 'invalid_email', 'neplatný záložní e-mail');
  r := se_vezmou.admin_backup_email_set('Nova-Zaloha@Example.Test');
  perform tap.ok((r ->> 'changed')::boolean and r ->> 'old' = 'a-zaloha@example.test', 'backup: vrací starou adresu');
  perform tap.ok(not (se_vezmou.admin_backup_email_set('nova-zaloha@example.test') ->> 'changed')::boolean, 'backup: stejná adresa nic nemění');
  perform tap.reset();
  perform tap.ok((select backup_email::text from se_vezmou.wedding_auth where wedding_id = tap.wa()) = 'nova-zaloha@example.test', 'backup: uloženo');
  perform tap.ok((select backup_email::text from se_vezmou.wedding_auth where wedding_id = tap.wb()) = 'b-zaloha@example.test', 'svatba B: záložní e-mail beze změny');
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where wedding_id = tap.wa() and action = 'auth.backup_changed' and meta = '{}'),
    'backup: audit bez adres');
  perform tap.ok((select backup_email_confirmed_at is null from se_vezmou.wedding_auth where wedding_id = tap.wa()),
    'backup: nová adresa je nepotvrzená');
  -- adresa se potvrdí (potvrzovací krok v rozhraní zatím chybí, proto přímo v databázi), další oznámení už na ni chodí
  update se_vezmou.wedding_auth set backup_email_confirmed_at = now() where wedding_id = tap.wa();
end
$$;

-- ---------------------------------------------------------------------------
-- PIN hostů: zapnutí a vypnutí
-- ---------------------------------------------------------------------------
do $$
declare
  v_b_pin boolean := (select guest_pin_enabled from se_vezmou.weddings where id = tap.wb());
begin
  insert into se_vezmou.sessions (token_hash, kind, wedding_id, subject_id, idle_seconds, idle_expires_at, absolute_expires_at)
  values (sha256(convert_to('guest-token-A', 'UTF8')), 'guest_pin', tap.wa(), null, 3600, now() + interval '1 hour', now() + interval '1 day');

  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform se_vezmou.admin_guest_pin_enabled_set(false);
  perform tap.reset();
  perform tap.ok(not (select guest_pin_enabled from se_vezmou.weddings where id = tap.wa()), 'guest_pin: vypnuto');
  perform tap.ok((select revoked_at is not null from se_vezmou.sessions where wedding_id = tap.wa() and kind = 'guest_pin'),
    'guest_pin: vypnutí ukončí relace hostů');
  perform tap.ok((select revoked_at is null from se_vezmou.sessions where wedding_id = tap.wa() and kind = 'admin' and subject_id = tap.u('A:admin')),
    'guest_pin: relace správce zůstává');

  update se_vezmou.wedding_auth set guest_pin_hash = null where wedding_id = tap.wa();
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.throws('select se_vezmou.admin_guest_pin_enabled_set(true)', 'pin_missing', 'bez PINu hostů nejde zapnout');
  perform tap.reset();
  update se_vezmou.wedding_auth set guest_pin_hash = 'hash-guest-A' where wedding_id = tap.wa();
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform se_vezmou.admin_guest_pin_enabled_set(true);
  perform tap.reset();
  perform tap.ok((select guest_pin_enabled from se_vezmou.weddings where id = tap.wa()), 'guest_pin: zapnuto s nastaveným PINem');
  perform tap.ok((select guest_pin_enabled from se_vezmou.weddings where id = tap.wb()) = v_b_pin, 'svatba B: PIN hostů beze změny');
end
$$;

-- ---------------------------------------------------------------------------
-- Souhlas s nahlédnutím provozovatele: udělení, nahrazení, odvolání, vazba na op_view_guest_data
-- ---------------------------------------------------------------------------
do $$
declare
  r jsonb;
  v_g1 uuid;
  v_g2 uuid;
  v_n bigint;
begin
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.throws('select se_vezmou.grant_operator_access(''  '', 3)', 'reason_required', 'bez důvodu se souhlas neudělí');
  perform tap.throws('select se_vezmou.grant_operator_access(''Pomoc s importem'', 0)', 'invalid_period', 'platnost 0 dní se odmítne');
  perform tap.throws('select se_vezmou.grant_operator_access(''Pomoc s importem'', 31)', 'invalid_period', 'platnost nad 30 dní se odmítne');
  r := se_vezmou.grant_operator_access('Pomoc s importem', 3);
  v_g1 := (r ->> 'id')::uuid;
  perform tap.reset();
  perform tap.ok((select scope = 'guest_data' and revoked_at is null and expires_at > now() + interval '2 days 23 hours'
                    and granted_by_admin_id = tap.u('A:admin') from se_vezmou.data_access_grants where id = v_g1), 'grant: souhlas s platností a autorem');
  perform tap.ok(r -> 'notify' @> '"a-spravce@example.test"'::jsonb and r -> 'notify' @> '"nova-zaloha@example.test"'::jsonb, 'grant: adresy k oznámení');
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where wedding_id = tap.wa() and action = 'operator_access.grant'
                          and meta = '{"days": 3}' and reason is null), 'grant: audit bez důvodu a adres');

  -- operátor teď smí nahlédnout (aktivní souhlas) a audit nahlédnutí vznikne
  set local role service_role;
  select count(*) into v_n from se_vezmou.op_view_guest_data(tap.u('operator:owner'), tap.wa(), 'Řešení potíží s importem');
  perform tap.reset();
  perform tap.ok(v_n > 0, 'op_view_guest_data: se souhlasem vrací hosty');

  -- nový souhlas nahradí předchozí
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  v_g2 := (se_vezmou.grant_operator_access('Druhá pomoc', 1) ->> 'id')::uuid;
  perform tap.reset();
  perform tap.ok((select revoked_at is not null from se_vezmou.data_access_grants where id = v_g1), 'grant: nový souhlas odvolá předchozí');
  perform tap.eq((select count(*) from se_vezmou.data_access_grants where wedding_id = tap.wa() and revoked_at is null and expires_at > now()), 1,
    'grant: jediný aktivní souhlas');

  -- odvolání a přehled nahlédnutí
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.throws(format('select se_vezmou.revoke_operator_access(%L)', tap.u('B:grant-neexistuje')), 'grant_not_found', 'neexistující souhlas');
  perform tap.throws(format('select se_vezmou.revoke_operator_access(%L)', v_g1), 'grant_not_found', 'už odvolaný souhlas');
  r := se_vezmou.revoke_operator_access(v_g2);
  perform tap.ok(jsonb_array_length(r -> 'notify') >= 2, 'revoke: adresy k oznámení');
  perform tap.ok(jsonb_array_length(se_vezmou.admin_access_load() -> 'operator_views') = 1
                 and se_vezmou.admin_access_load() #>> '{operator_views,0,action}' = 'guest_data.view'
                 and se_vezmou.admin_access_load() #>> '{operator_views,0,reason}' = 'Řešení potíží s importem', 'přehled nahlédnutí: akce a důvod operátora');
  perform tap.reset();
  set local role service_role;
  select count(*) into v_n from se_vezmou.op_view_guest_data(tap.u('operator:owner'), tap.wa(), 'Po odvolání');
  perform tap.reset();
  perform tap.eq(v_n, 0, 'op_view_guest_data: po odvolání souhlasu nevrací nic');

  -- správce svatby B cizí souhlas neodvolá
  insert into se_vezmou.data_access_grants (id, wedding_id, granted_by_admin_id, reason, expires_at)
  values (tap.u('A:grant-aktivni'), tap.wa(), tap.u('A:admin'), 'Aktivní', now() + interval '2 days');
  perform tap.become('authenticated', tap.wb(), 'admin', tap.u('B:admin'));
  perform tap.throws(format('select se_vezmou.revoke_operator_access(%L)', tap.u('A:grant-aktivni')), 'grant_not_found', 'správce B neodvolá souhlas svatby A');
  perform tap.ok(jsonb_array_length(se_vezmou.admin_access_load() -> 'grants') = 1, 'správce B vidí jen vlastní souhlasy');
  perform tap.reset();
end
$$;

-- ---------------------------------------------------------------------------
-- Adresáti oznámení o nahlédnutí (service role)
-- ---------------------------------------------------------------------------
do $$
declare
  v_n bigint;
begin
  set local role service_role;
  select count(*) into v_n from se_vezmou.guest_data_notice_recipients(tap.wa());
  perform tap.reset();
  perform tap.eq(v_n, 4, 'recipients: tři aktivní správci a záložní adresa');
  set local role service_role;
  perform tap.ok(not exists (select 1 from se_vezmou.guest_data_notice_recipients(tap.wa()) where email like 'b-%'), 'recipients: nic ze svatby B');
  perform tap.reset();
end
$$;

-- ---------------------------------------------------------------------------
-- Smazání webu správcem
-- ---------------------------------------------------------------------------
do $$
declare
  r jsonb;
begin
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  r := se_vezmou.admin_wedding_delete();
  perform tap.reset();
  perform tap.ok((select status = 'deleted' and deleted_at is not null and purge_at > now() from se_vezmou.weddings where id = tap.wa()),
    'wedding_delete: stav deleted s lhůtou k trvalému smazání');
  perform tap.ok(r ->> 'purge_at' is not null and jsonb_array_length(r -> 'notify') >= 2, 'wedding_delete: vrací lhůtu a adresy k oznámení');
  perform tap.eq((select count(*) from se_vezmou.sessions where wedding_id = tap.wa() and revoked_at is null), 0, 'wedding_delete: všechny relace jsou odvolány');
  perform tap.ok(exists (select 1 from se_vezmou.wedding_status_history where wedding_id = tap.wa() and to_status = 'deleted' and actor_type = 'admin'),
    'wedding_delete: záznam v historii stavů');
  perform tap.ok((select status from se_vezmou.weddings where id = tap.wb()) = 'published', 'svatba B: beze změny');
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.ok(se_vezmou.get_public_site() is null, 'wedding_delete: veřejný web zmizel');
  perform tap.reset();
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.throws('select se_vezmou.admin_wedding_delete()', 'wedding_not_found', 'podruhé nejde smazat');
  perform tap.reset();
end
$$;

-- ---------------------------------------------------------------------------
-- Audit zásahů M7b neobsahuje osobní údaje (jména hostů, e-maily, texty)
-- ---------------------------------------------------------------------------
do $$
begin
  perform tap.ok(not exists (select 1 from se_vezmou.audit_log
    where wedding_id = tap.wa()
      and action in ('guests.household_save', 'guests.household_delete', 'guests.import', 'guests.invite_bulk', 'rsvp.settings_save',
                     'admin.add', 'admin.remove', 'auth.backup_changed', 'guest_pin.enabled', 'guest_pin.disabled',
                     'operator_access.grant', 'operator_access.revoke', 'wedding.delete')
      and (meta::text ~* '(Karel|Dvořák|Novák|@|example|Pomoc|Druhá)' or coalesce(reason, '') <> '')),
    'audit správy hostů a přístupu nenese jména, adresy ani důvody');
end
$$;

rollback;
