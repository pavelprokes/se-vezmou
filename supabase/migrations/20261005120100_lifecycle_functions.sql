-- M10 / 2: životní cyklus (kap. 7), zámek běhů úloh, plánování a evidence upozornění (FR-LC-1, FR-LC-2).
--
-- Pravidla jako všude: security definer, prázdný search_path, plně kvalifikované názvy, execute jen pro
-- potřebnou roli. „Teď“ je vždy parametr p_now (výchozí now()), aby šel čas v testech simulovat bez
-- čekání; produkční cron ho nepředává. Parametr p_dry_run provede práci a nakonec ji vrátí zpět
-- (podtransakce), takže ohlásí přesně to, co by skutečný běh udělal, a nic nezapíše.
--
-- Pozor na migrační nástroj: žádný řádek nesmí začínat příkazem `delete from` (hlídá ho scripts/db-migrate.mjs);
-- v tělech funkcí je delete odsazený.

-- ---------------------------------------------------------------------------
-- Zámek běhu úlohy (zapůjčení). Pooler v transakčním režimu nedrží zámky relace, proto je zámek
-- řádek v job_runs: běžící běh mladší než lease blokuje další běh téže úlohy. Zastaralý běh
-- (pád funkce, vypršení maxDuration) se označí jako failed a zámek se uvolní.
-- ---------------------------------------------------------------------------
create function se_vezmou.job_run_start(
  p_job text,
  p_now timestamptz default pg_catalog.now(),
  p_lease_minutes integer default 10
) returns uuid
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_id uuid;
  v_clock timestamptz := pg_catalog.clock_timestamp();
begin
  if p_job is null or p_job !~ '^[a-z][a-z_]{1,39}$' or p_lease_minutes is null or p_lease_minutes < 1 then
    raise exception 'invalid_job' using errcode = '22023';
  end if;
  -- serializace souběžných startů téže úlohy
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('job_run_start:' || p_job));

  update se_vezmou.job_runs r
     set status = 'failed', finished_at = v_clock, error_code = 'lease_expired'
   where r.job = p_job and r.status = 'running'
     and r.started_at <= v_clock - pg_catalog.make_interval(mins => p_lease_minutes);

  if exists (select 1 from se_vezmou.job_runs r where r.job = p_job and r.status = 'running') then
    return null;
  end if;

  insert into se_vezmou.job_runs (job, started_at, clock_at)
  values (p_job, v_clock, p_now)
  returning id into v_id;
  return v_id;
end
$$;

-- Dokončení běhu: stav, počty a záznam do auditu (bez osobních údajů: jen název úlohy, stav a počty).
create function se_vezmou.job_run_finish(
  p_id uuid,
  p_status text,
  p_counts jsonb default '{}'::jsonb,
  p_error_code text default null
) returns void
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  r se_vezmou.job_runs;
begin
  if p_status not in ('ok', 'partial', 'failed') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  update se_vezmou.job_runs x
     set status = p_status, finished_at = pg_catalog.clock_timestamp(),
         counts = coalesce(p_counts, '{}'::jsonb), error_code = left(p_error_code, 100)
   where x.id = p_id and x.status = 'running'
  returning x.* into r;
  if not found then
    raise exception 'job_run_not_found' using errcode = 'P0002';
  end if;
  perform se_vezmou.write_audit('system', null, null, 'job.run', 'job_run', r.id, null,
    jsonb_build_object('job', r.job, 'status', r.status, 'counts', r.counts, 'error_code', r.error_code));
end
$$;

