-- M10: životní cyklus (fáze, archivace, ruční přepsání), zámek běhů úloh, upozornění a dohled pro operátora.
-- „Teď“ se předává parametrem p_now: simulovaný čas bez čekání.
begin;
select tap.seed();

-- ---------------------------------------------------------------------------
-- Odvozená fáze: zlaté vektory sdílené s TypeScriptem (src/lib/lifecycle/phase.test.ts)
-- ---------------------------------------------------------------------------
create temp table phase_vectors (
  name text, status text, tz text, starts_on date, ends_on date, has_settings boolean,
  opens_at timestamptz, closes_at timestamptz, at timestamptz, override text, expected text);
\copy phase_vectors from 'supabase/tests/golden/phase-vectors.tsv'

do $$
declare
  r record;
  v_n integer := 0;
  v_got text;
begin
  for r in select * from phase_vectors loop
    v_n := v_n + 1;
    -- svatba A je zveřejněná; upravujeme ji podle vektoru
    delete from se_vezmou.rsvp_settings where wedding_id = tap.wa();
    update se_vezmou.weddings
       set status = 'draft', starts_on = null, ends_on = null where id = tap.wa();
    update se_vezmou.weddings
       set timezone = r.tz, starts_on = r.starts_on, ends_on = r.ends_on, phase_override = r.override
     where id = tap.wa();
    if r.has_settings then
      insert into se_vezmou.rsvp_settings (wedding_id, opens_at, closes_at) values (tap.wa(), r.opens_at, r.closes_at);
    end if;
    update se_vezmou.weddings set status = r.status where id = tap.wa();
    select se_vezmou.phase(w, r.at) into v_got from se_vezmou.weddings w where w.id = tap.wa();
    perform tap.ok(v_got is not distinct from r.expected,
      format('fáze %L: očekáváno %s, získáno %s', r.name, coalesce(r.expected, 'null'), coalesce(v_got, 'null')));
  end loop;
  perform tap.ok(v_n >= 15, 'načteno aspoň 15 vektorů fáze (' || v_n || ')');
end
$$;

-- návrat svatby A do výchozího stavu pro další kontroly
update se_vezmou.weddings set status = 'published', phase_override = null, timezone = 'Europe/Prague',
  starts_on = null, ends_on = null where id = tap.wa();
update se_vezmou.weddings set starts_on = date '2027-06-12' where id = tap.wa();
update se_vezmou.weddings set starts_on = date '2027-08-01' where id = tap.wb();

-- ---------------------------------------------------------------------------
-- Konec provozu a archivace (published -> archived)
-- ---------------------------------------------------------------------------
do $$
declare
  v_expires timestamptz;
  v_n integer;
begin
  select se_vezmou.lifecycle_expires_at(w) into v_expires from se_vezmou.weddings w where w.id = tap.wa();
  perform tap.ok(v_expires = timestamptz '2027-09-10 00:00 Europe/Prague',
    'konec provozu: 90 dní po svatbě (půlnoc v pásmu svatby), získáno ' || v_expires);

  -- retenční data odvozená spouštěčem z M3 (zdraví 30 dní, hosté 12 měsíců)
  perform tap.ok((select health_purge_at = timestamptz '2027-07-12 00:00 Europe/Prague'
                         and guest_purge_at = timestamptz '2028-06-12 00:00 Europe/Prague'
                    from se_vezmou.weddings where id = tap.wa()), 'retenční data A pocházejí ze spouštěče M3');

  set local role service_role;
  v_n := se_vezmou.lifecycle_archive_due(v_expires - interval '1 second');
  perform tap.eq(v_n, 0, 'před koncem provozu se nic nearchivuje');
  v_n := se_vezmou.lifecycle_archive_due(v_expires, 100, null, true);
  perform tap.eq(v_n, 1, 'dry_run ohlásí jednu svatbu k archivaci');
  perform tap.reset();
  perform tap.ok((select status = 'published' from se_vezmou.weddings where id = tap.wa()), 'dry_run nic nezměnil');
  perform tap.ok(not exists (select 1 from se_vezmou.wedding_status_history where wedding_id = tap.wa() and to_status = 'archived')
                 and not exists (select 1 from se_vezmou.audit_log where wedding_id = tap.wa() and action = 'wedding.status_change' and actor_type = 'system'),
    'dry_run nezapsal historii ani audit');

  set local role service_role;
  v_n := se_vezmou.lifecycle_archive_due(v_expires, 100, tap.wb());
  perform tap.eq(v_n, 0, 'omezení na jinou svatbu (B má později) nearchivuje A');
  v_n := se_vezmou.lifecycle_archive_due(v_expires);
  perform tap.eq(v_n, 1, 'po konci provozu se A archivuje a B ne');
  perform tap.reset();
  perform tap.ok((select status = 'archived' from se_vezmou.weddings where id = tap.wa()), 'A je archivovaná');
  perform tap.ok((select status = 'published' from se_vezmou.weddings where id = tap.wb()), 'B zůstala zveřejněná');
  perform tap.ok((select health_purge_at = timestamptz '2027-07-12 00:00 Europe/Prague'
                         and guest_purge_at = timestamptz '2028-06-12 00:00 Europe/Prague'
                    from se_vezmou.weddings where id = tap.wa()), 'archivace nepřepsala existující retenční data');
  perform tap.ok(exists (select 1 from se_vezmou.wedding_status_history
                          where wedding_id = tap.wa() and from_status = 'published' and to_status = 'archived'
                            and actor_type = 'system' and actor_id is null and reason = 'service_expired'),
    'historie stavu eviduje přechod systémem');
  perform tap.ok(exists (select 1 from se_vezmou.audit_log
                          where wedding_id = tap.wa() and action = 'wedding.status_change' and actor_type = 'system'
                            and meta = '{"from_status": "published", "to_status": "archived"}'),
    'audit přechodu je bez osobních údajů');
  set local role service_role;
  perform tap.eq(se_vezmou.lifecycle_archive_due(v_expires), 0, 'opakované spuštění je idempotentní');
  perform tap.eq((select count(*) from se_vezmou.resolve_slug('klara-a-matej')), 0, 'archivovaný web už není veřejný (resolve_slug)');
  perform tap.reset();
