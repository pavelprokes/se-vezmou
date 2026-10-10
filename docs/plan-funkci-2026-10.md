# Plán funkcí podle srovnání s konkurencí (říjen 2026)

Stav k 10. 10. 2026. Navazuje na `docs/konkurence-2026-10.md` a na rozhodnutí Pavla z 9. a 10. 10. 2026. Údaje o konkurenci pocházejí z jejich webů (zdroje u bodů), čísla jsou jejich tvrzení. Rešerše zasedacího pořádku a hledání obličejů je v příloze na konci.

## Co už máme (ověřeno v kódu, smí se uvádět)

| Funkce                                         | Kde je                                                                                                 | Jak o ní mluvit                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Fotky od hostů ve stejné galerii jako fotograf | g-gallery: galerie hostů pod jednou svatební stránkou (`docs/GUEST-GALLERIES.md`), odkaz v bloku Fotky | „Hosté nahrají fotky přes QR kód do stejné galerie, kde budou i fotky od fotografa.“         |
| Živá prezentace na plátně                      | g-gallery: slideshow, nové fotky hostů se ukážou zhruba do půl minuty                                  | „Živá prezentace: nové fotky hostů se během večera samy promítají na plátně nebo televizi.“  |
| Platnost galerie                               | g-gallery: galerie sama nevyprší, časový limit nastavuje jen fotograf                                  | „Galerie zůstává online aspoň rok, déle podle přání.“                                        |
| Spolusprávci webu                              | `wedding_admins`, `max_admins` = 3, obrazovka Přístup                                                  | „Web můžete spravovat ve dvou nebo ve třech (třeba se svědkem), každý se svým e-mailem.“     |
| Ruční zápis hostů a odpovědí, export           | Odpovědi → zápis domácnosti (FR-ADM-5), export CSV a xlsx                                              | „Babičku bez internetu zapíšete ručně, seznam stáhnete do tabulky.“                          |
| Režim po svatbě                                | fáze `thanks` (`src/lib/lifecycle/phase.ts`)                                                           | „Po svatbě se web sám přepne na poděkování a odkaz na fotky; potvrzování a dary zmizí.“      |
| Mazání fotek v galerii                         | g-gallery: host smaže svou fotku, fotograf jakoukoli                                                   | Pravdivě: „Host svou fotku smaže sám, ostatní na požádání smaže fotograf.“ Ne „schvalování“. |

**Schvalování fotek před zobrazením zatím neuvádíme.** V g-gallery není (záměrně odloženo 23. 8. 2026, `docs/GUEST-GALLERIES.md` §7). Tvrdit ho by byla klamavá obchodní praktika podle zákona o ochraně spotřebitele (§ 5 zák. č. 634/1992 Sb.), proto ho v textech nahrazuje pravdivá věta o mazání fotek výše. Návrh dodělat je ve fázi 2 (je to jeden přepínač u galerie a stav fotky, datový model ho už počítá).

## Fáze 1 (hotovo v této větvi)

Migrace `20261020120000_rsvp_message_and_updates.sql`, testy `supabase/tests/89_rsvp_message_updates.test.sql`, `e2e/gallery-sign.e2e.ts`, `e2e/guest-updates.e2e.ts`.

1. **QR cedulka ke galerii v designu šablony.** Ve správě webu (blok Fotky) odkaz „Cedulka s QR kódem na stůl“ vede na `/web/cedulka`: náhled ve vzhledu šablony a PDF A4 k tisku s ořezovými značkami. Formáty: 10 × 15 cm do stojánku nebo rámečku (2 na list) a A5 ke vchodu (2 na list), barvy a dekor podle šablony a palety (stejná logika jako jmenovky), text „Přidejte své fotky“ nebo „Fotky ze svatby“, jeden nebo oba jazyky webu, pod kódem krátká adresa k opsání. Odkaz v QR nese parametry UTM (`utm_source=se-vezmou`, `utm_medium=qr-cedulka`, `utm_campaign=galerie-svatby`; kampaň je pevná, aby se jména párů nedostala do analytiky), ale jen u vlastní galerie (`photos.svatebni-fotograf-cechy.cz`); cizím galeriím adresu neměníme. UTM dostal i QR galerie v PDF oznámení (`utm_medium=qr-oznameni`) a odkaz na webu (`utm_medium=web`).
2. **Vzkaz pro novomanžele v RSVP.** Nová vestavěná otázka (do 1000 znaků), pár ji zapne v nastavení odpovědí. Vzkazy vidí ve správě (v ručním zápisu domácnosti a na přehledu odpovědí v části „Vzkazy od hostů“) a v exportu (sloupec Vzkaz). Upozornění páru e-mailem obsah vzkazu neposílá, jen že vzkaz přibyl. Vzkaz je součástí odpovědi domácnosti, takže ho při úpravě odpovědi uvidí kdokoli z domácnosti, kdo zná jméno (stejně jako přání písničky).
3. **Upozornění hostům na změnu.** Pár volbu zapne v nastavení odpovědí. Host v RSVP zaškrtne „Pošlete mi e-mail, když se u svatby něco změní“ a vyplní e-mail (povinný) a telefon (nepovinný). Uložené údaje host při úpravě odpovědi nevidí (lístek dostane každý, kdo zná jméno); prázdné pole je ponechá, odškrtnutí je smaže. Souhlas dává jen host, ruční zápis správce ho nenabízí. Pár na přehledu odpovědí vidí seznam přihlášených (jména, e-mail, telefon, jazyk) a napíše zprávu (v jazycích webu); e-mail odejde každému přihlášenému v jeho jazyce s odkazem na web a na odhlášení (`/upozorneni` na webu svatby, odhlásí až tlačítko). Nejvýš 5 rozeslání za den, odeslání se zapíše do auditu. Telefon slouží jen páru, SMS neposíláme. Údaje jsou v tabulce `rsvp_updates` a mažou se spolu s odpověďmi (retence hostů).
4. **Texty na webu** podle tabulky výše (úvodní stránka, `/pro-fotografy`, článek o fotkách od hostů).

