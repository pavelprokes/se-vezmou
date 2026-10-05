# Brand manuál: Se vezmou (se-vezmou.cz)

> Podklad pro AI agenta (grafika, texty, reklamy, sociální sítě). Stav k 5. 10. 2026. Zdroj pravdy je kód:
> barvy `src/app/globals.css`, logo `docs/brand/` a `src/components/brand-logo.tsx`, cena `src/config/pricing.ts`,
> provozovatel `src/config/operator.ts`, texty `src/i18n/messages/*/landing.json` a `marketing.json`.
> Když se tento soubor s kódem rozchází, platí kód.

**Pozor na záměnu:** Se vezmou je samostatná značka (nástroj pro svatební weby). Má jiné logo, barvy i písma než
značka autora „Svatební fotograf Pavel Prokeš“ (svatebni-fotograf-cechy.cz). Ty dvě se nemíchají: žádné logo,
barva ani font fotografa v grafice Se vezmou a naopak.

## 1. Kdo to je

| Údaj         | Hodnota                                                                                                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Značka       | **Se vezmou**; v logu a v hlavičce se píše jako adresa **se-vezmou.cz**                                                                                                           |
| Web          | <https://se-vezmou.cz> (česky), anglicky pod `/en`. Správa pro páry `app.se-vezmou.cz`, weby párů `<jmena>.se-vezmou.cz`                                                          |
| Co to je     | Český nástroj pro tvorbu svatebního webu: program dne, místo s mapou, ubytování, dress code, časté dotazy, fotky, dary a potvrzení účasti hostů na jedné adrese, česky i anglicky |
| Pro koho     | Snoubenci v Česku (a jejich hosté, včetně zahraničních)                                                                                                                           |
| Šablony      | Čtyři: Editorial, Eukalyptus, Chateau, Modern, každá s několika paletami                                                                                                          |
| Cena         | **Teď 0 Kč** za tvorbu i zveřejnění; případnou změnu ceny provozovatel oznámí předem                                                                                              |
| Provozovatel | Pavel Prokeš, IČO 87877601, Křižíkova 424/127, Praha 8 (za službou stojí svatební fotograf Pavel Prokeš)                                                                          |
| Kontakt      | info@se-vezmou.cz (jediný veřejný kontakt; osobní adresy autora se neuvádějí)                                                                                                     |
| Profily      | Zatím žádné. Až vzniknou, přidávají se do `profiles` v `src/config/operator.ts`                                                                                                   |

Hlavní sdělení (úvodní stránka): _„Vaše svatba. Všechno důležité na jednom místě.“_ Podtitul: _„Program, místo,
potvrzení účasti i praktické informace pro hosty. Vyberte ze čtyř šablon a web složíte za jeden večer.“_
Nadtitulek: _„Svatební web česky i anglicky“_. Výzva k akci: **Vytvořit web**, druhá **Prohlédnout ukázku**.

Přednosti, které web uvádí: bez účtu pro hosty · skrytý před vyhledávači · úpravy z mobilu i počítače · teď za 0 Kč.

## 2. Logo

Varianta A „dva prsteny“: dva propojené kroužky (levý borovicově zelený, pravý skořicový) s vyplněným průnikem
v pudrové broskvové, vedle název **se-vezmou.cz** bezpatkovým tučným písmem (DM Sans), `.cz` ve skořicové barvě.
V SVG souborech je text převedený na křivky, fonty nepotřebují.

### Soubory

Ke stažení na `https://se-vezmou.cz/brand/<soubor>` (zdroj v repu `docs/brand/`, kopie v `public/brand/`):

| Soubor                                 | Co to je                         | Kdy použít                                                    |
| -------------------------------------- | -------------------------------- | ------------------------------------------------------------- |
| `logo-a-prsteny.svg` (624 × 170)       | Plné logo: symbol + se-vezmou.cz | **Hlavní logo.** Světlé pozadí, dokumenty, cokoli vektorového |
| `logo-a-prsteny-tmave.svg` (624 × 170) | Totéž ve světlých barvách        | Tmavé pozadí (navrženo na `#1b2a23`)                          |
| `logo-a-prsteny-mono.svg` (624 × 170)  | Jedna barva (inkoust `#1b2a23`)  | Tisk, razítko, jednobarevné použití                           |
| `symbol-a.svg` (160 × 160)             | Jen symbol (dva prsteny)         | Avatar, profilovka na sítích, vodoznak                        |
| `favicon-a.svg` (64 × 64)              | Zjednodušený symbol              | Velikosti 16–48 px                                            |