end
$$;

-- doplnění retenčních dat u webu bez data svatby a archivace podle konce objednaného provozu
do $$
declare
  v_now timestamptz := timestamptz '2027-03-01 12:00 Europe/Prague';
  v_n integer;
begin
  update se_vezmou.weddings set starts_on = null, ends_on = null where id = tap.wb();
  perform tap.ok((select health_purge_at is null and guest_purge_at is null from se_vezmou.weddings where id = tap.wb()),
    'web bez data svatby nemá retenční data');
  set local role service_role;
  perform tap.eq(se_vezmou.lifecycle_archive_due(timestamptz '2099-01-01'), 0, 'web bez data a bez konce provozu se nearchivuje nikdy');
  perform tap.reset();

  update se_vezmou.orders set service_ends_at = v_now - interval '1 day' where wedding_id = tap.wb();
  set local role service_role;
  v_n := se_vezmou.lifecycle_archive_due(v_now);
  perform tap.reset();
  perform tap.eq(v_n, 1, 'archivace podle konce objednaného provozu');
  perform tap.ok((select health_purge_at = v_now + interval '30 days' and guest_purge_at = v_now + interval '12 months'
                    from se_vezmou.weddings where id = tap.wb()),
    'chybějící retenční data se doplní od okamžiku archivace podle app_settings');
end
$$;

-- dávkování: dvě svatby po konci provozu, dávka po jedné
do $$
declare
  v_expires timestamptz;
begin
  update se_vezmou.weddings set status = 'published', starts_on = date '2027-06-12', ends_on = null where id in (tap.wa(), tap.wb());
  update se_vezmou.orders set service_ends_at = null where wedding_id = tap.wb();
  v_expires := timestamptz '2027-09-10 00:00 Europe/Prague';
  set local role service_role;
  perform tap.eq(se_vezmou.lifecycle_archive_due(v_expires, 1), 1, 'dávka 1: první běh archivuje jednu svatbu');
  perform tap.eq(se_vezmou.lifecycle_archive_due(v_expires, 1), 1, 'dávka 1: druhý běh druhou');
  perform tap.eq(se_vezmou.lifecycle_archive_due(v_expires, 1), 0, 'dávka 1: třetí běh nemá co dělat');
  perform tap.throws('select se_vezmou.lifecycle_archive_due(now(), 0)', '22023', 'neplatná dávka se odmítne');
  perform tap.reset();
  update se_vezmou.weddings set status = 'published' where id in (tap.wa(), tap.wb());
end
$$;

