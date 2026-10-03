-- Bezpečnost: záložní e-mail se nepoužije k žádnému oznámení, dokud není potvrzen.
--
-- Záložní adresu zadává správce při prvním uložení v průvodci a nikdo ji neověřoval: cizí adresa mohla
-- dostávat oznámení o přihlášení, zamčení PINu, změnách správců a přístupu provozovatele. Řešení:
--  * `wedding_auth.backup_email_confirmed_at`: potvrzení adresy jejím vlastníkem. Zatím existuje jen
--    databázová cesta (`auth_backup_email_confirm`, jen service_role); potvrzovací krok v rozhraní
--    (kód zaslaný na adresu přes výzvy `login_challenges`) je navazující úkol. Do té doby se na záložní
--    adresu neposílá nic kromě JEDNÉ neutrální zprávy „někdo vás uvedl jako záložní e-mail“ (aplikace ji
--    posílá při zadání adresy: první uložení v průvodci a změna záložního e-mailu).
--  * Všechny funkce, které vracely záložní adresu k oznámení (`auth_pin_get`, `auth_pin_set`, seznamy
--    adresátů `notify` a příjemci oznámení o nahlédnutí), vrací ji jen potvrzenou, jinak nic.
--  * Změna adresy potvrzení zruší. Dosavadní adresy zůstávají nepotvrzené (nic se nepředpokládá).

alter table se_vezmou.wedding_auth add column backup_email_confirmed_at timestamptz;

-- Potvrzení adresy (volá server až po ověření kódu zaslaného na ni). Potvrdí jen shodnou aktuální adresu.
create function se_vezmou.auth_backup_email_confirm(p_wedding_id uuid, p_email text) returns boolean
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_rows integer;
begin
  update se_vezmou.wedding_auth wa
     set backup_email_confirmed_at = pg_catalog.now()
   where wa.wedding_id = p_wedding_id
     and pg_catalog.lower(wa.backup_email::text) = pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')))
     and wa.backup_email_confirmed_at is null;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    perform se_vezmou.write_audit('system', null, p_wedding_id, 'auth.backup_confirmed',
      'wedding', p_wedding_id, null, '{}'::jsonb);
  end if;
  return v_rows = 1;
end
$$;

revoke all on function se_vezmou.auth_backup_email_confirm(uuid, text) from public, anon, authenticated;
grant execute on function se_vezmou.auth_backup_email_confirm(uuid, text) to service_role;

-- Záložní adresa jen potvrzená (jinak null: oznámení se neposílá).
create or replace function se_vezmou.auth_pin_get(p_slug text, p_role text)
  returns table (wedding_id uuid, admin_id uuid, pin_hash text, backup_email text)
  language sql stable security definer set search_path = ''
  as $$
  select w.id,
         case when p_role = 'admin' then
           (select a.id from se_vezmou.wedding_admins a
             where a.wedding_id = w.id and a.removed_at is null
             order by a.added_at, a.id limit 1)
         end,
         case when p_role = 'admin' then wa.admin_pin_hash else wa.guest_pin_hash end,
         case when wa.backup_email_confirmed_at is not null then wa.backup_email::text end
    from se_vezmou.weddings w
    join se_vezmou.wedding_auth wa on wa.wedding_id = w.id
   where p_role in ('admin', 'guest')
     and w.slug = p_slug and w.deleted_at is null
     and case p_role
           when 'admin' then
             wa.admin_pin_hash is not null
             and exists (select 1 from se_vezmou.wedding_admins a
                          where a.wedding_id = w.id and a.removed_at is null)
           else
             wa.guest_pin_hash is not null and w.guest_pin_enabled and w.status = 'published'
         end
$$;

