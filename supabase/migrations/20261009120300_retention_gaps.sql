-- Oprava 4/5 (revize kódu a revize soukromí): mezery v retenci a úklid.
--
-- (a) Opuštěné koncepty (status draft, bez zveřejněné verze, bez aktivity déle než app_settings.abandoned_draft_days,
--     výchozí 14 dní, OQ-16) se uklízejí v housekeeping: přejdou do stavu deleted s okamžitým purge_at a trvale je
--     smaže stávající retenční úloha (včetně souborů v úložišti). Jména a e-maily správců tak nezůstávají navždy.
-- (b) Archivované weby se po app_settings.archived_delete_days_after_guest_purge dnech (výchozí 90, ČEKÁ NA SCHVÁLENÍ
--     PRÁVNÍKEM) po guest_purge_at automaticky přesunou do stavu deleted (lifecycle_delete_archived); dál platí
--     ochranná lhůta deleted_site_restore_days a purge_wedding.
-- (c) Čekací listina: housekeeping maže záznamy po app_settings.waitlist_retention_months měsících od souhlasu
--     (výchozí 12) a op_erase_waitlist je cesta pro výmaz na žádost (jen SQL, bez rozhraní).
-- Dále: úklid lockouts (řádky nebyly nikdy mazány), zálohování a zámek převzetí při trvalém smazání webu.
--
-- Pozor na migrační nástroj: žádný řádek nesmí začínat příkazem `delete from`; v tělech funkcí je delete odsazený.

insert into se_vezmou.app_settings (key, value) values
  -- [OQ-16] bez aktivity tolik dní se rozepsaný koncept (jména, e-mail správce) smaže
  ('abandoned_draft_days', '14'),
  -- [LHŮTY] po guest_purge_at tolik dní zůstane archivovaný web, pak přejde do stavu deleted: ČEKÁ NA SCHVÁLENÍ PRÁVNÍKEM
  ('archived_delete_days_after_guest_purge', '90'),
  -- [LHŮTY] čekací listina: tolik měsíců od souhlasu, pak se e-mail smaže: ČEKÁ NA SCHVÁLENÍ PRÁVNÍKEM
  ('waitlist_retention_months', '12')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- housekeeping: + lockouts, opuštěné koncepty, čekací listina, ochrana času
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
    with d as (delete from se_vezmou.rate_limits r
                where r.window_start < p_now - interval '1 day' returning 1)
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

    -- Opuštěné koncepty: měkké smazání s okamžitým purge_at; trvale je smaže retenční úloha (soubory i řádky).
    for v_draft in
      select x.id from se_vezmou.weddings x
       where x.status = 'draft' and x.published_version_id is null and x.deleted_at is null
         and x.last_activity_at < p_now - pg_catalog.make_interval(days => v_draft_days)
       order by x.last_activity_at, x.id
       limit 100
       for update of x skip locked
    loop
      update se_vezmou.weddings x set status = 'deleted', purge_at = p_now where x.id = v_draft.id;
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

-- ---------------------------------------------------------------------------
-- lifecycle_delete_archived: archived -> deleted po guest_purge_at + archived_delete_days_after_guest_purge dnech.
-- Bez guest_purge_at (ručně archivovaný web) se počítá od updated_at. Prodloužení guest_purge_at operátorem
-- smazání odsune. Ochranná lhůta deleted_site_restore_days zůstává (obnovit smí do ní jen operátor).
-- ---------------------------------------------------------------------------
create function se_vezmou.lifecycle_delete_archived(
  p_now timestamptz default pg_catalog.now(),
  p_batch integer default 100,
  p_wedding_id uuid default null,
  p_dry_run boolean default false
) returns integer
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  w record;
  v_count integer := 0;
  v_days integer := se_vezmou.setting_int('archived_delete_days_after_guest_purge', 90);
  v_restore integer := se_vezmou.setting_int('deleted_site_restore_days', 30);
