-- Opravy z revize kódu a soukromí (migrace 20261009*): meze nastavení, prodloužení lhůty přežije změnu data,
-- zablokovaný web, úklid lockouts, ochrana času (clock_guard), monotónní stav e-mailu, kolize adresy ve
-- wizard_create_draft, indexy, opuštěné koncepty, archivované weby, čekací listina, výmaz na žádost,
-- převzetí a záloha při trvalém smazání webu.
begin;
select tap.seed();
-- vyloučit vliv souborů 96 a 97: tento test si hodinu zapíná a vypíná sám
select set_config('se_vezmou.test_clock', 'off', true);

-- ---------------------------------------------------------------------------
-- 1. Meze nastavení a setting_int
-- ---------------------------------------------------------------------------
do $$
declare
  v_owner uuid := tap.u('operator:owner');
  v_old jsonb;
begin
  set local role service_role;
  perform tap.throws(format('select se_vezmou.op_set_app_setting(%L, ''activity_touch_minutes'', ''10000000000'')', v_owner),
    'invalid_setting_value', 'activity_touch_minutes = 10000000000 se odmítne');
  perform tap.throws(format('select se_vezmou.op_set_app_setting(%L, ''activity_touch_minutes'', ''1441'')', v_owner),
    'invalid_setting_value', 'activity_touch_minutes nad 1440 se odmítne');
  perform tap.throws(format('select se_vezmou.op_set_app_setting(%L, ''activity_touch_minutes'', ''0'')', v_owner),
    'invalid_setting_value', 'activity_touch_minutes pod 1 se odmítne');
  perform se_vezmou.op_set_app_setting(v_owner, 'activity_touch_minutes', '1440');
  perform tap.throws(format('select se_vezmou.op_set_app_setting(%L, ''health_retention_days_after_wedding'', ''999999999'')', v_owner),
    'invalid_setting_value', 'health_retention_days_after_wedding = 999999999 se odmítne');
  perform tap.throws(format('select se_vezmou.op_set_app_setting(%L, ''health_retention_days_after_wedding'', ''3651'')', v_owner),
    'invalid_setting_value', 'dny nad 3650 se odmítnou');
  perform se_vezmou.op_set_app_setting(v_owner, 'health_retention_days_after_wedding', '3650');
  perform tap.throws(format('select se_vezmou.op_set_app_setting(%L, ''guest_retention_months_after_wedding'', ''121'')', v_owner),
    'invalid_setting_value', 'měsíce nad 120 se odmítnou');
  perform tap.throws(format('select se_vezmou.op_set_app_setting(%L, ''versions_keep'', ''1.5'')', v_owner),
    'invalid_setting_value', 'neceločíselná hodnota se odmítne');
  perform tap.throws(format('select se_vezmou.op_set_app_setting(%L, ''versions_keep'', ''"20"'')', v_owner),
    'invalid_setting_value', 'text místo čísla se odmítne');
  perform tap.throws(format('select se_vezmou.op_set_app_setting(%L, ''max_admins'', ''6'')', v_owner),
    'invalid_setting_value', 'max_admins nad 5 se odmítne');
  perform tap.throws(format('select se_vezmou.op_set_app_setting(%L, ''abandoned_draft_days'', ''366'')', v_owner),
    'invalid_setting_value', 'abandoned_draft_days nad 365 se odmítne');
  perform tap.throws(format('select se_vezmou.op_set_app_setting(%L, ''waitlist_retention_months'', ''0'')', v_owner),
    'invalid_setting_value', 'waitlist_retention_months pod 1 se odmítne');
  perform se_vezmou.op_set_app_setting(v_owner, 'rsvp_match_threshold', '0.55');
  perform tap.throws(format('select se_vezmou.op_set_app_setting(%L, ''rsvp_match_threshold'', ''1.5'')', v_owner),
    'invalid_setting_value', 'práh RSVP nad 1 se odmítne');
  perform tap.reset();

  -- spouštěč hlídá i přímý zápis (vlastník v SQL editoru, budoucí migrace)
  perform tap.throws('update se_vezmou.app_settings set value = ''10000000000'' where key = ''session_touch_minutes''',
    'invalid_setting_value', 'přímý zápis mimo meze odmítne spouštěč');
  perform tap.throws('insert into se_vezmou.app_settings (key, value) values (''nova_vec'', ''-5'')',
    'invalid_setting_value', 'nové nastavení musí být v obecných mezích');

  -- setting_int: hodnota mimo rozsah integer (nastavená mimo kontrolu) vrátí výchozí hodnotu, zápis svatby neselže
  alter table se_vezmou.app_settings disable trigger app_settings_validate;
  update se_vezmou.app_settings set value = '10000000000' where key = 'activity_touch_minutes';
  update se_vezmou.app_settings set value = '10000000000' where key = 'health_retention_days_after_wedding';
  update se_vezmou.app_settings set value = '"text"' where key = 'versions_keep';
  alter table se_vezmou.app_settings enable trigger app_settings_validate;
  perform tap.eq(se_vezmou.setting_int('activity_touch_minutes', 5), 5, 'setting_int: mimo rozsah integer = výchozí hodnota');
  perform tap.eq(se_vezmou.setting_int('health_retention_days_after_wedding', 30), 30, 'setting_int: 10000000000 dní = výchozí hodnota');
  perform tap.eq(se_vezmou.setting_int('versions_keep', 20), 20, 'setting_int: nečíselná hodnota = výchozí hodnota');
  update se_vezmou.weddings set starts_on = date '2027-09-01' where id = tap.wa();
  perform tap.ok((select health_purge_at from se_vezmou.weddings where id = tap.wa()) = timestamptz '2027-10-01 00:00 Europe/Prague',
    'zápis svatby s nesmyslnou hodnotou v nastavení neselže a použije výchozí lhůtu 30 dní');
  select value into v_old from se_vezmou.app_settings where key = 'session_touch_minutes';
  perform tap.ok(v_old = '5'::jsonb, 'hodnota v rozsahu se čte beze změny');
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Prodloužení lhůty od operátora přežije změnu data a pásma
-- ---------------------------------------------------------------------------
rollback;
begin;
select tap.seed();
select set_config('se_vezmou.test_clock', 'off', true);

