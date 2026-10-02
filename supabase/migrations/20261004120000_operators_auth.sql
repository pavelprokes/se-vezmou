-- M9 / 1: přihlášení operátorů bez Supabase Auth (docs/adr/0012): relace, druhý faktor TOTP, záložní kódy.
--
-- Operátoři se přihlašují vlastním kódem z e-mailu (výzvy `login_challenges`, účel `operator_login`) a povinným
-- druhým faktorem TOTP (RFC 6238). Tajný klíč TOTP šifruje aplikace (AES-256-GCM, klíč OPERATOR_MFA_KEY),
-- databáze drží jen šifrový text. Záložní kódy jsou v tabulce `operator_backup_codes` jako HMAC.
-- Vše je ve schématu se_vezmou; funkce `auth_operator_*` volá server (service_role) před ověřením relace
-- operátora a po něm, operátor sám žádná práva k tabulkám nemá.

-- ---------------------------------------------------------------------------
-- operators: vlastní identita (bez dodavatele přihlášení) a stav druhého faktoru
-- ---------------------------------------------------------------------------
-- auth_user_id zůstává kvůli kompatibilitě schématu (unikátní, povinné), ale už ho nikdo nedodává:
-- hodnotu si doplní databáze.
alter table se_vezmou.operators alter column auth_user_id set default gen_random_uuid();

alter table se_vezmou.operators
  -- šifrový text (base64url) tajného klíče TOTP; bez potvrzení (totp_confirmed_at) je to jen rozepsaný zápis
  add column totp_secret_enc text,
  add column totp_confirmed_at timestamptz,
  -- poslední použitý časový krok TOTP (ochrana proti opakovanému použití téhož kódu)
  add column totp_last_step bigint,
  add column last_login_at timestamptz,
  add constraint operators_totp_confirmed_has_secret
    check (totp_confirmed_at is null or totp_secret_enc is not null);

-- ---------------------------------------------------------------------------
-- Povolené účely výzev a typy e-mailů (rozšíření uzavřených seznamů)
-- ---------------------------------------------------------------------------
alter table se_vezmou.login_challenges drop constraint login_challenges_purpose_check;
alter table se_vezmou.login_challenges add constraint login_challenges_purpose_check
  check (purpose in ('admin_login', 'admin_add_confirm', 'operator_recovery', 'wizard_create', 'operator_login'));

alter table se_vezmou.email_log drop constraint email_log_type_check;
alter table se_vezmou.email_log add constraint email_log_type_check
  check (type in ('login_code', 'rsvp_confirmation', 'admin_changed', 'backup_login_notice', 'expiry_notice',
                  'operator_notice'));

-- ---------------------------------------------------------------------------
-- auth_operator_find: aktivní operátor podle e-mailu (před ověřením kódu).
-- Server volá vždy, i pro neznámý e-mail; odpověď uživateli je stejná.
-- ---------------------------------------------------------------------------
create function se_vezmou.auth_operator_find(p_email text)
  returns table (operator_id uuid, role text, totp_confirmed boolean)
  language sql stable security definer set search_path = ''
  as $$
  select o.id, o.role, o.totp_confirmed_at is not null
    from se_vezmou.operators o
   where lower(o.email::text) = lower(p_email) and o.disabled_at is null
$$;

-- ---------------------------------------------------------------------------
-- Relace operátora (kap. 3.6): nečinnost a absolutní doba určuje aplikace (30 minut a 8 hodin).
-- Po ověření e-mailovým kódem vzniká relace s aal2_verified_at = null (úroveň AAL1); operátorské
-- rozhraní a zásahy vyžadují AAL2 (nastaví ho až druhý faktor).
-- ---------------------------------------------------------------------------
create function se_vezmou.auth_operator_create_session(
  p_operator_id uuid,
  p_token_hash bytea,
  p_idle_seconds integer,
  p_absolute_seconds integer
) returns uuid
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_id uuid;
begin
  if p_idle_seconds < 1 or p_absolute_seconds < p_idle_seconds then
    raise exception 'invalid_session_arguments' using errcode = '22023';
  end if;
  if not exists (select 1 from se_vezmou.operators o where o.id = p_operator_id and o.disabled_at is null) then
    raise exception 'operator_not_found' using errcode = 'P0002';
  end if;
  insert into se_vezmou.operator_sessions (token_hash, operator_id, idle_seconds, idle_expires_at, absolute_expires_at)
  values (p_token_hash, p_operator_id, p_idle_seconds,
          pg_catalog.now() + pg_catalog.make_interval(secs => p_idle_seconds),
          pg_catalog.now() + pg_catalog.make_interval(secs => p_absolute_seconds))
  returning id into v_id;
  return v_id;
