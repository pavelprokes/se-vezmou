-- Strukturální kontroly schématu (data-model.md kap. 12 body 2 až 4 a 6; test-plan.md 2.4).
-- Tyto testy chytí novou tabulku bez RLS, bez složeného klíče nebo funkci s nebezpečným nastavením.
begin;

do $$
declare
  v_bad text;
begin
  -- 1. RLS je zapnuté na každé tabulce ve schématu se_vezmou
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c
   where c.relnamespace = 'se_vezmou'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity;
  perform tap.ok(v_bad is null, 'RLS je zapnuté na všech tabulkách (chybí: ' || coalesce(v_bad, '-') || ')');

  -- 2. tabulka s wedding_id má RLS (výslovně, kdyby někdo RLS na tabulce s wedding_id vypnul)
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'wedding_id' and not a.attisdropped
   where c.relnamespace = 'se_vezmou'::regnamespace and c.relkind = 'r' and not c.relrowsecurity;
  perform tap.ok(v_bad is null, 'každá tabulka s wedding_id má zapnuté RLS');

  -- 3. FORCE RLS není zapnuto (DEFINER funkce vlastní role s bypassrls; FORCE by je zablokoval, docs/security-privacy.md)
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c where c.relnamespace = 'se_vezmou'::regnamespace and c.relkind = 'r' and c.relforcerowsecurity;
  perform tap.ok(v_bad is null, 'FORCE RLS není zapnuto');

  -- 4. anon nemá žádná práva k žádné tabulce ani sekvenci ve schématu se_vezmou
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c
   where c.relnamespace = 'se_vezmou'::regnamespace and c.relkind in ('r', 'p', 'S', 'v')
     and (has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate, references, trigger')
          or has_any_column_privilege('anon', c.oid, 'select, insert, update, references'));
  perform tap.ok(v_bad is null, 'anon nemá žádná práva k tabulkám (porušuje: ' || coalesce(v_bad, '-') || ')');
  perform tap.ok(not has_schema_privilege('anon', 'se_vezmou', 'usage'), 'anon nemá USAGE na schéma se_vezmou');
  perform tap.ok(not exists (select 1 from aclexplode(coalesce((select nspacl from pg_namespace where nspname = 'se_vezmou'),
                                                                 acldefault('n', 10))) acl where acl.grantee = 0),
    'PUBLIC nemá žádná práva na schéma se_vezmou');
  perform tap.ok(has_schema_privilege('authenticated', 'se_vezmou', 'usage') and has_schema_privilege('service_role', 'se_vezmou', 'usage'),
    'authenticated a service_role mají USAGE na schéma se_vezmou');

  -- 5. PUBLIC nemá práva k tabulkám
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c, lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
   where c.relnamespace = 'se_vezmou'::regnamespace and c.relkind = 'r' and acl.grantee = 0;
  perform tap.ok(v_bad is null, 'PUBLIC nemá práva k tabulkám');

  -- 6. tabulka s wedding_id a id má unique (wedding_id, id), kromě záměrných výjimek
  --    (audit_log, email_log a slug_registry nemají složené klíče na weddings)
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c
   where c.relnamespace = 'se_vezmou'::regnamespace and c.relkind = 'r'
     and c.relname not in ('audit_log', 'email_log', 'slug_registry')
     and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'wedding_id' and not a.attisdropped)
     and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'id' and not a.attisdropped)
     and not exists (
       select 1 from pg_constraint k
        where k.conrelid = c.oid and k.contype in ('u', 'p')
          and (select array_agg(att.attname order by att.attname)
                 from unnest(k.conkey) cols(n) join pg_attribute att on att.attrelid = c.oid and att.attnum = cols.n)
              = array['id', 'wedding_id']::name[]);
  perform tap.ok(v_bad is null, 'tabulky s wedding_id a id mají unique (wedding_id, id) (chybí: ' || coalesce(v_bad, '-') || ')');

  -- 7. cizí klíč z tabulky s wedding_id na jinou tabulku s wedding_id (kromě weddings) je složený
  --    a obsahuje wedding_id, takže odkaz nemůže přejít do jiné svatby
  select string_agg(k.conrelid::regclass || '.' || k.conname, ', ') into v_bad
    from pg_constraint k
   where k.contype = 'f' and k.connamespace = 'se_vezmou'::regnamespace
     and k.confrelid <> 'se_vezmou.weddings'::regclass
     and exists (select 1 from pg_attribute a where a.attrelid = k.conrelid and a.attname = 'wedding_id' and not a.attisdropped)
     and exists (select 1 from pg_attribute a where a.attrelid = k.confrelid and a.attname = 'wedding_id' and not a.attisdropped)
     and not exists (
       select 1 from unnest(k.conkey) cols(n) join pg_attribute att on att.attrelid = k.conrelid and att.attnum = cols.n
        where att.attname = 'wedding_id');
  perform tap.ok(v_bad is null, 'cizí klíče mezi tenant tabulkami jsou složené (porušuje: ' || coalesce(v_bad, '-') || ')');

  -- 8. funkce security definer: prázdný search_path, žádné právo pro PUBLIC ani anon
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'se_vezmou'::regnamespace and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c = 'search_path=""');
  perform tap.ok(v_bad is null, 'každá security definer funkce má prázdný search_path (porušuje: ' || coalesce(v_bad, '-') || ')');

  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'se_vezmou'::regnamespace and p.prosecdef
     and (p.proacl is null
          or exists (select 1 from aclexplode(p.proacl) acl where acl.grantee = 0)
          or has_function_privilege('anon', p.oid, 'execute'));
  perform tap.ok(v_bad is null, 'security definer funkce nemají execute pro PUBLIC ani anon (porušuje: ' || coalesce(v_bad, '-') || ')');

  -- 9. anon nemůže spustit žádnou funkci ve schématu se_vezmou
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'se_vezmou'::regnamespace
     and has_function_privilege('anon', p.oid, 'execute');
  perform tap.ok(v_bad is null, 'anon nemá execute na žádnou funkci (porušuje: ' || coalesce(v_bad, '-') || ')');

  -- 10. hosté a správci (authenticated) nesmějí spouštět funkce service role
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'se_vezmou'::regnamespace
     and (p.proname like 'auth\_%' or p.proname like 'op\_%' or p.proname like 'purge\_%'
          or p.proname in ('rate_limit_hit', 'check_slug', 'reserve_slug', 'resolve_slug',
                           'resolve_preview', 'housekeeping', 'get_app_settings',
                           'email_log_insert', 'email_log_set_status',
                           'wizard_create_draft', 'wizard_save', 'wizard_load', 'publish_site',
                           'set_preview_token', 'waitlist_add', 'waitlist_confirm', 'analytics_record'))
     and has_function_privilege('authenticated', p.oid, 'execute');
  perform tap.ok(v_bad is null, 'authenticated nemá execute na funkce service role (porušuje: ' || coalesce(v_bad, '-') || ')');

  -- 10b. KAŽDÁ funkce schématu (security definer i invoker) má prázdný search_path a nikdo z PUBLIC ani anon
  --      ji nespustí (nový typ funkce bez pravidla by test shodil)
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'se_vezmou'::regnamespace
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c = 'search_path=""');
  perform tap.ok(v_bad is null, 'každá funkce schématu má prázdný search_path (porušuje: ' || coalesce(v_bad, '-') || ')');

  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'se_vezmou'::regnamespace
     and (p.proacl is null
          or exists (select 1 from aclexplode(p.proacl) acl where acl.grantee = 0)
          or has_function_privilege('anon', p.oid, 'execute'));
  perform tap.ok(v_bad is null, 'žádná funkce schématu nemá execute pro PUBLIC ani anon (porušuje: ' || coalesce(v_bad, '-') || ')');

  -- 10c. seznam podle názvu: provozní funkce životního cyklu, retence a běhů úloh, interní obaly a pomocné funkce
  --      nesmí spustit správce ani host (authenticated). Nová funkce s těmito předponami musí projít.
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'se_vezmou'::regnamespace
     and (p.proname like 'lifecycle\_%' or p.proname like 'job\_run\_%' or p.proname like 'retention\_%'
          or p.proname like 'purge\_%' or p.proname like '%\_impl' or p.proname like 'op\_%'
          or p.proname in ('housekeeping', 'clock_guard', 'assert_operator', 'write_audit',
                           'app_setting_bounds', 'app_setting_valid', 'email_status_rank'))
     and has_function_privilege('authenticated', p.oid, 'execute');
  perform tap.ok(v_bad is null, 'lifecycle_*, job_run_*, retention_*, purge_*, *_impl, op_* a pomocné funkce nemá authenticated (porušuje: ' || coalesce(v_bad, '-') || ')');

  -- *_impl (tělo funkcí za obalem s clock_guard) nespustí nikdo, ani service_role
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'se_vezmou'::regnamespace and p.proname like '%\_impl'
     and (has_function_privilege('service_role', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  perform tap.ok(v_bad is null, 'interní *_impl funkce nespustí service_role ani authenticated (porušuje: ' || coalesce(v_bad, '-') || ')');

  -- 11. správce nikdy nečte hashe PINů ani nemění citlivé sloupce svatby
  perform tap.ok(not has_column_privilege('authenticated', 'se_vezmou.wedding_auth', 'admin_pin_hash', 'select'),
    'správce nemá SELECT na admin_pin_hash');
  perform tap.ok(not has_column_privilege('authenticated', 'se_vezmou.wedding_auth', 'guest_pin_hash', 'select'),
    'správce nemá SELECT na guest_pin_hash');
  perform tap.ok(not has_column_privilege('authenticated', 'se_vezmou.weddings', 'status', 'update'),
    'správce nemůže měnit status svatby');
  perform tap.ok(not has_column_privilege('authenticated', 'se_vezmou.weddings', 'slug', 'update'),
    'správce nemůže měnit slug');
  perform tap.ok(not has_column_privilege('authenticated', 'se_vezmou.weddings', 'id', 'update'),
    'správce nemůže měnit identifikátor svatby');
  perform tap.ok(not has_table_privilege('authenticated', 'se_vezmou.weddings', 'insert')
                 and not has_table_privilege('authenticated', 'se_vezmou.weddings', 'delete'),
    'správce nezakládá ani nemaže svatby');

  -- 12. audit_log je append-only: žádná role nemá update, delete ani truncate
  perform tap.ok(not (has_table_privilege('authenticated', 'se_vezmou.audit_log', 'update')
                      or has_table_privilege('authenticated', 'se_vezmou.audit_log', 'delete')
                      or has_table_privilege('authenticated', 'se_vezmou.audit_log', 'truncate')
                      or has_table_privilege('authenticated', 'se_vezmou.audit_log', 'insert')),
    'authenticated nemá zápisová práva k audit_log');
  perform tap.ok(not (has_table_privilege('service_role', 'se_vezmou.audit_log', 'update')
                      or has_table_privilege('service_role', 'se_vezmou.audit_log', 'delete')
                      or has_table_privilege('service_role', 'se_vezmou.audit_log', 'truncate')
                      or has_table_privilege('service_role', 'se_vezmou.audit_log', 'insert')),
    'service_role nemá zápisová práva k audit_log (zapisuje jen funkce)');

  -- 13. service_role nemá přímý přístup k tenant datům ani k relacím (jen přes funkce)
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c
   where c.relnamespace = 'se_vezmou'::regnamespace and c.relkind = 'r'
     and c.relname not in ('analytics_event', 'email_log', 'waitlist')
     and has_any_column_privilege('service_role', c.oid, 'select, insert, update, references');
  perform tap.ok(v_bad is null, 'service_role nemá přímá práva k tabulkám mimo analytiku, e-mail a waitlist (porušuje: ' || coalesce(v_bad, '-') || ')');
end
$$;

-- 14. app_settings a rezervovaná slova: výchozí hodnoty z kap. 3.9 a 3.1
do $$
begin
  perform tap.ok((select value from se_vezmou.app_settings where key = 'max_admins') = '3', 'max_admins = 3');
  perform tap.ok((select value from se_vezmou.app_settings where key = 'slug_reservation_days') = '30', 'slug_reservation_days = 30');
  perform tap.ok((select value from se_vezmou.app_settings where key = 'health_retention_days_after_wedding') = '30', 'retence zdravotních údajů 30 dní');
  perform tap.ok((select value from se_vezmou.app_settings where key = 'guest_retention_months_after_wedding') = '3', 'retence údajů hostů 3 měsíce');
  perform tap.ok((select count(*) from se_vezmou.slug_registry where state = 'reserved_word') >= 9, 'rezervovaná slova jsou nasazena');
  perform tap.ok(exists (select 1 from se_vezmou.slug_registry where slug = 'www' and state = 'reserved_word'), 'www je rezervované slovo');
end
$$;

rollback;