-- ---------------------------------------------------------------------------
-- Ruční přepsání fáze (operátor, s auditem)
-- ---------------------------------------------------------------------------
do $$
begin
  set local role service_role;
  perform se_vezmou.op_set_phase_override(tap.u('operator:support'), tap.wa(), 'thanks', 'Pár žádá dřívější poděkování');
  perform tap.reset();
  perform tap.ok((select phase_override = 'thanks' from se_vezmou.weddings where id = tap.wa()), 'přepsání se uložilo');
  perform tap.ok((select se_vezmou.phase(w, timestamptz '2027-01-01') = 'thanks' from se_vezmou.weddings w where w.id = tap.wa()),
    'přepsaná fáze platí bez ohledu na data');
  perform tap.ok(exists (select 1 from se_vezmou.audit_log
                          where wedding_id = tap.wa() and action = 'wedding.phase_override' and actor_type = 'operator'
                            and actor_id = tap.u('operator:support') and reason = 'Pár žádá dřívější poděkování'
                            and meta = '{"from_phase": null, "to_phase": "thanks"}'),
    'přepsání je v auditu s operátorem a důvodem');

  set local role service_role;
  perform se_vezmou.op_set_phase_override(tap.u('operator:support'), tap.wa(), 'thanks', 'znovu');
  perform tap.reset();
  perform tap.eq((select count(*) from se_vezmou.audit_log where wedding_id = tap.wa() and action = 'wedding.phase_override'), 1,
    'stejná hodnota nezapíše další audit');

  set local role service_role;
  perform tap.throws(format('select se_vezmou.op_set_phase_override(%L, %L, ''nesmysl'', ''x'')', tap.u('operator:support'), tap.wa()), '22023', 'neplatná fáze se odmítne');
  perform tap.throws(format('select se_vezmou.op_set_phase_override(%L, %L, ''thanks'', '' '')', tap.u('operator:support'), tap.wa()), 'reason_required', 'bez důvodu to nejde');
  perform tap.throws(format('select se_vezmou.op_set_phase_override(%L, %L, ''thanks'', ''x'')', tap.u('operator:disabled'), tap.wa()), '42501', 'zakázaný operátor nepřepíše fázi');
  perform tap.throws(format('select se_vezmou.op_set_phase_override(%L, %L, null, ''x'')', tap.u('A:admin'), tap.wa()), '42501', 'správce není operátor');
  perform se_vezmou.op_set_phase_override(tap.u('operator:owner'), tap.wa(), null, 'Zrušení přepsání');
  perform tap.reset();
  perform tap.ok((select phase_override is null from se_vezmou.weddings where id = tap.wa()), 'přepsání se zruší hodnotou null');
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where wedding_id = tap.wa() and meta = '{"from_phase": "thanks", "to_phase": null}'), 'zrušení je v auditu');

  -- správce fázi sám nezmění
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.throws(format('update se_vezmou.weddings set phase_override = ''thanks'' where id = %L', tap.wa()), '42501', 'správce nepřepíše fázi sám');
  perform tap.reset();
end
$$;

-- ---------------------------------------------------------------------------
-- Upozornění: plánování, jedno na událost, převzetí, odeslání, opakování
-- ---------------------------------------------------------------------------
do $$
declare
  v_event timestamptz := timestamptz '2027-07-12 00:00 Europe/Prague'; -- health_purge_at svatby A
  v_r jsonb;
  c record;
  v_cnt integer;
  v_attempt smallint;
  v_kind text;
  v_stage text;
  v_slug text;
  v_locale text;
