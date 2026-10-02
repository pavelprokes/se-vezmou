-- M9: přihlášení operátorů bez Supabase Auth (docs/adr/0012): relace operátora, druhý faktor TOTP, záložní kódy.
-- Šifrování klíče TOTP a výpočet kódů dělá aplikace; databáze drží šifrový text, časový krok a hashe.
begin;
select tap.seed();

-- Práva: funkce jen pro service_role, operátorské tabulky nikdo nečte přímo
do $$
declare
  v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'se_vezmou'::regnamespace and p.proname like 'auth\_operator\_%'
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')
          or not has_function_privilege('service_role', p.oid, 'execute'));
  perform tap.ok(v_bad is null, 'auth_operator_* spouští jen service_role (porušuje: ' || coalesce(v_bad, '-') || ')');

  perform tap.become('authenticated', tap.wa(), 'admin');
  perform tap.throws('select count(*) from se_vezmou.operator_sessions', '42501', 'správce nečte operátorské relace');
  perform tap.throws('select count(*) from se_vezmou.operator_backup_codes', '42501', 'správce nečte záložní kódy');
  perform tap.throws('select count(*) from se_vezmou.operators', '42501', 'správce nečte operátory');
  perform tap.throws(format('select * from se_vezmou.auth_operator_validate_session(%L)', '\x01'::bytea), '42501',
    'správce nevolá auth_operator_validate_session');
  perform tap.reset();

  set local role service_role;
  perform tap.throws('select count(*) from se_vezmou.operator_sessions', '42501', 'service_role nečte relace operátorů přímo');
  perform tap.throws('select totp_secret_enc from se_vezmou.operators', '42501', 'service_role nečte šifrovaný klíč přímo');
  perform tap.reset();
end
$$;

-- Vyhledání operátora: aktivní ano, zakázaný a neznámý ne; porovnání bez ohledu na velikost písmen
do $$
begin
  set local role service_role;
  perform tap.eq((select count(*) from se_vezmou.auth_operator_find('Majitel@Example.test')), 1, 'aktivní operátor se najde (bez ohledu na velikost písmen)');
  perform tap.ok((select role from se_vezmou.auth_operator_find('podpora@example.test')) = 'support', 'role podpory');
  perform tap.ok((select totp_confirmed from se_vezmou.auth_operator_find('majitel@example.test')) = false, 'nový operátor nemá potvrzený faktor');
  perform tap.eq((select count(*) from se_vezmou.auth_operator_find('zakazany@example.test')), 0, 'zakázaný operátor se nenajde');
  perform tap.eq((select count(*) from se_vezmou.auth_operator_find('neznamy@example.test')), 0, 'neznámý e-mail se nenajde');
  perform tap.reset();
end
$$;

-- Relace: vznik jako AAL1, platnost, klouzavé okno, odvolání, zakázaný operátor
do $$
declare
  v_session uuid;
  v_tok bytea := sha256(convert_to('operator-token-1', 'UTF8'));
