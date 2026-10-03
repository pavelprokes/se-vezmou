-- Oprava 2/5 (revize kódu): zablokovaný web, souběh posledního majitele, stavy e-mailů, kolize adresy.
--
-- * Zablokovaný web (stav blocked, FR-OPS-2): správce ho nesmí smazat (obešel by blokaci), nelze pro něj vydat
--   relaci správce ani hosta a stávající relace přestanou platit. Operátorské relace jsou samostatná tabulka
--   (operator_sessions) a tím nejsou dotčené; operátor web dál vidí, obnoví nebo smaže.
-- * op_set_operator_disabled: zámek před kontrolou posledního majitele (souběh dvou zakázání).
-- * email_log_set_status: stav se jen zvyšuje (queued < failed < sent < delivered < bounced < complained),
--   pozdější volání bez kódu chyby kód nevymaže.
-- * wizard_create_draft: kolize adresy se pozná podle názvu omezení, jiné porušení unikátnosti se nevydává za
--   obsazenou adresu.

create or replace function se_vezmou.auth_create_session(
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
  -- zablokovaný web (FR-OPS-2): žádná nová relace správce ani hosta; operátorské relace jsou jinde
  if v_wedding.status = 'blocked' then
    raise exception 'wedding_blocked' using errcode = '55000';
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

create or replace function se_vezmou.auth_validate_session(p_token_hash bytea)
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
  -- zablokovaný web: stávající relace správce i hosta přestanou platit (operátorské relace to neovlivní)
  if not exists (select 1 from se_vezmou.weddings w
                  where w.id = s.wedding_id and w.deleted_at is null and w.status <> 'blocked') then
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

create or replace function se_vezmou.op_set_operator_disabled(
  p_owner_id uuid,
  p_target_id uuid,
  p_disabled boolean,
  p_reason text
) returns void
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  t se_vezmou.operators;
begin
  perform se_vezmou.assert_operator(p_owner_id, array['owner']);
  if char_length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  -- Souběžná zakázání dvou posledních majitelů by obě prošla kontrolou „je ještě jiný majitel“ a skončila
  -- bez aktivního majitele. Zámek na úrovni transakce je serializuje; kontrola níže už vidí potvrzený stav.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('se_vezmou.operators.owner_set'));
  select * into t from se_vezmou.operators x where x.id = p_target_id for update;
  if not found then
    raise exception 'operator_not_found' using errcode = 'P0002';
  end if;
  if p_target_id = p_owner_id then
    raise exception 'self_not_allowed' using errcode = '22023';
  end if;
  if p_disabled then
    if t.role = 'owner' and t.disabled_at is null and not exists (
         select 1 from se_vezmou.operators o
          where o.role = 'owner' and o.disabled_at is null and o.id <> t.id) then
      raise exception 'last_owner' using errcode = '55000';
    end if;
    update se_vezmou.operators x set disabled_at = coalesce(x.disabled_at, pg_catalog.now()) where x.id = t.id;
    update se_vezmou.operator_sessions s set revoked_at = pg_catalog.now()
     where s.operator_id = t.id and s.revoked_at is null;
  else
    update se_vezmou.operators x set disabled_at = null where x.id = t.id;
  end if;
  perform se_vezmou.write_audit('operator', p_owner_id, null,
    case when p_disabled then 'operator.disable' else 'operator.enable' end,
    'operator', t.id, p_reason, '{}'::jsonb);
end
$$;

create or replace function se_vezmou.wizard_create_draft(
  p_email text,
  p_backup_email text,
  p_slug text,
  p_draft jsonb,
  p_work jsonb
) returns table (ok boolean, wedding_id uuid, admin_id uuid, variants text[])
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  c_email_re constant text := '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_backup text := lower(btrim(coalesce(p_backup_email, '')));
  w jsonb := p_work -> 'wedding';
  v_id uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_starts date;
  v_until timestamptz;
  v_constraint text;
