-- M4: pauzy po chybách (auth_lockout_*), PIN správy a PIN hostů (auth_pin_*), kontext relace
-- a záznam e-mailů bez osobních údajů (email_log_*).
begin;
select tap.seed();

-- ---------------------------------------------------------------------------
-- Pauzy: série chyb, zdvojnásobování, strop, nulování, samovolný návrat úrovně
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_expected integer;
begin
  set local role service_role;

  select * into r from public.auth_lockout_state('pin:test:a');
  perform tap.ok(r.locked = false and r.retry_after = 0, 'neznámý klíč není v pauze');

  for i in 1..4 loop
    select * into r from public.auth_lockout_failure('pin:test:a');
    perform tap.ok(r.locked = false and r.level = 0 and r.newly_locked = false, 'chyba ' || i || ' z 5 pauzu nespustí');
  end loop;
  select * into r from public.auth_lockout_failure('pin:test:a');
  perform tap.ok(r.locked and r.newly_locked and r.level = 1 and r.retry_after = 900, 'pátá chyba spustí pauzu 15 minut (900 s)');

  select * into r from public.auth_lockout_state('pin:test:a');
  perform tap.ok(r.locked and r.retry_after between 1 and 900, 'stav hlásí pauzu a zbývající dobu');

  select * into r from public.auth_lockout_failure('pin:test:a');
  perform tap.ok(r.locked and not r.newly_locked and r.level = 1, 'chyba během pauzy ji neprodlužuje ani nezvyšuje úroveň');

  select * into r from public.auth_lockout_state('pin:test:jiny');
  perform tap.ok(not r.locked, 'klíče jsou nezávislé');
  perform tap.reset();

  -- po skončení pauzy začíná nová série, každá další pauza je dvojnásobná až do stropu 24 hodin
  for lvl in 2..10 loop
    update public.lockouts set locked_until = now() - interval '1 second' where bucket_key = 'pin:test:a';
    set local role service_role;
    for i in 1..4 loop
      perform public.auth_lockout_failure('pin:test:a');
    end loop;
    select * into r from public.auth_lockout_failure('pin:test:a');
    perform tap.reset();
    v_expected := least(86400, 900 * (2 ^ (lvl - 1))::integer);
    perform tap.ok(r.retry_after = v_expected and r.level = lvl,
      format('úroveň %s: pauza %s s (strop 86400)', lvl, v_expected));
  end loop;

  -- samovolný návrat úrovně po uplynutí stropu od konce poslední pauzy (bez spouštěče updated_at)
  set local session_replication_role = replica;
  update public.lockouts
     set locked_until = now() - interval '2 days', updated_at = now() - interval '2 days'
   where bucket_key = 'pin:test:a';
  set local session_replication_role = origin;
  set local role service_role;
  for i in 1..4 loop
    perform public.auth_lockout_failure('pin:test:a');
  end loop;
  select * into r from public.auth_lockout_failure('pin:test:a');
  perform tap.ok(r.level = 1 and r.retry_after = 900, 'po dni bez chyb se úroveň vrátí na první pauzu');

  -- úspěch nuluje sérii i úroveň
  perform public.auth_lockout_reset('pin:test:a');
  select * into r from public.auth_lockout_state('pin:test:a');
  perform tap.ok(not r.locked, 'reset zruší pauzu');
  select * into r from public.auth_lockout_failure('pin:test:a');
  perform tap.ok(r.level = 0 and not r.locked, 'po resetu začíná série od nuly');
  perform public.auth_lockout_reset('pin:test:a');
  perform tap.reset();
  perform tap.eq((select count(*) from public.lockouts where bucket_key = 'pin:test:a'), 0, 'reset smaže řádek');

  -- vlastní práh a základ
  set local role service_role;
  select * into r from public.auth_lockout_failure('pin:test:b', 2::smallint, 60, 120);
  perform tap.ok(not r.locked, 'práh 2: první chyba bez pauzy');
  select * into r from public.auth_lockout_failure('pin:test:b', 2::smallint, 60, 120);
  perform tap.ok(r.locked and r.retry_after = 60, 'práh 2: druhá chyba spustí pauzu 60 s');
  perform tap.reset();
  update public.lockouts set locked_until = now() - interval '1 second' where bucket_key = 'pin:test:b';
  set local role service_role;
  perform public.auth_lockout_failure('pin:test:b', 2::smallint, 60, 120);
  select * into r from public.auth_lockout_failure('pin:test:b', 2::smallint, 60, 120);
  perform tap.ok(r.retry_after = 120, 'druhá pauza 120 s');
  perform tap.reset();
  update public.lockouts set locked_until = now() - interval '1 second' where bucket_key = 'pin:test:b';
  set local role service_role;
  perform public.auth_lockout_failure('pin:test:b', 2::smallint, 60, 120);
  select * into r from public.auth_lockout_failure('pin:test:b', 2::smallint, 60, 120);
  perform tap.ok(r.retry_after = 120, 'třetí pauza je omezena stropem 120 s');
  perform tap.reset();

  perform tap.throws($q$set local role service_role; select * from public.auth_lockout_failure('', 5::smallint, 900, 86400)$q$, '22023', 'prázdný klíč se odmítne');
  perform tap.reset();
  perform tap.throws($q$set local role service_role; select * from public.auth_lockout_failure('k', 0::smallint, 900, 86400)$q$, '22023', 'práh 0 se odmítne');
  perform tap.reset();
  perform tap.throws($q$set local role service_role; select * from public.auth_lockout_failure('k', 5::smallint, 900, 100)$q$, '22023', 'strop menší než základ se odmítne');
  perform tap.reset();
