-- Opravy z revize kódu (migrace 20261010...): čítač chybných kódů přežije vyžádání nového kódu,
-- nepotvrzený záložní e-mail nedostává oznámení, idempotentní odpověď hosta mimo seznam a import hostů,
-- zveřejnění vázané na revizi pracovní kopie.
begin;
select tap.seed();

-- ---------------------------------------------------------------------------
-- 1. Chybné kódy se počítají na e-mail a účel, ne na výzvu
-- ---------------------------------------------------------------------------
do $$
declare
  v_email bytea := sha256(convert_to('hmac:obet@example.test', 'UTF8'));
  v_other bytea := sha256(convert_to('hmac:jina@example.test', 'UTF8'));
  v_code bytea := sha256(convert_to('123456', 'UTF8'));
  v_wrong bytea := sha256(convert_to('000000', 'UTF8'));
  v_bucket text := 'challenge:admin_login:' || encode(sha256(convert_to('hmac:obet@example.test', 'UTF8')), 'hex');
  r record;
begin
  set local role service_role;

  -- 4 chyby, nová výzva, další chyby: čítač se nenuluje vyžádáním kódu
  perform se_vezmou.auth_create_challenge(v_email, 'admin_login', v_code);
  for i in 1..4 loop
    perform se_vezmou.auth_verify_challenge(v_email, 'admin_login', v_wrong);
  end loop;
  select * into r from se_vezmou.auth_lockout_state(v_bucket);
  perform tap.ok(not r.locked, 'čtyři chyby ještě pauzu nespustí');

  perform se_vezmou.auth_create_challenge(v_email, 'admin_login', v_code);
  perform se_vezmou.auth_verify_challenge(v_email, 'admin_login', v_wrong);
  select * into r from se_vezmou.auth_lockout_state(v_bucket);
  perform tap.ok(r.locked and r.retry_after between 1 and 900,
    'pátá chyba napříč dvěma výzvami spustí pauzu 15 minut (nové vyžádání čítač nenulovalo)');

  -- v pauze neprojde ani správný kód, ani nová výzva
  perform se_vezmou.auth_create_challenge(v_email, 'admin_login', v_code);
  perform tap.ok(not se_vezmou.auth_verify_challenge(v_email, 'admin_login', v_code),
    'během pauzy neprojde ani správný kód');

  -- jiný e-mail a jiný účel jsou nezávislé
  perform se_vezmou.auth_create_challenge(v_other, 'admin_login', v_code);
  perform tap.ok(se_vezmou.auth_verify_challenge(v_other, 'admin_login', v_code), 'jiný e-mail pauzou není dotčen');
  perform se_vezmou.auth_create_challenge(v_email, 'wizard_create', v_code);
  perform tap.ok(se_vezmou.auth_verify_challenge(v_email, 'wizard_create', v_code), 'jiný účel pauzou není dotčen');
  perform tap.reset();

  -- po skončení pauzy se kód znovu ověřuje; další série má dvojnásobnou pauzu
  update se_vezmou.lockouts set locked_until = now() - interval '1 second' where bucket_key = v_bucket;
  set local role service_role;
  perform se_vezmou.auth_create_challenge(v_email, 'admin_login', v_code);
  for i in 1..4 loop
    perform se_vezmou.auth_verify_challenge(v_email, 'admin_login', v_wrong);
  end loop;
  perform se_vezmou.auth_create_challenge(v_email, 'admin_login', v_code);
  perform se_vezmou.auth_verify_challenge(v_email, 'admin_login', v_wrong);
  select * into r from se_vezmou.auth_lockout_state(v_bucket);
  perform tap.ok(r.locked and r.retry_after between 901 and 1800, 'druhá série chyb: pauza se zdvojnásobí (30 minut)');
  perform tap.reset();

  -- úspěšné ověření čítač nuluje
  delete from se_vezmou.lockouts where bucket_key = v_bucket;
  set local role service_role;
  perform se_vezmou.auth_create_challenge(v_email, 'admin_login', v_code);
  for i in 1..3 loop
    perform se_vezmou.auth_verify_challenge(v_email, 'admin_login', v_wrong);
  end loop;
  perform tap.ok(se_vezmou.auth_verify_challenge(v_email, 'admin_login', v_code), 'správný kód po třech chybách projde');
  perform tap.reset();
  perform tap.ok(not exists (select 1 from se_vezmou.lockouts where bucket_key = v_bucket), 'úspěch čítač chyb smaže');
  -- klíč čítače nenese e-mail ani kód, jen HMAC e-mailu
  perform tap.ok(not exists (select 1 from se_vezmou.lockouts where bucket_key like '%obet%'), 'čítač neobsahuje e-mail');
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Záložní e-mail: oznámení jen potvrzené adrese
-- ---------------------------------------------------------------------------
do $$
declare
  j jsonb;
  r record;
  v_ok boolean;
