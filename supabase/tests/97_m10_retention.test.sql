-- M10: retence a nevratné mazání (FR-OPS-5): zdravotní údaje zvlášť od ostatních, mazání po lhůtě a ne před ní,
-- audit bez osobních údajů, adresa zveřejněného webu se znovu nepřidělí, izolace svatby, idempotence,
-- dry_run a simulovaný čas (p_now).
begin;
-- testovací hodina (se_vezmou.clock_guard): bez ní by funkce odmítly p_now z budoucnosti; hlídá ji 98_db_hardening
select set_config('se_vezmou.test_clock', 'on', true);
select tap.seed();

-- svatba A: 2027-06-12 (zdraví 2027-07-12, hosté 2028-06-12), svatba B: 2027-08-01 (zdraví 2027-08-31, hosté 2028-08-01)
update se_vezmou.weddings set starts_on = date '2027-06-12' where id = tap.wa();
update se_vezmou.weddings set starts_on = date '2027-08-01' where id = tap.wb();

-- ---------------------------------------------------------------------------
-- Zdravotní údaje (dieta, alergie): 30 dní po svatbě, zvlášť od ostatních údajů
-- ---------------------------------------------------------------------------
do $$
declare
  v_due timestamptz := timestamptz '2027-07-12 00:00 Europe/Prague';
  v_n integer;
  v_audit bigint;
begin
  select count(*) into v_audit from se_vezmou.audit_log where wedding_id = tap.wa();
  set local role service_role;
  v_n := se_vezmou.purge_health_data(100, v_due - interval '1 second');
  perform tap.eq(v_n, 0, 'před lhůtou (o sekundu) se zdravotní údaje nemažou');
  v_n := se_vezmou.purge_health_data(100, v_due, null, true);
  perform tap.eq(v_n, 1, 'dry_run ohlásí jeden řádek zdravotních údajů');
  perform tap.reset();
  perform tap.eq((select count(*) from se_vezmou.rsvp_health where wedding_id = tap.wa()), 1, 'dry_run nic nesmazal');
  perform tap.eq((select count(*) from se_vezmou.audit_log where wedding_id = tap.wa()), v_audit, 'dry_run nezapsal audit');
  perform tap.eq((select count(*) from se_vezmou.lifecycle_notices where wedding_id = tap.wa()), 0, 'dry_run nezaložil zprávu o smazání');

  set local role service_role;
  v_n := se_vezmou.purge_health_data(100, v_due, tap.wb());
  perform tap.eq(v_n, 0, 'omezení na svatbu B (lhůta nenastala) nesmaže nic');
  v_n := se_vezmou.purge_health_data(100, v_due);
  perform tap.reset();
  perform tap.eq(v_n, 1, 've lhůtě se smažou zdravotní údaje A');
  perform tap.eq((select count(*) from se_vezmou.rsvp_health where wedding_id = tap.wa()), 0, 'zdravotní údaje A jsou pryč');
  perform tap.eq((select count(*) from se_vezmou.rsvp_health where wedding_id = tap.wb()), 1, 'zdravotní údaje B zůstaly (izolace svatby)');

  -- zvlášť od ostatních údajů: hosté, odpovědi, účast i lístky A zůstávají
  perform tap.eq((select count(*) from se_vezmou.guests where wedding_id = tap.wa()), 2, 'hosté A zůstali');
  perform tap.eq((select count(*) from se_vezmou.households where wedding_id = tap.wa()), 1, 'domácnost A zůstala');
  perform tap.eq((select count(*) from se_vezmou.rsvp_responses where wedding_id = tap.wa()), 1, 'odpověď A zůstala');
  perform tap.eq((select count(*) from se_vezmou.rsvp_people where wedding_id = tap.wa()), 1, 'osoba v RSVP A zůstala');
  perform tap.eq((select count(*) from se_vezmou.rsvp_attendance where wedding_id = tap.wa()), 1, 'účast A zůstala');
  perform tap.eq((select count(*) from se_vezmou.rsvp_tickets where wedding_id = tap.wa()), 1, 'lístek A zůstal');
  perform tap.eq((select count(*) from se_vezmou.guests where wedding_id = tap.wb()), 2, 'hosté B zůstali');

  perform tap.ok(exists (select 1 from se_vezmou.audit_log where wedding_id = tap.wa() and action = 'retention.purge'
                          and actor_type = 'system' and meta = '{"kind": "health", "rows": 1}'),
    'audit: jen druh a počet řádků');
  perform tap.ok(exists (select 1 from se_vezmou.lifecycle_notices where wedding_id = tap.wa() and kind = 'health_purge' and stage = 'done'
                          and event_at = v_due and status = 'pending'),
    'založena zpráva o provedeném smazání (odešle ji úloha životního cyklu)');

  set local role service_role;
  perform tap.eq(se_vezmou.purge_health_data(100, v_due), 0, 'opakované spuštění je idempotentní');
  perform tap.eq(se_vezmou.purge_health_data(100, v_due + interval '5 years'), 1, 'později se smažou zdravotní údaje B');
  perform tap.reset();
  perform tap.eq((select count(*) from se_vezmou.audit_log where wedding_id = tap.wa() and action = 'retention.purge' and meta = '{"kind": "health", "rows": 1}'), 1,
    'idempotentní běh nezapsal další audit');
