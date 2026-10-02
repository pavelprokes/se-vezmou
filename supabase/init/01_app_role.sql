-- se-vezmou.cz: aplikační role se_vezmou_app.
--
-- STAV: majitel projektu už 00_init_se_vezmou.sql i tento skript provedl na sdíleném projektu
-- Supabase. V repozitáři jsou jako záznam toho, co v databázi je, a pro nový projekt či obnovu.
-- Expozice schématu se_vezmou pro PostgREST (poslední krok 00_init_se_vezmou.sql) je kvůli
-- přímému spojení `pg` (ADR 0011) NEPOVINNÁ: aplikace PostgREST ani supabase-js nepoužívá.
--
-- Spouští se JEDNOU v Supabase SQL editoru (role postgres). Skript je idempotentní.
--
-- !!! HESLO NÍŽE JE ZÁSTUPNÉ. Nikdy do repozitáře nepište skutečné heslo. Při spuštění ho nahraďte
-- !!! silným náhodným heslem (min. 32 znaků, jen písmena a číslice kvůli URL) a uložte ho jen do
-- !!! DATABASE_URL na Vercelu (viz supabase/README.md). Po spuštění v editoru heslo z historie
-- !!! dotazů smažte, případně ho hned změňte: alter role se_vezmou_app password '...';
--
-- Model: role sama nemá k ničemu žádná práva (noinherit, nic nevlastní, na schéma se_vezmou nemá
-- usage). Je členem rolí authenticated a service_role JEN proto, aby mohla v transakci udělat
-- `set local role ...`; teprve tyto role mají (omezená) práva ve schématu se_vezmou. Zapomenuté
-- `set role` proto skončí chybou oprávnění, ne únikem dat (docs/security-privacy.md).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'se_vezmou_app') then
    create role se_vezmou_app login noinherit nobypassrls password 'ZASTUPNE-HESLO-NIKDY-NEPOUZIVAT';
  end if;
end
$$;

-- Atributy se vynutí i pro už existující roli (heslo se nemění).
alter role se_vezmou_app with login noinherit nobypassrls nosuperuser nocreatedb nocreaterole noreplication;

-- Členství kvůli `set role`. Žádný admin option, žádné další role.
grant authenticated, service_role to se_vezmou_app;

-- Pojistky proti zapomenutým transakcím a dlouhým dotazům (platí jen pro tuto roli).
alter role se_vezmou_app set statement_timeout = '30s';
alter role se_vezmou_app set idle_in_transaction_session_timeout = '30s';

-- Kontrola (všechny řádky mají být true).
select 'role existuje' as kontrola, exists (select 1 from pg_roles where rolname = 'se_vezmou_app') as ok
union all
select 'role je noinherit, nobypassrls a není superuživatel',
       (select not rolinherit and not rolbypassrls and not rolsuper from pg_roles where rolname = 'se_vezmou_app')
union all
select 'smí set role authenticated', pg_has_role('se_vezmou_app', 'authenticated', 'member')
union all
select 'smí set role service_role', pg_has_role('se_vezmou_app', 'service_role', 'member')
union all
select 'sama nemá usage na schéma se_vezmou',
       not exists (
         select 1 from pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
          where n.nspname = 'se_vezmou' and a.grantee = (select oid from pg_roles where rolname = 'se_vezmou_app')
       );