begin
  -- fixtura A má potvrzenou adresu: PIN i seznamy adresátů ji nesou
  set local role service_role;
  select * into r from se_vezmou.auth_pin_get('klara-a-matej', 'admin');
  perform tap.ok(r.backup_email = 'a-zaloha@example.test', 'potvrzená záložní adresa se vrací');
  perform tap.reset();

  update se_vezmou.wedding_auth set backup_email_confirmed_at = null where wedding_id = tap.wa();
  set local role service_role;
  select * into r from se_vezmou.auth_pin_get('klara-a-matej', 'admin');
  perform tap.ok(r.pin_hash is not null and r.backup_email is null, 'nepotvrzená adresa se nevrací (PIN dál funguje)');
  perform tap.ok(se_vezmou.auth_pin_set(tap.wa(), 'admin', '$argon2id$v=19$m=1,t=1,p=1$x$y') is null,
    'změna PINu nevrací nepotvrzenou adresu');
  perform tap.eq((select count(*) from se_vezmou.guest_data_notice_recipients(tap.wa()) where email like '%zaloha%'), 0,
    'příjemci oznámení o nahlédnutí neobsahují nepotvrzenou adresu');
  perform tap.reset();

  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  j := se_vezmou.admin_access_load();
  perform tap.ok(j ->> 'backup_email' = 'a-zaloha@example.test' and (j ->> 'backup_confirmed')::boolean = false,
    'správce vidí adresu a že není potvrzená');
  j := se_vezmou.admin_admin_add('novy-spravce@example.test');
  perform tap.ok(not (j -> 'notify' @> '"a-zaloha@example.test"'::jsonb), 'přidání správce: nepotvrzená záložní adresa se neoznamuje');
  perform tap.reset();

  -- potvrzení: jen shodná adresa, jen jednou, jen service_role
  set local role service_role;
  perform tap.ok(not se_vezmou.auth_backup_email_confirm(tap.wa(), 'cizi@example.test'), 'jiná adresa se nepotvrdí');
  perform tap.ok(se_vezmou.auth_backup_email_confirm(tap.wa(), ' A-Zaloha@Example.test '), 'shodná adresa se potvrdí (bez ohledu na velikost písmen)');
  perform tap.ok(not se_vezmou.auth_backup_email_confirm(tap.wa(), 'a-zaloha@example.test'), 'podruhé se nepotvrzuje');
  select * into r from se_vezmou.auth_pin_get('klara-a-matej', 'admin');
  perform tap.ok(r.backup_email = 'a-zaloha@example.test', 'potvrzená adresa se zase vrací');
  perform tap.reset();
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.throws('select se_vezmou.auth_backup_email_confirm(tap.wa(), ''a-zaloha@example.test'')', '42501',
    'správce si adresu sám nepotvrdí');
  perform tap.reset();

  -- změna adresy potvrzení zruší; stará potvrzená adresa se oznámí, nová ne
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  j := se_vezmou.admin_backup_email_set('nova-zaloha@example.test');
  perform tap.ok(j ->> 'old' = 'a-zaloha@example.test', 'změna: potvrzená stará adresa se vrací k oznámení');
  perform tap.reset();
  perform tap.ok((select backup_email_confirmed_at is null from se_vezmou.wedding_auth where wedding_id = tap.wa()),
    'nová adresa je nepotvrzená');
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  j := se_vezmou.admin_backup_email_set('treti-zaloha@example.test');
  perform tap.ok(j -> 'old' = 'null'::jsonb, 'změna: nepotvrzená stará adresa se k oznámení nevrací');
  perform tap.reset();
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Odpověď hosta mimo seznam je idempotentní (nonce)
-- ---------------------------------------------------------------------------
do $$
declare
  v_nonce uuid := gen_random_uuid();
  v_att jsonb := jsonb_build_array(jsonb_build_object('event_id', tap.u('A:event1'), 'attending', true));
  v_payload jsonb;
  r1 jsonb;
  r2 jsonb;
