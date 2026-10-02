-- M3 / 9: funkce security definer pro cestu před ověřením (service role):
-- rate_limit_hit, kontrola a rezervace slugů, resolve_slug, auth_* (relace, výzvy), nastavení.
--
-- Povinná pravidla pro každou funkci (kap. 5.5): set search_path = '', plně kvalifikované názvy,
-- revoke execute from public, anon, explicitní grant jen potřebné roli. Funkce volané hosty
-- a správci filtrují vždy podle se_vezmou.wedding_id(); funkce service role před ověřením berou
-- identifikátory výslovně jako argumenty.
--
-- ---------------------------------------------------------------------------
-- TODO pro pozdější milníky (zde záměrně neimplementováno):
--  M4  auth_*: stav a ověření PINu správce a hostů (auth_pin_state, auth_pin_register_failure,
--      auth_pin_register_success, zdvojnásobující pauza v tabulce lockouts, oznámení na záložní
--      e-mail), nastavení a změna PINu s kontrolou, že PIN správy a hostů nejsou shodné.
--  M5  wizard_create_draft (první uložení: weddings + wedding_admins + wedding_auth + orders
--      + pages + rsvp_settings + reserve_slug v jedné transakci), publish_site (snímek do
--      site_versions a site_version_sensitive, přepnutí stavu), set_preview_token,
--      doplnění seznamu vulgarismů do slug_registry.
--  M7  add_wedding_admin a remove_wedding_admin (limit N, notifikace, odvolání relací),
--      grant_operator_access a revoke_operator_access (zápis do data_access_grants správcem
--      s auditem a oznámením), obnovení verze webu.
--  M8  rsvp_submit_unlisted (host mimo seznam, allow_unlisted), ruční zápis správcem s auditem.
--  M9  op_list_weddings, op_get_wedding (agregáty bez údajů hostů), op_change_slug (FR-OPS-4),
--      op_extend_retention, op_restore_wedding, op_send_login_link, op_analytics_summary,
--      auth_operator_* (relace operátorů, ADR 0008), op_add_note.
--  M10 e-maily s upozorněním a exportem před smazáním, mazání souborů z úložiště (purge_wedding
--      vrací cesty), napojení cronu (pg_cron nebo plánovač Vercelu).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Zápis auditu (interní; volají jen funkce security definer v téže transakci jako zásah)
-- ---------------------------------------------------------------------------
create function se_vezmou.write_audit(
  p_actor_type text,
  p_actor_id uuid,
  p_wedding_id uuid,
  p_action text,
  p_target_type text default null,
  p_target_id uuid default null,
  p_reason text default null,
  p_meta jsonb default '{}'::jsonb
) returns bigint
  language sql volatile security definer set search_path = ''
  as $$
  insert into se_vezmou.audit_log (actor_type, actor_id, wedding_id, action, target_type, target_id, reason, meta)
  values (p_actor_type, p_actor_id, p_wedding_id, p_action, p_target_type, p_target_id, p_reason,
          coalesce(p_meta, '{}'::jsonb))
  returning id
$$;

revoke all on function se_vezmou.write_audit(text, uuid, uuid, text, text, uuid, text, jsonb)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- rate_limit_hit (ADR 0010, kap. 3.8): atomický čítač s pevným oknem
-- ---------------------------------------------------------------------------
create function se_vezmou.rate_limit_hit(p_bucket_key text, p_limit integer, p_window interval)
  returns table (allowed boolean, retry_after integer)
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_secs numeric := extract(epoch from p_window);
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_start timestamptz;
  v_hits integer;
