# Databáze (Supabase / PostgreSQL)

Schéma, izolace dat mezi svatbami (RLS), funkce `security definer` a testy. Zdroje návrhu: `docs/data-model.md` (hlavní), `docs/adr/0001-database.md`, `docs/adr/0011-dedicated-schema-direct-pg.md`, `docs/adr/0010-rate-limiting.md`, `docs/security-privacy.md`.

**Sdílený projekt.** Na projektu Supabase už žijí jiné věci. Tento projekt smí používat VÝHRADNĚ vlastní schéma `se_vezmou`: všechny tabulky, typy, funkce, triggery, indexy a politiky jsou tam a migrace nic mimo něj nevytvářejí ani nemění (hlídá to test izolace). Aplikace mluví s Postgresem přímo (`pg`) jako role `se_vezmou_app`, nepoužívá PostgREST ani supabase-js. Odchylky implementace od návrhu jsou v `docs/data-model.md`, kapitola 13.

## Obsah

| Cesta                           | K čemu je                                                                                                                                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migrations/`                   | Jediný zdroj schématu (schéma `se_vezmou`). Časově číslované soubory, aplikuje je `npm run db:migrate`.                                                                                            |
| `init/`                         | Jednorázové kroky majitele na sdíleném projektu: schéma a rozšíření (`00_`), aplikační role (`01_`). Majitel je už provedl.                                                                        |
| `tests/*.test.sql`              | Testy izolace a pravidel (čisté SQL, kontrola vyvolá výjimku `not ok - ...`).                                                                                                                      |
| `tests/as_app/*.test.sql`       | Testy spouštěné skutečným přihlášením jako `se_vezmou_app` (zapomenuté `set role`, členství, claimy).                                                                                              |
| `tests/catalog_snapshot.sql`    | Snímek katalogu pro test izolace migrací (co existuje mimo schéma `se_vezmou`).                                                                                                                    |
| `tests/helpers.sql`             | Pomocné funkce testů (schéma `tap`) a fixtura se svatbami A a B. **Nenasazuje se.**                                                                                                                |
| `tests/setup/00_shim.sql`       | Náhrada platformy Supabase (role `anon`, `authenticated`, `service_role`, `authenticator`, `se_vezmou_app`, schéma `auth`, výchozí oprávnění ve `public`) pro čistý PostgreSQL. **Nenasazuje se.** |
| `tests/golden/name-vectors.tsv` | Zlaté vektory normalizace jmen (vstup, normalizovaný tvar, klíč se seřazenými tokeny), sdílené s TypeScriptem.                                                                                     |

Migrace:

1. `foundation`: idempotentně schéma `se_vezmou`, rozšíření (`citext`, `pg_trgm`, `pgcrypto` ve schématu `extensions`) a oprávnění (jako `init/00_init_se_vezmou.sql`, bez globálních změn), doména `i18n_text`, funkce pro claimy (`se_vezmou.jwt_claims()`, `wedding_id()`, `wedding_role()`, `actor_id()`), normalizace jmen.
2. `tables_core`, `tables_content`, `tables_guests_rsvp`, `tables_ops`: tabulky, složené cizí klíče, indexy.
3. `seed`: výchozí `app_settings` a rezervovaná slova.
4. `triggers`: retenční data, `last_activity_at`, pravidla slugů, limit správců, verze webu, append-only audit, `updated_at`.
5. `rls`: RLS na každé tabulce, politiky správce, oprávnění rolí.
6. `functions_core`, `functions_public`, `functions_ops`: `rate_limit_hit`, slugy, `auth_*`, `get_public_site`, slepé RSVP, `op_*`, retence.
7. `auth_pins_lockouts` (M4): pauzy po chybách (`auth_lockout_*`, sloupec `lockouts.failures`), PIN správy a hostů (`auth_pin_get`, `auth_pin_other_hash`, `auth_pin_set`), `auth_session_context`.
8. `email_log_functions` (M4): `email_log_insert` a `email_log_set_status` (záznam e-mailu bez osobních údajů).
9. `rsvp` (M8): tolerance překlepů ve jménech (`se_vezmou.names_close`), společný zápis odpovědi `se_vezmou.rsvp_apply`, nové `rsvp_match`, `rsvp_get`, `rsvp_submit`, dále `rsvp_info`, `rsvp_unlisted_form`, `rsvp_submit_unlisted`, správcovské `admin_guest_list`, `admin_rsvp_overview`, `admin_rsvp_household`, `admin_rsvp_enter` a `analytics_record`.

10. `operators_auth` (M9, ADR 0012): sloupce `operators.totp_secret_enc`, `totp_confirmed_at`, `totp_last_step`, `last_login_at`, účel výzvy `operator_login`, typ e-mailu `operator_notice`, funkce `auth_operator_*` (vyhledání operátora, relace AAL1 a AAL2, zápis a ověření druhého faktoru TOTP s ochranou proti přehrání, záložní kódy).
11. `operators_ops` (M9): provozní administrace `op_list_weddings`, `op_get_wedding`, `op_add_note`, `op_change_slug`, `op_extend_retention`, `op_restore_wedding`, `op_send_login_link`, `op_overview`, `op_analytics_summary`, `op_list_retention`, `op_list_audit`, správa operátorů (`op_list_operators`, `op_create_operator`, `op_set_operator_disabled`, `op_reset_operator_mfa`) a přepracovaná `op_set_wedding_status` (matice rolí, zveřejnění jen s verzí, obnovení jen přes `op_restore_wedding`).

Matice rolí operátorů (každá `op_*` si roli ověřuje sama, `assert_operator`): čtení, poznámky, poslání přihlašovacího odkazu, nahlédnutí do údajů hostů se souhlasem páru a zablokování webu smí `owner` i `support`; ostatní změny stavu, změnu adresy, prodloužení lhůt, obnovu, audit a správu operátorů jen `owner`. Žádná z nich nevrací jména ani údaje hostů; k nim vede jediná cesta `op_view_guest_data` s aktivním `data_access_grants`, důvodem a auditem.

Co je záměrně odložené (označeno `TODO` v `functions_core.sql`; PINy a pauzy dodala M4, operátory M9): založení konceptu a publikace (M5), správa správců a souhlas s nahlédnutím (M7), e-maily a export při retenci (M10).

## Spuštění testů

```bash
npm run db:test
```

Skript `scripts/db-test.sh` nejdřív provede **test izolace migrací** (dvakrát: bez a s provedeným init skriptem), pak shim, init skripty, všechny migrace, pomocné funkce a testy (jako vlastník i přihlášením jako `se_vezmou_app`) a nakonec souběžný test atomicity `rate_limit_hit` (osm paralelních spojení). Má dvě varianty:

- **Bez `DATABASE_URL`** (lokálně): skript sám inicializuje dočasný cluster PostgreSQL v `$TMPDIR` (binárky hledá v `/usr/lib/postgresql/*/bin`, jinak v `PG_BIN`), spustí ho jen přes unixový socket a po testech ho smaže. Pod rootem používá uživatele `postgres` přes `runuser`, jinak běží pod aktuálním uživatelem. Docker není potřeba.
- **S `DATABASE_URL`** (CI, service container `postgres:16`): použije zadanou databázi. Skript v ní **smaže** schémata `public`, `se_vezmou`, `auth`, `extensions` a `tap`, proto vyžaduje potvrzení `DB_TEST_ALLOW_RESET=1`. Nikdy ho nesměřujte na databázi s daty.

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres DB_TEST_ALLOW_RESET=1 npm run db:test
```

