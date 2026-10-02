# Plán implementace se-vezmou.cz

Stav: návrh k schválení majitelem. Do schválení `technical-design.md` a tohoto plánu se nepíše produkční kód.
Zdroj požadavků: zadání projektu (identifikátory `FR-…`). Co zadání nezná, je označeno `[OTÁZKA]` a vede do `docs/open-questions.md`.

## 1. Vstupy a předpoklady

- Repozitář už obsahuje základ Next.js 16.3 a závislosti, které zadání nezmiňuje: Supabase (klient a SSR), AWS SES, Sentry, Vercel Analytics a Speed Insights, react-hook-form, zod, Lucide. Berou se jako výchozí stav, ne jako schválená rozhodnutí. Každé potvrdí nebo změní ADR (databáze, e-maily, analytika). Sentry a analytika musí splnit „záznamy bez osobních údajů“.
- V Next.js 16 se směrování podle hostitele řeší v souboru `proxy` (dokumentace v `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`). Před M1 ji znovu přečíst, API se liší od starších verzí.
- Podklady z plátna (artboardy) nebyly při psaní plánu k dispozici. Plán vychází jen ze zadání. Před M2 a M5 je třeba export plátna `[OTÁZKA OQ-33]`.
- Kapacita týmu zadání neuvádí `[OTÁZKA OQ-32]`. Odhady jsou proto v člověkodnech (čd), ne v kalendářních dnech.
- Fáze podle zadání: 5 fází a 3 brány. Plán je mapuje takto (odvozeno, k ověření s plátnem roadmapy): fáze 0 návrh a dokumentace, fáze 1 vývoj MVP, fáze 2 uzavřená beta, fáze 3 zaváděcí provoz zdarma, fáze 4 platby (mimo tento plán, jen návrh postupu).

## 2. Jak číst odhady

- **Jisté (J):** práce, jejíž rozsah plyne přímo z `FR-…` a jde ji rozložit na úkoly s malou nejistotou.
- **Předpoklad (P):** práce, kde rozsah závisí na rozhodnutí, které ještě není, na vnější službě nebo na zpětné vazbě (ruční testy, právník, uživatelé). Bere se jako pravděpodobný, ne garantovaný.
- **Rezerva na rizika:** 20 % ze součtu J + P (předpoklad plánovače, není ověřený). Počítá se zvlášť a po M1 se přehodnotí podle skutečné rychlosti.
- Odhady jsou úsudek autora plánu, ne měření. Po M1 se zkalibrují podle skutečně odvedené práce a plán se aktualizuje.
- Čekání na vnější strany (právník, šíření nameserverů 24 až 48 h, ověření e-mailové domény, nábor párů do bety) do čd nepatří, je v kalendáři.

## 3. Milníky a brány (pořadí je závazné)

```
M0 -> [BRÁNA A] -> M1 -> M2 ─┐
                     └-> M3 ─┴-> M4 -> M5 -> M6 ─┐
                                        └-> M7 ─┼-> M8 -> M10 -> M11 -> [BRÁNA B] -> beta -> [BRÁNA C]
                                  M9 (po M4+M3) ─┘
```

