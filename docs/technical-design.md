# Technický návrh se-vezmou.cz

Stav: návrh ke schválení (2. 10. 2026). Navazuje na `docs/data-model.md` a ADR 0001 až 0004. Co zadání nedefinuje, je označeno `[OTÁZKA]`; co je třeba ověřit v aktuální dokumentaci dodavatele před implementací, je `[OVĚŘIT]`. Ukázková jména párů jsou Klára a Matěj (adresa `klara-a-matej.se-vezmou.cz`). Verze Next.js v repozitáři je 16.3.8 a má odlišné konvence; před psaním kódu se čte příslušná část `node_modules/next/dist/docs/` (AGENTS.md).

## 1. Architektura

Jedna aplikace Next.js (App Router) na Vercelu obsluhuje čtyři druhy hostitelů. Data jsou v Supabase Postgres (EU, Frankfurt), ve sdíleném projektu výhradně ve vlastním schématu `se_vezmou`; aplikace s ním mluví přímo přes `pg` (ADR 0011). E-maily, úložiště fotografií a analytika jsou samostatná rozhodnutí v dalších ADR; zde jsou jen jako integrace za rozhraními.

```
 prohlížeč ──► Vercel edge/CDN ──► Next.js (jedna aplikace, region fra1 [OVĚŘIT])
                                      │  src/proxy.ts: Host → interní segment
                                      ▼
   se-vezmou.cz            → /h/marketing/{cs|en}/…
   app.se-vezmou.cz        → /h/app/…
   admin.se-vezmou.cz      → /h/admin/…
   klara-a-matej.se-vezmou.cz → /h/tenant/klara-a-matej/{locale}/…
                                      │
        ┌─────────────────────────────┼──────────────────────────────┐
        ▼                             ▼                              ▼
  Postgres, schéma se_vezmou   e-mail (ADR e-mailů)        úložiště fotek (ADR)
  (RLS, přímé `pg`, ADR 0011)
```

Principy:

- **Jedna aplikace, striktní oddělení dat** (požadavek principal engineera). Oddělení dat mezi svatbami drží databáze (RLS), ne vrstva aplikace (`docs/data-model.md`, kapitola 5).
- **Vše veřejné se vykresluje na serveru**; klientský JavaScript jen tam, kde je interakce (formuláře, průvodce, editor, přepínač náhledu).
- **Prohlížeč nemluví s databází.** Žádný klient Supabase v prohlížeči, žádný PostgREST ani `supabase-js`. Server se připojuje přímo (`pg`, `Pool`, pooler Supabase v transaction módu) jako aplikační role `se_vezmou_app`, která sama nemá žádná práva. Každé volání je jedna transakce: `set local role service_role` (před ověřením, cron, operátor), nebo `set local role authenticated` a claimy `sub`, `wedding_id`, `wedding_role` v `set_config('request.jwt.claims', …, true)` (správce, host, návštěvník). Service role má jen cron, retence, operátorské auditované cesty a úzká sada `security definer` funkcí (ADR 0001, ADR 0011).
- **Vlastní relace** (neprůhledný token, v DB hash, cookie `__Host-…`) pro správce a hosty; operátoři přes e-mail OTP a TOTP v naší databázi (ADR 0012, OQ-47).
- **Konfigurovatelnost na jednom místě:** ceny a texty zaváděcího provozu (`src/config/pricing.ts`, FR-LP-3), seznam rezervovaných slugů, provozní hodnoty v `app_settings` v databázi.

### Stav kostry repozitáře a co se mění

Kostra obsahovala `@supabase/ssr` a `@supabase/supabase-js` (`supabase-js` je odstraněn, ADR 0011), dále `@aws-sdk/client-sesv2`, `@sentry/nextjs`, `@vercel/analytics`, `@vercel/speed-insights`, `react-hook-form`, `zod`, `lucide-react`, Tailwind 4, `src/env.ts` a `vercel.json`. Rozdíly oproti tomuto návrhu:

| Kostra                                                                      | Návrh                                                                                                                                                                                                |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ADMIN_EMAILS` a přihlášení do administrace po Google loginu v `src/env.ts` | nahrazeno tabulkou `operators`, vlastním e-mail OTP a povinným TOTP (ADR 0012, M9)                                                                                                                   |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_URL`                 | zrušeno: žádný anon key ani URL projektu, jen serverová `DATABASE_URL` (ADR 0011)                                                                                                                    |
| `@supabase/ssr`                                                             | správci, hosté ani operátoři ho nepotřebují (operátoři: ADR 0012)                                                                                                                                    |
| `vercel.json` s `ignoreCommand` (build jen z větve `main`)                  | zrušit nebo upravit, aby se stavěly náhledy pull requestů, na nichž poběží e2e testy                                                                                                                 |
| `@aws-sdk/client-sesv2`, `@sentry/nextjs`, `@vercel/analytics`              | konečná volba v ADR e-mailů a analytiky jiného autora; zde se s nimi zachází jako s integracemi za rozhraním. U Sentry ověřit, že se neposílají osobní údaje a v jaké oblasti se ukládají `[OVĚŘIT]` |

## 2. Hostitelé a směrování

| Hostitel                     | Interní segment             | Indexace | Obsah                                                                       |
| ---------------------------- | --------------------------- | -------- | --------------------------------------------------------------------------- |
| `se-vezmou.cz`               | `/h/marketing/[locale]`     | ano      | úvodní stránka, články, ukázky šablon; čeština na `/`, angličtina pod `/en` |
| `app.se-vezmou.cz`           | `/h/app`                    | ne       | průvodce a správa páru                                                      |
| `admin.se-vezmou.cz`         | `/h/admin`                  | ne       | provozní administrace                                                       |
| `klara-a-matej.se-vezmou.cz` | `/h/tenant/[slug]/[locale]` | ne       | web páru                                                                    |

(Označení `/h` je návrh; složky začínající podtržítkem jsou v Next.js soukromé a nesměrují, proto se nepoužívají.)

### 2.1 `src/proxy.ts`

Next.js 16 nahrazuje `middleware` souborem `proxy` (běží v Node.js runtime, `runtime` se v něm nenastavuje). Proxy dělá jen rychlé čisté rozhodnutí bez dotazu do databáze:

1. Z hlavičky `Host` odstraní port a převede na malá písmena. Z `ROOT_DOMAIN` (env, `se-vezmou.cz`) určí druh hostitele:
   - rovno `ROOT_DOMAIN` nebo `www.` → `marketing`. Aplikace `www` **nepřesměrovává**: které z obou jmen je hlavní, určuje přesměrování domény ve Vercelu a kanonická adresa (`NEXT_PUBLIC_SITE_URL`); přesměrování v aplikaci i ve Vercelu zároveň dává smyčku (`ERR_TOO_MANY_REDIRECTS`). `www` zůstává mezi rezervovanými názvy webů párů,
   - `app.` → `app`, `admin.` → `admin`,
   - jedna úroveň navíc a platný slug (`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`, bez `--`) → `tenant`, slug = první štítek,
   - cokoli jiného (víceúrovňové subdomény, neznámé hostitele) → odpověď 404 bez těla, která nic nenabízí.
2. **Interní prefixy zvenku zablokuje:** požadavek, jehož cesta začíná `/h/`, dostane 404 (stejná odpověď jako neexistující cesta). Rewrite z proxy se znovu nezpracovává, takže vnitřní cesta jinak zvenku neexistuje.
3. Přepíše cestu (`NextResponse.rewrite`) na interní segment. U `marketing` a `tenant` mapuje jazyk: bez prefixu = `cs` (u tenantu výchozí jazyk svatby se zjišťuje až v segmentu, proto proxy předává jen `cs`/`en` z prefixu a stránka sama rozhodne), `/en/…` = `en`. Překlad cest (`/cenik` ↔ `/en/pricing`, výchozí hodnota zadání „překládat“) drží jedna tabulka `src/i18n/pathnames.ts`; české cesty bez českého prefixu a anglické pod `/en`. Nepřeložená varianta (`/pricing` na češtině, `/en/cenik`) vrací 404, aby nevznikaly duplicity.
4. Nastaví bezpečnostní a indexační hlavičky: pro `app`, `admin`, `tenant` `X-Robots-Tag: noindex, nofollow` (FR-PRIV-1), pro `tenant` a `app` navíc `Referrer-Policy: no-referrer` u náhledů konceptu, `Cache-Control: private, no-store` u neveřejných odpovědí (správa, náhled).
5. Neplatí pro `/_next/*`, statické soubory a `/api/cron/*` (`config.matcher` s negativním vzorem; ověřit v `proxy.md`). **Pozor:** Server Actions jsou POST na cestu stránky; vyloučení cesty z matcheru by jim vzalo i ochranu, proto každá akce a každý route handler ověřuje relaci a oprávnění sama (varování z dokumentace `proxy.md`). Proxy je pohodlí, ne bezpečnostní hranice.