do $$
declare
  v_owner uuid := tap.u('operator:owner');
  v_health timestamptz;
  v_guest timestamptz;
  v_b_health timestamptz;
begin
  update se_vezmou.weddings set starts_on = date '2027-06-12', timezone = 'Europe/Prague' where id in (tap.wa(), tap.wb());
  perform tap.ok((select health_purge_at from se_vezmou.weddings where id = tap.wa()) = timestamptz '2027-07-12 00:00 Europe/Prague',
    'výchozí zdravotní lhůta = 30 dní po svatbě');
  perform tap.ok(not (select health_purge_extended or guest_purge_extended from se_vezmou.weddings where id = tap.wa()),
    'bez zásahu operátora nejsou lhůty označené jako prodloužené');

  set local role service_role;
  perform se_vezmou.op_extend_retention(v_owner, tap.wa(), 'health', date '2028-12-31', 'žádost o prodloužení');
  perform se_vezmou.op_extend_retention(v_owner, tap.wa(), 'guests', date '2030-12-31', 'žádost o prodloužení');
  perform tap.reset();
  select health_purge_at, guest_purge_at into v_health, v_guest from se_vezmou.weddings where id = tap.wa();
  perform tap.ok(v_health = timestamptz '2029-01-01 00:00 Europe/Prague', 'zdravotní lhůta prodloužena do konce 31. 12. 2028');
  perform tap.ok((select health_purge_extended and guest_purge_extended from se_vezmou.weddings where id = tap.wa()),
    'prodloužení označí lhůty (*_purge_extended)');

  -- změna data i pásma prodloužení nepřepíše
  update se_vezmou.weddings set starts_on = date '2027-06-19' where id = tap.wa();
  perform tap.ok((select health_purge_at from se_vezmou.weddings where id = tap.wa()) = v_health, 'změna data svatby zachová prodloužení (zdraví)');
  perform tap.ok((select guest_purge_at from se_vezmou.weddings where id = tap.wa()) = v_guest, 'změna data svatby zachová prodloužení (hosté)');
  update se_vezmou.weddings set timezone = 'America/New_York' where id = tap.wa();
  perform tap.ok((select health_purge_at from se_vezmou.weddings where id = tap.wa()) >= v_health, 'změna pásma prodloužení nezkrátí');
  select health_purge_at, guest_purge_at into v_health, v_guest from se_vezmou.weddings where id = tap.wa();
  update se_vezmou.weddings set starts_on = null, ends_on = null where id = tap.wa();
  perform tap.ok((select health_purge_at from se_vezmou.weddings where id = tap.wa()) = v_health, 'odstranění data prodloužení nesmaže');

  -- pozdější datum než prodloužená lhůta ji posune dál (greatest), nikdy nezkrátí
  update se_vezmou.weddings set starts_on = date '2035-01-01' where id = tap.wa();
  perform tap.ok((select health_purge_at from se_vezmou.weddings where id = tap.wa()) > v_health, 'pozdní datum svatby posune lhůtu za prodloužení');
  perform tap.ok((select guest_purge_at from se_vezmou.weddings where id = tap.wa()) > v_guest, 'pozdní datum svatby posune i lhůtu hostů');

  -- svatba bez zásahu operátora se dál přepočítává přesně (včetně zkrácení)
  select health_purge_at into v_b_health from se_vezmou.weddings where id = tap.wb();
  update se_vezmou.weddings set starts_on = date '2027-05-01' where id = tap.wb();
  perform tap.ok((select health_purge_at from se_vezmou.weddings where id = tap.wb()) = timestamptz '2027-05-31 00:00 Europe/Prague',
    'neprodloužená lhůta se přepočítá podle nového data (i dřívějšího)');
  perform tap.ok((select health_purge_at from se_vezmou.weddings where id = tap.wb()) < v_b_health, 'neprodloužená lhůta se může zkrátit');
end
$$;
rollback;
begin;
select tap.seed();
select set_config('se_vezmou.test_clock', 'off', true);

-- ---------------------------------------------------------------------------
-- 3. Zablokovaný web: správce ho nesmaže, bez nových relací, stávající přestanou platit; operátor ne
-- ---------------------------------------------------------------------------
do $$
declare
  v_owner uuid := tap.u('operator:owner');
  v_hash bytea := sha256(convert_to('token-A', 'UTF8'));