| Milník      | Obsah                                                                                                                                                               | Vstup                                        | Výstup (hotovo, když)                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------- |
| M0          | Dokumentace: technický návrh, ADR, datový model, bezpečnost, plán, testy, otázky                                                                                    | zadání                                       | majitel schválil `technical-design.md` a `implementation-plan.md`            |
| **Brána A** | doména a její historie ověřena, právní kontrola údajů a podmínek zahájena a bez blokujícího nálezu, technický návrh schválen                                        | M0                                           | `go` od majitele, jinak se nepíše kód                                        |
| M1          | Základ: design tokeny, písma, i18n a typografická kontrola, `proxy` podle hostitele, `robots`/`noindex` podle hostitele, UI primitiva, Vitest, Playwright, axe v CI | brána A                                      | CI zelené, čtyři druhy hostitelů vrací správné hlavičky                      |
| M2          | Úvodní stránka cs/en, SEO, JSON-LD, čekací listina                                                                                                                  | M1 (čekací listina potřebuje tabulku z M3-1) | `FR-LP-1` až `FR-LP-6`, validátory `hreflang` a strukturovaných dat bez chyb |
| M3          | DB schéma, RLS, izolační testy (paralelně s M2)                                                                                                                     | M1                                           | test, že správce jedné svatby nečte ani nezapisuje cizí data, běží v CI      |
| M4          | Relace, přihlášení kódem a PINem, omezení počtu požadavků, e-maily                                                                                                  | M3                                           | přihlášení bez hesla funguje, e-mailová doména ověřená (SPF, DKIM, DMARC)    |
| M5          | Průvodce 9 kroků a obrazovka „Hotovo“                                                                                                                               | M4                                           | `FR-WZ-1` až `FR-WZ-7`, web publikovatelný                                   |
| M6          | Web páru, 4 šablony, kontrast palet                                                                                                                                 | M5 (bloky lze začít po M3)                   | `FR-WEB-1` až `FR-WEB-4`, test kontrastu všech dvojic                        |
| M7          | Správa páru: bloky, hosté, historie, rychlá změna, PDF a QR                                                                                                         | M5, M6                                       | `FR-ADM-1` až `FR-ADM-7`                                                     |
| M8          | RSVP: slepé, domácnosti, větvení                                                                                                                                    | M6 (web), M7 (seznam hostů)                  | `FR-RSVP-1` až `FR-RSVP-7`, `FR-PRIV-2`                                      |
| M9          | Provozní administrace, audit, operátorské MFA                                                                                                                       | M3, M4                                       | `FR-OPS-1` až `FR-OPS-4`, `FR-OPS-6`, `FR-OPS-7`                             |
| M10         | Životní cyklus, retence, mazání, export                                                                                                                             | M3, M8, M9                                   | `FR-LC-1`, `FR-LC-2`, `FR-OPS-5`, `FR-PRIV-3`, `FR-PRIV-4`                   |
| M11         | Přístupnostní a bezpečnostní brána B, výkon, ověření SEO                                                                                                            | M1 až M10                                    | všechna kritéria brány B z `test-plan.md`                                    |
| **Brána B** | přístupnost WCAG 2.2 AA, test izolace dat, funkční slepé RSVP a přihlášení bez hesla                                                                                | M11                                          | `go` od QA                                                                   |
| Beta        | uzavřená beta s vlastními klienty                                                                                                                                   | brána B                                      | metriky z kapitoly „Fáze, MVP, brány“ zadání                                 |
| **Brána C** | metriky bety, ověřená ochota párů web používat, schválené texty o zaváděcím provozu a podmínkách po něm                                                             | beta                                         | `go` od majitele a QA                                                        |

Přístupnost se netestuje až v M11. Automatické testy (axe, kontrast) běží v CI od M1 a každý milník je splní dřív, než se uzavře. M11 přidává ruční testy a celkové ověření.

## 4. Co jde paralelně

| Dvojice       | Podmínka                                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| M2 a M3       | po M1; jediná vazba je tabulka čekací listiny (M3-1 zřídí databázi)                                                              |
| M6 a M7       | po M5 a po sdíleném modelu bloků (M6-1, M7-1 sdílejí datový tvar bloku); šablony M6-3 až M6-6 nezávisí na M7                     |
| M9 a M5 až M8 | M9 potřebuje jen M3 a M4; je vhodná pro druhého vývojáře                                                                         |
| M10 a M8      | engine životního cyklu (M10-1) lze začít po M3; mazání dat hostů (M10-2) až po M8                                                |
| Průřezově     | práce na textech (copywriterka: anglická verze), právní texty, DNS a e-mailová doména, nábor párů do bety nejsou závislé na kódu |

Kritická cesta: M0, M1, M3, M4, M5, M6/M7, M8, M10, M11. Zdržení kterékoli z nich posouvá ostrý provoz.

## 5. Backlog

Sloupce: J a P v člověkodnech. FR = vazba na požadavek zadání. Závislost = ID jiné položky nebo milník.

### M0 Dokumentace