begin
  update se_vezmou.rsvp_settings set allow_unlisted = true, closes_at = null where wedding_id = tap.wa();
  v_payload := jsonb_build_object('nonce', v_nonce, 'answers', '{}'::jsonb,
    'people', jsonb_build_array(jsonb_build_object('person_name', 'Karel Cizí', 'attendance', v_att)));

  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.throws(format('select se_vezmou.rsvp_submit_unlisted(%L::jsonb)', (v_payload - 'nonce')::text),
    'invalid_payload', 'bez nonce se odpověď mimo seznam odmítne');
  perform tap.throws(format('select se_vezmou.rsvp_submit_unlisted(%L::jsonb)', (v_payload || '{"nonce": "x"}')::text),
    'invalid_payload', 'chybný nonce se odmítne');
  r1 := se_vezmou.rsvp_submit_unlisted(v_payload);
  r2 := se_vezmou.rsvp_submit_unlisted(v_payload);
  perform tap.reset();
  perform tap.ok((r1 ->> 'duplicate')::boolean = false and (r2 ->> 'duplicate')::boolean = true
                 and r1 ->> 'response_id' = r2 ->> 'response_id', 'druhé odeslání téhož nonce vrátí tutéž odpověď jako duplicitu');
  perform tap.eq((select count(*) from se_vezmou.rsvp_responses where wedding_id = tap.wa() and household_id is null), 1,
    'dvojité odeslání vytvořilo jedinou odpověď');
  perform tap.eq((select count(*) from se_vezmou.rsvp_people p join se_vezmou.rsvp_responses r on r.id = p.response_id
                   where r.wedding_id = tap.wa() and r.nonce = v_nonce), 1, 'a jedinou osobu');

  -- jiný nonce je jiná odpověď; stejný nonce u jiné svatby není duplicita
  perform tap.become('authenticated', tap.wa(), 'visitor');
  r2 := se_vezmou.rsvp_submit_unlisted(v_payload || jsonb_build_object('nonce', gen_random_uuid()));
  perform tap.reset();
  perform tap.ok(not (r2 ->> 'duplicate')::boolean, 'jiný nonce je nová odpověď');
  perform tap.eq((select count(*) from se_vezmou.rsvp_responses where wedding_id = tap.wa() and household_id is null), 2, 'dvě odlišné odpovědi');

  -- jednoznačnost vynucuje databáze
  perform tap.throws(format('insert into se_vezmou.rsvp_responses (wedding_id, nonce) values (%L, %L)', tap.wa(), v_nonce),
    '23505', 'unikátní (wedding_id, nonce)');

  -- uzavřené RSVP: opakování už uložené odpovědi dál vrací duplicitu (host nevidí chybu), nový nonce se odmítne
  update se_vezmou.rsvp_settings set closes_at = now() - interval '1 minute' where wedding_id = tap.wa();
  perform tap.become('authenticated', tap.wa(), 'visitor');
  r2 := se_vezmou.rsvp_submit_unlisted(v_payload);
  perform tap.ok((r2 ->> 'duplicate')::boolean, 'po uzavření opakování uložené odpovědi stále uspěje jako duplicita');
  perform tap.throws(format('select se_vezmou.rsvp_submit_unlisted(%L::jsonb)', (v_payload || jsonb_build_object('nonce', gen_random_uuid()))::text),
    'rsvp_closed', 'po uzavření se nová odpověď odmítne');
  perform tap.reset();
  update se_vezmou.rsvp_settings set closes_at = null where wedding_id = tap.wa();
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Import hostů: idempotence dávky a kontrola duplicit pod zámkem svatby
-- ---------------------------------------------------------------------------
do $$
declare
  v_nonce uuid := gen_random_uuid();
  v_payload jsonb;
  r1 jsonb;
  r2 jsonb;
  v_before bigint := (select count(*) from se_vezmou.guests where wedding_id = tap.wa());