Hotové rastry na webu:

| Adresa                                                   | Rozměr     | Použití                                                                           |
| -------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------- |
| `https://se-vezmou.cz/icons/icon-512.png`                | 512 × 512  | Profilovka, `logo` ve strukturovaných datech                                      |
| `https://se-vezmou.cz/icons/icon-192.png`                | 192 × 192  | Malá ikona                                                                        |
| `https://se-vezmou.cz/icons/icon-maskable-512.png`       | 512 × 512  | Android (s ochrannou zónou)                                                       |
| `https://se-vezmou.cz/apple-icon.png`                    | 180 × 180  | iOS                                                                               |
| `https://se-vezmou.cz/icon.svg`, `/favicon.ico`          |            | Favicon                                                                           |
| `https://se-vezmou.cz/og/se-vezmou-cs.png` (a `-en.png`) | 1200 × 630 | Obrázek pro sdílení odkazu (náhled webu páru Klára a Matěj)                       |
| `https://se-vezmou.cz/templates/<sablona>.webp`          |            | Náhledy šablon: `editorial`, `eucalyptus`, `chateau`, `modern` (anglicky s `-en`) |

Ikony a OG obrázky se generují skripty `node scripts/generate-icons.mjs` a `node scripts/generate-og.mjs`;
ručně se neupravují.

### Pravidla loga

- Na světlém pozadí plné logo, na tmavém varianta `-tmave`, jednobarevně varianta `-mono`.
- Minimální šířka: plné logo 80 px, symbol 24 px, favicon 16 px (v tisku 6 mm).
- Ochranná zóna kolem loga: čtvrtina jeho šířky.
- Nenatahovat, nepřebarvovat, nepřidávat stíny ani efekty, nedávat na rušivé pozadí (přes fotku jen na klidnou plochu).
- Název nepřepisovat jiným písmem a nepsat „Se Vezmou“ ani „SeVezmou“. V logu `se-vezmou.cz`, v textu „Se vezmou“.

### Barvy loga

| Barva           | Hex                                        | Kde                                     |
| --------------- | ------------------------------------------ | --------------------------------------- |
| Borovice        | `#365c4e`                                  | levý prsten                             |
| Skořice         | `#8e503c`                                  | pravý prsten, `.cz`                     |
| Pudrová broskev | `#dca790`                                  | výplň průniku prstenů (jen v symbolu)   |
| Inkoust         | `#1b2a23`                                  | text „se-vezmou“                        |
| Tmavá varianta  | `#b6cbbf`, `#e0957c`, `#7a5546`, `#f7f4ed` | prsteny, průnik a text na tmavém pozadí |

## 3. Barevná paleta (web značky a správa)

Světlý, teplý vzhled na pergamenovém podkladu. **Jen plné plochy:** žádné přechody, stíny ani průhledné vrstvy
pod textem. Tmavý režim web nemá. Kontrasty hlídá test (`src/design/contrast.test.ts`, WCAG 2.2 AA).

| Role           | Název tokenu  | Hex                                  | Použití                               | Kontrast na pergamenu            |
| -------------- | ------------- | ------------------------------------ | ------------------------------------- | -------------------------------- |
| Pozadí         | parchment     | `#f7f4ed`                            | stránka, text na tlačítku             |                                  |
| Teplá plocha   | warm          | `#efebe1`                            | tipy, zvýrazněné bloky                |                                  |
| Text a nadpisy | ink           | `#1b2a23`                            | hlavní text, hover tlačítka           | 13,6 : 1                         |
| Primární       | pine          | `#365c4e`                            | tlačítka, odkazy, focus               | 6,8 : 1 (pergamen na ní 6,8 : 1) |
| Akcent         | cinnamon-deep | `#8e503c`                            | nadtitulky, zvýrazněný text, `.cz`    | 5,7 : 1                          |
| Akcent dekor   | cinnamon      | `#b66d55`                            | jen rámečky a plochy, **nikdy text**  | 3,6 : 1                          |
| Jemná plocha   | linen         | `#d9e1d7`                            | hover, aktivní položka nabídky        |                                  |
| Tlumený text   | muted         | `rgba(27, 42, 35, 0.78)` ≈ `#4b564f` | popisky, meta                         | 7,0 : 1                          |
| Rámeček pole   | field-border  | `#7a847f`                            | okraj formulářových polí              | 3,5 : 1                          |
| Linka          | hairline      | `rgba(54, 92, 78, 0.22)`             | dekorativní oddělovače a okraje karet |                                  |