| ID   | Úkol                                                                                                                     | FR               | Závisí na | J   | P   |
| ---- | ------------------------------------------------------------------------------------------------------------------------ | ---------------- | --------- | --- | --- |
| M0-1 | `technical-design.md` a ADR (databáze, e-maily, fotografie, analytika, testy, překlady, MFA operátorů, postup k platbám) | vše              | -         | 4   | 2   |
| M0-2 | `data-model.md`, `security-privacy.md`                                                                                   | FR-PRIV, retence | M0-1      | 3   | 1   |
| M0-3 | `implementation-plan.md`, `test-plan.md`, `open-questions.md`                                                            | -                | -         | 2   | 0   |
| M0-4 | Brána A: ověření historie domény, předání textů právníkovi, schválení                                                    | brána A          | M0-1      | 0,5 | 2   |

### M1 Základ

| ID   | Úkol                                                                                                                             | FR                   | Závisí na | J   | P   |
| ---- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------- | --------- | --- | --- |
| M1-1 | Design tokeny značky z palety (CSS proměnné, Tailwind)                                                                           | design systém        | brána A   | 2   | 1   |
| M1-2 | Písma Newsreader a DM Sans vlastním hostováním, subset s češtinou                                                                | písma                | M1-1      | 1   | 0,5 |
| M1-3 | i18n: struktura překladových souborů, build selže při chybějícím překladu, nikdy se nezobrazí klíč                               | lokalizace           | brána A   | 3   | 1   |
| M1-4 | Typografická kontrola: lint překladů (nezlomitelné mezery, uvozovky, pomlčky, třítečka) a pomocná funkce pro dynamické texty     | typografie           | M1-3      | 3   | 2   |
| M1-5 | `proxy` podle hostitele (4 druhy), rezervovaná slova, 404 bez výpisu webů                                                        | hostitelé, FR-PRIV-3 | brána A   | 3   | 2   |
| M1-6 | `X-Robots-Tag` a `robots.txt` podle hostitele                                                                                    | FR-PRIV-1            | M1-5      | 1   | 0,5 |
| M1-7 | UI primitiva: tlačítka, pole s popiskem a chybou, volicí prvky, karta, FAQ, přepínač jazyka, kroky, ukazatel, hlášení pro čtečky | komponenty, WCAG     | M1-1      | 8   | 4   |
| M1-8 | Vitest, Playwright, axe v CI; správa tajných hodnot a prostředí                                                                  | test-plan            | brána A   | 3   | 2   |
| M1-9 | Lucide, pravidla pro inline SVG (`role="img"`, popis, `prefers-reduced-motion`), odkaz „přeskočit na obsah“                      | grafika, 2.4.1       | M1-7      | 1   | 0   |

### M2 Úvodní stránka

| ID   | Úkol                                                                                                             | FR                        | Závisí na     | J   | P   |
| ---- | ---------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------- | --- | --- |
| M2-1 | 12 sekcí v češtině, vykreslené na serveru                                                                        | FR-LP-1, FR-LP-2, FR-LP-6 | M1            | 6   | 3   |
| M2-2 | Anglická verze (struktura a napojení; texty dodá copywriterka)                                                   | FR-LP-6, lokalizace       | M2-1          | 2   | 1   |
| M2-3 | SEO: `hreflang`, `canonical`, mapa webu s alternativami, `robots.txt`                                            | SEO                       | M2-1          | 3   | 2   |
| M2-4 | JSON-LD (Organization, WebSite, SoftwareApplication, FAQPage, BreadcrumbList); `Review` jen u skutečných recenzí | FR-LP-4                   | M2-1          | 1   | 1   |
| M2-5 | SVG ilustrace hera a živé ukázky 4 šablon                                                                        | FR-LP-1, FR-LP-2          | M1-9          | 4   | 4   |
| M2-6 | Čekací listina: formulář, souhlas, potvrzení, uložení                                                            | MVP                       | M3-1, M4-6    | 3   | 2   |
| M2-7 | Cena a podmínky na jednom místě v konfiguraci, zástupný `[PODMÍNKY]`                                             | FR-LP-3                   | M2-1          | 0,5 | 0   |
| M2-8 | Pole jmen ve výzvě předvyplní průvodce                                                                           | FR-LP-5                   | M5-2          | 1   | 0   |
| M2-9 | Měření bez zbytečných cookies (události: krok, publikace, RSVP)                                                  | měření                    | ADR analytika | 2   | 1   |

