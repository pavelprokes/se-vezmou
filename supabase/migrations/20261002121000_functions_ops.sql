-- M3 / 11: operátorská cesta (op_*, audit v téže transakci), retence a mazání (purge_*),
-- výmaz hosta, úklid. Zdroj: docs/data-model.md kap. 3.6, 5.5, 10, 11; docs/security-privacy.md kap. 5 až 7.
--
-- Operátor nemá politiky na žádné tabulce. Server (service role) po ověření relace operátora
-- a druhého faktoru volá funkce op_* s p_operator_id; každá ověří operators.role a disabled_at
-- a zapíše audit_log v téže transakci, takže zásah bez záznamu technicky nevznikne.
-- Rozsah op_* viz TODO M9 v migraci 20261002120800_functions_core.sql.

-- ---------------------------------------------------------------------------
-- Kontrola operátora (interní): vrací roli nebo vyvolá chybu 42501
-- ---------------------------------------------------------------------------
create function app.assert_operator(p_operator_id uuid, p_roles text[]) returns text
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_role text;
begin
  select o.role into v_role from public.operators o
   where o.id = p_operator_id and o.disabled_at is null;
  if v_role is null or not (v_role = any (p_roles)) then
    raise exception 'operator_forbidden' using errcode = '42501';
  end if;
  return v_role;
end
$$;

revoke all on function app.assert_operator(uuid, text[]) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- op_set_wedding_status: změna uloženého stavu (blokace, smazání, obnova, archivace...)
-- ---------------------------------------------------------------------------
create function public.op_set_wedding_status(
  p_operator_id uuid,
  p_wedding_id uuid,
  p_status text,
  p_reason text
) returns void
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_old text;
begin
  perform app.assert_operator(p_operator_id, array['owner', 'support']);
  if p_status not in ('draft', 'pending_payment', 'published', 'archived', 'deleted', 'blocked') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  select w.status into v_old from public.weddings w where w.id = p_wedding_id for update;
  if not found then
    raise exception 'wedding_not_found' using errcode = 'P0002';
  end if;
  if v_old = p_status then
    return;
  end if;

  update public.weddings w set status = p_status where w.id = p_wedding_id;
  insert into public.wedding_status_history (wedding_id, from_status, to_status, actor_type, actor_id, reason)
  values (p_wedding_id, v_old, p_status, 'operator', p_operator_id, p_reason);
  perform app.write_audit('operator', p_operator_id, p_wedding_id, 'wedding.status_change',
    'wedding', p_wedding_id, p_reason, jsonb_build_object('from_status', v_old, 'to_status', p_status));
end
$$;

-- ---------------------------------------------------------------------------
-- op_view_guest_data: údaje hostů jen při aktivním data_access_grants (souhlas páru).
-- Bez grantu funkce nevrátí nic a zapíše pokus do auditu. Důvod je povinný.
-- TODO M9: oznámení správcům o nahlédnutí.
-- ---------------------------------------------------------------------------
create function public.op_view_guest_data(p_operator_id uuid, p_wedding_id uuid, p_reason text)
  returns table (
    household_label text, guest_id uuid, display_name text, is_child boolean, age smallint,
    is_plus_one boolean, diet text, allergies text
  )
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_grant uuid;
  v_count integer;
begin
  perform app.assert_operator(p_operator_id, array['owner', 'support']);
  if char_length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  select g.id into v_grant from public.data_access_grants g
   where g.wedding_id = p_wedding_id and g.scope = 'guest_data'
     and g.revoked_at is null and g.expires_at > pg_catalog.now()
   order by g.expires_at desc limit 1;

  if v_grant is null then
    perform app.write_audit('operator', p_operator_id, p_wedding_id, 'guest_data.view_denied',
      'wedding', p_wedding_id, p_reason, '{}'::jsonb);
    return;
  end if;

  select count(*) into v_count from public.guests g where g.wedding_id = p_wedding_id;
  perform app.write_audit('operator', p_operator_id, p_wedding_id, 'guest_data.view',
    'data_access_grant', v_grant, p_reason, jsonb_build_object('guests', v_count));

  return query
    select h.label, g.id, g.display_name, g.is_child, g.age, g.is_plus_one,
           (select string_agg(rh.diet, '; ') from public.rsvp_people rp
              join public.rsvp_health rh on rh.person_id = rp.id and rh.wedding_id = rp.wedding_id
             where rp.guest_id = g.id and rp.wedding_id = g.wedding_id and rh.diet is not null),
           (select string_agg(rh.allergies, '; ') from public.rsvp_people rp
              join public.rsvp_health rh on rh.person_id = rp.id and rh.wedding_id = rp.wedding_id
             where rp.guest_id = g.id and rp.wedding_id = g.wedding_id and rh.allergies is not null)
      from public.guests g
      join public.households h on h.id = g.household_id and h.wedding_id = g.wedding_id
     where g.wedding_id = p_wedding_id
     order by h.label, g.display_name;
