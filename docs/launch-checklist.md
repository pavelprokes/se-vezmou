# Kontrolní seznam před spuštěním (pro majitele)

Stav: k 2. 10. 2026 (po M10, M11 probíhá). Jedna stránka s tím, co musíte udělat vy před ostrým provozem a při něm. Podrobnosti jsou v odkazovaných dokumentech. Co je `[OVĚŘIT]`, ověřte v aktuální dokumentaci dodavatele, než se na to spolehnete.

## 1. Proměnné prostředí na Vercelu

Project Settings, Environment Variables, **Production** (a podle potřeby Preview). Tajné hodnoty vytvořte příkazem `openssl rand -base64 48`, každá **jiná**, nikdy je neukládejte do repozitáře. Po každé změně je potřeba nové nasazení.

| Proměnná                                                                      | Povinná          | Minimum a poznámka                                                                                                                          |
| ----------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                | ano              | pooler Supabase, transaction mode (port 6543), role `se_vezmou_app`                                                                         |
| `DATABASE_CA_CERT`                                                            | ano              | PEM kořenové CA Supabase; spojení se vzdálenou databází ověřuje certifikát, bez ní selže (OQ-45). Vědomé opt-out: `DATABASE_TLS_INSECURE=1` |
| `AUTH_SECRET`                                                                 | ano              | min. **32 znaků**                                                                                                                           |
| `RATE_LIMIT_SECRET`                                                           | ano              | min. **32 znaků**                                                                                                                           |
| `PIN_PEPPER`                                                                  | ano              | min. **32 znaků**; rotace vyžaduje plán (`docs/security-privacy.md` kap. 1.2)                                                               |
| `OPERATOR_MFA_KEY`                                                            | ano              | min. **32 znaků**; šifruje TOTP operátorů, ztráta nebo změna = všichni operátoři zapíšou druhý faktor znovu                                 |
| `CRON_SECRET`                                                                 | ano              | min. **32 znaků**; bez něj **každá `/api/cron/*` tiše vrací 401** a nic se nemaže ani neposílá                                              |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`                    | ano              | IAM uživatel jen na odesílání SES; region `eu-central-1`                                                                                    |
| `EMAIL_FROM`                                                                  | ano              | odesílatel ověřený v SES, např. `Se vezmou <info@se-vezmou.cz>`                                                                             |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`                   | ano (fotografie) | token omezený na jeden bucket                                                                                                               |
| `R2_BUCKET`                                                                   | ano (fotografie) | např. `se-vezmou-photos`                                                                                                                    |
| `R2_ENDPOINT`, `S3_REGION`                                                    | volitelné        | `https://<account-id>.eu.r2.cloudflarestorage.com`, `auto`                                                                                  |
| `NEXT_PUBLIC_SITE_URL`                                                        | ano              | `https://se-vezmou.cz`, shodně s hlavním jménem (apex nebo `www`, viz bod 6)                                                                |
| `NEXT_PUBLIC_APP_URL`                                                         | ano              | `https://app.se-vezmou.cz`                                                                                                                  |
| `ROOT_DOMAIN`                                                                 | ano              | `se-vezmou.cz`                                                                                                                              |
| `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | volitelné        | viz bod 9                                                                                                                                   |

**Nenastavujte** na Vercelu: `MIGRATE_DATABASE_URL`, `MIGRATE_CA_CERT`, `EMAIL_TRANSPORT`, `EMAIL_OUTBOX_DIR`, `STORAGE_DRIVER`, `CRON_TEST_CLOCK`, `OG_FETCH_TEST_HOST`, `ENABLE_UI_CATALOG`, `HOST_PRESET`, `PREVIEW_TENANT_SLUG`, `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`. Úplný vzor je `.env.example`.

## 2. Cloudflare R2 (fotografie)

Postup krok za krokem je v `supabase/README.md`, kapitola Fotografie. Stručně:

1. Nový **privátní** bucket (např. `se-vezmou-photos`), jurisdikce **EU** (nejde později změnit), veřejný přístup vypnutý.
2. API token **Object Read & Write** jen pro tento bucket; uložte Access Key ID, Secret a Account ID.
3. Pravidlo životního cyklu: předpona `incoming/` smazat po 1 dni.
4. CORS: `PUT` jen z `https://app.se-vezmou.cz` (hlavička `content-type`).
5. Proměnné z bodu 1, **nové nasazení** (adresa R2 je i v CSP).
6. Zkouška: nahrát fotografii s polohou, zveřejnit, ověřit, že se obrázek načte z R2 a že v `incoming/` nic nezůstalo.
7. Smlouva o zpracování s Cloudflare, rozhodnutí o záloze (R2 samo nezálohuje), OQ-56.

## 3. Databáze a migrace