### M3 Databáze a izolace

| ID   | Úkol                                                                                                                  | FR                 | Závisí na | J   | P   |
| ---- | --------------------------------------------------------------------------------------------------------------------- | ------------------ | --------- | --- | --- |
| M3-1 | Zřízení databáze v EU, migrace, prostředí                                                                             | ADR databáze       | M1        | 2   | 1   |
| M3-2 | Schéma podle `data-model.md` (svatba, správci, bloky, události, média, hosté, RSVP, audit, operátoři, záznam e-mailu) | datový model       | M3-1      | 5   | 3   |
| M3-3 | Politiky RLS a role, operátorská cesta zvlášť a auditovaná                                                            | izolace dat        | M3-2      | 5   | 4   |
| M3-4 | Přístupová vrstva v aplikaci, která vždy nastaví kontext svatby                                                       | izolace dat        | M3-3      | 3   | 2   |
| M3-5 | Izolační testy (čtení i zápis cizí svatby, každou tabulkou)                                                           | brána B            | M3-3      | 3   | 2   |
| M3-6 | Pravidla slugů, rezervovaná a blokovaná slova, trvalý záznam použitých adres                                          | FR-WZ-4, FR-PRIV-4 | M3-2      | 2   | 1   |
| M3-7 | Zálohy a obnova, ověření postupu obnovy                                                                               | bezpečnost         | M3-1      | 1   | 1   |

### M4 Relace, přihlášení, e-maily

| ID   | Úkol                                                                                                       | FR                  | Závisí na   | J   | P   |
| ---- | ---------------------------------------------------------------------------------------------------------- | ------------------- | ----------- | --- | --- |
| M4-1 | Relace: cookie jen pro konkrétního hostitele, `HttpOnly`, `Secure`, `SameSite`; doba nečinnosti a platnost | zadání: autentizace | M3          | 3   | 2   |
| M4-2 | Jednorázový kód a odkaz (platnost 10 minut, jednou použitelný, vložení ze schránky)                        | WCAG 3.3.8          | M4-1, M4-6  | 3   | 2   |
| M4-3 | PIN správy: hash, 5 chyb a pauza 15 minut s prodlužováním, oznámení na záložní e-mail                      | zadání: autentizace | M4-1        | 3   | 2   |
| M4-4 | Omezení počtu požadavků (podle adresy i IP) pro přihlášení, RSVP, kontrolu adres; bez prozrazení existence | zadání: bezpečnost  | M3          | 3   | 2   |
| M4-5 | E-mailový poskytovatel, SPF, DKIM, DMARC, přesun nameserverů na Vercel (plán před přepnutím)               | FR-MAIL-2           | ADR e-maily | 3   | 3   |
| M4-6 | E-mailové šablony cs/en s typografií, záznam e-mailu bez osobních údajů, sledování doručení                | FR-MAIL-1           | M4-5, M1-4  | 3   | 2   |
| M4-7 | Správci: až N adres, záložní e-mail povinný, potvrzení a oznámení ostatním                                 | zadání: autentizace | M4-2        | 3   | 2   |
| M4-8 | Přístupné obrazovky přihlášení                                                                             | WCAG                | M4-2, M1-7  | 3   | 2   |

### M5 Průvodce