end
$$;

-- ---------------------------------------------------------------------------
-- Ostatní údaje hostů: 12 měsíců po svatbě, v pořadí závislostí; izolace svatby
-- ---------------------------------------------------------------------------
do $$
declare
  v_due timestamptz := timestamptz '2028-06-12 00:00 Europe/Prague';
  v_n integer;
begin
  set local role service_role;
  v_n := se_vezmou.purge_guest_data(100, v_due - interval '1 second');
  perform tap.eq(v_n, 0, 'před lhůtou 12 měsíců se údaje hostů nemažou');
  v_n := se_vezmou.purge_guest_data(100, v_due, null, true);
  perform tap.ok(v_n >= 7, 'dry_run ohlásí řádky ke smazání (' || v_n || ')');
  perform tap.reset();
  perform tap.eq((select count(*) from se_vezmou.guests where wedding_id = tap.wa()), 2, 'dry_run nic nesmazal');

  set local role service_role;
  v_n := se_vezmou.purge_guest_data(100, v_due);
  perform tap.reset();
  perform tap.ok(v_n >= 7, 've lhůtě se smažou údaje hostů A (' || v_n || ' řádků)');
  perform tap.eq((select count(*) from se_vezmou.guests where wedding_id = tap.wa())
               + (select count(*) from se_vezmou.households where wedding_id = tap.wa())
               + (select count(*) from se_vezmou.invitations where wedding_id = tap.wa())
               + (select count(*) from se_vezmou.rsvp_responses where wedding_id = tap.wa())
               + (select count(*) from se_vezmou.rsvp_people where wedding_id = tap.wa())
               + (select count(*) from se_vezmou.rsvp_attendance where wedding_id = tap.wa())
               + (select count(*) from se_vezmou.rsvp_tickets where wedding_id = tap.wa()), 0, 'všechny údaje hostů A jsou pryč');
  perform tap.eq((select count(*) from se_vezmou.guests where wedding_id = tap.wb()), 2, 'hosté B zůstali (jiná lhůta)');
  perform tap.eq((select count(*) from se_vezmou.rsvp_health where wedding_id = tap.wb()), 0, 'zdraví B už bylo smazáno dřív');
  perform tap.eq((select count(*) from se_vezmou.pages where wedding_id = tap.wa()), 1, 'obsah webu A zůstal');
  perform tap.eq((select count(*) from se_vezmou.wedding_admins where wedding_id = tap.wa()), 1, 'správce A zůstal');
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where wedding_id = tap.wa() and action = 'retention.purge' and meta ->> 'kind' = 'guests' and (meta ->> 'rows')::int = v_n),
    'audit mazání hostů nese jen počet řádků');
  perform tap.ok(exists (select 1 from se_vezmou.lifecycle_notices where wedding_id = tap.wa() and kind = 'guest_purge' and stage = 'done'), 'zpráva o smazání hostů je založena');
  set local role service_role;
  perform tap.eq(se_vezmou.purge_guest_data(100, v_due), 0, 'opakované spuštění je idempotentní');
  perform tap.reset();
end
$$;

