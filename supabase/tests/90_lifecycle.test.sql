-- Relace a výzvy (auth_*), limit správců, retenční spouštěče a mazání, výmaz hosta, životní cyklus,
-- normalizace jmen (zlaté vektory), doména i18n_text a drobná pravidla schématu.
begin;
select tap.seed();

-- ---------------------------------------------------------------------------
-- Zlaté vektory normalizace jmen (sdílený soubor, TypeScript src/domain/names je musí splnit také)
-- ---------------------------------------------------------------------------
create temp table name_vectors (input text, norm text, key text);
\copy name_vectors from 'supabase/tests/golden/name-vectors.tsv'
do $$
declare
  r record;
  v_count integer := 0;
begin
  for r in select * from name_vectors loop
    v_count := v_count + 1;
    perform tap.ok(se_vezmou.normalize_name(r.input) = r.norm, format('normalize_name(%L) = %L (získáno %L)', r.input, r.norm, se_vezmou.normalize_name(r.input)));
    perform tap.ok(se_vezmou.name_key(r.input) = r.key, format('name_key(%L) = %L (získáno %L)', r.input, r.key, se_vezmou.name_key(r.input)));
  end loop;
  perform tap.ok(v_count >= 10, 'načteno aspoň 10 zlatých vektorů');
  -- generované sloupce guests
  perform tap.ok((select name_norm || '|' || name_key from se_vezmou.guests where id = tap.u('A:guest2')) = 'marie novakova|marie novakova',
    'guests.name_norm a name_key jsou generované');
end
$$;

-- ---------------------------------------------------------------------------
-- auth_*: relace
-- ---------------------------------------------------------------------------
do $$
declare
  v_hash bytea := sha256(convert_to('nova-relace', 'UTF8'));
  v_id uuid;
  r record;
  v_seen timestamptz;
