-- se-vezmou.cz: inicializace schématu se_vezmou na sdíleném Supabase projektu.
--
-- Spusťte JEDNOU v Supabase SQL editoru (role postgres). Skript je idempotentní.
-- Nevytváří žádné tabulky (ty přijdou migracemi do schématu se_vezmou) a nesahá do schémat
-- public, auth, storage ani do globálních výchozích oprávnění. Jediné, co ovlivní mimo
-- vlastní schéma: seznam schémat vystavených přes PostgREST (jen se k němu přidá se_vezmou).

-- 1) Schéma projektu. Všechny objekty aplikace (tabulky, funkce, typy, triggery, pomocné
--    funkce) žijí jen tady.
create schema if not exists se_vezmou;
comment on schema se_vezmou is 'se-vezmou.cz: data aplikace. Nic z tohoto projektu nepatří do jiného schématu.';

-- 2) Rozšíření. Instalují se do sdíleného schématu extensions (jako to dělá Supabase);
--    aplikace do něj nic jiného nezakládá. "if not exists" nezmění už nainstalovaná.
create schema if not exists extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- 3) Oprávnění: co není výslovně povoleno, je zakázáno.
--    Role anon, authenticated a service_role jsou sdílené v celém projektu, proto jim
--    dáváme práva jen k našemu schématu. Prohlížeč nikdy nevolá databázi přímo, takže anon
--    nemá k se_vezmou nic.
revoke all on schema se_vezmou from public, anon;
grant usage on schema se_vezmou to authenticated, service_role;

-- Výchozí oprávnění nově vytvářených objektů, jen v našem schématu (klauzule IN SCHEMA, takže
-- se nemění nic globálně): žádná automatická práva. Každá migrace uděluje jen potřebné.
alter default privileges in schema se_vezmou revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema se_vezmou revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges in schema se_vezmou revoke all on functions from public, anon, authenticated, service_role;

-- 4) Zveřejnění schématu pro PostgREST (API Supabase), aby šlo volat funkce přes
--    db: { schema: 'se_vezmou' }. Přidá se k existujícímu seznamu, nic se nepřepisuje.
--    Totéž je v Dashboardu: Settings, API, Exposed schemas. Pokud by příkaz níže selhal na
--    oprávnění, přidejte schéma tam ručně.
do $$
declare
  current_list text;
begin
  select coalesce(
    (select substring(s from '^pgrst\.db_schemas=(.*)$')
       from pg_db_role_setting d
       join pg_roles r on r.oid = d.setrole,
       unnest(d.setconfig) as s
      where r.rolname = 'authenticator'
        and s like 'pgrst.db_schemas=%'
      limit 1),
    'public,graphql_public'
  ) into current_list;

  if current_list !~ '(^|,)\s*se_vezmou\s*(,|$)' then
    execute format('alter role authenticator set pgrst.db_schemas = %L', current_list || ',se_vezmou');
  end if;
end
$$;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';

-- 5) Kontrola (výsledek by měl obsahovat se_vezmou ve všech třech řádcích).
select 'schema existuje' as kontrola, exists (select 1 from pg_namespace where nspname = 'se_vezmou') as ok
union all
select 'schema je vystaveno pro PostgREST',
       coalesce((select bool_or(s like 'pgrst.db_schemas=%se_vezmou%')
                   from pg_db_role_setting d
                   join pg_roles r on r.oid = d.setrole,
                   unnest(d.setconfig) as s
                  where r.rolname = 'authenticator'), false)
union all
select 'service_role smí používat schema', has_schema_privilege('service_role', 'se_vezmou', 'usage')
union all
select 'anon nesmí používat schema', not has_schema_privilege('anon', 'se_vezmou', 'usage');
