# ADR 0013: Vyjednání jazyka, přepínání a překlady po jmenných prostorech

- Stav: přijato (3. 10. 2026).
- Nahrazuje části ADR 0003: „Nabídka jazyka bez přesměrování“ (server nečte `Accept-Language`) a „chybějící překlad padá na druhý jazyk“. Ostatní části ADR 0003 (formát zpráv, typografie, kontrola při sestavení) platí dál.
- Související: ADR 0002 (směrování podle hostitele), `docs/security-privacy.md` (seznam cookies), `src/i18n/*`, `src/proxy.ts`.

## Kontext

Na `app.se-vezmou.cz/web` nešlo přepnout do češtiny: jazyk se bral zčásti z adresy a zčásti z `Accept-Language`. Oprava v PR #42 nechala rozhodovat cestu jen na hostiteli `app.`. Majitel chce totéž udělat pořádně a všude, a to **standardním způsobem**, jak i18n v Next.js dělají dokumentace Next.js a next-intl: výchozí jazyk bez předpony, ostatní pod `/<jazyk>`, vyjednání jazyka v proxy při vstupu, cookie `NEXT_LOCALE` s volbou uživatele. Zároveň má být snadné přidat další jazyk a stránky nemají nést překlady, které nezobrazují.

## Rozhodnutí

### 1. Jazyky a adresy

- `src/i18n/config.ts` je jediné místo, které jazyky vyjmenovává (`locales`); typ `Locale` se z něj odvozuje. Tabulky po jazycích (`htmlLang`, `intlLocale`, `localeNames`, `localeShortNames`, množná čísla, jednotky, e-mailové texty, ...) jsou `Record<Locale, ...>`, takže TypeScript po přidání jazyka označí každé místo k doplnění.
- **Výchozí jazyk je čeština** (`defaultLocale = "cs"`). Vše, co jazyk neurčuje, je česky, a každá náhrada vede z požadovaného jazyka na výchozí (nikdy na „ten druhý“).
- Výchozí jazyk je vždy **bez předpony**, ostatní pod `/<jazyk>` (`localePrefix: "as-needed"` v terminologii next-intl). Platí na všech čtyřech hostitelích, nově i na `admin.`. Předpona výchozího jazyka (`/cs/...`) je duplicita a vrací 404; neznámá předpona (`/de/...`) není jazyk, ale obyčejná cesta výchozího jazyka (obvykle 404).
- `localePath(path, locale)` skládá cestu s předponou; na hostitelích `app.` a `admin.` ji používají `appHref` a `localHref` (jazyk požadavku) pro každý odkaz a přesměrování, včetně odkazů v e-mailech. Úvodní stránka má přeložené cesty v `src/i18n/pathnames.ts` (řádek je jedna nepřekládaná cesta, nebo `Record<Locale, string>` s přeloženými slugy).

### 2. Vyjednání jazyka (jen proxy, jen při vstupu)

Čistý modul `src/i18n/negotiate.ts` (plně pokrytý jednotkovými testy) určuje jazyk v pořadí:

1. předpona jazyka v adrese,
2. cookie `NEXT_LOCALE` (standardní název z Next.js),
3. `Accept-Language` (RFC 9110: váhy `q`, `*`, shoda podle hlavní podznačky, např. `en-GB` -> `en`; hodnotí se jen nabízené jazyky),
4. výchozí jazyk.

Používá ho **jen `src/proxy.ts`**, a to na hostitelích úvodní stránky, `app.` a `admin.`. Proxy výsledek předá hlavičkou `x-ui-locale` (klientem poslanou hodnotu vždy přepíše); serverový kód čte jen ji (`getUiLocale`), bez hlavičky platí výchozí jazyk. Server Components ani Server Actions `Accept-Language` ani cookie nečtou.