end
$$;

-- Ověření relace podle hashe tokenu. Klouzavé okno nečinnosti se posouvá nejvýše jednou za minutu
-- (u 30minutové nečinnosti nesmí být prodlužování hrubší). Zakázaný operátor relaci nepřežije.
create function se_vezmou.auth_operator_validate_session(p_token_hash bytea)
  returns table (session_id uuid, operator_id uuid, email text, role text, aal2 boolean, totp_confirmed boolean)
  language plpgsql volatile security definer set search_path = ''
  as $$
#variable_conflict use_column
declare
  s se_vezmou.operator_sessions;
  o se_vezmou.operators;
begin
  select * into s from se_vezmou.operator_sessions x
   where x.token_hash = p_token_hash and x.revoked_at is null
     and x.idle_expires_at > pg_catalog.now() and x.absolute_expires_at > pg_catalog.now();
  if not found then
    return;
  end if;
  select * into o from se_vezmou.operators y where y.id = s.operator_id and y.disabled_at is null;
  if not found then
    return;
  end if;

  if s.last_seen_at < pg_catalog.now() - interval '1 minute' then
    update se_vezmou.operator_sessions x
       set last_seen_at = pg_catalog.now(),
           idle_expires_at = least(pg_catalog.now() + pg_catalog.make_interval(secs => x.idle_seconds),
                                   x.absolute_expires_at)
     where x.id = s.id;
  end if;

  session_id := s.id;
  operator_id := o.id;
  email := o.email::text;
  role := o.role;
  aal2 := s.aal2_verified_at is not null;
  totp_confirmed := o.totp_confirmed_at is not null;
  return next;
end
$$;

create function se_vezmou.auth_operator_revoke_session(p_token_hash bytea) returns boolean
  language sql volatile security definer set search_path = ''
  as $$
  with r as (
    update se_vezmou.operator_sessions s set revoked_at = pg_catalog.now()
     where s.token_hash = p_token_hash and s.revoked_at is null
    returning 1
  )
  select exists (select 1 from r)
$$;

-- ---------------------------------------------------------------------------
-- Druhý faktor: stav a zápis (první přihlášení)
-- ---------------------------------------------------------------------------
create function se_vezmou.auth_operator_mfa_get(p_operator_id uuid)
  returns table (secret_enc text, confirmed boolean, last_step bigint)
  language sql stable security definer set search_path = ''
  as $$
  select o.totp_secret_enc, o.totp_confirmed_at is not null, o.totp_last_step
    from se_vezmou.operators o
   where o.id = p_operator_id and o.disabled_at is null
$$;

-- Rozepsaný zápis: uloží šifrovaný klíč, jen když zatím žádný není, a vrátí uložený (opakované
-- otevření stránky tedy ukáže tentýž klíč, dokud ho operátor nepotvrdí). Potvrzený faktor se
-- tímto nepřepíše; změna jde jen přes obnovu majitelem.
create function se_vezmou.auth_operator_mfa_begin(p_operator_id uuid, p_secret_enc text) returns text
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  o se_vezmou.operators;
begin
  if p_secret_enc is null or char_length(p_secret_enc) < 20 then
    raise exception 'invalid_secret' using errcode = '22023';
  end if;
  select * into o from se_vezmou.operators x where x.id = p_operator_id and x.disabled_at is null for update;
  if not found then
    raise exception 'operator_not_found' using errcode = 'P0002';
  end if;
  if o.totp_confirmed_at is not null then
    raise exception 'mfa_already_enrolled' using errcode = '55000';
  end if;
  if o.totp_secret_enc is null then
    update se_vezmou.operators x set totp_secret_enc = p_secret_enc where x.id = p_operator_id;
    return p_secret_enc;
  end if;
  return o.totp_secret_enc;
end
$$;

