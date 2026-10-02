-- M3 / 7: pomocné čtení nastavení a spouštěče (retenční data, last_activity, pravidla slugů,
-- limit správců, verze webu, audit append-only, updated_at).
-- Zdroj: docs/data-model.md kap. 3.1, 3.2, 3.3, 6, 10, 11.

-- ---------------------------------------------------------------------------
-- Čtení nastavení (žádná lhůta není pevně v kódu). Security definer, protože app_settings
-- nemá politiky; spouštěče běží s právy správce, který zapisuje.
-- ---------------------------------------------------------------------------
create function se_vezmou.setting(p_key text) returns jsonb
  language sql stable security definer set search_path = ''
  as $$ select s.value from se_vezmou.app_settings s where s.key = p_key $$;

create function se_vezmou.setting_int(p_key text, p_default integer) returns integer
  language sql stable security definer set search_path = ''
  as $$
  select coalesce(
    case when jsonb_typeof(s.value) = 'number' then (s.value #>> '{}')::numeric::integer end,
    p_default)
  from (select 1) as one
  left join se_vezmou.app_settings s on s.key = p_key
$$;

revoke all on function se_vezmou.setting(text), se_vezmou.setting_int(text, integer) from public, anon;
grant execute on function se_vezmou.setting(text), se_vezmou.setting_int(text, integer)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- weddings: časové pásmo, retenční data, last_activity, účinky změny stavu
-- ---------------------------------------------------------------------------
create function se_vezmou.weddings_before_write() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  v_health_days integer := se_vezmou.setting_int('health_retention_days_after_wedding', 30);
  v_guest_months integer := se_vezmou.setting_int('guest_retention_months_after_wedding', 12);
  v_restore_days integer := se_vezmou.setting_int('deleted_site_restore_days', 30);
  v_touch interval := pg_catalog.make_interval(mins => se_vezmou.setting_int('activity_touch_minutes', 5));
  v_ref date;
  v_dates_changed boolean;
begin
  -- platné časové pásmo (nelze hlídat check omezením, pg_timezone_names je pohled)
  if tg_op = 'INSERT' or new.timezone is distinct from old.timezone then
    if not exists (select 1 from pg_catalog.pg_timezone_names n where n.name = new.timezone) then
      raise exception 'invalid_timezone' using errcode = '22023';
    end if;
  end if;

  -- Retenční data se odvozují z konce svatby (ends_on, jinak starts_on) v pásmu svatby.
  -- Přepočet proběhne při vložení a při změně dat nebo pásma, ale jen pokud sloupec
  -- v téže změně nemění přímo operátor (prodloužení lhůty s auditem).
  v_ref := coalesce(new.ends_on, new.starts_on);
  v_dates_changed := tg_op = 'INSERT'
    or new.starts_on is distinct from old.starts_on
    or new.ends_on is distinct from old.ends_on
    or new.timezone is distinct from old.timezone;
  if v_dates_changed then
    if tg_op = 'INSERT' or new.health_purge_at is not distinct from old.health_purge_at then
      if tg_op = 'INSERT' and new.health_purge_at is not null then
        null; -- hodnotu zadal vkládající výslovně
      else
        new.health_purge_at := case when v_ref is null then null
          else ((v_ref + v_health_days)::timestamp at time zone new.timezone) end;
      end if;
    end if;
    if tg_op = 'INSERT' or new.guest_purge_at is not distinct from old.guest_purge_at then
      if tg_op = 'INSERT' and new.guest_purge_at is not null then
        null;
      else
        new.guest_purge_at := case when v_ref is null then null
          else ((v_ref + pg_catalog.make_interval(months => v_guest_months))::timestamp
                at time zone new.timezone) end;
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
      end if;
    end if;
  end if;

  return new;
end
$$;

revoke all on function se_vezmou.weddings_before_write() from public, anon;

create trigger weddings_before_write
  before insert or update on se_vezmou.weddings
  for each row execute function se_vezmou.weddings_before_write();

-- Po změně: zveřejnění přepne adresu na active (kap. 6 bod 4), aktivita prodlouží rezervaci.
-- Security definer: správce nemá právo zapisovat do slug_registry.
create function se_vezmou.weddings_after_write() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
begin
  if tg_op = 'UPDATE' then
    if new.status = 'published' and old.status is distinct from 'published' then
      update se_vezmou.slug_registry
         set state = 'active', reserved_until = null,
             first_published_at = coalesce(first_published_at, pg_catalog.now())
       where slug = new.slug and wedding_id = new.id and state in ('reserved', 'active');
      if not found then
        raise exception 'slug_not_registered' using errcode = '23503';
      end if;
    end if;

    if new.last_activity_at is distinct from old.last_activity_at then
      update se_vezmou.slug_registry
         set reserved_until = new.last_activity_at
             + pg_catalog.make_interval(days => se_vezmou.setting_int('slug_reservation_days', 30))
       where wedding_id = new.id and state = 'reserved';
    end if;
  end if;
  return null;
end
$$;

revoke all on function se_vezmou.weddings_after_write() from public, anon;

create trigger weddings_after_write
  after insert or update on se_vezmou.weddings
  for each row execute function se_vezmou.weddings_after_write();

-- ---------------------------------------------------------------------------
-- last_activity_at z pracovních tabulek (uložení bloku, události, média...)
-- ---------------------------------------------------------------------------
create function se_vezmou.touch_wedding_activity() returns trigger
  language plpgsql security definer set search_path = ''
  as $$
declare
  v_wedding uuid;
begin
  if tg_op = 'DELETE' then
    v_wedding := old.wedding_id;
  else
    v_wedding := new.wedding_id;
  end if;

  -- jen změny provedené správcem této svatby; cron, operátor a retence aktivitu nezakládají
  if se_vezmou.is_wedding_admin() and se_vezmou.wedding_id() = v_wedding then
    update se_vezmou.weddings w
       set last_activity_at = pg_catalog.now()
     where w.id = v_wedding
       and w.last_activity_at < pg_catalog.now()
         - pg_catalog.make_interval(mins => se_vezmou.setting_int('activity_touch_minutes', 5));
  end if;
  return null;
end
$$;

revoke all on function se_vezmou.touch_wedding_activity() from public, anon;

create trigger pages_touch_activity after insert or update or delete on se_vezmou.pages
  for each row execute function se_vezmou.touch_wedding_activity();
create trigger content_blocks_touch_activity after insert or update or delete on se_vezmou.content_blocks
  for each row execute function se_vezmou.touch_wedding_activity();
create trigger events_touch_activity after insert or update or delete on se_vezmou.events
  for each row execute function se_vezmou.touch_wedding_activity();
create trigger venues_touch_activity after insert or update or delete on se_vezmou.venues
  for each row execute function se_vezmou.touch_wedding_activity();
create trigger media_touch_activity after insert or update or delete on se_vezmou.media
  for each row execute function se_vezmou.touch_wedding_activity();

-- ---------------------------------------------------------------------------
-- slug_registry: pravidla trvalého záznamu adres (FR-WZ-4, FR-PRIV-4)
-- ---------------------------------------------------------------------------
create function se_vezmou.slug_registry_guard() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if tg_op = 'DELETE' then
    -- řádek se nikdy nemaže, pokud slug byl zveřejněn nebo je rezervovaným slovem
    if old.first_published_at is not null or old.state = 'reserved_word' then
      raise exception 'slug_registry_row_is_permanent: %', old.slug using errcode = '23001';
    end if;
    return old;
  end if;

  if new.slug is distinct from old.slug then
    raise exception 'slug_registry_slug_is_immutable' using errcode = '23001';
  end if;
  if old.state = 'reserved_word' and new.state is distinct from 'reserved_word' then
    raise exception 'reserved_word_cannot_change' using errcode = '23001';
  end if;
  -- zveřejněná adresa se nikdy nepřidělí znovu (jen active <-> retired, nikdy zpět do reserved)
  if old.first_published_at is not null then
    if new.first_published_at is distinct from old.first_published_at then
      raise exception 'first_published_at_is_immutable' using errcode = '23001';
    end if;
    if new.state = 'reserved' or (old.state = 'retired' and new.state <> 'retired') then
      raise exception 'published_slug_cannot_be_reassigned' using errcode = '23001';
    end if;
  end if;
  return new;
end
$$;

revoke all on function se_vezmou.slug_registry_guard() from public, anon;

create trigger slug_registry_guard before update or delete on se_vezmou.slug_registry
  for each row execute function se_vezmou.slug_registry_guard();

-- ---------------------------------------------------------------------------
-- wedding_admins: limit počtu aktivních správců (max_admins, tvrdý strop 5)
-- ---------------------------------------------------------------------------
create function se_vezmou.wedding_admins_limit() returns trigger
  language plpgsql set search_path = ''
  as $$
declare
  c_hard_cap constant integer := 5;
  v_limit integer;
  v_active integer;
begin
  if new.removed_at is not null then
    return new;
  end if;
  -- serializace souběžných přidání pro jednu svatbu
  perform 1 from se_vezmou.weddings w where w.id = new.wedding_id for update;
  v_limit := least(se_vezmou.setting_int('max_admins', 3), c_hard_cap);
  select count(*) into v_active
    from se_vezmou.wedding_admins a
   where a.wedding_id = new.wedding_id and a.removed_at is null and a.id <> new.id;
  if v_active + 1 > v_limit then
    raise exception 'max_admins_exceeded' using errcode = '23514';
  end if;
  return new;
end
$$;

revoke all on function se_vezmou.wedding_admins_limit() from public, anon;

create trigger wedding_admins_limit
  before insert or update of removed_at, wedding_id on se_vezmou.wedding_admins
  for each row execute function se_vezmou.wedding_admins_limit();

-- ---------------------------------------------------------------------------
-- site_versions: číslování a neměnnost (staré verze se nepřepisují, kap. 3.3)
-- ---------------------------------------------------------------------------
create function se_vezmou.site_versions_before_write() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if tg_op = 'INSERT' then
    if new.version_no is null then
      perform 1 from se_vezmou.weddings w where w.id = new.wedding_id for update;
      select coalesce(max(v.version_no), 0) + 1 into new.version_no
        from se_vezmou.site_versions v where v.wedding_id = new.wedding_id;
    end if;
  elsif new.public_content is distinct from old.public_content
     or new.version_no is distinct from old.version_no
     or new.kind is distinct from old.kind
     or new.wedding_id is distinct from old.wedding_id then
    raise exception 'site_version_is_immutable' using errcode = '23001';
  end if;
  return new;
end
$$;

revoke all on function se_vezmou.site_versions_before_write() from public, anon;

create trigger site_versions_before_write before insert or update on se_vezmou.site_versions
  for each row execute function se_vezmou.site_versions_before_write();

-- ---------------------------------------------------------------------------
-- audit_log: append-only a ochrana meta před osobními údaji (kap. 11)
-- ---------------------------------------------------------------------------
create function se_vezmou.audit_log_guard() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if tg_op in ('UPDATE', 'DELETE', 'TRUNCATE') then
    raise exception 'audit_log_is_append_only' using errcode = '42501';
  end if;
  -- Obrana do hloubky: allowlist klíčů hlídá aplikační vrstva; databáze odmítne klíče,
  -- které vypadají jako osobní údaje (e-mail, jméno, dieta, alergie, telefon, IP, user agent).
  if new.meta::text ~* '"([a-z_]*(e_?mail|name|diet|allerg|phone|address)[a-z_]*|ip|ip_address|user_agent)"[[:space:]]*:' then
    raise exception 'audit_meta_contains_personal_data_key' using errcode = '22023';
  end if;
  return new;
end
$$;

revoke all on function se_vezmou.audit_log_guard() from public, anon;

create trigger audit_log_row_guard before insert or update or delete on se_vezmou.audit_log
  for each row execute function se_vezmou.audit_log_guard();
create trigger audit_log_truncate_guard before truncate on se_vezmou.audit_log
  for each statement execute function se_vezmou.audit_log_guard();

-- ---------------------------------------------------------------------------
-- updated_at: všechny tabulky s tímto sloupcem
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'se_vezmou' and c.column_name = 'updated_at'
       and t.table_type = 'BASE TABLE'
  loop
    execute format(
      'create trigger %I before update on se_vezmou.%I for each row execute function se_vezmou.touch_updated_at()',
      r.table_name || '_touch_updated_at', r.table_name);
  end loop;
end
$$;
