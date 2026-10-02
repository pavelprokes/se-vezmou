# ADR 0011: Vlastní schéma `se_vezmou` na sdíleném projektu a přímé spojení `pg` přes pooler

- Stav: přijato majitelem (2. 10. 2026), implementováno ve větvi `claude/db-schema-se-vezmou`.
- Související: ADR 0001 (databáze; tímto ADR částečně nahrazeno), ADR 0002 (relace), ADR 0008 (operátoři), `docs/data-model.md` (kapitola 5), `docs/security-privacy.md`, `supabase/README.md`.

## Kontext

Projekt Supabase, na kterém běží se-vezmou.cz, je **sdílený**: žije v něm i jiný obsah. Náš projekt proto smí používat výhradně vlastní schéma `se_vezmou` (s podtržítkem) a nesmí nic měnit globálně: ani schéma `public`, ani výchozí oprávnění, ani cizí tabulky. Majitel už provedl init (schéma `se_vezmou`, rozšíření `citext`, `pg_trgm`, `pgcrypto` ve schématu `extensions`, `usage` pro `authenticated` a `service_role`, `revoke` pro `anon` a `public`, výchozí oprávnění `in schema se_vezmou`) a založil roli `se_vezmou_app` (`login`, `noinherit`, `nobypassrls`, členství v `authenticated` a `service_role` jen kvůli `set role`).

ADR 0001 počítal s tím, že server vydá krátkodobý JWT a zavolá `supabase-js` (PostgREST). To vyžaduje `NEXT_PUBLIC_SUPABASE_URL`, klíč `service_role`, JWT secret projektu a vystavení schématu pro PostgREST. Majitel rozhodl, že proměnné `NEXT_PUBLIC_SUPABASE_*` nebudou a že aplikace PostgREST ani `supabase-js` nepoužívá: na Vercelu je jen serverová proměnná `DATABASE_URL` (connection string přes pooler Supabase v transaction módu, port 6543) pro roli `se_vezmou_app`.

## Možnosti

| Možnost                                                                                            | Pro                                                                                                                                                                                            | Proti                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Schéma `se_vezmou` + přímé spojení `pg` přes pooler, role `se_vezmou_app`, `set local role`** | Žádný klíč s právy nad celým projektem na Vercelu, žádný JWT secret, žádná závislost na PostgREST. Stejné testy a stejný model jako v CI. Funkce `security definer` a RLS zůstávají beze změny | Vlastní práce s pool/transakcemi. Zapomenuté `set role` je nová třída chyby (mitigace níže)                                                                         |
| B. Schéma `se_vezmou` vystavené přes PostgREST, `supabase-js` s JWT (původní ADR 0001)             | Hotový klient, typy                                                                                                                                                                            | Vyžaduje `NEXT_PUBLIC_SUPABASE_URL`, klíč `service_role` a JWT secret sdíleného projektu (klíč s právy nad VŠEMI schématy projektu na Vercelu). Majitel to vyloučil |
| C. Samostatný projekt Supabase jen pro se-vezmou.cz                                                | Úplná izolace od jiného obsahu, vlastní klíče                                                                                                                                                  | Další náklady a správa. Majitel zvolil sdílený projekt                                                                                                              |
| D. Přímé spojení (port 5432) z funkcí Vercelu místo poolu                                          | Plná funkčnost Postgresu (session stav)                                                                                                                                                        | Každá serverless instance by držela vlastní spojení a vyčerpala limit; přímá adresa je navíc IPv6. Pro migrace vhodné, pro aplikaci ne                              |
| E. Session pooler (port 5432) pro aplikaci                                                         | Drží session stav                                                                                                                                                                              | Spojení je vyhrazené klientovi, na serverless nevhodné. Aplikace session stav nepotřebuje (všechno je `set local` v jedné transakci)                                |

## Rozhodnutí (doporučení)

**Zvolit A.** Podrobnosti:

1. **Schéma.** Všechny tabulky, typy, domény (`i18n_text`), funkce, triggery, indexy, politiky RLS i pomocné funkce (dříve `app.*` a `public.*`) žijí jen ve schématu `se_vezmou`. Schéma `app` zaniká. Funkce mají dál `set search_path = ''` a plně kvalifikované názvy (rozšíření jako `extensions.citext`). Migrace byly přepsány na místě (nikde nebyly aplikovány), názvy a pořadí souborů zůstaly.
2. **Migrace nic neměnní mimo `se_vezmou`.** První migrace idempotentně zajistí schéma, rozšíření a oprávnění (totéž co `supabase/init/00_init_se_vezmou.sql` kromě `alter role authenticator`). Žádný `alter default privileges` bez `in schema se_vezmou`, žádný `grant`/`revoke` na schéma `public`. Operátoři (`operators.auth_user_id`) už nemají cizí klíč na `auth.users` (ten by přidal spouštěče do cizí tabulky). Hlídá to **test izolace**: snímek katalogu (schémata a jejich ACL, tabulky, funkce, typy, `pg_default_acl`, role, členství, rozšíření) před migracemi a po nich; mimo `se_vezmou` se nesmí změnit nic, kromě objektů rozšíření, která migrace poprvé instalují. Shim napodobuje Supabase včetně výchozích oprávnění ve `public`.
3. **Role a transakce.** Aplikace se připojuje jako `se_vezmou_app`, která sama nemá žádná práva (nevlastní nic, nemá `usage` na schéma). Každé volání je **jedna transakce**: `begin; set local role service_role` (před ověřením, cron, operátor) nebo `set local role authenticated` a `select set_config('request.jwt.claims', <json>, true)` (správce, host po PINu, návštěvník webu). Claimy jsou jen `sub`, `wedding_id`, `wedding_role`; nepodepisují se a neopouštějí server (zaniká `src/lib/db/jwt.ts` i `SUPABASE_JWT_SECRET`). Pomocné funkce `se_vezmou.wedding_id()`, `wedding_role()`, `actor_id()` čtou `request.jwt.claims` přímo (`se_vezmou.jwt_claims()`), ne přes schéma `auth`, takže na cizím schématu nezávisí. Volání je přes funkce `security definer`, tedy tabulky nikdy nečte aplikační kód přímo.
4. **Pool.** `pg` (`Pool`), `max` 5, bez pojmenovaných prepared statements (transaction mode Supavisoru), časové limity (spojení 5 s, dotaz 20 s, nečinnost 10 s) a stejné limity na straně role (`statement_timeout`, `idle_in_transaction_session_timeout` v `01_app_role.sql`), `attachDatabasePool` z `@vercel/functions` (funkce zůstane naživu, dokud pool neuzavře nečinná spojení, ověřeno v balíčku: u `pg` poslouchá událost `release`). `DATABASE_URL`, záložně `SUPABASE_URL`, ale jen pokud začíná `postgres://` nebo `postgresql://`. V produkci je `pg` jediná cesta; bez `DATABASE_URL` selže volání (ne sestavení) jasnou zprávou.
5. **TLS.** Spojení je vždy šifrované (výchozí `sslmode=require`). Pooler Supabase má certifikát podepsaný vlastní CA Supabase, kterou systémové úložiště nezná, proto výchozí režim **neověřuje řetěz certifikátů** (ochrana před odposlechem, ne před aktivním útočníkem v síti). Zapnutí ověření je jedna proměnná: `DATABASE_CA_CERT` (PEM kořenové CA z Dashboardu) nebo `sslmode=verify-full`. Doporučuji ho zapnout `[OTÁZKA]` OQ-45. Nešifrované spojení je povoleno jen na loopback a unixový socket.
6. **Nasazení migrací.** `npm run db:migrate` (`scripts/db-migrate.mjs`, node + `pg`, bez Supabase CLI) s `MIGRATE_DATABASE_URL` vlastníka (role `postgres`, přímé spojení nebo session pooler, nikdy aplikační role a nikdy port 6543). Každá migrace v transakci, evidence v `se_vezmou.schema_migrations` (verze, název, sha256, čas), ne v globální `supabase_migrations`; změněný checksum aplikované migrace se odmítne, `--dry-run` a `--status`, nikdy nic nemaže.
7. **CI a lokálně.** Aplikace i testy e2e se připojují jako `se_vezmou_app` (ne superuživatel), migrace aplikuje vlastník zvlášť. E2E tak ověřují skutečný model oprávnění.