-- ---------------------------------------------------------------------------
-- Konec provozu webu: kdy se web přestane zveřejňovat (stav published -> archived).
-- Počítá se z konce svatby (ends_on, jinak starts_on) v pásmu svatby plus
-- app_settings.site_online_days_after_wedding; končí-li dříve objednaný provoz
-- (orders.service_ends_at), platí dřívější z obou. Svatba bez data ani objednávky s koncem
-- se nearchivuje automaticky (null).
-- ---------------------------------------------------------------------------
create function se_vezmou.lifecycle_expires_at(p_wedding se_vezmou.weddings) returns timestamptz
  language sql stable security definer set search_path = ''
  as $$
  select least(
    case when coalesce(p_wedding.ends_on, p_wedding.starts_on) is null then null
         else ((coalesce(p_wedding.ends_on, p_wedding.starts_on)
                + se_vezmou.setting_int('site_online_days_after_wedding', 90))::timestamp
               at time zone p_wedding.timezone) end,
    (select o.service_ends_at from se_vezmou.orders o where o.wedding_id = p_wedding.id))
$$;

-- Budoucí a zpožděné události svatby, o kterých se upozorňuje nebo které operátor sleduje.
-- site_purge (trvalé smazání po měkkém smazání) se neoznamuje: po smazání se správce nepřihlásí.
create function se_vezmou.lifecycle_events(p_wedding_id uuid default null)
  returns table (wedding_id uuid, kind text, event_at timestamptz)
  language sql stable security definer set search_path = ''
  as $$
  select w.id, 'site_expiry'::text, se_vezmou.lifecycle_expires_at(w)
    from se_vezmou.weddings w
   where w.status = 'published' and w.deleted_at is null
     and (p_wedding_id is null or w.id = p_wedding_id)
  union all
  select w.id, 'health_purge', w.health_purge_at
    from se_vezmou.weddings w
   where w.health_purge_at is not null
     and exists (select 1 from se_vezmou.rsvp_health h where h.wedding_id = w.id)
     and (p_wedding_id is null or w.id = p_wedding_id)
  union all
  select w.id, 'guest_purge', w.guest_purge_at
    from se_vezmou.weddings w
   where w.guest_purge_at is not null
     and (exists (select 1 from se_vezmou.households h where h.wedding_id = w.id)
          or exists (select 1 from se_vezmou.rsvp_responses r where r.wedding_id = w.id))
     and (p_wedding_id is null or w.id = p_wedding_id)
  union all
  select w.id, 'site_purge', w.purge_at
    from se_vezmou.weddings w
   where w.status = 'deleted' and w.purge_at is not null
     and (p_wedding_id is null or w.id = p_wedding_id)
$$;

-- ---------------------------------------------------------------------------
-- Archivace: published -> archived po konci provozu a doplnění retenčních dat tam, kde chybí.
-- Retenční data normálně počítá spouštěč weddings_before_write z data svatby (při vložení a při změně
-- dat); tady se doplní jen tam, kde zůstala null (svatba publikovaná bez data): od okamžiku archivace.
-- Existující hodnoty (včetně ručního prodloužení operátorem) se nikdy nepřepisují.
-- ---------------------------------------------------------------------------
create function se_vezmou.lifecycle_archive_due(
  p_now timestamptz default pg_catalog.now(),
  p_batch integer default 100,
  p_wedding_id uuid default null,
  p_dry_run boolean default false
) returns integer
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  w se_vezmou.weddings;
  v_count integer := 0;
  v_health integer := se_vezmou.setting_int('health_retention_days_after_wedding', 30);
  v_guest integer := se_vezmou.setting_int('guest_retention_months_after_wedding', 12);
begin
  if p_batch is null or p_batch < 1 then
    raise exception 'invalid_batch' using errcode = '22023';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('lifecycle_archive_due')) then
    return 0;
  end if;

  begin
    for w in
      select x.* from se_vezmou.weddings x
       where x.status = 'published' and x.deleted_at is null
         and (p_wedding_id is null or x.id = p_wedding_id)
         and se_vezmou.lifecycle_expires_at(x) <= p_now
       order by se_vezmou.lifecycle_expires_at(x), x.id
       limit p_batch
       for update of x skip locked
    loop
      update se_vezmou.weddings x
         set status = 'archived',
             health_purge_at = coalesce(x.health_purge_at, p_now + pg_catalog.make_interval(days => v_health)),
             guest_purge_at = coalesce(x.guest_purge_at, p_now + pg_catalog.make_interval(months => v_guest))
       where x.id = w.id;
      insert into se_vezmou.wedding_status_history (wedding_id, from_status, to_status, actor_type, actor_id, reason)
      values (w.id, 'published', 'archived', 'system', null, 'service_expired');
      perform se_vezmou.write_audit('system', null, w.id, 'wedding.status_change', 'wedding', w.id,
        'service_expired', jsonb_build_object('from_status', 'published', 'to_status', 'archived'));
      v_count := v_count + 1;
    end loop;
    if p_dry_run then
      raise exception 'dry_run' using errcode = 'DR001';
    end if;
  exception when sqlstate 'DR001' then
    null;
  end;
  return v_count;