Další proměnné: `DB_TEST_VERBOSE=1` vypíše každou úspěšnou kontrolu. Je potřeba klient `psql` a PostgreSQL 15 nebo novější (cílová verze je 16).

V CI běží test jako samostatný job `db` (`.github/workflows/ci.yml`), spolu s testem nástroje pro nasazení migrací (`npm run db:migrate:test`, viz níže).

### Co testy ověřují

- **Izolace migrací** (`scripts/db-test.sh`, `tests/catalog_snapshot.sql`): snímek katalogu (schémata a jejich ACL, tabulky, sloupce, omezení, spouštěče, politiky, funkce, typy, operátory, `pg_default_acl`, role, členství, nastavení rolí, rozšíření) před migracemi a po nich. Mimo schéma `se_vezmou` se nesmí změnit nic; jedinou výjimkou jsou objekty rozšíření `citext`, `pg_trgm` a `pgcrypto`, pokud je migrace instalují poprvé. Shim napodobuje Supabase včetně výchozích oprávnění ve `public`, takže test odhalí i skrytou závislost.
- `as_app/10_app_role`: skutečné přihlášení jako `se_vezmou_app`. Bez `set role` nejde číst tabulky ani volat funkce (chyba 42501), nejde přepnout na `anon` ani `postgres`, `service_role` volá funkce, ale nečte tabulky, claimy role `authenticated` platí jen v transakci.
- `10_structure`: RLS zapnuté na každé tabulce (FORCE ne, viz `docs/security-privacy.md`), žádná práva pro `anon` ani `PUBLIC` na schéma, složené klíče mezi tenant tabulkami, pravidla `security definer` funkcí (prázdný `search_path`, bez `execute` pro `public` a `anon`), audit append-only.
- `20_isolation`: správce svatby A nečte, nevkládá, nemění ani nemaže data svatby B v **žádné tabulce** (matice tabulek; nová tabulka mimo matici test shodí).
- `30_roles`: host, návštěvník, náhled, `anon` a JWT bez claimů nevidí pracovní tabulky ani nevolají funkce service role.
- `40_operator`: operátor bez grantu nevidí údaje hostů, zásah a audit vznikají v jedné transakci, audit nejde změnit.
- `50_foreign_keys`: složené cizí klíče brání křížovým odkazům mezi svatbami.
- `60_slugs`: tvar a rezervovaná slova, rezervace konceptu a její vypršení, zveřejněný slug se znovu nepřidělí, `last_activity_at`.
- `70_rate_limit` a souběžný test ve skriptu: atomicita a okna `rate_limit_hit`.
- `80_rsvp_site`: slepé RSVP (stejný tvar odpovědi), uzavřené RSVP, pozvání na události, `get_public_site`, odvozená fáze.
- `95_auth_pin` (M4): pauzy po chybách (série, zdvojnásobování, strop 24 h, samovolný návrat úrovně, nulování), `auth_pin_get` (skrývá svatbu bez PINu, smazanou, bez správce), nastavení PINu (formát hashe, odvolání relací, audit bez hodnoty), `auth_session_context`, `email_log_*` a že správce tyto funkce nespustí.
- `85_rsvp_m8` (M8): tolerance překlepů (`se_vezmou.osa_distance`, `se_vezmou.names_close`) a nejednoznačnost, vlastní a vestavěné otázky (typy, možnosti, povinnost, otázky k události), doprovod a děti, `rsvp_info`, host mimo seznam (vypnuto, zapnuto, zavřeno, role), správcovský seznam, přehled a ruční zápis (oprávnění, izolace svatby, audit bez osobních údajů), `analytics_record` bez identifikátorů.
- `96_operator_auth` (M9): relace operátora (AAL1 a AAL2, nečinnost, absolutní doba, odvolání, zakázaný operátor), zápis druhého faktoru (rozepsaný klíč se nepřepíše, potvrzení, záložní kódy), ochrana proti přehrání kódu TOTP, jednorázové záložní kódy, účel výzvy `operator_login`, práva funkcí.
- `97_operator_ops` (M9): `op_*` (seznam s filtry a hledáním bez údajů hostů, detail, poznámky, změna adresy a registr slugů, prodloužení lhůt, smazání a obnova, přihlašovací odkaz, přehled, analytika, retence, audit), matice rolí podpora versus majitel, správa operátorů, audit v téže transakci (atomicita), izolace od údajů hostů.
- `90_lifecycle`: relace a výzvy, limit správců, retenční data a mazání, výmaz hosta, normalizace jmen.