begin
  set local role service_role;
  v_session := se_vezmou.auth_operator_create_session(tap.u('operator:owner'), v_tok, 1800, 28800);
  perform tap.ok(v_session is not null, 'relace operátora vznikla');
  perform tap.ok((select not aal2 from se_vezmou.auth_operator_validate_session(v_tok)), 'nová relace je jen AAL1');
  perform tap.ok((select role from se_vezmou.auth_operator_validate_session(v_tok)) = 'owner', 'validace vrací roli');
  perform tap.ok((select email from se_vezmou.auth_operator_validate_session(v_tok)) = 'majitel@example.test', 'validace vrací e-mail operátora');
  perform tap.eq((select count(*) from se_vezmou.auth_operator_validate_session(sha256(convert_to('jiny', 'UTF8')))), 0, 'cizí token neplatí');
  perform tap.throws(format('select se_vezmou.auth_operator_create_session(%L, %L, 1800, 28800)', tap.u('operator:disabled'), sha256('x')),
    'P0002', 'zakázanému operátorovi relace nevznikne');
  perform tap.throws(format('select se_vezmou.auth_operator_create_session(%L, %L, 1800, 600)', tap.u('operator:owner'), sha256('y')),
    '22023', 'absolutní doba kratší než nečinnost se odmítne');
  perform tap.reset();

  -- v databázi je jen hash tokenu
  perform tap.ok((select token_hash = v_tok from se_vezmou.operator_sessions where id = v_session), 'uložen je hash tokenu');
  perform tap.ok((select idle_expires_at - last_seen_at from se_vezmou.operator_sessions where id = v_session) = interval '30 minutes',
    'nečinnost 30 minut (zadaná aplikací)');
  perform tap.ok((select absolute_expires_at - created_at from se_vezmou.operator_sessions where id = v_session) = interval '8 hours',
    'absolutní doba 8 hodin (zadaná aplikací)');

  -- klouzavé okno: po minutě se posune, dřív ne
  update se_vezmou.operator_sessions set last_seen_at = now() - interval '20 seconds',
         idle_expires_at = now() + interval '10 minutes' where id = v_session;
  set local role service_role;
  perform tap.eq((select count(*) from se_vezmou.auth_operator_validate_session(v_tok)), 1, 'relace platí');
  perform tap.reset();
  perform tap.ok((select idle_expires_at < now() + interval '11 minutes' from se_vezmou.operator_sessions where id = v_session),
    'do minuty se okno neposouvá');
  update se_vezmou.operator_sessions set last_seen_at = now() - interval '2 minutes',
         idle_expires_at = now() + interval '10 minutes' where id = v_session;
  set local role service_role;
  perform tap.eq((select count(*) from se_vezmou.auth_operator_validate_session(v_tok)), 1, 'relace platí i po minutě');
  perform tap.reset();
  perform tap.ok((select idle_expires_at > now() + interval '29 minutes' from se_vezmou.operator_sessions where id = v_session),
    'po minutě se okno nečinnosti posune na 30 minut');

  -- nečinnost 30 minut: relace vyprší
  update se_vezmou.operator_sessions set idle_expires_at = now() - interval '1 second' where id = v_session;
  set local role service_role;
  perform tap.eq((select count(*) from se_vezmou.auth_operator_validate_session(v_tok)), 0, 'po nečinnosti relace neplatí');
  perform tap.reset();
  update se_vezmou.operator_sessions set idle_expires_at = now() + interval '10 minutes',
         absolute_expires_at = now() - interval '1 second' where id = v_session;
  set local role service_role;
  perform tap.eq((select count(*) from se_vezmou.auth_operator_validate_session(v_tok)), 0, 'po absolutní době relace neplatí');
  perform tap.reset();

  -- odvolání a zakázání operátora
  update se_vezmou.operator_sessions set absolute_expires_at = now() + interval '8 hours' where id = v_session;
  set local role service_role;
  perform tap.eq((select count(*) from se_vezmou.auth_operator_validate_session(v_tok)), 1, 'obnovená relace platí');
  perform tap.ok(se_vezmou.auth_operator_revoke_session(v_tok), 'odvolání relace');
  perform tap.eq((select count(*) from se_vezmou.auth_operator_validate_session(v_tok)), 0, 'odvolaná relace neplatí');
  perform tap.ok(not se_vezmou.auth_operator_revoke_session(v_tok), 'opakované odvolání nic nezmění');
  perform tap.reset();

  update se_vezmou.operator_sessions set revoked_at = null where id = v_session;
  update se_vezmou.operators set disabled_at = now() where id = tap.u('operator:owner');
  set local role service_role;
  perform tap.eq((select count(*) from se_vezmou.auth_operator_validate_session(v_tok)), 0, 'zakázaný operátor relaci nepřežije');
  perform tap.reset();
  update se_vezmou.operators set disabled_at = null where id = tap.u('operator:owner');
end
$$;

-- Zápis druhého faktoru: rozepsaný klíč, potvrzení, záložní kódy, audit
do $$
declare
  v_owner uuid := tap.u('operator:owner');
  v_session uuid;
  v_tok bytea := sha256(convert_to('operator-token-2', 'UTF8'));
  v_secret text := 'sifrovany-klic-sifrovany-klic-1234567890';
  v_hashes bytea[] := array[sha256('b1'), sha256('b2'), sha256('b3')];
