-- M3 / 1: základ schématu (rozšíření, schéma app, výchozí oprávnění, doména i18n_text, pomocné funkce).
--
-- Zdroj: docs/data-model.md (kap. 1, 5.1, 5.2, 9), docs/adr/0001-database.md.
-- Pořadí migrací určuje časová předpona v názvu souboru. Migrace předpokládají Supabase
-- (role anon, authenticated, service_role, schéma auth a extensions). Lokálně na čistém
-- PostgreSQL je dodává jen testovací shim supabase/tests/setup/00_shim.sql, který se nenasazuje.

-- ---------------------------------------------------------------------------
-- Rozšíření. Na Supabase žijí ve schématu extensions, proto se typy a funkce kvalifikují
-- (extensions.citext, extensions.similarity). Funkce security definer mají prázdný search_path.
-- ---------------------------------------------------------------------------
create schema if not exists extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Schéma app: interní pomocné funkce. Není vystavené přes PostgREST (jen schéma public).
-- ---------------------------------------------------------------------------
create schema if not exists app;

-- ---------------------------------------------------------------------------
-- Výchozí oprávnění: co se nepovolí výslovně, je zakázáno.
-- Supabase standardně uděluje anon, authenticated i service_role vše na nové tabulky
-- a funkce ve schématu public. Tady to zrušíme; každá migrace uděluje jen potřebné.
-- Pozor: ALTER DEFAULT PRIVILEGES se týká jen objektů vytvořených TÍMTO a dalšími
-- migracemi (rozšíření výše už vznikla).
-- ---------------------------------------------------------------------------
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges in schema public revoke all on functions from anon, authenticated, service_role;
alter default privileges in schema app revoke all on tables from anon, authenticated, service_role;
alter default privileges in schema app revoke all on functions from anon, authenticated, service_role;

-- Role anon nemá žádná práva na schéma public (prohlížeč nikdy nevolá databázi přímo).
revoke all on schema public from public, anon;
grant usage on schema public to authenticated, service_role;
-- Schéma app potřebují role, jejichž politiky a spouštěče volají pomocné funkce.
revoke all on schema app from public, anon;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Doména i18n_text (kap. 9): jsonb s klíči jen z {cs, en}.
-- ---------------------------------------------------------------------------
create domain public.i18n_text as jsonb
  check (
    value is null
    or (jsonb_typeof(value) = 'object' and (value - array['cs', 'en']) = '{}'::jsonb)
  );

-- ---------------------------------------------------------------------------
-- Pomocné funkce pro claimy JWT (kap. 5.2).
-- Podle ADR 0001 jde o jediné místo, které se změní při přechodu na variantu Neon
-- (auth.jwt() -> current_setting('app.wedding_id')).
-- ---------------------------------------------------------------------------
create function app.wedding_id() returns uuid
  language sql stable set search_path = ''
  as $$ select nullif(auth.jwt() ->> 'wedding_id', '')::uuid $$;

create function app.wedding_role() returns text
  language sql stable set search_path = ''
  as $$ select auth.jwt() ->> 'wedding_role' $$;

create function app.is_wedding_admin() returns boolean
  language sql stable set search_path = ''
  as $$ select app.wedding_role() = 'admin' and app.wedding_id() is not null $$;

revoke all on function app.wedding_id(), app.wedding_role(), app.is_wedding_admin() from public, anon;
grant execute on function app.wedding_id(), app.wedding_role(), app.is_wedding_admin()
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Spouštěč updated_at (všechny tabulky s tímto sloupcem, viz migrace spouštěčů).
-- ---------------------------------------------------------------------------
create function app.touch_updated_at() returns trigger
  language plpgsql set search_path = ''
  as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end
$$;

revoke all on function app.touch_updated_at() from public, anon;

-- ---------------------------------------------------------------------------
-- Normalizace jmen pro slepé ověření (kap. 3.4). Jediná implementace v SQL.
-- Unicode NFKD, odstranění kombinujících znamének (diakritiky), malá písmena,
-- odstraněné apostrofy, interpunkce a mezery převedené na jednu mezeru.
-- Zlaté vektory: supabase/tests/golden/name-vectors.tsv.
-- ---------------------------------------------------------------------------
create function app.normalize_name(p_name text) returns text
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
create function app.name_key(p_name text) returns text
  language sql immutable strict parallel safe set search_path = ''
  as $$
  select coalesce(string_agg(t, ' ' order by t collate "C"), '')
  from regexp_split_to_table(app.normalize_name(p_name), ' ') as t
  where t <> ''
$$;

revoke all on function app.normalize_name(text), app.name_key(text) from public, anon;
grant execute on function app.normalize_name(text), app.name_key(text) to authenticated, service_role;
