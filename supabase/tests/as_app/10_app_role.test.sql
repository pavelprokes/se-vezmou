-- Aplikační role se_vezmou_app (docs/adr/0011, docs/security-privacy.md): tento soubor se spouští
-- SKUTEČNÝM přihlášením jako se_vezmou_app (ne jako vlastník), aby se ověřil model oprávnění tak, jak ho
-- používá aplikace: role sama nemá k ničemu práva, vše jde přes `set local role` v transakci.
-- Hlídá především riziko zapomenutého `set role`: takové volání musí skončit chybou oprávnění.

select tap.ok(current_user = 'se_vezmou_app' and session_user = 'se_vezmou_app', 'test běží jako se_vezmou_app');

select tap.ok(
  (select not rolsuper and not rolbypassrls and not rolinherit and not rolcreaterole and not rolcreatedb and not rolreplication
     from pg_roles where rolname = 'se_vezmou_app'),
  'se_vezmou_app: bez superuser, bypassrls, inherit, createrole, createdb a replikace');

-- členství jen v authenticated a service_role (a to jen kvůli set role, bez ADMIN)
select tap.ok(
  (select array_agg(pg_get_userbyid(roleid)::text order by pg_get_userbyid(roleid)::text)
     from pg_auth_members where member = (select oid from pg_roles where rolname = 'se_vezmou_app'))
  = array['authenticated', 'service_role'],
  'se_vezmou_app je členem jen authenticated a service_role');
select tap.ok(
  not exists (select 1 from pg_auth_members m
               where m.member = (select oid from pg_roles where rolname = 'se_vezmou_app') and (m.admin_option or m.inherit_option)),
  'členství se_vezmou_app nemá ADMIN ani INHERIT');

-- zapomenuté set role: žádné právo ke schématu, tabulkám ani funkcím
select tap.throws('select count(*) from se_vezmou.weddings', '42501', 'bez set role: tabulky nelze číst');
select tap.throws('select * from se_vezmou.rate_limit_hit(''as-app-test'', 5, interval ''1 hour'')', '42501',
  'bez set role: funkce nelze spustit');
select tap.throws('select se_vezmou.wedding_id()', '42501', 'bez set role: ani pomocné funkce');
select tap.throws('create table se_vezmou.nesmi_vzniknout (a int)', '42501', 'se_vezmou_app nemůže zakládat objekty ve schématu se_vezmou');
select tap.throws('create table public.nesmi_vzniknout (a int)', '42501', 'se_vezmou_app nemůže zakládat objekty ve schématu public');

select tap.ok(
  not has_schema_privilege('se_vezmou_app', 'se_vezmou', 'usage, create')
  and not exists (select 1 from pg_class c where c.relnamespace = 'se_vezmou'::regnamespace and c.relkind in ('r', 'p', 'S', 'v')
                    and (has_any_column_privilege('se_vezmou_app', c.oid, 'select, insert, update, references')
                         or has_table_privilege('se_vezmou_app', c.oid, 'delete, truncate, trigger')))
  and not exists (select 1 from pg_proc p where p.pronamespace = 'se_vezmou'::regnamespace
                    and has_function_privilege('se_vezmou_app', p.oid, 'execute')),
  'se_vezmou_app sama nemá žádná práva ve schématu se_vezmou');

-- na jiné role než authenticated a service_role se přepnout nelze
select tap.throws('set role anon', '42501', 'set role anon je zakázán');
select tap.throws('set role postgres', '42501', 'set role postgres je zakázán');
select tap.throws('set role authenticator', '42501', 'set role authenticator je zakázán');

-- před ověřením, cron a operátor: transakce jako service_role
begin;
set local role service_role;
select tap.ok(current_user = 'service_role', 'set local role service_role funguje');
select tap.ok((select allowed from se_vezmou.rate_limit_hit('as-app-test', 5, interval '1 hour')), 'service_role volá funkci');
select tap.throws('select count(*) from se_vezmou.weddings', '42501', 'service_role nečte tabulky přímo');
commit;
select tap.ok(current_user = 'se_vezmou_app', 'po transakci se role vrátí na se_vezmou_app (set local)');
select tap.throws('select * from se_vezmou.rate_limit_hit(''as-app-test'', 5, interval ''1 hour'')', '42501',
  'další transakce bez set role opět selže (totožnost se nepřenáší)');

-- správce: authenticated + claimy
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","wedding_id":"11111111-1111-4111-8111-111111111111","wedding_role":"admin"}', true);
select tap.ok(se_vezmou.wedding_id() = '11111111-1111-4111-8111-111111111111'::uuid, 'wedding_id čte z request.jwt.claims');
select tap.ok(se_vezmou.wedding_role() = 'admin', 'wedding_role čte z request.jwt.claims');
select tap.ok(se_vezmou.actor_id() = '22222222-2222-4222-8222-222222222222'::uuid, 'actor_id čte sub z request.jwt.claims');
select tap.ok(se_vezmou.is_wedding_admin(), 'is_wedding_admin podle claimů');
select tap.eq((select count(*) from se_vezmou.weddings), 0, 'správce cizí (neexistující) svatby nevidí žádné svatby');
select tap.throws('select * from se_vezmou.rate_limit_hit(''x'', 5, interval ''1 hour'')', '42501', 'správce nevolá funkce service role');
commit;

-- claimy nepřežijí transakci (set_config(..., true) je lokální)
begin;
set local role authenticated;
select tap.ok(se_vezmou.wedding_id() is null and se_vezmou.wedding_role() is null,
  'nová transakce nemá po předchozí žádné claimy');
commit;