begin
  set local role service_role;
  perform tap.eq((select count(*) from se_vezmou.auth_validate_session(v_hash)), 1, 'relace správce zveřejněného webu platí');
  perform se_vezmou.op_set_wedding_status(v_owner, tap.wa(), 'blocked', 'zneužití');
  perform tap.eq((select count(*) from se_vezmou.auth_validate_session(v_hash)), 0, 'relace správce zablokovaného webu přestala platit');
  perform tap.throws(format('select se_vezmou.auth_create_session(''admin'', %L, %L, sha256(convert_to(''nova'', ''UTF8'')), 600, 3600)',
      tap.wa(), tap.u('A:admin')), 'wedding_blocked', 'zablokovaný web nevydá novou relaci správce');
  perform tap.throws(format('select se_vezmou.auth_create_session(''guest_pin'', %L, null, sha256(convert_to(''nova2'', ''UTF8'')), 600, 3600)',
      tap.wa()), 'wedding_blocked', 'zablokovaný web nevydá ani relaci hosta');
  -- operátor zablokovaný web dál vidí a spravuje (operátorské relace jsou jinde)
  perform tap.ok(se_vezmou.op_get_wedding(v_owner, tap.wa()) is not null, 'operátor zablokovaný web dál vidí');
  perform tap.reset();

  -- správce zablokovaný web nesmaže (nešlo by blokaci obejít)
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.throws('select se_vezmou.admin_wedding_delete()', 'wedding_blocked', 'správce zablokovaný web nesmaže');
  perform tap.reset();
  perform tap.ok((select status from se_vezmou.weddings where id = tap.wa()) = 'blocked', 'po pokusu o smazání zůstává web zablokovaný');

  -- po odblokování (publikováno) vše funguje jako dřív
  set local role service_role;
  perform se_vezmou.op_set_wedding_status(v_owner, tap.wa(), 'published', 'omyl');
  perform tap.eq((select count(*) from se_vezmou.auth_validate_session(v_hash)), 1, 'po odblokování relace znovu platí');
  perform tap.ok(se_vezmou.auth_create_session('admin', tap.wa(), tap.u('A:admin'), sha256(convert_to('nova3', 'UTF8')), 600, 3600) is not null,
    'po odblokování lze vydat relaci správce');
  perform tap.reset();
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.ok(se_vezmou.admin_wedding_delete() is not null, 'správce odblokovaného webu ho smaže');
  perform tap.reset();
end
$$;

rollback;
begin;
select tap.seed();
select set_config('se_vezmou.test_clock', 'off', true);

-- ---------------------------------------------------------------------------
-- 4. Úklid lockouts
-- ---------------------------------------------------------------------------
do $$
declare
  v_res jsonb;
begin
  insert into se_vezmou.lockouts (bucket_key, level, locked_until, updated_at) values
    ('t:stara-pauza', 1, now() - interval '8 days', now() - interval '8 days'),
    ('t:stara-bez-pauzy', 0, null, now() - interval '8 days'),
    ('t:cerstva-pauza', 1, now() + interval '10 minutes', now()),
    ('t:vcerejsi-pauza', 1, now() - interval '1 day', now() - interval '1 day'),
    ('t:cerstva-bez-pauzy', 0, null, now() - interval '1 day');
  set local role service_role;
  v_res := se_vezmou.housekeeping(now(), true);
  perform tap.eq((v_res ->> 'lockouts')::bigint, 2, 'dry_run ohlásí dva zastaralé řádky lockouts');
  perform tap.reset();
  perform tap.eq((select count(*) from se_vezmou.lockouts where bucket_key like 't:%'), 5, 'dry_run nic nesmazal');
  set local role service_role;
  v_res := se_vezmou.housekeeping();
  perform tap.reset();
  perform tap.eq((v_res ->> 'lockouts')::bigint, 2, 'úklid smaže stará lockouts s pauzou i bez pauzy');
  perform tap.eq((select count(*) from se_vezmou.lockouts where bucket_key like 't:%'), 3, 'čerstvé a včerejší řádky zůstaly');
  perform tap.ok(not exists (select 1 from se_vezmou.lockouts where bucket_key in ('t:stara-pauza', 't:stara-bez-pauzy')), 'smazány právě zastaralé řádky');
end
$$;

