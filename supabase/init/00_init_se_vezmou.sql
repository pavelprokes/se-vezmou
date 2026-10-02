-- se-vezmou.cz: inicializace schématu se_vezmou na sdíleném Supabase projektu.
--
-- Spusťte JEDNOU v Supabase SQL editoru (role postgres). Skript je idempotentní.
-- Nevytváří žádné tabulky (ty přijdou migracemi do schématu se_vezmou) a nesahá do schémat
-- public, auth, storage ani do globálních výchozích oprávnění ani do nastavení rolí
-- (zejména nepřepisuje pgrst.db_schemas: PostgREST aplikace nepoužívá, ADR 0011, OQ-46).

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

-- 4) Kontrola (všechny řádky musí mít ok = true).
select 'schema existuje' as kontrola, exists (select 1 from pg_namespace where nspname = 'se_vezmou') as ok
union all
select 'service_role smí používat schema', has_schema_privilege('service_role', 'se_vezmou', 'usage')
union all
select 'anon nesmí používat schema', not has_schema_privilege('anon', 'se_vezmou', 'usage');