Existenci svatby proxy neověřuje (žádný dotaz do DB). Segment `/h/tenant/[slug]` zavolá `resolve_slug`; neexistující, nezveřejněná, smazaná i zablokovaná adresa vrací **identickou** stránku 404 se stejnou hlavičkou, bez nabídky jiných webů (FR-PRIV-3).

**Certifikát a ochrana kvót.** Wildcard certifikát vydává Vercel pro `*.se-vezmou.cz`, jednotlivé subdomény tedy nevyžadují vlastní vydání certifikátu a útok na kvóty certifikační autority pro neexistující subdomény se na tuto architekturu nevztahuje `[OVĚŘIT v dokumentaci Vercelu]`. Neexistující adresy vrací 404 z aplikace.

### 2.2 Lokální vývoj a náhledy

- Lokálně `*.localhost` (např. `localhost:3000` = marketing, `app.localhost:3000`, `admin.localhost:3000`, `klara-a-matej.localhost:3000`); běžné prohlížeče překládají `*.localhost` na loopback. `ROOT_DOMAIN=localhost` v `.env.local`.
- Cookie s prefixem `__Host-` vyžaduje `Secure`. V `http://localhost` to nemusí fungovat ve všech prohlížečích `[OVĚŘIT]`. Jediná pomocná funkce `cookieName(base)` ve vývoji prefix vynechá; všude jinde je povinný. Alternativa je lokální HTTPS (`next dev --experimental-https`).
- Náhledy nasazení na Vercelu (`*.vercel.app`) nemají subdomény pro `app.` a `tenant`. Předvolby v env: `HOST_PRESET` (`marketing`, `app`, `admin`, `tenant`) a `PREVIEW_TENANT_SLUG`. Předvolba platí jen mimo `VERCEL_ENV=production` a jen pokud hostitel nepatří pod `ROOT_DOMAIN`. Produkce předvolby nikdy nečte (test).
- Náhledy a lokální prostředí používají databázi `staging` / lokální Supabase, nikdy produkci.

## 3. Vrstvy aplikace

```
 app (routy, Server Components, Server Actions, route handlers)
   │ skládá
   ▼
 components ──► domain ◄── data ──► Postgres (`pg`)
 (UI, bloky,    (čistá logika,      (RPC přes `pg`,
  šablony)       bez I/O)            claimy, typy)
                   ▲
 integrations ─────┘  (e-mail, úložiště, analytika, Vercel API) za rozhraními
 auth (relace, PIN, kódy, operátoři, omezení požadavků) používá data a integrations
```

| Vrstva                           | Obsah                                                                                                                                                 | Pravidla                                                                                                                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **UI komponenty** (`components`) | primitiva design systému (tlačítko, pole, karta, FAQ, kroky průvodce, přepínač náhledu, výběr šablony), bloky webu páru, čtyři šablony, SVG ilustrace | žádná znalost databáze; texty přicházejí jako props nebo z `t()`; přístupnost (popisky, `aria-live`, cíle 44 px, zaměření) je součástí komponenty a ověřuje se testem komponenty a axe |
| **Doména** (`domain`)            | slugy a varianty, normalizace jmen, životní cyklus (fáze), retence, kontrast a palety, schémata bloků (Zod), pravidla RSVP, `typo()`                  | čisté funkce bez I/O, nejvíc jednotkových testů; nesmí importovat `next/*`, `react` ani `data`                                                                                         |
| **Data** (`data`)                | wrappery RPC nad `pg` (`src/lib/db`: pool, transakce, claimy), typy databáze                                                                          | jediné místo, kde se mluví s databází; dvě cesty v téže dopravě: s totožností svatby (`set local role authenticated` + claimy) a bez ní (`set local role service_role`, `server-only`) |
| **Integrace** (`integrations`)   | e-mail, úložiště fotografií, analytika, Vercel Domains API (později), generování PDF a QR                                                             | za rozhraním definovaným v `domain`/`integrations`, aby šla změnit volba z ADR bez zásahu do aplikace; žádný SDK dodavatele v UI                                                       |
| **Autentizace** (`auth`)         | vlastní relace, cookie, jednorázové kódy, PIN, operátoři, omezení počtu požadavků                                                                     | výpisy v `docs/security-privacy.md`; každá Server Action a route handler volá `requireSession()`                                                                                       |

Kontrolu směru závislostí vynucuje ESLint (`no-restricted-imports` nebo plugin pro hranice modulů) v CI.

## 4. Struktura adresářů

