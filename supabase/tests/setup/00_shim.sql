-- Testovací shim: minimální náhrada platformy Supabase, aby migrace běžely na čistém PostgreSQL 16.
-- NENASAZUJE SE (leží mimo supabase/migrations). Spouští ho jen scripts/db-test.sh před migracemi.
--
-- Napodobuje jen to, co migrace a testy skutečně potřebují:
--  * role anon, authenticated, service_role (service_role s bypassrls jako na Supabase),
--  * schéma auth s tabulkou auth.users a funkcemi auth.jwt() a auth.uid() (čtou claimy z
--    request.jwt.claims jako PostgREST),
--  * schéma extensions a výchozí oprávnění, která Supabase uděluje novým objektům ve schématu
--    public (migrace je mají výslovně zrušit, test to ověřuje).
-- Skript je idempotentní (role jsou v clusteru společné pro všechny databáze).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

create schema if not exists auth;
create schema if not exists extensions;
grant usage on schema auth, extensions to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  created_at timestamptz not null default now()
);

create or replace function auth.jwt() returns jsonb
  language sql stable
  as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create or replace function auth.uid() returns uuid
  language sql stable
  as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;

grant execute on function auth.jwt(), auth.uid() to anon, authenticated, service_role;

-- Supabase uděluje novým tabulkám, sekvencím a funkcím ve schématu public všechna práva
-- rolím anon, authenticated a service_role. Migrace to musí zrušit.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