-- Potvrzení zápisu: aplikace ověřila kód z aplikace (p_step je jeho časový krok). Uloží záložní kódy
-- (HMAC, desítky bajtů; stará sada se nahradí), povýší relaci na AAL2 a zapíše audit.
create function se_vezmou.auth_operator_mfa_confirm(
  p_operator_id uuid,
  p_session_id uuid,
  p_step bigint,
  p_backup_hashes bytea[]
) returns boolean
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  o se_vezmou.operators;
begin
  if coalesce(array_length(p_backup_hashes, 1), 0) < 1 then
    raise exception 'backup_codes_required' using errcode = '22023';
  end if;
  select * into o from se_vezmou.operators x where x.id = p_operator_id and x.disabled_at is null for update;
  if not found then
    raise exception 'operator_not_found' using errcode = 'P0002';
  end if;
  if o.totp_confirmed_at is not null or o.totp_secret_enc is null then
    return false;
  end if;
  if not exists (select 1 from se_vezmou.operator_sessions s
                  where s.id = p_session_id and s.operator_id = p_operator_id and s.revoked_at is null
                    and s.idle_expires_at > pg_catalog.now() and s.absolute_expires_at > pg_catalog.now()) then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;

  update se_vezmou.operators x
     set totp_confirmed_at = pg_catalog.now(), totp_last_step = p_step, last_login_at = pg_catalog.now()
   where x.id = p_operator_id;
  delete from se_vezmou.operator_backup_codes b where b.operator_id = p_operator_id;
  insert into se_vezmou.operator_backup_codes (operator_id, code_hash)
  select p_operator_id, h from unnest(p_backup_hashes) as h
  on conflict do nothing;
  update se_vezmou.operator_sessions s set aal2_verified_at = pg_catalog.now() where s.id = p_session_id;
  perform se_vezmou.write_audit('operator', p_operator_id, null, 'operator.mfa_enrolled', 'operator', p_operator_id,
    null, jsonb_build_object('backup_codes', cardinality(p_backup_hashes)));
  perform se_vezmou.write_audit('operator', p_operator_id, null, 'operator.login', 'operator', p_operator_id,
    null, jsonb_build_object('method', 'enrollment'));
  return true;
end
$$;

-- Přijetí kódu z aplikace TOTP (ověřil ho server). Každý časový krok jde použít jednou: souběžné
-- nebo opakované použití téhož kódu `update` odmítne (nulový počet řádků).
create function se_vezmou.auth_operator_mfa_accept(p_operator_id uuid, p_session_id uuid, p_step bigint)
  returns boolean
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_rows integer;
begin
  if not exists (select 1 from se_vezmou.operator_sessions s
                  where s.id = p_session_id and s.operator_id = p_operator_id and s.revoked_at is null
                    and s.idle_expires_at > pg_catalog.now() and s.absolute_expires_at > pg_catalog.now()) then
    return false;
  end if;
  update se_vezmou.operators o
     set totp_last_step = p_step, last_login_at = pg_catalog.now()
   where o.id = p_operator_id and o.disabled_at is null and o.totp_confirmed_at is not null
     and (o.totp_last_step is null or o.totp_last_step < p_step);
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return false;
  end if;
  update se_vezmou.operator_sessions s set aal2_verified_at = pg_catalog.now() where s.id = p_session_id;
  perform se_vezmou.write_audit('operator', p_operator_id, null, 'operator.login', 'operator', p_operator_id,
    null, jsonb_build_object('method', 'totp'));
  return true;
end
$$;

-- Záložní kód: jednorázový, hash je HMAC. Vrací počet zbývajících kódů, nebo -1 pro neplatný či
-- už použitý kód. Použití je v auditu (a aplikace ho oznámí e-mailem operátorovi).
create function se_vezmou.auth_operator_use_backup_code(p_operator_id uuid, p_session_id uuid, p_code_hash bytea)
  returns integer
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_rows integer;
  v_left integer;