end
$$;

-- ---------------------------------------------------------------------------
-- Ruční přepsání fáze (FR-LC-1): jen operátor, s důvodem a auditem. Platí do zrušení (p_phase null).
-- Přepisuje jen odvozenou fázi webu; neodkládá archivaci ani retenci (ty řídí data a nastavení).
-- ---------------------------------------------------------------------------
create function se_vezmou.op_set_phase_override(
  p_operator_id uuid,
  p_wedding_id uuid,
  p_phase text,
  p_reason text
) returns void
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_old text;
begin
  perform se_vezmou.assert_operator(p_operator_id, array['owner', 'support']);
  if p_phase is not null
     and p_phase not in ('save_the_date', 'rsvp_open', 'rsvp_closed', 'wedding_day', 'thanks') then
    raise exception 'invalid_phase' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  select w.phase_override into v_old from se_vezmou.weddings w
   where w.id = p_wedding_id and w.deleted_at is null for update;
  if not found then
    raise exception 'wedding_not_found' using errcode = 'P0002';
  end if;
  if v_old is not distinct from p_phase then
    return;
  end if;

  update se_vezmou.weddings w set phase_override = p_phase where w.id = p_wedding_id;
  perform se_vezmou.write_audit('operator', p_operator_id, p_wedding_id, 'wedding.phase_override',
    'wedding', p_wedding_id, p_reason,
    jsonb_build_object('from_phase', v_old, 'to_phase', p_phase));
end
$$;

-- ---------------------------------------------------------------------------
-- Upozornění: plánování (vytvoří řádky pending), převzetí k odeslání, adresáti, dokončení.
-- ---------------------------------------------------------------------------

-- Založí upozornění, jejichž okno už začalo a událost ještě nenastala: „first“ retention_notice_days_before
-- dní předem, „final“ retention_final_notice_days_before dní předem (pokud je okno final už otevřené, vznikne
-- jen ono). Jedno upozornění na (svatba, druh, fáze, datum události): opakování nic neduplikuje.
create function se_vezmou.lifecycle_enqueue_notices(
  p_now timestamptz default pg_catalog.now(),
  p_wedding_id uuid default null,
  p_dry_run boolean default false
) returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_first integer := se_vezmou.setting_int('retention_notice_days_before', 14);
  v_final integer := se_vezmou.setting_int('retention_final_notice_days_before', 1);
  v_first_n integer := 0;
  v_final_n integer := 0;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('lifecycle_enqueue_notices')) then
    return jsonb_build_object('first', 0, 'final', 0);
  end if;

  begin
    with due as (
      select e.wedding_id, e.kind, e.event_at,
             case when p_now >= e.event_at - pg_catalog.make_interval(days => v_final)
                  then 'final' else 'first' end as stage
        from se_vezmou.lifecycle_events(p_wedding_id) e
        join se_vezmou.weddings w on w.id = e.wedding_id
       where e.kind in ('site_expiry', 'health_purge', 'guest_purge')
         and e.event_at is not null and e.event_at > p_now
         and e.event_at - pg_catalog.make_interval(days => v_first) <= p_now
         and w.status not in ('deleted', 'blocked') and w.deleted_at is null
    ), ins as (
      insert into se_vezmou.lifecycle_notices (wedding_id, kind, stage, event_at)
      select d.wedding_id, d.kind, d.stage, d.event_at from due d
      on conflict (wedding_id, kind, stage, event_at) do nothing
      returning stage
    )
    select count(*) filter (where i.stage = 'first'), count(*) filter (where i.stage = 'final')
      into v_first_n, v_final_n from ins i;
    if p_dry_run then
      raise exception 'dry_run' using errcode = 'DR001';
    end if;
  exception when sqlstate 'DR001' then
    null;
  end;
  return jsonb_build_object('first', v_first_n, 'final', v_final_n);
