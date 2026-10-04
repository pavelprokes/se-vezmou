#!/usr/bin/env bash
# Test nástroje pro nasazení migrací (scripts/db-migrate.mjs, `npm run db:migrate`).
#
# Ověřuje na čistém PostgreSQL 16 (stejně jako scripts/db-test.sh: dočasný cluster přes unixový socket,
# nebo služba přes DATABASE_URL s MIGRATE_TEST_ALLOW_RESET=1, která SMAŽE schémata public, se_vezmou, auth,
# extensions a tap):
#  - odmítnutí bez MIGRATE_DATABASE_URL, s aplikační rolí a s transaction poolerem (port 6543),
#  - --dry-run nic nezapíše, ostrý běh aplikuje všechny migrace a eviduje je včetně sha256,
#  - opakované spuštění je idempotentní, --status hlásí stav,
#  - změněný checksum aplikované migrace, chybějící a starší migrace, destruktivní příkazy se odmítnou,
#  - selhání migrace ji vrátí zpět a nezapíše do evidence,
#  - po běhu nástroje procházejí strukturální testy (evidenční tabulka má RLS a žádná práva rolím),
#  - nástroj nic nesmazal (počty řádků po opakovaném běhu stejné).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DB_DIR=""
BIN=""
PG_RUN=()
# Rozbaluje se jako ${PG_RUN[@]+"${PG_RUN[@]}"}: bash 3.2 (macOS) bere prázdné pole pod `set -u` jako nedefinované.
TMP_DIR=""

log() { printf '%s\n' "$*" >&2; }
die() { log "CHYBA: $*"; exit 1; }

# Adresář se serverem: initdb i postgres (Homebrew `libpq` má initdb bez serveru).
has_server() { [[ -x "$1/initdb" && -x "$1/postgres" ]]; }