-- zdravotní údaje, které v době mazání hostů ještě existují, zmizí s nimi (prodloužená lhůta nepřežije)
do $$
declare
  v_n integer;
begin
  update se_vezmou.weddings set guest_purge_at = timestamptz '2028-08-01 00:00 Europe/Prague' where id = tap.wb();
  insert into se_vezmou.rsvp_health (person_id, wedding_id, diet) values (tap.u('B:person'), tap.wb(), 'bez lepku')
    on conflict (person_id) do nothing;
  set local role service_role;
  v_n := se_vezmou.purge_guest_data(100, timestamptz '2028-08-01 00:00 Europe/Prague');
  perform tap.reset();
  perform tap.ok(v_n >= 7, 'údaje hostů B smazány');
  perform tap.eq((select count(*) from se_vezmou.rsvp_health where wedding_id = tap.wb()), 0, 'zdravotní údaje B zmizely spolu s ostatními');
end
$$;

-- audit nikdy neobsahuje osobní údaje
do $$
begin
  perform tap.ok(not exists (select 1 from se_vezmou.audit_log
                              where meta::text ~* '(novák|nováková|svoboda|svobodová|vegetari|ořechy|bez lepku|example\.test)'
                                 or coalesce(reason, '') ~* '(novák|svoboda|example\.test)'),
    'audit_log po retenci neobsahuje jména, e-maily ani zdravotní údaje');
  perform tap.throws(format('select se_vezmou.write_audit(''system'', null, %L, ''retention.purge'', null, null, null, ''{"diet": "x"}''::jsonb)', tap.wa()),
    '22023', 'databáze odmítne zápis dietního údaje do auditu');
end
$$;

-- ---------------------------------------------------------------------------
-- Trvalé smazání webu: až po uplynutí ochranné lhůty, adresa se znovu nepřidělí
-- ---------------------------------------------------------------------------
do $$
declare
  v_purge_at timestamptz;
  v_res jsonb;
  v_before bigint;