```
supabase/
  migrations/                    # SQL migrace (jediný zdroj schématu, schéma se_vezmou)
  init/                          # jednorázový init sdíleného projektu (schéma, rozšíření, role se_vezmou_app)
  tests/                         # SQL testy izolace a funkcí, test izolace migrací
  seed.sql                       # jen vymyšlená testovací data (Klára a Matěj)
e2e/                             # Playwright scénáře a fixtury
scripts/                         # check-i18n, kontrola kontrastu palet, generování typů
docs/                            # tento návrh, data-model, adr/
src/
  proxy.ts
  env.ts                         # validace env (Zod), existuje
  config/                        # pricing.ts, reserved-slugs.ts, robots.ts (seznam botů)
  app/
    layout.tsx, global-error.tsx # kořen (písma, základní styly)
    h/
      marketing/[locale]/…       # úvodní stránka, články, ukázky šablon
      marketing/robots.txt/route.ts, sitemap.xml/route.ts
      app/…                      # přihlášení, průvodce, správa (Server Actions)
      app/robots.txt/route.ts
      admin/…                    # operátorská administrace
      admin/robots.txt/route.ts
      tenant/[slug]/[locale]/[[...page]]/…
      tenant/robots.txt/route.ts
    api/
      cron/{lifecycle,retention,housekeeping}/route.ts
      rsvp/…                     # jen pokud RSVP nepůjde přes Server Actions
  components/
    ui/                          # primitiva design systému
    blocks/                      # bloky webu páru (hero, program, místo, …)
    templates/{editorial,eukalyptus,chateau,modern}/   # tokeny, kompozice
    illustrations/               # inline SVG s role="img" a popisem
    marketing/, wizard/, admin-site/, ops/
  domain/
    slug/, names/, lifecycle/, retention/, rsvp/, blocks/, palettes/, contrast/, typography/
  data/
    pool.ts, transport.ts, claims.ts, rpc.ts (src/lib/db)
  auth/
    session.ts, cookies.ts, otp.ts, pin.ts, operator.ts, rate-limit.ts
  integrations/
    email/, storage/, analytics/, pdf/, qr/, vercel/
  i18n/
    messages/{cs,en}/            # JSON podle jmenných prostorů
    t.ts, plural.ts, locale.ts, pathnames.ts, typo.ts
  lib/utils.ts                   # existuje
```

## 5. Závislosti a důvody

Verze se nepřipíšou do tohoto dokumentu, určí je `package.json` při implementaci. Sloupec „stav“ říká, zda je balík už v kostře.

| Balík                                                                                    | Stav         | Důvod                                                                                                                                   | Alternativa a proč ne                                                         |
| ---------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `next`, `react`, `react-dom`                                                             | je           | zadání                                                                                                                                  |                                                                               |
| `tailwindcss` 4, `class-variance-authority`, `clsx`, `tailwind-merge`                    | je           | tokeny šablon jako CSS proměnné, varianty komponent                                                                                     | CSS moduly: víc ruční práce na šablonách                                      |
| `lucide-react`                                                                           | je           | jediná knihovna ikon (zadání)                                                                                                           |                                                                               |
| `zod`                                                                                    | je           | schémata bloků, validace formulářů a env                                                                                                |                                                                               |
| `react-hook-form`, `@hookform/resolvers`                                                 | je           | formuláře průvodce a správy s popisky a chybami                                                                                         | vlastní správa stavu: víc chyb v přístupnosti                                 |
| `pg` (+ `@vercel/functions` pro `attachDatabasePool`)                                    | je           | přímé spojení s Postgresem přes pooler (ADR 0011); `@supabase/supabase-js` byl odstraněn                                                | `supabase-js`: vyžaduje klíče s právy nad celým sdíleným projektem            |
| `@supabase/ssr`                                                                          | je           | původně jen Supabase Auth operátorů; po ADR 0011 a ADR 0012 se nepoužívá                                                                | nepoužívat pro správce a hosty                                                |
| `server-only`                                                                            | je           | blokuje import tajných modulů do klienta                                                                                                |                                                                               |
| `jose`                                                                                   | zrušeno      | JWT se nevydávají (ADR 0011); případně jen pro budoucí podepsané odkazy                                                                 |                                                                               |
| `@dnd-kit/core`, `@dnd-kit/sortable`                                                     | přidat       | řazení přetažením s klávesnicí; vždy s tlačítky nahoru/dolů (WCAG 2.5.7)                                                                | vlastní řešení: drahé, rizikové pro přístupnost                               |
| `qrcode` (výstup SVG)                                                                    | přidat       | QR adresy a QR platba                                                                                                                   |                                                                               |
| `@react-pdf/renderer` nebo tiskové CSS                                                   | rozhodnout   | PDF oznámení (FR-ADM-6) `[OTÁZKA: knihovna, rozhodne prototyp; kritéria: česká diakritika a písma Newsreader a DM Sans, přístupné PDF]` | tiskové CSS + uložení z prohlížeče: nulová závislost, horší kontrola výsledku |
| `exceljs` nebo `read-excel-file` + CSV                                                   | rozhodnout   | import a export Excelu (FR-ADM-4)                                                                                                       | `xlsx` (SheetJS) z npm se přestal udržovat; neuvažovat                        |
| `vitest`, `@testing-library/react`, `@testing-library/user-event`, `jsdom`               | přidat       | ADR 0004                                                                                                                                | Jest: pomalejší ESM/TS konfigurace                                            |
| `@playwright/test`, `@axe-core/playwright`                                               | přidat       | e2e a přístupnost, ADR 0004                                                                                                             | Cypress: slabší podpora více hostitelů a WebKit                               |
| `supabase` (CLI)                                                                         | nepoužívá se | migrace nasazuje `npm run db:migrate` (node + `pg`), testy běží na čistém Postgresu (`scripts/db-test.sh`)                              |                                                                               |
| `@sentry/nextjs`, `@vercel/analytics`, `@vercel/speed-insights`, `@aws-sdk/client-sesv2` | jsou         | viz tabulka kostry v kapitole 1; konečná volba v ADR e-mailů a analytiky                                                                |                                                                               |
| `next/font/local` + vlastní soubory písem                                                | v Next.js    | vlastní hosting Newsreader a DM Sans s `latin` a `latin-ext` (česká diakritika)                                                         | Google Fonts za běhu: zadání zakazuje volání třetí strany                     |

