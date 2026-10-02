# Testovací plán se-vezmou.cz

Stav: návrh k schválení. Vychází ze zadání (identifikátory `FR-…`) a z `implementation-plan.md`. Ukázková jména v testech: Klára a Matěj.
Hodnoty, které zadání neuvádí, jsou označeny `[OTÁZKA]` a vedou do `open-questions.md`.

## 1. Zásady

- Přístupnost WCAG 2.2 AA je akceptační podmínka. Úloha není hotová, dokud neprojde automatickou kontrolou a u nových obrazovek i ruční klávesnicí.
- Testy běží v CI od M1 (Vitest, Playwright, axe). Ruční testy se plánují předem, protože potřebují lidi a zařízení.
- Testovací data jsou vymyšlená. Do testů, snímků a záznamů chyb nepatří skutečné osobní údaje hostů.
- Rozhodnutí go/no-go vydává QA po každé bráně a zapíše ho s odkazem na výsledky.
- Metriky ze zadání jsou návrhy upřesněné po prvních datech bety. Plán je bere jako výchozí práh.

## 2. Automatické testy

### 2.1 Jednotkové (Vitest)

| Oblast            | Co se ověřuje                                                                                                                                                                                                                                  | FR / zdroj                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Slug              | převod diakritiky na ASCII, povolené znaky, nejvýše 63 znaků, žádná pomlčka na kraji ani dvě za sebou, krácení dlouhých jmen, rezervovaná slova (`www`, `app`, `admin`, `api`, `mail`, `podpora`, `status`, `static`, `cdn`), blokované výrazy | FR-WZ-4, hostitelé              |
| Varianty adres    | `klara-a-matej-2027`, `klara-a-matej-2027-06`, `klara-a-matej-obec`, neuhádnutelná `klara-a-matej-k7m2`; žádná varianta není rezervovaná ani již použitá                                                                                       | FR-WZ-4                         |
| Normalizace jmen  | „Klára“ shodné s „Klara“, velikost písmen, mezery, pořadí jméno a příjmení, tolerance překlepů; nesmí párovat jiné jméno                                                                                                                       | FR-RSVP-1                       |
| Životní cyklus    | všechny povolené a zakázané přechody, přechody podle dat, ruční zásah                                                                                                                                                                          | FR-LC-1, FR-OPS-2               |
| Retence           | dietní údaje po 30 dnech od svatby, ostatní po 12 měsících, hranice dne, časové pásmo, svatba se změněným datem                                                                                                                                | zadání: osobní údaje            |
| Kontrast          | každá barevná dvojice každé palety každé šablony a palety značky: text 4,5 : 1, velký text a prvky 3 : 1; návrh s chybou nejde zveřejnit                                                                                                       | FR-WEB-3                        |
| Typografie        | pomocná funkce a lint: nezlomitelná mezera za k, s, v, z, o, u, a, i, před jednotkami a mezi číslem a měnou, datum a čas, české uvozovky, pomlčky, třítečka, desetinná čárka, tisíce                                                           | zadání: typografie              |
| PIN a kódy        | hash místo čistého tvaru, jednorázovost, platnost 10 minut, 5 chyb a pauza 15 minut s prodlužováním, oddělený PIN správy a PIN hostů, společný PIN zakázán                                                                                     | zadání: autentizace             |
| Omezení požadavků | limit podle adresy i IP, shodná odpověď pro existující a neexistující e-mail či adresu                                                                                                                                                         | zadání: bezpečnost              |
| RSVP logika       | větvení podle pozvání na události, domácnost, „plus jedna“, děti s věkem, otevření a uzavření podle data                                                                                                                                       | FR-RSVP-2, FR-RSVP-3, FR-RSVP-5 |
| Hostitel          | z hlavičky `Host` se určí druh (úvodní stránka, průvodce, administrace, web páru) a slug; neznámý hostitel dává 404 bez výpisu webů                                                                                                            | zadání: hostitelé, FR-PRIV-3    |
| Vícejazyčnost     | chybějící překlad dává dostupný jazyk, ne prázdné místo ani klíč                                                                                                                                                                               | zadání: datový model            |

### 2.2 Komponentové