| ID   | Úkol                                                                                                                      | FR               | Závisí na  | J   | P   |
| ---- | ------------------------------------------------------------------------------------------------------------------------- | ---------------- | ---------- | --- | --- |
| M5-1 | Anonymní koncept, průběžné ukládání, převod na účet při prvním uložení                                                    | FR-WZ-2, FR-WZ-3 | M4         | 5   | 3   |
| M5-2 | Kroky 1 až 3: jména a jazyk, datum a adresa, šablona a paleta                                                             | FR-WZ-1, FR-WZ-2 | M5-1       | 6   | 3   |
| M5-3 | Slug: živá kontrola (omezená), rezervace při prvním uložení, kolize a varianty bez ztráty dat, upozornění na rok v adrese | FR-WZ-4, FR-WZ-6 | M3-6, M4-4 | 4   | 2   |
| M5-4 | Kroky 4 až 8: program a místo, praktické informace, RSVP, přístup a soukromí, kontrola                                    | FR-WZ-1, FR-WZ-2 | M5-2       | 8   | 4   |
| M5-5 | Živý náhled (telefon a počítač)                                                                                           | FR-WZ-3          | M5-2       | 3   | 2   |
| M5-6 | Krok 9, uložit jako neveřejný koncept s neuhádnutelným odkazem, zveřejnit, „Hotovo“ s QR a PINem                          | FR-WZ-5, FR-WZ-1 | M5-4       | 4   | 2   |
| M5-7 | Mobilní rozvržení (jedna otázka na obrazovku, stálé Další a Zpět)                                                         | FR-WZ-7          | M5-2       | 3   | 3   |
| M5-8 | Měřicí události dokončení kroků a publikace; kontrola cíle „do 10 minut“                                                  | měření           | M2-9       | 1   | 0,5 |

### M6 Web páru a šablony

| ID    | Úkol                                                                                                                         | FR                   | Závisí na    | J   | P   |
| ----- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------ | --- | --- |
| M6-1  | Společné bloky (hero, program, místo, ubytování, dress code, FAQ, kontakt, příběh, dary, galerie, ukotvené „Potvrdit účast“) | FR-WEB-1             | M3, M5-1     | 10  | 5   |
| M6-2  | Šablona Editorial                                                                                                            | FR-WEB-3             | M6-1         | 3   | 1   |
| M6-3  | Šablona Eukalyptus (palety Stříbrná, Hloubka, Pudr)                                                                          | FR-WEB-3             | M6-1         | 4   | 2   |
| M6-4  | Šablona Chateau                                                                                                              | FR-WEB-3             | M6-1         | 3   | 2   |
| M6-5  | Šablona Modern                                                                                                               | FR-WEB-3             | M6-1         | 3   | 2   |
| M6-6  | Tři ověřené palety na šablonu a automatický test kontrastu; neprojde, nezveřejní se                                          | FR-WEB-3             | M6-2         | 3   | 2   |
| M6-7  | Vícejazyčnost webu, náhradní jazyk při chybějícím překladu, hlášení správci                                                  | FR-WEB-2             | M6-1, M1-3   | 3   | 1   |
| M6-8  | Fotografie: nahrání, povinný popisek nebo „dekorativní“, odstranění EXIF, velikosti a moderní formáty                        | FR-WEB-1, WCAG 1.1.1 | ADR úložiště | 6   | 4   |
| M6-9  | Režim poděkování po svatbě                                                                                                   | FR-WEB-4             | M6-1         | 2   | 1   |
| M6-10 | Textová adresa vždy, mapa jako doplněk                                                                                       | FR-WEB-1             | M6-1         | 2   | 1   |

### M7 Správa páru

| ID   | Úkol                                                                   | FR        | Závisí na | J   | P   |
| ---- | ---------------------------------------------------------------------- | --------- | --------- | --- | --- |
| M7-1 | Zapínání a řazení bloků, přetažení i tlačítky nahoru a dolů            | FR-ADM-1  | M6-1      | 5   | 2   |
| M7-2 | Průběžné ukládání, koncept a zveřejněná verze, historie změn a vrácení | FR-ADM-2  | M6-1      | 6   | 4   |
| M7-3 | Pruh „Rychlá změna“                                                    | FR-ADM-3  | M6-1      | 2   | 1   |
| M7-4 | Seznam hostů: import z Excelu, ruční zápis, export CSV a Excel         | FR-ADM-4  | M3-2      | 6   | 3   |
| M7-5 | Přehled RSVP a ruční zápis hosta                                       | FR-ADM-5  | M7-4, M8  | 3   | 1   |
| M7-6 | PDF oznámení s adresou, QR a PINem                                     | FR-ADM-6  | M5-6      | 4   | 3   |
| M7-7 | Nápověda na stejném místě každé obrazovky, texty nápovědy              | FR-ADM-7  | M1-7      | 2   | 1   |
| M7-8 | Správa PINu hostů a citlivých bloků (rozhraní)                         | FR-PRIV-2 | M7-1      | 2   | 1   |