end
$$;

-- Kolik upozornění čeká na odeslání (pro dry_run a dohled): pending a po prodlevě také zaseknutá a neúspěšná.
create function se_vezmou.lifecycle_notices_pending(
  p_now timestamptz default pg_catalog.now(),
  p_wedding_id uuid default null
) returns integer
  language sql stable security definer set search_path = ''
  as $$
  select count(*)::integer from se_vezmou.lifecycle_notices n
   where (p_wedding_id is null or n.wedding_id = p_wedding_id)
     and (n.stage = 'done' or n.event_at > p_now)
     and (n.status = 'pending'
          or (n.status = 'sending' and n.locked_at < pg_catalog.now() - interval '15 minutes')
          or (n.status = 'failed' and n.attempts < 3 and n.locked_at < pg_catalog.now() - interval '1 hour'))
$$;

-- Převezme dávku upozornění k odeslání (pending, zaseknutá „sending“ po 15 minutách, neúspěšná po hodině
-- nejvýše do 3 pokusů). Upozornění před událostí, která už nastala, se nikdy neodešle (skipped), stejně jako
-- upozornění u smazané nebo zablokované svatby. Souběžné běhy si řádky nepřebírají (skip locked).
create function se_vezmou.lifecycle_notices_claim(
  p_now timestamptz default pg_catalog.now(),
  p_limit integer default 50,
  p_wedding_id uuid default null
) returns table (
  notice_id uuid, wedding_id uuid, kind text, stage text, event_at timestamptz,
  slug text, locale text, timezone text, attempt smallint
)
  language plpgsql volatile security definer set search_path = ''
  as $$
#variable_conflict use_column
begin
  if p_limit is null or p_limit < 1 then
    raise exception 'invalid_batch' using errcode = '22023';
  end if;

  update se_vezmou.lifecycle_notices n
     set status = 'skipped'
   where n.status in ('pending', 'sending', 'failed') and n.stage in ('first', 'final')
     and n.event_at <= p_now
     and (p_wedding_id is null or n.wedding_id = p_wedding_id);
  update se_vezmou.lifecycle_notices n
     set status = 'skipped'
   where n.status in ('pending', 'sending', 'failed')
     and (p_wedding_id is null or n.wedding_id = p_wedding_id)
     and exists (select 1 from se_vezmou.weddings w
                  where w.id = n.wedding_id and (w.status in ('deleted', 'blocked') or w.deleted_at is not null));

  return query
  with picked as (
    select n.id from se_vezmou.lifecycle_notices n
     where (p_wedding_id is null or n.wedding_id = p_wedding_id)
       and (n.status = 'pending'
            or (n.status = 'sending' and n.locked_at < pg_catalog.now() - interval '15 minutes')
            or (n.status = 'failed' and n.attempts < 3 and n.locked_at < pg_catalog.now() - interval '1 hour'))
     order by n.created_at, n.id
     limit p_limit
     for update skip locked
  ), upd as (
    update se_vezmou.lifecycle_notices n
       set status = 'sending', locked_at = pg_catalog.now(), attempts = n.attempts + 1
      from picked
     where n.id = picked.id
    returning n.*
  )
  select u.id, u.wedding_id, u.kind, u.stage, u.event_at, w.slug, w.default_locale, w.timezone, u.attempts
    from upd u join se_vezmou.weddings w on w.id = u.wedding_id
   order by u.created_at, u.id;
end
$$;

