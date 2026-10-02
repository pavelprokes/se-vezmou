-- M10 / 3: retence a mazání (kap. 10, FR-OPS-5): funkce purge_* a úklid s parametry p_now (simulovaný čas
-- v testech), p_wedding_id (omezení na jednu svatbu), p_dry_run (ohlásí práci, nic nezapíše).
--
-- Funkce z migrace 20261002121000_functions_ops.sql se nahrazují: nové parametry mají výchozí hodnoty, takže
-- volání bez argumentů funguje beze změny. Mazání je nevratné; audit retention.purge nese jen identifikátor
-- svatby, druh a počty řádků (bez osobních údajů). Po mazání údajů hostů se zakládá evidence zprávy o smazání
-- (lifecycle_notices, fáze done), kterou odešle úloha životního cyklu.
--
-- Pozor na migrační nástroj: žádný řádek nesmí začínat příkazem `delete from`; v tělech funkcí je delete odsazený.

drop function se_vezmou.purge_health_data(integer);
drop function se_vezmou.purge_guest_data(integer);
drop function se_vezmou.purge_deleted_weddings(integer);
drop function se_vezmou.purge_wedding(uuid);
drop function se_vezmou.purge_expired_slug_reservations();
drop function se_vezmou.housekeeping();

-- ---------------------------------------------------------------------------
-- Dietní a alergické údaje: tvrdé smazání po health_purge_at (30 dní po svatbě podle app_settings)
-- ---------------------------------------------------------------------------
create function se_vezmou.purge_health_data(
  p_batch integer default 100,
  p_now timestamptz default pg_catalog.now(),
  p_wedding_id uuid default null,
  p_dry_run boolean default false
) returns integer
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding record;
  v_rows integer;
  v_total integer := 0;
begin
  if p_batch is null or p_batch < 1 then
    raise exception 'invalid_batch' using errcode = '22023';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('purge_health_data')) then
    return 0;
  end if;
  begin
    for v_wedding in
      select w.id, w.health_purge_at from se_vezmou.weddings w
       where w.health_purge_at is not null and w.health_purge_at <= p_now
         and (p_wedding_id is null or w.id = p_wedding_id)
         and exists (select 1 from se_vezmou.rsvp_health h where h.wedding_id = w.id)
       order by w.health_purge_at, w.id limit p_batch
       for update of w skip locked
    loop
      with d as (delete from se_vezmou.rsvp_health h where h.wedding_id = v_wedding.id returning 1)
      select count(*) into v_rows from d;
      v_total := v_total + v_rows;
      perform se_vezmou.write_audit('system', null, v_wedding.id, 'retention.purge', 'wedding', v_wedding.id,
        null, jsonb_build_object('kind', 'health', 'rows', v_rows));
      insert into se_vezmou.lifecycle_notices (wedding_id, kind, stage, event_at)
      values (v_wedding.id, 'health_purge', 'done', v_wedding.health_purge_at)
      on conflict (wedding_id, kind, stage, event_at) do nothing;
    end loop;
    if p_dry_run then
      raise exception 'dry_run' using errcode = 'DR001';
    end if;
  exception when sqlstate 'DR001' then
    null;
  end;
  return v_total;
end
$$;

-- ---------------------------------------------------------------------------
-- Ostatní údaje hostů: tvrdé smazání po guest_purge_at (12 měsíců po svatbě) v pořadí závislostí.
-- Zdravotní údaje se mažou vždy (i kdyby jejich lhůta byla prodloužená za tuto).
-- ---------------------------------------------------------------------------
create function se_vezmou.purge_guest_data(
  p_batch integer default 100,
  p_now timestamptz default pg_catalog.now(),
  p_wedding_id uuid default null,
  p_dry_run boolean default false
) returns integer
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding record;
  v_rows integer;
  v_wedding_rows integer;
  v_total integer := 0;