begin
  perform tap.ok((select health_purge_at = v_event from se_vezmou.weddings where id = tap.wa()), 'předpoklad: health_purge_at A');
  update se_vezmou.weddings set status = 'published' where id = tap.wa();

  set local role service_role;
  -- 15 dní předem: okno 14 dní ještě nezačalo
  v_r := se_vezmou.lifecycle_enqueue_notices(v_event - interval '15 days', tap.wa());
  perform tap.ok(v_r = '{"first": 0, "final": 0}', 'dřív než 14 dní před událostí se nic neplánuje');
  -- přesně 14 dní předem: první upozornění na smazání zdravotních údajů
  v_r := se_vezmou.lifecycle_enqueue_notices(v_event - interval '14 days', tap.wa(), true);
  perform tap.ok(v_r = '{"first": 1, "final": 0}', 'dry_run ohlásí jedno první upozornění');
  perform tap.reset();
  perform tap.eq((select count(*) from se_vezmou.lifecycle_notices where wedding_id = tap.wa()), 0, 'dry_run nic nezapsal');
  set local role service_role;
  v_r := se_vezmou.lifecycle_enqueue_notices(v_event - interval '14 days', tap.wa());
  perform tap.ok(v_r = '{"first": 1, "final": 0}', 'čtrnáct dní předem vznikne první upozornění');
  v_r := se_vezmou.lifecycle_enqueue_notices(v_event - interval '13 days', tap.wa());
  perform tap.ok(v_r = '{"first": 0, "final": 0}', 'jedno upozornění na událost (opakování nic nevytvoří)');
  perform tap.reset();
  perform tap.ok(exists (select 1 from se_vezmou.lifecycle_notices
                          where wedding_id = tap.wa() and kind = 'health_purge' and stage = 'first' and event_at = v_event and status = 'pending'),
    'první upozornění čeká na odeslání');
  perform tap.eq((select count(*) from se_vezmou.lifecycle_notices where wedding_id = tap.wa()), 1,
    'jen zdravotní údaje jsou v okně (hosté za 11 měsíců, konec provozu za 90 dní)');

  -- pending: čeká jedno
  set local role service_role;
  perform tap.eq(se_vezmou.lifecycle_notices_pending(v_event - interval '13 days', tap.wa()), 1, 'čeká jedno upozornění');
  select count(*), max(n.attempt), max(n.kind), max(n.stage), max(n.slug), max(n.locale)
    into v_cnt, v_attempt, v_kind, v_stage, v_slug, v_locale
    from se_vezmou.lifecycle_notices_claim(v_event - interval '13 days', 50, tap.wa()) n;
  perform tap.ok(v_cnt = 1 and v_attempt = 1 and v_kind = 'health_purge' and v_stage = 'first' and v_slug = 'klara-a-matej' and v_locale = 'cs',
    'převzetí vrátí upozornění s adresou webu a jazykem');
  perform tap.eq((select count(*) from se_vezmou.lifecycle_notices_claim(v_event - interval '13 days', 50, tap.wa())), 0,
    'převzaté upozornění si další běh nevezme (sending)');
  perform tap.eq(se_vezmou.lifecycle_notices_pending(v_event - interval '13 days', tap.wa()), 0, 'po převzetí nic nečeká');
  perform tap.reset();

  -- adresáti: aktivní správci, každá adresa jednou
  insert into se_vezmou.wedding_admins (wedding_id, email) values (tap.wa(), 'Druhy@example.test');
  insert into se_vezmou.wedding_admins (wedding_id, email, removed_at) values (tap.wa(), 'odebrany@example.test', now());
  set local role service_role;
  perform tap.eq((select count(*) from se_vezmou.lifecycle_notice_recipients(tap.wa())), 2, 'adresáti: dva aktivní správci, odebraný ne');
  perform tap.ok((select bool_and(locale = 'cs') from se_vezmou.lifecycle_notice_recipients(tap.wa())), 'jazyk e-mailu je výchozí jazyk webu');
  perform tap.eq((select count(*) from se_vezmou.lifecycle_notice_recipients(tap.wb())), 1, 'adresáti svatby B jsou jen její');

  -- dokončení
  perform tap.throws(format('select se_vezmou.lifecycle_notice_finish(%L, 1, 0)', tap.u('neexistuje')), 'notice_not_found', 'neznámé upozornění nejde dokončit');
  perform tap.reset();
  select n.id into c from se_vezmou.lifecycle_notices n where n.wedding_id = tap.wa() and n.stage = 'first';
  set local role service_role;
  perform tap.ok(se_vezmou.lifecycle_notice_finish(c.id, 2, 0) = 'sent', 'upozornění se označí jako odeslané');
  perform tap.throws(format('select se_vezmou.lifecycle_notice_finish(%L, 1, 0)', c.id), 'notice_not_found', 'odeslané upozornění nejde dokončit podruhé');
  perform tap.reset();
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where wedding_id = tap.wa() and action = 'lifecycle.notice'
                          and meta = '{"kind": "health_purge", "stage": "first", "status": "sent", "sent": 2, "failed": 0, "attempt": 1}'),
    'odeslání je v auditu jen s počty');
  set local role service_role;
  v_r := se_vezmou.lifecycle_enqueue_notices(v_event - interval '13 days', tap.wa());
  perform tap.ok(v_r = '{"first": 0, "final": 0}', 'odeslané upozornění se nezaloží znovu');

  -- závěrečné upozornění (1 den před) vznikne zvlášť a first se neopakuje
  v_r := se_vezmou.lifecycle_enqueue_notices(v_event - interval '1 day', tap.wa());
  perform tap.ok(v_r = '{"first": 0, "final": 1}', 'těsně před smazáním vznikne závěrečné upozornění');
  perform tap.reset();
  perform tap.eq((select count(*) from se_vezmou.lifecycle_notices where wedding_id = tap.wa() and kind = 'health_purge'), 2, 'první i závěrečné upozornění');

  -- po události už se upozornění neplánuje a nevyřízené se přeskočí
  set local role service_role;
  v_r := se_vezmou.lifecycle_enqueue_notices(v_event, tap.wa());
  perform tap.ok(v_r = '{"first": 0, "final": 0}', 'po události se neupozorňuje');
  perform tap.eq((select count(*) from se_vezmou.lifecycle_notices_claim(v_event, 50, tap.wa())), 0, 'zastaralé závěrečné upozornění se neodešle');
  perform tap.reset();
  perform tap.ok((select status = 'skipped' from se_vezmou.lifecycle_notices where wedding_id = tap.wa() and stage = 'final'), 'zastaralé upozornění je skipped');