end
$$;

-- ---------------------------------------------------------------------------
-- op_set_app_setting: zápis nastavení jen majitel, s auditem
-- ---------------------------------------------------------------------------
create function public.op_set_app_setting(p_operator_id uuid, p_key text, p_value jsonb) returns void
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_old jsonb;
begin
  perform app.assert_operator(p_operator_id, array['owner']);

  select s.value into v_old from public.app_settings s where s.key = p_key for update;
  if not found then
    raise exception 'unknown_setting' using errcode = '22023';
  end if;

  -- číselná nastavení musí být kladná čísla; max_admins nejvýše tvrdý strop 5
  if p_key = 'rsvp_match_threshold' then
    if jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric not between 0.1 and 1 then
      raise exception 'invalid_setting_value' using errcode = '22023';
    end if;
  elsif jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric < 1
        or (p_value #>> '{}')::numeric <> trunc((p_value #>> '{}')::numeric) then
    raise exception 'invalid_setting_value' using errcode = '22023';
  elsif p_key = 'max_admins' and (p_value #>> '{}')::numeric > 5 then
    raise exception 'invalid_setting_value' using errcode = '22023';
  end if;

  update public.app_settings s set value = p_value, updated_by = p_operator_id where s.key = p_key;
  perform app.write_audit('operator', p_operator_id, null, 'app_settings.update', 'app_setting', null,
    null, jsonb_build_object('setting_key', p_key, 'old_value', v_old, 'new_value', p_value));
end
$$;

-- ---------------------------------------------------------------------------
-- Retence (kap. 10). Funkce jsou idempotentní, berou dávky, drží advisory lock a do auditu
-- zapisují jen počty řádků (retention.purge, bez osobních údajů). Volá je cron (service role).
-- ---------------------------------------------------------------------------

-- Dietní a alergické údaje: tvrdé smazání po health_purge_at.
create function public.purge_health_data(p_batch integer default 100) returns integer
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding record;
  v_rows integer;
  v_total integer := 0;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('purge_health_data')) then
    return 0;
  end if;
  for v_wedding in
    select w.id from public.weddings w
     where w.health_purge_at is not null and w.health_purge_at <= pg_catalog.now()
       and exists (select 1 from public.rsvp_health h where h.wedding_id = w.id)
     order by w.health_purge_at limit p_batch
  loop
    with d as (delete from public.rsvp_health h where h.wedding_id = v_wedding.id returning 1)
    select count(*) into v_rows from d;
    v_total := v_total + v_rows;
    perform app.write_audit('system', null, v_wedding.id, 'retention.purge', 'wedding', v_wedding.id,
      null, jsonb_build_object('kind', 'health', 'rows', v_rows));
  end loop;
  return v_total;
end
$$;

-- Ostatní údaje hostů: tvrdé smazání po guest_purge_at v pořadí závislostí.
create function public.purge_guest_data(p_batch integer default 100) returns integer
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding record;
  v_rows integer;
  v_wedding_rows integer;
  v_total integer := 0;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('purge_guest_data')) then
    return 0;
  end if;
  for v_wedding in
    select w.id from public.weddings w
     where w.guest_purge_at is not null and w.guest_purge_at <= pg_catalog.now()
       and exists (select 1 from public.households h where h.wedding_id = w.id)
     order by w.guest_purge_at limit p_batch
  loop
    v_wedding_rows := 0;
    with d as (delete from public.rsvp_tickets t where t.wedding_id = v_wedding.id returning 1)
      select count(*) into v_rows from d;
    v_wedding_rows := v_wedding_rows + v_rows;
    with d as (delete from public.rsvp_attendance a where a.wedding_id = v_wedding.id returning 1)
      select count(*) into v_rows from d;
    v_wedding_rows := v_wedding_rows + v_rows;
    with d as (delete from public.rsvp_health h where h.wedding_id = v_wedding.id returning 1)
      select count(*) into v_rows from d;
    v_wedding_rows := v_wedding_rows + v_rows;
    with d as (delete from public.rsvp_people p where p.wedding_id = v_wedding.id returning 1)
      select count(*) into v_rows from d;
    v_wedding_rows := v_wedding_rows + v_rows;
    with d as (delete from public.rsvp_responses r where r.wedding_id = v_wedding.id returning 1)
      select count(*) into v_rows from d;
    v_wedding_rows := v_wedding_rows + v_rows;
    with d as (delete from public.invitations i where i.wedding_id = v_wedding.id returning 1)
      select count(*) into v_rows from d;
    v_wedding_rows := v_wedding_rows + v_rows;
    with d as (delete from public.guests g where g.wedding_id = v_wedding.id returning 1)
      select count(*) into v_rows from d;
    v_wedding_rows := v_wedding_rows + v_rows;
    with d as (delete from public.households h where h.wedding_id = v_wedding.id returning 1)
      select count(*) into v_rows from d;
    v_wedding_rows := v_wedding_rows + v_rows;

    v_total := v_total + v_wedding_rows;
    perform app.write_audit('system', null, v_wedding.id, 'retention.purge', 'wedding', v_wedding.id,
      null, jsonb_build_object('kind', 'guests', 'rows', v_wedding_rows));
  end loop;
  return v_total;
