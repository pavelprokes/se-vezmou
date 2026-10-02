# ADR 0004: Testovací nástroje

- Stav: navrženo (2. 10. 2026), čeká na schválení majitelem.
- Související: `docs/technical-design.md`, `docs/data-model.md` (kapitola 12), ADR 0001 až 0003. Testovací plán (scénáře, kritéria go/no-go) je v `docs/test-plan.md`; tento ADR volí jen nástroje.

## Kontext

Zadání dělá z přístupnosti WCAG 2.2 AA podmínku přijetí, vyžaduje test izolace dat mezi svatbami (podmínka brány B), automatický test kontrastu každé barevné dvojice šablony a palety (návrh s chybou nejde zveřejnit), kontrolu parity jazyků a české typografie, end-to-end scénáře na telefonu a kontrolu hlaviček `noindex`, `hreflang` a strukturovaných dat. Systém má čtyři druhy hostitelů, takže testy musí umět více hostitelů. Tým je malý, CI má být rychlé a levné.

Automatické nástroje pokrývají jen část požadavků přístupnosti; ruční testy (klávesnice, NVDA, VoiceOver, TalkBack, zvětšení 200 % a 400 %, uživatelé nad 70 let) zůstávají povinné a jsou v `docs/test-plan.md`.

## Možnosti

### Jednotkové a komponentové testy

- **U1. Vitest + Testing Library** (`@testing-library/react`, `user-event`, jsdom).
- **U2. Jest + Testing Library.** Osvědčený, ale pomalejší a složitější konfigurace pro ESM a TypeScript.

### End-to-end testy

- **E1. Playwright** (`@playwright/test`): více prohlížečů včetně WebKit, emulace mobilu, více kontextů, snadné mapování hostitelů.
- **E2. Cypress.** Dobré vývojářské prostředí, slabší podpora více domén a WebKit.

### Přístupnost

- **P1. `@axe-core/playwright`** v e2e testech na každé obrazovce a šabloně.
- **P2. Lighthouse CI nebo Pa11y** jako doplněk; přináší měření výkonu, ale přístupnostní pravidla se překrývají s axe.

### Izolace dat

- **D1. pgTAP / SQL testy** spouštěné nad lokálním Postgresem (Supabase CLI, `supabase test db`).
- **D2. Testy izolace jen přes aplikaci** (e2e s dvěma účty). Chytí hodně, ale netestují politiky přímo a nepoznají chybějící RLS na nové tabulce.

### Kontrast palet

- **K1. Vlastní test** (`domain/contrast`, vzorec WCAG pro relativní luminanci) nad deklarovanými dvojicemi barev každé šablony a palety.
- **K2. Externí knihovna pro kontrast.** Další závislost za malou funkci; vzorec je krátký a stabilní.

## Doporučení

- **Vitest + Testing Library** (U1) pro doménu (slugy, normalizace jmen, životní cyklus, retence, `typo()`, kontrast), komponenty a části `auth`.
- **Playwright** (E1) pro e2e včetně mobilního projektu (emulace telefonu) a více prohlížečů; hostitele řeší `*.localhost` a konfigurace `baseURL` podle hostitele.
- **`@axe-core/playwright`** (P1) v každém e2e průchodu obrazovkami a všemi šablonami a paletami; chyby úrovně A a AA jsou nula (metrika zadání). Lighthouse CI jako doplněk výkonu nechávám otevřené `[OTÁZKA]`; cíle výkonu se měří na reálných datech (Speed Insights) a v CI nad klíčovými stránkami.
- **pgTAP** (D1) pro izolaci a pravidla funkcí (`docs/data-model.md`, kapitola 12). e2e s dvěma účty doplňuje.
- **Vlastní test kontrastu** (K1) generovaný ze seznamu palet; pokrývá paletu značky a čtyři šablony po třech paletách. Každá šablona deklaruje, které dvojice jsou text (4,5 : 1), velký text a prvky (3 : 1) a které barvy jsou jen dekor; test selže, pokud se barva označená jako dekor použije jako text. Prahy odpovídají WCAG (1.4.3, 1.4.11). Jde o jednotkový test i o brzký test při zveřejnění: návrh s chybou nejde zveřejnit (doménová funkce `validatePalette` se volá i v aplikaci).
- **Kontrola překladů a typografie** (`scripts/check-i18n.ts`, ADR 0003) jako součást `build` a CI a jako Vitest test.
- **CI** (GitHub Actions `[OTÁZKA: potvrdit hosting repozitáře a CI]`): lint, kontrola typů, Vitest, pgTAP proti lokální Supabase v Dockeru, e2e proti náhledu nebo lokálnímu serveru. Pull request nejde sloučit s červenými testy; brána B vyžaduje zelený test izolace.

Co automatizace nenahradí: ruční klávesnice, čtečky obrazovky, zvětšení, uživatelé nad 70 let a ruční kontrola kritických cest. `docs/test-plan.md` je popisuje; axe samo nestačí `[automatický test pokrývá jen část kritérií]`.

Další pravidla:

- **Testovací data:** vymyšlená (Klára a Matěj), nikdy produkční; seed v `supabase/seed.sql`.
- **E-maily v testech:** odesílání se zachytává (náhrada integrace), obsah se kontroluje typograficky v obou jazycích.
- **Kontrola hlaviček:** e2e test pro všechny čtyři druhy hostitelů ověřuje `X-Robots-Tag`, `robots.txt`, `hreflang`, `canonical`, strukturovaná data (JSON-LD se validuje proti očekávanému tvaru), a že `/h/…` zvenku vrací 404.
- **Vizuální regresní testy** (snímky šablon) nejsou v MVP; zvažují se po stabilizaci šablon `[OTÁZKA]`.

## Důsledky

### Cena

- Všechny nástroje jsou open source bez licenčních nákladů.
- CI čas: Playwright (prohlížeče) a pgTAP s Dockerem jsou nejdražší kroky; doporučené je dělit joby a e2e spouštět plně jen na pull requestech do `main` a před branami, drobné změny jen podmnožinu `[předpoklad, upřesní implementace]`.
- Ruční testy (čtečky, uživatelé nad 70 let) jsou nákladem práce, ne nástrojů.

### Bezpečnost

- pgTAP test chytí chybějící RLS a chybně napsané politiky, než se dostanou do produkce, a hlídá pravidla `security definer` funkcí.
- Testy používají lokální databázi a vymyšlená data; tajné hodnoty se do CI dávají jen v nejnutnějším rozsahu (nikdy produkční klíče).
- E2E testy se nikdy nespouští proti produkční databázi.

### Údržba

- Playwright vyžaduje údržbu selektorů a stabilizaci časování; používat role a popisky (`getByRole`), ne CSS, což zároveň ověřuje přístupnost.
- axe nachází jen část problémů; falešný pocit jistoty je riziko, proto ruční testy v plánu.
- Kontrast: změna palety = úprava dat a test se přizpůsobí; vlastní funkce je malá a bez závislosti.
- Docker v CI (Supabase CLI) a aktualizace verzí nástrojů vyžadují pravidelnou údržbu.