begin
  perform se_vezmou.clock_guard(p_now);
  if p_batch is null or p_batch < 1 then
    raise exception 'invalid_batch' using errcode = '22023';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('lifecycle_delete_archived')) then
    return 0;
  end if;

  begin
    for w in
      select x.id from se_vezmou.weddings x
       where x.status = 'archived' and x.deleted_at is null
         and (p_wedding_id is null or x.id = p_wedding_id)
         and coalesce(x.guest_purge_at, x.updated_at) + pg_catalog.make_interval(days => v_days) <= p_now
       order by coalesce(x.guest_purge_at, x.updated_at), x.id
       limit p_batch
       for update of x skip locked
    loop
      update se_vezmou.weddings x
         set status = 'deleted', purge_at = p_now + pg_catalog.make_interval(days => v_restore)
       where x.id = w.id;
      insert into se_vezmou.wedding_status_history (wedding_id, from_status, to_status, actor_type, actor_id, reason)
      values (w.id, 'archived', 'deleted', 'system', null, 'archive_expired');
      update se_vezmou.sessions s set revoked_at = pg_catalog.now()
       where s.wedding_id = w.id and s.revoked_at is null;
      perform se_vezmou.write_audit('system', null, w.id, 'wedding.status_change', 'wedding', w.id,
        'archive_expired', jsonb_build_object('from_status', 'archived', 'to_status', 'deleted'));
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
-- op_erase_waitlist: výmaz čekací listiny na žádost (jen majitel, s důvodem; do auditu jde jen počet řádků)
-- ---------------------------------------------------------------------------
create function se_vezmou.op_erase_waitlist(p_operator_id uuid, p_email text, p_reason text) returns integer
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_rows integer;
begin
  perform se_vezmou.assert_operator(p_operator_id, array['owner']);
  if char_length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if v_email = '' or char_length(v_email) > 254 then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  with d as (delete from se_vezmou.waitlist w where lower(w.email::text) = v_email returning 1)
    select count(*) into v_rows from d;
  perform se_vezmou.write_audit('operator', p_operator_id, null, 'waitlist.erase', 'waitlist', null,
    p_reason, jsonb_build_object('rows', v_rows));
  return v_rows;
end
$$;

-- ---------------------------------------------------------------------------
-- Trvalé smazání webu: záloha po selhání a převzetí těsně před mazáním souborů
-- ---------------------------------------------------------------------------

-- Seznam k trvalému smazání: bez webů, které má jiný běh převzaté (zapůjčení 15 minut), a bez webů v záloze po
-- neúspěšném pokusu (30 minut, 1 h, 2 h ... nejvýše den). Nejdřív weby bez pokusů, potom nejstarší pokus, takže
-- trvale selhávající web nezablokuje dávku ostatních.
create or replace function se_vezmou.retention_due_weddings(
  p_now timestamptz default pg_catalog.now(),
  p_batch integer default 20,
  p_wedding_id uuid default null
) returns table (
  wedding_id uuid, purge_at timestamptz, media_count integer, slug text, timezone text, locale text
)
  language sql stable security definer set search_path = ''
  as $$
  select w.id, w.purge_at,
         (select count(*)::integer from se_vezmou.media m where m.wedding_id = w.id),
         w.slug, w.timezone, w.default_locale
    from se_vezmou.weddings w
   where w.status = 'deleted' and w.purge_at is not null and w.purge_at <= p_now
     and (p_wedding_id is null or w.id = p_wedding_id)
     and (w.purge_claimed_at is null
          or w.purge_claimed_at <= pg_catalog.clock_timestamp() - interval '15 minutes')
     and (w.purge_attempts = 0 or w.purge_last_attempt_at is null
          or w.purge_last_attempt_at + pg_catalog.make_interval(
               mins => least(15 * (1 << least(w.purge_attempts::integer, 7)), 1440)) <= p_now)
   order by coalesce(w.purge_last_attempt_at, '-infinity'::timestamptz), w.purge_at, w.id
   limit greatest(coalesce(p_batch, 20), 1)
$$;

