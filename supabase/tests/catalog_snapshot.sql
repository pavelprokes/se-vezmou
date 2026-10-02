-- Snímek katalogu PostgreSQL pro test izolace migrací (scripts/db-test.sh, docs/adr/0011).
-- Vypíše seřazené textové řádky o VŠEM, co existuje mimo schéma se_vezmou: schémata a jejich ACL,
-- tabulky, sloupce, omezení, spouštěče, politiky, funkce, typy, operátory, výchozí oprávnění
-- (pg_default_acl, i globální), role a členství, nastavení rolí, rozšíření, event triggery, publikace.
-- Skript se spouští před migracemi a po nich; rozdíl smí obsahovat jen objekty nově instalovaných
-- rozšíření (poslední sloupec `ext=`). NENASAZUJE SE a nic nemění (jen čte katalog).
--
-- Spuštění: psql -X -At -f supabase/tests/catalog_snapshot.sql
\pset tuples_only on
\pset format unaligned

with excluded(nsp) as (
  select oid from pg_namespace
   where nspname in ('pg_catalog', 'information_schema', 'se_vezmou')
      or nspname like 'pg\_toast%' or nspname like 'pg\_temp%'
),
ext_of as (
  select d.classid, d.objid, e.extname
    from pg_depend d join pg_extension e on e.oid = d.refobjid
   where d.deptype = 'e' and d.refclassid = 'pg_extension'::regclass
),
lines(l) as (
  -- schémata včetně vlastníka a ACL (public, extensions, auth, ...)
  select format('namespace|%s|owner=%s|acl=%s', n.nspname, pg_get_userbyid(n.nspowner), coalesce(n.nspacl::text, 'default'))
    from pg_namespace n where n.oid not in (select nsp from excluded) and n.nspname <> 'se_vezmou'
  union all
  -- tabulky, sekvence, indexy, pohledy mimo naše schéma
  select format('class|%s.%s|kind=%s|owner=%s|acl=%s|opts=%s|rls=%s|force=%s|ext=%s',
                n.nspname, c.relname, c.relkind, pg_get_userbyid(c.relowner), coalesce(c.relacl::text, 'default'),
                coalesce(c.reloptions::text, ''), c.relrowsecurity, c.relforcerowsecurity,
                coalesce((select string_agg(x.extname, ',') from ext_of x where x.classid = 'pg_class'::regclass and x.objid = c.oid), ''))
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.oid not in (select nsp from excluded)
  union all
  select format('attribute|%s.%s|%s|%s|%s|notnull=%s|default=%s',
                n.nspname, c.relname, a.attnum, a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
                coalesce(pg_get_expr(d.adbin, d.adrelid), ''))
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where n.oid not in (select nsp from excluded) and a.attnum > 0 and not a.attisdropped
  union all
  -- omezení na tabulkách mimo naše schéma I omezení v našem schématu, která míří ven (cizí klíč na auth.users)
  select format('constraint|%s.%s|%s|%s', n.nspname, c.relname, k.conname, pg_get_constraintdef(k.oid))
    from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
   where n.oid not in (select nsp from excluded)
  union all
  -- spouštěče na tabulkách mimo naše schéma (vč. interních spouštěčů cizích klíčů mířících na ně)
  select format('trigger|%s.%s|%s|internal=%s|%s', n.nspname, c.relname, t.tgname, t.tgisinternal, pg_get_triggerdef(t.oid))
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
   where n.oid not in (select nsp from excluded)
  union all
  select format('policy|%s.%s|%s|%s', n.nspname, c.relname, p.polname, p.polcmd)
    from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
   where n.oid not in (select nsp from excluded)
  union all
  select format('proc|%s.%s(%s)|owner=%s|acl=%s|secdef=%s|config=%s|ext=%s',
                n.nspname, p.proname, pg_get_function_identity_arguments(p.oid), pg_get_userbyid(p.proowner),
                coalesce(p.proacl::text, 'default'), p.prosecdef, coalesce(p.proconfig::text, ''),
                coalesce((select string_agg(x.extname, ',') from ext_of x where x.classid = 'pg_proc'::regclass and x.objid = p.oid), ''))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.oid not in (select nsp from excluded)
  union all
  select format('type|%s.%s|kind=%s|owner=%s|acl=%s|ext=%s',
                n.nspname, t.typname, t.typtype, pg_get_userbyid(t.typowner), coalesce(t.typacl::text, 'default'),
                coalesce((select string_agg(x.extname, ',') from ext_of x where x.classid = 'pg_type'::regclass and x.objid = case when t.typcategory = 'A' then t.typelem else t.oid end), ''))
    from pg_type t join pg_namespace n on n.oid = t.typnamespace
   where n.oid not in (select nsp from excluded)
     and (t.typrelid = 0 or (select c.relkind from pg_class c where c.oid = t.typrelid) = 'c')
  union all
  select format('operator|%s.%s(%s,%s)|ext=%s', n.nspname, o.oprname, o.oprleft::regtype, o.oprright::regtype,
                coalesce((select string_agg(x.extname, ',') from ext_of x where x.classid = 'pg_operator'::regclass and x.objid = o.oid), ''))
    from pg_operator o join pg_namespace n on n.oid = o.oprnamespace
   where n.oid not in (select nsp from excluded)
  union all
  select format('opclass|%s.%s|ext=%s', n.nspname, o.opcname,
                coalesce((select string_agg(x.extname, ',') from ext_of x where x.classid = 'pg_opclass'::regclass and x.objid = o.oid), ''))
    from pg_opclass o join pg_namespace n on n.oid = o.opcnamespace
   where n.oid not in (select nsp from excluded)
  union all
  select format('collation|%s.%s', n.nspname, c.collname)
    from pg_collation c join pg_namespace n on n.oid = c.collnamespace
   where n.oid not in (select nsp from excluded)
  -- výchozí oprávnění: všechny řádky, kromě těch výslovně ve schématu se_vezmou (smějí vzniknout)
  union all
  select format('default_acl|role=%s|schema=%s|objtype=%s|acl=%s', pg_get_userbyid(d.defaclrole),
                coalesce((select nspname from pg_namespace where oid = d.defaclnamespace), '(global)'),
                d.defaclobjtype, d.defaclacl::text)
    from pg_default_acl d
   where d.defaclnamespace = 0 or d.defaclnamespace in (select oid from pg_namespace where nspname <> 'se_vezmou')
  -- role, členství a nastavení rolí
  union all
  select format('role|%s|super=%s|inherit=%s|createrole=%s|createdb=%s|login=%s|repl=%s|bypassrls=%s|connlimit=%s',
                r.rolname, r.rolsuper, r.rolinherit, r.rolcreaterole, r.rolcreatedb, r.rolcanlogin, r.rolreplication,
                r.rolbypassrls, r.rolconnlimit)
    from pg_roles r where r.rolname !~ '^pg_'
  union all
  select format('membership|%s|member_of=%s|admin=%s|inherit=%s|set=%s', pg_get_userbyid(m.member), pg_get_userbyid(m.roleid),
                m.admin_option, m.inherit_option, m.set_option)
    from pg_auth_members m
   where pg_get_userbyid(m.roleid) !~ '^pg_' and pg_get_userbyid(m.member) !~ '^pg_'
  union all
  select format('role_setting|%s|db=%s|%s', coalesce((select rolname from pg_roles where oid = s.setrole), '(all)'),
                s.setdatabase, s.setconfig::text)
    from pg_db_role_setting s
  union all
  select format('extension|%s|schema=%s|version=%s|ext=%s', e.extname, n.nspname, e.extversion, e.extname)
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  union all
  select format('event_trigger|%s|%s', e.evtname, e.evtevent) from pg_event_trigger e
  union all
  select format('publication|%s', p.pubname) from pg_publication p
)
select l from lines order by l;