begin
  set local role service_role;
  v_id := se_vezmou.auth_create_session('admin', tap.wa(), tap.u('A:admin'), v_hash, 1209600, 5184000);
  perform tap.ok(v_id is not null, 'relace správce se vytvoří');
  select * into r from se_vezmou.auth_validate_session(v_hash);
  perform tap.ok(r.wedding_id = tap.wa() and r.kind = 'admin' and r.subject_id = tap.u('A:admin') and r.session_id = v_id, 'platná relace se ověří a nese svatbu a správce');
  perform tap.eq((select count(*) from se_vezmou.auth_validate_session(sha256(convert_to('neznama', 'UTF8')))), 0, 'neznámý token se neověří');
  perform tap.reset();
  perform tap.ok((select last_login_at from se_vezmou.wedding_admins where id = tap.u('A:admin')) is not null, 'last_login_at správce se nastavilo');

  -- klouzavé okno se zapisuje nejvýše jednou za 5 minut
  select last_seen_at into v_seen from se_vezmou.sessions where token_hash = v_hash;
  set local role service_role;
  perform count(*) from se_vezmou.auth_validate_session(v_hash);
  perform tap.reset();
  perform tap.ok((select last_seen_at from se_vezmou.sessions where token_hash = v_hash) = v_seen, 'čerstvá relace se při ověření nepřepisuje');
  update se_vezmou.sessions set last_seen_at = now() - interval '10 minutes', idle_expires_at = now() + interval '1 day' where token_hash = v_hash;
  set local role service_role;
  perform count(*) from se_vezmou.auth_validate_session(v_hash);
  perform tap.reset();
  perform tap.ok((select last_seen_at from se_vezmou.sessions where token_hash = v_hash) > now() - interval '1 minute', 'stará relace se prodlouží');
  perform tap.ok((select idle_expires_at from se_vezmou.sessions where token_hash = v_hash) > now() + interval '13 days', 'okno nečinnosti se prodlouží o idle_seconds');
  perform tap.ok((select idle_expires_at <= absolute_expires_at from se_vezmou.sessions where token_hash = v_hash), 'okno nepřekročí absolutní platnost');

  -- vypršení nečinností, absolutní platnost, odvolání
  update se_vezmou.sessions set idle_expires_at = now() - interval '1 second' where token_hash = v_hash;
  set local role service_role;
  perform tap.eq((select count(*) from se_vezmou.auth_validate_session(v_hash)), 0, 'relace po nečinnosti neplatí');
  perform tap.reset();
  update se_vezmou.sessions set idle_expires_at = now() + interval '1 day', absolute_expires_at = now() - interval '1 second' where token_hash = v_hash;
  set local role service_role;
  perform tap.eq((select count(*) from se_vezmou.auth_validate_session(v_hash)), 0, 'relace po absolutní platnosti neplatí');
  perform tap.reset();
  update se_vezmou.sessions set absolute_expires_at = now() + interval '1 day' where token_hash = v_hash;
  set local role service_role;
  perform tap.eq((select count(*) from se_vezmou.auth_validate_session(v_hash)), 1, 'relace je opět platná');
  perform tap.ok(se_vezmou.auth_revoke_session(v_hash), 'relace se odvolá');
  perform tap.ok(not se_vezmou.auth_revoke_session(v_hash), 'odvolání odvolané relace nic nezmění');
  perform tap.eq((select count(*) from se_vezmou.auth_validate_session(v_hash)), 0, 'odvolaná relace neplatí');
  perform tap.reset();

  -- odebraný správce ani smazaná svatba relaci nepřežijí
  set local role service_role;
  v_id := se_vezmou.auth_create_session('admin', tap.wa(), tap.u('A:admin'), v_hash || '\x01', 3600, 7200);
  perform tap.reset();
  update se_vezmou.wedding_admins set removed_at = now() where id = tap.u('A:admin');
  set local role service_role;
  perform tap.eq((select count(*) from se_vezmou.auth_validate_session(v_hash || '\x01')), 0, 'relace odebraného správce neplatí');
  perform tap.throws(format('select se_vezmou.auth_create_session(''admin'', %L, %L, ''\x03'', 60, 120)', tap.wa(), tap.u('A:admin')), 'admin_not_found', 'odebranému správci se relace nevydá');
  perform tap.reset();
  update se_vezmou.wedding_admins set removed_at = null where id = tap.u('A:admin');

  -- neplatné argumenty, správce cizí svatby
  set local role service_role;
  perform tap.throws(format('select se_vezmou.auth_create_session(''admin'', %L, %L, ''\x04'', 60, 120)', tap.wa(), tap.u('B:admin')), 'admin_not_found', 'správce jiné svatby nemůže mít relaci v této svatbě');
  perform tap.throws(format('select se_vezmou.auth_create_session(''root'', %L, null, ''\x05'', 60, 120)', tap.wa()), '22023', 'neznámý druh relace se odmítne');
  perform tap.throws(format('select se_vezmou.auth_create_session(''admin'', %L, %L, ''\x06'', 120, 60)', tap.wa(), tap.u('A:admin')), '22023', 'absolutní platnost kratší než nečinnost se odmítne');
  -- relace hosta po PINu jen když je PIN zapnutý
  perform tap.throws(format('select se_vezmou.auth_create_session(''guest_pin'', %L, null, ''\x07'', 60, 120)', tap.wa()), '42501', 'relace hosta bez zapnutého PINu se nevydá');
  perform tap.reset();
  update se_vezmou.weddings set guest_pin_enabled = true where id = tap.wa();
  set local role service_role;
  perform tap.ok(se_vezmou.auth_create_session('guest_pin', tap.wa(), null, '\x08', 3600, 7200) is not null, 'relace hosta po PINu se vydá při zapnutém PINu');
  perform tap.throws(format('select se_vezmou.auth_create_session(''guest_pin'', %L, %L, ''\x09'', 60, 120)', tap.wa(), tap.u('A:admin')), '42501', 'relace hosta nesmí nést správce');

  -- hromadné odvolání
  perform tap.ok(se_vezmou.auth_revoke_sessions(tap.wa(), null) >= 1, 'všechny relace svatby se odvolají');
  perform tap.eq((select count(*) from se_vezmou.auth_validate_session('\x08')), 0, 'odvolaná relace hosta neplatí');
  perform tap.reset();
  perform tap.ok(not exists (select 1 from se_vezmou.sessions where wedding_id = tap.wb() and revoked_at is not null), 'relace svatby B zůstaly');