begin
  v_payload := jsonb_build_object('nonce', v_nonce, 'include_duplicates', false,
    'households', jsonb_build_array(
      jsonb_build_object('label', 'Dvořákovi', 'guests', jsonb_build_array(
        jsonb_build_object('display_name', 'Adam Dvořák'),
        jsonb_build_object('display_name', 'dvořák   adam'),
        jsonb_build_object('display_name', 'Beata Dvořáková'))),
      jsonb_build_object('label', '', 'guests', jsonb_build_array(
        jsonb_build_object('display_name', 'Adam Dvořák')))));

  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.throws(format('select se_vezmou.admin_guests_import(%L::jsonb)', (v_payload - 'nonce')::text),
    'invalid_payload', 'import bez nonce se odmítne');
  r1 := se_vezmou.admin_guests_import(v_payload);
  r2 := se_vezmou.admin_guests_import(v_payload);
  perform tap.reset();
  perform tap.ok(r1 = '{"households": 1, "guests": 2, "skipped": 2, "duplicate": false}',
    'import: duplicity v dávce (jiné pořadí slov, opakování ve dvou domácnostech) se přeskočí');
  perform tap.ok(r2 = '{"households": 1, "guests": 2, "skipped": 2, "duplicate": true}', 'opakování dávky vrátí její výsledek');
  perform tap.eq((select count(*) from se_vezmou.guests where wedding_id = tap.wa()), v_before + 2, 'opakování dávky nic nepřidalo');
  perform tap.eq((select count(*) from se_vezmou.guest_import_batches where wedding_id = tap.wa() and nonce = v_nonce), 1, 'dávka je evidována jednou');

  -- host, který už v seznamu je (jiný import, ruční zápis), se přeskočí; s include_duplicates se přidá
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  r1 := se_vezmou.admin_guests_import(jsonb_build_object('nonce', gen_random_uuid(),
    'households', jsonb_build_array(jsonb_build_object('label', 'x', 'guests',
      jsonb_build_array(jsonb_build_object('display_name', 'Dvořáková Beata'))))));
  r2 := se_vezmou.admin_guests_import(jsonb_build_object('nonce', gen_random_uuid(), 'include_duplicates', true,
    'households', jsonb_build_array(jsonb_build_object('label', 'x', 'guests',
      jsonb_build_array(jsonb_build_object('display_name', 'Dvořáková Beata'))))));
  perform tap.reset();
  perform tap.ok(r1 = '{"households": 0, "guests": 0, "skipped": 1, "duplicate": false}', 'existující host se přeskočí, prázdná domácnost nevznikne');
  perform tap.ok(r2 = '{"households": 1, "guests": 1, "skipped": 0, "duplicate": false}', 'include_duplicates duplicitu přidá');

  -- nonce je po svatbách nezávislé
  perform tap.become('authenticated', tap.wb(), 'admin', tap.u('B:admin'));
  r2 := se_vezmou.admin_guests_import(v_payload);
  perform tap.reset();
  perform tap.ok(not (r2 ->> 'duplicate')::boolean, 'stejný nonce u jiné svatby je nová dávka');
end
$$;

rollback;