-- ---------------------------------------------------------------------------
-- 5. clock_guard: p_now z budoucnosti bez testovací hodiny se odmítne
-- ---------------------------------------------------------------------------
do $$
begin
  set local role service_role;
  perform tap.throws('select se_vezmou.purge_health_data(100, now() + interval ''1 day'')', 'clock_in_future', 'purge_health_data odmítne budoucí čas');
  perform tap.throws('select se_vezmou.purge_guest_data(100, now() + interval ''1 day'')', 'clock_in_future', 'purge_guest_data odmítne budoucí čas');
  perform tap.throws(format('select se_vezmou.purge_wedding(%L, now() + interval ''1 day'')', tap.wa()), 'clock_in_future', 'purge_wedding odmítne budoucí čas');
  perform tap.throws('select se_vezmou.purge_deleted_weddings(20, now() + interval ''1 day'')', 'clock_in_future', 'purge_deleted_weddings odmítne budoucí čas');
  perform tap.throws('select se_vezmou.purge_expired_slug_reservations(now() + interval ''1 day'')', 'clock_in_future', 'purge_expired_slug_reservations odmítne budoucí čas');
  perform tap.throws('select se_vezmou.housekeeping(now() + interval ''1 day'')', 'clock_in_future', 'housekeeping odmítne budoucí čas');
  perform tap.throws('select se_vezmou.lifecycle_archive_due(now() + interval ''1 day'')', 'clock_in_future', 'lifecycle_archive_due odmítne budoucí čas');
  perform tap.throws('select se_vezmou.lifecycle_delete_archived(now() + interval ''1 day'')', 'clock_in_future', 'lifecycle_delete_archived odmítne budoucí čas');
  perform tap.throws('select se_vezmou.lifecycle_enqueue_notices(now() + interval ''1 day'')', 'clock_in_future', 'lifecycle_enqueue_notices odmítne budoucí čas');
  perform tap.throws('select * from se_vezmou.lifecycle_notices_claim(now() + interval ''1 day'')', 'clock_in_future', 'lifecycle_notices_claim odmítne budoucí čas');
  perform tap.throws(format('select se_vezmou.retention_claim(%L, now() + interval ''1 day'')', tap.wa()), 'clock_in_future', 'retention_claim odmítne budoucí čas');

  -- malá tolerance a minulost projdou; výchozí hodnoty (bez parametru) také
  perform se_vezmou.purge_health_data(100, now() + interval '1 minute');
  perform se_vezmou.purge_health_data(100, now() - interval '5 years');
  perform se_vezmou.purge_health_data();
  perform se_vezmou.housekeeping();
  perform tap.ok(true, 'čas v toleranci, minulý čas a výchozí volání projdou');

  -- s testovací hodinou projde i budoucnost (CRON_TEST_CLOCK, SQL testy)
  perform set_config('se_vezmou.test_clock', 'on', true);
  perform se_vezmou.purge_health_data(100, now() + interval '5 years');
  perform tap.ok(true, 'se zapnutou testovací hodinou projde i čas z budoucnosti');
  perform set_config('se_vezmou.test_clock', 'off', true);
  perform tap.throws('select se_vezmou.purge_health_data(100, now() + interval ''5 years'')', 'clock_in_future', 'vypnutá testovací hodina budoucnost znovu odmítne');

  -- interní implementace se nespustí přímo a obaly nespustí správce
  perform tap.throws('select se_vezmou.purge_health_data_impl(100, now(), null, false)', '42501', 'service_role nespustí *_impl přímo');
  perform tap.throws('select se_vezmou.clock_guard(now())', '42501', 'service_role nespustí clock_guard přímo');
  perform tap.reset();
  perform tap.become('authenticated', tap.wa(), 'admin');
  perform tap.throws('select se_vezmou.purge_health_data()', '42501', 'správce nespustí purge_health_data');
  perform tap.throws('select se_vezmou.housekeeping()', '42501', 'správce nespustí housekeeping');
  perform tap.throws('select se_vezmou.lifecycle_delete_archived()', '42501', 'správce nespustí lifecycle_delete_archived');
  perform tap.throws(format('select se_vezmou.retention_claim(%L)', tap.wa()), '42501', 'správce nespustí retention_claim');
  perform tap.throws(format('select se_vezmou.op_erase_waitlist(%L, ''a@b.cz'', ''x'')', tap.u('operator:owner')), '42501', 'správce nespustí op_erase_waitlist');
  perform tap.reset();
end
$$;

-- ---------------------------------------------------------------------------
-- 6. email_log_set_status: monotónní stav, kód chyby se nemaže
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid;
  v_id2 uuid;
begin
  set local role service_role;
  v_id := se_vezmou.email_log_insert('login_code', null, 'cs', sha256(convert_to('m1', 'UTF8')), 'example.test');
  perform tap.ok(se_vezmou.email_log_set_status(v_id, 'sent', 'msg-1'), 'queued -> sent');
  perform tap.ok(se_vezmou.email_log_set_status(v_id, 'delivered'), 'sent -> delivered');
  perform tap.ok(se_vezmou.email_log_set_status(v_id, 'sent'), 'opožděné sent vrací true (záznam existuje)');
  perform tap.reset();
  perform tap.ok((select status from se_vezmou.email_log where id = v_id) = 'delivered', 'delivered se nevrací na sent');
  perform tap.ok((select provider_message_id from se_vezmou.email_log where id = v_id) = 'msg-1', 'id zprávy se zachová');

  set local role service_role;
  perform se_vezmou.email_log_set_status(v_id, 'bounced', null, 'smtp_550');
  perform se_vezmou.email_log_set_status(v_id, 'delivered');
  perform tap.reset();
  perform tap.ok((select status from se_vezmou.email_log where id = v_id) = 'bounced', 'bounced zůstává (delivered ho nepřepíše)');
  perform tap.ok((select error_code from se_vezmou.email_log where id = v_id) = 'smtp_550', 'kód chyby se zapsal');
  set local role service_role;
  perform se_vezmou.email_log_set_status(v_id, 'bounced');
  perform se_vezmou.email_log_set_status(v_id, 'sent');
  perform se_vezmou.email_log_set_status(v_id, 'complained');
  perform tap.reset();
  perform tap.ok((select error_code from se_vezmou.email_log where id = v_id) = 'smtp_550', 'pozdější volání bez kódu chyby kód nevymaže');
  perform tap.ok((select status from se_vezmou.email_log where id = v_id) = 'complained', 'silnější signál (stížnost) po bounced projde');

  set local role service_role;
  v_id2 := se_vezmou.email_log_insert('login_code', null, 'cs', sha256(convert_to('m2', 'UTF8')), 'example.test');
  perform se_vezmou.email_log_set_status(v_id2, 'failed', null, 'timeout');
  perform se_vezmou.email_log_set_status(v_id2, 'failed');
  perform se_vezmou.email_log_set_status(v_id2, 'sent', 'msg-2');
  perform se_vezmou.email_log_set_status(v_id2, 'failed', null, 'pozdni');
  perform tap.reset();
  perform tap.ok((select status from se_vezmou.email_log where id = v_id2) = 'sent', 'opakování po selhání (failed -> sent) projde, sent -> failed ne');
  perform tap.ok((select error_code from se_vezmou.email_log where id = v_id2) = 'timeout', 'kód chyby z prvního selhání zůstal');
  set local role service_role;
  perform tap.ok(not se_vezmou.email_log_set_status(gen_random_uuid(), 'sent'), 'neexistující záznam vrací false');
  perform tap.throws(format('select se_vezmou.email_log_set_status(%L, ''neznamy'')', v_id2), '23514', 'neznámý stav selže na omezení tabulky');
  perform tap.reset();