begin
  if p_bucket_key is null or p_bucket_key = '' or p_limit is null or p_limit < 1 or v_secs < 1 then
    raise exception 'invalid_rate_limit_arguments' using errcode = '22023';
  end if;

  v_start := to_timestamp(floor(extract(epoch from v_now) / v_secs) * v_secs);

  -- jediný příkaz = atomické zvýšení i při souběžných požadavcích (řádek zamyká unikátní klíč)
  insert into se_vezmou.rate_limits as r (bucket_key, window_start, hits)
  values (p_bucket_key, v_start, 1)
  on conflict (bucket_key, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;

  -- oportunistický úklid starých oken (denní cron housekeeping dělá zbytek)
  if random() < 0.01 then
    delete from se_vezmou.rate_limits d
     where d.ctid in (
       select x.ctid from se_vezmou.rate_limits x
        where x.window_start < v_now - interval '1 day' limit 200);
  end if;

  allowed := v_hits <= p_limit;
  retry_after := case when allowed then 0
    else greatest(1, ceil(extract(epoch from (v_start + pg_catalog.make_interval(secs => v_secs) - v_now)))::integer)
  end;
  return next;
end
$$;

revoke all on function se_vezmou.rate_limit_hit(text, integer, interval) from public, anon;
grant execute on function se_vezmou.rate_limit_hit(text, integer, interval) to service_role;

-- ---------------------------------------------------------------------------
-- Slugy (kap. 6)
-- ---------------------------------------------------------------------------
create function se_vezmou.slug_valid(p_slug text) returns boolean
  language sql immutable set search_path = ''
  as $$ select p_slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' and position('--' in p_slug) = 0 $$;

-- Dostupnost adresy: platný tvar a žádný blokující řádek v registru. Prošlá rezervace konceptu
-- a nezveřejněný retired slug se berou jako volné (FR-PRIV-4).
create function se_vezmou.slug_available(p_slug text) returns boolean
  language sql stable security definer set search_path = ''
  as $$
  select coalesce(se_vezmou.slug_valid(p_slug), false)
    and not exists (
      select 1 from se_vezmou.slug_registry sr
       where sr.slug = p_slug
         and (sr.state in ('reserved_word', 'active')
              or (sr.state = 'reserved' and sr.reserved_until > pg_catalog.now())
              or (sr.state = 'retired' and sr.first_published_at is not null)))
$$;

-- Nabídka variant při kolizi (FR-WZ-4): rok, rok-měsíc, "obec" a neuhádnutelná varianta.
create function se_vezmou.slug_variants(p_slug text, p_starts_on date) returns text[]
  language plpgsql volatile set search_path = ''
  as $$
declare
  c_alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  v_result text[] := '{}';
  v_candidates text[] := '{}';
  v_candidate text;
  v_suffix text;
  v_try integer := 0;
begin
  if p_starts_on is not null then
    v_candidates := array_append(v_candidates, extract(year from p_starts_on)::integer::text);
    v_candidates := array_append(v_candidates,
      extract(year from p_starts_on)::integer::text || '-' || lpad(extract(month from p_starts_on)::integer::text, 2, '0'));
  end if;
  v_candidates := array_append(v_candidates, 'obec');

  foreach v_suffix in array v_candidates loop
    v_candidate := regexp_replace(left(p_slug, 63 - length(v_suffix) - 1), '-+$', '') || '-' || v_suffix;
    if se_vezmou.slug_available(v_candidate) then
      v_result := array_append(v_result, v_candidate);
    end if;
  end loop;

  -- neuhádnutelná varianta se čtyřmi náhodnými znaky
  while v_try < 10 loop
    v_try := v_try + 1;
    v_suffix := '';
    for i in 1..4 loop
      v_suffix := v_suffix || substr(c_alphabet, 1 + floor(random() * length(c_alphabet))::integer, 1);
    end loop;
    v_candidate := regexp_replace(left(p_slug, 63 - 5), '-+$', '') || '-' || v_suffix;
    if se_vezmou.slug_available(v_candidate) then
      v_result := array_append(v_result, v_candidate);
      exit;
    end if;
  end loop;

  return v_result;
end
$$;

revoke all on function se_vezmou.slug_valid(text), se_vezmou.slug_available(text), se_vezmou.slug_variants(text, date)
  from public, anon;
grant execute on function se_vezmou.slug_valid(text) to authenticated, service_role;

-- check_slug: informativní dostupnost s omezením počtu dotazů; nikdy nevrací seznam.
-- Důvod 'unavailable' je stejný pro zabranou, rezervovanou i zakázanou adresu.
create function se_vezmou.check_slug(
  p_slug text,
  p_rate_key text default null,
  p_rate_limit integer default 30,
  p_rate_window interval default interval '10 minutes'
) returns table (available boolean, reason text, retry_after integer)
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_allowed boolean;
  v_retry integer;
begin
  if p_rate_key is not null then
    select l.allowed, l.retry_after into v_allowed, v_retry
      from se_vezmou.rate_limit_hit(p_rate_key, p_rate_limit, p_rate_window) l;
    if not v_allowed then
      return query select null::boolean, 'rate_limited'::text, v_retry;
      return;
    end if;
  end if;

  if not se_vezmou.slug_valid(p_slug) then
    return query select false, 'invalid'::text, 0;
  elsif se_vezmou.slug_available(p_slug) then
    return query select true, 'ok'::text, 0;
  else
    return query select false, 'unavailable'::text, 0;
  end if;
end
$$;

revoke all on function se_vezmou.check_slug(text, text, integer, interval) from public, anon;
grant execute on function se_vezmou.check_slug(text, text, integer, interval) to service_role;

-- reserve_slug: rezervace adresy pro koncept. Kolizi řeší unikátní klíč v téže transakci
-- (žádná aplikační kontrola mezi čtením a zápisem); při kolizi vrátí varianty a nic nezmění.
create function se_vezmou.reserve_slug(p_wedding_id uuid, p_slug text)
  returns table (ok boolean, variants text[])
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding se_vezmou.weddings;
  v_until timestamptz;
begin
  select * into v_wedding from se_vezmou.weddings w where w.id = p_wedding_id for update;
  if not found or v_wedding.deleted_at is not null then
    raise exception 'wedding_not_found' using errcode = 'P0002';
  end if;
  if v_wedding.status <> 'draft' then
    -- po zveřejnění mění adresu jen operátor (op_change_slug, M9)
    raise exception 'wedding_not_draft' using errcode = '55000';
  end if;
  if not se_vezmou.slug_valid(p_slug) then
    raise exception 'invalid_slug' using errcode = '22023';
  end if;

  -- uvolnění prošlých rezervací a nezveřejněných retired adres téhož slugu (ne zveřejněných)
  delete from se_vezmou.slug_registry sr
   where sr.slug = p_slug and sr.first_published_at is null
     and ((sr.state = 'reserved' and sr.reserved_until <= pg_catalog.now()) or sr.state = 'retired');

  v_until := v_wedding.last_activity_at
    + pg_catalog.make_interval(days => se_vezmou.setting_int('slug_reservation_days', 30));

  begin
    -- vlastní předchozí rezervace téže svatby se nahrazuje (při kolizi se vrátí zpět)
    if v_wedding.slug is distinct from p_slug then
      delete from se_vezmou.slug_registry sr
       where sr.wedding_id = p_wedding_id and sr.state = 'reserved';
      insert into se_vezmou.slug_registry (slug, state, wedding_id, reserved_until)
      values (p_slug, 'reserved', p_wedding_id, v_until);
      update se_vezmou.weddings w set slug = p_slug where w.id = p_wedding_id;
    else
      update se_vezmou.slug_registry sr set reserved_until = v_until
       where sr.slug = p_slug and sr.wedding_id = p_wedding_id and sr.state = 'reserved';
    end if;
  exception when unique_violation then
    return query select false, se_vezmou.slug_variants(p_slug, v_wedding.starts_on);
    return;
  end;

  return query select true, '{}'::text[];
end
$$;

revoke all on function se_vezmou.reserve_slug(uuid, text) from public, anon;
grant execute on function se_vezmou.reserve_slug(uuid, text) to service_role;

-- Uvolnění rezervací po reserved_until u nezveřejněných konceptů (denní cron).
create function se_vezmou.purge_expired_slug_reservations() returns integer
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_count integer;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('purge_expired_slug_reservations')) then
    return 0;
  end if;

  with released as (
    delete from se_vezmou.slug_registry sr
     where sr.state = 'reserved' and sr.reserved_until <= pg_catalog.now()
       and sr.first_published_at is null
    returning 1
  )
  select count(*) into v_count from released;

  if v_count > 0 then
    perform se_vezmou.write_audit('system', null, null, 'slug.reservation_expired',
      null, null, null, jsonb_build_object('count', v_count));
  end if;
  return v_count;