end
$$;

-- ---------------------------------------------------------------------------
-- auth_pin_get, auth_pin_other_hash
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  set local role service_role;
  select * into r from public.auth_pin_get('klara-a-matej', 'admin');
  perform tap.ok(r.wedding_id = tap.wa() and r.admin_id = tap.u('A:admin') and r.pin_hash = 'hash-admin-A'
                 and r.backup_email = 'a-zaloha@example.test', 'PIN správy: svatba, správce, hash a záložní e-mail');
  perform tap.eq((select count(*) from public.auth_pin_get('klara-a-matej', 'guest')), 0, 'PIN hostů je u vypnutého PINu hostů skrytý');
  perform tap.eq((select count(*) from public.auth_pin_get('neexistuje', 'admin')), 0, 'neexistující slug nevrací nic');
  perform tap.eq((select count(*) from public.auth_pin_get('klara-a-matej', 'operator')), 0, 'neznámá role nevrací nic');
  perform tap.eq((select count(*) from public.auth_pin_get(null, 'admin')), 0, 'null slug nevrací nic');
  perform tap.reset();

  update public.weddings set guest_pin_enabled = true where id = tap.wa();
  set local role service_role;
  select * into r from public.auth_pin_get('klara-a-matej', 'guest');
  perform tap.ok(r.wedding_id = tap.wa() and r.admin_id is null and r.pin_hash = 'hash-guest-A', 'PIN hostů při zapnutí: hash bez správce');

  perform tap.ok(public.auth_pin_other_hash(tap.wa(), 'admin') = 'hash-guest-A', 'druhý hash k PINu správy je hash PINu hostů');
  perform tap.ok(public.auth_pin_other_hash(tap.wa(), 'guest') = 'hash-admin-A', 'druhý hash k PINu hostů je hash PINu správy');
  perform tap.ok(public.auth_pin_other_hash(tap.u('nic'), 'admin') is null, 'neznámá svatba nemá druhý hash');
  perform tap.reset();

  update public.wedding_auth set admin_pin_hash = null where wedding_id = tap.wa();
  set local role service_role;
  perform tap.eq((select count(*) from public.auth_pin_get('klara-a-matej', 'admin')), 0, 'svatba bez PINu správy se chová jako neexistující');
  perform tap.reset();
  update public.wedding_auth set admin_pin_hash = 'hash-admin-A' where wedding_id = tap.wa();

  update public.wedding_admins set removed_at = now() where wedding_id = tap.wa();
  set local role service_role;
  perform tap.eq((select count(*) from public.auth_pin_get('klara-a-matej', 'admin')), 0, 'svatba bez aktivního správce nemá přihlášení PINem');
  perform tap.reset();
  update public.wedding_admins set removed_at = null where wedding_id = tap.wa();

  update public.weddings set deleted_at = now() where id = tap.wb();
  set local role service_role;
  perform tap.eq((select count(*) from public.auth_pin_get('druha-svatba', 'admin')), 0, 'smazaná svatba nemá přihlášení PINem');
  perform tap.reset();
  update public.weddings set deleted_at = null where id = tap.wb();
end
$$;

-- ---------------------------------------------------------------------------
-- auth_pin_set
-- ---------------------------------------------------------------------------
do $$
declare
  v_keep uuid;
  v_other uuid;
  v_guest uuid;
  v_backup text;
  v_hash constant text := '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';
