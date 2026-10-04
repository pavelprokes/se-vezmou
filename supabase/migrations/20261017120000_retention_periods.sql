-- Lhůty po svatbě podle zadání (stále ČEKAJÍ NA SCHVÁLENÍ PRÁVNÍKEM, docs/security-privacy.md kap. 5.3):
--   web veřejně 12 měsíců po svatbě (dříve 90 dní), údaje hostů a odpovědi 3 měsíce (dříve 12 měsíců),
--   dieta a alergie dál 30 dní, archiv (web jen pro správce) ještě 365 dní po smazání údajů hostů, tedy
--   zhruba do 15 měsíců po svatbě (dříve 90 dní), pak smazání s ochrannou lhůtou deleted_site_restore_days.
-- Nastavení se mění jen tam, kde je ještě původní výchozí hodnota (změnu provozovatele nepřepíše).
-- Zpětně kompatibilní: běžící kód čte lhůty z app_settings a uložená data svateb.

update se_vezmou.app_settings set value = '365'
 where key = 'site_online_days_after_wedding' and value = '90';
update se_vezmou.app_settings set value = '3'
 where key = 'guest_retention_months_after_wedding' and value = '12';
update se_vezmou.app_settings set value = '365'
 where key = 'archived_delete_days_after_guest_purge' and value = '90';

-- Uložené datum smazání údajů hostů u existujících svateb podle nové lhůty, jen když ho provozovatel
-- výslovně neprodloužil a smazání je teprve v budoucnu. Nikdy dřív než za retention_notice_days_before + 1 den,
-- aby správci stihli dostat upozornění a stáhnout export, a nikdy později než dosavadní datum (least). Spouštěč weddings_before_write se na tuto změnu
-- vypne: jinak by ji označil jako prodloužení provozovatelem (guest_purge_extended) a přepočty by ji jen prodlužovaly.
alter table se_vezmou.weddings disable trigger weddings_before_write;
update se_vezmou.weddings w
   set guest_purge_at = least(w.guest_purge_at, greatest(
         ((coalesce(w.ends_on, w.starts_on)
           + pg_catalog.make_interval(months => se_vezmou.setting_int('guest_retention_months_after_wedding', 3)))::timestamp
          at time zone w.timezone),
         pg_catalog.now()
           + pg_catalog.make_interval(days => se_vezmou.setting_int('retention_notice_days_before', 14) + 1)))
 where not w.guest_purge_extended
   and w.guest_purge_at > pg_catalog.now()
   and coalesce(w.ends_on, w.starts_on) is not null
   and w.deleted_at is null;
alter table se_vezmou.weddings enable trigger weddings_before_write;

-- Nevyřízená upozornění (první a závěrečné) na datum, které po změně lhůt už neplatí (posunuté smazání hostů,
-- prodloužený konec webu), se neodešlou se starým datem: označí se jako přeskočená. Na nové datum úloha
-- životního cyklu naplánuje nová upozornění.
update se_vezmou.lifecycle_notices n
   set status = 'skipped'
 where n.status in ('pending', 'failed')
   and n.stage in ('first', 'final')
   and not exists (
     select 1 from se_vezmou.lifecycle_events(n.wedding_id) e
      where e.kind = n.kind and e.event_at = n.event_at);

-- ---------------------------------------------------------------------------
-- Po smazání údajů hostů (guest_purge_at) se nová domácnost nezaloží: web je ještě veřejný, ale údaje hostů
-- by při příští noční údržbě tiše zmizely. Ruční zápis, import i RSVP domácnosti tak dostanou jasnou chybu.
-- ---------------------------------------------------------------------------
create function se_vezmou.households_guard_purged() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  if exists (select 1 from se_vezmou.weddings w
              where w.id = new.wedding_id and w.guest_purge_at is not null
                and w.guest_purge_at <= pg_catalog.now()) then
    raise exception 'guests_purged' using errcode = '55000';
  end if;
  return new;
end
$$;

revoke all on function se_vezmou.households_guard_purged() from public, anon, authenticated, service_role;

create trigger households_guard_purged
  before insert on se_vezmou.households
  for each row execute function se_vezmou.households_guard_purged();

-- ---------------------------------------------------------------------------
-- admin_lifecycle_upcoming: co svatbu správce čeká v příštích p_days dnech (konec veřejného webu, smazání
-- diety a alergií, smazání údajů hostů) pro upozornění v přehledu správy s odkazem na export.
-- ---------------------------------------------------------------------------
create function se_vezmou.admin_lifecycle_upcoming(p_days integer default 30)
  returns table (kind text, event_at timestamptz)
  language plpgsql stable security definer set search_path = ''
  as $$
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_days is null or p_days not between 1 and 365 then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  return query
  select e.kind, e.event_at
    from se_vezmou.lifecycle_events(se_vezmou.wedding_id()) e
   where e.kind in ('site_expiry', 'health_purge', 'guest_purge')
     and e.event_at > pg_catalog.now()
     and e.event_at <= pg_catalog.now() + pg_catalog.make_interval(days => p_days)
   order by e.event_at, e.kind;
end
$$;

revoke all on function se_vezmou.admin_lifecycle_upcoming(integer) from public, anon, service_role;
grant execute on function se_vezmou.admin_lifecycle_upcoming(integer) to authenticated;