end
$$;

-- Tvrdé smazání zakázky po měkkém smazání (stav deleted a uplynulé purge_at).
-- Zveřejněná adresa přejde do retired a nikdy se znovu nepřidělí; nezveřejněná rezervace se uvolní.
-- Vrací počty a cesty souborů v úložišti ke smazání (TODO M10: smazání souborů a napojení cronu).
create function public.purge_wedding(p_wedding_id uuid) returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  w public.weddings;
  v_paths text[];
  v_counts jsonb;
begin
  select * into w from public.weddings x where x.id = p_wedding_id for update;
  if not found then
    raise exception 'wedding_not_found' using errcode = 'P0002';
  end if;
  if w.status <> 'deleted' or w.purge_at is null or w.purge_at > pg_catalog.now() then
    raise exception 'wedding_not_purgeable' using errcode = '55000';
  end if;

  select coalesce(array_agg(m.storage_path), '{}') into v_paths
    from public.media m where m.wedding_id = p_wedding_id;

  v_counts := jsonb_build_object(
    'kind', 'wedding',
    'guests', (select count(*) from public.guests g where g.wedding_id = p_wedding_id),
    'blocks', (select count(*) from public.content_blocks b where b.wedding_id = p_wedding_id),
    'media', coalesce(array_length(v_paths, 1), 0));

  -- adresa: zveřejněná zůstane trvale blokovaná (retired), rezervace konceptu se uvolní
  update public.slug_registry sr set state = 'retired', reserved_until = null
   where sr.wedding_id = p_wedding_id and sr.state = 'active';
  delete from public.slug_registry sr where sr.wedding_id = p_wedding_id and sr.state = 'reserved';

  -- ostatní tabulky odstraní kaskáda cizích klíčů; audit přežije (wedding_id bez cizího klíče)
  delete from public.weddings x where x.id = p_wedding_id;
  perform app.write_audit('system', null, p_wedding_id, 'retention.purge', 'wedding', p_wedding_id,
    null, v_counts);

  return v_counts || jsonb_build_object('storage_paths', to_jsonb(v_paths));
end
$$;

