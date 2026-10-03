# Šablona Eukalyptus 2.0

Editoriální šablona webu páru: obří typografie (Newsreader 300 a kurzíva, DM Sans), plné barevné plochy,
každá sekce s vlastním rozvržením, větvičky přetékající přes okraj a jemná textura papíru. Funguje bez
fotek páru, fotka v úvodu je volitelná (`hero.data.photoMediaId`).

## Kde co je

| Soubor           | Obsah                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `index.tsx`      | vstup šablony: plochy palety jako CSS proměnné, pořadí částí, číslování, navigace, patička |
| `blocks.tsx`     | bloky (úvod, odpočet, program, místa, RSVP, dary, fotografie, volitelné bloky, patička)    |
| `parts.tsx`      | primitiva: `Sprig`, `Wreath`, `Label`, `SectionShell`, `SectionHead`, `ItalicLast`         |
| `client.tsx`     | klientské části: navigace s aktivní sekcí, ukotvené tlačítko RSVP, zavíratelný pruh změny  |
| `layout.ts`      | čistá logika: rytmus ploch (`assignTones`), velikost jmen (`fitNames`), římské číslování   |
| `eukalyptus.css` | tokeny ploch, typografie, rozvržení, přístupnost                                           |

Data a pravidla zobrazení (fáze, PIN, soukromá místa, chráněné fotografie) jsou společná pro všechny
šablony v `../../models.ts`. Formuláře RSVP a PINu, QR platba, galerie s prohlížečem a mapa jsou sdílené
komponenty z `../../`; barvy dostávají přes proměnné `--s-*`, které nastaví plocha sekce.

## Plochy a tokeny

Paleta Eukalyptu má kromě 13 rolí (`colors`, používají je průvodce a správa) i plochy (`surfaces`) se
sémantickými názvy, aby šla paleta měnit na úrovni páru:

| Plocha   | Bordó   | Kde                                            |
| -------- | ------- | ---------------------------------------------- |
| `light`  | krémová | úvod, místo konání                             |
| `paper`  | papír   | podklad stránky, fotografie, příběh, ubytování |
| `accent` | víno    | odpočet, patička                               |
| `deep`   | les     | program, kontakt                               |
| `soft`   | šalvěj  | potvrzení účasti, dress code                   |
| `dark`   | noc     | dary                                           |

Každá plocha má `bg`, `text`, `muted`, `accent`, `button`, `onButton` a `focus`. Pole mají vždy bílou výplň,
text `ink` a ohraničení `field`. V CSS je plocha jako `--eu-<plocha>-<role>`, sekce s `data-tone` z ní
nastaví `--t-*` (šablona) a `--s-*` (sdílené komponenty).

**Rytmus:** `assignTones` dá každé části preferovanou plochu. Shoduje-li se se sousedem, vezme další
z cyklu `light → accent → deep → soft → dark → paper`, která se neshoduje s předchozí ani následující.
Úvod a patička zůstávají `light` a `accent`. Test prochází všechny kombinace zapnutých bloků.

**Jména:** písmo se počítá z počtu znaků nejdelšího řádku (`fitNames`) a šířky okna, nahoře 264 px
a dole 104 px (`clamp`). Do 14 znaků jsou jména na širokém displeji v jednom řádku, jinak a na mobilu
pod sebou. Ověřené dvojice: Iva & Ota, Petra & Iva, Kristýna & Maximilián, Anna-Marie & Jan Křtitel,
Bohumila & Přemysl na 375, 768 a 1440 px bez přetečení.

## Kontrasty

Hlídá je `validateSurfaces` (`src/site/themes/validate.ts`) a test palet. Paleta s chybou nejde zveřejnit.
Text a akcent alespoň 4,5 : 1, tlačítko vůči ploše, obrys zaměření a ohraničení pole alespoň 3 : 1.

#### Bordó (`bordo`)

| Plocha | Pozadí    | Text  | Doplňkový text | Akcent | Tlačítko / plocha | Text tlačítka | Zaměření |
| ------ | --------- | ----- | -------------- | ------ | ----------------- | ------------- | -------- |
| light  | `#F4EEE4` | 12,86 | 5,66           | 8,07   | 8,07              | 8,07          | 8,07     |
| paper  | `#FBF8F2` | 14,00 | 6,16           | 8,78   | 8,78              | 8,78          | 8,78     |
| accent | `#7B2D2D` | 8,07  | 6,01           | 6,01   | 8,07              | 8,07          | 8,07     |
| deep   | `#1C3128` | 11,98 | 7,82           | 7,82   | 11,98             | 11,98         | 11,98    |
| soft   | `#DCE4D8` | 11,40 | 5,58           | 7,15   | 7,15              | 8,07          | 7,15     |
| dark   | `#141E19` | 14,80 | 9,67           | 11,02  | 14,80             | 14,80         | 14,80    |

