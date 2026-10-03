-- Oprava po revizi kódu: úklid opuštěných konceptů mohl trvale smazat rozpracovanou svatbu.
--  1. Aktivitou svatby (`last_activity_at`) je i práce na seznamu hostů a nastavení RSVP (domácnosti, hosté,
--     pozvání, nastavení a otázky RSVP) a přihlášení správce, nejen úpravy obsahu webu.
--  2. Opuštěný koncept se měkce smaže s běžnou lhůtou pro obnovení (`deleted_site_restore_days`), ne s
--     okamžitým `purge_at`, takže ho operátor může obnovit. Koncept obnovený operátorem se do uplynutí
--     lhůty nečinnosti znovu nemaže, i když od obnovení nikdo nic neupravil.

create trigger households_touch_activity after insert or update or delete on se_vezmou.households
  for each row execute function se_vezmou.touch_wedding_activity();
create trigger guests_touch_activity after insert or update or delete on se_vezmou.guests
  for each row execute function se_vezmou.touch_wedding_activity();
create trigger invitations_touch_activity after insert or update or delete on se_vezmou.invitations
  for each row execute function se_vezmou.touch_wedding_activity();
create trigger rsvp_settings_touch_activity after insert or update or delete on se_vezmou.rsvp_settings
  for each row execute function se_vezmou.touch_wedding_activity();
create trigger rsvp_questions_touch_activity after insert or update or delete on se_vezmou.rsvp_questions
  for each row execute function se_vezmou.touch_wedding_activity();

-- ---------------------------------------------------------------------------
-- Přihlášení správce je aktivita (relaci zakládá server před ověřením, proto vlastní funkce bez kontroly role)
-- ---------------------------------------------------------------------------
create function se_vezmou.touch_activity_on_admin_login() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  if new.kind = 'admin' then
    update se_vezmou.weddings w
       set last_activity_at = pg_catalog.now()
     where w.id = new.wedding_id
       and w.last_activity_at < pg_catalog.now()
         - pg_catalog.make_interval(mins => se_vezmou.setting_int('activity_touch_minutes', 5));
  end if;
  return null;
end
$$;

revoke all on function se_vezmou.touch_activity_on_admin_login() from public, anon;

create trigger sessions_admin_login_activity after insert on se_vezmou.sessions
  for each row execute function se_vezmou.touch_activity_on_admin_login();

-- ---------------------------------------------------------------------------
-- housekeeping: stejná jako v 20261009120300_retention_gaps.sql, jen opuštěné koncepty jdou obnovit
-- a čítače omezení se drží dva dny (posuvné okno v 20261012120400_rate_limit_sliding.sql)
-- ---------------------------------------------------------------------------
create or replace function se_vezmou.housekeeping(
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
  v_waitlist integer := 0;
  v_drafts integer := 0;
  v_draft record;
  v_analytics_months integer := se_vezmou.setting_int('analytics_retention_months', 24);
  v_email_days integer := se_vezmou.setting_int('email_log_retention_days', 180);
  v_job_days integer := se_vezmou.setting_int('job_runs_retention_days', 90);
  v_waitlist_months integer := se_vezmou.setting_int('waitlist_retention_months', 12);
  v_draft_days integer := se_vezmou.setting_int('abandoned_draft_days', 14);
  v_restore_days integer := se_vezmou.setting_int('deleted_site_restore_days', 30);
begin
  perform se_vezmou.clock_guard(p_now);
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
    -- dva dny: posuvné okno (20261012120400) potřebuje i předchozí okno denních pravidel
    with d as (delete from se_vezmou.rate_limits r
                where r.window_start < p_now - interval '2 days' returning 1)
      select count(*) into v_rate_limits from d;
    -- pauza trvá nejvýše den; řádek bez pauzy (jen počítá chyby) stárne podle updated_at. Dřív se nemazaly nikdy.
    with d as (delete from se_vezmou.lockouts l
                where coalesce(l.locked_until, l.updated_at) < p_now - interval '7 days'
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
    with d as (delete from se_vezmou.waitlist w
                where w.consent_at < p_now - pg_catalog.make_interval(months => v_waitlist_months)
                returning 1)
      select count(*) into v_waitlist from d;

    -- Opuštěné koncepty: měkké smazání s lhůtou pro obnovení; pak je trvale smaže retenční úloha (soubory i řádky).
    for v_draft in
      select x.id from se_vezmou.weddings x
       where x.status = 'draft' and x.published_version_id is null and x.deleted_at is null
         and x.last_activity_at < p_now - pg_catalog.make_interval(days => v_draft_days)
         -- koncept obnovený operátorem má celou lhůtu nečinnosti znovu
         and not exists (
           select 1 from se_vezmou.wedding_status_history h
            where h.wedding_id = x.id and h.from_status = 'deleted' and h.to_status = 'draft'
              and h.created_at > p_now - pg_catalog.make_interval(days => v_draft_days))
       order by x.last_activity_at, x.id
       limit 100
       for update of x skip locked
    loop
      -- běžná lhůta pro obnovení: trvale ho smaže retenční úloha až po ní
      update se_vezmou.weddings x
         set status = 'deleted', purge_at = p_now + pg_catalog.make_interval(days => v_restore_days)
       where x.id = v_draft.id;
      insert into se_vezmou.wedding_status_history (wedding_id, from_status, to_status, actor_type, actor_id, reason)
      values (v_draft.id, 'draft', 'deleted', 'system', null, 'draft_abandoned');
      update se_vezmou.sessions s set revoked_at = pg_catalog.now()
       where s.wedding_id = v_draft.id and s.revoked_at is null;
      perform se_vezmou.write_audit('system', null, v_draft.id, 'wedding.status_change', 'wedding', v_draft.id,
        'draft_abandoned', jsonb_build_object('from_status', 'draft', 'to_status', 'deleted',
                                              'inactive_days', v_draft_days));
      v_drafts := v_drafts + 1;
    end loop;

    if p_dry_run then
      raise exception 'dry_run' using errcode = 'DR001';
    end if;
  exception when sqlstate 'DR001' then
    null;
  end;

  return jsonb_build_object('sessions', v_sessions, 'operator_sessions', v_operator_sessions,
    'login_challenges', v_challenges, 'rsvp_tickets', v_tickets, 'rate_limits', v_rate_limits,
    'lockouts', v_lockouts, 'analytics_events', v_analytics, 'mail_log', v_email_log,
    'job_runs', v_job_runs, 'waitlist', v_waitlist, 'abandoned_drafts', v_drafts);
end
$$;