1. Init skripty `supabase/init/00_*.sql` a `01_*.sql` (změňte heslo role `se_vezmou_app`!), viz `supabase/README.md`.
2. `cp .env.migrate.example .env.migrate.local` a doplňte `MIGRATE_DATABASE_URL` (vlastník, session pooler) a `MIGRATE_CA_CERT_FILE` (cesta ke kořenové CA Supabase, povinná; vědomé opt-out `MIGRATE_TLS_INSECURE=1`). Soubor není v gitu a nepatří na Vercel.
3. `npm run db:migrate -- --dry-run`, pak `npm run db:migrate`. Stav: `npm run db:migrate -- --status`.
   **Další nasazení migrací je automatické:** v GitHubu nastavte tajné hodnoty `MIGRATE_DATABASE_URL` a `MIGRATE_CA_CERT` (obsah PEM), workflow `.github/workflows/migrate.yml` pak migrace spustí po každém pushi do `main`, který je mění (`supabase/README.md`, „Automatické nasazení migrací“).
4. **Past s „budoucími“ daty migrací.** Soubory migrací jsou číslované daty (`20261008120000_media.sql`), která jsou **později než skutečné dnešní datum**. Nástroj odmítne čekající migraci, která je **starší než poslední aplikovaná**, a odmítne i změněnou už aplikovanou. Novou migraci proto vždy pojmenujte **po nejnovější existující** (vyšší číslo než všechny v `supabase/migrations/`), ne podle kalendáře, a hotové migrace nikdy neupravujte ani komentáře v nich (změní se kontrolní součet). Opravy jdou novým souborem.
5. Ověřovací dotazy po nasazení jsou v `supabase/README.md` (počet migrací, RLS, práva rolí).

## 4. První operátor a plánované úlohy

1. `npm run ops:create-owner -- majitel@example.cz` (se `MIGRATE_DATABASE_URL`). Poté `https://admin.se-vezmou.cz/prihlaseni`: kód z e-mailu, zápis druhého faktoru (TOTP), **záložní kódy uložte mimo telefon**. Doporučeno alespoň dva operátory. Ztracený faktor: `npm run ops:reset-mfa -- …`.
2. **Cron.** `vercel.json` plánuje `/api/cron/daily` (03:17 UTC: retence, životní cyklus, úklid) a `/api/cron/blog` (22:01 a 23:01 UTC, tedy po půlnoci letního i zimního času: zveřejnění naplánovaných článků blogu). Bez platného `CRON_SECRET` (min. 32 znaků) vrací 401. Po prvním běhu (nebo ručně _Settings → Cron Jobs → Run_) musí v `se_vezmou.job_runs` přibýt řádek (`select job, status, started_at from se_vezmou.job_runs order by started_at desc limit 5;`). Žádný řádek = chyba, řešte před spuštěním.
3. **Limity tarifů** `[OVĚŘIT]`: Vercel Hobby (jen denní cron s hodinovou přesností, omezený počet cron úloh, **nekomerční použití**; pro placený provoz zvolte vhodný tarif), `maxDuration` 60 s; Supabase: velikost poolu a `max_connections` sdílené s jinými aplikacemi (`max` 5 na instanci, OQ-48), délka záloh (právní otázka, `docs/security-privacy.md` kap. 6); R2: ceny a operace (OQ-55).

## 5. Vercel: doména a DNS

1. Doména `se-vezmou.cz` na **nameserverech Vercelu** (`ns1.vercel-dns.com`, `ns2.vercel-dns.com`); před přepnutím zkopírujte všechny stávající záznamy (MX, SPF, DKIM) a po něm je zkontrolujte (`docs/technical-design.md` kap. o DNS).
2. V projektu přidejte domény: `se-vezmou.cz` (apex), `www`, `app`, `admin` a **wildcard `*.se-vezmou.cz`** (weby párů). Explicitní `app.` a `admin.` mají přednost před wildcardem. Wildcard certifikát vydává Vercel.
3. **Nastavení `www`:** aplikace `www` nepřesměrovává (obsluhuje ji jako úvodní stránku). Které jméno je hlavní, určuje **přesměrování ve Vercelu** (jedno jméno na druhé) a `NEXT_PUBLIC_SITE_URL` musí být stejné hlavní jméno; jinak vznikne nesoulad kanonické adresy nebo smyčka.
4. Produkční větev je `main`; ostatní se na Vercelu nestaví (`ignoreCommand`).

## 6. Právní texty a zástupné hodnoty

Dokud jsou zástupné, **nespouštějte veřejně**:

- Provozovatel (Pavel Prokeš, IČO 87877601) a kontakt (info@se-vezmou.cz) jsou doplněné v `src/config/operator.ts` (patička, FAQ, právní stránky, strukturovaná data), OQ-21.
- `[PODMÍNKY]` (konec zaváděcího provozu a podmínky po něm) v `src/config/pricing.ts`, OQ-11. Texty nikdy neslibují „zdarma navždy“.
- Stránky `/soukromi`, `/podminky`, prohlášení o přístupnosti (`src/i18n/messages/*/legal.json`) jsou zástupné; zásady musí uvést dílčí zpracovatele (Vercel, Supabase, AWS SES, Cloudflare R2, případně Sentry), že prohlížeč hosta se připojuje k R2 (IP adresa), koncept průvodce v `localStorage` a pár jako správce údajů hostů (`docs/security-privacy.md` kap. 5).
- Krátké sdělení u RSVP (`rsvp.privacy.notice`) a upozornění u zdravotních údajů (`rsvp.health.notice`, „30 dní“ napevno, OQ-61).