Pole: text `#1F2A24` na bílé 14,84, ohraničení `#6B776F` na bílé 4,67.

#### Stříbrná (`stribrna`)

| Plocha | Pozadí    | Text  | Doplňkový text | Akcent | Tlačítko / plocha | Text tlačítka | Zaměření |
| ------ | --------- | ----- | -------------- | ------ | ----------------- | ------------- | -------- |
| light  | `#EEF3EF` | 12,51 | 6,95           | 8,46   | 8,46              | 8,46          | 12,51    |
| paper  | `#F8FAF8` | 13,39 | 7,44           | 6,59   | 9,06              | 9,06          | 13,39    |
| accent | `#2F4B44` | 8,46  | 5,90           | 6,79   | 8,46              | 8,46          | 8,46     |
| deep   | `#1E2F2A` | 12,51 | 8,72           | 8,72   | 12,51             | 12,51         | 12,51    |
| soft   | `#DDE7E0` | 11,09 | 6,16           | 5,46   | 7,50              | 8,46          | 11,09    |
| dark   | `#7E4E3A` | 6,35  | 4,94           | 4,94   | 6,35              | 6,35          | 6,35     |

Pole: text `#1E2F2A` na bílé 14,04, ohraničení `#5F7A6F` na bílé 4,67.

#### Hloubka (`hloubka`)

| Plocha | Pozadí    | Text  | Doplňkový text | Akcent | Tlačítko / plocha | Text tlačítka | Zaměření |
| ------ | --------- | ----- | -------------- | ------ | ----------------- | ------------- | -------- |
| light  | `#223A34` | 10,86 | 7,57           | 8,71   | 8,71              | 8,71          | 10,86    |
| paper  | `#2B4740` | 9,00  | 6,28           | 7,22   | 7,22              | 8,71          | 9,00     |
| accent | `#F0D5C3` | 10,04 | 7,21           | 4,94   | 8,71              | 8,71          | 10,04    |
| deep   | `#15241F` | 14,34 | 10,00          | 10,00  | 14,34             | 14,34         | 14,34    |
| soft   | `#BFD0C5` | 8,72  | 6,25           | 5,41   | 7,57              | 10,86         | 8,72     |
| dark   | `#0F1A16` | 15,85 | 11,06          | 12,72  | 15,85             | 15,85         | 15,85    |

Pole: text `#1E2F2A` na bílé 14,04, ohraničení `#4F675E` na bílé 6,11.

#### Pudr (`pudr`)

| Plocha | Pozadí    | Text  | Doplňkový text | Akcent | Tlačítko / plocha | Text tlačítka | Zaměření |
| ------ | --------- | ----- | -------------- | ------ | ----------------- | ------------- | -------- |
| light  | `#F4F1EC` | 12,47 | 6,47           | 5,93   | 5,93              | 5,93          | 12,47    |
| paper  | `#FBF9F6` | 13,36 | 6,93           | 6,36   | 6,36              | 6,36          | 13,36    |
| accent | `#8A4A44` | 5,93  | 4,96           | 4,96   | 5,93              | 5,93          | 5,93     |
| deep   | `#2F4B44` | 8,43  | 6,43           | 7,06   | 8,43              | 8,43          | 8,43     |
| soft   | `#EAD9D2` | 10,27 | 6,52           | 5,91   | 4,88              | 5,93          | 10,27    |
| dark   | `#2A2321` | 13,70 | 9,32           | 11,47  | 13,70             | 13,70         | 13,70    |

Pole: text `#1E2F2A` na bílé 14,04, ohraničení `#6F7F78` na bílé 4,21.

Dekor (lístky, věnec, vodoznak „Ano“, obří jména v patičce) je jen z dekorativních rolí palety
(`ornament`, `decor`, `decor2`), je `aria-hidden` a v režimu vysokého kontrastu se skryje.

## Jak přidat paletu

1. V `src/site/themes/palettes.ts` přidej do `eukalyptus.palettes` paletu s klíčem, názvem (cs, en),
   13 rolemi `colors` a plochami `surfaces` (pro každou plochu `tone(bg, text, muted, accent, button,
onButton, focus)`, k tomu `field` a `ink`).
2. Spusť `npx vitest run src/site/themes`: test spočítá všechny dvojice a nahlásí každou pod limitem.
3. Doplň paletu do tabulky kontrastů výše (skript: spočítej `contrastRatio` pro každou dvojici plochy).
4. Zkontroluj ji ve vývojovém náhledu `http://localhost:3000/site-preview?template=eukalyptus&palette=<klíč>`
   na 375, 768 a 1440 px, i s fotkou v úvodu (`&heroPhoto=1`) a ve fázi po svatbě (`&phase=thanks`).
