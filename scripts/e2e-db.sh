#!/usr/bin/env bash
# Připraví databázi pro e2e testy (M4) a spustí v ní zadaný příkaz:
#
#   bash scripts/e2e-db.sh run -- npx playwright test
#
# Databáze obsahuje jen shim platformy Supabase, init skripty (supabase/init) a migrace (žádné
# testovací funkce, žádná data): e2e testy si potřebná data zakládají samy. Aplikace v testech mluví
# s Postgresem přímo přes `pg` (bez PostgREST), a to jako role `se_vezmou_app` (NE jako
# superuživatel), takže e2e ověřují skutečný model oprávnění (docs/adr/0011). Migrace a testovací
# pomocníci (zakládání dat) používají vlastníka (postgres).
#
# Dvě varianty (stejně jako scripts/db-test.sh):
#  1. Bez E2E_DATABASE_URL: dočasný cluster PostgreSQL v $TMPDIR přes unixový socket (žádný TCP port),
#     po doběhu příkazu se zastaví a smaže. Pod rootem běží jako uživatel postgres (runuser).
#  2. S E2E_DATABASE_URL (např. service container postgres:16 v CI): použije zadanou databázi.
#     Skript v ní SMAŽE schémata public, se_vezmou, auth, extensions a tap, proto vyžaduje
#     E2E_DB_ALLOW_RESET=1. Nikdy ho nesměřujte na databázi s daty.
#
# Příkaz dostane proměnné E2E_DATABASE_URL (vlastník, jen pro testovací pomocníky) a
# E2E_APP_DATABASE_URL (role se_vezmou_app, tou se připojuje aplikace).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DB_DIR=""
BIN=""
PG_RUN=()

log() { printf '%s\n' "$*" >&2; }
die() { log "CHYBA: $*"; exit 1; }

[[ "${1:-}" == "run" && "${2:-}" == "--" && $# -ge 3 ]] \
  || die "Použití: scripts/e2e-db.sh run -- <příkaz> [argumenty...]"
shift 2

find_pg_bin() {
  if [[ -n "${PG_BIN:-}" && -x "$PG_BIN/initdb" ]]; then printf '%s' "$PG_BIN"; return; fi
  local d
  for d in /usr/lib/postgresql/16/bin /usr/lib/postgresql/*/bin /usr/local/pgsql/bin /opt/homebrew/opt/postgresql@16/bin; do
    if [[ -x "$d/initdb" ]]; then printf '%s' "$d"; return; fi
  done
  if command -v pg_config >/dev/null 2>&1 && [[ -x "$(pg_config --bindir)/initdb" ]]; then
    pg_config --bindir; return
  fi
  return 1
}

cleanup() {
  local code=$?
  if [[ -n "$DB_DIR" && -d "$DB_DIR" ]]; then
    if [[ -f "$DB_DIR/data/postmaster.pid" ]]; then
      "${PG_RUN[@]}" "$BIN/pg_ctl" -D "$DB_DIR/data" -m immediate -w stop >/dev/null 2>&1 || true
    fi
    if [[ $code -ne 0 && -f "$DB_DIR/server.log" ]]; then
      log "--- posledních 20 řádků logu serveru ---"
      tail -n 20 "$DB_DIR/server.log" >&2 || true
    fi
    rm -rf "$DB_DIR"
  fi
  exit "$code"
}
trap cleanup EXIT

if [[ -n "${E2E_DATABASE_URL:-}" ]]; then
  [[ "${E2E_DB_ALLOW_RESET:-}" == "1" ]] \
    || die "E2E_DATABASE_URL je zadáno: skript v ní smaže schémata public, se_vezmou, auth, extensions a tap. Potvrďte E2E_DB_ALLOW_RESET=1."
  URL="$E2E_DATABASE_URL"
else
  BIN="$(find_pg_bin)" || die "Nenašel jsem binárky PostgreSQL (initdb). Nastavte PG_BIN nebo E2E_DATABASE_URL."
  DB_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sevezmou-e2e-pg.XXXXXX")"
  if [[ "$(id -u)" -eq 0 ]]; then
    command -v runuser >/dev/null 2>&1 || die "Pod rootem je potřeba runuser (nebo spusťte jako nerootový uživatel)."
    chown postgres "$DB_DIR"
    PG_RUN=(runuser -u postgres --)
    if ! "${PG_RUN[@]}" test -w "$DB_DIR"; then
      rm -rf "$DB_DIR"
      DB_DIR="$(mktemp -d /tmp/sevezmou-e2e-pg.XXXXXX)"
      chown postgres "$DB_DIR"
    fi
  fi
  if ! "${PG_RUN[@]}" "$BIN/initdb" -D "$DB_DIR/data" -A trust -U postgres -E UTF8 --locale=C.UTF-8 >"$DB_DIR/initdb.log" 2>&1; then
    rm -rf "$DB_DIR/data"
    "${PG_RUN[@]}" "$BIN/initdb" -D "$DB_DIR/data" -A trust -U postgres -E UTF8 --locale=C >"$DB_DIR/initdb.log" 2>&1 \
      || { cat "$DB_DIR/initdb.log" >&2; die "initdb selhal."; }
  fi
  "${PG_RUN[@]}" "$BIN/pg_ctl" -D "$DB_DIR/data" -l "$DB_DIR/server.log" -w \
    -o "-k $DB_DIR -c listen_addresses= -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c max_connections=100" start >/dev/null
  URL="postgresql://postgres@/postgres?host=$DB_DIR"
fi

if command -v psql >/dev/null 2>&1; then
  PSQL=psql
elif [[ -n "$BIN" && -x "$BIN/psql" ]]; then
  PSQL="$BIN/psql"
else
  die "Nenašel jsem psql."
fi

sql() { "$PSQL" "$URL" -X -q -v ON_ERROR_STOP=1 "$@"; }

log "e2e databáze: PostgreSQL $(sql -Atc 'show server_version')"
sql -c "set client_min_messages = warning; drop schema if exists public cascade; drop schema if exists se_vezmou cascade; drop schema if exists app cascade; drop schema if exists auth cascade; drop schema if exists extensions cascade; drop schema if exists tap cascade; create schema public;" >/dev/null
for f in supabase/tests/setup/[0-9][0-9]_*.sql supabase/init/[0-9][0-9]_*.sql supabase/migrations/*.sql; do
  PGOPTIONS="-c client_min_messages=warning" sql -f "$f" >/dev/null 2>"${DB_DIR:-${TMPDIR:-/tmp}}/e2e-db-migrate.$$.log" \
    || { cat "${DB_DIR:-${TMPDIR:-/tmp}}/e2e-db-migrate.$$.log" >&2; die "soubor $f selhal."; }
done
rm -f "${DB_DIR:-${TMPDIR:-/tmp}}/e2e-db-migrate.$$.log"
log "e2e databáze: shim, init a migrace aplikovány (vlastníkem)"

export E2E_DATABASE_URL="$URL"
# Adresa pro aplikaci: stejná databáze, ale role se_vezmou_app (heslo je jen z testovacího shimu).
if [[ -n "$DB_DIR" ]]; then
  export E2E_APP_DATABASE_URL="postgresql://se_vezmou_app@/postgres?host=$DB_DIR"
else
  export E2E_APP_DATABASE_URL="$(printf '%s' "$URL" | sed -E 's#^(postgres(ql)?://)([^@/]*@)?#\1se_vezmou_app:se_vezmou_app_test_only@#')"
fi
# Příkaz běží pod trap: chyba příkazu se předá jako návratový kód, úklid proběhne vždy.
"$@"