end
$$;

-- ---------------------------------------------------------------------------
-- auth_*: výzvy (kód z e-mailu)
-- ---------------------------------------------------------------------------
do $$
declare
  v_email bytea := sha256(convert_to('hmac:jan@example.test', 'UTF8'));
  v_code bytea := sha256(convert_to('123456', 'UTF8'));
  v_wrong bytea := sha256(convert_to('000000', 'UTF8'));
  v_id uuid;
begin
  set local role service_role;
  perform se_vezmou.auth_create_challenge(v_email, 'admin_login', v_code);
  perform tap.ok(not se_vezmou.auth_verify_challenge(v_email, 'admin_login', v_wrong), 'špatný kód se neověří');
  perform tap.ok(se_vezmou.auth_verify_challenge(v_email, 'admin_login', v_code), 'správný kód se ověří');
  perform tap.ok(not se_vezmou.auth_verify_challenge(v_email, 'admin_login', v_code), 'kód je jednorázový');
  perform tap.ok(not se_vezmou.auth_verify_challenge(v_email, 'operator_recovery', v_code), 'kód platí jen pro svůj účel');
  perform tap.ok(not se_vezmou.auth_verify_challenge(sha256('x'), 'admin_login', v_code), 'kód platí jen pro svůj e-mail');

  -- po 5 chybách se výzva zneplatní i pro správný kód
  perform se_vezmou.auth_create_challenge(v_email, 'admin_login', v_code);
  for i in 1..5 loop
    perform se_vezmou.auth_verify_challenge(v_email, 'admin_login', v_wrong);
  end loop;
  perform tap.ok(not se_vezmou.auth_verify_challenge(v_email, 'admin_login', v_code), 'po 5 chybných pokusech se výzva zneplatní');

  -- nová výzva zneplatní předchozí
  perform se_vezmou.auth_create_challenge(v_email, 'admin_login', v_wrong);
  perform se_vezmou.auth_create_challenge(v_email, 'admin_login', v_code);
  perform tap.ok(not se_vezmou.auth_verify_challenge(v_email, 'admin_login', v_wrong), 'starší výzva po vydání nové neplatí');
  perform tap.ok(se_vezmou.auth_verify_challenge(v_email, 'admin_login', v_code), 'nejnovější výzva platí');
  perform tap.throws(format('select se_vezmou.auth_create_challenge(%L, ''admin_login'', %L, 0)', v_email, v_code), '22023', 'neplatná délka platnosti se odmítne');
  perform tap.reset();

  -- prošlá výzva
  update se_vezmou.login_challenges set consumed_at = null, expires_at = now() - interval '1 second' where email_hash = v_email;
  set local role service_role;
  perform tap.ok(not se_vezmou.auth_verify_challenge(v_email, 'admin_login', v_code), 'prošlá výzva se neověří');
  perform tap.reset();

  -- svatby správce podle e-mailu (nezávisle na velikosti písmen), jen aktivní správci
  set local role service_role;
  perform tap.eq((select count(*) from se_vezmou.auth_list_admin_weddings('A-Spravce@Example.test')), 1, 'e-mail správce najde jeho svatbu bez ohledu na velikost písmen');
  perform tap.eq((select count(*) from se_vezmou.auth_list_admin_weddings('neznamy@example.test')), 0, 'neznámý e-mail nenajde nic');
  perform tap.reset();
  update se_vezmou.wedding_admins set removed_at = now() where id = tap.u('A:admin');
  set local role service_role;
  perform tap.eq((select count(*) from se_vezmou.auth_list_admin_weddings('a-spravce@example.test')), 0, 'odebraný správce svatbu nenajde');
  perform tap.reset();
  update se_vezmou.wedding_admins set removed_at = null where id = tap.u('A:admin');
end
$$;

