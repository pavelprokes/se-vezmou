# ADR 0009: Platby po zaváděcím provozu (návrh bez implementace)

Stav: návrh k pozdějšímu rozhodnutí. **Neimplementuje se v MVP ani ve fázi 3.** Platby patří do fáze 4.

## Kontext

Zaváděcí provoz je zdarma (tvorba i zveřejnění), ne trvale. Cena po skončení je otevřená otázka majitele, podmínky doplní majitel (`[PODMÍNKY]`). Texty nikdy neslibují „zdarma navždy“. Stav zakázky „čeká na platbu“ existuje v modelu (FR-OPS-2), ale platby v provozní administraci až po rozhodnutí o bráně (FR-OPS-6). Provozovatel je `[PROVOZOVATEL, IČO]`, plátcovství DPH je neznámé `[OTÁZKA]`.

Co připravit už v MVP bez implementace platby: stav „čeká na platbu“, pole konec provozu u zakázky, místo v modelu pro odkaz na platbu, nikdy neukládat údaje o kartě (řeší výhradně brána).

## Možnosti

Uvedené vlastnosti vychází z obecně známého zaměření produktů. **Poplatky, podporované metody a podmínky před rozhodnutím ověřit u poskytovatelů**, v tomto dokumentu je neuvádíme.

| Možnost    | Pro                                                                                                                             | Proti                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Stripe  | Mezinárodní, karty, Apple Pay a Google Pay, dobré API a webhooky, Checkout bez vlastních formulářů, nástroje pro daňové doklady | Podporu českých bankovních převodů a lokálních metod ověřit. Cizí zpracovatel (podmínky a umístění dat ověřit), případné rozdíly v české fakturaci |
| B. GoPay   | Česká brána, české platební metody včetně bankovních tlačítek a QR                                                              | API a vývojářský zážitek ověřit, smluvní proces a schválení obchodníka, menší mezinárodní využití                                                  |
| C. Comgate | Česká brána, české metody, často využívaná u e-shopů                                                                            | Obdobně jako B: smlouva, schválení, kvalita API ověřit                                                                                             |

### Kritéria porovnání (vyplnit při rozhodování)

Metody a poplatky; měsíční a pevné poplatky; doba výplaty; EU umístění a DPA; podpora opakovaných plateb (pokud bude předplatné); stornování a vratky; testovací prostředí; kvalita webhooků a idempotence; dokumentace v češtině; doba schválení obchodníka; export dokladů pro účetní.

## Doporučení

**Návrh: jednorázová platba za web (ne předplatné), přes bránu s českými metodami a kartami.** Konkrétní volba po ověření kritérií, podle dnešní znalosti **předběžně Stripe (A)** pro vývojářskou jednoduchost a pokrytí zahraničních párů (zadání počítá s angličtinou a zahraničními svatbami), s **GoPay nebo Comgate (B, C) jako zvažovanou českou alternativou**, pokud průzkum ukáže, že čeští klienti (persona Tereza Jandová) preferují bankovní platby, nebo pokud lokální poplatky vyjdou lépe. Rozhodnutí nepadne bez ověření ceníku `[OTÁZKA]`. Jde o předběžný názor, ne závazek.

## DPH, faktury a účetnictví

- Zda je provozovatel plátce DPH, určí majitel s účetní `[OTÁZKA]`. Od toho se odvíjí zobrazená cena (s DPH či bez), sazba a doklady. U neplátce se na dokladu uvede příslušná poznámka.
- Každá platba musí vést ke **dokladu (faktuře nebo dokladu o platbě)** s identifikací provozovatele, zákazníka, popisem služby a datem. Číselná řada a archivace doložit podle českých předpisů, ověří účetní.
- Prodej zákazníkům v EU (cizí země): pravidla místa plnění a případný režim OSS `[OTÁZKA]` pro účetní. Neřešit sami.
- Spotřebitelé: informační povinnosti před koupí, právo odstoupit u digitálního obsahu a jeho výjimky, reklamace, podmínky pro stornování `[OTÁZKA]` pro právníka. Podmínky musí být před spuštěním plateb schválené (brána C a fáze 4).
- Doklady a údaje o platbě mají vlastní zákonnou retenci, která se **střetává s mazáním dat**. Proto oddělit fakturační data od dat svatby: smazání webu nemaže doklady. Lhůty `[LHŮTY]` (určí účetní a právník, neuvádíme číslo).

## Rizika

- **Spor o vrácení platby** a stornování po vytvoření webu. Mitigace: jasné podmínky, jasná cena před zaplacením.
- **Podvodné platby** a zneužití zkoušení karet. Mitigace: Checkout brány (formulář mimo naši aplikaci), omezení počtu požadavků (ADR 0010).
- **Webhooky:** ověřovat podpis a zpracovat idempotentně, jinak hrozí dvojí aktivace nebo neaktivace webu.
- **Závislost na jedné bráně.** Mitigace: tenká vrstva `payments` s rozhraním vytvořit platbu, ověřit stav, zpracovat událost.
- **Změna chování ceny:** páry z zaváděcího provozu očekávaly „zdarma“. Mitigace: texty od začátku sdělují, že jde o zaváděcí provoz, oznámení předem před koncem, dostatečná lhůta a export dat.
- **Právní kvalifikace** nahrávání dat po nezaplacení (kdy web přepnout do archivu, kdy smazat). Lhůta `[LHŮTY]`.

## Důsledky

- **Cena:** poplatky bran a čas na účetní procesy se ověří před rozhodnutím. Pevné náklady v MVP nulové (nic se neimplementuje).
- **Bezpečnost:** karetní údaje nikdy nepřicházejí na naše servery, klíče brány a podpisy webhooků jsou tajné hodnoty (viz `docs/security-privacy.md`). Operátor vidí stav platby, ne údaje o kartě.
- **Údržba:** nová integrace se sledováním webhooků, odsouhlasení plateb a dokladů. Je třeba přidat testy zpracování webhooků a scénáře vrácení.
