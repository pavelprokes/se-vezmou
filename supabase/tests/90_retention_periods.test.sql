-- Lhůty po svatbě (web 12 měsíců, hosté 3 měsíce, archiv 365 dní po smazání hostů) a upozornění v přehledu.
begin;
select tap.seed();

do $$
declare
  v_id uuid;
  v_rows integer;
begin
  perform tap.eq(se_vezmou.setting_int('site_online_days_after_wedding', 0), 365, 'web veřejně 365 dní po svatbě');
  perform tap.eq(se_vezmou.setting_int('guest_retention_months_after_wedding', 0), 3, 'údaje hostů 3 měsíce');
  perform tap.eq(se_vezmou.setting_int('health_retention_days_after_wedding', 0), 30, 'dieta a alergie dál 30 dní');
  perform tap.eq(se_vezmou.setting_int('archived_delete_days_after_guest_purge', 0), 365, 'archiv 365 dní po smazání hostů');
  perform tap.ok(exists (select 1 from pg_catalog.pg_trigger t where t.tgname = 'weddings_before_write' and t.tgenabled = 'O'),
    'spouštěč weddings_before_write je po migraci zase zapnutý');

  -- nová svatba: datum smazání hostů 3 měsíce po svatbě, web končí 365 dní po svatbě
  update se_vezmou.weddings set starts_on = date '2027-06-19', ends_on = null, timezone = 'Europe/Prague'
   where id = tap.wa();
  perform tap.ok((select guest_purge_at from se_vezmou.weddings where id = tap.wa())
                 = (date '2027-09-19')::timestamp at time zone 'Europe/Prague', 'guest_purge_at = svatba + 3 měsíce');
  perform tap.ok((select se_vezmou.lifecycle_expires_at(w) from se_vezmou.weddings w where w.id = tap.wa())
                 = (date '2027-06-19' + 365)::timestamp at time zone 'Europe/Prague', 'web končí svatba + 365 dní');

  -- upozornění v přehledu: jen správce, jen vlastní svatba, jen v okně
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.throws('select * from se_vezmou.admin_lifecycle_upcoming(30)', '42501', 'návštěvník je odmítnut');
  perform tap.reset();
  update se_vezmou.weddings set guest_purge_at = now() + interval '10 days' where id = tap.wa();
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  select count(*) into v_rows from se_vezmou.admin_lifecycle_upcoming(30) where kind = 'guest_purge';
  perform tap.throws('select * from se_vezmou.admin_lifecycle_upcoming(0)', '22023', 'neplatné okno se odmítne');
  perform tap.reset();
  perform tap.eq(v_rows, 1, 'smazání údajů hostů do 30 dní je v přehledu');
  perform tap.ok(not has_function_privilege('service_role', 'se_vezmou.admin_lifecycle_upcoming(integer)', 'execute'),
    'admin_lifecycle_upcoming jen pro authenticated');

  -- minulá událost se v přehledu nenabízí (časovaný text „smažeme“)
  update se_vezmou.weddings set guest_purge_at = now() - interval '1 day' where id = tap.wa();
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.eq((select count(*)::integer from se_vezmou.admin_lifecycle_upcoming(30) where kind = 'guest_purge'), 0,
    'proběhlé smazání se v přehledu neukazuje');
  -- po smazání údajů hostů se nová domácnost nezaloží (zmizela by při příští údržbě)
  perform tap.throws('select se_vezmou.admin_household_save(null, ''{"label": "Pozdě", "guests": [{"display_name": "Host"}]}'')',
    'guests_purged', 'po guest_purge_at nová domácnost nejde založit');
  perform tap.reset();

end
$$;

rollback;