create or replace function se_vezmou.auth_pin_set(
  p_wedding_id uuid,
  p_role text,
  p_hash text,
  p_actor_admin_id uuid default null,
  p_keep_session_id uuid default null
) returns text
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_backup text;
begin
  if p_role not in ('admin', 'guest') then
    raise exception 'invalid_pin_role' using errcode = '22023';
  end if;
  if p_hash is null or p_hash !~ '^\$argon2id\$' or char_length(p_hash) > 300 then
    raise exception 'invalid_pin_hash' using errcode = '22023';
  end if;

  -- bez záložního e-mailu (řádek wedding_auth) PIN nelze nastavit
  update se_vezmou.wedding_auth wa
     set admin_pin_hash = case when p_role = 'admin' then p_hash else wa.admin_pin_hash end,
         guest_pin_hash = case when p_role = 'guest' then p_hash else wa.guest_pin_hash end
   where wa.wedding_id = p_wedding_id
  returning case when wa.backup_email_confirmed_at is not null then wa.backup_email::text end
  into v_backup;
  if not found then
    raise exception 'wedding_auth_missing' using errcode = 'P0002';
  end if;

  update se_vezmou.sessions s set revoked_at = pg_catalog.now()
   where s.wedding_id = p_wedding_id and s.revoked_at is null
     and s.kind = case p_role when 'admin' then 'admin' else 'guest_pin' end
     and (p_keep_session_id is null or s.id <> p_keep_session_id);

  perform se_vezmou.write_audit(
    case when p_actor_admin_id is null then 'system' else 'admin' end,
    p_actor_admin_id, p_wedding_id, 'pin.change', 'wedding', p_wedding_id, null,
    jsonb_build_object('role', p_role));
  return v_backup;
end
$$;

create or replace function se_vezmou.admin_access_load() returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
  v_me uuid := se_vezmou.actor_id();
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'max_admins', least(se_vezmou.setting_int('max_admins', 3), 5),
    'admins', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'email', a.email::text, 'added_at', a.added_at, 'last_login_at', a.last_login_at,
        'is_me', a.id = v_me) order by a.added_at, a.id), '[]'::jsonb)
        from se_vezmou.wedding_admins a where a.wedding_id = v_wedding_id and a.removed_at is null),
    'backup_email', (select wa.backup_email::text from se_vezmou.wedding_auth wa where wa.wedding_id = v_wedding_id),
    'backup_confirmed', coalesce((select wa.backup_email_confirmed_at is not null from se_vezmou.wedding_auth wa
                                   where wa.wedding_id = v_wedding_id), false),
    'has_admin_pin', coalesce((select wa.admin_pin_hash is not null from se_vezmou.wedding_auth wa
                                where wa.wedding_id = v_wedding_id), false),
    'has_guest_pin', coalesce((select wa.guest_pin_hash is not null from se_vezmou.wedding_auth wa
                                where wa.wedding_id = v_wedding_id), false),
    'guest_pin_enabled', (select w.guest_pin_enabled from se_vezmou.weddings w where w.id = v_wedding_id),
    'status', (select w.status from se_vezmou.weddings w where w.id = v_wedding_id),
    'slug', (select w.slug from se_vezmou.weddings w where w.id = v_wedding_id),
    'restore_days', se_vezmou.setting_int('deleted_site_restore_days', 30),
    'default_locale', (select w.default_locale from se_vezmou.weddings w where w.id = v_wedding_id),
    'timezone', (select w.timezone from se_vezmou.weddings w where w.id = v_wedding_id),
    'grants', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', g.id, 'reason', g.reason, 'created_at', g.created_at, 'expires_at', g.expires_at,
        'revoked_at', g.revoked_at,
        'active', g.revoked_at is null and g.expires_at > pg_catalog.now(),
        'by_me', g.granted_by_admin_id = v_me) order by g.created_at desc, g.id), '[]'::jsonb)
        from (select * from se_vezmou.data_access_grants x where x.wedding_id = v_wedding_id
               order by x.created_at desc limit 20) g),
    'operator_views', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id, 'at', l.at, 'action', l.action, 'reason', l.reason) order by l.at desc, l.id desc),
        '[]'::jsonb)
        from (select * from se_vezmou.audit_log x
               where x.wedding_id = v_wedding_id and x.actor_type = 'operator'
                 and x.action like 'guest_data.%'
               order by x.at desc, x.id desc limit 20) l)
  );
end
$$;

create or replace function se_vezmou.admin_admin_add(p_email text) returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  v_id uuid;
  v_total integer;
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or pg_catalog.length(v_email) > 254 then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if exists (select 1 from se_vezmou.wedding_admins a
              where a.wedding_id = v_wedding_id and a.removed_at is null
                and pg_catalog.lower(a.email::text) = v_email) then
    raise exception 'admin_exists' using errcode = '23505';
  end if;

  insert into se_vezmou.wedding_admins (wedding_id, email, added_by)
  values (v_wedding_id, v_email::extensions.citext, se_vezmou.actor_id())
  returning id into v_id;

  select count(*) into v_total from se_vezmou.wedding_admins a
   where a.wedding_id = v_wedding_id and a.removed_at is null;
  perform se_vezmou.write_audit('admin', se_vezmou.actor_id(), v_wedding_id, 'admin.add',
    'wedding_admin', v_id, null, jsonb_build_object('admins_after', v_total));

  return jsonb_build_object('id', v_id, 'notify', (
    select coalesce(jsonb_agg(x.e), '[]'::jsonb) from (
      select a.email::text as e from se_vezmou.wedding_admins a
       where a.wedding_id = v_wedding_id and a.removed_at is null and a.id <> v_id
      union
      select wa.backup_email::text from se_vezmou.wedding_auth wa where wa.wedding_id = v_wedding_id
         and wa.backup_email_confirmed_at is not null
    ) x));