## Nasazení krok za krokem (pro majitele)

Sdílený projekt Supabase, schéma `se_vezmou`, přímé spojení `pg` přes pooler (`docs/adr/0011`). Kroky 1 a 2 majitel už provedl; jsou tu pro úplnost a pro obnovu.

1. **Init schématu.** V Supabase SQL editoru (role `postgres`) spusťte `supabase/init/00_init_se_vezmou.sql` (idempotentní). Vytvoří schéma `se_vezmou`, rozšíření `citext`, `pg_trgm`, `pgcrypto` ve schématu `extensions`, `usage` pro `authenticated` a `service_role`, `revoke` pro `anon` a `public` a výchozí oprávnění jen `in schema se_vezmou`. Poslední krok (zveřejnění schématu pro PostgREST) je pro aplikaci **nepovinný**, protože PostgREST nepoužívá.
2. **Aplikační role.** Spusťte `supabase/init/01_app_role.sql`, ale **nejdřív v něm nahraďte zástupné heslo** silným náhodným heslem (min. 32 znaků, jen písmena a číslice). Skutečné heslo nikdy neukládejte do repozitáře; po spuštění ho z historie dotazů editoru smažte.
3. **`MIGRATE_DATABASE_URL`** (jen na vašem počítači, v shellu; ne do souboru v repozitáři a ne na Vercel): spojení **vlastníka** (role `postgres`), přímé (`db.<ref>.supabase.co:5432`) nebo přes session pooler (`...pooler.supabase.com:5432`, uživatel `postgres.<ref>`). Ne transaction pooler (6543) a ne role `se_vezmou_app`; nástroj obojí odmítne.

   ```bash
   export MIGRATE_DATABASE_URL='postgresql://postgres:<heslo>@db.<ref>.supabase.co:5432/postgres'
   ```