-- Smazání všech zakázek, jejichž ochranná lhůta uplynula (denní cron).
create function public.purge_deleted_weddings(p_batch integer default 20) returns integer
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('purge_deleted_weddings')) then
    return 0;
  end if;
  for v_id in
    select w.id from public.weddings w
     where w.status = 'deleted' and w.purge_at is not null and w.purge_at <= pg_catalog.now()
     order by w.purge_at limit p_batch
  loop
    perform public.purge_wedding(v_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end
$$;

-- ---------------------------------------------------------------------------
-- erase_guest: výmaz hosta na žádost (volá správce s JWT admin). Odchylka od data-model.md:
-- bez argumentu wedding_id, svatba je vždy app.wedding_id() (kap. 5.5).
-- ---------------------------------------------------------------------------
create function public.erase_guest(p_guest_id uuid) returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := app.wedding_id();
  v_household uuid;
  v_people integer;
  v_household_deleted boolean := false;
  v_actor uuid;
begin
  if not app.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select g.household_id into v_household from public.guests g
   where g.id = p_guest_id and g.wedding_id = v_wedding_id for update;
  if not found then
    raise exception 'guest_not_found' using errcode = 'P0002';
  end if;

  select count(*) into v_people from public.rsvp_people p
   where p.guest_id = p_guest_id and p.wedding_id = v_wedding_id;

  -- kaskáda smaže osoby, účast i zdravotní údaje hosta
  delete from public.guests g where g.id = p_guest_id and g.wedding_id = v_wedding_id;

  -- prázdná domácnost se smaže i s odpovědí a lístky
  if not exists (select 1 from public.guests g where g.household_id = v_household and g.wedding_id = v_wedding_id) then
    delete from public.households h where h.id = v_household and h.wedding_id = v_wedding_id;
    v_household_deleted := true;
  end if;

  v_actor := nullif(auth.jwt() ->> 'sub', '')::uuid;
  perform app.write_audit('admin', v_actor, v_wedding_id, 'guest.erase', 'guest', p_guest_id, null,
    jsonb_build_object('rsvp_people', v_people, 'household_deleted', v_household_deleted));
  return jsonb_build_object('rsvp_people', v_people, 'household_deleted', v_household_deleted);
end
$$;

-- ---------------------------------------------------------------------------
-- housekeeping: úklid prošlých relací, výzev, lístků a čítačů (denní cron, ADR 0010)
-- ---------------------------------------------------------------------------
create function public.housekeeping() returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_sessions integer;
  v_operator_sessions integer;
  v_challenges integer;
  v_tickets integer;
  v_rate_limits integer;
  v_lockouts integer;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('housekeeping')) then
    return '{}'::jsonb;
  end if;

  with d as (delete from public.sessions s
              where s.idle_expires_at < pg_catalog.now() or s.absolute_expires_at < pg_catalog.now()
                 or s.revoked_at < pg_catalog.now() - interval '1 day' returning 1)
    select count(*) into v_sessions from d;
  with d as (delete from public.operator_sessions s
              where s.idle_expires_at < pg_catalog.now() or s.absolute_expires_at < pg_catalog.now()
                 or s.revoked_at < pg_catalog.now() - interval '1 day' returning 1)
    select count(*) into v_operator_sessions from d;
  with d as (delete from public.login_challenges c
              where c.expires_at < pg_catalog.now() - interval '1 day' returning 1)
    select count(*) into v_challenges from d;
  with d as (delete from public.rsvp_tickets t where t.expires_at < pg_catalog.now() returning 1)
    select count(*) into v_tickets from d;
  with d as (delete from public.rate_limits r
              where r.window_start < pg_catalog.now() - interval '1 day' returning 1)
    select count(*) into v_rate_limits from d;
  with d as (delete from public.lockouts l
              where l.locked_until is not null and l.locked_until < pg_catalog.now() - interval '7 days'
              returning 1)
    select count(*) into v_lockouts from d;

  return jsonb_build_object('sessions', v_sessions, 'operator_sessions', v_operator_sessions,
    'login_challenges', v_challenges, 'rsvp_tickets', v_tickets, 'rate_limits', v_rate_limits,
    'lockouts', v_lockouts);
end
$$;

revoke all on function
  public.op_set_wedding_status(uuid, uuid, text, text),
  public.op_view_guest_data(uuid, uuid, text),
  public.op_set_app_setting(uuid, text, jsonb),
  public.purge_health_data(integer),
  public.purge_guest_data(integer),
  public.purge_wedding(uuid),
  public.purge_deleted_weddings(integer),
  public.erase_guest(uuid),
  public.housekeeping()
  from public, anon;

grant execute on function
  public.op_set_wedding_status(uuid, uuid, text, text),
  public.op_view_guest_data(uuid, uuid, text),
  public.op_set_app_setting(uuid, text, jsonb),
  public.purge_health_data(integer),
  public.purge_guest_data(integer),
  public.purge_wedding(uuid),
  public.purge_deleted_weddings(integer),
  public.housekeeping()
  to service_role;

-- erase_guest volá správce páru s JWT (role authenticated, wedding_role admin)
grant execute on function public.erase_guest(uuid) to authenticated;