## Fáze 2 (hotovo v této větvi jako první verze, „řekneme, že máme, a vylepšíme podle prvních párů“)

Vše v migraci `20261021120000_seating_gifts_notes.sql`, testy `supabase/tests/90_seating_gifts_notes.test.sql`, `e2e/seating.e2e.ts`, `e2e/gift-registry.e2e.ts`, `e2e/notes.e2e.ts`, přístupnost `e2e/features.a11y.ts`.

5. **Zasedací pořádek** (`/hoste/zasedaci-poradek`). Předvolby: kulaté stoly, jedna tabule (I), tvar T, tvar U (vnitřní strana ramen volitelně), hřeben (E, 2 až 5 ramen), banketní stoly 180 × 80 a hlavní stůl s kulatými. Počty stolů a míst se nastavují čísly, plánek je schematický SVG (`src/admin/seating/layout.ts`, 65 cm na osobu, ⌀ 150 pro 8 a ⌀ 180 pro 10). Usazují se osoby, které potvrdily účast na zvolené události (výchozí hostina), výběrem stolu ze seznamu u každé osoby nebo u celé domácnosti (bez tahání myší, klávesnicí), plný stůl nejde vybrat, pořadí míst šipkami. Plán se ukládá sám s hlídáním verze (dva správci). Tisk: plánek, hosté po stolech pro obsluhu a abecední seznam „kdo kde sedí“. Plán (`seating_plans`) nese jen klíče osob, ne jména; usazení se smaže s údaji hostů. Zatím chybí: číslo stolu na jmenovkách, překážky v sále (parket, bar) a volné posouvání stolů.
6. **Seznam věcných darů s rezervací** (`/dary`, odkaz i z bloku Dary v editoru). Pár přidá dar (název a popis v jazycích webu, odkaz do obchodu, orientační cena), mění pořadí, maže a uvolňuje rezervace. Host na webu v sekci Dary dar zarezervuje bez účtu (jméno nepovinné, vidí ho jen pár), ostatní vidí „zabráno“, vlastní rezervaci zruší ze stejného prohlížeče (token v cookie, v databázi jen hash). S PINem hostů je seznam až po zadání PINu (rozhoduje databáze, `gift_access`), po svatbě zmizí. Jména u rezervací se mažou s údaji hostů.
7. **Soukromé poznámky a dodavatelé** (`/poznamky`, položka „Poznámky“ v hlavní nabídce správy). Kontakty podle druhu (fotograf, video, místo, catering, dort, květiny, hudba, dekorace, šaty, účes, doprava, oddávající, ostatní) se stavem zvažujeme / osloveno / domluveno, webem, cenou a poznámkou; k tomu jeden text poznámek s hlídáním souběžné úpravy. Hostům se nezobrazují.
8. **Schvalování fotek v g-gallery** (návrh, neimplementováno): přepínač „soukromý sběr“ u galerie hostů, nové fotky čekají na schválení páru nebo fotografa. Rozhodne Pavel (mění rozhodnutí z 23. 8.).

## Fáze 3 (poznámky, nic se zatím nestaví)

- **Hledání obličejů v galerii.** Cena je zanedbatelná (AWS Rekognition zhruba 45 až 55 Kč za svatbu s 1 400 fotkami a 200 hledáními), problém je právní: biometrické údaje podle čl. 9 GDPR, indexace celé galerie vytváří šablony i lidí bez souhlasu (EDPB 3/2019, odst. 84). Pokud vůbec: jen volitelně za souhlasu páru, souhlas hostů předem v RSVP, hledání od selfie, AWS ve Frankfurtu, smazání do 30 dnů, DPIA a skutečný právník. Do té doby nabízet hledání podle času, kapitol (obřad, hostina) a autora fotky, což g-gallery částečně umí.
- **„Jednorázový foťák“** (limit snímků na hosta, zpožděné odhalení, filmový filtr): parametr galerie hostů, až bude zájem.
- **Hlasová přání:** nahrávání v prohlížeči přes stejný QR jako fotky; Pavel 10. 10.: zatím ne.
- **Rozpočet a checklist:** rozmělňují pozici „nejlepší web pro hosty“; místo nich soukromé poznámky (fáze 2) a článek s checklistem na blogu (už je).
- **Katalog dodavatelů:** ne jako katalog, jen vlastní kontakty páru (fáze 2).

## Příloha: rozměry pro zasedací pořádek (výchozí hodnoty)

Místo na osobu u tabule 65 cm (zdroje uvádějí 60 až 70 cm), kulatý stůl ⌀ 150 cm pro 8 a ⌀ 180 cm pro 10 osob (české půjčovny), banketní stůl 180 × 80 cm, odstup stolů 150 cm, ulička 90 cm. Tvar T pro 30 až 50 hostů, U pro 40 až 70, kulaté stoly od 50 hostů (vezmemese.cz, brilas.cz). Zdroje: brzy-svoji.cz/zasedaci-poradek, nfcp.cz, stuartrental.com, vezmemese.cz/m/zasedaci-poradek-na-svatbe.