begin
  if not exists (select 1 from se_vezmou.operator_sessions s
                  where s.id = p_session_id and s.operator_id = p_operator_id and s.revoked_at is null
                    and s.idle_expires_at > pg_catalog.now() and s.absolute_expires_at > pg_catalog.now())
     or not exists (select 1 from se_vezmou.operators o
                     where o.id = p_operator_id and o.disabled_at is null and o.totp_confirmed_at is not null) then
    return -1;
  end if;
  update se_vezmou.operator_backup_codes b set used_at = pg_catalog.now()
   where b.operator_id = p_operator_id and b.code_hash = p_code_hash and b.used_at is null;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return -1;
  end if;
  select count(*) into v_left from se_vezmou.operator_backup_codes b
   where b.operator_id = p_operator_id and b.used_at is null;
  update se_vezmou.operators o set last_login_at = pg_catalog.now() where o.id = p_operator_id;
  update se_vezmou.operator_sessions s set aal2_verified_at = pg_catalog.now() where s.id = p_session_id;
  perform se_vezmou.write_audit('operator', p_operator_id, null, 'operator.backup_code_used', 'operator',
    p_operator_id, null, jsonb_build_object('remaining', v_left));
  perform se_vezmou.write_audit('operator', p_operator_id, null, 'operator.login', 'operator', p_operator_id,
    null, jsonb_build_object('method', 'backup_code'));
  return v_left;
end
$$;

-- Počet nepoužitých záložních kódů (stránka účtu).
create function se_vezmou.auth_operator_backup_codes_left(p_operator_id uuid) returns integer
  language sql stable security definer set search_path = ''
  as $$
  select count(*)::integer from se_vezmou.operator_backup_codes b
   where b.operator_id = p_operator_id and b.used_at is null
$$;

-- Nová sada záložních kódů pro sebe (po ověření AAL2 na serveru): stará sada se zneplatní.
create function se_vezmou.auth_operator_regenerate_backup_codes(p_operator_id uuid, p_backup_hashes bytea[])
  returns integer
  language plpgsql volatile security definer set search_path = ''
  as $$
begin
  if coalesce(array_length(p_backup_hashes, 1), 0) < 1 then
    raise exception 'backup_codes_required' using errcode = '22023';
  end if;
  if not exists (select 1 from se_vezmou.operators o
                  where o.id = p_operator_id and o.disabled_at is null and o.totp_confirmed_at is not null) then
    raise exception 'operator_not_found' using errcode = 'P0002';
  end if;
  delete from se_vezmou.operator_backup_codes b where b.operator_id = p_operator_id;
  insert into se_vezmou.operator_backup_codes (operator_id, code_hash)
  select p_operator_id, h from unnest(p_backup_hashes) as h
  on conflict do nothing;
  perform se_vezmou.write_audit('operator', p_operator_id, null, 'operator.backup_codes_regenerated', 'operator',
    p_operator_id, null, jsonb_build_object('backup_codes', cardinality(p_backup_hashes)));
  return cardinality(p_backup_hashes);
end
$$;

revoke all on function
  se_vezmou.auth_operator_find(text),
  se_vezmou.auth_operator_create_session(uuid, bytea, integer, integer),
  se_vezmou.auth_operator_validate_session(bytea),
  se_vezmou.auth_operator_revoke_session(bytea),
  se_vezmou.auth_operator_mfa_get(uuid),
  se_vezmou.auth_operator_mfa_begin(uuid, text),
  se_vezmou.auth_operator_mfa_confirm(uuid, uuid, bigint, bytea[]),
  se_vezmou.auth_operator_mfa_accept(uuid, uuid, bigint),
  se_vezmou.auth_operator_use_backup_code(uuid, uuid, bytea),
  se_vezmou.auth_operator_backup_codes_left(uuid),
  se_vezmou.auth_operator_regenerate_backup_codes(uuid, bytea[])
  from public, anon, authenticated;

grant execute on function
  se_vezmou.auth_operator_find(text),
  se_vezmou.auth_operator_create_session(uuid, bytea, integer, integer),
  se_vezmou.auth_operator_validate_session(bytea),
  se_vezmou.auth_operator_revoke_session(bytea),
  se_vezmou.auth_operator_mfa_get(uuid),
  se_vezmou.auth_operator_mfa_begin(uuid, text),
  se_vezmou.auth_operator_mfa_confirm(uuid, uuid, bigint, bytea[]),
  se_vezmou.auth_operator_mfa_accept(uuid, uuid, bigint),
  se_vezmou.auth_operator_use_backup_code(uuid, uuid, bytea),
  se_vezmou.auth_operator_backup_codes_left(uuid),
  se_vezmou.auth_operator_regenerate_backup_codes(uuid, bytea[])
  to service_role;