end
$$;

revoke all on function se_vezmou.purge_expired_slug_reservations() from public, anon;
grant execute on function se_vezmou.purge_expired_slug_reservations() to service_role;

-- resolve_slug: stejný tvar odpovědi (žádný řádek) pro neexistující, nezveřejněnou, smazanou
-- i zablokovanou adresu, aby nešlo zjistit rozdíl. [OTÁZKA] zda archived zůstává online.
create function se_vezmou.resolve_slug(p_slug text)
  returns table (wedding_id uuid, status text, default_locale text, locales text[], template text)
  language sql stable security definer set search_path = ''
  as $$
  select w.id, w.status, w.default_locale, w.locales, w.template
    from se_vezmou.weddings w
   where w.slug = p_slug and w.status = 'published' and w.deleted_at is null
$$;

revoke all on function se_vezmou.resolve_slug(text) from public, anon;
grant execute on function se_vezmou.resolve_slug(text) to service_role;

-- resolve_preview: náhled konceptu podle neuhádnutelného odkazu (uložen jako hash).
-- Server po shodě vydá JWT s wedding_role = preview.
create function se_vezmou.resolve_preview(p_slug text, p_token_hash bytea)
  returns table (wedding_id uuid)
  language sql stable security definer set search_path = ''
  as $$
  select w.id
    from se_vezmou.weddings w
   where w.slug = p_slug and w.preview_token_hash is not null and w.preview_token_hash = p_token_hash
     and w.status in ('draft', 'pending_payment', 'published') and w.deleted_at is null
