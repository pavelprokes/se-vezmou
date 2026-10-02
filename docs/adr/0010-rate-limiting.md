# ADR 0010: Omezení počtu požadavků

Stav: navrženo (čeká na schválení majitele). Hodnoty v tabulce jsou **výchozí návrh k ladění po betě**, nejde o změřená čísla.

## Kontext

Zadání vyžaduje omezení počtu požadavků u přihlášení, RSVP, kontroly adres a PINů, podle adresy (e-mailu) i podle IP, a žádné prozrazení existence adresy, e-mailu nebo účtu. Aplikace běží na Vercelu (funkce bez sdíleného paměťového stavu mezi instancemi), proto počítadla musí být ve sdíleném úložišti. Databáze (PostgreSQL) už je v architektuře.

## Možnosti

| Možnost                                       | Pro                                                                                               | Proti                                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| A. Čítače v Postgresu s RPC (atomická funkce) | Žádná nová služba ani další DPA, jedno místo zálohy a retence, transakční atomicita, snadné testy | Zátěž databáze při útoku, vyšší latence než v paměti, nutný úklid starých řádků                          |
| B. Upstash Redis (+ knihovna pro omezení)     | Rychlé, vhodné pro velký objem, hotové algoritmy                                                  | Další dodavatel a služba, další DPA a umístění dat ověřit, další tajná hodnota, závislost na dostupnosti |

## Rozhodnutí (doporučení)

Zvolit **A: čítače v Postgresu přes RPC**. Při prokázané zátěži (měřeno v betě) umožnit přechod na B za stejným rozhraním `rateLimit(key, rule)`.

### Návrh mechanismu

- Tabulka `rate_limits` (viz `docs/data-model.md`): klíč (hash), pravidlo, okno (začátek), počet, čas pauzy do. Klíč je **HMAC** (tajná hodnota) z identifikátoru: IP, e-mailu, slugu nebo identifikátoru hosta. V databázi tedy nejsou surové IP ani e-maily.
- Funkce `rate_limit_hit(key, rule, limit, window)` (RPC `SECURITY DEFINER`, volaná jen ze serveru) atomicky zvýší čítač a vrátí povoleno/zakázáno a dobu do dalšího pokusu. Pevné nebo klouzavé okno (doporučení: pevné okno pro jednoduchost, ověřit v testu).
- Úklid starých řádků pravidelnou úlohou (retence čítačů krátká, řádově dny `[LHŮTY]`).
- **IP:** brát z důvěryhodné hlavičky Vercelu (ověřit aktuální dokumentaci), nikdy z hlavičky, kterou může klient podvrhnout. Za sdílenou IP (mobilní síť, kancelář) limity IP volit tak, aby nepostihly poctivé hosty na jedné svatbě (hosté sedí v jednom sále na stejné Wi-Fi), proto u RSVP kombinovat IP a slug a limit IP volit volněji.
- **Odpovědi bez prozrazení:** stejný tvar, text a (zhruba) čas odpovědi bez ohledu na to, zda e-mail, slug nebo host existuje. Při překročení limitu obecná zpráva „Zkuste to znovu později“ a hlavička `Retry-After`, bez zmínky, který klíč byl překročen. Čítače se zvyšují i pro neexistující klíče. Výjimka: kontrola slugu (viz tabulka) musí odpovědět dostupnost, proto je přísná a jen informativní (FR-WZ-4).
- Selhání úložiště omezení: **přihlášení a PIN selžou zavřeně** (odmítnout), RSVP selže otevřeně s přísnější obranou jinde (skrytá past) `[OTÁZKA]` pro majitele.

### Tabulka limitů (výchozí návrh)