begin
  -- svatba, která není ve stavu deleted, se nikdy nesmaže
  set local role service_role;
  perform tap.throws(format('select se_vezmou.purge_wedding(%L, now() + interval ''10 years'')', tap.wa()), 'wedding_not_purgeable', 'zveřejněný web nejde trvale smazat');
  perform tap.reset();

  update se_vezmou.weddings set status = 'deleted' where id = tap.wa();
  select purge_at into v_purge_at from se_vezmou.weddings where id = tap.wa();
  perform tap.ok(v_purge_at > now() + interval '29 days' and v_purge_at < now() + interval '31 days', 'ochranná lhůta podle deleted_site_restore_days (30)');

  set local role service_role;
  perform tap.throws(format('select se_vezmou.purge_wedding(%L, %L)', tap.wa(), v_purge_at - interval '1 second'), 'wedding_not_purgeable', 'před koncem ochranné lhůty se nesmaže');
  perform tap.eq(se_vezmou.purge_deleted_weddings(100, v_purge_at - interval '1 second'), 0, 'dávka před koncem lhůty nesmaže nic');
  perform tap.eq((select count(*) from se_vezmou.retention_due_weddings(v_purge_at - interval '1 second')), 0, 'seznam k trvalému smazání je před lhůtou prázdný');
  perform tap.eq((select count(*) from se_vezmou.retention_due_weddings(v_purge_at)), 1, 'po lhůtě je web v seznamu k trvalému smazání');
  perform tap.eq((select media_count from se_vezmou.retention_due_weddings(v_purge_at, 20, tap.wa())), 1, 'seznam nese počet souborů');
  perform tap.eq(se_vezmou.purge_deleted_weddings(100, v_purge_at, null, true), 1, 'dry_run ohlásí jeden web');
  perform tap.reset();
  perform tap.eq((select count(*) from se_vezmou.weddings where id = tap.wa()), 1, 'dry_run web nesmazal');
  perform tap.ok(exists (select 1 from se_vezmou.slug_registry where slug = 'klara-a-matej' and state = 'active'), 'dry_run nezměnil adresu');

  -- obnovení v ochranné lhůtě (operátor) zruší purge_at: trvalé smazání pak nikdy neproběhne
  update se_vezmou.weddings set status = 'published' where id = tap.wa();
  perform tap.ok((select purge_at is null from se_vezmou.weddings where id = tap.wa()), 'obnova zruší purge_at');
  set local role service_role;
  perform tap.eq(se_vezmou.purge_deleted_weddings(100, now() + interval '10 years'), 0, 'obnovený web se nesmaže ani po letech');
  perform tap.reset();
  update se_vezmou.weddings set status = 'deleted' where id = tap.wa();
  select purge_at into v_purge_at from se_vezmou.weddings where id = tap.wa();

  -- po lhůtě: smazání, adresa zůstává trvale blokovaná
  select count(*) into v_before from se_vezmou.audit_log where wedding_id = tap.wa();
  set local role service_role;
  v_res := se_vezmou.purge_wedding(tap.wa(), v_purge_at);
  perform tap.reset();
  perform tap.eq((select count(*) from se_vezmou.weddings where id = tap.wa()), 0, 'web je trvale smazán');
  perform tap.eq((select count(*) from se_vezmou.pages where wedding_id = tap.wa())
               + (select count(*) from se_vezmou.content_blocks where wedding_id = tap.wa())
               + (select count(*) from se_vezmou.events where wedding_id = tap.wa())
               + (select count(*) from se_vezmou.venues where wedding_id = tap.wa())
               + (select count(*) from se_vezmou.media where wedding_id = tap.wa())
               + (select count(*) from se_vezmou.site_versions where wedding_id = tap.wa())
               + (select count(*) from se_vezmou.wedding_admins where wedding_id = tap.wa())
               + (select count(*) from se_vezmou.wedding_auth where wedding_id = tap.wa())
               + (select count(*) from se_vezmou.sessions where wedding_id = tap.wa())
               + (select count(*) from se_vezmou.lifecycle_notices where wedding_id = tap.wa()), 0, 'veškerý obsah, správci a evidence upozornění jsou pryč');
  perform tap.ok(v_res -> 'storage_paths' = to_jsonb(array[tap.wa()::text || '/foto/1.webp']), 'funkce vrací cesty souborů s předponou {wedding_id}/');
  perform tap.ok(v_res ->> 'kind' = 'wedding' and (v_res ->> 'media')::int = 1, 'funkce vrací počty');
  perform tap.ok(exists (select 1 from se_vezmou.slug_registry where slug = 'klara-a-matej' and state = 'retired' and wedding_id is null and first_published_at is not null),
    'adresa zveřejněného webu zůstala v registru jako retired');
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where wedding_id = tap.wa() and action = 'retention.purge' and meta ->> 'kind' = 'wedding' and actor_type = 'system'),
    'smazání je v auditu a audit přežil svatbu');
  perform tap.ok((select count(*) from se_vezmou.audit_log where wedding_id = tap.wa()) > v_before, 'záznamy auditu zůstaly');
  perform tap.ok(not exists (select 1 from se_vezmou.audit_log where meta::text ~* '(novák|klára|matěj|example\.test)'), 'audit nemá jména ani e-maily');
  perform tap.ok((select email_log_ok from (select not exists (select 1 from se_vezmou.email_log where wedding_id = tap.wa()) as email_log_ok) x), 'záznamy e-mailů svatby nemají odkaz na smazanou svatbu');

  -- adresa se znovu nepřidělí
  perform tap.ok(not se_vezmou.slug_available('klara-a-matej'), 'adresa smazaného webu není dostupná');
  set local role service_role;
  perform tap.eq((select count(*) from se_vezmou.resolve_slug('klara-a-matej')), 0, 'resolve_slug smazaného webu nic nevrátí (404 bez výpisu)');
  perform tap.ok(not (select available from se_vezmou.check_slug('klara-a-matej')), 'check_slug hlásí nedostupnou adresu');
  perform tap.reset();
  perform tap.throws(format('update se_vezmou.slug_registry set state = ''reserved'', reserved_until = now() + interval ''1 day'', wedding_id = %L where slug = ''klara-a-matej''', tap.wb()),
    '23001', 'zveřejněnou adresu nejde vrátit do rezervace');
  perform tap.throws('delete from se_vezmou.slug_registry where slug = ''klara-a-matej''', '23001', 'řádek zveřejněné adresy nejde smazat');
  perform tap.throws(format('insert into se_vezmou.slug_registry (slug, state, wedding_id, reserved_until) values (''klara-a-matej'', ''reserved'', %L, now() + interval ''1 day'')', tap.wb()),
    '23505', 'adresu nejde zaregistrovat podruhé');
  insert into se_vezmou.weddings (id, partner_a_name, partner_b_name) values (tap.u('F:wedding'), 'Klára', 'Matěj');
  set local role service_role;
  perform tap.ok(not (select r.ok from se_vezmou.reserve_slug(tap.u('F:wedding'), 'klara-a-matej') r), 'jiný koncept si adresu smazaného webu nezarezervuje');
  perform tap.reset();
  perform tap.eq((select count(*) from se_vezmou.slug_registry where slug = 'klara-a-matej' and state = 'retired'), 1, 'adresa zůstala retired');

  -- druhý pokus: svatba už neexistuje
  set local role service_role;
  perform tap.throws(format('select se_vezmou.purge_wedding(%L, now())', tap.wa()), 'wedding_not_found', 'opakované smazání hlásí neexistující web');
  perform tap.reset();

  -- izolace: svatba B je nedotčená
  perform tap.eq((select count(*) from se_vezmou.weddings where id = tap.wb()), 1, 'svatba B existuje');
  perform tap.eq((select count(*) from se_vezmou.pages where wedding_id = tap.wb()), 1, 'obsah B zůstal');
  perform tap.ok(exists (select 1 from se_vezmou.slug_registry where slug = 'druha-svatba' and state = 'active'), 'adresa B zůstala aktivní');