$$;

revoke all on function se_vezmou.resolve_preview(text, bytea) from public, anon;
grant execute on function se_vezmou.resolve_preview(text, bytea) to service_role;

-- ---------------------------------------------------------------------------
-- Nastavení: čtení pro aplikaci (zápis jen op_set_app_setting)
-- ---------------------------------------------------------------------------
create function se_vezmou.get_app_settings() returns table (key text, value jsonb)
  language sql stable security definer set search_path = ''
  as $$ select s.key, s.value from se_vezmou.app_settings s order by s.key $$;

revoke all on function se_vezmou.get_app_settings() from public, anon;
grant execute on function se_vezmou.get_app_settings() to service_role;

-- ---------------------------------------------------------------------------
-- auth_*: relace a výzvy (před ověřením, jediná cesta ke sessions a login_challenges)
-- ---------------------------------------------------------------------------
create function se_vezmou.auth_create_session(
  p_kind text,
  p_wedding_id uuid,
  p_subject_id uuid,
  p_token_hash bytea,
  p_idle_seconds integer,
  p_absolute_seconds integer
) returns uuid
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding se_vezmou.weddings;
  v_id uuid;
begin
  if p_kind not in ('admin', 'guest_pin') or p_idle_seconds < 1 or p_absolute_seconds < p_idle_seconds then
    raise exception 'invalid_session_arguments' using errcode = '22023';
  end if;

  select * into v_wedding from se_vezmou.weddings w where w.id = p_wedding_id and w.deleted_at is null;
  if not found then
    raise exception 'wedding_not_found' using errcode = 'P0002';
  end if;

  if p_kind = 'admin' then
    if not exists (
      select 1 from se_vezmou.wedding_admins a
       where a.id = p_subject_id and a.wedding_id = p_wedding_id and a.removed_at is null) then
      raise exception 'admin_not_found' using errcode = 'P0002';
    end if;
    update se_vezmou.wedding_admins a set last_login_at = pg_catalog.now() where a.id = p_subject_id;
  else
    if p_subject_id is not null or not v_wedding.guest_pin_enabled or v_wedding.status <> 'published' then
      raise exception 'guest_session_not_allowed' using errcode = '42501';
    end if;
  end if;

  insert into se_vezmou.sessions (token_hash, kind, wedding_id, subject_id, idle_seconds,
                               idle_expires_at, absolute_expires_at)
  values (p_token_hash, p_kind, p_wedding_id, p_subject_id, p_idle_seconds,
          pg_catalog.now() + pg_catalog.make_interval(secs => p_idle_seconds),
          pg_catalog.now() + pg_catalog.make_interval(secs => p_absolute_seconds))
  returning id into v_id;
  return v_id;