-- Čerstvá kontrola způsobilosti těsně před mazáním souborů, pod zámkem řádku. Vrací true jen když je web pořád
-- ve stavu deleted s uplynulým purge_at a nemá ho převzatý jiný běh; pak ho zároveň převezme (purge_claimed_at,
-- počet pokusů), takže op_restore_wedding ho po dobu zapůjčení odmítne (`purge_in_progress`) a obnova a mazání
-- se nemohou proložit. Obnovený (nebo prodloužený) web vrací false: soubory se nemažou.
create function se_vezmou.retention_claim(
  p_wedding_id uuid,
  p_now timestamptz default pg_catalog.now()
) returns boolean
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  w se_vezmou.weddings;
begin
  perform se_vezmou.clock_guard(p_now);
  select * into w from se_vezmou.weddings x where x.id = p_wedding_id for update;
  if not found then
    return false;
  end if;
  if w.status <> 'deleted' or w.purge_at is null or w.purge_at > p_now then
    return false;
  end if;
  if w.purge_claimed_at is not null
     and w.purge_claimed_at > pg_catalog.clock_timestamp() - interval '15 minutes' then
    return false;
  end if;
  update se_vezmou.weddings x
     set purge_claimed_at = pg_catalog.clock_timestamp(),
         purge_attempts = least(x.purge_attempts + 1, 32000),
         purge_last_attempt_at = p_now
   where x.id = p_wedding_id;
  return true;
end
$$;

-- Uvolní převzetí po selhání (mazání souborů, mazání řádků): další pokus přijde po záloze, ne až po 15 minutách.
create function se_vezmou.retention_release(p_wedding_id uuid) returns void
  language sql volatile security definer set search_path = ''
  as $$
  update se_vezmou.weddings x set purge_claimed_at = null
   where x.id = p_wedding_id and x.status = 'deleted'
$$;

-- ---------------------------------------------------------------------------
-- op_restore_wedding: odmítne web, který právě maže úloha retence
-- ---------------------------------------------------------------------------
create or replace function se_vezmou.op_restore_wedding(p_operator_id uuid, p_wedding_id uuid, p_reason text) returns text
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  w se_vezmou.weddings;
  v_target text;
begin
  perform se_vezmou.assert_operator(p_operator_id, array['owner']);
  if char_length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  select * into w from se_vezmou.weddings x where x.id = p_wedding_id for update;
  if not found then
    raise exception 'wedding_not_found' using errcode = 'P0002';
  end if;
  if w.status <> 'deleted' or (w.purge_at is not null and w.purge_at <= pg_catalog.now()) then
    raise exception 'not_restorable' using errcode = '55000';
  end if;
  -- úloha retence už převzala web k trvalému smazání (mažou se soubory): obnova by skončila webem bez fotografií
  if w.purge_claimed_at is not null
     and w.purge_claimed_at > pg_catalog.clock_timestamp() - interval '15 minutes' then
    raise exception 'purge_in_progress' using errcode = '55000';
  end if;

  select h.from_status into v_target from se_vezmou.wedding_status_history h
   where h.wedding_id = w.id and h.to_status = 'deleted'
   order by h.created_at desc, h.id desc limit 1;
  if v_target is null or v_target = 'deleted'
     or (v_target = 'published' and (w.slug is null or w.published_version_id is null)) then
    v_target := 'draft';
  end if;

  update se_vezmou.weddings x set status = v_target where x.id = w.id;
  insert into se_vezmou.wedding_status_history (wedding_id, from_status, to_status, actor_type, actor_id, reason)
  values (w.id, 'deleted', v_target, 'operator', p_operator_id, p_reason);
  perform se_vezmou.write_audit('operator', p_operator_id, w.id, 'wedding.restore', 'wedding', w.id,
    p_reason, jsonb_build_object('from_status', 'deleted', 'to_status', v_target));
  return v_target;
end
$$;

revoke all on function
  se_vezmou.lifecycle_delete_archived(timestamptz, integer, uuid, boolean),
  se_vezmou.op_erase_waitlist(uuid, text, text),
  se_vezmou.retention_claim(uuid, timestamptz),
  se_vezmou.retention_release(uuid)
  from public, anon, authenticated;

grant execute on function
  se_vezmou.lifecycle_delete_archived(timestamptz, integer, uuid, boolean),
  se_vezmou.op_erase_waitlist(uuid, text, text),
  se_vezmou.retention_claim(uuid, timestamptz),
  se_vezmou.retention_release(uuid)
  to service_role;