-- Adresáti upozornění: aktivní správci svatby (každá adresa jednou). Adresy jdou jen na server k odeslání;
-- nikde se neukládají ani nelogují. Jazyk e-mailu je výchozí jazyk webu.
create function se_vezmou.lifecycle_notice_recipients(p_wedding_id uuid)
  returns table (email text, locale text)
  language sql stable security definer set search_path = ''
  as $$
  select distinct on (lower(a.email::text)) a.email::text, w.default_locale
    from se_vezmou.wedding_admins a
    join se_vezmou.weddings w on w.id = a.wedding_id
   where a.wedding_id = p_wedding_id and a.removed_at is null
   order by lower(a.email::text), a.added_at
$$;

-- Dokončení odeslání jednoho upozornění: p_sent úspěšných a p_failed neúspěšných adresátů.
-- Nikdo (0/0): skipped. Nikdo úspěšně: failed (zkusí se znovu, nejvýše 3 pokusy). Aspoň jeden: sent
-- (část adresátů, kteří neobdrželi zprávu, se znovu nezkouší, aby ostatní nedostali duplicitu).
create function se_vezmou.lifecycle_notice_finish(p_id uuid, p_sent integer, p_failed integer)
  returns text
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  n se_vezmou.lifecycle_notices;
  v_status text;
begin
  if p_sent is null or p_failed is null or p_sent < 0 or p_failed < 0 then
    raise exception 'invalid_counts' using errcode = '22023';
  end if;
  v_status := case when p_sent + p_failed = 0 then 'skipped' when p_sent = 0 then 'failed' else 'sent' end;
  update se_vezmou.lifecycle_notices x
     set status = v_status, recipients = p_sent, failed_recipients = p_failed,
         sent_at = case when v_status = 'sent' then pg_catalog.now() else x.sent_at end
   where x.id = p_id and x.status = 'sending'
  returning x.* into n;
  if not found then
    raise exception 'notice_not_found' using errcode = 'P0002';
  end if;
  perform se_vezmou.write_audit('system', null, n.wedding_id, 'lifecycle.notice', 'wedding', n.wedding_id, null,
    jsonb_build_object('kind', n.kind, 'stage', n.stage, 'status', v_status,
                       'sent', p_sent, 'failed', p_failed, 'attempt', n.attempts));
  return v_status;
end
$$;

-- ---------------------------------------------------------------------------
-- Oprávnění: jen service role (cron). Interní pomocné funkce nemá nikdo.
-- ---------------------------------------------------------------------------
revoke all on function
  se_vezmou.job_run_start(text, timestamptz, integer),
  se_vezmou.job_run_finish(uuid, text, jsonb, text),
  se_vezmou.lifecycle_expires_at(se_vezmou.weddings),
  se_vezmou.lifecycle_events(uuid),
  se_vezmou.lifecycle_archive_due(timestamptz, integer, uuid, boolean),
  se_vezmou.op_set_phase_override(uuid, uuid, text, text),
  se_vezmou.lifecycle_enqueue_notices(timestamptz, uuid, boolean),
  se_vezmou.lifecycle_notices_pending(timestamptz, uuid),
  se_vezmou.lifecycle_notices_claim(timestamptz, integer, uuid),
  se_vezmou.lifecycle_notice_recipients(uuid),
  se_vezmou.lifecycle_notice_finish(uuid, integer, integer)
  from public, anon, authenticated, service_role;

grant execute on function
  se_vezmou.job_run_start(text, timestamptz, integer),
  se_vezmou.job_run_finish(uuid, text, jsonb, text),
  se_vezmou.lifecycle_archive_due(timestamptz, integer, uuid, boolean),
  se_vezmou.op_set_phase_override(uuid, uuid, text, text),
  se_vezmou.lifecycle_enqueue_notices(timestamptz, uuid, boolean),
  se_vezmou.lifecycle_notices_pending(timestamptz, uuid),
  se_vezmou.lifecycle_notices_claim(timestamptz, integer, uuid),
  se_vezmou.lifecycle_notice_recipients(uuid),
  se_vezmou.lifecycle_notice_finish(uuid, integer, integer)
  to service_role;