end
$$;

create or replace function se_vezmou.admin_admin_remove(p_admin_id uuid) returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
  v_removed text;
  v_total integer;
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_admin_id is not distinct from se_vezmou.actor_id() then
    raise exception 'cannot_remove_self' using errcode = '55000';
  end if;

  update se_vezmou.wedding_admins a set removed_at = pg_catalog.now()
   where a.id = p_admin_id and a.wedding_id = v_wedding_id and a.removed_at is null
  returning a.email::text into v_removed;
  if not found then
    raise exception 'admin_not_found' using errcode = 'P0002';
  end if;

  update se_vezmou.sessions s set revoked_at = pg_catalog.now()
   where s.wedding_id = v_wedding_id and s.subject_id = p_admin_id and s.revoked_at is null;

  select count(*) into v_total from se_vezmou.wedding_admins a
   where a.wedding_id = v_wedding_id and a.removed_at is null;
  perform se_vezmou.write_audit('admin', se_vezmou.actor_id(), v_wedding_id, 'admin.remove',
    'wedding_admin', p_admin_id, null, jsonb_build_object('admins_after', v_total));

  return jsonb_build_object('removed', v_removed, 'notify', (
    select coalesce(jsonb_agg(x.e), '[]'::jsonb) from (
      select a.email::text as e from se_vezmou.wedding_admins a
       where a.wedding_id = v_wedding_id and a.removed_at is null
      union
      select wa.backup_email::text from se_vezmou.wedding_auth wa where wa.wedding_id = v_wedding_id
         and wa.backup_email_confirmed_at is not null
    ) x));
end
$$;

create or replace function se_vezmou.grant_operator_access(p_reason text, p_days integer) returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
  v_id uuid;
  v_expires timestamptz;
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if pg_catalog.char_length(v_reason) not between 3 and 500 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if p_days is null or p_days not between 1 and 30 then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  perform 1 from se_vezmou.weddings w where w.id = v_wedding_id for update;

  update se_vezmou.data_access_grants g set revoked_at = pg_catalog.now()
   where g.wedding_id = v_wedding_id and g.revoked_at is null and g.expires_at > pg_catalog.now();

  v_expires := pg_catalog.now() + pg_catalog.make_interval(days => p_days);
  insert into se_vezmou.data_access_grants (wedding_id, granted_by_admin_id, reason, scope, expires_at)
  values (v_wedding_id, se_vezmou.actor_id(), v_reason, 'guest_data', v_expires)
  returning id into v_id;

  perform se_vezmou.write_audit('admin', se_vezmou.actor_id(), v_wedding_id, 'operator_access.grant',
    'data_access_grant', v_id, null, jsonb_build_object('days', p_days));

  return jsonb_build_object('id', v_id, 'expires_at', v_expires, 'notify', (
    select coalesce(jsonb_agg(x.e), '[]'::jsonb) from (
      select a.email::text as e from se_vezmou.wedding_admins a
       where a.wedding_id = v_wedding_id and a.removed_at is null
      union
      select wa.backup_email::text from se_vezmou.wedding_auth wa where wa.wedding_id = v_wedding_id
         and wa.backup_email_confirmed_at is not null
    ) x));
end
$$;

create or replace function se_vezmou.revoke_operator_access(p_grant_id uuid) returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update se_vezmou.data_access_grants g set revoked_at = pg_catalog.now()
   where g.id = p_grant_id and g.wedding_id = v_wedding_id
     and g.revoked_at is null and g.expires_at > pg_catalog.now();
  if not found then
    raise exception 'grant_not_found' using errcode = 'P0002';
  end if;
  perform se_vezmou.write_audit('admin', se_vezmou.actor_id(), v_wedding_id, 'operator_access.revoke',
    'data_access_grant', p_grant_id, null, '{}'::jsonb);
  return jsonb_build_object('notify', (
    select coalesce(jsonb_agg(x.e), '[]'::jsonb) from (
      select a.email::text as e from se_vezmou.wedding_admins a
       where a.wedding_id = v_wedding_id and a.removed_at is null
      union
      select wa.backup_email::text from se_vezmou.wedding_auth wa where wa.wedding_id = v_wedding_id
         and wa.backup_email_confirmed_at is not null
    ) x));