- Všechna UI primitiva a bloky webu páru: popisek u každého pole, chyba popsaná slovy, stav nese ikonu nebo text, viditelné zaměření, cíl dotyku alespoň 24 × 24 px (navrženo 44 × 44 px).
- Řazení bloků: přetažení i tlačítka nahoru a dolů dávají stejný výsledek (2.5.7).
- Přepínač jazyka, FAQ, ukazatel kroků průvodce, pruh „Rychlá změna“, ukotvené tlačítko „Potvrdit účast“ nezakrývá zaměřený prvek (2.4.11).
- Ilustrace a SVG mají `role="img"` a popis, dekorativní jsou skryté. Animace se vypnou při `prefers-reduced-motion`.
- Hlášení „Účast potvrzena“ a chyb je v živé oblasti a nepřesouvá zaměření (4.1.3).
- Každý blok v obou jazycích a ve všech čtyřech šablonách (vizuální snímek je doplněk, ne náhrada přístupnostního testu).

### 2.3 End-to-end (Playwright)

Každý scénář běží na viewportu telefonu i počítače, pokud není uvedeno jinak. Chyby jsou ověřeny i pro angličtinu.

| ID     | Scénář                                                                                                                     | Ověřuje                        |
| ------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| E2E-01 | Průvodce od jmen (Klára a Matěj) po zveřejnění na telefonu, bez registrace do kroku 3, měření času do zveřejnitelného webu | FR-WZ-1 až FR-WZ-3, FR-WZ-7    |
| E2E-02 | Přeskočení kroků 4 až 8 a návrat k nim                                                                                     | FR-WZ-2                        |
| E2E-03 | Průběžné ukládání: obnovení stránky a zavření prohlížeče neztratí rozepsaná data                                           | FR-WZ-3                        |
| E2E-04 | Kolize adresy: nabídka variant, pár nepřijde o data, rezervace až při prvním uložení                                       | FR-WZ-4                        |
| E2E-05 | Rezervace konceptu vyprší po době bez aktivity a adresa se uvolní (hodnota `[OTÁZKA]`)                                     | FR-WZ-6                        |
| E2E-06 | Uložení jako koncept: neuhádnutelný odkaz na náhled, `noindex`                                                             | FR-WZ-5                        |
| E2E-07 | Obrazovka „Hotovo“: adresa, QR kód, PIN, PDF oznámení                                                                      | FR-WZ-1, FR-ADM-6              |
| E2E-08 | Přihlášení kódem: vložení ze schránky, platnost 10 minut, jednorázovost, opakované použití selže                           | zadání: autentizace            |
| E2E-09 | Přihlášení PINem: pět chyb, pauza 15 minut, prodlužování, oznámení na záložní e-mail                                       | zadání: autentizace            |
| E2E-10 | Správci: přidání a odebrání adresy, potvrzení, oznámení ostatním, strop N, povinný záložní e-mail                          | zadání: autentizace, FR-MAIL-1 |
| E2E-11 | Neexistující e-mail a existující e-mail dávají stejnou odpověď i podobný čas                                               | zadání: bezpečnost             |
| E2E-12 | RSVP samostatného hosta, slepé párování, překlep ve jménu, žádný našeptávač ani výpis                                      | FR-RSVP-1                      |
| E2E-13 | RSVP domácnosti, „plus jedna“ s ručním jménem, děti s věkem                                                                | FR-RSVP-2                      |
| E2E-14 | Větvení: host pozvaný jen na hostinu nevidí obřad                                                                          | FR-RSVP-3                      |
| E2E-15 | Odeslání, úprava odpovědi, potvrzení na obrazovce a e-mailem, ohlášení čtečce                                              | FR-RSVP-6                      |
| E2E-16 | RSVP před otevřením a po uzavření; host mimo seznam podle volby páru; ochrana před spamem                                  | FR-RSVP-5, FR-RSVP-7           |
| E2E-17 | PIN hostů: citlivé bloky (číslo účtu, soukromé místo) skryté do zadání, omezení pokusů                                     | FR-PRIV-2                      |
| E2E-18 | Správa: zapnutí bloků, řazení myší a tlačítky, koncept a zveřejněná verze, historie a vrácení (`e2e/admin-site.e2e.ts`)    | FR-ADM-1, FR-ADM-2             |
| E2E-19 | „Rychlá změna“ se okamžitě zobrazí a skryje (`e2e/admin-site.e2e.ts`)                                                      | FR-ADM-3                       |
| E2E-20 | Import hostů z Excelu, ruční zápis, export CSV a Excel, ruční zápis odpovědi po telefonu                                   | FR-ADM-4, FR-ADM-5             |
| E2E-21 | Přepnutí do režimu poděkování: odpočet, RSVP a dary zmizí, galerie zůstane                                                 | FR-WEB-4                       |
| E2E-22 | Životní cyklus podle dat se zrychleným časem; upozornění před vypršením, export, smazání                                   | FR-LC-1, FR-LC-2               |
| E2E-23 | Mazání po retenci: dietní údaje po 30 dnech, ostatní po 12 měsících, záznam v auditu bez osobních údajů, nevratnost        | zadání: retence                |
| E2E-24 | Provozní administrace: filtry, hledání, zásahy, audit každého zásahu, role podpory bez údajů hostů                         | FR-OPS-1 až FR-OPS-7           |
| E2E-25 | Operátor: kód plus druhý faktor, záložní postup; nahlédnutí do údajů hostů jen po souhlasu s důvodem                       | zadání: operátor               |
| E2E-26 | Čekací listina na úvodní stránce, souhlas, potvrzení                                                                       | MVP                            |
| E2E-27 | Pole jmen ve výzvě úvodní stránky předvyplní průvodce                                                                      | FR-LP-5                        |
| E2E-28 | Odkaz na externí galerii: karta z Open Graph načtená serverem, před i po svatbě, bez volání cizího webu, jen po PINu, SSRF | FR-WEB-4, FR-PRIV-2            |

