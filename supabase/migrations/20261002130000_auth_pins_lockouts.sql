-- M4 / 1: PIN správy a PIN hostů, postupné pauzy (lockouts), kontext relace.
--
-- Zdroj: docs/security-privacy.md kap. 1.2, docs/adr/0010-rate-limiting.md, docs/data-model.md kap. 3.2.
-- Hashování PINu (argon2id + pepper) dělá aplikace; databáze drží hash, pauzy a pravidla kolem nich.
-- Všechny funkce jsou jen pro service_role (před ověřením i při nastavení PINu po ověření relace
-- na serveru). Pravidla jako u ostatních funkcí: set search_path = '', plně kvalifikované názvy.

-- Počet chyb v právě běžící sérii (po dosažení prahu série skončí pauzou a čítač se nuluje).
alter table public.lockouts add column failures smallint not null default 0;

-- ---------------------------------------------------------------------------
-- Pauzy: klíč je HMAC (scope + hodnota) z aplikace, v databázi tedy nejsou slugy ani IP.
-- ---------------------------------------------------------------------------
create function public.auth_lockout_state(p_bucket_key text)
  returns table (locked boolean, retry_after integer)
  language sql stable security definer set search_path = ''
  as $$
  select
    coalesce(l.locked_until > pg_catalog.now(), false),
    case when l.locked_until > pg_catalog.now()
      then greatest(1, ceil(extract(epoch from (l.locked_until - pg_catalog.now())))::integer)
      else 0
    end
  from (select 1) d
  left join public.lockouts l on l.bucket_key = p_bucket_key
$$;

-- Zaznamená chybu. Po p_threshold chybách v sérii nastaví pauzu p_base_seconds * 2^(level - 1)
-- nejvýše p_max_seconds a zvýší úroveň; v době pauzy se další chyby nepočítají. Úroveň se sama
-- vynuluje, když od konce poslední pauzy (nebo poslední chyby) uplyne p_max_seconds.
create function public.auth_lockout_failure(
  p_bucket_key text,
  p_threshold smallint default 5,
  p_base_seconds integer default 900,
  p_max_seconds integer default 86400
) returns table (locked boolean, retry_after integer, level smallint, newly_locked boolean)
  language plpgsql volatile security definer set search_path = ''
  as $$
#variable_conflict use_column
declare
  r public.lockouts;
  v_failures smallint;
  v_level smallint;
  v_secs integer;
begin
  if p_bucket_key is null or p_bucket_key = '' or p_threshold < 1
     or p_base_seconds < 1 or p_max_seconds < p_base_seconds then
    raise exception 'invalid_lockout_arguments' using errcode = '22023';
  end if;

  insert into public.lockouts (bucket_key) values (p_bucket_key) on conflict (bucket_key) do nothing;
  select * into r from public.lockouts x where x.bucket_key = p_bucket_key for update;

  if r.locked_until is not null and r.locked_until > pg_catalog.now() then
    return query select true,
      greatest(1, ceil(extract(epoch from (r.locked_until - pg_catalog.now())))::integer),
      r.level, false;
    return;
  end if;

  v_level := r.level;
  v_failures := r.failures;
  if v_level > 0
     and greatest(coalesce(r.locked_until, r.updated_at), r.updated_at)
         < pg_catalog.now() - pg_catalog.make_interval(secs => p_max_seconds) then
    v_level := 0;
    v_failures := 0;
  end if;

  v_failures := v_failures + 1;
  if v_failures >= p_threshold then
    v_level := least(v_level + 1, 30);
    v_secs := least(p_max_seconds::numeric,
                    p_base_seconds::numeric * power(2, v_level - 1))::integer;
    update public.lockouts x
       set level = v_level, failures = 0,
           locked_until = pg_catalog.now() + pg_catalog.make_interval(secs => v_secs)
     where x.bucket_key = p_bucket_key;
    return query select true, v_secs, v_level, true;
  else
    update public.lockouts x
       set level = v_level, failures = v_failures
     where x.bucket_key = p_bucket_key;
    return query select false, 0, v_level, false;
  end if;
end
$$;

-- Po úspěšném ověření: série i úroveň se nulují.
create function public.auth_lockout_reset(p_bucket_key text) returns void
  language sql volatile security definer set search_path = ''
  as $$ delete from public.lockouts l where l.bucket_key = p_bucket_key $$;

-- ---------------------------------------------------------------------------
-- PIN: čtení pro ověření, nastavení
-- ---------------------------------------------------------------------------

