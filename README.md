# se-vezmou

Next.js (App Router, TypeScript, Tailwind CSS) aplikace určená pro nasazení na Vercel.

## Vývoj

```bash
npm install
cp .env.example .env.local   # ROOT_DOMAIN=localhost pro lokální hostitele
npm run dev                  # http://localhost:3000
```

### Hostitelé lokálně (`*.localhost`)

Jedna aplikace obsluhuje čtyři druhy hostitelů (`docs/adr/0002-host-routing-and-sessions.md`).
Běžné prohlížeče překládají `*.localhost` na loopback, takže stačí otevřít:

| Adresa                                | Co se zobrazí                       |
| ------------------------------------- | ----------------------------------- |
| `http://localhost:3000`               | úvodní stránka (`/en` anglicky)     |
| `http://app.localhost:3000`           | přihlášení správce, přehled svatby  |
| `http://admin.localhost:3000`         | provozní administrace (zástupná)    |
| `http://klara-a-matej.localhost:3000` | web ukázkového páru (zástupný)      |
| `http://jiny-par.localhost:3000`      | stejné 404 jako každý neexistující  |
| `http://localhost:3000/ui-catalog`    | katalog UI primitiv (jen mimo prod) |

`src/proxy.ts` přepíše cestu podle hlavičky `Host` na interní segmenty `/h/...`, které zvenku
vrací 404. Na náhledech `*.vercel.app` (bez subdomén) zvol druh hostitele proměnnými
`HOST_PRESET` a `PREVIEW_TENANT_SLUG` (viz `.env.example`; produkce je nikdy nečte).

### Kontroly a testy

```bash
npm run format:check   # Prettier
npm run lint           # ESLint
npm run typecheck      # next typegen + tsc
npm run i18n:check     # parita cs/en, zástupné znaky, česká typografie
npm test               # Vitest (jednotkové a komponentové testy)
npm run build
npm run db:test        # SQL testy databáze (dočasný PostgreSQL, viz supabase/README.md)
npm run test:e2e       # Playwright: hlavičky, 404, hreflang, přihlášení (sestaví a spustí aplikaci + databázi)
npm run test:a11y      # Playwright + axe na zástupných stránkách, v katalogu UI a na obrazovkách přihlášení
```

E2E testy (`test:e2e`, `test:a11y`) běží přes `scripts/e2e-db.sh`: ten připraví databázi s migracemi
(dočasný PostgreSQL přes unixový socket, nebo s `E2E_DATABASE_URL` + `E2E_DB_ALLOW_RESET=1` služba
z CI; databáze se smaže!) a spustí Playwright. Aplikace v testech mluví s Postgresem přímo
(`DB_TRANSPORT=pg`, bez PostgREST) a e-maily zapisuje do souborů (`EMAIL_TRANSPORT=outbox`), takže
test přihlášení přečte kód z "doručeného" e-mailu. Obě testovací dopravy jsou v ostré produkci
(`VERCEL_ENV=production`) odmítnuty. Potřebný je klient `psql`.

Playwright potřebuje Chromium. V CI se instaluje `npx playwright install --with-deps chromium`.
Lokálně lze použít už nainstalovaný prohlížeč:
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/cesta/k/chromium npm run test:e2e`. Testovací server běží
na portu 3100 (`E2E_PORT`).

### Přihlášení a relace (M4)

Správci se přihlašují bez hesla na `app.se-vezmou.cz` (`docs/adr/0002`, `docs/security-privacy.md`):

- **Kód nebo odkaz z e-mailu** (`/prihlaseni`): šestimístný kód, platnost 10 minut, použitelný jednou.
  Odkaz z e-mailu jen otevře potvrzovací stránku (nespotřebuje ho skener schránky), přihlásí až
  odeslání formuláře. Odpověď je stejná pro známý i neznámý e-mail.
- **PIN správy** (`/prihlaseni/pin`): adresa webu a PIN (min. 6 číslic, argon2id + pepper); 5 chyb =
  pauza 15 minut, každá další série dvojnásobná, strop 24 hodin. Každé přihlášení PINem i pauza se
  oznámí na záložní e-mail. Pauza PINu nebrání přihlášení kódem z e-mailu.
- **Relace**: neprůhledný token v cookie `__Host-sv_admin` (`HttpOnly`, `Secure`, `SameSite=Lax`,
  bez `Domain`), v databázi jen SHA-256; nečinnost 14 dní, absolutně 60 dní. Na `localhost` se
  prefix `__Host-` i `Secure` vynechávají (`src/auth/cookie.ts`). Každá Server Action ověřuje původ
  (`Origin`) a relaci sama (`src/auth/request.ts`, `src/auth/session.ts`).
- **Omezení počtu požadavků** podle IP i e-mailu (HMAC klíče); všechny limity a lhůty jsou v
  `src/auth/config.ts`.

Tajné hodnoty (`AUTH_SECRET`, `RATE_LIMIT_SECRET`, `PIN_PEPPER`, `SUPABASE_JWT_SECRET`,
`SUPABASE_SERVICE_ROLE_KEY`) mají min. 32 znaků a patří jen do prostředí serveru (viz `.env.example`).
Aplikace nepoužívá žádný anon klíč a prohlížeč s databází nemluví vůbec.

Lokální vývoj bez projektu Supabase: spusťte vlastní PostgreSQL 15+ s nahraným shimem platformy
a migracemi (`supabase/tests/setup/00_shim.sql` a `supabase/migrations/*.sql`, viz
`supabase/README.md`) a do `.env.local` přidejte `DB_TRANSPORT=pg`, `DATABASE_URL=…` a tři tajné
hodnoty. Bez AWS proměnných se e-maily (včetně kódu) vypisují do konzole dev serveru a neodesílají.

### Překlady a typografie

Texty jsou v `src/i18n/messages/{cs,en}/<jmenný prostor>.json` a používají se přes
`createTranslator(locale)` (`t("namespace.klic")`, `t.rich` pro `<a>`, `<b>`, `<i>`). Česká
typografie (nezlomitelné mezery, třítečka, pomlčka) se aplikuje funkcí `typo()` na každý výstup;
uvozovky musí být ve zdroji správné znaky (`„…“`, `“…”`). Chybějící klíč v jednom jazyce
shodí `npm run i18n:check` (ADR 0003).

## Nasazení na Vercel

1. Na https://vercel.com/new naimportuj tento GitHub repozitář.
2. Vercel automaticky detekuje Next.js (build `next build`, žádná další konfigurace není potřeba).
3. Proměnné prostředí nastav v _Project Settings → Environment Variables_
   (vzor viz `.env.example`).
4. Na Vercelu se staví **pouze větev `main`** (produkce). Ostatní větve se přeskakují přes
   `ignoreCommand` ve `vercel.json`, takže PR a pushe do `pre-prod` nespouštějí build.

## Workflow větví

- `main`: produkce, každý push = produkční deploy.
- `pre-prod`: sběrná větev. Feature větve se z ní větví a PR mířejí do `pre-prod`.
  Až je hotová dávka změn, otevře se jeden PR `pre-prod` → `main` a mergne se najednou.
- CI (GitHub Actions) běží na každém PR i pushi do `main` a `pre-prod`.
- Preview konkrétní větve lze vyžádat ručně: `npx vercel` (nebo dočasně upravit `ignoreCommand`).

Případně přes CLI: `npx vercel` (preview) / `npx vercel --prod`.