### 2.4 Izolace dat mezi svatbami

Test běží v CI proti skutečné databázi od M3 a je součástí brány B.

- Svatby: Klára a Matěj (A), druhý pár vymyšlených jmen (B). Správce A nesmí číst ani zapisovat žádný řádek B v žádné tabulce (svatba, bloky, události, média, hosté, domácnosti, RSVP, nastavení, audit, záznam e-mailu).
- Pokus o změnu identifikátoru svatby v požadavku, v adrese, v těle i v cookie, je odmítnut databází.
- Anonymní host a anonymní koncept nevidí nic, co jim nepatří.
- Dotaz napsaný chybně (bez filtru podle svatby) nevrátí cizí data díky RLS.
- Servisní a operátorská cesta je oddělená, auditovaná a nedostupná z veřejných cest.
- Cookie jednoho hostitele není přijata jiným hostitelem; žádná cookie neplatí pro celou doménu.
- Každá nová tabulka bez politiky RLS shodí kontrolu v CI.

### 2.5 Zabezpečení a soukromí

- Omezení počtu požadavků u přihlášení, RSVP a kontroly adres, bez prozrazení existence adresy nebo e-mailu.
- Atributy cookies `HttpOnly`, `Secure`, `SameSite`.
- V záznamech ani chybách (včetně Sentry a analytiky) nejsou jména, e-maily ani dietní údaje.
- Stránka neexistující adresy nevypisuje ani nenabízí jiné weby (`FR-PRIV-3`).
- Ověření, že pro novou subdoménu se certifikát nevydá, dokud svatba neexistuje.
- Tajné hodnoty nejsou v repozitáři (kontrola v CI).

### 2.6 Přístupnost (automaticky)

- axe v Playwrightu na všech obrazovkách úvodní stránky, průvodce, správy, webu páru (všechny čtyři šablony a všechny palety, česky i anglicky) a provozní administrace. Práh: nula chyb úrovně A a AA.
- Kontrola `lang` stránky a cizojazyčných částí, odkaz „přeskočit na obsah“, hierarchie nadpisů.
- Stránka bez vodorovného posunu na šířce 320 px a při zvětšení 400 %; úprava rozestupů textu nic neořízne (viewport 320 px v Playwrightu).
- Automatický test kontrastu každé dvojice (viz 2.1).
- Automatické testy nenahrazují ruční (viz 3).

### 2.7 Výkon

- Lighthouse nebo ekvivalent v CI a měření po každém nasazení na emulovaném průměrném telefonu přes mobilní data.
- Prahy ze zadání: největší vykreslený prvek do 2,5 s, posun rozvržení do 0,1, odezva na interakci do 200 ms.
- Obrázky v moderních formátech a ve více velikostech; písma z vlastního hostingu (žádný požadavek na třetí stranu); žádné zbytečné skripty třetích stran (kontrola seznamu síťových požadavků).
- Měří se úvodní stránka, krok průvodce, web páru v každé šabloně s galerií a RSVP.
- Přesné prahy pro opakované měření (počet běhů, percentil) `[OTÁZKA]`; výchozí je medián z více běhů.

### 2.8 SEO a hlavičky