-- ---------------------------------------------------------------------------
-- Limit počtu správců (max_admins, tvrdý strop 5)
-- ---------------------------------------------------------------------------
do $$
begin
  insert into se_vezmou.wedding_admins (wedding_id, email) values (tap.wa(), 'druhy@example.test'), (tap.wa(), 'treti@example.test');
  perform tap.eq((select count(*) from se_vezmou.wedding_admins where wedding_id = tap.wa() and removed_at is null), 3, 'tři správci jsou povoleni');
  perform tap.throws(format('insert into se_vezmou.wedding_admins (wedding_id, email) values (%L, ''ctvrty@example.test'')', tap.wa()), 'max_admins_exceeded', 'čtvrtý správce se odmítne');

  -- odebraný správce uvolní místo
  update se_vezmou.wedding_admins set removed_at = now() where wedding_id = tap.wa() and email = 'treti@example.test';
  insert into se_vezmou.wedding_admins (wedding_id, email) values (tap.wa(), 'ctvrty@example.test');
  perform tap.ok(true, 'po odebrání správce se místo uvolní');

  -- obnovení odebraného správce nad limit selže
  perform tap.throws(format('update se_vezmou.wedding_admins set removed_at = null where wedding_id = %L and email = ''treti@example.test''', tap.wa()), 'max_admins_exceeded',
    'obnovení správce nad limit se odmítne');

  -- hodnota z nastavení; tvrdý strop 5 platí vždy
  -- hodnotu 10 by spouštěč app_settings_validate (meze nastavení) odmítl; pro tuto kontrolu tvrdého stropu ho vypneme
  alter table se_vezmou.app_settings disable trigger app_settings_validate;
  update se_vezmou.app_settings set value = '10' where key = 'max_admins';
  alter table se_vezmou.app_settings enable trigger app_settings_validate;
  update se_vezmou.wedding_admins set removed_at = null where wedding_id = tap.wa() and email = 'treti@example.test';
  insert into se_vezmou.wedding_admins (wedding_id, email) values (tap.wa(), 'paty@example.test');
  perform tap.throws(format('insert into se_vezmou.wedding_admins (wedding_id, email) values (%L, ''sesty@example.test'')', tap.wa()), 'max_admins_exceeded', 'tvrdý strop 5 platí i při vyšší hodnotě v nastavení');
  -- limit se počítá po svatbách: svatba B má vlastní správce
  insert into se_vezmou.wedding_admins (wedding_id, email) values (tap.wb(), 'druhy-b@example.test');
  perform tap.eq((select count(*) from se_vezmou.wedding_admins where wedding_id = tap.wb() and removed_at is null), 2, 'limit správců se počítá zvlášť pro každou svatbu');
end
$$;

do $$
begin
  -- duplicitní aktivní e-mail v jedné svatbě; stejný e-mail v jiné svatbě je v pořádku
  perform tap.throws(format('insert into se_vezmou.wedding_admins (wedding_id, email) values (%L, ''B-SPRAVCE@example.test'')', tap.wb()), '23505', 'e-mail správce je v rámci svatby unikátní bez ohledu na velikost písmen');
  update se_vezmou.wedding_admins set removed_at = now() where wedding_id = tap.wa() and email = 'paty@example.test';
  insert into se_vezmou.wedding_admins (wedding_id, email) values (tap.wa(), 'b-spravce@example.test');
  perform tap.ok(true, 'stejný e-mail může být správcem v jiné svatbě');
end
$$;

rollback;

begin;
select tap.seed();

-- ---------------------------------------------------------------------------
-- Retenční data (kap. 3.1, 10): odvozují se z konce svatby v pásmu svatby
-- ---------------------------------------------------------------------------
do $$
declare
  w uuid := tap.u('R:wedding');
