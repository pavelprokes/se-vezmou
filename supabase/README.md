# Databáze (Supabase / PostgreSQL)

Schéma, izolace dat mezi svatbami (RLS), funkce `security definer` a testy. Zdroje návrhu: `docs/data-model.md` (hlavní), `docs/adr/0001-database.md`, `docs/adr/0010-rate-limiting.md`, `docs/security-privacy.md`. Odchylky implementace od návrhu jsou v `docs/data-model.md`, kapitola 13.

## Obsah

| Cesta                           | K čemu je                                                                                                                         |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `migrations/`                   | Jediný zdroj schématu. Časově číslované soubory, aplikují se podle názvu.                                                         |
| `tests/*.test.sql`              | Testy izolace a pravidel (čisté SQL, kontrola vyvolá výjimku `not ok - ...`).                                                     |
| `tests/helpers.sql`             | Pomocné funkce testů (schéma `tap`) a fixtura se svatbami A a B. **Nenasazuje se.**                                               |
| `tests/setup/00_shim.sql`       | Náhrada platformy Supabase (role `anon`, `authenticated`, `service_role`, schéma `auth`) pro čistý PostgreSQL. **Nenasazuje se.** |
| `tests/golden/name-vectors.tsv` | Zlaté vektory normalizace jmen (vstup, normalizovaný tvar, klíč se seřazenými tokeny), sdílené s TypeScriptem.                    |

Migrace:

1. `foundation`: rozšíření, schéma `app`, výchozí oprávnění, doména `i18n_text`, funkce pro claimy JWT, normalizace jmen.
2. `tables_core`, `tables_content`, `tables_guests_rsvp`, `tables_ops`: tabulky, složené cizí klíče, indexy.
3. `seed`: výchozí `app_settings` a rezervovaná slova.
4. `triggers`: retenční data, `last_activity_at`, pravidla slugů, limit správců, verze webu, append-only audit, `updated_at`.
5. `rls`: RLS na každé tabulce, politiky správce, oprávnění rolí.
6. `functions_core`, `functions_public`, `functions_ops`: `rate_limit_hit`, slugy, `auth_*`, `get_public_site`, slepé RSVP, `op_*`, retence.
7. `auth_pins_lockouts` (M4): pauzy po chybách (`auth_lockout_*`, sloupec `lockouts.failures`), PIN správy a hostů (`auth_pin_get`, `auth_pin_other_hash`, `auth_pin_set`), `auth_session_context`.
8. `email_log_functions` (M4): `email_log_insert` a `email_log_set_status` (záznam e-mailu bez osobních údajů).
9. `rsvp` (M8): tolerance překlepů ve jménech (`app.names_close`), společný zápis odpovědi `app.rsvp_apply`, nové `rsvp_match`, `rsvp_get`, `rsvp_submit`, dále `rsvp_info`, `rsvp_unlisted_form`, `rsvp_submit_unlisted`, správcovské `admin_guest_list`, `admin_rsvp_overview`, `admin_rsvp_household`, `admin_rsvp_enter` a `analytics_record`.

Co je záměrně odložené (označeno `TODO` v `functions_core.sql`; PINy a pauzy dodala M4): založení konceptu a publikace (M5), správa správců a souhlas s nahlédnutím (M7), zbytek `op_*` a relace operátorů (M9), e-maily a export při retenci (M10).

## Spuštění testů

```bash
npm run db:test
```

Skript `scripts/db-test.sh` provede shim, všechny migrace, pomocné funkce a testy a nakonec souběžný test atomicity `rate_limit_hit` (osm paralelních spojení). Má dvě varianty:

- **Bez `DATABASE_URL`** (lokálně): skript sám inicializuje dočasný cluster PostgreSQL v `$TMPDIR` (binárky hledá v `/usr/lib/postgresql/*/bin`, jinak v `PG_BIN`), spustí ho jen přes unixový socket a po testech ho smaže. Pod rootem používá uživatele `postgres` přes `runuser`, jinak běží pod aktuálním uživatelem. Docker není potřeba.
- **S `DATABASE_URL`** (CI, service container `postgres:16`): použije zadanou databázi. Skript v ní **smaže** schémata `public`, `app`, `auth`, `extensions` a `tap`, proto vyžaduje potvrzení `DB_TEST_ALLOW_RESET=1`. Nikdy ho nesměřujte na databázi s daty.

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres DB_TEST_ALLOW_RESET=1 npm run db:test
```

Další proměnné: `DB_TEST_VERBOSE=1` vypíše každou úspěšnou kontrolu. Je potřeba klient `psql` a PostgreSQL 15 nebo novější (cílová verze je 16).

V CI běží test jako samostatný job `db` (`.github/workflows/ci.yml`).

### Co testy ověřují

- `10_structure`: RLS zapnuté na každé tabulce, žádná práva pro `anon`, složené klíče mezi tenant tabulkami, pravidla `security definer` funkcí (prázdný `search_path`, bez `execute` pro `public` a `anon`), audit append-only.
- `20_isolation`: správce svatby A nečte, nevkládá, nemění ani nemaže data svatby B v **žádné tabulce** (matice tabulek; nová tabulka mimo matici test shodí).
- `30_roles`: host, návštěvník, náhled, `anon` a JWT bez claimů nevidí pracovní tabulky ani nevolají funkce service role.
- `40_operator`: operátor bez grantu nevidí údaje hostů, zásah a audit vznikají v jedné transakci, audit nejde změnit.
- `50_foreign_keys`: složené cizí klíče brání křížovým odkazům mezi svatbami.
- `60_slugs`: tvar a rezervovaná slova, rezervace konceptu a její vypršení, zveřejněný slug se znovu nepřidělí, `last_activity_at`.
- `70_rate_limit` a souběžný test ve skriptu: atomicita a okna `rate_limit_hit`.
- `80_rsvp_site`: slepé RSVP (stejný tvar odpovědi), uzavřené RSVP, pozvání na události, `get_public_site`, odvozená fáze.
- `95_auth_pin` (M4): pauzy po chybách (série, zdvojnásobování, strop 24 h, samovolný návrat úrovně, nulování), `auth_pin_get` (skrývá svatbu bez PINu, smazanou, bez správce), nastavení PINu (formát hashe, odvolání relací, audit bez hodnoty), `auth_session_context`, `email_log_*` a že správce tyto funkce nespustí.
- `85_rsvp_m8` (M8): tolerance překlepů (`app.osa_distance`, `app.names_close`) a nejednoznačnost, vlastní a vestavěné otázky (typy, možnosti, povinnost, otázky k události), doprovod a děti, `rsvp_info`, host mimo seznam (vypnuto, zapnuto, zavřeno, role), správcovský seznam, přehled a ruční zápis (oprávnění, izolace svatby, audit bez osobních údajů), `analytics_record` bez identifikátorů.
- `90_lifecycle`: relace a výzvy, limit správců, retenční data a mazání, výmaz hosta, normalizace jmen.

## Aplikace migrací

Migrace jsou obyčejné SQL soubory seřazené podle názvu a předpokládají Supabase (role `anon`, `authenticated`, `service_role`, schémata `auth` a `extensions`).

Do projektu Supabase (po `supabase link --project-ref <ref>`):

```bash
supabase db push
```

Jde-li o databázi bez Supabase CLI, například při ručním nasazení, spustí se soubory po jednom:

```bash
for f in supabase/migrations/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f "$f"; done
```

Po nasazení: typy pro aplikaci vygeneruje `supabase gen types` do `src/data/database.types.ts` (ADR 0001). Klíč `service_role` a podpisové tajemství JWT patří jen do tajných proměnných serveru, nikdy do prohlížeče.

## Pravidla pro další migrace

- Nová tabulka s `wedding_id`: zapnout RLS, přidat politiky, složené cizí klíče `(wedding_id, id)`, přidat ji do matice v `tests/20_isolation.test.sql` a napsat test. Chybějící RLS nebo matice shodí `npm run db:test`.
- Nová funkce `security definer`: `set search_path = ''`, plně kvalifikované názvy, `revoke ... from public, anon`, výslovný `grant` jen potřebné roli, filtr podle `app.wedding_id()` (kromě funkcí service role před ověřením).
- Hotové migrace se po sloučení do `main` neupravují; změny jdou novým souborem.
