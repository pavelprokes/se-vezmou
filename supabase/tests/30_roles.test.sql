-- Host, návštěvník, náhled, anon a JWT bez claimu nevidí pracovní tabulky (data-model.md kap. 12 bod 2).
begin;
select tap.seed();

-- Pro každou roli aplikace a každou tabulku: žádný řádek, nebo žádné právo
do $$
declare
  r record;
  v_role text;
begin
  foreach v_role in array array['visitor', 'guest_pin', 'preview'] loop
    perform tap.become('authenticated', tap.wa(), v_role);
    for r in select c.relname from pg_class c
              where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') order by 1 loop
      perform tap.invisible('public.' || quote_ident(r.relname), v_role || ' nevidí ' || r.relname);
    end loop;
    perform tap.reset();
  end loop;
end
$$;

-- Role authenticated bez claimu wedding_id, s chybným wedding_role nebo bez claimů vůbec
do $$
declare
  r record;
begin
  -- bez wedding_id
  perform tap.become('authenticated', null, 'admin');
  for r in select c.relname from pg_class c
            where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') order by 1 loop
    perform tap.invisible('public.' || quote_ident(r.relname), 'admin bez wedding_id nevidí ' || r.relname);
  end loop;
  perform tap.reset();

  -- bez claimů
  perform set_config('request.jwt.claims', '', true);
  set local role authenticated;
  for r in select c.relname from pg_class c
            where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') order by 1 loop
    perform tap.invisible('public.' || quote_ident(r.relname), 'authenticated bez claimů nevidí ' || r.relname);
  end loop;
  perform tap.reset();

  -- neznámá aplikační role se wedding_id svatby
  perform tap.become('authenticated', tap.wa(), 'superadmin');
  perform tap.invisible('public.pages', 'neznámá wedding_role nevidí pages');
  perform tap.invisible('public.guests', 'neznámá wedding_role nevidí guests');
  perform tap.reset();
end
$$;

-- anon: žádný přístup k tabulkám ani funkcím
do $$
declare
  r record;
begin
  set local role anon;
  for r in select c.relname from pg_class c
            where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') order by 1 loop
    perform tap.throws('select count(*) from public.' || quote_ident(r.relname), '42501', 'anon nečte ' || r.relname);
    perform tap.throws('delete from public.' || quote_ident(r.relname), '42501', 'anon nemaže ' || r.relname);
  end loop;
  perform tap.throws('select public.get_public_site()', '42501', 'anon nevolá get_public_site');
  perform tap.throws('select * from public.resolve_slug(''klara-a-matej'')', '42501', 'anon nevolá resolve_slug');
  perform tap.throws('select * from public.rate_limit_hit(''x'', 1, interval ''1 minute'')', '42501', 'anon nevolá rate_limit_hit');
  perform tap.throws('select * from public.rsvp_match(''Jan Novák'')', '42501', 'anon nevolá rsvp_match');
  perform tap.reset();
end
$$;

-- Hosté ani správci nevolají funkce service role (před ověřením) ani operátorské funkce
do $$
declare
  v_role text;
begin
  foreach v_role in array array['visitor', 'admin'] loop
    perform tap.become('authenticated', tap.wa(), v_role);
    perform tap.throws('select * from public.rate_limit_hit(''x'', 1, interval ''1 minute'')', '42501', v_role || ' nevolá rate_limit_hit');
    perform tap.throws('select * from public.resolve_slug(''klara-a-matej'')', '42501', v_role || ' nevolá resolve_slug');
    perform tap.throws('select * from public.check_slug(''neco'')', '42501', v_role || ' nevolá check_slug');
    perform tap.throws(format('select * from public.reserve_slug(%L, ''neco'')', tap.wa()), '42501', v_role || ' nevolá reserve_slug');
    perform tap.throws('select * from public.auth_validate_session(''\x00''::bytea)', '42501', v_role || ' nevolá auth_validate_session');
    perform tap.throws(format('select public.op_view_guest_data(%L, %L, ''x'')', tap.u('operator:owner'), tap.wa()), '42501', v_role || ' nevolá op_view_guest_data');
    perform tap.throws(format('select public.op_set_wedding_status(%L, %L, ''blocked'', ''x'')', tap.u('operator:owner'), tap.wa()), '42501', v_role || ' nevolá op_set_wedding_status');
    perform tap.throws('select * from public.get_app_settings()', '42501', v_role || ' nečte nastavení');
    perform tap.throws('select public.purge_health_data()', '42501', v_role || ' nespustí retenci');
    perform tap.throws('select public.housekeeping()', '42501', v_role || ' nespustí úklid');
    perform tap.throws('select app.write_audit(''admin'', null, null, ''x'')', '42501', v_role || ' nezapíše audit přímo');
    perform tap.reset();
  end loop;
end
$$;

-- Funkce pro hosty bez příslušného claimu nevrátí nic
do $$
begin
  perform tap.become('authenticated', null, 'visitor');
  perform tap.ok(public.get_public_site() is null, 'get_public_site bez wedding_id vrací null');
  perform tap.reset();
  perform tap.become('authenticated', tap.wa(), 'neznama');
  perform tap.ok(public.get_public_site() is null, 'get_public_site s neznámou rolí vrací null');
  perform tap.reset();
end
$$;

-- Role aplikace nesmí ze svého JWT přečíst jinou svatbu (JWT je jediná autorita, DB mu věří jen pro svůj wedding_id)
do $$
begin
  perform tap.become('authenticated', tap.wb(), 'visitor');
  perform tap.ok((public.get_public_site() -> 'content' -> 'hero' ->> 'title') = 'Zveřejněno B',
    'visitor svatby B vidí jen web B');
  perform tap.reset();
end
$$;

rollback;