**Vstup** je načtení dokumentu (GET/HEAD, `Sec-Fetch-Dest: document`, u klientů bez této hlavičky `Accept: text/html`; ne RSC, ne předběžné načtení `Sec-Purpose: prefetch`, ne soubory, ne API) na adresu bez předpony, které nepřišlo z odkazu na vlastním webu. Když je vyjednaný jazyk jiný než výchozí, proxy odpoví **307 na adresu s předponou** (dotaz zůstává) s `Vary: Accept-Language, Cookie` a `Cache-Control: private, no-store`, takže odpověď nesdílí žádná mezipaměť. Na Vercelu proxy běží před mezipamětí CDN, statické stránky úvodní stránky zůstávají statické.

**Roboti** (bez `Accept-Language` a bez cookie) vždy dostanou výchozí jazyk s 200 a bez přesměrování; `hreflang` a `canonical` se nemění. RSC, předběžná načtení, soubory a API se nikdy nepřesměrují.

**Weby párů** (`<slug>.se-vezmou.cz`) jazyky publikují v databázi (`content.locales`, `content.defaultLocale`) a proxy do databáze nesahá (ADR 0002). Proto se na nich **nevyjednává ani nepřesměrovává**: jazyk určuje jen adresa, přepínač nabízí jen jazyky, které web opravdu má, a cookie se tam nezapisuje.

### 3. Přepínání jazyka bez JavaScriptu a bez smyček

Standardní problém: s anglickým prohlížečem vede „Čeština“ na `/en` na `/`, a detekce by uživatele vrátila na `/en`. Řešení (zvolené z návrhu majitele, ověřené ve skutečném Chromiu):

- **Navigace z vlastního webu je výslovná volba jazyka z adresy.** Pozná se podle `Sec-Fetch-Site: same-origin` nebo `same-site` a `Sec-Fetch-Dest: document` (klik na odkaz nebo odeslání formuláře, ne RSC). Taková navigace se nikdy nepřesměruje; cesta bez předpony znamená výchozí jazyk.
- Když se jazyk adresy liší od dosavadní preference (cookie, jinak `Accept-Language`), proxy **zapíše cookie `NEXT_LOCALE`**. Při dalším vstupu (záložka, ručně zadaná adresa) pak cookie rozhodne. Cookie se zapisuje **jen při výslovném přepnutí**, ne při každé návštěvě.
- `same-site` (ne jen `same-origin`) proto, že hostitelé služby na sebe odkazují s jazykem v adrese (úvodní stránka -> průvodce na `app.`); bez toho by anglický prohlížeč po volbě češtiny na úvodní stránce dostal anglického průvodce. Všechny subdomény `se-vezmou.cz` jsou naše; web páru tím může ovlivnit nanejvýš jazyk (a jeho odkazy jazyk nesou správně).
- Prohlížeče bez `Sec-Fetch-Site` (starší než Safari 16.4 nebo Firefox 90): stejnou roli hraje `Referer` ze stejného hostitele (`Referrer-Policy: strict-origin-when-cross-origin` ho u navigace v rámci hostitele posílá).

Proč ne jiný mechanismus: next-intl zapisuje cookie při kliknutí na svůj `Link` v prohlížeči (`document.cookie`), což bez JavaScriptu nefunguje. Zvláštní adresa pro přepnutí (`/jazyk?na=cs`) by byla nestandardní endpoint navíc. Hlavičky `Sec-Fetch-*` jsou standard (Fetch Metadata), posílají je všechny současné prohlížeče, Vercel je předává beze změny, a robotům nic nemění. Přesměrování po vstupu je vždy na adresu s předponou, kterou proxy už nepřesměruje, takže smyčka nevznikne.

**Cookie `NEXT_LOCALE`:** jen pro hostitele (bez `Domain`), `Path=/`, `SameSite=Lax`, `HttpOnly` (čte ji jen proxy), `Secure` mimo `localhost`, platnost 1 rok, hodnota jen kód jazyka (žádné osobní údaje). Je funkční (volba uživatele), viz seznam cookies v `docs/security-privacy.md`.