Tlačítka: primární = plná borovice s pergamenovým textem (hover inkoust), sekundární = obrys borovice na
průhledném pozadí (hover linen).

Zakázáno: text v barvě `cinnamon`, `hairline` nebo `field-border`, text pod kontrastem 4,5 : 1, přechody a stíny
pod textem.

Šablony webů párů mají **vlastní palety** (`src/site/themes/palettes.ts`) a nejsou barvami značky:
Editorial (Papír, Kámen, Půlnoc), Eukalyptus (Bordó, Stříbrná, Hloubka, Pudr), Chateau (Champagne, Slonová kost,
Noc), Modern (Slunce, Kobalt, Limeta). Do grafiky značky je nepřenášet; ukazovat je jen jako náhled šablony.

## 4. Typografie

- **DM Sans** (Google Fonts, latin + latin-ext): základní text, tlačítka, rozhraní, slovo v logu.
- **Newsreader** (Google Fonts, i kurzíva): nadpisy ve správě a v průvodci, šablony webů párů.
- **Fraunces** (Google Fonts, i kurzíva, optická velikost): velké nadpisy úvodního webu se-vezmou.cz.
- Řádkování textu 1,6, nadpisy 1,15. Nadtitulky verzálkami, tučně, s prostrkáním (`tracking-widest`) v barvě
  cinnamon-deep.
- Pro grafiku mimo web (Canva, reklamy): nadpis Fraunces, text DM Sans.

## 5. Vizuální styl

- Klidný, editoriální, hodně vzduchu. Plné barevné plochy, tenké linky (hairline), karty se zaoblením 16 px,
  tlačítka 10 px.
- Ovládací prvky mají cíl dotyku aspoň 44 px a viditelný obrys zaměření (3 px). Přístupnost WCAG 2.2 AA je
  podmínka, ne doplněk.
- Ikony: Lucide (tenké linkové). **Žádná emoji jako ikony.**
- Obrázky značky ukazují **ukázkové weby párů** (náhledy šablon, telefon s webem), ne fotobanku. Ukázkový pár je
  vždy **Klára a Matěj** (s nikým jiným, žádné skutečné páry bez souhlasu).

## 6. Tón a texty

- Česky (a anglicky), **vykání** („Vytvořte si web“, „Vyberte šablonu“). Klidné, praktické, konkrétní: co pár
  získá a kolik práce to dá. Bez superlativů a svatebního kýče.
- Cena: **„0 Kč“, „teď za 0 Kč“.** Slovo **„zdarma“ nepoužívat** (reklamy a SEO), nikdy „zdarma navždy“ a veřejně
  nemluvit o „zaváděcím provozu“.
- Česká typografie: uvozovky „takto“, nezlomitelné mezery po jednopísmenných předložkách, datum „10. dubna 2027“.
  Ampersand („Klára & Matěj“) jen jako grafický prvek v šablonách, v běžném textu „a“.
- **Nic nevymýšlet:** žádné recenze, hodnocení, počty párů ani citace zákazníků. Právní a finanční texty jsou jen
  podklad pro Pavla.

### Ověřená fakta (pro texty a reklamy)

- Web složíte za jeden večer, průvodce začíná jen jmény a datem.
- Čtyři šablony, česky i anglicky (hosté si přepnou jazyk).
- Hosté potvrdí účast přímo na webu, bez registrace a bez aplikace.
- Weby párů se neindexují ve vyhledávačích. Citlivé údaje (číslo účtu, soukromé místo, fotky) jdou schovat za PIN.
- Úpravy z mobilu i počítače, změny se zveřejní jedním tlačítkem.
- Cena teď 0 Kč za tvorbu i zveřejnění, včetně všech šablon a potvrzení účasti.
- Ke každému balíčku svatebního fotografa Pavla Prokeše je web na se-vezmou.cz zdarma na 12 měsíců po svatbě
  (to je nabídka fotografa, v textech Se vezmou se tak neformuluje).

Připravené popisy profilů (krátký i dlouhý, cs i en) jsou v `docs/seo-nastroje.md`.

## 7. Co neexistuje (neptej se po tom, nevymýšlej)

- Profily na sociálních sítích a recenze (zatím).
- Placený tarif a ceník (zatím jen 0 Kč).
- Tmavý režim webu.
- Maskot, slogan mimo texty výše, vlastní fotobanka.
