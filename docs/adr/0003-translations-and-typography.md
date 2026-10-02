# ADR 0003: Překlady a česká typografie

- Stav: navrženo (2. 10. 2026), čeká na schválení majitelem.
- Související: `docs/technical-design.md` (kapitoly 2, 6), `docs/data-model.md` (kapitola 9), ADR 0004.

## Kontext

Čeština a angličtina jsou v systému od prvního dne. Čeština je výchozí na `/`, angličtina pod `/en`; bez automatického přesměrování podle prohlížeče, jen nabídka. Texty patří do překladových souborů, ne do kódu. Chybějící překlad se hlásí při sestavení a nikdy se nezobrazí jako klíč. Česká typografie (nezlomitelné mezery za jednopísmennými předložkami a spojkami, před jednotkami a mezi číslem a měnou, v datech, české uvozovky, pomlčka, třítečka jako jeden znak, desetinná čárka a tisíce) platí v textech i e-mailech a musí se vynutit i u dynamických textů. Výchozí angličtina je britská (k potvrzení). Obsah webu páru je v databázi jako `jsonb {cs,en}` (`docs/data-model.md`, kapitola 9); tento ADR řeší texty rozhraní a e-mailů a způsob zobrazení textů páru.

Požadavky na funkci: typované klíče, množná čísla (čeština má čtyři tvary), interpolace, text s malým množstvím značek (odkaz, tučné), použití v Server Components bez zbytečného klientského JavaScriptu, překlady stejně v e-mailech.

## Možnosti

### A. Vlastní tenká vrstva

- JSON zprávy po jmenných prostorech, typované klíče odvozené z českého souboru, `Intl.PluralRules` pro množná čísla, jednoduchá interpolace `{name}`, minimální bohatý text (povolené značky mapované na komponenty), funkce `typo()` aplikovaná na každý výstup.
- Žádná externí závislost; kód má stovky řádků.

### B. next-intl

- Osvědčená knihovna pro App Router: ICU zprávy, typování, routing, formátování.
- Přidává závislost a vlastní konvence směrování (middleware/proxy), které se musí sladit s `src/proxy.ts` a s mapováním hostitelů a přeložených cest; kompatibilita s Next.js 16 a proxy se musí ověřit `[OVĚŘIT]`. Vlastní typografický krok by se stejně musel přidat.

### C. i18next / Lingui

- Rozsáhlý ekosystém a nástroje pro překladatele, ale větší nároky na klienta a konfiguraci pro dvojjazyčný projekt s dvěma jazyky a jedním routerem.

## Doporučení

**Možnost A (vlastní tenká vrstva)**; **next-intl** (B) je dokumentovaná alternativa, pokud by se rozsah vrstvy ukázal větší, než se čeká (například při přidání třetího jazyka, ICU zpráv s vnořeným výběrem nebo externí správy překladů).

Důvody: dva jazyky, jedno pravidlo typografie, jednoznačné směrování z `src/proxy.ts` a nulová nová závislost. Typografický krok je pro projekt nezbytný a žádná z knihoven ho neposkytuje.

### Návrh

**Zprávy.** `src/i18n/messages/{cs,en}/<namespace>.json` (např. `common`, `marketing`, `wizard`, `admin`, `site`, `email`). Struktura klíčů je plochá tečkovaná, hodnota je řetězec, nebo objekt pro množná čísla (`{ "one": …, "few": …, "many": …, "other": … }`; čeština vyžaduje `one`, `few`, `many`, `other`, angličtina `one`, `other`; kategorie určuje `Intl.PluralRules`).

**Typované klíče.** Typ `MessageKey` je odvozen z českého souboru (`typeof cs`); `t('wizard.step1.title')` s neexistujícím klíčem neprojde kontrolou typů. Parametry jsou typované podle zástupných znaků ve zprávě (nebo jsou vyjmenované pro každý klíč v jednoduchém indexu; implementace zvolí levnější variantu).