**Přepínač jazyka** (`LanguageSwitcher`, obyčejné odkazy s `lang`, `hreflang` a `aria-current`) je na úvodní a právních stránkách, v průvodci, ve správě, na přihlašovacích obrazovkách `app.` a `admin.`, v provozní administraci, na webu páru (jen jeho jazyky) a na stránce 404 (úvod v každém jazyce). Chyba kořenového layoutu (`global-error`) ukazuje text ve všech jazycích.

E-maily mají jazyk příjemce; přihlašovací e-mail správce má jazyk požadavku (z proxy) a jeho odkaz vede na adresu v tom jazyce. E-maily operátorům jsou zatím jen česky (šablony mají jeden jazyk).

### 4. Překlady po jmenných prostorech

- Zprávy jsou v `src/i18n/messages/<jazyk>/<jmenný prostor>.json`. Typy klíčů se odvozují z **výchozího jazyka** (`import type` v `src/i18n/messages.ts`, při sestavení se zahodí).
- `src/i18n/load.ts` (jen server) je **jediné místo, které zprávy importuje**: výslovná tabulka dynamických `import()` (jazyk × jmenný prostor), aby je bundler i sledování souborů na Vercelu vyřešily staticky a každý soubor byl samostatný líný chunk. `loadMessages(locale, namespaces)` načte přesně vyžádané jmenné prostory (a jako náhradu tytéž ve výchozím jazyce), jednou za požadavek (React `cache`).
- `getTranslator(locale, ["common", "auth"])` vrací `t` omezený na klíče vyžádaných jmenných prostorů: klíč z jiného prostoru neprojde kontrolou typů, takže stránka nemůže tiše použít text, který nenačetla. `typo`, formátování a `t.rich` se nezměnily. Chybějící překlad se zaloguje a vezme z výchozího jazyka; ve výchozím jazyce chybějící klíč je prázdný text (nikdy klíč).
- Klientské komponenty katalogy nikdy neimportují; dostanou jen texty, které používají, jako vlastnosti (`pickMessages`, `pickWizardMessages`, `pickAdminMessages`, popisky formulářů). Živý náhled webu v průvodci dostane ze serveru jen jmenné prostory webu (`common`, `site`, `rsvp`) pro každý jazyk. `global-error` (klientská komponenta mimo server) vkládá jen malý jmenný prostor `errors` (`src/i18n/error-messages.ts`).
- Hlídání: `src/i18n/imports.test.ts` (žádný statický import zpráv mimo loader, typy a `errors`; strom modulů úvodní stránky nenačítá `admin`, `admin.guests`, `ops` ani `wizard`, stránka správy nenačítá `landing`, `marketing`, `legal` ani `ops`), `src/i18n/load.test.ts` (loader načte jen vyžádané, neznámý jmenný prostor je srozumitelná chyba, náhrada z výchozího jazyka).

**Jmenné prostory a stránky:**

| Jmenný prostor           | Obsah                                                 | Načítá                                                                    |
| ------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------- |
| `common`                 | značka, odkaz na obsah, popisek přepínače jazyka, „a“ | kořenové layouty, rámce (hlavičky, přepínače), 404                        |
| `errors`                 | 404 a chyba aplikace                                  | stránky 404 všech hostitelů, `global-error`                               |
| `marketing`              | metadata a drobečková navigace úvodní stránky         | úvodní stránka, právní stránky (metadata, strukturovaná data)             |
| `landing`                | sekce, hlavička a patička úvodní stránky              | úvodní stránka, hlavička a patička právních stránek                       |
| `legal`                  | právní stránky                                        | `/soukromi`, `/podminky`, `/dostupnost` a anglické varianty               |
| `auth`                   | přihlášení a odhlášení správce                        | `app.`: `/prihlaseni/*`, `/odhlaseni`                                     |
| `wizard`                 | průvodce, náhled konceptu                             | `app.`: `/vytvorit`, `/vytvorit/nahled`; web páru: `/nahled/<token>`      |
| `admin`, `admin.guests`  | správa webu, hosté, odpovědi, přístup, data, nápověda | `app.`: stránky správy (rámec správy zobrazuje nabídku z obou)            |
| `site`, `rsvp`           | web páru, potvrzení účasti                            | web páru, náhled konceptu, živý náhled v průvodci, vývojový náhled šablon |
| `ops`                    | provozní administrace                                 | `admin.`: všechny stránky                                                 |
| `catalog`, `placeholder` | vývojářský katalog UI, zástupné texty                 | `/ui-catalog` (mimo produkci)                                             |