begin
  set local role service_role;
  v_session := se_vezmou.auth_operator_create_session(v_owner, v_tok, 1800, 28800);
  perform tap.ok(se_vezmou.auth_operator_mfa_begin(v_owner, v_secret) = v_secret, 'rozepsaný zápis uloží klíč');
  perform tap.ok(se_vezmou.auth_operator_mfa_begin(v_owner, 'jiny-sifrovany-klic-jiny-sifrovany-klic') = v_secret,
    'opakované otevření vrátí tentýž klíč (klíč se nepřepíše)');
  perform tap.throws(format('select se_vezmou.auth_operator_mfa_begin(%L, ''x'')', v_owner), '22023', 'příliš krátký šifrový text se odmítne');
  perform tap.ok((select not confirmed from se_vezmou.auth_operator_mfa_get(v_owner)), 'faktor zatím není potvrzený');

  -- potvrzení vyžaduje platnou relaci a aspoň jeden záložní kód
  perform tap.throws(format('select se_vezmou.auth_operator_mfa_confirm(%L, %L, 100, ''{}''::bytea[])', v_owner, v_session), '22023',
    'bez záložních kódů se zápis nepotvrdí');
  perform tap.throws(format('select se_vezmou.auth_operator_mfa_confirm(%L, %L, 100, %L)', v_owner, gen_random_uuid(), v_hashes), 'P0002',
    'bez platné relace se zápis nepotvrdí');
  perform se_vezmou.auth_operator_mfa_begin(tap.u('operator:support'), 'sifrovany-klic-podpory-1234567890');
  perform tap.throws(format('select se_vezmou.auth_operator_mfa_confirm(%L, %L, 100, %L)', tap.u('operator:support'), v_session, v_hashes), 'P0002',
    'relace jiného operátora zápis nepotvrdí');
  perform tap.ok(se_vezmou.auth_operator_mfa_confirm(v_owner, v_session, 100, v_hashes), 'zápis faktoru se potvrdí');
  perform tap.ok(not se_vezmou.auth_operator_mfa_confirm(v_owner, v_session, 101, v_hashes), 'potvrzený faktor jde zapsat jen jednou');
  perform tap.ok((select aal2 from se_vezmou.auth_operator_validate_session(v_tok)), 'po zápisu je relace AAL2');
  perform tap.ok((select confirmed and last_step = 100 from se_vezmou.auth_operator_mfa_get(v_owner)), 'faktor je potvrzený, krok uložen');
  perform tap.eq(se_vezmou.auth_operator_backup_codes_left(v_owner), 3, 'uloženy tři záložní kódy');
  perform tap.throws(format('select se_vezmou.auth_operator_mfa_begin(%L, %L)', v_owner, v_secret), '55000',
    'potvrzený faktor se přes mfa_begin nepřepíše');
  perform tap.reset();

  perform tap.ok(exists (select 1 from se_vezmou.audit_log where action = 'operator.mfa_enrolled' and actor_id = v_owner
                          and (meta ->> 'backup_codes')::int = 3), 'zápis faktoru je v auditu');
  perform tap.ok(not exists (select 1 from se_vezmou.audit_log where meta::text like '%sifrovany%'), 'audit neobsahuje klíč');
end
$$;

-- Přihlášení druhým faktorem: kód lze použít jen jednou (ochrana proti opakování), kroky jen rostou
do $$
declare
  v_owner uuid := tap.u('operator:owner');
  v_s1 uuid;
  v_s2 uuid;
  v_t1 bytea := sha256(convert_to('operator-token-3', 'UTF8'));
  v_t2 bytea := sha256(convert_to('operator-token-4', 'UTF8'));
begin
  set local role service_role;
  v_s1 := se_vezmou.auth_operator_create_session(v_owner, v_t1, 1800, 28800);
  v_s2 := se_vezmou.auth_operator_create_session(v_owner, v_t2, 1800, 28800);
  perform tap.ok((select not aal2 from se_vezmou.auth_operator_validate_session(v_t1)), 'relace před druhým faktorem je AAL1');
  perform tap.ok(not se_vezmou.auth_operator_mfa_accept(v_owner, v_s1, 100), 'stejný časový krok jako naposledy se odmítne');
  perform tap.ok(not se_vezmou.auth_operator_mfa_accept(v_owner, v_s1, 99), 'starší časový krok se odmítne');
  perform tap.ok((select not aal2 from se_vezmou.auth_operator_validate_session(v_t1)), 'odmítnutý kód relaci nepovýší');
  perform tap.ok(not se_vezmou.auth_operator_mfa_accept(v_owner, gen_random_uuid(), 102), 'neplatná relace se nepovýší');
  perform tap.ok(not se_vezmou.auth_operator_mfa_accept(tap.u('operator:support'), v_s1, 102), 'cizí relace se nepovýší');
  perform tap.ok(se_vezmou.auth_operator_mfa_accept(v_owner, v_s1, 102), 'nový časový krok projde');
  perform tap.ok((select aal2 from se_vezmou.auth_operator_validate_session(v_t1)), 'relace je AAL2');
  -- druhá relace se stejným krokem (dva prohlížeče, stejný kód) neprojde
  perform tap.ok(not se_vezmou.auth_operator_mfa_accept(v_owner, v_s2, 102), 'tentýž kód nejde použít ve druhé relaci');
  perform tap.ok(se_vezmou.auth_operator_mfa_accept(v_owner, v_s2, 103), 'další krok projde i ve druhé relaci');
  perform tap.reset();
  perform tap.ok((select count(*) from se_vezmou.audit_log where action = 'operator.login' and meta ->> 'method' = 'totp'
                   and actor_id = v_owner) = 2, 'každé přihlášení je v auditu');