end
$$;

-- B: okno final je otevřené rovnou (první upozornění se přeskočí), neúspěch se opakuje nejvýš třikrát
do $$
declare
  v_event timestamptz;
  v_id uuid;
  v_r jsonb;
begin
  update se_vezmou.weddings set status = 'published', starts_on = date '2027-08-01' where id = tap.wb();
  select health_purge_at into v_event from se_vezmou.weddings where id = tap.wb();
  set local role service_role;
  v_r := se_vezmou.lifecycle_enqueue_notices(v_event - interval '12 hours', tap.wb());
  perform tap.reset();
  perform tap.ok(v_r = '{"first": 0, "final": 1}', 'v okně final vznikne jen závěrečné upozornění');
  select id into v_id from se_vezmou.lifecycle_notices where wedding_id = tap.wb() and stage = 'final';

  set local role service_role;
  perform tap.eq((select count(*) from se_vezmou.lifecycle_notices_claim(v_event - interval '12 hours', 50, tap.wb())), 1, 'převzetí 1');
  perform tap.ok(se_vezmou.lifecycle_notice_finish(v_id, 0, 1) = 'failed', 'nikdo nedostal zprávu: failed');
  perform tap.eq((select count(*) from se_vezmou.lifecycle_notices_claim(v_event - interval '12 hours', 50, tap.wb())), 0, 'neúspěch se hned nezkouší znovu');
  perform tap.reset();

  update se_vezmou.lifecycle_notices set locked_at = now() - interval '2 hours' where id = v_id;
  set local role service_role;
  perform tap.eq((select count(*) from se_vezmou.lifecycle_notices_claim(v_event - interval '12 hours', 50, tap.wb())), 1, 'po hodině se zkusí znovu (pokus 2)');
  perform se_vezmou.lifecycle_notice_finish(v_id, 0, 1);
  perform tap.reset();
  update se_vezmou.lifecycle_notices set locked_at = now() - interval '2 hours' where id = v_id;
  set local role service_role;
  perform tap.eq((select count(*) from se_vezmou.lifecycle_notices_claim(v_event - interval '12 hours', 50, tap.wb())), 1, 'pokus 3');
  perform se_vezmou.lifecycle_notice_finish(v_id, 0, 1);
  perform tap.reset();
  update se_vezmou.lifecycle_notices set locked_at = now() - interval '2 hours' where id = v_id;
  set local role service_role;
  perform tap.eq((select count(*) from se_vezmou.lifecycle_notices_claim(v_event - interval '12 hours', 50, tap.wb())), 0, 'po třech pokusech se už nezkouší');
  perform tap.reset();

  -- zaseknuté převzetí (pád úlohy) se po 15 minutách převezme znovu
  update se_vezmou.lifecycle_notices set status = 'sending', locked_at = now() - interval '20 minutes', attempts = 1 where id = v_id;
  set local role service_role;
  perform tap.eq((select count(*) from se_vezmou.lifecycle_notices_claim(v_event - interval '12 hours', 50, tap.wb())), 1, 'zaseknuté upozornění se převezme znovu');
  perform tap.ok(se_vezmou.lifecycle_notice_finish(v_id, 1, 1) = 'sent', 'částečné doručení je sent (nikdo nedostane duplicitu)');
  perform tap.reset();
  perform tap.ok((select recipients = 1 and failed_recipients = 1 and sent_at is not null from se_vezmou.lifecycle_notices where id = v_id), 'počty adresátů jsou v evidenci');

  -- nikdo k odeslání: skipped
  update se_vezmou.lifecycle_notices set status = 'sending', locked_at = now() where id = v_id;
  set local role service_role;
  perform tap.ok(se_vezmou.lifecycle_notice_finish(v_id, 0, 0) = 'skipped', 'bez adresátů je upozornění skipped');
  perform tap.reset();

  -- smazaná nebo zablokovaná svatba se neupozorňuje
  delete from se_vezmou.lifecycle_notices where wedding_id = tap.wb();
  update se_vezmou.weddings set status = 'blocked' where id = tap.wb();
  set local role service_role;
  v_r := se_vezmou.lifecycle_enqueue_notices(v_event - interval '12 hours', tap.wb());
  perform tap.reset();
  perform tap.ok(v_r = '{"first": 0, "final": 0}', 'zablokovaná svatba se neupozorňuje');
  update se_vezmou.weddings set status = 'published' where id = tap.wb();
  set local role service_role;
  perform se_vezmou.lifecycle_enqueue_notices(v_event - interval '12 hours', tap.wb());
  perform tap.reset();
  update se_vezmou.weddings set status = 'deleted' where id = tap.wb();
  set local role service_role;
  perform tap.eq((select count(*) from se_vezmou.lifecycle_notices_claim(v_event - interval '12 hours', 50, tap.wb())), 0, 'smazané svatbě se nic neodešle');
  perform tap.reset();
  perform tap.ok((select status = 'skipped' from se_vezmou.lifecycle_notices where wedding_id = tap.wb()), 'upozornění smazané svatby je skipped');
  update se_vezmou.weddings set status = 'published' where id = tap.wb();