end
$$;

-- ---------------------------------------------------------------------------
-- 7. wizard_create_draft: jen kolize adresy je „adresa obsazena“
-- ---------------------------------------------------------------------------
create function pg_temp.work(p_venues jsonb) returns jsonb
  language sql as $$
  select jsonb_build_object(
    'wedding', jsonb_build_object('partnerA', 'Eliška', 'partnerB', 'Tomáš', 'startsOn', '2028-06-17', 'endsOn', null,
      'timezone', 'Europe/Prague', 'locales', jsonb_build_array('cs'), 'defaultLocale', 'cs',
      'template', 'eukalyptus', 'palette', 'stribrna', 'guestPinEnabled', false),
    'venues', p_venues, 'events', '[]'::jsonb, 'blocks', '[]'::jsonb,
    'rsvp', jsonb_build_object('opensAt', null, 'closesAt', null, 'allowUnlisted', false, 'emailConfirmation', true,
      'questions', '{}'::jsonb))
$$;

do $$
declare
  r record;
  v_venue jsonb := jsonb_build_object('id', tap.u('h:venue'), 'name', jsonb_build_object('cs', 'Zámek'), 'address', 'Zámecká 1', 'directions', null);
  v_count bigint;
begin
  set local role service_role;
  -- obsazená adresa: stále vrací ok = false s variantami
  select * into r from se_vezmou.wizard_create_draft('eliska@example.test', 'zaloha-eliska@example.test', 'klara-a-matej',
    '{"version": 1}'::jsonb, pg_temp.work(jsonb_build_array(v_venue)));
  perform tap.ok(r.ok is false and cardinality(r.variants) > 0, 'obsazená adresa: ok = false a nabídka variant');
  perform tap.reset();
  perform tap.eq((select count(*) from se_vezmou.weddings where partner_a_name = 'Eliška'), 0, 'po kolizi adresy nic nevzniklo');

  -- jiné porušení unikátnosti (tady vyvolané spouštěčem s jiným názvem omezení) se nesmí tvářit jako kolize adresy
  create function pg_temp.fake_unique() returns trigger language plpgsql as $f$
  begin
    raise exception 'duplicita' using errcode = '23505', constraint = 'jine_unikatni_omezeni';
  end
  $f$;
  create trigger fake_unique before insert on se_vezmou.wedding_admins
    for each row when (new.email = 'eliska@example.test') execute function pg_temp.fake_unique();
  set local role service_role;
  perform tap.throws(format($q$select * from se_vezmou.wizard_create_draft('eliska@example.test', 'zaloha-eliska@example.test', 'eliska-a-tomas',
    '{"version": 1}'::jsonb, %L::jsonb)$q$, pg_temp.work(jsonb_build_array(v_venue))::text),
    '23505', 'porušení jiného unikátního klíče je chyba, ne „adresa obsazena“');
  perform tap.reset();
  perform tap.eq((select count(*) from se_vezmou.weddings where partner_a_name = 'Eliška'), 0, 'po chybě nic nevzniklo');
  perform tap.eq((select count(*) from se_vezmou.slug_registry where slug = 'eliska-a-tomas'), 0, 'po chybě nezůstala ani rezervace adresy');
  -- totéž s názvem omezení adresy je kolize adresy
  drop trigger fake_unique on se_vezmou.wedding_admins;
  drop function pg_temp.fake_unique();
  create function pg_temp.fake_slug() returns trigger language plpgsql as $f$
  begin
    raise exception 'duplicita' using errcode = '23505', constraint = 'weddings_slug_key';
  end
  $f$;
  create trigger fake_slug before insert on se_vezmou.wedding_admins
    for each row when (new.email = 'eliska@example.test') execute function pg_temp.fake_slug();
  set local role service_role;
  select * into r from se_vezmou.wizard_create_draft('eliska@example.test', 'zaloha-eliska@example.test', 'eliska-a-tomas',
    '{"version": 1}'::jsonb, pg_temp.work(jsonb_build_array(v_venue)));
  perform tap.reset();
  perform tap.ok(r.ok is false and cardinality(r.variants) > 0, 'porušení klíče adresy při zápisu je „adresa obsazena“');
  perform tap.eq((select count(*) from se_vezmou.weddings where partner_a_name = 'Eliška'), 0, 'po kolizi adresy nic nevzniklo ani teď');
  drop trigger fake_slug on se_vezmou.wedding_admins;

  -- správná kolize: i porušení klíče adresy při zápisu je „adresa obsazena“
  set local role service_role;
  select * into r from se_vezmou.wizard_create_draft('eliska@example.test', 'zaloha-eliska@example.test', 'eliska-a-tomas',
    '{"version": 1}'::jsonb, pg_temp.work(jsonb_build_array(v_venue)));
  perform tap.reset();
  perform tap.ok(r.ok is true, 'volná adresa se založí');
end
$$;

-- ---------------------------------------------------------------------------
-- 8. Indexy
-- ---------------------------------------------------------------------------
do $$
begin
  perform tap.ok(not exists (select 1 from pg_indexes where schemaname = 'se_vezmou'
                              and indexname in ('weddings_names_trgm_idx', 'weddings_slug_trgm_idx')),
    'nepoužívané trigramové indexy jsou pryč');
  perform tap.ok(exists (select 1 from pg_indexes where schemaname = 'se_vezmou' and tablename = 'rsvp_people'
                          and indexdef like '%(guest_id)%'),
    'rsvp_people má index na guest_id');
end
$$;