## Jak přidat jazyk

Mechanický postup; TypeScript a `npm run i18n:check` označí, na co se zapomnělo.

1. **Konfigurace:** přidat kód do `locales` v `src/i18n/config.ts` a doplnit `htmlLang`, `intlLocale`, `localeNames`, `localeShortNames`.
2. **Zprávy:** zkopírovat `src/i18n/messages/cs/` do `src/i18n/messages/<jazyk>/` a přeložit; přidat blok `<jazyk>: { ... }` do tabulky `loaders` v `src/i18n/load.ts` a soubor `errors.json` do `src/i18n/error-messages.ts`. `npm run i18n:check` porovná každý jazyk s výchozím (klíče, zástupné znaky, značky, typografie).
3. **Pravidla jazyka:** `REQUIRED_PLURAL_CATEGORIES` v `src/i18n/format.ts` (podle `Intl.PluralRules`), `UNITS` a případná typografická pravidla v `src/i18n/typo.ts`, `ogLocale` v `src/seo/page-metadata.ts`.
4. **Cesty:** u přeložených cest v `src/i18n/pathnames.ts` doplnit slug nového jazyka (nepřekládané cesty se doplní samy). Složka stránky s přeloženým slugem v `src/app/h/marketing/[locale]/` (jako `privacy`). Mapa webu, `hreflang` a přepínače jazyky procházejí samy.
5. **Tabulky po jazycích v kódu** (`Record<Locale, ...>`, kompilátor je označí): e-mailové šablony v `src/lib/email/templates/` (texty `COPY`, `admin-notice.ts` větví češtinu a angličtinu a je potřeba ho převést), popisky exportu `src/lib/export/table.ts`, vzor importu `hoste/import/vzor/route.ts`, spojka jmen `src/wizard/slug.ts`, jazyky v provozní administraci `src/ops/labels.ts` a klíče `admin.lang.*`, `ops.locale.*` ve zprávách.
6. **Databáze (samostatná migrace, tento ADR ji nedělá):** `check (locale in ('cs', 'en'))` v tabulkách `email_log`, `waitlist`, `analytics_event` (`supabase/migrations/*tables_ops.sql`) a `guests` (`*tables_guests_rsvp.sql`), `weddings.default_locale` a `weddings.locales <@ array['cs', 'en']` (`*tables_core.sql`), doména `i18n_text` (`value - array['cs', 'en']` v `*foundation.sql`) a kontroly v RPC (`p_locale not in ('cs', 'en')` v `*wizard.sql`, `*operators_ops.sql`, `array['cs', 'en']` v `*admin_site.sql`, `*media.sql`), rezervované slugy (`*seed.sql`: kód jazyka jako rezervované slovo). Pak `npm run db:test`.
7. **Písma a PDF:** ověřit, že `subsets` v `src/components/document.tsx` (dnes `latin`, `latin-ext`) a písma PDF v `src/wizard/pdf/fonts` pokrývají znaky jazyka.
8. **Testy:** jednotkové a e2e testy procházejí `locales`, kde to dává smysl; doplnit e2e test přepínače pro nový jazyk a texty v testech, které hledají české nebo anglické popisky.

## Důsledky

- Anglický prohlížeč při vstupu dostane angličtinu (dřív jen češtinu s ruční volbou). Kdo jazyk přepne, toho detekce už nepřebije.
- Provozní administrace má anglickou variantu pod `/en` (texty už existovaly).
- Stránky nesou jen své jmenné prostory; do prohlížeče se katalogy nedostanou vůbec.
- Nové proměnné prostředí ani migrace nejsou potřeba.