**Rozhraní.** `t(key, params)` na serveru i klientu; `t.rich(key, { b: (c) => <strong>{c}</strong>, a: … })` pro povolené značky; `formatNumber`, `formatDate`, `formatCurrency` nad `Intl` s lokalitou `cs-CZ` a `en-GB`.

**Směrování jazyka.** `cs` na `/`, `en` pod `/en`. Překlad cest (výchozí hodnota zadání „překládat“: `/cenik` ↔ `/en/pricing`) je v jedné tabulce `src/i18n/pathnames.ts`, z níž čerpá proxy (rewrite), odkazy, `hreflang` i mapa webu. Atribut `lang` stránky a `lang` cizojazyčných částí (WCAG 3.1.1 a 3.1.2); u angličtiny `en-GB` `[OTÁZKA: potvrzení britské angličtiny]`.

**Nabídka jazyka bez přesměrování.** Malý klientský ostrov porovná jazyk prohlížeče s jazykem stránky a nabídne odkaz na druhý jazyk v nenápadném pruhu, který jde zavřít a nekrade zaměření; rozhodnutí se zapamatuje (`localStorage` v `try/catch`, nikdy nutná podmínka). Server nečte `Accept-Language`, aby stránky zůstaly statické.

**Chybějící překlad.** Aplikační texty (marketing, průvodce, správa, e-maily) musí mít v obou jazycích všechny klíče; kontrola při sestavení to vynucuje, takže za běhu se chybějící klíč nemá jak objevit. Pro jistotu `t()` při chybě zaloguje (bez osobních údajů) a vrátí text z druhého jazyka, nikdy klíč. Obsah páru (`i18n_text`) čte `pick(text, locale, default_locale)`: požadovaný jazyk, výchozí jazyk svatby, libovolný neprázdný; chybějící překlady se hlásí správci při kontrole a publikaci (FR-WEB-2).

### Typografie: funkce `typo()` a kontrola při sestavení

`typo(text, locale)` je jediná čistá funkce v `src/i18n/typo.ts` (bez I/O, `domain`-čistá, idempotentní). Aplikuje se vždy po interpolaci, tedy i na dynamické texty, a na výstupy `Intl` (formát čísel a dat). Pro `cs`:

| Pravidlo                                                                | Chování                                                                                                                  |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| jednopísmenné předložky a spojky (k, s, v, z, o, u, a, i; velká i malá) | nezlomitelná mezera (U+00A0) za slovem                                                                                   |
| číslo a jednotka, číslo a měna (`990 Kč`, `60 hostů`)                   | nezlomitelná mezera; seznam jednotek je v konfiguraci                                                                    |
| datum (`1. 10. 2026`)                                                   | nezlomitelná mezera po tečce za dnem a měsícem; čas `14:00` beze změny                                                   |
| desetinná čárka, tisíce                                                 | formátování přes `Intl` (`2,5`, `12 000` s nezlomitelnou mezerou); `typo()` kontroluje, že mezera tisíců je nezlomitelná |
| `...`                                                                   | jeden znak `…`                                                                                                           |
| `-` mezi slovy (myšlenková pauza)                                       | `–` (pomlčka s mezerami); spojovník bez mezer uvnitř slova se nemění                                                     |

`typo()` pracuje jen s textovými uzly (nikdy s HTML atributy nebo značkami), takže rozumí `t.rich`. Pro `en` jen pravidla, která pro angličtinu dávají smysl (nezlomitelná mezera mezi číslem a jednotkou, `…`, pomlčka s mezerami v britské variantě, uvozovky `‘ ’` a `“ ”`) `[OTÁZKA: potvrdí Ondřej Beneš a Eliška Havlová]`.

**Uvozovky** `typo()` nehádá: z `"` nejde spolehlivě poznat otevírací a zavírací uvozovku. Zdrojové zprávy proto musí obsahovat správné znaky (`„text“`, `‚vnořený‘`, v angličtině `“text”`, `‘nested’`), a kontrola při sestavení selže na přímé ASCII uvozovce `"` nebo `'` v textu zprávy (apostrof v angličtině je `’`).