end
$$;

create or replace function se_vezmou.admin_wedding_delete() returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
  v_old text;
  v_purge timestamptz;
  v_notify jsonb;
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select w.status into v_old from se_vezmou.weddings w where w.id = v_wedding_id for update;
  if not found or v_old = 'deleted' then
    raise exception 'wedding_not_found' using errcode = 'P0002';
  end if;
  -- zablokovaný web smí uvolnit jen provozovatel; jinak by správce blokaci obešel smazáním
  if v_old = 'blocked' then
    raise exception 'wedding_blocked' using errcode = '55000';
  end if;

  -- adresy přečíst před ukončením relací a před změnou stavu
  select coalesce(jsonb_agg(x.e), '[]'::jsonb) into v_notify from (
    select a.email::text as e from se_vezmou.wedding_admins a
     where a.wedding_id = v_wedding_id and a.removed_at is null
    union
    select wa.backup_email::text from se_vezmou.wedding_auth wa where wa.wedding_id = v_wedding_id
    and wa.backup_email_confirmed_at is not null
  ) x;

  update se_vezmou.weddings w set status = 'deleted' where w.id = v_wedding_id
  returning w.purge_at into v_purge;
  insert into se_vezmou.wedding_status_history (wedding_id, from_status, to_status, actor_type, actor_id, reason)
  values (v_wedding_id, v_old, 'deleted', 'admin', se_vezmou.actor_id(), null);
  update se_vezmou.sessions s set revoked_at = pg_catalog.now()
   where s.wedding_id = v_wedding_id and s.revoked_at is null;
  perform se_vezmou.write_audit('admin', se_vezmou.actor_id(), v_wedding_id, 'wedding.delete',
    'wedding', v_wedding_id, null, jsonb_build_object('from_status', v_old));

  return jsonb_build_object('purge_at', v_purge, 'notify', v_notify);
end
$$;

create or replace function se_vezmou.admin_backup_email_set(p_email text) returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  v_old text;
  v_confirmed boolean;
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or pg_catalog.length(v_email) > 254 then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  select wa.backup_email::text, wa.backup_email_confirmed_at is not null into v_old, v_confirmed
    from se_vezmou.wedding_auth wa where wa.wedding_id = v_wedding_id for update;
  if not found then
    raise exception 'wedding_auth_missing' using errcode = 'P0002';
  end if;
  if pg_catalog.lower(v_old) = v_email then
    return jsonb_build_object('changed', false);
  end if;
  -- nová adresa je nepotvrzená, dokud ji její vlastník nepotvrdí
  update se_vezmou.wedding_auth wa
     set backup_email = v_email::extensions.citext, backup_email_confirmed_at = null
   where wa.wedding_id = v_wedding_id;
  perform se_vezmou.write_audit('admin', se_vezmou.actor_id(), v_wedding_id, 'auth.backup_changed',
    'wedding', v_wedding_id, null, '{}'::jsonb);
  -- stará adresa dostane oznámení jen tehdy, když byla potvrzená
  return jsonb_build_object('changed', true, 'old', case when v_confirmed then v_old end, 'notify', (
    select coalesce(jsonb_agg(a.email::text), '[]'::jsonb) from se_vezmou.wedding_admins a
     where a.wedding_id = v_wedding_id and a.removed_at is null));
end
$$;

create or replace function se_vezmou.guest_data_notice_recipients(p_wedding_id uuid)
  returns table (email text, locale text)
  language sql stable security definer set search_path = ''
  as $$
  select x.e, x.l from (
    select a.email::text as e, w.default_locale as l
      from se_vezmou.wedding_admins a join se_vezmou.weddings w on w.id = a.wedding_id
     where a.wedding_id = p_wedding_id and a.removed_at is null and w.deleted_at is null
    union
    select wa.backup_email::text, w.default_locale
      from se_vezmou.wedding_auth wa join se_vezmou.weddings w on w.id = wa.wedding_id
     where wa.wedding_id = p_wedding_id and w.deleted_at is null
       and wa.backup_email_confirmed_at is not null
  ) x
$$;