begin
  if p_batch is null or p_batch < 1 then
    raise exception 'invalid_batch' using errcode = '22023';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('purge_guest_data')) then
    return 0;
  end if;
  begin
    for v_wedding in
      select w.id, w.guest_purge_at from se_vezmou.weddings w
       where w.guest_purge_at is not null and w.guest_purge_at <= p_now
         and (p_wedding_id is null or w.id = p_wedding_id)
         and (exists (select 1 from se_vezmou.households h where h.wedding_id = w.id)
              or exists (select 1 from se_vezmou.rsvp_responses r where r.wedding_id = w.id))
       order by w.guest_purge_at, w.id limit p_batch
       for update of w skip locked
    loop
      v_wedding_rows := 0;
      with d as (delete from se_vezmou.rsvp_tickets t where t.wedding_id = v_wedding.id returning 1)
        select count(*) into v_rows from d;
      v_wedding_rows := v_wedding_rows + v_rows;
      with d as (delete from se_vezmou.rsvp_attendance a where a.wedding_id = v_wedding.id returning 1)
        select count(*) into v_rows from d;
      v_wedding_rows := v_wedding_rows + v_rows;
      with d as (delete from se_vezmou.rsvp_health h where h.wedding_id = v_wedding.id returning 1)
        select count(*) into v_rows from d;
      v_wedding_rows := v_wedding_rows + v_rows;
      with d as (delete from se_vezmou.rsvp_people p where p.wedding_id = v_wedding.id returning 1)
        select count(*) into v_rows from d;
      v_wedding_rows := v_wedding_rows + v_rows;
      with d as (delete from se_vezmou.rsvp_responses r where r.wedding_id = v_wedding.id returning 1)
        select count(*) into v_rows from d;
      v_wedding_rows := v_wedding_rows + v_rows;
      with d as (delete from se_vezmou.invitations i where i.wedding_id = v_wedding.id returning 1)
        select count(*) into v_rows from d;
      v_wedding_rows := v_wedding_rows + v_rows;
      with d as (delete from se_vezmou.guests g where g.wedding_id = v_wedding.id returning 1)
        select count(*) into v_rows from d;
      v_wedding_rows := v_wedding_rows + v_rows;
      with d as (delete from se_vezmou.households h where h.wedding_id = v_wedding.id returning 1)
        select count(*) into v_rows from d;
      v_wedding_rows := v_wedding_rows + v_rows;

      v_total := v_total + v_wedding_rows;
      perform se_vezmou.write_audit('system', null, v_wedding.id, 'retention.purge', 'wedding', v_wedding.id,
        null, jsonb_build_object('kind', 'guests', 'rows', v_wedding_rows));
      insert into se_vezmou.lifecycle_notices (wedding_id, kind, stage, event_at)
      values (v_wedding.id, 'guest_purge', 'done', v_wedding.guest_purge_at)
      on conflict (wedding_id, kind, stage, event_at) do nothing;
    end loop;
    if p_dry_run then
      raise exception 'dry_run' using errcode = 'DR001';
    end if;
  exception when sqlstate 'DR001' then
    null;
  end;
  return v_total;
end
$$;

-- ---------------------------------------------------------------------------
-- Tvrdé smazání zakázky po měkkém smazání: stav deleted a uplynulé purge_at (deleted_site_restore_days;
-- obnovení v této lhůtě je jen operátorská věc, M9). Dřív funkce odmítne. Zveřejněná adresa přejde do
-- retired a nikdy se znovu nepřidělí (FR-PRIV-4); nezveřejněná rezervace se uvolní. Vrací počty a cesty
-- souborů v úložišti (prefix {wedding_id}/): jejich smazání řeší aplikace PŘED voláním této funkce, takže
-- selhání mazání souborů svatbu neoznačí za vymazanou a úloha to zkusí znovu.
-- ---------------------------------------------------------------------------
create function se_vezmou.purge_wedding(
  p_wedding_id uuid,
  p_now timestamptz default pg_catalog.now()
) returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  w se_vezmou.weddings;
  v_paths text[];
  v_counts jsonb;