end
$$;

-- prodloužení lhůty operátorem = nová událost = nové upozornění
do $$
declare
  v_old timestamptz;
  v_new timestamptz;
  v_r jsonb;
begin
  select health_purge_at into v_old from se_vezmou.weddings where id = tap.wa();
  update se_vezmou.weddings set health_purge_at = v_old + interval '50 days' where id = tap.wa();
  v_new := v_old + interval '50 days';
  set local role service_role;
  v_r := se_vezmou.lifecycle_enqueue_notices(v_new - interval '14 days', tap.wa());
  perform tap.reset();
  perform tap.ok(v_r = '{"first": 1, "final": 0}', 'po prodloužení lhůty vznikne nové první upozornění');
  perform tap.eq((select count(distinct event_at) from se_vezmou.lifecycle_notices where wedding_id = tap.wa() and kind = 'health_purge'), 2,
    'evidence rozlišuje události podle data');
end
$$;

-- ---------------------------------------------------------------------------
-- Konec provozu webu: upozornění před archivací (published)
-- ---------------------------------------------------------------------------
do $$
declare
  v_expires timestamptz := timestamptz '2027-09-10 00:00 Europe/Prague';
  v_r jsonb;
begin
  delete from se_vezmou.lifecycle_notices where wedding_id = tap.wa();
  update se_vezmou.weddings set status = 'published' where id = tap.wa();
  set local role service_role;
  v_r := se_vezmou.lifecycle_enqueue_notices(v_expires - interval '14 days', tap.wa());
  perform tap.reset();
  perform tap.ok(exists (select 1 from se_vezmou.lifecycle_notices where wedding_id = tap.wa() and kind = 'site_expiry' and stage = 'first' and event_at = v_expires),
    'upozornění před koncem provozu webu');
  -- archivovaný web (už neběží) upozornění na konec provozu nedostává
  delete from se_vezmou.lifecycle_notices where wedding_id = tap.wa();
  update se_vezmou.weddings set status = 'archived' where id = tap.wa();
  set local role service_role;
  v_r := se_vezmou.lifecycle_enqueue_notices(v_expires - interval '14 days', tap.wa());
  perform tap.reset();
  perform tap.ok(not exists (select 1 from se_vezmou.lifecycle_notices where wedding_id = tap.wa() and kind = 'site_expiry'), 'archivovaný web nemá upozornění na konec provozu');
  update se_vezmou.weddings set status = 'published' where id = tap.wa();
end
$$;

-- ---------------------------------------------------------------------------
-- Zámek běhů úloh a výsledek do auditu
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid;
  v_id2 uuid;
begin
  set local role service_role;
  v_id := se_vezmou.job_run_start('lifecycle', timestamptz '2027-09-10 12:00Z');
  perform tap.ok(v_id is not null, 'běh úlohy začne');
  perform tap.ok(se_vezmou.job_run_start('lifecycle') is null, 'souběžný běh téže úlohy je odmítnut (zapůjčení)');
  perform tap.ok(se_vezmou.job_run_start('retention') is not null, 'jiná úloha běží nezávisle');
  perform tap.throws('select se_vezmou.job_run_start(''Neplatný název'')', '22023', 'neplatný název úlohy se odmítne');
  perform se_vezmou.job_run_finish(v_id, 'ok', '{"archived": 2, "notices": 1}');
  perform tap.throws(format('select se_vezmou.job_run_finish(%L, ''ok'')', v_id), 'job_run_not_found', 'dokončený běh nejde dokončit znovu');
  perform tap.throws(format('select se_vezmou.job_run_finish(%L, ''nesmysl'')', v_id), '22023', 'neplatný stav běhu');
  v_id2 := se_vezmou.job_run_start('lifecycle');
  perform tap.ok(v_id2 is not null and v_id2 <> v_id, 'po dokončení lze spustit další běh');
  perform tap.reset();
  perform tap.ok((select clock_at = timestamptz '2027-09-10 12:00Z' and status = 'ok' and counts = '{"archived": 2, "notices": 1}' from se_vezmou.job_runs where id = v_id),
    'běh nese simulované „teď“, stav a počty');
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where action = 'job.run' and actor_type = 'system' and wedding_id is null and target_id = v_id
                          and meta = '{"job": "lifecycle", "status": "ok", "counts": {"archived": 2, "notices": 1}, "error_code": null}'),
    'výsledek běhu je v auditu bez osobních údajů');

  -- zastaralé zapůjčení (pád funkce) se uvolní
  update se_vezmou.job_runs set started_at = now() - interval '11 minutes' where id = v_id2;
  set local role service_role;
  perform tap.ok(se_vezmou.job_run_start('lifecycle') is not null, 'zastaralý běh po vypršení zapůjčení uvolní zámek');
  perform tap.reset();
  perform tap.ok((select status = 'failed' and error_code = 'lease_expired' from se_vezmou.job_runs where id = v_id2), 'zastaralý běh je označen jako failed');