## 7. Schválení právníkem (skutečným, OQ-22)

Předat `docs/security-privacy.md` kap. 11 a OQ: retence (30 dní dietní údaje, 12 měsíců hosté, koncept 14 dní, archiv po smazání hostů 90 dní, čekací listina 12 měsíců; OQ-10, 58, 59, 60), právní základ zdravotních údajů, zpracovatelské ujednání mezi párem a provozovatelem, seznam dílčích zpracovatelů a přenosy mimo EU, doba záloh, souhlas s nahlédnutím operátora, krátké sdělení pro hosty, souhlasová lišta, výmaz jednoho hosta (OQ-62), oznámení nejlepším úsilím (OQ-63), `localStorage` (OQ-64), podmínky služby a přístupnost. Výsledek zapište do `docs/open-questions.md` se stavem a datem.

## 8. Texty, přístupnost a kontrola kvality

- Korektura všech textů cs i en (anglické texty dodá copywriterka, britská angličtina, OQ-02 a OQ-33); `npm run i18n:check` hlídá paritu a typografii, ne věcnou správnost.
- Brána B (`docs/test-plan.md`): přístupnost WCAG 2.2 AA (ruční testy čtečkou a klávesnicí), test izolace dat, slepé RSVP, přihlášení bez hesla. CI musí být zelené: `format:check`, `lint`, `typecheck`, `i18n:check`, `test`, `build`, `db:test`, `test:e2e`, `test:a11y`.
- Ověřit historii domény (OQ-31) a výsledek zapsat.

## 9. Sentry: rozhodnutí o DSN (OQ-65)

Sentry je další zpracovatel. Bez `NEXT_PUBLIC_SENTRY_DSN` se nic neodesílá. Pokud ho zapnete: projekt v **EU regionu**, smlouva o zpracování, nastavená doba uchování, zápis do seznamu zpracovatelů; v prohlížeči poběží jen na úvodní stránce a události jsou čištěné od adres, cest, těla požadavku, cookies a drobečků (`src/lib/sentry-scrub.ts`). `SENTRY_AUTH_TOKEN` jen pro nahrání source map při sestavení.

## 10. E-mail: AWS SES

1. Doména `se-vezmou.cz` ověřená v SES (`eu-central-1`), **Easy DKIM** zapnutý, CNAME záznamy ve Vercel DNS; SPF (TXT s `include` pro SES), vlastní MAIL FROM doména (např. `bounce.se-vezmou.cz`), DMARC nejdřív `p=none` s reportem, po několika týdnech `quarantine`, pak `reject` (`docs/adr/0005-email.md`).
2. Nový účet SES je v **sandboxu**: odesílá jen na ověřené adresy. Požádejte o **produkční přístup** s předstihem (schvaluje se dny); bez něj kódy nedorazí běžným uživatelům.
3. IAM uživatel jen s právem odesílat; klíče do Vercelu. Zkouška: přihlášení na `app.se-vezmou.cz` na cizí adresu (gmail) a kontrola, že e-mail není ve spamu.
4. V produkci bez SES se **nic neodešle** a obsah se nikdy nevypisuje: odeslání selže, do logu Vercelu se zapíše chyba
   (bez obsahu e-mailu) a záznam e-mailu dostane stav `failed`. Kontrola: po zkoušce z bodu 3 v logu není `[e-mail] odeslání selhalo`.
5. **Vrácené e-maily a stížnosti:** zapněte potlačení na úrovni účtu SES, aby se na trvale nedoručitelné adresy
   a adresy, ze kterých přišla stížnost, už neposílalo (jinak hrozí kontrola nebo pozastavení účtu SES, a s ním
   i nedoručené přihlašovací kódy):
   `aws sesv2 put-account-suppression-attributes --region eu-central-1 --suppressed-reasons BOUNCE COMPLAINT`.
   V konzoli SES sledujte podíl vrácených (pod 5 %) a stížností (pod 0,1 %). Události doručení do aplikace
   (webhook `/api/email/events` přes SNS, `src/lib/email/events.ts`) zatím nejsou; pokud je zavedete, nastavte
   konfigurační sadu s cílem SNS a její název do `SES_CONFIGURATION_SET`.

## 11. Poslední kontrola v den spuštění

- [ ] Všechny proměnné z bodu 1 nastavené, nasazení po poslední změně hotové.
- [ ] `npm run db:migrate -- --status`: všechny migrace aplikované.
- [ ] První operátor se přihlásí, záložní kódy uložené.
- [ ] `job_runs` má řádek po prvním cronu.
- [ ] Zkušební svatba: průvodce, zveřejnění, RSVP, fotografie, PIN hostů, export; e-maily dorazí.
- [ ] Zástupné hodnoty z bodu 6 nahrazené, právník schválil bod 7.
- [ ] DNS, wildcard, `www` a `NEXT_PUBLIC_SITE_URL` shodné; `noindex` na webech párů, `app.` a `admin.`.