Záměrně bez závislosti: knihovna i18n (ADR 0003), knihovna pro kontrast (vlastní vzorec WCAG v `domain/contrast`), ORM, knihovna pro rate limiting (tabulka čítačů v Postgresu, ADR 0001).

## 6. SEO a GEO

### 6.1 `robots.txt` podle hostitele

Route handlery uvnitř segmentů (soubory metadata `robots.ts` fungují jen v kořeni `app`, proto handlery; proxy ho mapuje `/robots.txt` → `/h/<host>/robots.txt`).

| Hostitel                         | Obsah `robots.txt`                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `se-vezmou.cz`                   | povolit vyhledávací a odpovědní roboty (např. Googlebot, Bingbot, OAI-SearchBot, ClaudeBot, PerplexityBot), výslovně zakázat roboty pro trénování modelů (GPTBot, Google-Extended) podle výchozí hodnoty zadání; odkaz na `sitemap.xml`. Seznam botů je v `src/config/robots.ts`, protože se mění; před vydáním ověřit v dokumentaci robotů `[OVĚŘIT]` |
| `app.`, `admin.`, každý web páru | `User-agent: *` / `Disallow: /`                                                                                                                                                                                                                                                                                                                        |

`Disallow` brání čtení hlavičky `noindex`, proto je každá odpověď těchto hostitelů navíc označena `X-Robots-Tag: noindex, nofollow` (proxy) a `<meta name="robots">` (metadata). Adresy webů párů nejsou nikde veřejně odkazovány ani v mapě webu; to je hlavní ochrana před indexací bez návštěvy robota.

### 6.2 Jazyky, kanonické adresy, mapa webu

- Pouze marketingový hostitel: každá stránka vystaví `<link rel="alternate" hreflang="cs">`, `hreflang="en"`, `hreflang="x-default"` (na českou verzi) a `rel="canonical"` na sebe. Dvojice stránek se mapuje tabulkou `pathnames.ts` (např. `/cenik` ↔ `/en/pricing`).
- Žádné automatické přesměrování podle `Accept-Language`; jen nabídka (dismissible pruh, viz ADR 0003).
- `sitemap.xml` (route handler marketingu) obsahuje obě jazykové verze s alternativami (`xhtml:link`). Weby párů, průvodce a správa v mapě nejsou.
- Weby párů mají `lang` stránky z jazyka verze (`cs`, u angličtiny `en-GB` podle výchozí britské angličtiny `[OTÁZKA k potvrzení]`), cizojazyčné části mají vlastní `lang` (3.1.2). Odkazy na druhý jazyk nesou `hreflang` a `lang` kvůli čtečkám, ne kvůli indexaci.