-- ---------------------------------------------------------------------------
-- 9. Opuštěné koncepty
-- ---------------------------------------------------------------------------
do $$
declare
  v_old uuid := tap.u('d:old');
  v_fresh uuid := tap.u('d:fresh');
  v_res jsonb;
  v_n integer;
begin
  insert into se_vezmou.weddings (id, partner_a_name, partner_b_name) values
    (v_old, 'Stará', 'Opuštěná'), (v_fresh, 'Nová', 'Čerstvá');
  insert into se_vezmou.wedding_admins (wedding_id, email) values (v_old, 'stary@example.test'), (v_fresh, 'novy@example.test');
  update se_vezmou.weddings set last_activity_at = now() - interval '20 days' where id = v_old;
  update se_vezmou.weddings set last_activity_at = now() - interval '2 days' where id = v_fresh;
  -- zveřejněná svatba A převedená na koncept s verzí (published_version_id zůstává) se nesmí smazat
  update se_vezmou.weddings set status = 'draft', last_activity_at = now() - interval '90 days' where id = tap.wa();

  set local role service_role;
  v_res := se_vezmou.housekeeping(now(), true);
  perform tap.eq((v_res ->> 'abandoned_drafts')::bigint, 1, 'dry_run ohlásí jeden opuštěný koncept');
  perform tap.reset();
  perform tap.ok((select status from se_vezmou.weddings where id = v_old) = 'draft', 'dry_run koncept nesmazal');

  set local role service_role;
  v_res := se_vezmou.housekeeping();
  perform tap.reset();
  perform tap.eq((v_res ->> 'abandoned_drafts')::bigint, 1, 'úklid převede opuštěný koncept do stavu deleted');
  perform tap.ok((select status from se_vezmou.weddings where id = v_old) = 'deleted', 'opuštěný koncept je ve stavu deleted');
  perform tap.ok((select purge_at > now() + interval '29 days' from se_vezmou.weddings where id = v_old),
    'opuštěný koncept má běžnou lhůtu pro obnovení (není okamžitě splatný)');
  perform tap.ok((select status from se_vezmou.weddings where id = v_fresh) = 'draft', 'čerstvý koncept zůstal');
  perform tap.ok((select status from se_vezmou.weddings where id = tap.wa()) = 'draft', 'koncept se zveřejněnou verzí zůstal');
  perform tap.ok(exists (select 1 from se_vezmou.wedding_status_history where wedding_id = v_old and to_status = 'deleted'
                          and actor_type = 'system' and reason = 'draft_abandoned'), 'zapsána historie stavu');
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where wedding_id = v_old and action = 'wedding.status_change'
                          and reason = 'draft_abandoned' and meta ->> 'inactive_days' = '14'), 'zapsán audit bez osobních údajů');

  -- po lhůtě pro obnovení ho trvale smaže stávající mechanismus retence
  update se_vezmou.weddings set purge_at = now() - interval '1 minute' where id = v_old;
  set local role service_role;
  perform tap.ok((select count(*) from se_vezmou.retention_due_weddings(now(), 20, v_old)) = 1, 'retention_due_weddings koncept nabídne');
  v_n := se_vezmou.purge_deleted_weddings(20, now(), v_old);
  perform tap.reset();
  perform tap.eq(v_n, 1, 'purge_deleted_weddings koncept trvale smaže');
  perform tap.eq((select count(*) from se_vezmou.weddings where id = v_old), 0, 'jména páru jsou pryč');
  perform tap.eq((select count(*) from se_vezmou.wedding_admins where wedding_id = v_old), 0, 'e-mail správce je pryč');

  -- nastavitelná doba
  update se_vezmou.weddings set last_activity_at = now() - interval '20 days' where id = v_fresh;
  set local role service_role;
  perform se_vezmou.op_set_app_setting(tap.u('operator:owner'), 'abandoned_draft_days', '30');
  v_res := se_vezmou.housekeeping();
  perform tap.reset();
  perform tap.eq((v_res ->> 'abandoned_drafts')::bigint, 0, 'při 30 dnech se 20 dní starý koncept nemaže');
  set local role service_role;
  perform se_vezmou.op_set_app_setting(tap.u('operator:owner'), 'abandoned_draft_days', '14');
  perform tap.reset();
  update se_vezmou.weddings set status = 'published', last_activity_at = now() where id = tap.wa();
  update se_vezmou.weddings set last_activity_at = now() where id = v_fresh;
end
$$;

-- ---------------------------------------------------------------------------
-- 10. Archivované weby se po lhůtě přesunou do stavu deleted
-- ---------------------------------------------------------------------------
do $$
declare
  v_n integer;
  v_purge timestamptz;