begin
  insert into se_vezmou.weddings (id, partner_a_name, partner_b_name, starts_on, timezone)
  values (w, 'Radka', 'Rudolf', date '2027-06-12', 'Europe/Prague');
  perform tap.ok((select (health_purge_at at time zone 'Europe/Prague')::date from se_vezmou.weddings where id = w) = date '2027-07-12',
    'zdravotní údaje: 30 dní po svatbě');
  perform tap.ok((select health_purge_at at time zone 'Europe/Prague' from se_vezmou.weddings where id = w) = timestamp '2027-07-12 00:00',
    'lhůta se počítá v pásmu svatby (půlnoc v Praze)');
  perform tap.ok((select (guest_purge_at at time zone 'Europe/Prague')::date from se_vezmou.weddings where id = w) = date '2028-06-12',
    'údaje hostů: 12 měsíců po svatbě');

  -- vícedenní svatba: počítá se od ends_on
  update se_vezmou.weddings set ends_on = date '2027-06-14' where id = w;
  perform tap.ok((select (health_purge_at at time zone 'Europe/Prague')::date from se_vezmou.weddings where id = w) = date '2027-07-14', 'vícedenní svatba: lhůta od ends_on');
  perform tap.ok((select (guest_purge_at at time zone 'Europe/Prague')::date from se_vezmou.weddings where id = w) = date '2028-06-14', 'vícedenní svatba: lhůta hostů od ends_on');

  -- bez data svatby není co mazat
  update se_vezmou.weddings set ends_on = null, starts_on = null where id = w;
  perform tap.ok((select health_purge_at is null and guest_purge_at is null from se_vezmou.weddings where id = w), 'bez data svatby jsou lhůty null');

  -- prodloužení operátorem se přepočtem nepřepíše, dokud se nezmění data
  update se_vezmou.weddings set starts_on = date '2027-06-12' where id = w;
  update se_vezmou.weddings set health_purge_at = health_purge_at + interval '60 days' where id = w;
  perform tap.ok((select (health_purge_at at time zone 'Europe/Prague')::date from se_vezmou.weddings where id = w) = date '2027-09-10', 'ruční prodloužení lhůty platí');
  update se_vezmou.weddings set quick_notice_enabled = true where id = w;
  perform tap.ok((select (health_purge_at at time zone 'Europe/Prague')::date from se_vezmou.weddings where id = w) = date '2027-09-10', 'nesouvisející změna prodloužení nepřepíše');

  -- změna lhůty v nastavení se projeví u nových přepočtů, nikoli v kódu
  update se_vezmou.app_settings set value = '10' where key = 'health_retention_days_after_wedding';
  update se_vezmou.app_settings set value = '6' where key = 'guest_retention_months_after_wedding';
  insert into se_vezmou.weddings (id, partner_a_name, partner_b_name, starts_on) values (tap.u('S:wedding'), 'Sára', 'Samuel', date '2027-01-10');
  perform tap.ok((select (health_purge_at at time zone 'Europe/Prague')::date from se_vezmou.weddings where id = tap.u('S:wedding')) = date '2027-01-20', 'lhůta zdravotních údajů z app_settings');
  perform tap.ok((select (guest_purge_at at time zone 'Europe/Prague')::date from se_vezmou.weddings where id = tap.u('S:wedding')) = date '2027-07-10', 'lhůta údajů hostů z app_settings');

  perform tap.throws('insert into se_vezmou.weddings (partner_a_name, partner_b_name, timezone) values (''A'', ''B'', ''Mars/Olympus'')', '22023', 'neplatné časové pásmo se odmítne');
end
$$;

-- ---------------------------------------------------------------------------
-- Mazání podle retence: purge_health_data, purge_guest_data
-- ---------------------------------------------------------------------------
do $$
declare
  v_rows integer;