### M8 RSVP

| ID   | Úkol                                                                                                         | FR                   | Závisí na  | J   | P   |
| ---- | ------------------------------------------------------------------------------------------------------------ | -------------------- | ---------- | --- | --- |
| M8-1 | Slepé porovnání jména (normalizace diakritiky, tolerance překlepů, bez našeptávače a výpisu)                 | FR-RSVP-1            | M7-4       | 4   | 3   |
| M8-2 | Domácnosti, „plus jedna“, děti s věkem                                                                       | FR-RSVP-2            | M8-1       | 5   | 3   |
| M8-3 | Větvení podle událostí                                                                                       | FR-RSVP-3            | M8-2       | 4   | 2   |
| M8-4 | Otázky: doprovod, děti, dieta a alergie (oddělený zdravotní údaj), ubytování, doprava, píseň, vlastní otázky | FR-RSVP-4            | M8-2       | 5   | 2   |
| M8-5 | Otevření a uzavření podle data, úprava odpovědi, potvrzení na obrazovce a e-mailem, ohlášení čtečce          | FR-RSVP-5, FR-RSVP-6 | M8-2, M4-6 | 4   | 2   |
| M8-6 | Ochrana před spamem (omezení, skrytá past), host mimo seznam jako volba páru                                 | FR-RSVP-7            | M4-4       | 2   | 1   |
| M8-7 | PIN hostů a odemykání citlivých bloků (číslo účtu, QR platba, soukromé místo)                                | FR-PRIV-2            | M6-1, M4-3 | 3   | 2   |

### M9 Provozní administrace

| ID   | Úkol                                                                                      | FR                 | Závisí na | J   | P   |
| ---- | ----------------------------------------------------------------------------------------- | ------------------ | --------- | --- | --- |
| M9-1 | Přihlášení operátorů: kód e-mailem plus druhý faktor dle ADR, záložní postup              | zadání: operátor   | M4        | 6   | 4   |
| M9-2 | Seznam zakázek s filtry a hledáním, stavy                                                 | FR-OPS-1, FR-OPS-2 | M3        | 6   | 3   |
| M9-3 | Detail zakázky, poznámky, odkaz na náhled                                                 | FR-OPS-3           | M9-2      | 3   | 1   |
| M9-4 | Zásahy: změna stavu, prodloužení, změna adresy, zablokování, obnova, poslání odkazu       | FR-OPS-4           | M9-3      | 5   | 3   |
| M9-5 | Audit každého zásahu a nahlížení do údajů hostů jen se souhlasem páru, důvodem a záznamem | FR-OPS-7           | M3-3      | 5   | 3   |
| M9-6 | Role majitel a podpora, přehledy (počty konceptů, webů, svatby podle měsíců)              | FR-OPS-6           | M9-2      | 2   | 1   |

### M10 Životní cyklus a retence

| ID    | Úkol                                                                                                                     | FR                           | Závisí na   | J   | P   |
| ----- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------- | ----------- | --- | --- |
| M10-1 | Stavy a přechody podle dat s ručním zásahem, plánovač úloh                                                               | FR-LC-1                      | M3, M9-4    | 6   | 3   |
| M10-2 | Retence a nevratné mazání (dieta 30 dní po svatbě, ostatní 12 měsíců, po schválení právníkem), záznam bez osobních údajů | FR-OPS-5                     | M10-1, M8   | 6   | 4   |
| M10-3 | Export hostů, RSVP a fotografií                                                                                          | FR-LC-2                      | M8, M6-8    | 4   | 2   |
| M10-4 | E-maily před vypršením a smazáním, seznam webů před vypršením                                                            | FR-LC-2, FR-OPS-5, FR-MAIL-1 | M10-1, M4-6 | 2   | 1   |
| M10-5 | Obnova smazaného webu v retenční lhůtě                                                                                   | FR-OPS-4                     | M10-2       | 2   | 2   |
| M10-6 | Nepřidělování adres zveřejněných webů znovu, 404 bez výpisu                                                              | FR-PRIV-3, FR-PRIV-4         | M3-6        | 1   | 0   |

