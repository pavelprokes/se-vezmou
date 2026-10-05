# Konkurence a rozhodnutí (říjen 2026)

Stav k 5. 10. 2026. Podklad pro fáze větve `konkurence-2026-10`. Údaje o konkurenci pocházejí z jejich webů a z vyhledávání (zdroje u bodů); čísla konkurence jsou jejich tvrzení, neověřovali jsme je. Před veřejným použitím (reklama, srovnání) je znovu ověřit.

## Shrnutí

- Web za 0 Kč nabízí většina českých portálů (Oddáni, Svatbonet, Svátbaa) i zahraniční služby (Zola, Joy, The Knot). Cena nás neodliší; **rozhodnuto: zůstáváme za 0 Kč** (`docs/todo.md`, Cena).
- Heslo na web a druhý jazyk mají i Weddee a WeMarry. Odlišuje nás provedení: každý text zvlášť v obou jazycích, IBAN, BIC a EPC QR pro hosty ze zahraničí, osobní odkaz a QR pro každou domácnost, program podle skupiny hostů, WCAG 2.2 AA.
- Mezery ve funkcích: seznam darů s rezervací, zasedací pořádek, hry a rozpočet (do `docs/todo.md`). Fotky od hostů řeší vedlejší galerie (odkaz a QR na oznámení).
- Sociální důkaz: WeMarry má počty párů, hodnocení Google a citáty; my zatím nic. Recenze jen skutečné, se souhlasem a s větou o ověření (novela zákona o ochraně spotřebitele od 6. 1. 2023).

## Zakázkové služby (podklad Pavla, 5. 10. 2026)

Ceny z podkladu, ze kterého analýza vychází (ceníky dodavatelů): jednostránka na míru od 699 Kč (K&K Code), hotový web od dodavatele 3 490 Kč (Mini) a 4 990 Kč (Plus) s dodáním do 14 dnů po předání podkladů (Svatebno), kódovaný web ze šablony od 10 500 Kč (Digitální weby); další studia (Pravá láska, Veselko, Snova svatba, Bereme se, Tomáš Bajer, Weboria) mají cenu podle poptávky. Z těchto čísel vychází rozpětí v článku `content/blog/sablona-nebo-na-miru.json`.

## Čím se prezentují české portály

| Služba     | Tvrdí                                                                                   | Heslo | Dva jazyky | Mazání dat      | Přístupnost            |
| ---------- | --------------------------------------------------------------------------------------- | ----- | ---------- | --------------- | ---------------------- |
| Oddáni     | bez reklamy, export, web 12+ měsíců po svatbě, funguje při slabém signálu               | ne    | ne         | na požádání     | velké písmo, bez normy |
| Svatebka   | vizuální editor, QR platba, zasedací pořádek, jednorázová platba                        | ne    | ne         | měsíc po svatbě | ne                     |
| Weddee     | heslo, vícejazyčný web, jmenovky, 890 / 1 190 Kč                                        | ano   | ano        | ne              | ne                     |
| WeMarry    | druhý jazyk, vrácení peněz do 30 dnů, zasedací pořádek, 1 490 Kč, 2 000+ párů (tvrzení) | ?     | ano        | ?               | ne                     |
| Brzy svoji | 10 let na trhu, 7 dní zdarma, 490 / 990 Kč                                              | ne    | ano        | ne              | ne                     |

Zdroje: oddani.cz, svatebka.cz, weddee.cz, wemarry.io/cs/svatebni-web, brzy-svoji.cz, svatbonet.cz, vezmemese.cz (stav 5. 10. 2026).

## Rozhodnutí po bodech (Pavel, 5. 10. 2026)

| Bod                               | Rozhodnutí                                                  |
| --------------------------------- | ----------------------------------------------------------- |
| „Čím se lišíme“ na úvodní stránce | přepsat na skutečně odlišující body                         |
| Reference                         | připravit místo v kódu, recenze dodá Pavel                  |
| Cena                              | zůstává 0 Kč                                                |
| Jmenovky                          | náhled ve správě podle šablony, PDF A4 s ořezovými značkami |
| Kanál přes fotografy              | ano                                                         |
| Srovnávací článek                 | ano                                                         |
| Fotky od hostů                    | máme (vedlejší galerie)                                     |
| Seznam darů, zasedací pořádek     | TODO                                                        |
| Šablony                           | čtyři nové, každá aspoň se čtyřmi paletami, WCAG 2.2 AA     |
| Vlastní doména                    | částečně (subdoména), TODO                                  |
| Hry, rozpočet                     | TODO                                                        |

## Jmenovky

- Běžné rozměry: plochá 3,5 × 2 in (89 × 51 mm), v ČR 9 × 5 cm; stojánek složený stejně velký (placecard.us/place-card-sizes, svatebni-diar.cz).
- Ořezové značky: 0,25 až 0,5 pt, odsazení 3 mm, délka 5 mm (vistaprint.com/hub/crop-marks-explained). Domácí tiskárny netisknou 3 až 5 mm od kraje.
- Papír 220 až 270 g/m² (paperlust.co).
- Konkurence: Weddee nabízí tisk jmenovek v editoru, Minted tiskne jména zdarma ke svým návrhům, Planning.wedding plní jména ze zasedacího pořádku s ořezovými značkami.
- **Rozhodnutí:** plochá 90 × 50 mm (10 na A4 na výšku) a stojánek 90 × 45 mm (rozložený 90 × 90 mm, 6 na A4, horní polovina otočená). Karty bez mezer (jeden řez na linii), bez spadávky, bílý papír, ořezové značky jen na okraji listu.

## Šablony

- ČR: převažuje minimalismus, elegance, rustikální styl a pudrová romantika; chybí tmavé večerní a art deco šablony (brzy-svoji.cz/sablony-svatebniho-webu, wemarry.io/cs/sablony-pro-svatebni-web).
- Zahraničí: stovky až tisíce návrhů včetně barevných variant (Zola, Joy, Minted).
- Trendy 2026: Pinterest „Rooted Romance“ (švestková, merlot, olivová, terakota) a „Ethereal Shimmer“ (opál, půlnoční petrolejová), netradiční místa jako jazz club (newsroom.pinterest.com/news/wedding-trend-report-2026). 2027: máslově žlutá a čokoládová (blogy, slabší zdroj).
- **Rozhodnutí:** Statek (zemité tóny), Vinice (moravské sklepy, merlot a oliva), Louka (luční pastely) a Deco (art deco, tmavá s zlatem). Každá aspoň čtyři palety ověřené `validatePalette()`.

## Kanál přes fotografy

- Affiliate programy (Zola, Joy) cílí na publikující weby; u služby za 0 Kč provize nedává smysl.
- **Rozhodnutí:** stránka pro fotografy a další dodavatele s letákem k tisku a odkazem s kódem partnera (UTM), bez provize.

## SEO

- „svatební web zdarma“: vedou srovnávací a návodové články magazínů. „svatební web na míru cena“: produktové stránky. „dvojjazyčný svatební web“: žádná stránka přímo na téma.
- **Rozhodnutí:** neutrální článek „Svatební web: šablona, nebo na míru?“ bez jmenování konkurence, s rozpětími cen místo jmen.
