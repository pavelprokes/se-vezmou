#!/usr/bin/env bash
# Spustí testy databáze (M3): shim -> migrace -> pomocné funkce -> testy izolace -> souběžný test.
#
# Dvě varianty:
#  1. Bez DATABASE_URL: skript sám inicializuje dočasný cluster PostgreSQL v $TMPDIR, spustí ho
#     jen přes unixový socket (žádný TCP port), po testech ho zastaví a smaže. Pod rootem
#     používá uživatele postgres (runuser), jinak běží pod aktuálním uživatelem.
#  2. S DATABASE_URL (např. service container postgres:16 v CI): použije zadanou databázi.
#     Skript v ní SMAŽE schémata public, se_vezmou, auth, extensions a tap, proto je potřeba
#     výslovný souhlas DB_TEST_ALLOW_RESET=1. Role v clusteru (anon, se_vezmou_app, ...) zůstanou.
#
# Průběh: (A) test izolace migrací: snímek katalogu před migracemi a po nich (dvakrát: bez a s
# provedeným init skriptem), mimo schéma se_vezmou se nesmí změnit nic; (B) čistá databáze, shim,
# init skripty (supabase/init), migrace, pomocné funkce, testy a souběžný test.
#
# Proměnné: DATABASE_URL, DB_TEST_ALLOW_RESET, PG_BIN (adresář s binárkami PostgreSQL),
#           DB_TEST_VERBOSE=1 (vypíše všechny řádky "ok - ...").
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DB_DIR=""
PG_RUN=()   # prefix pro spouštění serverových příkazů (runuser pod rootem)

log() { printf '%s\n' "$*" >&2; }
die() { log "CHYBA: $*"; exit 1; }

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
  if [[ -n "${TMP_DIR:-}" ]]; then rm -rf "$TMP_DIR"; fi
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

if [[ -n "${DATABASE_URL:-}" ]]; then
  [[ "${DB_TEST_ALLOW_RESET:-}" == "1" ]] \
    || die "DATABASE_URL je zadáno: skript v ní smaže schémata public, se_vezmou, auth, extensions a tap. Potvrďte DB_TEST_ALLOW_RESET=1."
  URL="$DATABASE_URL"
  BIN=""
else
  BIN="$(find_pg_bin)" || die "Nenašel jsem binárky PostgreSQL (initdb). Nastavte PG_BIN nebo DATABASE_URL."
  DB_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sevezmou-pg.XXXXXX")"
  if [[ "$(id -u)" -eq 0 ]]; then
    command -v runuser >/dev/null 2>&1 || die "Pod rootem je potřeba runuser (nebo spusťte jako nerootový uživatel)."
    chown postgres "$DB_DIR"
    PG_RUN=(runuser -u postgres --)
    # nadřazený adresář musí být průchozí i pro uživatele postgres; jinak použijeme /tmp
    if ! "${PG_RUN[@]}" test -w "$DB_DIR"; then
      rm -rf "$DB_DIR"
      DB_DIR="$(mktemp -d /tmp/sevezmou-pg.XXXXXX)"
      chown postgres "$DB_DIR"
    fi
  fi
  # C.UTF-8 dává deterministické chování řazení a malých písmen; kdyby chyběla, zkusíme C
  if ! "${PG_RUN[@]}" "$BIN/initdb" -D "$DB_DIR/data" -A trust -U postgres -E UTF8 --locale=C.UTF-8 >"$DB_DIR/initdb.log" 2>&1; then
    rm -rf "$DB_DIR/data"
    "${PG_RUN[@]}" "$BIN/initdb" -D "$DB_DIR/data" -A trust -U postgres -E UTF8 --locale=C >"$DB_DIR/initdb.log" 2>&1 \
      || { cat "$DB_DIR/initdb.log" >&2; die "initdb selhal."; }
  fi
  "${PG_RUN[@]}" "$BIN/pg_ctl" -D "$DB_DIR/data" -l "$DB_DIR/server.log" -w \
    -o "-k $DB_DIR -c listen_addresses= -c fsync=off -c synchronous_commit=off -c full_page_writes=off" start >/dev/null
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

VERSION="$(sql -Atc 'show server_version')"
log "PostgreSQL $VERSION"
[[ "${VERSION%%.*}" -ge 15 ]] || die "Migrace vyžadují PostgreSQL 15 nebo novější (složené FK se set null (sloupec))."