### 6.3 Strukturovaná data (JSON-LD)

Na marketingu, vykreslené na serveru, ze stejných dat jako viditelný text (ceny z `config/pricing.ts`, FAQ z překladových souborů), aby se značky nikdy nerozešly s textem:

| Typ                        | Kde                                                                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Organization` a `WebSite` | všechny stránky (provozovatel `[PROVOZOVATEL, IČO]` až dodá majitel; bez vymyšlených údajů)                                                                |
| `SoftwareApplication`      | úvodní stránka; nabídka s cenou 0 jen s textem o zaváděcím provozu, nikdy „zdarma navždy“; `priceValidUntil` se nepíše, dokud majitel neurčí konec provozu |
| `FAQPage`                  | úvodní stránka a FAQ (strojová čitelnost; Google omezil rozšířené zobrazení, aktuální stav ověřit `[OVĚŘIT]`)                                              |
| `BreadcrumbList`           | články a podstránky                                                                                                                                        |
| `Review`                   | jen u skutečných recenzí se souhlasem; do té doby se nevypisuje                                                                                            |

JSON se do `<script type="application/ld+json">` serializuje s escapováním `<`. Test strukturovaných dat běží před každým vydáním (ADR 0004).

### 6.4 GEO

Sekce začínají 1 až 2 větami srozumitelnými samy o sobě; ceny, kroky a funkce jsou text, ne obrázek; názvy a popis služby i údaje o provozovateli se berou z jednoho zdroje. Měsíční ruční měření 20 stálých otázek v AI asistentech je provozní úkol (ne kód). `llms.txt` je nízká priorita.

## 7. Výkon

Cíle zadání: LCP do 2,5 s, CLS do 0,1, INP do 200 ms na průměrném telefonu přes mobilní data. Nástroje:

- **Statické vykreslení marketingu** (`generateStaticParams` pro `cs` a `en`), CDN cache.
- **Web páru:** zveřejněný snímek se čte jedním voláním `get_public_site()` a ukládá do cache podle štítku `site:{wedding_id}`; publikace štítek zneplatní. Přesný mechanismus cache v Next.js 16 (Cache Components, `use cache`, `revalidateTag`) se ověří v `node_modules/next/dist/docs/` před implementací `[OVĚŘIT]`. Obsah pro PIN a RSVP se necachuje sdíleně.
- **Server Components** pro bloky; klientské ostrovy jen RSVP formulář, přepínač náhledu, odpočet, tlačítko ukotvené při scrollu. Bez skriptů třetích stran na webech párů.
- **Písma:** `next/font/local`, jen podmnožiny `latin` a `latin-ext`, `font-display` s metrikami náhradního písma proti posunu rozvržení, Newsreader jen tam, kde to zadání určuje.
- **Obrázky:** moderní formáty a více velikostí (`next/image` nebo vlastní varianty podle ADR o úložišti), `width`/`height` vždy vyplněné, hero obrázek s prioritou, galerie líně.
- **Animace** jen CSS a SVG, podmíněně `prefers-reduced-motion`.
- **Region funkcí** blízko databázi (Frankfurt) `[OVĚŘIT identifikátor regionu ve Vercelu]`, aby se několik dotazů na požadavek nenásobilo latencí přes oceán.
- **Měření:** Vercel Speed Insights (pole data z reálných uživatelů) a Lighthouse v CI nad klíčovými stránkami jako doplněk `[OTÁZKA]`; cíle platí pro měření po každém nasazení. Čísla navíc k zadání se nestanovují před prvním měřením.

## 8. Nasazení, prostředí, DNS

### 8.1 Prostředí

| Prostředí   | Aplikace                  | Databáze                                                   |
| ----------- | ------------------------- | ---------------------------------------------------------- |
| Lokální     | `next dev`, `*.localhost` | vlastní PostgreSQL 15+ se shimem, init skripty a migracemi |
| Náhled (PR) | Vercel preview            | testovací data, nikdy produkční schéma (OQ-48)             |
| Produkce    | Vercel production, `main` | sdílený Supabase projekt (EU), schéma `se_vezmou`          |

- Migrace aplikuje majitel nástrojem `npm run db:migrate` (`MIGRATE_DATABASE_URL` vlastníka, jen na jeho počítači; `--dry-run` nejdřív), evidence je v `se_vezmou.schema_migrations`. Nikdy se neupravuje schéma ručně v konzoli. Postup: `supabase/README.md`.
- Tajné hodnoty (`DATABASE_URL` s heslem role `se_vezmou_app`, `AUTH_SECRET`, `RATE_LIMIT_SECRET`, `PIN_PEPPER`, `CRON_SECRET`, klíče e-mailu) jsou v proměnných prostředí Vercelu, mimo repozitář; `.env.example` obsahuje jen názvy. Klíč `service_role` ani JWT secret sdíleného projektu na Vercelu nejsou. `MIGRATE_DATABASE_URL` (role `postgres`) není na Vercelu nikdy.
- Záznamy (logy, Sentry) bez osobních údajů: žádná jména ani e-maily hostů, jen ID.
- Zálohy a obnova: nastavení zálohování a pravidelná zkouška obnovy je provozní úkol DevOps; dostupnost záloh a obnovy k bodu v čase závisí na tarifu Supabase `[OVĚŘIT]`. Bezplatný tarif pro produkční provoz nepředpokládám `[OVĚŘIT aktuální podmínky a ceny]`.

### 8.2 DNS a Vercel

Zadání: wildcard `*.se-vezmou.cz` vyžaduje nameservery Vercelu (`ns1.vercel-dns.com`, `ns2.vercel-dns.com`), protože Vercel řeší ověření wildcard certifikátu. Důsledky:

1. **Všechny DNS záznamy se spravují ve Vercelu**, ne u registrátora.
2. **Postup přesunu** (před prvním tištěným oznámením a před ostrým provozem; šíření až 24 až 48 hodin podle zadání):
   1. Exportovat všechny stávající záznamy u registrátora.
   2. Ve Vercelu přidat doménu a vytvořit identické záznamy předem, včetně e-mailových (MX, SPF, DKIM, DMARC), dřív než se změní nameservery.
   3. Snížit TTL u registrátora s předstihem.
   4. Změnit nameservery, sledovat doručování e-mailů a dostupnost všech čtyř druhů hostitelů.
3. **Projekt ve Vercelu** má domény: `se-vezmou.cz` (apex), `www` (přesměrování nastavte jen ve Vercelu a `NEXT_PUBLIC_SITE_URL` shodně s hlavním jménem), `app`, `admin` a wildcard `*.se-vezmou.cz` (web páru). Explicitní `app.` a `admin.` mají přednost před wildcardem.
4. **E-mailová doména** (odesílání z `se-vezmou.cz`, FR-MAIL-2):
   - **SPF:** jeden záznam TXT povolující jen zvoleného e-mailového poskytovatele; pozor na více záznamů SPF (je neplatné) a limit na počet vyhledávání.
   - **DKIM:** záznamy (CNAME nebo TXT) podle poskytovatele; rotace klíčů podle jeho postupu.
   - **DMARC:** `_dmarc` TXT, postup `p=none` s agregovanými reporty → po ověření všech zdrojů `quarantine` → `reject`. Adresa pro reporty je schránka bez osobních údajů `[KONTAKT]`.
   - Případná doména pro návratové adresy a odezvy (poskytovatel) jako samostatná subdoména, aby se nemíchala s webovými záznamy.
   - Ověřit doručitelnost přihlašovacích kódů na hlavní poštovní služby před bránou B.
5. **Vlastní domény párů** (placený doplněk, později): přidání a ověření programově přes Vercel API (TXT nebo nameservery) `[mimo MVP]`.
6. **CAA** záznamy případně podle požadavků Vercelu/CA `[OVĚŘIT]`.
7. Výchozí nastavení bezpečnostních hlaviček (HSTS, CSP s nonce, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`) je v `docs/security-privacy.md`; HSTS s `includeSubDomains` až po ověření všech subdomén.