end
$$;

-- Ověření relace podle hashe tokenu. Čas poslední aktivity a klouzavé okno se zapisují nejvýše
-- jednou za session_touch_minutes, aby relace nezatěžovaly databázi. Neplatná relace = žádný řádek.
create function se_vezmou.auth_validate_session(p_token_hash bytea)
  returns table (session_id uuid, wedding_id uuid, kind text, subject_id uuid)
  language plpgsql volatile security definer set search_path = ''
  as $$
#variable_conflict use_column
declare
  s se_vezmou.sessions;
begin
  select * into s from se_vezmou.sessions x
   where x.token_hash = p_token_hash and x.revoked_at is null
     and x.idle_expires_at > pg_catalog.now() and x.absolute_expires_at > pg_catalog.now();
  if not found then
    return;
  end if;

  -- odebraný správce ani smazaná svatba relaci nepřežijí
  if not exists (select 1 from se_vezmou.weddings w where w.id = s.wedding_id and w.deleted_at is null) then
    return;
  end if;
  if s.kind = 'admin' and not exists (
       select 1 from se_vezmou.wedding_admins a
        where a.id = s.subject_id and a.wedding_id = s.wedding_id and a.removed_at is null) then
    return;
  end if;

  if s.last_seen_at < pg_catalog.now()
       - pg_catalog.make_interval(mins => se_vezmou.setting_int('session_touch_minutes', 5)) then
    update se_vezmou.sessions x
       set last_seen_at = pg_catalog.now(),
           idle_expires_at = least(pg_catalog.now() + pg_catalog.make_interval(secs => x.idle_seconds),
                                   x.absolute_expires_at)
     where x.id = s.id;
  end if;

  session_id := s.id;
  wedding_id := s.wedding_id;
  kind := s.kind;
  subject_id := s.subject_id;
  return next;
end
$$;

create function se_vezmou.auth_revoke_session(p_token_hash bytea) returns boolean
  language sql volatile security definer set search_path = ''
  as $$
  with r as (
    update se_vezmou.sessions s set revoked_at = pg_catalog.now()
     where s.token_hash = p_token_hash and s.revoked_at is null
    returning 1
  )
  select exists (select 1 from r)
$$;

-- Odvolání všech relací svatby nebo jen jednoho správce (odebrání správce, změna PINu).
create function se_vezmou.auth_revoke_sessions(p_wedding_id uuid, p_subject_id uuid default null)
  returns integer
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_count integer;
begin
  with r as (
    update se_vezmou.sessions s set revoked_at = pg_catalog.now()
     where s.wedding_id = p_wedding_id and s.revoked_at is null
       and (p_subject_id is null or s.subject_id = p_subject_id)
    returning 1
  )
  select count(*) into v_count from r;
  return v_count;