end
$$;

-- nezveřejněný koncept: rezervace adresy se po smazání uvolní
do $$
declare
  w uuid := tap.u('D:wedding');
  v_purge_at timestamptz;
begin
  insert into se_vezmou.weddings (id, partner_a_name, partner_b_name, starts_on) values (w, 'Dana', 'David', date '2027-05-01');
  insert into se_vezmou.slug_registry (slug, state, wedding_id, reserved_until) values ('dana-a-david', 'reserved', w, now() + interval '30 days');
  update se_vezmou.weddings set slug = 'dana-a-david' where id = w;
  set constraints all immediate;
  update se_vezmou.weddings set status = 'deleted' where id = w;
  select purge_at into v_purge_at from se_vezmou.weddings where id = w;
  set local role service_role;
  perform tap.eq(se_vezmou.purge_deleted_weddings(100, v_purge_at, w), 1, 'smazán koncept');
  perform tap.reset();
  perform tap.ok(se_vezmou.slug_available('dana-a-david'), 'rezervace nezveřejněné adresy se uvolnila');
  perform tap.eq((select count(*) from se_vezmou.slug_registry where slug = 'dana-a-david'), 0, 'řádek rezervace je pryč (nikdy nebyl zveřejněn)');
end
$$;

-- ---------------------------------------------------------------------------
-- Rezervace slugů a housekeeping se simulovaným časem
-- ---------------------------------------------------------------------------
do $$
declare
  w uuid := tap.u('E:wedding');
  v_res timestamptz;
  v_r jsonb;