begin
  update se_vezmou.weddings set health_purge_at = now() - interval '1 day' where id = tap.wa();
  set local role service_role;
  v_rows := se_vezmou.purge_health_data();
  perform tap.reset();
  perform tap.eq(v_rows, 1, 'retence smazala zdravotní údaje svatby A');
  perform tap.eq((select count(*) from se_vezmou.rsvp_health where wedding_id = tap.wa()), 0, 'zdravotní údaje A jsou pryč');
  perform tap.eq((select count(*) from se_vezmou.rsvp_health where wedding_id = tap.wb()), 1, 'zdravotní údaje B zůstaly (lhůta nenastala)');
  perform tap.eq((select count(*) from se_vezmou.guests where wedding_id = tap.wa()), 2, 'hosté A zůstali (jiná lhůta)');
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where wedding_id = tap.wa() and action = 'retention.purge' and meta = '{"kind": "health", "rows": 1}'),
    'mazání je v auditu jen s počtem řádků');
  set local role service_role;
  perform tap.eq(se_vezmou.purge_health_data(), 0, 'opakované spuštění je idempotentní');
  perform tap.reset();

  update se_vezmou.weddings set guest_purge_at = now() - interval '1 day' where id = tap.wb();
  set local role service_role;
  v_rows := se_vezmou.purge_guest_data();
  perform tap.reset();
  perform tap.ok(v_rows >= 8, 'retence smazala údaje hostů svatby B (' || v_rows || ' řádků)');
  perform tap.eq((select count(*) from se_vezmou.guests where wedding_id = tap.wb()), 0, 'hosté B jsou pryč');
  perform tap.eq((select count(*) from se_vezmou.households where wedding_id = tap.wb()), 0, 'domácnosti B jsou pryč');
  perform tap.eq((select count(*) from se_vezmou.rsvp_responses where wedding_id = tap.wb()) + (select count(*) from se_vezmou.rsvp_people where wedding_id = tap.wb())
    + (select count(*) from se_vezmou.rsvp_attendance where wedding_id = tap.wb()) + (select count(*) from se_vezmou.rsvp_tickets where wedding_id = tap.wb()), 0,
    'odpovědi, osoby, účast a lístky B jsou pryč');
  perform tap.eq((select count(*) from se_vezmou.guests where wedding_id = tap.wa()), 2, 'hosté A zůstali');
  perform tap.eq((select count(*) from se_vezmou.pages where wedding_id = tap.wb()), 1, 'obsah webu B zůstal');
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where wedding_id = tap.wb() and action = 'retention.purge' and meta ->> 'kind' = 'guests'), 'mazání hostů je v auditu');
end
$$;

-- ---------------------------------------------------------------------------
-- erase_guest: výmaz hosta na žádost (správce)
-- ---------------------------------------------------------------------------
do $$
declare
  v_result jsonb;
begin
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.throws(format('select se_vezmou.erase_guest(%L)', tap.u('A:guest1')), '42501', 'návštěvník nevymaže hosta');
  perform tap.reset();

  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.throws(format('select se_vezmou.erase_guest(%L)', tap.u('B:guest1')), 'guest_not_found', 'správce A nevymaže hosta svatby B');
  v_result := se_vezmou.erase_guest(tap.u('A:guest1'));
  perform tap.reset();
  perform tap.ok(v_result = '{"rsvp_people": 1, "household_deleted": false}', 'výmaz prvního hosta: osoba smazána, domácnost zůstává');
  perform tap.eq((select count(*) from se_vezmou.guests where id = tap.u('A:guest1')), 0, 'host je smazán');
  perform tap.eq((select count(*) from se_vezmou.rsvp_people where guest_id = tap.u('A:guest1')), 0, 'jeho osoba v RSVP je smazána');
  perform tap.eq((select count(*) from se_vezmou.guests where id = tap.u('A:guest2')), 1, 'druhý člen domácnosti zůstal');

  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  v_result := se_vezmou.erase_guest(tap.u('A:guest2'));
  perform tap.reset();
  perform tap.ok((v_result ->> 'household_deleted')::boolean, 'výmaz posledního člena smaže domácnost');
  perform tap.eq((select count(*) from se_vezmou.households where wedding_id = tap.wa()), 0, 'prázdná domácnost je pryč');
  perform tap.eq((select count(*) from se_vezmou.rsvp_responses where wedding_id = tap.wa()), 0, 'odpověď prázdné domácnosti je pryč');
  perform tap.eq((select count(*) from se_vezmou.audit_log where wedding_id = tap.wa() and action = 'guest.erase' and actor_type = 'admin' and actor_id = tap.u('A:admin')), 2,
    'výmazy jsou v auditu s identifikátorem správce');
  perform tap.ok(not exists (select 1 from se_vezmou.audit_log where action = 'guest.erase' and meta::text ilike '%Novák%'), 'audit výmazu neobsahuje jména');