**Kontrola při sestavení** (`scripts/check-i18n.ts`, součást `npm run build` i CI; ADR 0004 ji testuje):

1. **Parita klíčů:** každý klíč v `cs` je v `en` a naopak; žádný prázdný řetězec.
2. **Parita zástupných znaků a značek:** stejné `{param}` a stejné povolené značky v obou jazycích.
3. **Množná čísla:** všechny povinné kategorie pro každý jazyk.
4. **Typografie zdrojových zpráv:** po aplikaci `typo()` nesmí zůstat porušení (jednopísmenná předložka před běžnou mezerou, číslo a jednotka s běžnou mezerou, `...`, `-`, ASCII uvozovky). Zdroje mohou obsahovat běžné mezery, protože `typo()` je opraví při vykreslení; kontrola ověřuje, že pravidla jsou _aplikovatelná_, ne že editor psal U+00A0 v neviditelném znaku.
5. **Nepoužité klíče** jako varování.
6. **E-maily:** šablony e-mailů používají stejné `t()` a `typo()`; test ve Vitestu vykreslí každý e-mail v obou jazycích a ověří výsledek.

**Text zadaný párem** se při vykreslení také normalizuje (`typo()` jen nezlomitelné mezery a `…`, nikdy se nemění uložená hodnota, nikdy se neopravují uvozovky ani jiná autorova rozhodnutí) `[OTÁZKA: potvrdí Ondřej Beneš]`.

**Jednotkové testy `typo()`** používají příklady přímo ze zadání (např. `v kolik`, `na svatbu a ubytování`, `990 Kč`, `60 hostů`, `1. 10. 2026`, `14:00`, `2,5`, `12 000`, `…`) a idempotenci (`typo(typo(x)) === typo(x)`).

**Proces práce s překlady:** copywriterka upravuje JSON přes pull request; anglická verze je plnohodnotná, ne doslovný překlad. Externí nástroj pro správu překladů se v MVP nezavádí `[OTÁZKA]`; návrh je přidat ho, až bude víc než dva autoři. Automatický překlad obsahu páru je volitelný a označený (FR-WEB-2) a poskytovatele a smlouvu o zpracování určí samostatné rozhodnutí; v MVP se nepředpokládá `[OTÁZKA]`.

## Důsledky

### Cena

- Žádná licence ani platba. Vývoj vrstvy a `typo()` je malý a jednorázový; odhad je v `docs/implementation-plan.md` (jiný dokument).
- Kontrola při sestavení přidává krátký krok CI.
- Případný přechod na next-intl nebo nástroj pro překlady by stál migraci formátu zpráv; nízké riziko, protože klíče a JSON zůstanou.

### Bezpečnost

- `t.rich` povoluje jen zadané značky; zprávy nikdy nevkládají surové HTML (`dangerouslySetInnerHTML` se pro texty nepoužívá). Překladatelé tak nemohou zavést XSS.
- Jazyk ve cookie, `localStorage` nebo hlavičkách se nepoužívá k rozhodnutí o obsahu na serveru; jazyk je určen adresou. Nabídka přepnutí jazyka ukládá jen volbu zavřít pruh.
- Text páru se vykresluje jako text, nikdy jako HTML.

### Údržba

- Nová zpráva = dva soubory a kontrola; chyba paritou nepustí build.
- `typo()` je jediné místo pro typografická pravidla; změna pravidla se testuje na jednom místě a platí v UI i e-mailech.
- Vlastní vrstva je vlastní kód: nutné udržovat typování a plurály. Pokud rozsah poroste (třetí jazyk, ICU výběr), je připravený přechod na next-intl.
- Seznam jednotek a výjimek `typo()` je konfigurovatelný, aby jej mohl rozšířit typograf bez změny logiky.