begin
  set local role service_role;
  v_keep := public.auth_create_session('admin', tap.wa(), tap.u('A:admin'), sha256(convert_to('keep', 'UTF8')), 3600, 7200);
  v_other := public.auth_create_session('admin', tap.wa(), tap.u('A:admin'), sha256(convert_to('other', 'UTF8')), 3600, 7200);
  perform tap.reset();
  update public.weddings set guest_pin_enabled = true where id = tap.wa();
  set local role service_role;
  v_guest := public.auth_create_session('guest_pin', tap.wa(), null, sha256(convert_to('guest', 'UTF8')), 3600, 7200);

  perform tap.throws($q$select public.auth_pin_set(tap.wa(), 'operator', '$argon2id$x')$q$, '22023', 'neznámá role PINu se odmítne');
  perform tap.throws($q$select public.auth_pin_set(tap.wa(), 'admin', 'plain-text-pin')$q$, '22023', 'hash, který není argon2id, se odmítne');
  perform tap.throws($q$select public.auth_pin_set(tap.wa(), 'admin', null)$q$, '22023', 'prázdný hash se odmítne');
  perform tap.reset();

  -- svatba bez záznamu wedding_auth (tedy bez záložního e-mailu) PIN nemá kam uložit
  insert into public.weddings (id, partner_a_name, partner_b_name) values (tap.u('C:wedding'), 'Eva', 'Karel');
  set local role service_role;
  perform tap.throws($q$select public.auth_pin_set(tap.u('C:wedding'), 'admin', '$argon2id$v=19$x')$q$, 'P0002', 'bez záložního e-mailu nejde PIN nastavit');

  v_backup := public.auth_pin_set(tap.wa(), 'admin', v_hash, tap.u('A:admin'), v_keep);
  perform tap.reset();
  perform tap.ok(v_backup = 'a-zaloha@example.test', 'nastavení PINu vrací záložní e-mail pro oznámení');
  perform tap.ok((select admin_pin_hash from public.wedding_auth where wedding_id = tap.wa()) = v_hash, 'hash PINu správy se uložil');
  perform tap.ok((select guest_pin_hash from public.wedding_auth where wedding_id = tap.wa()) = 'hash-guest-A', 'hash PINu hostů se nezměnil');
  perform tap.ok((select revoked_at is null from public.sessions where id = v_keep), 'aktuální relace zůstává');
  perform tap.ok((select revoked_at is not null from public.sessions where id = v_other), 'ostatní relace správce se odvolaly');
  perform tap.ok((select revoked_at is null from public.sessions where id = v_guest), 'relace hostů změna PINu správy nezasáhla');
  perform tap.ok((select count(*) from public.audit_log where wedding_id = tap.wa() and action = 'pin.change'
                    and actor_type = 'admin' and actor_id = tap.u('A:admin') and meta = '{"role": "admin"}') = 1,
    'změna PINu je v auditu bez hodnoty');
  perform tap.ok(not exists (select 1 from public.audit_log where meta::text like '%argon2%'), 'audit neobsahuje hash');

  set local role service_role;
  perform public.auth_pin_set(tap.wa(), 'guest', v_hash);
  perform tap.reset();
  perform tap.ok((select revoked_at is not null from public.sessions where id = v_guest), 'změna PINu hostů odvolá relace hostů');
  perform tap.ok((select revoked_at is null from public.sessions where id = v_keep), 'změna PINu hostů se nedotkne relací správce');
  perform tap.ok((select actor_type = 'system' from public.audit_log where action = 'pin.change' order by id desc limit 1), 'bez správce je původcem systém');

  -- správce (authenticated) nevidí hash ani nespustí funkci
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.throws('select admin_pin_hash from public.wedding_auth', '42501', 'správce stále nečte hash PINu');
  perform tap.throws($q$select public.auth_pin_set(tap.wa(), 'admin', '$argon2id$v=19$x')$q$, '42501', 'správce nespustí auth_pin_set přímo');
  perform tap.throws($q$select * from public.auth_pin_get('klara-a-matej', 'admin')$q$, '42501', 'správce nespustí auth_pin_get přímo');
  perform tap.throws($q$select * from public.auth_lockout_failure('x')$q$, '42501', 'správce nespustí auth_lockout_failure');
  perform tap.reset();
end
$$;

-- ---------------------------------------------------------------------------
-- auth_session_context
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  set local role service_role;
  select * into r from public.auth_session_context(tap.wa());
  perform tap.ok(r.slug = 'klara-a-matej' and r.status = 'published' and r.partner_a_name = 'Klára' and r.partner_b_name = 'Matěj',
    'kontext relace nese adresu, stav a jména');
  perform tap.eq((select count(*) from public.auth_session_context(tap.u('nic'))), 0, 'neznámá svatba nemá kontext');
  perform tap.reset();
end
$$;

-- ---------------------------------------------------------------------------
-- email_log_*
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid;
begin
  set local role service_role;
  v_id := public.email_log_insert('login_code', null, 'cs', sha256(convert_to('x@example.test', 'UTF8')), 'Example.Test');
  perform tap.ok(v_id is not null, 'záznam e-mailu se vloží');
  perform tap.ok(public.email_log_set_status(v_id, 'sent', 'msg-1'), 'stav se nastaví');
  perform tap.ok(not public.email_log_set_status(tap.u('nic'), 'sent'), 'neznámý záznam se nezmění');
  perform tap.throws($q$select public.email_log_insert('jiny_typ', null, 'cs', '\x00', 'a.test')$q$, '23514', 'neznámý typ e-mailu se odmítne');
  perform tap.throws(format($q$select public.email_log_set_status(%L, 'nikdy')$q$, v_id), '23514', 'neznámý stav se odmítne');
  perform tap.reset();
  perform tap.ok((select status = 'sent' and provider_message_id = 'msg-1' and recipient_domain = 'example.test' and locale = 'cs'
                    from public.email_log where id = v_id), 'záznam nese stav, identifikátor zprávy a doménu malými písmeny');

  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.throws($q$select public.email_log_insert('login_code', null, 'cs', '\x00', 'a.test')$q$, '42501', 'správce nezapisuje do email_log přes funkci');
  perform tap.reset();
end
$$;

rollback;