begin
  select * into w from se_vezmou.weddings x where x.id = p_wedding_id for update;
  if not found then
    raise exception 'wedding_not_found' using errcode = 'P0002';
  end if;
  if w.status <> 'deleted' or w.purge_at is null or w.purge_at > p_now then
    raise exception 'wedding_not_purgeable' using errcode = '55000';
  end if;

  select coalesce(array_agg(m.storage_path), '{}') into v_paths
    from se_vezmou.media m where m.wedding_id = p_wedding_id;

  v_counts := jsonb_build_object(
    'kind', 'wedding',
    'guests', (select count(*) from se_vezmou.guests g where g.wedding_id = p_wedding_id),
    'blocks', (select count(*) from se_vezmou.content_blocks b where b.wedding_id = p_wedding_id),
    'media', coalesce(array_length(v_paths, 1), 0));

  -- adresa: zveřejněná zůstane trvale blokovaná (retired), rezervace konceptu se uvolní
  update se_vezmou.slug_registry sr set state = 'retired', reserved_until = null
   where sr.wedding_id = p_wedding_id and sr.state = 'active';
  delete from se_vezmou.slug_registry sr where sr.wedding_id = p_wedding_id and sr.state = 'reserved';

  -- ostatní tabulky odstraní kaskáda cizích klíčů; audit přežije (wedding_id bez cizího klíče)
  delete from se_vezmou.weddings x where x.id = p_wedding_id;
  perform se_vezmou.write_audit('system', null, p_wedding_id, 'retention.purge', 'wedding', p_wedding_id,
    null, v_counts);

  return v_counts || jsonb_build_object('storage_paths', to_jsonb(v_paths));
end
$$;

-- Zakázky připravené k tvrdému smazání (stav deleted, purge_at už uplynulo): seznam pro úlohu, která
-- nejdřív smaže soubory v úložišti a teprve potom zavolá purge_wedding.
create function se_vezmou.retention_due_weddings(
  p_now timestamptz default pg_catalog.now(),
  p_batch integer default 20,
  p_wedding_id uuid default null
) returns table (wedding_id uuid, purge_at timestamptz, media_count integer)
  language sql stable security definer set search_path = ''
  as $$
  select w.id, w.purge_at,
         (select count(*)::integer from se_vezmou.media m where m.wedding_id = w.id)
    from se_vezmou.weddings w
   where w.status = 'deleted' and w.purge_at is not null and w.purge_at <= p_now
     and (p_wedding_id is null or w.id = p_wedding_id)
   order by w.purge_at, w.id
   limit greatest(coalesce(p_batch, 20), 1)
$$;