begin
  if char_length(v_email) > 254 or v_email !~ c_email_re
     or char_length(v_backup) > 254 or v_backup !~ c_email_re then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if v_email = v_backup then
    -- záložní e-mail slouží jako nezávislá cesta zpět; stejná adresa by nic nezajistila
    raise exception 'backup_email_same' using errcode = '22023';
  end if;
  if p_draft is null or jsonb_typeof(p_draft) <> 'object'
     or p_work is null or jsonb_typeof(w) is distinct from 'object' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  if not se_vezmou.slug_valid(p_slug) then
    raise exception 'invalid_slug' using errcode = '22023';
  end if;
  v_starts := nullif(w ->> 'startsOn', '')::date;

  -- uvolnění prošlých rezervací a nezveřejněných retired adres téhož slugu (jako reserve_slug)
  delete from se_vezmou.slug_registry sr
   where sr.slug = p_slug and sr.first_published_at is null
     and ((sr.state = 'reserved' and sr.reserved_until <= pg_catalog.now()) or sr.state = 'retired');

  if not se_vezmou.slug_available(p_slug) then
    return query select false, null::uuid, null::uuid, se_vezmou.slug_variants(p_slug, v_starts);
    return;
  end if;

  v_until := pg_catalog.now()
    + pg_catalog.make_interval(days => se_vezmou.setting_int('slug_reservation_days', 30));

  begin
    insert into se_vezmou.weddings (id, partner_a_name, partner_b_name)
    values (v_id, btrim(w ->> 'partnerA'), btrim(w ->> 'partnerB'));
    -- unikátní klíč adresy rozhoduje souběh dvou párů; prohra vrátí celý blok zpět
    insert into se_vezmou.slug_registry (slug, state, wedding_id, reserved_until)
    values (p_slug, 'reserved', v_id, v_until);
    update se_vezmou.weddings x set slug = p_slug where x.id = v_id;

    insert into se_vezmou.wedding_admins (id, wedding_id, email)
    values (v_admin, v_id, v_email::extensions.citext);
    insert into se_vezmou.wedding_auth (wedding_id, backup_email)
    values (v_id, v_backup::extensions.citext);
    insert into se_vezmou.orders (wedding_id) values (v_id);

    perform se_vezmou.wizard_apply(v_id, p_work);
    update se_vezmou.weddings x set wizard_draft = p_draft where x.id = v_id;
  exception when unique_violation then
    -- jen kolize ADRESY je „adresa obsazena“; porušení jiného klíče (např. uvnitř wizard_apply) je chyba
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint is distinct from 'slug_registry_pkey' and v_constraint is distinct from 'weddings_slug_key' then
      raise;
    end if;
    return query select false, null::uuid, null::uuid, se_vezmou.slug_variants(p_slug, v_starts);
    return;
  end;

  insert into se_vezmou.wedding_status_history (wedding_id, from_status, to_status, actor_type, actor_id)
  values (v_id, null, 'draft', 'admin', v_admin);
  perform se_vezmou.write_audit('admin', v_admin, v_id, 'wedding.created', 'wedding', v_id);

  return query select true, v_id, v_admin, '{}'::text[];
end
$$;

-- ---------------------------------------------------------------------------
-- email_log_set_status: monotónní stav a zachování kódu chyby
-- ---------------------------------------------------------------------------
create function se_vezmou.email_status_rank(p_status text) returns integer
  language sql immutable set search_path = ''
  as $$
  select case p_status
    when 'queued' then 0 when 'failed' then 1 when 'sent' then 2
    when 'delivered' then 3 when 'bounced' then 4 when 'complained' then 5 end
$$;

revoke all on function se_vezmou.email_status_rank(text) from public, anon, authenticated, service_role;

-- Vrací true, když záznam existuje (i když byl návrat do nižšího stavu ignorován: opakované a opožděné zprávy
-- poskytovatele jsou běžné, a nejsou chybou). Stejný stav lze potvrdit znovu (doplní id zprávy a kód chyby).
create or replace function se_vezmou.email_log_set_status(
  p_id uuid,
  p_status text,
  p_provider_message_id text default null,
  p_error_code text default null
) returns boolean
  language sql volatile security definer set search_path = ''
  as $$
  with cur as (
    select e.id, e.status from se_vezmou.email_log e where e.id = p_id for update
  ), u as (
    update se_vezmou.email_log e
       set status = p_status,
           provider_message_id = coalesce(p_provider_message_id, e.provider_message_id),
           error_code = coalesce(left(p_error_code, 100), e.error_code)
      from cur
     where e.id = cur.id
       -- neznámý stav (rank null) projde až k check omezení tabulky a skončí chybou jako dřív
       and (se_vezmou.email_status_rank(p_status) is null
            or se_vezmou.email_status_rank(p_status) >= se_vezmou.email_status_rank(cur.status))
    returning 1
  )
  select exists (select 1 from cur)
$$;

