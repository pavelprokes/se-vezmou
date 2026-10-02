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
| `http://app.localhost:3000`           | průvodce a správa páru (zástupná)   |
| `http://admin.localhost:3000`         | provozní administrace (zástupná)    |
| `http://klara-a-matej.localhost:3000` | web ukázkového páru (zástupný)      |
| `http://jiny-par.localhost:3000`      | stejné 404 jako každý neexistující  |
| `http://localhost:3000/ui-catalog`    | katalog UI primitiv (jen mimo prod) |

`src/proxy.ts` přepíše cestu podle hlavičky `Host` na interní segmenty `/h/...`, které zvenku
vrací 404. Na náhledech `*.vercel.app` (bez subdomén) zvol druh hostitele proměnnými
`HOST_PRESET` a `PREVIEW_TENANT_SLUG` (viz `.env.example`; produkce je nikdy nečte).

### Úvodní stránka (M2)

- Komponenty sekcí jsou v `src/components/landing/`, stránka v `src/app/h/marketing/[locale]/page.tsx`.
- Ceny a podmínky zaváděcího provozu jsou na jednom místě v `src/config/pricing.ts`, údaje
  provozovatele a kontakt (zatím zástupné) v `src/config/operator.ts`.
- Tlačítka „Vytvořit web“ a pole jmen vedou na průvodce: adresu určuje `NEXT_PUBLIC_APP_URL`,
  cestu a query parametry (`jmeno1`, `jmeno2`, `jazyk`) `src/lib/wizard-link.ts`.
- Čekací listina běží přes Server Action za rozhraním `src/lib/waitlist.ts`. Dokud není hotová
  databáze (M3), adaptér záznam jen zaloguje bez osobních údajů a **e-mail se neukládá**.
- Obrázky pro sdílení (`public/og/`) vznikají skriptem `node scripts/generate-og.mjs`.

### Kontroly a testy

```bash
npm run format:check   # Prettier
npm run lint           # ESLint
npm run typecheck      # next typegen + tsc
npm run i18n:check     # parita cs/en, zástupné znaky, česká typografie
npm test               # Vitest (jednotkové a komponentové testy)
npm run build
npm run test:e2e       # Playwright: hlavičky, robots.txt, 404, hreflang (sestaví a spustí aplikaci)
npm run test:a11y      # Playwright + axe na všech zástupných stránkách a v katalogu UI
```

Playwright potřebuje Chromium. V CI se instaluje `npx playwright install --with-deps chromium`.
Lokálně lze použít už nainstalovaný prohlížeč:
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/cesta/k/chromium npm run test:e2e`. Testovací server běží
na portu 3100 (`E2E_PORT`).

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