## Důsledky

### Co se mění oproti ADR 0001

- Doprava: místo `supabase-js` a PostgREST přímé `pg`. Odstraněny `@supabase/supabase-js`, `src/lib/db/jwt.ts`, `src/lib/db/client.ts` a proměnné `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`.
- Krátkodobý JWT zaniká; claimy se předávají v transakci. Model izolace (RLS podle `wedding_id`, `security definer` funkce pro vše před ověřením) a testy izolace zůstávají.
- Jmenný prostor: všechno v `se_vezmou`, schéma `app` zaniklo. Funkce, které volá server, mají stejné názvy jako dřív.
- Varianta Neon z ADR 0001 (`SET LOCAL` místo JWT) je v podstatě realizována: pomocné funkce čtou claimy z nastavení transakce, jen název nastavení zůstal `request.jwt.claims`.
- Zůstává platné: ADR 0001 o omezení počtu požadavků (`rate_limit_hit`), krátká životnost relací v aplikaci, oddělení operátorské cesty.

### Bezpečnost

- **Aplikační role vs. vlastník.** Aplikace nikdy nemá roli vlastníka (`postgres`). Vlastník vlastní tabulky a funkce a ke zdrojům mimo migrace se aplikace nedostane. `security definer` funkce běží jako vlastník (obchází RLS, proto je každá musí sama filtrovat podle `wedding_id` a roli); `FORCE ROW LEVEL SECURITY` se **nezapíná**, protože by tytéž funkce zablokoval (viz `docs/security-privacy.md`).
- **Riziko zapomenutého `set role`.** Bez `set local role` je dotaz proveden jako `se_vezmou_app`, která nemá žádná práva: skončí chybou 42501, ne únikem. Hlídá to test `supabase/tests/as_app/10_app_role.test.sql` (skutečné přihlášení jako `se_vezmou_app`: nelze číst tabulky ani volat funkce, nelze `set role anon`/`postgres`, claimy nepřežijí transakci) a jednotkové testy dopravy (role i claimy se nastaví v téže transakci před voláním funkce, nikdy `service_role` pro volání s totožností svatby). Bezpečnost nestojí na jediném příkazu: i `authenticated` bez claimů nevidí řádky a `service_role` nemá práva k tabulkám.
- **Sdílené role.** `anon`, `authenticated` a `service_role` jsou společné celému projektu. Naše schéma jim uděluje jen to, co potřebují, a `anon` nic. Kdo drží klíč `service_role` sdíleného projektu, může volat funkce `service_role` ve všech schématech včetně našeho; proto klíč nepatří na Vercel našeho projektu a schéma je lepší z PostgREST odebrat (OQ-46).
- Heslo role `se_vezmou_app` je jen v `DATABASE_URL` na Vercelu; v repozitáři je zástupné.

### Provoz a údržba

- Transaction mode: žádný stav spojení mezi příkazy; vše `set local`. Počet souběžných spojení omezuje `max` poolu a pooler.
- Přibývá povinnost mít role `anon`, `authenticated`, `service_role` (platforma Supabase); `db:migrate` ověřuje, že existují.
- Typy pro aplikaci se negenerují z PostgREST; funkce se volají přes tenkou vrstvu `src/lib/db/rpc.ts`.

### Co zůstává otevřené

OQ-45 až OQ-49 v `docs/open-questions.md`: ověřování certifikátu databáze, odebrání schématu z PostgREST, přihlášení operátorů a úložiště fotografií bez `supabase-js` (ADR 0002, 0006 a 0008 počítají se Supabase Auth a Storage), limity poolu a rotace hesla role.