reset_db() { # čistý stav (idempotence skriptu i při opakovaném spuštění nad stejnou databází)
  sql -c "set client_min_messages = warning; drop schema if exists public cascade; drop schema if exists se_vezmou cascade; drop schema if exists app cascade; drop schema if exists auth cascade; drop schema if exists extensions cascade; drop schema if exists tap cascade; create schema public;" >/dev/null
}

run_file() { # soubor, popisek
  log "  $2"
  PGOPTIONS="-c client_min_messages=warning" sql -f "$1" >/dev/null
}

run_shim() { for f in supabase/tests/setup/[0-9][0-9]_*.sql; do run_file "$f" "shim: $(basename "$f")"; done; }
run_init() { for f in supabase/init/[0-9][0-9]_*.sql; do run_file "$f" "init: $(basename "$f")"; done; }
run_migrations() { for f in supabase/migrations/*.sql; do run_file "$f" "migrace: $(basename "$f")"; done; }
snapshot() { sql -X -At -f supabase/tests/catalog_snapshot.sql; }

# (A) Test izolace: migrace nesmí nic změnit mimo schéma se_vezmou.
# scenario "bez init": rozšíření a schéma extensions ještě nejsou, smějí přibýt jen objekty rozšíření
#   citext, pg_trgm a pgcrypto (řádky s ext=...). Cokoli jiného, i změna ACL schémat public, extensions
#   a auth nebo výchozích oprávnění, test shodí.
# scenario "po init": jako ostrý projekt, kde majitel spustil supabase/init; nesmí se změnit NIC.
isolation_check() { # popisek, 0|1 (provést init)
  log "Test izolace migrací ($1)"
  reset_db
  run_shim
  [[ "$2" == "1" ]] && run_init
  local before="$TMP_DIR/catalog.before" after="$TMP_DIR/catalog.after"
  snapshot > "$before"
  run_migrations
  snapshot > "$after"
  [[ -s "$before" ]] || { log "  SELHALO snímek katalogu je prázdný"; FAILED=$((FAILED + 1)); return; }
  local removed added bad
  removed="$(diff "$before" "$after" | sed -n 's/^< //p' || true)"
  added="$(diff "$before" "$after" | sed -n 's/^> //p' || true)"
  if [[ "$2" == "1" ]]; then
    bad="$added"
  else
    bad="$(printf '%s\n' "$added" | grep -Ev 'ext=(citext|pg_trgm|pgcrypto)(,|$)' | grep -v '^$' || true)"
  fi
  if [[ -n "$removed" || -n "$bad" ]]; then
    log "  SELHALO migrace změnily katalog mimo schéma se_vezmou:"
    [[ -n "$removed" ]] && printf '%s\n' "$removed" | sed 's/^/    - /' >&2
    [[ -n "$bad" ]] && printf '%s\n' "$bad" | sed 's/^/    + /' >&2
    FAILED=$((FAILED + 1))
    return
  fi
  local n_se; n_se="$(sql -Atc "select count(*) from pg_class where relnamespace = 'se_vezmou'::regnamespace")"
  local n_app; n_app="$(sql -Atc "select count(*) from pg_namespace where nspname = 'app'")"
  if [[ "$n_se" -lt 20 || "$n_app" -ne 0 ]]; then
    log "  SELHALO schéma se_vezmou má $n_se objektů (čekáno aspoň 20) nebo existuje schéma app ($n_app)"
    FAILED=$((FAILED + 1)); return
  fi
  log "  OK      mimo schéma se_vezmou se nezměnilo nic ($(wc -l < "$before" | tr -d ' ') řádků katalogu hlídáno)"
  TOTAL_OK=$((TOTAL_OK + 1))
}

FAILED=0
TOTAL_OK=0
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sevezmou-dbtest.XXXXXX")"

isolation_check "bez init, rozšíření se instalují" 0
isolation_check "po init, jako ostrý projekt" 1

log "Shim, init a migrace"
reset_db
run_shim
run_init
run_migrations
run_file supabase/tests/helpers.sql "pomocné funkce testů"

log "Testy"
for f in supabase/tests/*.test.sql; do
  out="$(sql -f "$f" 2>&1)" && rc=0 || rc=$?
  oks="$(printf '%s\n' "$out" | grep -c 'NOTICE:  ok - ' || true)"
  TOTAL_OK=$((TOTAL_OK + oks))
  if [[ $rc -ne 0 ]]; then
    FAILED=$((FAILED + 1))
    log "  SELHALO $(basename "$f") (úspěšných kontrol před chybou: $oks)"
    printf '%s\n' "$out" | sed -e 's/^psql:[^ ]* NOTICE:  //' | grep -v '^ok - ' >&2 || true
  else
    log "  OK      $(basename "$f") ($oks kontrol)"
    if [[ "${DB_TEST_VERBOSE:-}" == "1" ]]; then
      printf '%s\n' "$out" | sed -n -e 's/^psql:[^ ]* NOTICE:  //p' >&2
    fi
  fi
done

# Testy jako skutečně přihlášená aplikační role se_vezmou_app (NE vlastník): model oprávnění tak, jak ho
# používá aplikace (docs/adr/0011). Heslo je jen z testovacího shimu; lokálně přes socket se nepoužije.
if [[ -n "$DB_DIR" ]]; then
  APP_URL="postgresql://se_vezmou_app@/postgres?host=$DB_DIR"
else
  APP_URL="$(printf '%s' "$URL" | sed -E 's#^(postgres(ql)?://)([^@/]*@)?#\1se_vezmou_app:se_vezmou_app_test_only@#')"
fi
for f in supabase/tests/as_app/*.test.sql; do
  out="$("$PSQL" "$APP_URL" -X -q -v ON_ERROR_STOP=1 -f "$f" 2>&1)" && rc=0 || rc=$?
  oks="$(printf '%s\n' "$out" | grep -c 'NOTICE:  ok - ' || true)"
  TOTAL_OK=$((TOTAL_OK + oks))
  if [[ $rc -ne 0 ]]; then
    FAILED=$((FAILED + 1))
    log "  SELHALO jako se_vezmou_app: $(basename "$f") (úspěšných kontrol před chybou: $oks)"
    printf '%s\n' "$out" | sed -e 's/^psql:[^ ]* NOTICE:  //' | grep -v '^ok - ' >&2 || true
  else
    log "  OK      jako se_vezmou_app: $(basename "$f") ($oks kontrol)"
  fi
done

# Souběžný test atomicity rate_limit_hit: skutečné paralelní spojení a potvrzené transakce.
log "Souběžný test rate_limit_hit"
CONC_KEY="dbtest:concurrency:$$"
CONC_LIMIT=20
CONC_WORKERS=8
CONC_CALLS=10
conc_ok=0
for attempt in 1 2 3; do
  sql -c "delete from se_vezmou.rate_limits where bucket_key = '$CONC_KEY'" >/dev/null
  pids=()
  for w in $(seq 1 "$CONC_WORKERS"); do
    # každé volání je samostatný příkaz s vlastní potvrzenou transakcí (autocommit)
    (yes "select allowed from se_vezmou.rate_limit_hit('$CONC_KEY', $CONC_LIMIT, interval '1 day');" \
       | head -n "$CONC_CALLS" | sql -At -f - | grep -c '^t$' > "${DB_DIR:-${TMPDIR:-/tmp}}/conc.$$.$w" || true) &
    pids+=($!)
  done
  for p in "${pids[@]}"; do wait "$p"; done
  allowed=0
  for w in $(seq 1 "$CONC_WORKERS"); do
    allowed=$((allowed + $(cat "${DB_DIR:-${TMPDIR:-/tmp}}/conc.$$.$w")))
    rm -f "${DB_DIR:-${TMPDIR:-/tmp}}/conc.$$.$w"
  done
  windows="$(sql -Atc "select count(*) from se_vezmou.rate_limits where bucket_key = '$CONC_KEY'")"
  total_hits="$(sql -Atc "select coalesce(sum(hits), 0) from se_vezmou.rate_limits where bucket_key = '$CONC_KEY'")"
  sql -c "delete from se_vezmou.rate_limits where bucket_key = '$CONC_KEY'" >/dev/null
  if [[ "$windows" -gt 1 ]]; then
    log "  okno se během testu překlopilo (půlnoc UTC), opakuji ($attempt/3)"
    continue
  fi
  expected_total=$((CONC_WORKERS * CONC_CALLS))
  if [[ "$allowed" -eq "$CONC_LIMIT" && "$total_hits" -eq "$expected_total" ]]; then
    log "  OK      povoleno přesně $allowed z $expected_total souběžných volání, součet čítače $total_hits"
    TOTAL_OK=$((TOTAL_OK + 1))
    conc_ok=1
  else
    log "  SELHALO povoleno $allowed (očekáváno $CONC_LIMIT), součet čítače $total_hits (očekáváno $expected_total)"
  fi
  break
done
[[ "$conc_ok" -eq 1 ]] || FAILED=$((FAILED + 1))

# Souběžný test op_set_operator_disabled: dva majitelé se zakážou navzájem ve dvou paralelních transakcích.
# Bez zámku by obě kontroly „zůstává jiný aktivní majitel“ prošly a nezůstal by žádný; se zámkem druhá skončí
# chybou last_owner.
log "Souběžný test posledního majitele"
OWN1="$(sql -Atc "select gen_random_uuid()")"
OWN2="$(sql -Atc "select gen_random_uuid()")"
sql -c "insert into se_vezmou.operators (id, email, role) values ('$OWN1', 'souboj1-$$@example.test', 'owner'), ('$OWN2', 'souboj2-$$@example.test', 'owner')" >/dev/null
# v databázi mohou být i jiní majitelé (zakázání by pak prošlo oběma): testujeme jen s dvojicí, ostatní dočasně zakážeme
OTHERS="$(sql -Atc "select coalesce(string_agg(id::text, ','), '') from se_vezmou.operators where role = 'owner' and disabled_at is null and id not in ('$OWN1', '$OWN2')")"
if [[ -n "$OTHERS" ]]; then
  sql -c "update se_vezmou.operators set disabled_at = now() where id = any (string_to_array('$OTHERS', ',')::uuid[])" >/dev/null
fi
RC1="${DB_DIR:-${TMPDIR:-/tmp}}/own1.$$"
RC2="${DB_DIR:-${TMPDIR:-/tmp}}/own2.$$"
( rc=0; printf "begin;\nselect se_vezmou.op_set_operator_disabled('%s', '%s', true, 'souběh 1');\nselect pg_sleep(1.5);\ncommit;\n" "$OWN1" "$OWN2" \
    | sql -At -f - >/dev/null 2>&1 || rc=$?; echo $rc > "$RC1" ) &
P1=$!
sleep 0.4
( rc=0; printf "begin;\nselect se_vezmou.op_set_operator_disabled('%s', '%s', true, 'souběh 2');\ncommit;\n" "$OWN2" "$OWN1" \
    | sql -At -f - >/dev/null 2>&1 || rc=$?; echo $rc > "$RC2" ) &
P2=$!
wait "$P1" "$P2"
rc1="$(cat "$RC1")"; rc2="$(cat "$RC2")"; rm -f "$RC1" "$RC2"
active="$(sql -Atc "select count(*) from se_vezmou.operators where id in ('$OWN1', '$OWN2') and disabled_at is null")"
sql -c "delete from se_vezmou.operators where id in ('$OWN1', '$OWN2')" >/dev/null
if [[ -n "$OTHERS" ]]; then
  sql -c "update se_vezmou.operators set disabled_at = null where id = any (string_to_array('$OTHERS', ',')::uuid[])" >/dev/null
fi
if [[ "$active" -eq 1 && "$rc1" -eq 0 && "$rc2" -ne 0 ]]; then
  log "  OK      zůstal právě jeden aktivní majitel, druhé zakázání skončilo chybou last_owner"
  TOTAL_OK=$((TOTAL_OK + 1))
else
  log "  SELHALO aktivních majitelů: $active (čekáno 1), návratové kódy: $rc1 a $rc2 (čekáno 0 a nenulový)"
  FAILED=$((FAILED + 1))
fi

log ""
if [[ "$FAILED" -ne 0 ]]; then
  log "DB TESTY SELHALY: souborů/kontrol s chybou $FAILED, úspěšných kontrol $TOTAL_OK"
  exit 1
fi
log "DB testy prošly: $TOTAL_OK úspěšných kontrol"
