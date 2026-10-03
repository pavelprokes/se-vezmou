-- Oprava 1/5 (revize kódu): meze nastavení a retenční data, která operátor prodloužil.
--
-- 1. app_settings: každé číselné nastavení má dolní a horní mez (jedna funkce app_setting_valid, kterou
--    používá op_set_app_setting i spouštěč na tabulce, takže mez platí i pro zápis jinou cestou).
--    setting_int vrací výchozí hodnotu, když je uložená hodnota mimo rozsah integer (jinak by každý zápis
--    svatby selhal na přetečení při výpočtu retenčních dat).
-- 2. weddings_before_write přepočítával health_purge_at a guest_purge_at při změně data nebo pásma svatby a
--    tiše přepsal prodloužení lhůty od operátora (op_extend_retention). Výslovně zapsanou hodnotu teď značí
--    příznak *_purge_extended a přepočet ji nikdy nezkrátí (greatest); neoznačené hodnoty se přepočítávají jako dřív.
-- 3. Sloupce pro nový stav pokusů o trvalé smazání webu (zálohování po selhání, zámek proti souběhu s obnovou).
--
-- Pozor na migrační nástroj: žádný řádek nesmí začínat příkazem `delete from`.

-- ---------------------------------------------------------------------------
-- setting_int: mimo rozsah integer = výchozí hodnota
-- ---------------------------------------------------------------------------
create or replace function se_vezmou.setting_int(p_key text, p_default integer) returns integer
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_value jsonb;
  v_number numeric;