find_pg_bin() {
  if [[ -n "${PG_BIN:-}" ]] && has_server "$PG_BIN"; then printf '%s' "$PG_BIN"; return; fi
  local d
  for d in /usr/lib/postgresql/16/bin /usr/lib/postgresql/*/bin /usr/local/pgsql/bin /opt/homebrew/opt/postgresql@{16,17,18}/bin /usr/local/opt/postgresql@{16,17,18}/bin; do
    if has_server "$d"; then printf '%s' "$d"; return; fi
  done
  return 1
}

cleanup() {
  local code=$?
  if [[ -n "$TMP_DIR" ]]; then rm -rf "$TMP_DIR"; fi
  if [[ -n "$DB_DIR" && -d "$DB_DIR" ]]; then
    if [[ -f "$DB_DIR/data/postmaster.pid" ]]; then
      ${PG_RUN[@]+"${PG_RUN[@]}"} "$BIN/pg_ctl" -D "$DB_DIR/data" -m immediate -w stop >/dev/null 2>&1 || true
    fi
    rm -rf "$DB_DIR"
  fi
  exit "$code"
}
trap cleanup EXIT

if [[ -n "${DATABASE_URL:-}" ]]; then
  [[ "${MIGRATE_TEST_ALLOW_RESET:-}" == "1" ]] \
    || die "DATABASE_URL je zadáno: skript v ní smaže schémata public, se_vezmou, auth, extensions a tap. Potvrďte MIGRATE_TEST_ALLOW_RESET=1."
  URL="$DATABASE_URL"
else
  BIN="$(find_pg_bin)" || die "Nenašel jsem binárky PostgreSQL (initdb). Nastavte PG_BIN nebo DATABASE_URL."
  DB_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sevezmou-migrate-pg.XXXXXX")"
  if [[ "$(id -u)" -eq 0 ]]; then
    command -v runuser >/dev/null 2>&1 || die "Pod rootem je potřeba runuser."
    chown postgres "$DB_DIR"
    PG_RUN=(runuser -u postgres --)
    if ! ${PG_RUN[@]+"${PG_RUN[@]}"} test -w "$DB_DIR"; then
      rm -rf "$DB_DIR"
      DB_DIR="$(mktemp -d /tmp/sevezmou-migrate-pg.XXXXXX)"
      chown postgres "$DB_DIR"
    fi
  fi
  if ! ${PG_RUN[@]+"${PG_RUN[@]}"} "$BIN/initdb" -D "$DB_DIR/data" -A trust -U postgres -E UTF8 --locale=C.UTF-8 >"$DB_DIR/initdb.log" 2>&1; then
    rm -rf "$DB_DIR/data"
    ${PG_RUN[@]+"${PG_RUN[@]}"} "$BIN/initdb" -D "$DB_DIR/data" -A trust -U postgres -E UTF8 --locale=C >"$DB_DIR/initdb.log" 2>&1 \
      || { cat "$DB_DIR/initdb.log" >&2; die "initdb selhal."; }
  fi
  ${PG_RUN[@]+"${PG_RUN[@]}"} "$BIN/pg_ctl" -D "$DB_DIR/data" -l "$DB_DIR/server.log" -w \
    -o "-k $DB_DIR -c listen_addresses= -c fsync=off -c synchronous_commit=off -c full_page_writes=off" start >/dev/null
  URL="postgresql://postgres@/postgres?host=$DB_DIR"
fi

if command -v psql >/dev/null 2>&1; then PSQL=psql
elif [[ -n "$BIN" && -x "$BIN/psql" ]]; then PSQL="$BIN/psql"
else die "Nenašel jsem psql."; fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sevezmou-migrate-test.XXXXXX")"
sql() { "$PSQL" "$URL" -X -q -v ON_ERROR_STOP=1 "$@"; }
sqlv() { sql -Atc "$1"; }

FAILED=0
PASSED=0
check() { # popis, podmínka (0 = ok)
  if [[ "$2" -eq 0 ]]; then PASSED=$((PASSED + 1)); log "  OK      $1"; else FAILED=$((FAILED + 1)); log "  SELHALO $1"; fi
}

# spustí nástroj; výstup do $TMP_DIR/out, kód do $RC
migrate() {
  RC=0
  node scripts/db-migrate.mjs "$@" >"$TMP_DIR/out" 2>&1 || RC=$?
}
out_has() { grep -q -- "$1" "$TMP_DIR/out"; }

fresh_db() { # čistá databáze s platformou (shim) a init skripty, jako sdílený projekt po kroku majitele
  sql -c "set client_min_messages = warning; drop schema if exists public cascade; drop schema if exists se_vezmou cascade; drop schema if exists app cascade; drop schema if exists auth cascade; drop schema if exists extensions cascade; drop schema if exists tap cascade; create schema public;" >/dev/null
  for f in supabase/tests/setup/[0-9][0-9]_*.sql supabase/init/[0-9][0-9]_*.sql; do
    PGOPTIONS="-c client_min_messages=warning" sql -f "$f" >/dev/null
  done
}

N_MIG="$(ls supabase/migrations/*.sql | wc -l | tr -d ' ')"
export MIGRATE_DATABASE_URL="$URL"

log "Nástroj db:migrate (migrací v repozitáři: $N_MIG)"
fresh_db

# 1. odmítnutí
RC=0; (unset MIGRATE_DATABASE_URL; node scripts/db-migrate.mjs --dry-run >"$TMP_DIR/out" 2>&1) || RC=$?
check "bez MIGRATE_DATABASE_URL selže s jasnou zprávou" "$([[ $RC -ne 0 ]] && out_has 'Chybí MIGRATE_DATABASE_URL' && echo 0 || echo 1)"

RC=0; MIGRATE_DATABASE_URL="postgresql://se_vezmou_app:x@localhost:5432/postgres" node scripts/db-migrate.mjs >"$TMP_DIR/out" 2>&1 || RC=$?
check "aplikační role se_vezmou_app se odmítne" "$([[ $RC -ne 0 ]] && out_has 'aplikační roli' && echo 0 || echo 1)"
check "heslo se do výstupu nevypíše" "$(out_has ':x@' && echo 1 || echo 0)"

RC=0; MIGRATE_DATABASE_URL="postgresql://postgres:x@pooler.example:6543/postgres" node scripts/db-migrate.mjs >"$TMP_DIR/out" 2>&1 || RC=$?
check "transaction pooler (port 6543) se odmítne" "$([[ $RC -ne 0 ]] && out_has '6543' && echo 0 || echo 1)"

RC=0; MIGRATE_DATABASE_URL="https://projekt.supabase.co" node scripts/db-migrate.mjs >"$TMP_DIR/out" 2>&1 || RC=$?
check "adresa, která není postgresql://, se odmítne" "$([[ $RC -ne 0 ]] && echo 0 || echo 1)"

# 2. dry-run nic nezapíše
migrate --dry-run
check "--dry-run vypíše plán všech $N_MIG migrací" "$([[ $RC -eq 0 ]] && [[ "$(grep -c '\.sql  sha256' "$TMP_DIR/out")" -eq "$N_MIG" ]] && echo 0 || echo 1)"
check "--dry-run nic nezapsal (žádná evidence ani tabulky)" \
  "$([[ "$(sqlv "select count(*) from pg_class where relnamespace = 'se_vezmou'::regnamespace")" -eq 0 ]] && echo 0 || echo 1)"

# 3. ostrý běh
migrate
check "ostrý běh aplikuje všechny migrace" "$([[ $RC -eq 0 ]] && out_has "aplikováno $N_MIG migrací" && echo 0 || echo 1)"
check "evidence obsahuje všechny migrace" "$([[ "$(sqlv 'select count(*) from se_vezmou.schema_migrations')" -eq "$N_MIG" ]] && echo 0 || echo 1)"
SUMS_OK=0
for f in supabase/migrations/*.sql; do
  b="$(basename "$f" .sql)"; v="${b%%_*}"; sum="$(sha256sum "$f" | cut -d' ' -f1)"
  [[ "$(sqlv "select checksum from se_vezmou.schema_migrations where version = '$v'")" == "$sum" ]] || SUMS_OK=1
done
check "checksum v evidenci je sha256 souboru" "$SUMS_OK"
check "globální supabase_migrations se nevytvořila" \
  "$([[ "$(sqlv "select count(*) from pg_namespace where nspname = 'supabase_migrations'")" -eq 0 ]] && echo 0 || echo 1)"

# data pro kontrolu, že se nic nemaže (seed slugů a nastavení)
ROWS_BEFORE="$(sqlv "select (select count(*) from se_vezmou.slug_registry) || ',' || (select count(*) from se_vezmou.app_settings)")"
APPLIED_AT_BEFORE="$(sqlv "select string_agg(applied_at::text, ',' order by version) from se_vezmou.schema_migrations")"

# 4. idempotence a status
migrate
check "opakovaný běh je idempotentní (nic k aplikování)" "$([[ $RC -eq 0 ]] && out_has 'databáze je aktuální' && echo 0 || echo 1)"
check "opakovaný běh nezměnil evidenci ani data" \
  "$([[ "$(sqlv "select string_agg(applied_at::text, ',' order by version) from se_vezmou.schema_migrations")" == "$APPLIED_AT_BEFORE" \
      && "$(sqlv "select (select count(*) from se_vezmou.slug_registry) || ',' || (select count(*) from se_vezmou.app_settings)")" == "$ROWS_BEFORE" ]] && echo 0 || echo 1)"
migrate --status
check "--status hlásí aplikováno $N_MIG z $N_MIG" "$([[ $RC -eq 0 ]] && out_has "Aplikováno $N_MIG z $N_MIG" && echo 0 || echo 1)"

# 5. strukturální testy nad databází vytvořenou nástrojem (evidenční tabulka musí projít kontrolami RLS a práv)
sql -f supabase/tests/helpers.sql >/dev/null 2>&1
STRUCT_OUT="$("$PSQL" "$URL" -X -q -v ON_ERROR_STOP=1 -f supabase/tests/10_structure.test.sql 2>&1)" && RC=0 || RC=$?
check "strukturální testy projdou i s evidenční tabulkou schema_migrations" "$RC"
[[ $RC -eq 0 ]] || printf '%s\n' "$STRUCT_OUT" >&2

# 5b. založení prvního operátora (npm run ops:create-owner) a obnova druhého faktoru (docs/adr/0012)
ops() { RC=0; node scripts/ops-bootstrap.mjs "$@" >"$TMP_DIR/out" 2>&1 || RC=$?; }
ops create-owner
check "ops:create-owner bez e-mailu selže" "$([[ $RC -ne 0 ]] && out_has 'platný e-mail' && echo 0 || echo 1)"
ops create-owner neni-email
check "ops:create-owner s neplatným e-mailem selže" "$([[ $RC -ne 0 ]] && echo 0 || echo 1)"
RC=0; (unset MIGRATE_DATABASE_URL; node scripts/ops-bootstrap.mjs create-owner a@example.test >"$TMP_DIR/out" 2>&1) || RC=$?
check "ops:create-owner bez MIGRATE_DATABASE_URL selže" "$([[ $RC -ne 0 ]] && out_has 'Chybí MIGRATE_DATABASE_URL' && echo 0 || echo 1)"
RC=0; MIGRATE_DATABASE_URL="postgresql://se_vezmou_app:x@localhost:5432/postgres" node scripts/ops-bootstrap.mjs create-owner a@example.test >"$TMP_DIR/out" 2>&1 || RC=$?
check "ops:create-owner s aplikační rolí se odmítne" "$([[ $RC -ne 0 ]] && out_has 'aplikační roli' && echo 0 || echo 1)"
ops create-owner Majitel@Example.test
check "ops:create-owner založí majitele" "$([[ $RC -eq 0 ]] && out_has 'Majitel byl založen' && echo 0 || echo 1)"
check "majitel je v databázi s rolí owner a bez druhého faktoru" \
  "$([[ "$(sqlv "select role || ',' || (totp_confirmed_at is null) || ',' || (auth_user_id is not null) from se_vezmou.operators where email = 'majitel@example.test'")" == "owner,true,true" ]] && echo 0 || echo 1)"
check "založení je v auditu bez e-mailu" \
  "$([[ "$(sqlv "select count(*) from se_vezmou.audit_log where action = 'operator.bootstrap' and actor_type = 'system' and meta::text not like '%@%'")" -eq 1 ]] && echo 0 || echo 1)"
ops create-owner majitel@example.test
check "stejný e-mail podruhé se odmítne" "$([[ $RC -ne 0 ]] && out_has 'už existuje' && echo 0 || echo 1)"
ops create-owner druhy@example.test
check "další majitel se bez --allow-additional odmítne" "$([[ $RC -ne 0 ]] && out_has 'allow-additional' && echo 0 || echo 1)"
check "odmítnutý majitel nevznikl" "$([[ "$(sqlv "select count(*) from se_vezmou.operators")" -eq 1 ]] && echo 0 || echo 1)"
ops create-owner druhy@example.test --allow-additional
check "s --allow-additional vznikne další majitel" "$([[ $RC -eq 0 && "$(sqlv "select count(*) from se_vezmou.operators where role = 'owner'")" -eq 2 ]] && echo 0 || echo 1)"
ops reset-mfa nikdo@example.test
check "ops:reset-mfa u neznámého e-mailu selže" "$([[ $RC -ne 0 ]] && out_has 'neexistuje' && echo 0 || echo 1)"
sql -c "update se_vezmou.operators set totp_secret_enc = 'x', totp_confirmed_at = now(), totp_last_step = 5 where email = 'majitel@example.test'; insert into se_vezmou.operator_backup_codes (operator_id, code_hash) select id, sha256('a') from se_vezmou.operators where email = 'majitel@example.test'; insert into se_vezmou.operator_sessions (token_hash, operator_id, idle_seconds, idle_expires_at, absolute_expires_at) select sha256('t'), id, 1800, now() + interval '30 minutes', now() + interval '8 hours' from se_vezmou.operators where email = 'majitel@example.test'" >/dev/null
ops reset-mfa majitel@example.test
check "ops:reset-mfa zneplatní faktor, záložní kódy i relace" \
  "$([[ $RC -eq 0 && "$(sqlv "select (totp_secret_enc is null and totp_confirmed_at is null and totp_last_step is null) || ',' || (select count(*) from se_vezmou.operator_backup_codes) || ',' || (select count(*) from se_vezmou.operator_sessions where revoked_at is null) from se_vezmou.operators where email = 'majitel@example.test'")" == "true,0,0" ]] && echo 0 || echo 1)"
check "obnova faktoru je v auditu" "$([[ "$(sqlv "select count(*) from se_vezmou.audit_log where action = 'operator.mfa_reset' and actor_type = 'system'")" -eq 1 ]] && echo 0 || echo 1)"
sql -c "set client_min_messages = warning; delete from se_vezmou.operator_sessions; delete from se_vezmou.operators;" >/dev/null 2>&1
STRUCT2="$(sqlv "select count(*) from se_vezmou.operators")"
check "úklid testovacích operátorů" "$([[ "$STRUCT2" -eq 0 ]] && echo 0 || echo 1)"

# 6. změněná aplikovaná migrace
cp -r supabase/migrations "$TMP_DIR/mig"
printf '\n-- změna po aplikaci\n' >> "$TMP_DIR/mig/20261002120500_seed.sql"
migrate --dir "$TMP_DIR/mig"
check "změněný checksum aplikované migrace se odmítne" "$([[ $RC -ne 0 ]] && out_has 'po aplikaci změnila' && echo 0 || echo 1)"
migrate --dir "$TMP_DIR/mig" --status
check "--status změnu označí" "$([[ $RC -ne 0 ]] && out_has 'ZMĚNĚNA' && echo 0 || echo 1)"
cp supabase/migrations/20261002120500_seed.sql "$TMP_DIR/mig/20261002120500_seed.sql"

# 7. chybějící migrace v repozitáři
rm "$TMP_DIR/mig/20261002140000_rsvp.sql"
migrate --dir "$TMP_DIR/mig"
check "aplikovaná migrace, která v repozitáři chybí, se odmítne" "$([[ $RC -ne 0 ]] && out_has 'v repozitáři chybí' && echo 0 || echo 1)"
cp supabase/migrations/20261002140000_rsvp.sql "$TMP_DIR/mig/"

# 8. nová migrace se aplikuje, selhávající se vrátí zpět, destruktivní se odmítne
printf 'create table se_vezmou.test_nova (id int primary key);\nrevoke all on se_vezmou.test_nova from public, anon, authenticated, service_role;\nalter table se_vezmou.test_nova enable row level security;\n' \
  > "$TMP_DIR/mig/20261231170000_nova.sql"
migrate --dir "$TMP_DIR/mig" --dry-run
check "--dry-run ukáže jedinou čekající migraci" "$([[ $RC -eq 0 ]] && out_has '20261231170000_nova.sql' && [[ "$(grep -c '\.sql  sha256' "$TMP_DIR/out")" -eq 1 ]] && echo 0 || echo 1)"
migrate --dir "$TMP_DIR/mig"
check "nová migrace se aplikuje" "$([[ $RC -eq 0 ]] && [[ "$(sqlv "select count(*) from se_vezmou.schema_migrations")" -eq $((N_MIG + 1)) ]] && echo 0 || echo 1)"

printf 'create table se_vezmou.test_pulka (id int);\nselect tohle_neni_sql;\n' > "$TMP_DIR/mig/20261231180000_chyba.sql"
migrate --dir "$TMP_DIR/mig"
check "selhávající migrace skončí chybou" "$([[ $RC -ne 0 ]] && out_has 'vrácena zpět' && echo 0 || echo 1)"
check "selhávající migrace se vrátila zpět celá a není v evidenci" \
  "$([[ "$(sqlv "select to_regclass('se_vezmou.test_pulka') is null")" == "t" && "$(sqlv "select count(*) from se_vezmou.schema_migrations where version = '20261231180000'")" -eq 0 ]] && echo 0 || echo 1)"

printf 'drop table se_vezmou.test_nova;\n' > "$TMP_DIR/mig/20261231180000_chyba.sql"
migrate --dir "$TMP_DIR/mig"
check "migrace s drop table se odmítne a nic nespustí" \
  "$([[ $RC -ne 0 ]] && out_has 'destruktivní' && [[ "$(sqlv "select to_regclass('se_vezmou.test_nova') is not null")" == "t" ]] && echo 0 || echo 1)"
printf 'delete from se_vezmou.app_settings;\n' > "$TMP_DIR/mig/20261231180000_chyba.sql"
migrate --dir "$TMP_DIR/mig"
check "migrace s delete from se odmítne" "$([[ $RC -ne 0 ]] && out_has 'destruktivní' && echo 0 || echo 1)"

# 9. pořadí: nová migrace starší než už aplikované
rm "$TMP_DIR/mig/20261231180000_chyba.sql"
printf 'select 1;\n' > "$TMP_DIR/mig/20261002100000_stara.sql"
migrate --dir "$TMP_DIR/mig"
check "čekající migrace starší než aplikované se odmítne" "$([[ $RC -ne 0 ]] && out_has 'starší než' && echo 0 || echo 1)"

# 10. databáze s tabulkami, ale bez evidence (nevznikla nástrojem): nic se nepřepíše
fresh_db
for f in supabase/migrations/*.sql; do PGOPTIONS="-c client_min_messages=warning" sql -f "$f" >/dev/null; done
migrate
check "schéma s tabulkami bez evidence se odmítne (neshoda s očekáváním)" "$([[ $RC -ne 0 ]] && out_has 'chybí evidence' && echo 0 || echo 1)"

log ""
if [[ "$FAILED" -ne 0 ]]; then
  log "TEST db:migrate SELHAL: chyb $FAILED, úspěšných kontrol $PASSED"
  exit 1
fi
log "Test db:migrate prošel: $PASSED úspěšných kontrol"