-- Smazání všech zakázek, jejichž ochranná lhůta uplynula, BEZ mazání souborů v úložišti. Úloha cronu ji
-- nepoužívá (smazala by řádky dřív než soubory): volá retention_due_weddings, smaže soubory a purge_wedding
-- po jedné. Tato funkce slouží testům, ruční opravě a svatbám bez souborů.
create function se_vezmou.purge_deleted_weddings(
  p_batch integer default 20,
  p_now timestamptz default pg_catalog.now(),
  p_wedding_id uuid default null,
  p_dry_run boolean default false
) returns integer
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  if p_batch is null or p_batch < 1 then
    raise exception 'invalid_batch' using errcode = '22023';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('purge_deleted_weddings')) then
    return 0;
  end if;
  begin
    for v_id in
      select w.id from se_vezmou.weddings w
       where w.status = 'deleted' and w.purge_at is not null and w.purge_at <= p_now
         and (p_wedding_id is null or w.id = p_wedding_id)
       order by w.purge_at, w.id limit p_batch
    loop
      perform se_vezmou.purge_wedding(v_id, p_now);
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
-- Uvolnění rezervací slugů po reserved_until u nezveřejněných konceptů (denní cron)
-- ---------------------------------------------------------------------------
create function se_vezmou.purge_expired_slug_reservations(
  p_now timestamptz default pg_catalog.now(),
  p_dry_run boolean default false
) returns integer
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_count integer := 0;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('purge_expired_slug_reservations')) then
    return 0;
  end if;
  begin
    with released as (
      delete from se_vezmou.slug_registry sr
       where sr.state = 'reserved' and sr.reserved_until <= p_now
         and sr.first_published_at is null
      returning 1
    )
    select count(*) into v_count from released;

    if v_count > 0 then
      perform se_vezmou.write_audit('system', null, null, 'slug.reservation_expired',
        null, null, null, jsonb_build_object('count', v_count));
    end if;
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
-- housekeeping: úklid prošlých relací, výzev, lístků, čítačů a provozních záznamů bez osobních údajů
-- (analytické události po analytics_retention_months, email_log po email_log_retention_days, běhy úloh
-- po job_runs_retention_days). audit_log se nemaže (append-only, [LHŮTY]).
-- ---------------------------------------------------------------------------
create function se_vezmou.housekeeping(
  p_now timestamptz default pg_catalog.now(),
  p_dry_run boolean default false
) returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_sessions integer := 0;
  v_operator_sessions integer := 0;
  v_challenges integer := 0;
  v_tickets integer := 0;
  v_rate_limits integer := 0;
  v_lockouts integer := 0;
  v_analytics integer := 0;
  v_email_log integer := 0;
  v_job_runs integer := 0;
  v_analytics_months integer := se_vezmou.setting_int('analytics_retention_months', 24);
  v_email_days integer := se_vezmou.setting_int('email_log_retention_days', 180);
  v_job_days integer := se_vezmou.setting_int('job_runs_retention_days', 90);
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('housekeeping')) then
    return '{}'::jsonb;
  end if;

  begin
    with d as (delete from se_vezmou.sessions s
                where s.idle_expires_at < p_now or s.absolute_expires_at < p_now
                   or s.revoked_at < p_now - interval '1 day' returning 1)
      select count(*) into v_sessions from d;
    with d as (delete from se_vezmou.operator_sessions s
                where s.idle_expires_at < p_now or s.absolute_expires_at < p_now
                   or s.revoked_at < p_now - interval '1 day' returning 1)
      select count(*) into v_operator_sessions from d;
    with d as (delete from se_vezmou.login_challenges c
                where c.expires_at < p_now - interval '1 day' returning 1)
      select count(*) into v_challenges from d;
    with d as (delete from se_vezmou.rsvp_tickets t where t.expires_at < p_now returning 1)
      select count(*) into v_tickets from d;
    with d as (delete from se_vezmou.rate_limits r
                where r.window_start < p_now - interval '1 day' returning 1)
      select count(*) into v_rate_limits from d;
    with d as (delete from se_vezmou.lockouts l
                where l.locked_until is not null and l.locked_until < p_now - interval '7 days'
                returning 1)
      select count(*) into v_lockouts from d;
    with d as (delete from se_vezmou.analytics_event a
                where a.created_at < p_now - pg_catalog.make_interval(months => v_analytics_months)
                returning 1)
      select count(*) into v_analytics from d;
    with d as (delete from se_vezmou.email_log e
                where e.created_at < p_now - pg_catalog.make_interval(days => v_email_days)
                returning 1)
      select count(*) into v_email_log from d;
    with d as (delete from se_vezmou.job_runs j
                where j.started_at < p_now - pg_catalog.make_interval(days => v_job_days)
                  and j.status <> 'running'
                returning 1)
      select count(*) into v_job_runs from d;

    if p_dry_run then
      raise exception 'dry_run' using errcode = 'DR001';
    end if;
  exception when sqlstate 'DR001' then
    null;
  end;

  return jsonb_build_object('sessions', v_sessions, 'operator_sessions', v_operator_sessions,
    'login_challenges', v_challenges, 'rsvp_tickets', v_tickets, 'rate_limits', v_rate_limits,
    'lockouts', v_lockouts, 'analytics_events', v_analytics, 'email_log', v_email_log,
    'job_runs', v_job_runs);
end
$$;

-- ---------------------------------------------------------------------------
-- Oprávnění: jen service role (cron), jako dosud
-- ---------------------------------------------------------------------------
revoke all on function
  se_vezmou.purge_health_data(integer, timestamptz, uuid, boolean),
  se_vezmou.purge_guest_data(integer, timestamptz, uuid, boolean),
  se_vezmou.purge_wedding(uuid, timestamptz),
  se_vezmou.retention_due_weddings(timestamptz, integer, uuid),
  se_vezmou.purge_deleted_weddings(integer, timestamptz, uuid, boolean),
  se_vezmou.purge_expired_slug_reservations(timestamptz, boolean),
  se_vezmou.housekeeping(timestamptz, boolean)
  from public, anon;

grant execute on function
  se_vezmou.purge_health_data(integer, timestamptz, uuid, boolean),
  se_vezmou.purge_guest_data(integer, timestamptz, uuid, boolean),
  se_vezmou.purge_wedding(uuid, timestamptz),
  se_vezmou.retention_due_weddings(timestamptz, integer, uuid),
  se_vezmou.purge_deleted_weddings(integer, timestamptz, uuid, boolean),
  se_vezmou.purge_expired_slug_reservations(timestamptz, boolean),
  se_vezmou.housekeeping(timestamptz, boolean)
  to service_role;