end
$$;

-- ---------------------------------------------------------------------------
-- Životní cyklus: účinky změny stavu
-- ---------------------------------------------------------------------------
do $$
begin
  update se_vezmou.weddings set status = 'deleted' where id = tap.wa();
  perform tap.ok((select deleted_at is not null and purge_at > now() + interval '29 days' and purge_at < now() + interval '31 days' from se_vezmou.weddings where id = tap.wa()),
    'smazání nastaví deleted_at a purge_at podle deleted_site_restore_days');
  update se_vezmou.weddings set status = 'published' where id = tap.wa();
  perform tap.ok((select deleted_at is null and purge_at is null from se_vezmou.weddings where id = tap.wa()), 'obnova vynuluje deleted_at a purge_at');
  update se_vezmou.weddings set status = 'blocked' where id = tap.wa();
  perform tap.ok((select blocked_at is not null from se_vezmou.weddings where id = tap.wa()), 'blokace nastaví blocked_at');
  update se_vezmou.weddings set status = 'published' where id = tap.wa();
  perform tap.ok((select blocked_at is null from se_vezmou.weddings where id = tap.wa()), 'odblokování vynuluje blocked_at');
  perform tap.throws(format('update se_vezmou.weddings set status = ''published'', published_version_id = null where id = %L', tap.wa()), '23514', 'zveřejněný web musí mít zveřejněnou verzi');
  perform tap.throws(format('update se_vezmou.weddings set status = ''nesmysl'' where id = %L', tap.wa()), '23514', 'neplatný stav se odmítne');
end
$$;

-- ---------------------------------------------------------------------------
-- Verze webu: číslování a neměnnost
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into se_vezmou.site_versions (id, wedding_id, kind, public_content) values (v_id, tap.wa(), 'checkpoint', '{"a": 1}');
  perform tap.eq((select version_no from se_vezmou.site_versions where id = v_id), 2, 'další verze dostane další číslo');
  perform tap.throws(format('update se_vezmou.site_versions set public_content = ''{"a": 2}'' where id = %L', v_id), 'immutable', 'obsah verze se nepřepisuje');
  perform tap.throws(format('update se_vezmou.site_versions set version_no = 9 where id = %L', v_id), 'immutable', 'číslo verze se nemění');
  update se_vezmou.site_versions set note = 'Poznámka' where id = v_id;
  perform tap.ok(true, 'poznámku k verzi změnit lze');
  perform tap.throws(format('insert into se_vezmou.site_versions (wedding_id, version_no, kind, public_content) values (%L, 2, ''publish'', ''{}'')', tap.wa()), '23505', 'číslo verze je v rámci svatby unikátní');
  perform tap.throws(format('delete from se_vezmou.site_versions where id = %L', tap.u('A:version')), '23503', 'zveřejněnou verzi nelze smazat');
end
$$;