| Akce                                 | Klíč                     | Limit (návrh)                                                                | Okno                                                     | Při překročení                                                   |
| ------------------------------------ | ------------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------- |
| Vyžádání přihlašovacího kódu správce | e-mail                   | 5 požadavků                                                                  | 1 hodina                                                 | stejná odpověď, kód se neposílá                                  |
| Vyžádání přihlašovacího kódu správce | IP                       | 20 požadavků                                                                 | 1 hodina                                                 | obecná odpověď, pauza                                            |
| Ověření kódu správce                 | e-mail + kód             | 5 chybných pokusů, pak zneplatnění kódu                                      | do platnosti kódu (10 min)                               | nový kód, počítá se do limitu výše                               |
| Ověření kódu správce                 | IP                       | 30 pokusů                                                                    | 1 hodina                                                 | pauza                                                            |
| PIN správy                           | svatba                   | 5 chyb, pak pauza 15 min, každá další série zdvojnásobí (30, 60, 120 min...) | do úspěchu, čítač série se nuluje po úspěšném přihlášení | pauza, oznámení na záložní e-mail                                |
| PIN správy                           | IP                       | 20 chyb                                                                      | 1 hodina                                                 | pauza                                                            |
| PIN hostů                            | svatba + IP              | 5 chyb, pak pauza jako u PINu správy                                         | do úspěchu                                               | pauza jen pro tuto IP, ostatní hosté nejsou postiženi `[OTÁZKA]` |
| PIN hostů                            | svatba (součet všech IP) | 50 chyb                                                                      | 1 hodina                                                 | upozornění páru, zpomalení                                       |
| RSVP odeslání                        | slug + IP                | 10 odeslání                                                                  | 1 hodina                                                 | obecná zpráva, skrytá past navíc                                 |
| RSVP odeslání                        | slug                     | 200 odeslání                                                                 | 1 hodina                                                 | přísnější ověřování, upozornění `[OTÁZKA]`                       |
| RSVP slepé porovnání jména           | slug + IP                | 15 pokusů                                                                    | 1 hodina                                                 | stejná odpověď jako při neshodě                                  |
| Kontrola dostupnosti slugu           | IP                       | 30 dotazů                                                                    | 10 minut                                                 | obecná zpráva, bez údaje o dostupnosti                           |
| Kontrola dostupnosti slugu           | relace/koncept           | 20 dotazů                                                                    | 10 minut                                                 | totéž                                                            |
| Zápis TOTP / kód operátora           | e-mail operátora         | 5 chyb                                                                       | 15 minut                                                 | pauza dle ADR 0008                                               |
| Ověření TOTP                         | IP                       | 20 pokusů                                                                    | 1 hodina                                                 | pauza                                                            |
| Nahrání fotografie                   | svatba                   | `[OTÁZKA]`                                                                   | `[OTÁZKA]`                                               | odmítnutí                                                        |
| Zápis analytické události            | IP                       | `[OTÁZKA]`                                                                   | `[OTÁZKA]`                                               | tichá ztráta události                                            |
| Webhook SNS (e-maily)                | zdroj                    | podpis ověřen, jinak zahodit                                                 | n/a                                                      | 4xx                                                              |

Pauza po chybách PINu: **zdvojnásobující se, s horní hranicí** (např. 24 hodin, `[OTÁZKA]` pro majitele), aby útočník nemohl trvale zamknout web správci, kterému chtějí uškodit. Správce se v takovém případě dostane dovnitř kódem z e-mailu (nezávislá cesta).

Limity jsou **konfigurace v jednom souboru**, ne rozseté konstanty. Hodnoty se po betě upraví podle skutečného provozu.

## Důsledky

- **Cena:** žádný nový dodavatel, vedlejší zátěž databáze. Při útoku může stoupnout zátěž, proto je limit IP na první čáře (ideálně už před voláním databáze nějaká hrubá ochrana platformy `[OTÁZKA]` ověřit, co nabízí Vercel v aktuálním tarifu).
- **Bezpečnost:** HMAC klíčů chrání osobní údaje v tabulce. Stejné odpovědi brání výčtu e-mailů, slugů a hostů. Riziko zamknutí poctivých uživatelů (sdílená IP) je řešeno kombinací klíčů a nezávislou cestou přihlášení.
- **Údržba:** úklidová úloha, testy (jednotkové a E2E, včetně souběžných požadavků kvůli atomicitě), ladění hodnot po betě. Přechod na Upstash (B) je možný za rozhraním bez zásahu do aplikační logiky.