### M11 Brána B, výkon, SEO

| ID    | Úkol                                                                                             | FR          | Závisí na      | J   | P   |
| ----- | ------------------------------------------------------------------------------------------------ | ----------- | -------------- | --- | --- |
| M11-1 | Přístupnostní audit všech obrazovek a šablon, opravy                                             | WCAG 2.2 AA | M1 až M10      | 8   | 8   |
| M11-2 | Ruční testy: klávesnice, NVDA, VoiceOver, TalkBack, 200 % a 400 %                                | WCAG        | M11-1          | 5   | 3   |
| M11-3 | Bezpečnostní test izolace dat, relací, PINů, omezení požadavků                                   | brána B     | M3-5           | 5   | 5   |
| M11-4 | Výkon: Core Web Vitals na telefonu, obrázky a písma                                              | výkon       | M6             | 4   | 3   |
| M11-5 | Ověření SEO: hlavičky `noindex` u čtyř druhů adres, `hreflang`, strukturovaná data, `robots.txt` | SEO         | M2             | 3   | 1   |
| M11-6 | Test se 5 uživateli nad 70 let na ukázkovém webu                                                 | WCAG        | M6             | 3   | 2   |
| M11-7 | Rozhodnutí go/no-go brány B (QA)                                                                 | brána B     | M11-1 až M11-6 | 0   | 0   |

### Součty

| Milník                           | J (čd)  | P (čd)    | J + P          |
| -------------------------------- | ------- | --------- | -------------- |
| M0                               | 9,5     | 5         | 14,5           |
| M1                               | 25      | 13        | 38             |
| M2                               | 22,5    | 14        | 36,5           |
| M3                               | 21      | 14        | 35             |
| M4                               | 24      | 17        | 41             |
| M5                               | 34      | 19,5      | 53,5           |
| M6                               | 39      | 21        | 60             |
| M7                               | 30      | 16        | 46             |
| M8                               | 27      | 15        | 42             |
| M9                               | 27      | 15        | 42             |
| M10                              | 21      | 12        | 33             |
| M11                              | 28      | 22        | 50             |
| **Celkem**                       | **308** | **183,5** | **491,5**      |
| Rezerva na rizika (20 % z J + P) |         |           | 98             |
| **Celkem s rezervou**            |         |           | **zhruba 590** |

Úkoly, které tento plán nepočítá: copywriting (texty cs/en, nápověda, e-maily), grafika a design mimo SVG ilustrace, právní texty, nábor a podpora bety, provoz po spuštění.

## 6. Kalendář odhadem

Rozhodující je kapacita, kterou zadání neuvádí `[OTÁZKA OQ-32]`. Tabulka je prostá aritmetika: 590 čd děleno kapacitou, 4,5 produktivního dne na osobu a týden, začátek 2026-10-05, dva týdny přestávky kolem Vánoc. Je to dolní hranice, bez čekání na vnější strany, bez ztrát na koordinaci a bez doby bety.

| Kapacita (plné úvazky) | Doba práce      | Nejdřívější konec M11 (brána B) |
| ---------------------- | --------------- | ------------------------------- |
| 3                      | zhruba 44 týdnů | konec srpna 2027                |
| 4                      | zhruba 33 týdnů | začátek června 2027             |
| 6                      | zhruba 22 týdnů | druhá polovina března 2027      |
| 8                      | zhruba 17 týdnů | polovina února 2027             |

Závěr: cíl „ostrý provoz začátkem 2027“ je splnitelný jen s kapacitou kolem 8 plných úvazků, nebo po zmenšení rozsahu. Beta a brána C přidávají další týdny po M11. Při menší kapacitě ho splnit nelze. Majitel má zvolit: (a) navýšit kapacitu, (b) zmenšit rozsah, (c) posunout cíl. Plán nic z toho nepředjímá. Kandidáti na zmenšení (rozhoduje majitel, kroky nemění požadavky zadání):