begin
  select s.value into v_value from se_vezmou.app_settings s where s.key = p_key;
  if v_value is null or pg_catalog.jsonb_typeof(v_value) <> 'number' then
    return p_default;
  end if;
  v_number := pg_catalog.round((v_value #>> '{}')::numeric);
  if v_number < -2147483648 or v_number > 2147483647 then
    return p_default;
  end if;
  return v_number::integer;
end
$$;

-- ---------------------------------------------------------------------------
-- Meze nastavení. Neznámý klíč (přidaný později) má obecnou mez 1 až 1 000 000.
-- ---------------------------------------------------------------------------
create function se_vezmou.app_setting_bounds(p_key text) returns numrange
  language sql immutable set search_path = ''
  as $$
  select case p_key
    when 'max_admins' then pg_catalog.numrange(1, 5, '[]')
    when 'slug_reservation_days' then pg_catalog.numrange(1, 3650, '[]')
    when 'versions_keep' then pg_catalog.numrange(1, 200, '[]')
    when 'health_retention_days_after_wedding' then pg_catalog.numrange(1, 3650, '[]')
    when 'guest_retention_months_after_wedding' then pg_catalog.numrange(1, 120, '[]')
    when 'retention_notice_days_before' then pg_catalog.numrange(1, 365, '[]')
    when 'retention_final_notice_days_before' then pg_catalog.numrange(1, 365, '[]')
    when 'deleted_site_restore_days' then pg_catalog.numrange(1, 3650, '[]')
    when 'analytics_retention_months' then pg_catalog.numrange(1, 120, '[]')
    when 'activity_touch_minutes' then pg_catalog.numrange(1, 1440, '[]')
    when 'session_touch_minutes' then pg_catalog.numrange(1, 1440, '[]')
    when 'rsvp_match_threshold' then pg_catalog.numrange(0.1, 1, '[]')
    when 'site_online_days_after_wedding' then pg_catalog.numrange(1, 3650, '[]')
    when 'email_log_retention_days' then pg_catalog.numrange(1, 3650, '[]')
    when 'job_runs_retention_days' then pg_catalog.numrange(1, 3650, '[]')
    when 'media_max_photos' then pg_catalog.numrange(1, 1000, '[]')
    when 'media_max_bytes' then pg_catalog.numrange(1, 2147483647, '[]')
    when 'abandoned_draft_days' then pg_catalog.numrange(1, 365, '[]')
    when 'archived_delete_days_after_guest_purge' then pg_catalog.numrange(1, 3650, '[]')
    when 'waitlist_retention_months' then pg_catalog.numrange(1, 120, '[]')
    else pg_catalog.numrange(1, 1000000, '[]')
  end
$$;

-- true, když je hodnota přípustná: číslo v mezích, u všech kromě rsvp_match_threshold celé.
create function se_vezmou.app_setting_valid(p_key text, p_value jsonb) returns boolean
  language sql immutable set search_path = ''
  as $$
  select p_value is not null
     and pg_catalog.jsonb_typeof(p_value) = 'number'
     and se_vezmou.app_setting_bounds(p_key) @> (p_value #>> '{}')::numeric
     and (p_key = 'rsvp_match_threshold'
          or (p_value #>> '{}')::numeric = pg_catalog.trunc((p_value #>> '{}')::numeric))
$$;

revoke all on function se_vezmou.app_setting_bounds(text), se_vezmou.app_setting_valid(text, jsonb)
  from public, anon, authenticated, service_role;

-- Spouštěč hlídá mez při každém zápisu (op_set_app_setting, zásah vlastníka v SQL editoru, budoucí migrace).
create function se_vezmou.app_settings_validate() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if not se_vezmou.app_setting_valid(new.key, new.value) then
    raise exception 'invalid_setting_value' using errcode = '22023';
  end if;
  return new;
end
$$;

revoke all on function se_vezmou.app_settings_validate() from public, anon;

create trigger app_settings_validate
  before insert or update of value on se_vezmou.app_settings
  for each row execute function se_vezmou.app_settings_validate();

create or replace function se_vezmou.op_set_app_setting(p_operator_id uuid, p_key text, p_value jsonb) returns void
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_old jsonb;
begin
  perform se_vezmou.assert_operator(p_operator_id, array['owner']);

  select s.value into v_old from se_vezmou.app_settings s where s.key = p_key for update;
  if not found then
    raise exception 'unknown_setting' using errcode = '22023';
  end if;

  -- číselná nastavení musí být čísla v mezích klíče (se_vezmou.app_setting_bounds), celá kromě prahu RSVP
  if not se_vezmou.app_setting_valid(p_key, p_value) then
    raise exception 'invalid_setting_value' using errcode = '22023';
  end if;

  update se_vezmou.app_settings s set value = p_value, updated_by = p_operator_id where s.key = p_key;
  perform se_vezmou.write_audit('operator', p_operator_id, null, 'app_settings.update', 'app_setting', null,
    null, jsonb_build_object('setting_key', p_key, 'old_value', v_old, 'new_value', p_value));
end
$$;

-- ---------------------------------------------------------------------------
-- Nové sloupce zakázky (jen RPC a spouštěč; správce na ně nemá právo zápisu)
-- ---------------------------------------------------------------------------
alter table se_vezmou.weddings
  -- lhůta byla zapsána výslovně (prodloužení operátorem): přepočet z data svatby ji nikdy nezkrátí
  add column health_purge_extended boolean not null default false,
  add column guest_purge_extended boolean not null default false,
  -- trvalé smazání webu: počet převzetí, čas posledního pokusu (zálohování po selhání) a zapůjčení
  -- převzetí (obnova operátorem se v jeho době odmítne, aby soubory nezmizely u obnoveného webu)
  add column purge_attempts smallint not null default 0,
  add column purge_last_attempt_at timestamptz,
  add column purge_claimed_at timestamptz;

-- ---------------------------------------------------------------------------
-- weddings_before_write: prodloužení lhůty přežije změnu data nebo pásma
-- ---------------------------------------------------------------------------
create or replace function se_vezmou.weddings_before_write() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  v_health_days integer := se_vezmou.setting_int('health_retention_days_after_wedding', 30);
  v_guest_months integer := se_vezmou.setting_int('guest_retention_months_after_wedding', 12);
  v_restore_days integer := se_vezmou.setting_int('deleted_site_restore_days', 30);
  v_touch interval := pg_catalog.make_interval(mins => se_vezmou.setting_int('activity_touch_minutes', 5));
  v_ref date;
  v_dates_changed boolean;
  v_calc timestamptz;
begin
  -- platné časové pásmo (nelze hlídat check omezením, pg_timezone_names je pohled)
  if tg_op = 'INSERT' or new.timezone is distinct from old.timezone then
    if not exists (select 1 from pg_catalog.pg_timezone_names n where n.name = new.timezone) then
      raise exception 'invalid_timezone' using errcode = '22023';
    end if;
  end if;

  -- Retenční data se odvozují z konce svatby (ends_on, jinak starts_on) v pásmu svatby.
  -- Přepočet proběhne při vložení a při změně dat nebo pásma, ale jen pokud sloupec v téže změně nemění přímo
  -- operátor (prodloužení lhůty s auditem). Výslovně změněná hodnota se označí (*_purge_extended) a od té chvíle
  -- ji přepočet jen prodlužuje (greatest), nikdy nezkracuje ani nenuluje.
  v_ref := coalesce(new.ends_on, new.starts_on);
  v_dates_changed := tg_op = 'INSERT'
    or new.starts_on is distinct from old.starts_on
    or new.ends_on is distinct from old.ends_on
    or new.timezone is distinct from old.timezone;

  if tg_op = 'UPDATE' then
    if new.health_purge_at is distinct from old.health_purge_at then
      new.health_purge_extended := true;
    end if;
    if new.guest_purge_at is distinct from old.guest_purge_at then
      new.guest_purge_extended := true;
    end if;
  end if;

  if v_dates_changed then
    -- zdravotní údaje
    if tg_op = 'INSERT' and new.health_purge_at is not null then
      null; -- hodnotu zadal vkládající výslovně
    elsif tg_op = 'UPDATE' and new.health_purge_at is distinct from old.health_purge_at then
      null; -- výslovná změna ve stejném příkazu: platí ta
    else
      v_calc := case when v_ref is null then null
        else ((v_ref + v_health_days)::timestamp at time zone new.timezone) end;
      if tg_op = 'UPDATE' and new.health_purge_extended then
        new.health_purge_at := greatest(old.health_purge_at, v_calc);
      else
        new.health_purge_at := v_calc;
      end if;
    end if;
    -- ostatní údaje hostů
    if tg_op = 'INSERT' and new.guest_purge_at is not null then
      null;
    elsif tg_op = 'UPDATE' and new.guest_purge_at is distinct from old.guest_purge_at then
      null;
    else
      v_calc := case when v_ref is null then null
        else ((v_ref + pg_catalog.make_interval(months => v_guest_months))::timestamp
              at time zone new.timezone) end;
      if tg_op = 'UPDATE' and new.guest_purge_extended then
        new.guest_purge_at := greatest(old.guest_purge_at, v_calc);
      else
        new.guest_purge_at := v_calc;
      end if;
    end if;
  end if;

  if tg_op = 'UPDATE' then
    -- last_activity_at: jen uložení správcem této svatby, nejvýše jednou za activity_touch_minutes
    if se_vezmou.is_wedding_admin() and se_vezmou.wedding_id() = new.id
       and new.last_activity_at is not distinct from old.last_activity_at
       and pg_catalog.now() - old.last_activity_at >= v_touch then
      new.last_activity_at := pg_catalog.now();
    end if;

    -- účinky změny uloženého stavu
    if new.status is distinct from old.status then
      if new.status = 'published' and new.published_at is null then
        new.published_at := pg_catalog.now();
      end if;
      if new.status = 'blocked' then
        new.blocked_at := coalesce(new.blocked_at, pg_catalog.now());
      elsif old.status = 'blocked' then
        new.blocked_at := null;
      end if;
      if new.status = 'deleted' then
        new.deleted_at := pg_catalog.now();
        new.purge_at := coalesce(new.purge_at,
          pg_catalog.now() + pg_catalog.make_interval(days => v_restore_days));
      elsif old.status = 'deleted' then
        new.deleted_at := null;
        new.purge_at := null;
        -- obnovený web začíná bez historie pokusů o smazání
        new.purge_attempts := 0;
        new.purge_last_attempt_at := null;
        new.purge_claimed_at := null;
      end if;
    end if;
  end if;

  return new;
end
$$;