end
$$;

-- Výzva (kód z e-mailu): nová výzva zneplatní předchozí nespotřebované výzvy téhož účelu.
create function se_vezmou.auth_create_challenge(
  p_email_hash bytea,
  p_purpose text,
  p_code_hash bytea,
  p_ttl_seconds integer default 600
) returns uuid
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_id uuid;
begin
  if p_ttl_seconds < 1 or p_ttl_seconds > 3600 then
    raise exception 'invalid_challenge_ttl' using errcode = '22023';
  end if;
  update se_vezmou.login_challenges c set consumed_at = pg_catalog.now()
   where c.email_hash = p_email_hash and c.purpose = p_purpose and c.consumed_at is null;
  insert into se_vezmou.login_challenges (email_hash, purpose, code_hash, expires_at)
  values (p_email_hash, p_purpose, p_code_hash,
          pg_catalog.now() + pg_catalog.make_interval(secs => p_ttl_seconds))
  returning id into v_id;
  return v_id;
end
$$;

-- Ověření kódu: jednou použitelný, po p_max_attempts chybách se výzva zneplatní.
create function se_vezmou.auth_verify_challenge(
  p_email_hash bytea,
  p_purpose text,
  p_code_hash bytea,
  p_max_attempts smallint default 5
) returns boolean
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  c se_vezmou.login_challenges;
begin
  select * into c from se_vezmou.login_challenges x
   where x.email_hash = p_email_hash and x.purpose = p_purpose
     and x.consumed_at is null and x.expires_at > pg_catalog.now()
   order by x.created_at desc limit 1 for update;
  if not found then
    return false;
  end if;

  if c.attempts >= p_max_attempts then
    update se_vezmou.login_challenges x set consumed_at = pg_catalog.now() where x.id = c.id;
    return false;
  end if;

  if c.code_hash = p_code_hash then
    update se_vezmou.login_challenges x set consumed_at = pg_catalog.now() where x.id = c.id;
    return true;
  end if;

  update se_vezmou.login_challenges x
     set attempts = x.attempts + 1,
         consumed_at = case when x.attempts + 1 >= p_max_attempts then pg_catalog.now() end
   where x.id = c.id;
  return false;
end
$$;

-- Po ověření kódu: svatby, kde je e-mail aktivním správcem (svatby se určí až teď).
create function se_vezmou.auth_list_admin_weddings(p_email text)
  returns table (admin_id uuid, wedding_id uuid, slug text, status text)
  language sql stable security definer set search_path = ''
  as $$
  select a.id, w.id, w.slug, w.status
    from se_vezmou.wedding_admins a
    join se_vezmou.weddings w on w.id = a.wedding_id
   where lower(a.email::text) = lower(p_email) and a.removed_at is null and w.deleted_at is null
   order by w.created_at
$$;

revoke all on function
  se_vezmou.auth_create_session(text, uuid, uuid, bytea, integer, integer),
  se_vezmou.auth_validate_session(bytea),
  se_vezmou.auth_revoke_session(bytea),
  se_vezmou.auth_revoke_sessions(uuid, uuid),
  se_vezmou.auth_create_challenge(bytea, text, bytea, integer),
  se_vezmou.auth_verify_challenge(bytea, text, bytea, smallint),
  se_vezmou.auth_list_admin_weddings(text)
  from public, anon;
grant execute on function
  se_vezmou.auth_create_session(text, uuid, uuid, bytea, integer, integer),
  se_vezmou.auth_validate_session(bytea),
  se_vezmou.auth_revoke_session(bytea),
  se_vezmou.auth_revoke_sessions(uuid, uuid),
  se_vezmou.auth_create_challenge(bytea, text, bytea, integer),
  se_vezmou.auth_verify_challenge(bytea, text, bytea, smallint),
  se_vezmou.auth_list_admin_weddings(text)
  to service_role;