begin
  perform tap.ok((select value from se_vezmou.app_settings where key = 'archived_delete_days_after_guest_purge') = '90'::jsonb,
    'výchozí lhůta archivovaných webů je 90 dní po guest_purge_at');
  update se_vezmou.weddings set status = 'archived', guest_purge_at = now() - interval '91 days' where id = tap.wa();
  update se_vezmou.weddings set status = 'archived', guest_purge_at = now() - interval '89 days' where id = tap.wb();

  set local role service_role;
  v_n := se_vezmou.lifecycle_delete_archived(now(), 100, null, true);
  perform tap.eq(v_n, 1, 'dry_run ohlásí jeden archivovaný web po lhůtě');
  perform tap.reset();
  perform tap.ok((select status from se_vezmou.weddings where id = tap.wa()) = 'archived', 'dry_run nic nezměnil');

  set local role service_role;
  v_n := se_vezmou.lifecycle_delete_archived();
  perform tap.reset();
  perform tap.eq(v_n, 1, 'archivovaný web po lhůtě přejde do stavu deleted');
  select purge_at into v_purge from se_vezmou.weddings where id = tap.wa();
  perform tap.ok((select status from se_vezmou.weddings where id = tap.wa()) = 'deleted', 'web A je ve stavu deleted');
  perform tap.ok(v_purge > now() + interval '29 days' and v_purge < now() + interval '31 days', 'platí ochranná lhůta deleted_site_restore_days');
  perform tap.ok((select status from se_vezmou.weddings where id = tap.wb()) = 'archived', 'web před lhůtou zůstává archivovaný');
  perform tap.ok(exists (select 1 from se_vezmou.wedding_status_history where wedding_id = tap.wa() and from_status = 'archived'
                          and to_status = 'deleted' and reason = 'archive_expired' and actor_type = 'system'), 'zapsána historie stavu');
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where wedding_id = tap.wa() and reason = 'archive_expired'), 'zapsán audit');
  -- prodloužení lhůty hostů smazání odsune
  update se_vezmou.weddings set guest_purge_at = now() - interval '200 days' where id = tap.wb();
  set local role service_role;
  perform se_vezmou.op_extend_retention(tap.u('operator:owner'), tap.wb(), 'guests', (current_date + 400), 'prodloužení');
  v_n := se_vezmou.lifecycle_delete_archived();
  perform tap.reset();
  perform tap.eq(v_n, 0, 'prodloužení lhůty hostů smazání archivovaného webu odsune');
  -- obnova v ochranné lhůtě je možná jen operátorem a vrací web do stavu před smazáním (archived)
  set local role service_role;
  perform tap.ok(se_vezmou.op_restore_wedding(tap.u('operator:owner'), tap.wa(), 'omyl') = 'archived', 'operátor smazaný archivovaný web obnoví');
  perform tap.reset();
end
$$;

-- ---------------------------------------------------------------------------
-- 11. Čekací listina: retence a výmaz na žádost
-- ---------------------------------------------------------------------------
do $$
declare
  v_res jsonb;
  v_n integer;
  v_owner uuid := tap.u('operator:owner');
begin
  perform tap.ok((select value from se_vezmou.app_settings where key = 'waitlist_retention_months') = '12'::jsonb,
    'výchozí doba čekací listiny je 12 měsíců od souhlasu');
  insert into se_vezmou.waitlist (email, locale, consent_at, consent_text_version) values
    ('stary@seznam.test', 'cs', now() - interval '13 months', 'v1'),
    ('cerstvy@seznam.test', 'cs', now() - interval '2 months', 'v1'),
    ('Smazat@Seznam.Test', 'cs', now() - interval '1 month', 'v1');

  set local role service_role;
  v_res := se_vezmou.housekeeping(now(), true);
  perform tap.eq((v_res ->> 'waitlist')::bigint, 1, 'dry_run ohlásí jednu prošlou položku čekací listiny');
  perform tap.reset();
  perform tap.eq((select count(*) from se_vezmou.waitlist), 3, 'dry_run nic nesmazal');
  set local role service_role;
  v_res := se_vezmou.housekeeping();
  perform tap.reset();
  perform tap.eq((v_res ->> 'waitlist')::bigint, 1, 'úklid smaže položky starší než 12 měsíců od souhlasu');
  perform tap.eq((select count(*) from se_vezmou.waitlist where email = 'stary@seznam.test'), 0, 'prošlá položka je pryč');
  perform tap.eq((select count(*) from se_vezmou.waitlist), 2, 'ostatní zůstaly');

  -- výmaz na žádost: jen majitel, s důvodem; e-mail se do auditu nezapíše; velikost písmen nehraje roli
  set local role service_role;
  perform tap.throws(format('select se_vezmou.op_erase_waitlist(%L, ''smazat@seznam.test'', ''žádost'')', tap.u('operator:support')), '42501', 'podpora čekací listinu nemaže');
  perform tap.throws(format('select se_vezmou.op_erase_waitlist(%L, ''smazat@seznam.test'', '' '')', v_owner), 'reason_required', 'důvod je povinný');
  perform tap.throws(format('select se_vezmou.op_erase_waitlist(%L, '' '', ''žádost'')', v_owner), 'invalid_email', 'e-mail je povinný');
  v_n := se_vezmou.op_erase_waitlist(v_owner, '  SMAZAT@seznam.test ', 'žádost o výmaz');
  perform tap.eq(v_n, 1, 'výmaz na žádost smaže jeden záznam');
  perform tap.eq(se_vezmou.op_erase_waitlist(v_owner, 'smazat@seznam.test', 'opakovaně'), 0, 'opakovaný výmaz je idempotentní');
  perform tap.reset();
  perform tap.eq((select count(*) from se_vezmou.waitlist), 1, 'zůstal jen cizí záznam');
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where action = 'waitlist.erase' and actor_id = v_owner
                          and reason = 'žádost o výmaz' and meta = '{"rows": 1}'), 'audit nese jen počet řádků');
  perform tap.ok(not exists (select 1 from se_vezmou.audit_log where action = 'waitlist.erase' and (reason ilike '%seznam%' or meta::text ilike '%seznam%')),
    'audit neobsahuje e-mail');
end
$$;

-- ---------------------------------------------------------------------------
-- 12. Trvalé smazání webu: převzetí těsně před mazáním souborů, obnova se s ním neprolíná, záloha po selhání
-- ---------------------------------------------------------------------------
do $$
declare
  v_owner uuid := tap.u('operator:owner');
  v_p timestamptz := now() + interval '11 days';   -- čas úlohy po uplynutí ochranné lhůty (jen s testovací hodinou)
  v_ids uuid[];
  v_id uuid;
  v_n integer;