4. **Plán:** `npm run db:migrate -- --dry-run`. Vypíše čekající migrace (soubor a sha256), nic nezapíše. Zkontrolujte, že čekají všechny a že nevypíše žádný `PROBLÉM`.
5. **Aplikace:** `npm run db:migrate`. Každá migrace běží v jedné transakci a zapíše se do `se_vezmou.schema_migrations` (verze, název, sha256, čas). Opakované spuštění nic nezmění. Změněnou už aplikovanou migraci nástroj odmítne a nikdy nic nemaže (migrace s `drop table`, `truncate`, `delete from` na nejvyšší úrovni odmítne). Stav: `npm run db:migrate -- --status`.
6. **Proměnné na Vercelu** (Project Settings, Environment Variables, jen serverové, žádné `NEXT_PUBLIC_*` pro databázi):
   - `DATABASE_URL`: `postgresql://se_vezmou_app.<ref>:<heslo>@aws-0-<region>.pooler.supabase.com:6543/postgres` (transaction pooler, role `se_vezmou_app`; za tečkou je ref projektu). Doporučena je i `DATABASE_CA_CERT` (PEM kořenové CA Supabase, viz `docs/open-questions.md`), jinak je TLS bez ověření řetězu.
   - `AUTH_SECRET`, `RATE_LIMIT_SECRET`, `PIN_PEPPER`: tři různé náhodné hodnoty, každá min. 32 znaků (`openssl rand -base64 48`).
   - E-maily přes AWS SES: `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `EMAIL_FROM` (odesílatel ověřený v SES). Bez nich se e-maily jen vypisují do logu a neodesílají.
   - Dále podle `.env.example` (`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_APP_URL`, `ROOT_DOMAIN`, Sentry).
   - **Nenastavujte** `MIGRATE_DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`: aplikace je nepoužívá.
7. **Ověření po nasazení** (SQL editor, role `postgres`):

   ```sql
   -- migrace aplikovány (počet = počet souborů v supabase/migrations, dnes 17)
   select count(*) from se_vezmou.schema_migrations;
   -- RLS je zapnuté na každé tabulce schématu (0 řádků = v pořádku)
   select relname from pg_class
    where relnamespace = 'se_vezmou'::regnamespace and relkind = 'r' and not relrowsecurity;
   -- aplikační role nemá sama žádná práva ke schématu (false)
   select has_schema_privilege('se_vezmou_app', 'se_vezmou', 'usage');
   -- anon nemá k našemu schématu nic (false)
   select has_schema_privilege('anon', 'se_vezmou', 'usage');
   -- žádné naše objekty mimo schéma se_vezmou (0 řádků)
   select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'app') and c.relname in ('weddings', 'guests', 'sessions', 'operators');
   ```

   Zapomenuté `set role` ověříte přihlášením jako `se_vezmou_app` (např. `psql` s `DATABASE_URL`): `select count(*) from se_vezmou.weddings;` musí skončit `permission denied for schema se_vezmou`. V aplikaci se načte `https://se-vezmou.cz` a přihlášení na `app.se-vezmou.cz` pošle kód (bez SES ho vypíše do logu). Ve Vercel logu se nesmí objevit `Chybí DATABASE_URL`.