end
$$;

-- ---------------------------------------------------------------------------
-- Dohled pro operátora (data pro M9)
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_event timestamptz;
begin
  set local role service_role;
  select * into r from se_vezmou.op_job_runs_summary(tap.u('operator:support')) where job = 'lifecycle';
  perform tap.ok(r.running and r.last_status = 'running' and r.last_ok_at is not null and r.failures_7d = 1,
    'souhrn: běží, poslední úspěch známe, jedno selhání za týden');
  select * into r from se_vezmou.op_job_runs_summary(tap.u('operator:support')) where job = 'retention';
  perform tap.ok(r.running, 'souhrn obsahuje všechny úlohy');
  perform tap.eq((select count(*) from se_vezmou.op_job_runs(tap.u('operator:owner'), 2)), 2, 'seznam běhů respektuje limit');
  perform tap.eq((select count(*) from se_vezmou.op_job_runs(tap.u('operator:owner'), 30, 'retention')), 1, 'seznam běhů lze filtrovat podle úlohy');
  perform tap.throws(format('select * from se_vezmou.op_job_runs_summary(%L)', tap.u('operator:disabled')), '42501', 'zakázaný operátor nevidí souhrn');
  perform tap.throws(format('select * from se_vezmou.op_expiring_weddings(%L)', tap.u('A:admin')), '42501', 'správce nevidí seznam webů před vypršením');
  perform tap.reset();

  -- weby před vypršením: A má upozornění na (prodlouženou) událost, B (smazaná/blokovaná změny) bez
  update se_vezmou.weddings set status = 'published', starts_on = date '2027-06-12' where id = tap.wa();
  v_event := timestamptz '2027-09-10 00:00 Europe/Prague';
  set local role service_role;
  perform se_vezmou.lifecycle_enqueue_notices(v_event - interval '10 days', tap.wa());
  select * into r from se_vezmou.op_expiring_weddings(tap.u('operator:support'), 30, v_event - interval '10 days')
   where wedding_id = tap.wa() and kind = 'site_expiry';
  perform tap.ok(r.slug = 'klara-a-matej' and r.days_left = 10 and not r.overdue and r.first_notice_status = 'pending' and r.final_notice_status is null,
    'seznam před vypršením: zbývá 10 dní, první upozornění čeká, závěrečné není');
  select * into r from se_vezmou.op_expiring_weddings(tap.u('operator:support'), 30, v_event + interval '3 days')
   where wedding_id = tap.wa() and kind = 'site_expiry';
  perform tap.ok(r.overdue and r.days_left = -3, 'zpožděná událost je označena (overdue, záporné dny)');
  perform tap.eq((select count(*) from se_vezmou.op_expiring_weddings(tap.u('operator:support'), 0, timestamptz '2020-01-01')), 0, 'mimo okno nic');
  perform tap.reset();
end
$$;

-- ---------------------------------------------------------------------------
-- Export hostů a RSVP (správce svatby)
-- ---------------------------------------------------------------------------
do $$
declare
  v_x jsonb;
  v_y jsonb;