-- Hash PINu pro ověření podle slugu. Neexistující svatba, svatba bez PINu, smazaná svatba,
-- svatba bez správce (admin) i vypnutý PIN hostů dávají stejný výsledek: žádný řádek.
-- U PINu správy se relace vede na nejstaršího aktivního správce (PIN je jeden na svatbu).
create function public.auth_pin_get(p_slug text, p_role text)
  returns table (wedding_id uuid, admin_id uuid, pin_hash text, backup_email text)
  language sql stable security definer set search_path = ''
  as $$
  select w.id,
         case when p_role = 'admin' then
           (select a.id from public.wedding_admins a
             where a.wedding_id = w.id and a.removed_at is null
             order by a.added_at, a.id limit 1)
         end,
         case when p_role = 'admin' then wa.admin_pin_hash else wa.guest_pin_hash end,
         wa.backup_email::text
    from public.weddings w
    join public.wedding_auth wa on wa.wedding_id = w.id
   where p_role in ('admin', 'guest')
     and w.slug = p_slug and w.deleted_at is null
     and case p_role
           when 'admin' then
             wa.admin_pin_hash is not null
             and exists (select 1 from public.wedding_admins a
                          where a.wedding_id = w.id and a.removed_at is null)
           else
             wa.guest_pin_hash is not null and w.guest_pin_enabled and w.status = 'published'
         end
$$;

-- Hash druhého PINu téže svatby: aplikace s ním při nastavení porovná nový PIN (společný PIN
-- pro obě role je zakázán). Hash je solený, proto porovnání nejde provést v SQL.
create function public.auth_pin_other_hash(p_wedding_id uuid, p_role text) returns text
  language sql stable security definer set search_path = ''
  as $$
  select case p_role when 'admin' then wa.guest_pin_hash when 'guest' then wa.admin_pin_hash end
    from public.wedding_auth wa where wa.wedding_id = p_wedding_id
$$;

-- Nastavení nebo změna PINu (volá server po ověření relace správce). Odvolá relace dotčené role
-- (kromě aktuální) a zapíše audit bez hodnoty. Vrací záložní e-mail pro oznámení o změně.
create function public.auth_pin_set(
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
  update public.wedding_auth wa
     set admin_pin_hash = case when p_role = 'admin' then p_hash else wa.admin_pin_hash end,
         guest_pin_hash = case when p_role = 'guest' then p_hash else wa.guest_pin_hash end
   where wa.wedding_id = p_wedding_id
  returning wa.backup_email::text into v_backup;
  if not found then
    raise exception 'wedding_auth_missing' using errcode = 'P0002';
  end if;

  update public.sessions s set revoked_at = pg_catalog.now()
   where s.wedding_id = p_wedding_id and s.revoked_at is null
     and s.kind = case p_role when 'admin' then 'admin' else 'guest_pin' end
     and (p_keep_session_id is null or s.id <> p_keep_session_id);

  perform app.write_audit(
    case when p_actor_admin_id is null then 'system' else 'admin' end,
    p_actor_admin_id, p_wedding_id, 'pin.change', 'wedding', p_wedding_id, null,
    jsonb_build_object('role', p_role));
  return v_backup;
end
$$;

-- Přehled pro obrazovku po přihlášení (jen pro server po ověření relace).
create function public.auth_session_context(p_wedding_id uuid)
  returns table (slug text, status text, partner_a_name text, partner_b_name text)
  language sql stable security definer set search_path = ''
  as $$
  select w.slug, w.status, w.partner_a_name, w.partner_b_name
    from public.weddings w where w.id = p_wedding_id and w.deleted_at is null
$$;

revoke all on function
  public.auth_lockout_state(text),
  public.auth_lockout_failure(text, smallint, integer, integer),
  public.auth_lockout_reset(text),
  public.auth_pin_get(text, text),
  public.auth_pin_other_hash(uuid, text),
  public.auth_pin_set(uuid, text, text, uuid, uuid),
  public.auth_session_context(uuid)
  from public, anon;
grant execute on function
  public.auth_lockout_state(text),
  public.auth_lockout_failure(text, smallint, integer, integer),
  public.auth_lockout_reset(text),
  public.auth_pin_get(text, text),
  public.auth_pin_other_hash(uuid, text),
  public.auth_pin_set(uuid, text, text, uuid, uuid),
  public.auth_session_context(uuid)
  to service_role;