- Test hlaviček u všech čtyř druhů adres: `se-vezmou.cz` bez `noindex`; `app.`, `admin.` a weby párů s `X-Robots-Tag: noindex, nofollow` a vlastním `robots.txt`.
- `robots.txt` úvodní stránky povoluje vyhledávací a odpovědní roboty; trénovací roboti se nepovolují (výchozí hodnota, `[OTÁZKA OQ-04]`). Seznam robotů se před spuštěním ověří v jejich dokumentaci.
- `hreflang` cs, en a x-default, `canonical` na každé verzi, mapa webu s jazykovými alternativami; validátor bez chyb.
- Zdrojové HTML úvodní stránky obsahuje `h1`, odpovědi i FAQ bez spuštění skriptu.
- Strukturovaná data: Organization, WebSite, SoftwareApplication (cena podle `FR-LP-3`), FAQPage, BreadcrumbList; `Review` jen u skutečných recenzí (do dodání recenzí test ověří, že `Review` v kódu není). Test před každým vydáním.
- Jeden název a jeden popis služby všude (kontrola při vydání).

### 2.9 Parita jazyků a typografie

- Každý klíč existuje v češtině i angličtině, jinak build selže. Žádný klíč se nezobrazí uživateli.
- Lint překladů a e-mailů podle pravidel typografie (viz 2.1); kontrola dynamických textů přes pomocnou funkci.
- E-mailové šablony existují v obou jazycích a výsledné HTML i textová verze splňují typografická pravidla.
- `lang` odpovídá zvolenému jazyku; přepínač jazyka je přístupný, odkazy mají `hreflang`; neprobíhá automatické přesměrování podle prohlížeče, jen nabídka.
- Kontrola, že anglické texty používají britský pravopis (výchozí, `[OTÁZKA OQ-02]`).

### 2.10 E-maily

- Přihlašovací kód, potvrzení RSVP, upozornění na správce, upozornění na přihlášení na záložní e-mail, upozornění před vypršením: každý v češtině i angličtině.
- SPF, DKIM, DMARC projdou kontrolou před prvním ostrým odesláním; sledování doručení. Záznam e-mailu neobsahuje obsah s osobními údaji.
- Doručení do hlavních schránek v zkušební dávce (výběr schránek `[OTÁZKA]`).

## 3. Ruční testy

| ID     | Test                                                                                                                                                 | Kdy                       | Kdo                     |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ----------------------- |
| MAN-01 | Klávesnice na každé obrazovce: pořadí zaměření, viditelné zaměření, ukotvené prvky zaměření nezakryjí                                                | každý milník, finálně M11 | QA, vývojář             |
| MAN-02 | NVDA s prohlížečem na počítači (průvodce, správa, web páru, RSVP, přihlášení)                                                                        | M11                       | přístupnost             |
| MAN-03 | VoiceOver na iOS (kritické cesty na telefonu)                                                                                                        | M11                       | přístupnost             |
| MAN-04 | TalkBack na Androidu (kritické cesty na telefonu)                                                                                                    | M11                       | přístupnost             |
| MAN-05 | Zvětšení 200 % a 400 %, šířka 320 px, úprava rozestupů textu                                                                                         | M11                       | přístupnost             |
| MAN-06 | Test se 5 uživateli nad 70 let na ukázkovém webu (RSVP a čtení programu)                                                                             | M11                       | UX, QA                  |
| MAN-07 | Mobil: skutečná zařízení iOS a Android, průvodce za jeden večer, stálé tlačítko Další a Zpět, dotykové cíle                                          | M5 a M11                  | QA                      |
| MAN-08 | Správce hesel a vložení kódu ze schránky při přihlášení (3.3.8)                                                                                      | M4 a M11                  | QA                      |
| MAN-09 | Omezení pohybu v systému: animace se nespustí, nic nebliká, bez hudby na pozadí                                                                      | M6 a M11                  | přístupnost             |
| MAN-10 | Typografie a kopie: čtení českých i anglických textů a e-mailů typografem a copywriterkou (Ondřej Beneš, Eliška Havlová)                             | M2 a před betou           | typografie, copywriting |
| MAN-11 | Text na fotografii je vždy na zajištěném podkladu                                                                                                    | M6                        | design, přístupnost     |
| MAN-12 | PDF oznámení: tisk, čitelnost QR kódu z papíru i obrazovky                                                                                           | M7                        | QA                      |
| MAN-13 | Procházkou sekcí úvodní stránky bez kontextu: každá sekce začíná 1 až 2 samostatnými větami (odpovědní bloky)                                        | M2                        | SEO, copywriting        |
| MAN-14 | Měsíční test GEO: 20 stálých otázek v AI asistentech, zápis výsledku (po spuštění)                                                                   | měsíčně                   | SEO                     |
| MAN-15 | Právní kontrola: texty o zpracování, podmínky, prohlášení o přístupnosti, retence a smlouvy o zpracování ověřuje skutečný právník, ne testovací plán | brána A, C                | právník                 |