### První operátor (majitel) a obnova druhého faktoru

Operátoři se nesmějí zaregistrovat sami (ADR 0012). První operátor vznikne mimo aplikaci spojením vlastníka (`MIGRATE_DATABASE_URL`, stejné jako u migrací):

```bash
npm run db:migrate
npm run ops:create-owner -- majitel@example.cz
```

Skript založí majitele jen když ještě žádný aktivní není (další majitele zakládá majitel v administraci, nebo skript s `--allow-additional`), zapíše audit `operator.bootstrap` bez e-mailu a nic nevypisuje z tajných hodnot. Na Vercel patří navíc `OPERATOR_MFA_KEY` (min. 32 náhodných znaků, `openssl rand -base64 48`; ztráta nebo změna klíče znamená nový zápis druhého faktoru u všech operátorů). Majitel pak otevře `https://admin.se-vezmou.cz/prihlaseni`, opíše kód z e-mailu a zapíše druhý faktor (aplikace TOTP), záložní kódy si uloží mimo telefon. Ztracený faktor majitele obnoví jiný majitel, nebo vlastník databáze: `npm run ops:reset-mfa -- majitel@example.cz` (zneplatní klíč, záložní kódy a relace, zapíše audit). Skripty testuje `npm run db:migrate:test`.

### Nástroj `npm run db:migrate`

`scripts/db-migrate.mjs` (node + `pg`, bez Supabase CLI). Evidence je v `se_vezmou.schema_migrations`, **ne** v globální `supabase_migrations` (sdílený projekt). Nástroj odmítne běžet bez `MIGRATE_DATABASE_URL`, s aplikační rolí, s portem 6543, když chybí role platformy Supabase, když spojení není vlastník schématu `se_vezmou`, když je schéma plné tabulek bez evidence, když se změnila už aplikovaná migrace, když aplikovaná migrace v repozitáři chybí a když čekající migrace je starší než poslední aplikovaná.

Test (`npm run db:migrate:test`, v CI job `db`) běží na čistém clusteru: dry-run, ostrý běh, idempotence, změněný checksum, chybějící a starší migrace, selhání s návratem zpět, destruktivní příkazy, strukturální testy nad databází vytvořenou nástrojem.

Ruční alternativa (jen vývoj): `for f in supabase/migrations/*.sql; do psql "$URL" -v ON_ERROR_STOP=1 -1 -f "$f"; done`. Na sdíleném projektu ji nepoužívejte, nezapisuje evidenci.

## Pravidla pro další migrace

- Nová tabulka s `wedding_id`: zapnout RLS, přidat politiky, složené cizí klíče `(wedding_id, id)`, přidat ji do matice v `tests/20_isolation.test.sql` a napsat test. Chybějící RLS nebo matice shodí `npm run db:test`.
- Nová funkce `security definer`: `set search_path = ''`, plně kvalifikované názvy, `revoke ... from public, anon`, výslovný `grant` jen potřebné roli, filtr podle `se_vezmou.wedding_id()` (kromě funkcí service role před ověřením). Vše patří do schématu `se_vezmou`, žádný `alter default privileges` bez `in schema se_vezmou`, žádný `grant`/`revoke` na schéma `public` ani na jiné schéma než `se_vezmou`; test izolace to hlídá.
- Hotové migrace se po nasazení (`schema_migrations`) neupravují; změny jdou novým souborem. Změněná aplikovaná migrace nasazení zastaví.