### 8.3 Vercel Cron

Životní cyklus a retenci řídí Vercel Cron, který volá route handlery v `src/app/api/cron/*` (konfigurace v `vercel.json`, pole `crons`). Podle dokumentace Vercelu volá cron produkční nasazení metodou GET a hlavičkou `Authorization: Bearer $CRON_SECRET` `[OVĚŘIT]`; handler tuto hlavičku vždy kontroluje a bez ní vrací 401. Cesty `/api/cron/*` proxy nepřepisuje a z libovolného hostitele jinak 404.

| Cesta                    | Frekvence | Úkol                                                                                                                                                                      |
| ------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/cron/lifecycle`    | denně     | uložené přechody (publikace → archiv, `thanks` → archiv po lhůtě), upozornění na vypršení provozu a retenci (e-maily s odkazem na export), obnovení fází po ručním zásahu |
| `/api/cron/retention`    | denně     | smazání `rsvp_health` (30 dní po svatbě), smazání údajů hostů (12 měsíců), tvrdé smazání po měkkém smazání, zápis do auditu jen s počty                                   |
| `/api/cron/housekeeping` | denně     | uvolnění rezervací slugů po vypršení, úklid `sessions`, `login_challenges`, `rate_limits`, `lockouts`                                                                     |

Vlastnosti všech úloh: idempotentní, po dávkách s omezením času, `pg_try_advisory_lock` proti souběhu, odpověď shrnuje počty (ne data), chyby jdou do monitoringu, další běh dokončí zbytek. Počet cronů a nejkratší interval závisí na tarifu Vercelu (na nejlevnějším tarifu je pravděpodobně jen denní frekvence s hodinovou přesností `[OVĚŘIT]`); proto jsou všechny úlohy navržené jako denní a odolné vůči zpoždění. Čistě databázové úklidy by šlo přesunout do `pg_cron` v Supabase; návrh je ponechává ve Vercel Cronu, protože jedna cesta je jednodušší na provoz a testování a cron posílá i e-maily.

**Stav implementace (M10).** `vercel.json` plánuje jednu denní úlohu `/api/cron/daily`, která spustí retenci, životní cyklus a úklid za sebou (na tarifu Hobby je omezený počet cron úloh a nejvýše denní frekvence); tři jmenované cesty zůstávají k ručnímu spuštění a pro tarif s více cron úlohami. Autorizace `Authorization: Bearer ${CRON_SECRET}`, proměnná `CRON_SECRET` musí být nastavena ve Vercelu (bez ní vrací všechny cesty 401). Podrobnosti, parametry (`dry_run`, `batch`, `wedding_id`) a testovací hodina jsou v `docs/data-model.md`, kapitola 17.

### 8.4 Plán a cena provozu (kvalitativně)

Ceny a tarify Vercelu, Supabase a e-mailové služby jsem do dokumentu nezapsal, protože se mění a nemám z podkladů ověřené hodnoty `[OVĚŘIT před schválením]`. Rozhodující je, že zaváděcí provoz zdarma potřebuje: produkční tarif databáze se zálohami, odesílání e-mailů, úložiště fotografií a cron. Podrobný přehled nákladů patří do `docs/implementation-plan.md`.

## 9a. Úložiště a zpracování fotografií (M7c)

Rozhodnutí: `docs/adr/0006-photo-storage.md`. Úložiště je za rozhraním `PhotoStorage` (`src/lib/storage`): Cloudflare R2 přes S3 API a `aws4fetch` (podepsané adresy, výpis a mazání předpon), v paměti pro vývoj a testy a „nenastavené“ úložiště pro produkci bez proměnných R2 (selže až použití fotografií). Tok: Server Action vydá podepsanou adresu pro PUT do karantény `incoming/{wedding_id}/{media_id}`, prohlížeč nahraje originál přímo do úložiště, druhá Server Action (`maxDuration` 60 s na stránce `/web`) originál zpracuje (`sharp`: typ podle obsahu, pixelové limity, otočení podle EXIF, sRGB, žádná metadata, šířky 640, 1280 a 1920 px ve WebP a AVIF) a uloží varianty. Doručení: `/media/{id}/{šířka}` na hostiteli webu páru přesměruje na čerstvě podepsanou adresu s časovým oknem. `sharp` je nativní závislost (Node 24, předsestavené binárky pro Vercel); `aws4fetch` nemá vlastní závislosti.

## 9. Otevřené body tohoto dokumentu

- `[ROZHODNUTO M5]` PDF oznámení vzniká na serveru knihovnou `pdf-lib` s `@pdf-lib/fontkit` (písma Newsreader a DM Sans, licence OFL, vkládaná jako podmnožiny; vektorový QR z `qrcode-generator`). Soubory písem jsou v `outputFileTracingIncludes`. Cesta `/vytvorit/oznameni` je POST (cesta končící `.pdf` by proxy považovala za statický soubor). PDF není tagované (PDF/UA), má však titulek, autora a jazyk; značkování zůstává otevřené.
- `[OTÁZKA]` Knihovna pro Excel (kapitola 5); doporučení: prototyp před milníkem exportů.
- `[OTÁZKA]` Název prefixu interních segmentů (`/h`) je jen technický detail, nemá dopad na majitele.
- `[OVĚŘIT]` Limity cronu a regionu na zvoleném tarifu, chování cookie `__Host-` na `localhost`, cache API Next.js 16 (ADR 0001, 0002).