Rozsah NVDA, VoiceOver a TalkBack (verze a kombinace prohlížeč a systém) `[OTÁZKA]`; výchozí je jedna aktuální kombinace na čtečku a zdokumentovat ji.

## 4. Testovací prostředí a data

- Prostředí: lokální, náhledy větví, předprodukce a produkce. Wildcard subdomény lze zkoušet jen tam, kde je nastavena doména (předprodukce); jinak se hostitel simuluje hlavičkou `Host`.
- Seed: dvě až tři vymyšlené svatby (Klára a Matěj, další vymyšlená jména) s hosty, domácnostmi a událostmi; všechny čtyři šablony.
- Čas: testy životního cyklu používají řízené hodiny, ne čekání.
- Žádná produkční data v testech.

## 5. Kritéria go/no-go

Go znamená splnění všech bodů „musí“. Nesplněný bod je no-go, dokud majitel vědomě nepřijme riziko (zápis s odůvodněním). Rozhodnutí vydává QA.

### Brána A (před vývojem)

Musí:

- doména `se-vezmou.cz` koupená a ověřená její historie (kdo a čím, `[OTÁZKA OQ-31]`);
- právní kontrola osobních údajů a podmínek zahájena skutečným právníkem a bez blokujícího nálezu pro návrh (konečné znění právních textů není podmínkou této brány);
- `technical-design.md` a `implementation-plan.md` schváleny majitelem;
- otevřené otázky mají odpověď nebo schválenou výchozí hodnotu;
- ADR pro databázi, e-maily, fotografie, analytiku, testy, překlady a druhý faktor operátorů existují.

### Brána B (před betou)

Musí:

- Přístupnost: nula chyb úrovně A a AA v automatickém testu na všech obrazovkách a šablonách; provedené ruční testy MAN-01 až MAN-09 na kritických cestách bez blokujících chyb; kontrast všech dvojic úspěšný;
- Izolace: testy z 2.4 zelené a bezpečnostní test oddělení dat proběhl bez nálezu úniku;
- Slepé RSVP: E2E-12 až E2E-16 zelené, žádný výpis ani našeptávač jmen;
- Přihlášení bez hesla: E2E-08 až E2E-11 zelené, omezení počtu pokusů ověřeno;
- Soukromí: hlavičky `noindex` na `app.`, `admin.` a webech párů, 404 bez výpisu, PIN hostů funkční;
- Výkon: největší vykreslený prvek na telefonu do 2,5 s, posun rozvržení do 0,1, odezva do 200 ms na měřených stránkách;
- E-maily: SPF, DKIM, DMARC ověřeny, doručení přihlašovacích kódů ověřeno;
- Parita jazyků a typografie: build bez chybějících překladů, lint typografie bez chyb;
- Smlouvy o zpracování a umístění dat ověřeny u databáze, hostingu a e-mailového poskytovatele;
- Žádná známá chyba vysoké závažnosti.

Měly by: test se 5 uživateli nad 70 let proběhl a výsledek je zapsán; případná zjištění mají plán. Neproběhl-li, je to vědomé riziko.

### Brána C (před zaváděcím provozem pro veřejnost)

Musí:

- čas od založení do zveřejnitelného webu: medián do 10 minut (návrh metriky);
- dokončení RSVP u hostů, kteří formulář otevřeli: alespoň 80 % (návrh metriky);
- přístupnost: automatický test nula chyb úrovně A a AA a provedená ruční kontrola kritických cest;
- největší vykreslený prvek na telefonu do 2,5 s;
- ověřená ochota párů web používat (zdroj: skutečná data bety, ne odhad);
- texty o zaváděcím provozu a podmínkách po jeho skončení schválené majitelem a zkontrolované právníkem (`[PODMÍNKY]` doplněno); žádný text neslibuje „zdarma navždy“;
- retenční lhůty schválené právníkem a mazání ověřeno E2E-22 a E2E-23;
- reference: buď skutečné se souhlasem autorů, nebo zástupný text bez značek `Review`;
- napojení Search Console a Bing Webmaster Tools a analytiky bez zbytečných cookies;
- případné odchylky od brány B vyřešeny.

Počty v metrikách bety jsou návrhy a upřesní se po prvních datech. Počet párů a délka bety nejsou ve zadání, `[OTÁZKA OQ-34]`.

## 6. Hlášení výsledků

- Každé spuštění CI ukládá zprávu z axe, výkonu a izolačních testů.
- Po M11 a po betě QA vydá zprávu s tabulkou kritérií (splněno, nesplněno, riziko přijato) a rozhodnutí go/no-go.