begin
  insert into se_vezmou.weddings (id, partner_a_name, partner_b_name) values (w, 'Eva', 'Emil');
  insert into se_vezmou.slug_registry (slug, state, wedding_id, reserved_until) values ('eva-a-emil', 'reserved', w, now() + interval '30 days');
  update se_vezmou.weddings set slug = 'eva-a-emil' where id = w;
  set constraints all immediate;
  select reserved_until into v_res from se_vezmou.slug_registry where slug = 'eva-a-emil';
  set local role service_role;
  perform tap.eq(se_vezmou.purge_expired_slug_reservations(v_res - interval '1 second'), 0, 'před koncem rezervace se adresa neuvolní');
  perform tap.eq(se_vezmou.purge_expired_slug_reservations(v_res, true), 1, 'dry_run ohlásí uvolnění');
  perform tap.reset();
  perform tap.eq((select count(*) from se_vezmou.slug_registry where slug = 'eva-a-emil'), 1, 'dry_run adresu neuvolnil');
  set local role service_role;
  perform tap.eq(se_vezmou.purge_expired_slug_reservations(v_res), 1, 'po konci rezervace se adresa uvolní');
  perform tap.eq(se_vezmou.purge_expired_slug_reservations(v_res), 0, 'idempotentní');
  perform tap.reset();
  perform tap.ok((select slug is null from se_vezmou.weddings where id = w), 'koncept ztratí slug');

  -- housekeeping: relace, výzvy, čítače a provozní záznamy podle nastavení
  insert into se_vezmou.analytics_event (event, locale, created_at) values ('wizard_started', 'cs', timestamptz '2025-01-01'), ('wizard_started', 'cs', timestamptz '2027-01-01');
  insert into se_vezmou.email_log (type, recipient_hash, recipient_domain, created_at) values ('login_code', '\x01', 'example.test', timestamptz '2027-01-01');
  insert into se_vezmou.job_runs (job, started_at, finished_at, status) values ('lifecycle', timestamptz '2027-01-01', timestamptz '2027-01-01', 'ok');
  insert into se_vezmou.rate_limits (bucket_key, window_start, hits) values ('hk-test', timestamptz '2027-01-01', 3);
  set local role service_role;
  v_r := se_vezmou.housekeeping(timestamptz '2027-05-01', true);
  perform tap.ok((v_r ->> 'analytics_events')::int = 1 and (v_r ->> 'mail_log')::int >= 1 and (v_r ->> 'job_runs')::int >= 1 and (v_r ->> 'rate_limits')::int = 1,
    'dry_run housekeeping ohlásí práci: ' || v_r::text);
  perform tap.reset();
  perform tap.eq((select count(*) from se_vezmou.analytics_event where created_at = timestamptz '2025-01-01'), 1, 'dry_run housekeeping nic nesmazal');
  set local role service_role;
  v_r := se_vezmou.housekeeping(timestamptz '2027-05-01');
  perform tap.reset();
  perform tap.ok((v_r ->> 'analytics_events')::int = 1 and (v_r ->> 'mail_log')::int >= 1 and (v_r ->> 'rate_limits')::int = 1,
    'housekeeping smazal prošlé záznamy');
  perform tap.eq((select count(*) from se_vezmou.analytics_event where created_at = timestamptz '2027-01-01'), 1, 'čerstvá analytická událost zůstala (24 měsíců)');
  set local role service_role;
  v_r := se_vezmou.housekeeping(timestamptz '2027-05-01');
  perform tap.reset();
  perform tap.ok((v_r ->> 'analytics_events')::int = 0 and (v_r ->> 'mail_log')::int = 0 and (v_r ->> 'rate_limits')::int = 0, 'housekeeping je idempotentní');
  perform tap.ok((select count(*) from se_vezmou.audit_log) > 0, 'audit_log housekeeping nemaže');
end
$$;

-- ---------------------------------------------------------------------------
-- Role: mazání smí jen service role; správce ani host ne
-- ---------------------------------------------------------------------------
do $$
declare
  v_role text;
begin
  foreach v_role in array array['admin', 'visitor', 'guest_pin'] loop
    perform tap.become('authenticated', tap.wb(), v_role);
    perform tap.throws('select se_vezmou.purge_health_data(100, now() + interval ''10 years'')', '42501', v_role || ' nespustí mazání zdravotních údajů');
    perform tap.throws('select se_vezmou.purge_guest_data(100, now() + interval ''10 years'')', '42501', v_role || ' nespustí mazání hostů');
    perform tap.throws(format('select se_vezmou.purge_wedding(%L, now())', tap.wb()), '42501', v_role || ' nesmaže web');
    perform tap.throws('select se_vezmou.housekeeping(now() + interval ''10 years'')', '42501', v_role || ' nespustí úklid');
    perform tap.reset();
  end loop;
  set local role anon;
  perform tap.throws('select se_vezmou.purge_deleted_weddings(100, now())', '42501', 'anon nespustí mazání webů');
  perform tap.reset();
  perform tap.eq((select count(*) from se_vezmou.weddings where id = tap.wb()), 1, 'svatba B po všech pokusech existuje');
end
$$;

rollback;
