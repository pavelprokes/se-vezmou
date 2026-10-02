-- M7b / 2: přístup ke správě webu: správci (přidání, odebrání, strop), záložní e-mail, PIN hostů,
-- souhlas s nahlédnutím provozovatele (udělení a odvolání), smazání webu správcem.
-- Zdroj: docs/security-privacy.md kap. 1, 5, docs/data-model.md kap. 3.2, 6, FR-PRIV-2, OQ-53.
--
-- Funkce volá správce s claimy (role `authenticated`, svatba z claimu, žádný argument s identifikátorem
-- svatby). Vracejí-li adresy k oznámení (`notify`), jdou jen na server, který je použije k odeslání
-- a nikam neukládá ani nelogují. Audit nese jen identifikátory, počty a stavy, nikdy adresy.

-- ---------------------------------------------------------------------------
-- admin_access_load: stav přístupu pro obrazovku „Přístup“
-- ---------------------------------------------------------------------------
create function se_vezmou.admin_access_load() returns jsonb
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

-- ---------------------------------------------------------------------------
-- admin_admin_add: přidání správce (potvrzení krokem v rozhraní, oznámení posílá aplikace)
-- Strop počtu správců hlídá spouštěč (`max_admins_exceeded`, nejvýše 5).
-- ---------------------------------------------------------------------------
create function se_vezmou.admin_admin_add(p_email text) returns jsonb
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
    ) x));
end
$$;

-- ---------------------------------------------------------------------------
-- admin_admin_remove: odebrání správce (ne sebe), odvolá jeho relace
-- ---------------------------------------------------------------------------
create function se_vezmou.admin_admin_remove(p_admin_id uuid) returns jsonb
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
    ) x));
end
$$;

-- ---------------------------------------------------------------------------
-- admin_backup_email_set: změna záložního e-mailu; vrací starou i novou adresu k oznámení
-- ---------------------------------------------------------------------------
create function se_vezmou.admin_backup_email_set(p_email text) returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  v_old text;
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or pg_catalog.length(v_email) > 254 then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  select wa.backup_email::text into v_old from se_vezmou.wedding_auth wa
   where wa.wedding_id = v_wedding_id for update;
  if not found then
    raise exception 'wedding_auth_missing' using errcode = 'P0002';
  end if;
  if pg_catalog.lower(v_old) = v_email then
    return jsonb_build_object('changed', false);
  end if;
  update se_vezmou.wedding_auth wa set backup_email = v_email::extensions.citext
   where wa.wedding_id = v_wedding_id;
  perform se_vezmou.write_audit('admin', se_vezmou.actor_id(), v_wedding_id, 'auth.backup_changed',
    'wedding', v_wedding_id, null, '{}'::jsonb);
  return jsonb_build_object('changed', true, 'old', v_old, 'notify', (
    select coalesce(jsonb_agg(a.email::text), '[]'::jsonb) from se_vezmou.wedding_admins a
     where a.wedding_id = v_wedding_id and a.removed_at is null));
end
$$;

-- ---------------------------------------------------------------------------
-- admin_guest_pin_enabled_set: zapnutí a vypnutí PINu hostů (citlivé bloky)
-- Zapnout lze jen s nastaveným PINem hostů; vypnutí PIN ponechá, ale hosté se jím nepřihlásí.
-- ---------------------------------------------------------------------------
create function se_vezmou.admin_guest_pin_enabled_set(p_enabled boolean) returns void
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  if p_enabled and not exists (
       select 1 from se_vezmou.wedding_auth wa
        where wa.wedding_id = v_wedding_id and wa.guest_pin_hash is not null) then
    raise exception 'pin_missing' using errcode = '55000';
  end if;
  update se_vezmou.weddings w set guest_pin_enabled = p_enabled where w.id = v_wedding_id;
  if not p_enabled then
    -- vypnutí PINu hostů hned ukončí odemčené relace hostů
    update se_vezmou.sessions s set revoked_at = pg_catalog.now()
     where s.wedding_id = v_wedding_id and s.kind = 'guest_pin' and s.revoked_at is null;
  end if;
  perform se_vezmou.write_audit('admin', se_vezmou.actor_id(), v_wedding_id,
    case when p_enabled then 'guest_pin.enabled' else 'guest_pin.disabled' end,
    'wedding', v_wedding_id, null, '{}'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------
-- grant_operator_access / revoke_operator_access: souhlas páru s nahlédnutím provozovatele
-- do údajů hostů (data_access_grants). Důvod je povinný, platnost 1 až 30 dní; jeden aktivní
-- souhlas naráz (nový nahradí předchozí). Funkce vrací adresy k oznámení ostatním správcům.
-- ---------------------------------------------------------------------------
create function se_vezmou.grant_operator_access(p_reason text, p_days integer) returns jsonb
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
    ) x));
end
$$;

create function se_vezmou.revoke_operator_access(p_grant_id uuid) returns jsonb
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
    ) x));
end
$$;

-- ---------------------------------------------------------------------------
-- admin_wedding_delete: smazání webu správcem. Stav přejde na `deleted` (web zmizí hned, adresa
-- se znovu nepřidělí); údaje se trvale smažou po lhůtě `deleted_site_restore_days` (retenční úloha,
-- M10), do té doby web obnoví jen provozovatel. Ukončí všechny relace. Vrací adresy k oznámení.
-- ---------------------------------------------------------------------------
create function se_vezmou.admin_wedding_delete() returns jsonb
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

  -- adresy přečíst před ukončením relací a před změnou stavu
  select coalesce(jsonb_agg(x.e), '[]'::jsonb) into v_notify from (
    select a.email::text as e from se_vezmou.wedding_admins a
     where a.wedding_id = v_wedding_id and a.removed_at is null
    union
    select wa.backup_email::text from se_vezmou.wedding_auth wa where wa.wedding_id = v_wedding_id
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

revoke all on function
  se_vezmou.admin_access_load(),
  se_vezmou.admin_admin_add(text),
  se_vezmou.admin_admin_remove(uuid),
  se_vezmou.admin_backup_email_set(text),
  se_vezmou.admin_guest_pin_enabled_set(boolean),
  se_vezmou.grant_operator_access(text, integer),
  se_vezmou.revoke_operator_access(uuid),
  se_vezmou.admin_wedding_delete()
  from public, anon, service_role;
grant execute on function
  se_vezmou.admin_access_load(),
  se_vezmou.admin_admin_add(text),
  se_vezmou.admin_admin_remove(uuid),
  se_vezmou.admin_backup_email_set(text),
  se_vezmou.admin_guest_pin_enabled_set(boolean),
  se_vezmou.grant_operator_access(text, integer),
  se_vezmou.revoke_operator_access(uuid),
  se_vezmou.admin_wedding_delete()
  to authenticated;

-- ---------------------------------------------------------------------------
-- Oznámení správcům o nahlédnutí provozovatele do údajů hostů (OQ-53)
-- Volá aplikace (service role) po úspěšném nahlédnutí: adresy aktivních správců a záložní adresa.
-- Adresy jdou jen na server k odeslání; nikam se neukládají a nelogují. Jazyk e-mailu je výchozí
-- jazyk webu.
-- ---------------------------------------------------------------------------
create function se_vezmou.guest_data_notice_recipients(p_wedding_id uuid)
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
  ) x
$$;

revoke all on function se_vezmou.guest_data_notice_recipients(uuid)
  from public, anon, authenticated, service_role;
grant execute on function se_vezmou.guest_data_notice_recipients(uuid) to service_role;