end
$$;

-- Záložní kód: jednorázový, zbývající počet, audit; po jeho použití se nic jiného nezmění
do $$
declare
  v_owner uuid := tap.u('operator:owner');
  v_session uuid;
  v_tok bytea := sha256(convert_to('operator-token-5', 'UTF8'));
begin
  set local role service_role;
  v_session := se_vezmou.auth_operator_create_session(v_owner, v_tok, 1800, 28800);
  perform tap.eq(se_vezmou.auth_operator_use_backup_code(v_owner, v_session, sha256('neznamy')), -1, 'neznámý záložní kód se odmítne');
  perform tap.ok((select not aal2 from se_vezmou.auth_operator_validate_session(v_tok)), 'neznámý kód relaci nepovýší');
  perform tap.eq(se_vezmou.auth_operator_use_backup_code(v_owner, v_session, sha256('b1')), 2, 'platný záložní kód projde, zbývají 2');
  perform tap.ok((select aal2 from se_vezmou.auth_operator_validate_session(v_tok)), 'záložní kód povýší relaci na AAL2');
  perform tap.eq(se_vezmou.auth_operator_use_backup_code(v_owner, v_session, sha256('b1')), -1, 'použitý záložní kód podruhé neprojde');
  perform tap.eq(se_vezmou.auth_operator_use_backup_code(tap.u('operator:support'), v_session, sha256('b2')), -1,
    'kód nelze použít s cizí relací ani cizím operátorem');
  perform tap.eq(se_vezmou.auth_operator_backup_codes_left(v_owner), 2, 'zbývají dva kódy');
  perform tap.reset();
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where action = 'operator.backup_code_used' and actor_id = v_owner
                          and (meta ->> 'remaining')::int = 2), 'použití záložního kódu je v auditu');
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where action = 'operator.login' and meta ->> 'method' = 'backup_code'),
    'přihlášení záložním kódem je v auditu');

  -- nová sada: stará se zneplatní
  set local role service_role;
  perform tap.eq(se_vezmou.auth_operator_regenerate_backup_codes(v_owner, array[sha256('n1'), sha256('n2')]), 2, 'nová sada záložních kódů');
  perform tap.eq(se_vezmou.auth_operator_use_backup_code(v_owner, v_session, sha256('b2')), -1, 'kód ze staré sady už neplatí');
  perform tap.eq(se_vezmou.auth_operator_use_backup_code(v_owner, v_session, sha256('n1')), 1, 'kód z nové sady platí');
  perform tap.throws(format('select se_vezmou.auth_operator_regenerate_backup_codes(%L, ''{}''::bytea[])', v_owner), '22023',
    'prázdná sada se odmítne');
  perform tap.throws(format('select se_vezmou.auth_operator_regenerate_backup_codes(%L, %L)', tap.u('operator:support'), array[sha256('q')]),
    'P0002', 'operátor bez potvrzeného faktoru nemá co obnovovat');
  perform tap.reset();
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where action = 'operator.backup_codes_regenerated' and actor_id = v_owner),
    'nová sada je v auditu');
  perform tap.ok(not exists (select 1 from se_vezmou.audit_log where meta::text ilike '%b1%' or meta::text ilike '%n1%'),
    'audit neobsahuje kódy ani jejich hashe');
end
$$;

-- Výzvy pro operátory mají vlastní účel: kód správce nelze použít k přihlášení operátora
do $$
declare
  v_email bytea := sha256(convert_to('majitel@example.test', 'UTF8'));
  v_code bytea := sha256(convert_to('123456', 'UTF8'));
begin
  set local role service_role;
  perform se_vezmou.auth_create_challenge(v_email, 'operator_login', v_code, 600);
  perform tap.ok(not se_vezmou.auth_verify_challenge(v_email, 'admin_login', v_code), 'kód operátora neplatí jako kód správce');
  perform se_vezmou.auth_create_challenge(v_email, 'admin_login', sha256(convert_to('999999', 'UTF8')), 600);
  perform tap.ok(se_vezmou.auth_verify_challenge(v_email, 'operator_login', v_code), 'kód operátora platí pro operátorské přihlášení');
  perform tap.ok(not se_vezmou.auth_verify_challenge(v_email, 'operator_login', v_code), 'kód je jednorázový');
  perform tap.reset();
end
$$;

-- Záznam o e-mailu operátorovi (typ operator_notice) bez osobních údajů
do $$
begin
  set local role service_role;
  perform tap.ok(se_vezmou.email_log_insert('operator_notice', null, 'cs', sha256('x'), 'example.test') is not null,
    'e-mail operátorovi se zaznamená');
  perform tap.reset();
end
$$;

rollback;