begin
  perform set_config('se_vezmou.test_clock', 'on', true);
  -- web B ve stavu deleted s purge_at za 10 dní
  update se_vezmou.weddings set status = 'deleted', purge_at = now() + interval '10 days' where id = tap.wb();

  set local role service_role;
  perform tap.ok(not se_vezmou.retention_claim(tap.wb(), now()), 'před uplynutím ochranné lhůty se web nepřevezme');
  perform tap.ok(se_vezmou.retention_claim(tap.wb(), v_p), 'po uplynutí lhůty se web převezme');
  perform tap.ok(not se_vezmou.retention_claim(tap.wb(), v_p), 'druhý běh web nepřevezme (zapůjčení)');
  perform tap.eq((select count(*) from se_vezmou.retention_due_weddings(v_p, 20, tap.wb())), 0, 'převzatý web není v seznamu k mazání');
  perform tap.throws(format('select se_vezmou.op_restore_wedding(%L, %L, ''omyl'')', v_owner, tap.wb()), 'purge_in_progress',
    'obnova převzatého webu se odmítne (nemůže se proložit s mazáním souborů)');
  perform se_vezmou.retention_release(tap.wb());
  perform tap.reset();
  perform tap.ok((select purge_attempts = 1 and purge_claimed_at is null from se_vezmou.weddings where id = tap.wb()), 'uvolnění zruší zapůjčení, pokus zůstane započítaný');

  -- obnova po uvolnění projde, vynuluje historii pokusů a další převzetí nic nevrátí (soubory se nemažou)
  set local role service_role;
  perform tap.ok(se_vezmou.op_restore_wedding(v_owner, tap.wb(), 'omyl') = 'draft', 'obnova webu po uvolnění projde (bez historie stavu do konceptu)');
  perform tap.ok(not se_vezmou.retention_claim(tap.wb(), v_p), 'obnovený web se k mazání nepřevezme');
  perform tap.reset();
  perform tap.ok((select purge_attempts = 0 and purge_last_attempt_at is null and purge_claimed_at is null from se_vezmou.weddings where id = tap.wb()),
    'obnova vynuluje pokusy o smazání');

  -- záloha: čtyři trvale selhávající weby nezablokují dávku
  v_ids := array[tap.u('f:1'), tap.u('f:2'), tap.u('f:3'), tap.u('f:4'), tap.u('f:ok')];
  foreach v_id in array v_ids loop
    insert into se_vezmou.weddings (id, partner_a_name, partner_b_name) values (v_id, 'F', 'G');
    update se_vezmou.weddings set status = 'deleted', purge_at = now() - interval '1 day' where id = v_id;
  end loop;
  set local role service_role;
  for i in 1..4 loop
    perform se_vezmou.retention_claim(v_ids[i], now());
    perform se_vezmou.retention_release(v_ids[i]);
  end loop;
  perform tap.eq((select count(*) from se_vezmou.retention_due_weddings(now(), 2)), 1, 'selhávající weby jsou v záloze, v dávce zbývá jen web bez pokusu');
  perform tap.ok((select wedding_id from se_vezmou.retention_due_weddings(now(), 2)) = v_ids[5], 'dávka obsahuje web bez pokusů');
  perform tap.eq((select count(*) from se_vezmou.retention_due_weddings(now() + interval '29 minutes', 10)), 1, 'po 29 minutách je záloha pořád platná');
  perform tap.eq((select count(*) from se_vezmou.retention_due_weddings(now() + interval '31 minutes', 10)), 5, 'po záloze (30 minut) jsou weby znovu k dispozici');
  perform tap.ok((select wedding_id from se_vezmou.retention_due_weddings(now() + interval '31 minutes', 10) limit 1) = v_ids[5],
    'nejdřív web bez pokusů, potom ty po neúspěšných pokusech');
  -- druhý neúspěch prodlouží zálohu (1 h)
  perform se_vezmou.retention_claim(v_ids[1], now() + interval '31 minutes');
  perform se_vezmou.retention_release(v_ids[1]);
  perform tap.eq((select count(*) from se_vezmou.retention_due_weddings(now() + interval '31 minutes' + interval '59 minutes', 10) where wedding_id = v_ids[1]), 0,
    'druhý neúspěch: záloha 60 minut');
  perform tap.eq((select count(*) from se_vezmou.retention_due_weddings(now() + interval '31 minutes' + interval '61 minutes', 10) where wedding_id = v_ids[1]), 1,
    'po 60 minutách je web znovu k dispozici');
  -- zapůjčení vyprší samo (pád úlohy): po 15 minutách se web znovu nabídne
  perform tap.ok(se_vezmou.retention_claim(v_ids[5], now()), 'převzetí webu bez pokusů');
  perform tap.reset();
  update se_vezmou.weddings set purge_claimed_at = now() - interval '16 minutes' where id = v_ids[5];
  set local role service_role;
  perform tap.eq((select count(*) from se_vezmou.retention_due_weddings(now() + interval '2 hours', 10) where wedding_id = v_ids[5]), 1,
    'prošlé zapůjčení po pádu úlohy web znovu uvolní');
  -- úspěšné smazání odstraní web
  v_n := se_vezmou.purge_deleted_weddings(20, now(), v_ids[5]);
  perform tap.reset();
  perform tap.eq(v_n, 1, 'purge_deleted_weddings po převzetí smaže web');
  perform set_config('se_vezmou.test_clock', 'off', true);
end
$$;

rollback;