begin
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.throws('select se_vezmou.admin_export_guests()', '42501', 'návštěvník neexportuje');
  perform tap.reset();
  set local role service_role;
  perform tap.throws('select se_vezmou.admin_export_guests()', '42501', 'service role bez claimů neexportuje');
  perform tap.reset();

  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  v_x := se_vezmou.admin_export_guests();
  perform tap.reset();
  perform tap.eq(jsonb_array_length(v_x -> 'people'), 2, 'export svatby A: dva hosté');
  perform tap.ok((select bool_and(p ->> 'name' in ('Jan Novák', 'Marie Nováková')) from jsonb_array_elements(v_x -> 'people') p), 'export nese jen hosty svatby A');
  perform tap.ok(not (v_x::text ilike '%Svoboda%'), 'export neobsahuje hosty svatby B');
  perform tap.ok((select bool_and(p -> 'diet' = 'null'::jsonb and p -> 'allergies' = 'null'::jsonb) from jsonb_array_elements(v_x -> 'people') p),
    'bez výslovné žádosti export nemá zdravotní údaje');
  perform tap.ok(not (v_x::text ilike '%vegetari%') and not (v_x::text ilike '%ořechy%'), 'dieta a alergie nejsou v exportu bez žádosti');
  perform tap.ok((select exported_at is null from se_vezmou.rsvp_health where wedding_id = tap.wa()), 'bez zdravotních údajů se exported_at nenastaví');
  perform tap.ok((select count(*) = 2 and bool_or((p ->> 'answered')::boolean) from jsonb_array_elements(v_x -> 'people') p), 'export eviduje, kdo odpověděl');
  perform tap.ok(exists (select 1 from jsonb_array_elements(v_x -> 'people') p where p ->> 'name' = 'Jan Novák' and jsonb_array_length(p -> 'attendance') = 1 and jsonb_array_length(p -> 'invited_event_ids') = 2),
    'export nese pozvání a účast po událostech');
  perform tap.eq(jsonb_array_length(v_x -> 'events'), 2, 'export nese události pro záhlaví');

  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  v_y := se_vezmou.admin_export_guests(true);
  perform tap.reset();
  perform tap.ok(exists (select 1 from jsonb_array_elements(v_y -> 'people') p where p ->> 'diet' = 'vegetariánská' and p ->> 'allergies' = 'ořechy'),
    's výslovnou žádostí jsou zdravotní údaje v exportu');
  perform tap.ok((select exported_at is not null from se_vezmou.rsvp_health where wedding_id = tap.wa()), 'vydání zdravotních údajů se eviduje (exported_at)');
  perform tap.ok((select exported_at is null from se_vezmou.rsvp_health where wedding_id = tap.wb()), 'svatba B se nedotkla');
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where wedding_id = tap.wa() and action = 'export.guests' and actor_type = 'admin'
                          and actor_id = tap.u('A:admin') and meta = '{"people": 2, "include_health": true}'),
    'export je v auditu bez osobních údajů');
  perform tap.eq((select count(*) from se_vezmou.audit_log where wedding_id = tap.wa() and action = 'export.guests'), 2, 'oba exporty jsou v auditu');
end
$$;

-- ---------------------------------------------------------------------------
-- Oprávnění: funkce cronu jen pro service role
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'se_vezmou'::regnamespace
     and (p.proname like 'lifecycle\_%' or p.proname like 'job\_run\_%' or p.proname in ('retention_due_weddings'))
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('public', p.oid, 'execute'));
  perform tap.ok(v_bad is null, 'funkce životního cyklu nejsou spustitelné správci, hosty ani anon (' || coalesce(v_bad, '-') || ')');
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'se_vezmou'::regnamespace
     and p.proname in ('job_run_start', 'job_run_finish', 'lifecycle_archive_due', 'lifecycle_enqueue_notices',
                       'lifecycle_notices_pending', 'lifecycle_notices_claim', 'lifecycle_notice_recipients',
                       'lifecycle_notice_finish', 'op_set_phase_override', 'op_job_runs_summary', 'op_job_runs',
                       'op_expiring_weddings', 'purge_health_data', 'purge_guest_data', 'purge_wedding',
                       'purge_deleted_weddings', 'retention_due_weddings', 'purge_expired_slug_reservations', 'housekeeping')
     and not has_function_privilege('service_role', p.oid, 'execute');
  perform tap.ok(v_bad is null, 'service role smí spouštět funkce cronu (chybí: ' || coalesce(v_bad, '-') || ')');
  perform tap.ok(has_function_privilege('authenticated', 'se_vezmou.admin_export_guests(boolean)', 'execute')
                 and not has_function_privilege('anon', 'se_vezmou.admin_export_guests(boolean)', 'execute'),
    'export smí spustit jen přihlášená role (správce je ověřen uvnitř funkce)');
  perform tap.ok(not has_table_privilege('service_role', 'se_vezmou.job_runs', 'select')
                 and not has_table_privilege('service_role', 'se_vezmou.lifecycle_notices', 'select'),
    'service role čte evidenci jen přes funkce');
end
$$;

rollback;