-- ---------------------------------------------------------------------------
-- Drobná pravidla schématu: i18n_text, alt u médií, pořadí bloků, plus
-- ---------------------------------------------------------------------------
do $$
begin
  perform tap.throws(format('insert into se_vezmou.pages (wedding_id, path, title) values (%L, ''x'', ''{"de": "Haus"}'')', tap.wa()), '23514', 'i18n_text odmítne jazyk mimo cs a en');
  perform tap.throws(format('insert into se_vezmou.pages (wedding_id, path, title) values (%L, ''x2'', ''[1]'')', tap.wa()), '23514', 'i18n_text odmítne jiný typ než objekt');
  insert into se_vezmou.pages (wedding_id, path, title) values (tap.wa(), 'ubytovani', '{"cs": "Ubytování", "en": "Lodging"}');
  perform tap.ok(true, 'i18n_text přijme cs a en');

  -- M7c: médium bez popisku a bez příznaku dekorativní lze uložit (po nahrání čeká na popisek), na web se nedostane
  -- (kontrola při sestavení snímku); u karty externí galerie je dekorativní povinné
  insert into se_vezmou.media (wedding_id, storage_path, mime) values (tap.wa(), 'a/b.webp', 'image/webp');
  perform tap.ok(true, 'médium bez popisku se uloží (zveřejnění ho vynechá)');
  perform tap.throws(format('insert into se_vezmou.media (wedding_id, storage_path, mime, kind, decorative) values (%L, ''a/k.webp'', ''image/webp'', ''card'', false)', tap.wa()), '23514', 'obrázek karty je vždy dekorativní');
  insert into se_vezmou.media (wedding_id, storage_path, mime, decorative) values (tap.wa(), 'a/d.webp', 'image/webp', true);
  perform tap.ok(true, 'dekorativní médium alt nepotřebuje');
  perform tap.throws(format('insert into se_vezmou.media (wedding_id, storage_path, mime, decorative) values (%L, ''a/e.svg'', ''image/svg+xml'', true)', tap.wa()), '23514', 'SVG od uživatele se odmítne');

  -- pořadí bloků: dva bloky lze přehodit v jedné transakci (odložená unikátnost)
  set constraints se_vezmou.content_blocks_page_position_key deferred;
  update se_vezmou.content_blocks set position = 2 where id = tap.u('A:block1');
  update se_vezmou.content_blocks set position = 1 where id = tap.u('A:block2');
  set constraints se_vezmou.content_blocks_page_position_key immediate;
  perform tap.ok((select position from se_vezmou.content_blocks where id = tap.u('A:block1')) = 2
                 and (select position from se_vezmou.content_blocks where id = tap.u('A:block2')) = 1, 'bloky se dají přehodit');
  -- dva bloky na stejné pozici se při potvrzení odmítnou
  set constraints se_vezmou.content_blocks_page_position_key deferred;
  insert into se_vezmou.content_blocks (wedding_id, page_id, type, position, anchor)
  values (tap.wa(), tap.u('A:page'), 'faq', 1, 'faq');
  perform tap.throws('set constraints se_vezmou.content_blocks_page_position_key immediate', '23505', 'duplicitní pozice bloku se při potvrzení odmítne');
end
$$;

-- Úklid prošlých záznamů
do $$
declare
  v_result jsonb;
begin
  update se_vezmou.sessions set absolute_expires_at = now() - interval '1 day' where wedding_id = tap.wa();
  insert into se_vezmou.households (id, wedding_id, label) values (tap.u('A:household3'), tap.wa(), 'Pro lístek');
  insert into se_vezmou.rsvp_tickets (token_hash, wedding_id, household_id, expires_at)
  values ('\x0a', tap.wa(), tap.u('A:household3'), now() - interval '1 hour');
  insert into se_vezmou.login_challenges (email_hash, purpose, code_hash, expires_at)
  values ('\x01', 'admin_login', '\x02', now() - interval '3 days');
  set local role service_role;
  v_result := se_vezmou.housekeeping();
  perform tap.reset();
  perform tap.ok((v_result ->> 'sessions')::int >= 1 and (v_result ->> 'rsvp_tickets')::int >= 1 and (v_result ->> 'login_challenges')::int >= 1,
    'housekeeping smazal prošlé relace, lístky a výzvy: ' || v_result::text);
  perform tap.eq((select count(*) from se_vezmou.sessions where wedding_id = tap.wa()), 0, 'prošlé relace jsou pryč');
  perform tap.eq((select count(*) from se_vezmou.sessions where wedding_id = tap.wb()), 1, 'platné relace zůstaly');
end
$$;

-- app_settings pro aplikaci: jen service role přes funkci
do $$
begin
  set local role service_role;
  perform tap.ok((select count(*) from se_vezmou.get_app_settings()) >= 10, 'get_app_settings vrací nastavení');
  perform tap.reset();
  perform tap.become('authenticated', tap.wa(), 'admin');
  perform tap.throws('select * from se_vezmou.get_app_settings()', '42501', 'správce nečte nastavení přes funkci');
  perform tap.throws('select * from se_vezmou.app_settings', '42501', 'správce nečte app_settings přímo');
  perform tap.reset();
end
$$;

rollback;
