-- M3 / 1: základ schématu (schéma se_vezmou, rozšíření, oprávnění, doména i18n_text, pomocné funkce).
--
-- Zdroj: docs/data-model.md (kap. 1, 5.1, 5.2, 9), docs/adr/0001-database.md, docs/adr/0011-dedicated-schema-direct-pg.md.
-- Pořadí migrací určuje časová předpona v názvu souboru. Aplikuje je vlastník (role postgres) nástrojem
-- `npm run db:migrate` (scripts/db-migrate.mjs); lokálně a v CI scripts/db-test.sh a scripts/e2e-db.sh.
--
-- ZÁSADA: sdílený projekt Supabase. Migrace vytvářejí a mění VÝHRADNĚ schéma `se_vezmou` a v něm
-- objekty. Nic ve schématech public, auth, storage ani žádná globální oprávnění (proto žádný
-- `alter default privileges` bez `in schema se_vezmou` a žádný grant/revoke na schéma public).
-- Jediný dotek mimo schéma jsou rozšíření ve schématu extensions (jen `if not exists`).
-- Migrace předpokládají role anon, authenticated a service_role (Supabase); lokálně je dodává
-- testovací shim supabase/tests/setup/00_shim.sql, který se nenasazuje.

-- ---------------------------------------------------------------------------
-- Schéma a rozšíření (stejné jako supabase/init/00_init_se_vezmou.sql, idempotentně: kdo init
-- neprovedl, dostane totéž; kdo ho provedl, nezmění se nic). Rozšíření žijí ve schématu extensions,
-- proto se typy a funkce kvalifikují (extensions.citext, extensions.similarity). Funkce mají
-- prázdný search_path.
-- ---------------------------------------------------------------------------
create schema if not exists se_vezmou;
comment on schema se_vezmou is 'se-vezmou.cz: data aplikace. Nic z tohoto projektu nepatří do jiného schématu.';

create schema if not exists extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Oprávnění: co není výslovně povoleno, je zakázáno. Role anon, authenticated a service_role jsou
-- sdílené v celém projektu, proto jim dáváme práva jen k našemu schématu. Prohlížeč nikdy
-- nevolá databázi přímo, takže anon nemá k se_vezmou nic.
-- Výchozí oprávnění jen IN SCHEMA se_vezmou (pro roli, která migrace spouští): žádná automatická
-- práva. Každá migrace uděluje jen potřebné. Pozor: ALTER DEFAULT PRIVILEGES IN SCHEMA neodebere
-- globální výchozí EXECUTE pro PUBLIC u funkcí, proto každá funkce níže výslovně
-- `revoke all ... from public`.
-- ---------------------------------------------------------------------------
revoke all on schema se_vezmou from public, anon;
grant usage on schema se_vezmou to authenticated, service_role;

alter default privileges in schema se_vezmou revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema se_vezmou revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges in schema se_vezmou revoke all on functions from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Doména i18n_text (kap. 9): jsonb s klíči jen z {cs, en}.
-- ---------------------------------------------------------------------------
create domain se_vezmou.i18n_text as jsonb
  check (
    value is null
    or (jsonb_typeof(value) = 'object' and (value - array['cs', 'en']) = '{}'::jsonb)
  );

-- ---------------------------------------------------------------------------
-- Pomocné funkce pro claimy (kap. 5.2). Aplikace v každé transakci nastaví
-- `set local role authenticated` a `select set_config('request.jwt.claims', <json>, true)`
-- (src/lib/db/transport.ts); funkce čtou přesně tuto nastavovanou hodnotu, nezávisle na schématu auth.
-- Je to jediné místo, které by se měnilo při změně způsobu předávání claimů (ADR 0001, ADR 0011).
-- ---------------------------------------------------------------------------
create function se_vezmou.jwt_claims() returns jsonb
  language sql stable set search_path = ''
  as $$
  select coalesce(nullif(pg_catalog.current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create function se_vezmou.actor_id() returns uuid
  language sql stable set search_path = ''
  as $$ select nullif(se_vezmou.jwt_claims() ->> 'sub', '')::uuid $$;

create function se_vezmou.wedding_id() returns uuid
  language sql stable set search_path = ''
  as $$ select nullif(se_vezmou.jwt_claims() ->> 'wedding_id', '')::uuid $$;

create function se_vezmou.wedding_role() returns text
  language sql stable set search_path = ''
  as $$ select se_vezmou.jwt_claims() ->> 'wedding_role' $$;

create function se_vezmou.is_wedding_admin() returns boolean
  language sql stable set search_path = ''
  as $$ select se_vezmou.wedding_role() = 'admin' and se_vezmou.wedding_id() is not null $$;

revoke all on function se_vezmou.jwt_claims(), se_vezmou.actor_id(), se_vezmou.wedding_id(),
  se_vezmou.wedding_role(), se_vezmou.is_wedding_admin() from public, anon;
grant execute on function se_vezmou.jwt_claims(), se_vezmou.actor_id(), se_vezmou.wedding_id(),
  se_vezmou.wedding_role(), se_vezmou.is_wedding_admin()
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Spouštěč updated_at (všechny tabulky s tímto sloupcem, viz migrace spouštěčů).
-- ---------------------------------------------------------------------------
create function se_vezmou.touch_updated_at() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end
$$;

revoke all on function se_vezmou.touch_updated_at() from public, anon;

-- ---------------------------------------------------------------------------
-- Normalizace jmen pro slepé ověření (kap. 3.4). Jediná implementace v SQL.
-- Unicode NFKD, odstranění kombinujících znamének (diakritiky), malá písmena,
-- odstraněné apostrofy, interpunkce a mezery převedené na jednu mezeru.
-- Zlaté vektory: supabase/tests/golden/name-vectors.tsv.
-- ---------------------------------------------------------------------------
create function se_vezmou.normalize_name(p_name text) returns text
  language sql immutable strict parallel safe set search_path = ''
  as $$
  select btrim(
    regexp_replace(
      regexp_replace(
        lower(regexp_replace(normalize(p_name, nfkd), '[̀-ͯ]', '', 'g')),
        '[''’´`]', '', 'g'),
      '[[:punct:][:space:]]+', ' ', 'g'))
$$;

-- Normalizovaný tvar s tokeny seřazenými abecedně ("Novák Matěj" = "Matěj Novák").
create function se_vezmou.name_key(p_name text) returns text
  language sql immutable strict parallel safe set search_path = ''
  as $$
  select coalesce(string_agg(t, ' ' order by t collate "C"), '')
  from regexp_split_to_table(se_vezmou.normalize_name(p_name), ' ') as t
  where t <> ''
$$;

revoke all on function se_vezmou.normalize_name(text), se_vezmou.name_key(text) from public, anon;
grant execute on function se_vezmou.normalize_name(text), se_vezmou.name_key(text) to authenticated, service_role;