- tři šablony místo čtyř (zadání: minimum jsou tři; úspora z M6-4 nebo M6-5 je kolem 5 čd J + P);
- odložit automatický překlad (`FR-WEB-2` ho označuje jako volitelný, v plánu není);
- obnova smazaného webu (M10-5) ručně přes podporu místo obrazovky.

Orientační rozvržení po milnících při kapacitě, která to unese (měsíce, ne sliby):

| Období              | Hlavní práce                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| říjen 2026          | M0, schválení, brána A (právní kontrola trvá mimo plán); plán přesunu nameserverů                                               |
| listopad 2026       | M1; začátek M2 a M3                                                                                                             |
| prosinec 2026       | M2 a M3 dokončit, M4 začít; přesun nameserverů na Vercel a ověření e-mailové domény proběhnou před jakýmkoli tištěným oznámením |
| leden 2027          | M4, M5                                                                                                                          |
| únor až březen 2027 | M6, M7, M8, M9 (část paralelně), M10                                                                                            |
| po M10              | M11, brána B, uzavřená beta, brána C                                                                                            |

Při kapacitě pod 8 plných úvazků se tento kalendář posouvá podle tabulky výše.

## 7. Rizika plánu

Rizika produktu ze zadání (úniky dat, DNS, doručitelnost, zneužití subdomén, malý trh, zpoždění sezóny) platí beze změny. Doplňují je rizika plánu:

| Riziko                                                                                             | Dopad                                       | Snížení                                                                                                 |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Kapacita neodpovídá cíli začátku 2027                                                              | posun spuštění, případně o celou sezónu     | rozhodnutí majitele o kapacitě a rozsahu po schválení plánu; kalibrace odhadů po M1                     |
| Přesun nameserverů na Vercel (24 až 48 h) a ztráta e-mailových záznamů                             | výpadek e-mailů                             | v M4-5 zkopírovat a ověřit SPF, DKIM, DMARC před přepnutím, přepnout mimo špičku                        |
| RLS napsané špatně nebo obejité servisním klíčem                                                   | únik dat mezi svatbami                      | servisní klíč jen v operátorské a plánovací cestě, izolační testy v CI od M3, bezpečnostní test v M11-3 |
| Právní lhůty a texty přijdou pozdě                                                                 | zdržení brány A, retence M10-2              | předat právníkovi texty hned po M0; výchozí lhůty platí, dokud právník neodpoví                         |
| Přístupnost objevená až na konci                                                                   | velké opravy                                | axe a kontrast v CI od M1, přístupnost jako podmínka dokončení každé úlohy                              |
| Typografická pravidla v dynamických textech                                                        | nekonzistence, přepisy                      | kontrola při sestavení (M1-4), pomocná funkce povinná pro dynamické texty                               |
| Závislost na anglických textech od copywriterky                                                    | zpoždění parity jazyků                      | build selže při chybějícím překladu, takže mezera je vidět hned                                         |
| Předinstalované závislosti (Supabase, SES, Sentry, Vercel Analytics) jsou považovány za rozhodnutí | zámek na dodavatele, zpracovatelé bez smluv | ADR je potvrdí nebo změní; smlouvy o zpracování a umístění dat před betou                               |
| Nábor párů do bety                                                                                 | beta bez dat, brána C neověřená             | zahájit nábor během M8; metriky bety jsou návrhy, ne záruky                                             |
| Ruční testy čteček a testy s uživateli nad 70 let                                                  | posun brány B                               | plánovat termíny a testery v M9 až M10, ne až po M10                                                    |

## 8. Pravidla řízení

- Do další fáze se přechází po splnění kritérií brány (`test-plan.md`, kapitola Brány). Vynechání brány je vědomé riziko, které schvaluje majitel.
- Rozhodnutí go/no-go vydává QA po každé bráně.
- Každá změna odhadu nebo rozsahu se zapíše do tohoto souboru s datem.
