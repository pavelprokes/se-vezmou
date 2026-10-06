# Bezpečnost a soukromí

Stav: návrh k schválení. Právní části ověří skutečný právník (role JUDr. Alena Vaňková je fiktivní). Číselné hodnoty jsou výchozí návrh, pokud není psáno jinak. Související ADR: 0005 (e-mail), 0006 (fotografie), 0007 (analytika), 0008 (operátoři), 0009 (platby), 0010 (omezení požadavků), 0011 (vyhrazené schéma a přímé spojení s databází), 0012 (přihlášení operátorů bez Supabase Auth). Ukázková jména: Klára a Matěj.

## 1. Přihlášení, kódy, PIN a relace

### 1.1 Správce webu

- **Jednorázový kód z e-mailu:** šest číslic nebo odkaz, platnost 10 minut, použitelný jednou. Kód se v databázi ukládá jen jako hash, ne čitelně. Nový kód zneplatní předchozí. Pole kódu jde vložit ze schránky, má `autocomplete="one-time-code"`, žádný obrázek ani hádanka (WCAG 3.3.8).
- **Až N adres:** výchozí N = 3, strop 5 (hodnota N k potvrzení majitelem). Přidání a odebrání potvrzuje přihlášený správce, ostatní dostanou oznámení. Poslední správce se odebrat nemůže.
- **Žádné prozrazení:** odpověď na žádost o kód je stejná pro známý i neznámý e-mail (ADR 0010).
- **Záložní e-mail** je povinný i v režimu PIN. Každé přihlášení PINem se na něj oznámí.

### 1.2 PIN správy a PIN hostů

- **Dvě oddělené hodnoty** s oddělenými hashi, čítači a pauzami. Stejná hodnota pro obě role se odmítne při nastavení (porovnání se provádí při zadání nového PINu proti hashi druhého PINu). PIN hostů odemyká jen bloky označené jako citlivé a nikdy ne správu.
- **Délka:** nejméně šest číslic. Zakázat triviální hodnoty (`000000`, `123456`, opakování, datum svatby, kterou pár zadal) `[OTÁZKA]` zda zákaz data svatby, protože tištěné PINy se generují. Systém může PIN hostů vygenerovat náhodně.
- **Hash:** **argon2id** (knihovna s předkompilovaným binárním balíčkem pro Node na Vercelu, například `@node-rs/argon2`, ověřit kompatibilitu před výběrem), unikátní sůl, parametry podle aktuálního doporučení OWASP a měření na cílovém prostředí. K tomu **pepper**: tajná hodnota mimo databázi, kterou se PIN před hashováním zpracuje (HMAC). Odůvodnění: argon2id je současné doporučené volba pro hesla, odolná proti paměťově náročným útokům. scrypt (vestavěný v `node:crypto`, bez závislosti) je přijatelný záložní kandidát, pokud by nativní modul na Vercelu dělal potíže. **Upřímné omezení:** šestimístný PIN má jen milion hodnot, takže při úniku databáze se dá hrubou silou odhalit rychle, ať je hash jakýkoli. Skutečnou ochranou je omezení pokusů (ADR 0010) a pepper mimo databázi. Proto PIN nikdy nestačí pro operátory.
- **Chybné pokusy:** 5 chyb vede k pauze 15 minut, každá další série pauzu zdvojnásobí (30, 60, 120 min a dál, **implementovaný strop je 24 hodin**, `src/auth/config.ts`). Po úspěchu se čítač nuluje. Počítá se podle svatby a podle IP. Pauza PINu správy nezablokuje přihlášení kódem z e-mailu (nezávislá cesta).
- **Změna PINu** vyžaduje přihlášenou relaci správce a oznámí se na záložní e-mail. Při podezření (série chyb) se správce upozorní.

### 1.3 Relace

- **Neprůhledný token:** náhodný, dostatečně dlouhý z kryptograficky bezpečného generátoru, bez významu a bez údajů uvnitř (žádný JWT s údaji). V databázi je uložen jen **hash tokenu**. Záznam relace: svatba nebo operátor, role, vznik, poslední aktivita, absolutní vypršení, úroveň ověření (u operátora AAL1/AAL2), hrubý popis zařízení bez IP v čitelné podobě.
- **Cookie:** název s prefixem **`__Host-`** (vynucuje `Secure`, `Path=/` a **bez atributu `Domain`**), `HttpOnly`, `Secure`, `SameSite=Lax` (správa) nebo `Strict` kde to tok dovolí. Cookie tedy platí jen pro konkrétního hostitele. **Žádná cookie pro celou doménu `se-vezmou.cz`**, takže web jednoho páru nikdy nevidí relaci správy ani jiného webu.
- **Doby:**

| Role         | Nečinnost | Absolutně |
| ------------ | --------- | --------- |
| Správce webu | 14 dní    | 60 dní    |
| Operátor     | 30 minut  | 8 hodin   |

- Obnova tokenu při přihlášení (zabránění fixaci relace). Odhlášení smaže záznam na serveru. Změna PINu nebo odebrání správce zruší jeho relace. U operátora zrušení všech relací po obnově druhého faktoru.
- **Relace hosta** pro PIN hostů: cookie `__Host-sv_guest` jen na hostiteli webu páru, jen pro odemčení citlivých bloků (číslo účtu, QR platba, adresa soukromého místa), nikdy správy. Nečinnost 6 hodin, absolutně 2 dny (`[OTÁZKA]` OQ-41). Odvolá ji změna PINu hostů.
- **Lístek RSVP** (slepé ověření jména): cookie `__Host-sv_rsvp`, host-only, `HttpOnly`, 30 minut jako lístek v databázi, neprodlužuje se; host se kdykoli může ověřit jménem znovu a tlačítko „Zadat jiné jméno“ cookie smaže (sdílené zařízení). Lístek nikdy není v adrese ani ve formuláři.
- **Osobní odkaz domácnosti** (`/p/<kód>`, QR na pozvánce): kód (80 bitů, unikátní ve svatbě, vidí ho jen správce a domácnost) se uloží do cookie `__Host-sv_invite` (180 dní) a dává stejná práva jako ověření jménem (formulář domácnosti bez zdravotních údajů a e-mailu, program podle pozvání). Zobrazení stránky nic nezapisuje, lístek se z kódu vydá až při odeslání. Ověření jména a „Zadat jiné jméno“ kód zapomenou; správce kód vymění a starý odkaz přestane platit. Kód se v Sentry nahrazuje `/p/:code`.
- **Heslo na celý web** (`weddings.site_locked`, jen se zapnutým PINem hostů): `get_public_site` vydá roli `visitor` místo obsahu jen bránu (jména páru, jazyky, šablona a paleta), takže se obsah nedostane do HTML ani RSC. Projde host po PINu (relace hosta) a host s osobním odkazem: odkaz na zamčeném webu vydá relaci hosta stejně jako PIN (kód má stejnou sílu jako PIN na pozvánce), a tím i citlivé bloky. Správce a PDF oznámení čtou web s právy správce. Fotografie (`get_public_media`, `public_media_ids`) mají stejný obal se zámkem. Server Actions RSVP na zamčeném webu bez relace hosta nic neobslouží (akce jde poslat i mimo stránku). Relací z osobního odkazu je nejvýš 30 za hodinu na web a IP. Odkaz na náhled konceptu zámek obchází (ukazuje rozpracovaný obsah komukoli s odkazem); je to přijaté, odkaz je tajný a pár ho může vyměnit.
- Vázání na IP se **nepoužívá** (mobilní sítě mění IP), jen hrubé upozornění na změnu zařízení u správce.

### 1.3a Ochrana před roboty

- **Cloudflare Turnstile** v režimu „interaction-only“ (běžný člověk nic nevyplňuje) před odesláním kódu při prvním uložení v průvodci (zakládání konceptů) a na čekací listině. Token ověřuje server (`src/lib/turnstile.ts`, siteverify); neplatný nebo chybějící token = odmítnutí. Výpadek Cloudflare formulář nezablokuje (selže otevřeně), dál platí limity a ověření e-mailem. Bez klíčů (vývoj, testy) vypnuté. Turnstile je dílčí zpracovatel (IP adresa a signály prohlížeče), uvést v zásadách.
- **Další vrstvy:** ověření e-mailu kódem před vznikem konceptu, nejvýš 10 konceptů za den z jedné IP, úklid opuštěných konceptů po 14 dnech, potvrzení čekací listiny e-mailem, limity a skrytá pole u RSVP, pauzy u PINu, žádné vlastní HTML na webech párů a blokace webu provozovatelem.

### 1.4 Seznam cookies

Všechny cookies jsou jen pro konkrétního hostitele (bez atributu `Domain`), `Path=/`, `SameSite=Lax` a mimo `localhost` `Secure`. Názvy relací mají v ostrém provozu prefix `__Host-` (`src/auth/cookie.ts`).

| Cookie                     | Hostitel                         | Účel                                                          | Platnost                       | Druh                 |
| -------------------------- | -------------------------------- | ------------------------------------------------------------- | ------------------------------ | -------------------- |
| `__Host-sv_admin`          | `app.`                           | relace správce (neprůhledný token, v databázi jen hash)       | podle relace (14 dní / 60 dní) | nezbytná, `HttpOnly` |
| `__Host-sv_login`          | `app.`                           | rozpracované přihlášení kódem (zapečetěný e-mail)             | do vypršení kódu               | nezbytná, `HttpOnly` |
| `__Host-sv_wizard`         | `app.`                           | ověřování e-mailu při prvním uložení v průvodci               | do vypršení kódu               | nezbytná, `HttpOnly` |
| `__Host-sv_guest`          | web páru                         | relace hosta po PINu (odemčené citlivé bloky)                 | 6 hodin nečinnosti / 2 dny     | nezbytná, `HttpOnly` |
| `__Host-sv_rsvp`           | web páru                         | lístek RSVP po ověření jména                                  | 30 minut                       | nezbytná, `HttpOnly` |
| `__Host-sv_invite`         | web páru                         | kód osobního odkazu domácnosti (`/p/<kód>`)                   | 180 dní                        | nezbytná, `HttpOnly` |
| `__Host-sv_operator`       | `admin.`                         | relace operátora                                              | 30 minut nečinnosti / 8 hodin  | nezbytná, `HttpOnly` |
| `__Host-sv_operator_login` | `admin.`                         | rozpracované přihlášení operátora kódem                       | do vypršení kódu               | nezbytná, `HttpOnly` |
| `NEXT_LOCALE`              | úvodní stránka, `app.`, `admin.` | zvolený jazyk rozhraní (jen kód jazyka, např. `cs`), ADR 0013 | 1 rok                          | funkční, `HttpOnly`  |

`NEXT_LOCALE` zapisuje jen proxy (`src/proxy.ts`), a to **jen při výslovném přepnutí jazyka** (klik na jiný jazyk, než je dosavadní preference), nikdy při běžné návštěvě. Neobsahuje osobní údaje ani identifikátor, slouží jen k tomu, aby volba jazyka platila i při dalším vstupu; na webech párů se nezapisuje. Jde o funkční cookie na žádost uživatele (zapamatování volby), posouzení souhlasové lišty viz kap. 5.5 `[OTÁZKA]`.

## 2. CSRF

- Cookies `SameSite` jsou první vrstva, ne jediná.
- Všechny zápisy jsou POST (Server Actions nebo route) s **kontrolou hlavičky `Origin`** proti očekávanému hostiteli (a `Host`). Next.js Server Actions provádějí vlastní kontrolu původu, **ověřit v dokumentaci použité verze, protože zadání upozorňuje na odlišnosti** (`node_modules/next/dist/docs/`). U vlastních route handlerů kontrolu provést ručně.
- Operace s vysokým dopadem (změna PINu, přidání správce, smazání webu, zásahy operátora) vyžadují navíc **token proti CSRF** vázaný na relaci nebo opětovné potvrzení.
- Žádné zápisy pomocí GET. Odkazy z e-mailu (přihlašovací odkaz) nejdřív zobrazí potvrzovací stránku, protože skenery e-mailu odkazy předem otevírají a spotřebovaly by jednorázovou platnost.
- Kód z přihlašovací zprávy je svázán s žádostí (prohlížeč, který ji zahájil), aby nešlo podstrčit cizí přihlášení (login CSRF).

## 3. Hlavičky a CSP

Hlavičky nastavuje proxy vrstva nebo konfigurace Next.js podle hostitele (mechanismus podle zvolené verze, viz technický návrh).

| Hlavička                     | Hodnota (návrh)                                                                                                                                                                        | Poznámka                                                                                                                                                                                                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy`    | `default-src 'self'`, skripty jen s nonce (`script-src 'self' 'nonce-…'` a `'strict-dynamic'`), `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, `form-action 'self'` | Konkrétní zdroje (Vercel Analytics, úložiště fotografií v `img-src`) doladit. Weby párů bez skriptů třetích stran. Mapa jako doplněk: statická mapa OpenStreetMap z dlaždic přes vlastní původ (`/api/map-tile`, serverová proxy s mezipamětí), CSP se kvůli ní nemění |
| `Strict-Transport-Security`  | dlouhá platnost, `includeSubDomains`                                                                                                                                                   | `preload` až po ověření všech subdomén `[OTÁZKA]`                                                                                                                                                                                                                      |
| `X-Content-Type-Options`     | `nosniff`                                                                                                                                                                              |                                                                                                                                                                                                                                                                        |
| `Referrer-Policy`            | `strict-origin-when-cross-origin`, na webech párů `no-referrer`                                                                                                                        | Adresa webu páru se nemá prozrazovat odkazovaným stránkám                                                                                                                                                                                                              |
| `Permissions-Policy`         | vypnout kameru, mikrofon, polohu a další nepoužité funkce                                                                                                                              |                                                                                                                                                                                                                                                                        |
| `X-Frame-Options`            | `DENY` (doplněk k `frame-ancestors`)                                                                                                                                                   |                                                                                                                                                                                                                                                                        |
| `X-Robots-Tag`               | `noindex, nofollow` na `app.`, `admin.` a všech webech párů                                                                                                                            | FR-PRIV-1. Úvodní stránka je indexovatelná                                                                                                                                                                                                                             |
| `Cache-Control`              | `no-store` u odpovědí s relací a u správy                                                                                                                                              | Veřejné části mohou mít sdílenou mezipaměť, **nikdy** se nesmí sdílet odpověď s údaji jedné svatby pod jiným hostitelem (klíč mezipaměti podle hostitele)                                                                                                              |
| `Cross-Origin-Opener-Policy` | `same-origin`                                                                                                                                                                          |                                                                                                                                                                                                                                                                        |

- `robots.txt` podle hostitele: úvodní stránka otevřená vyhledávačům (podle rozhodnutí o robotech pro trénování: do rozhodnutí jen vyhledávací a odpovědní), ostatní hostitelé zavřeni.
- Původní záměr byl CSP nejdřív v režimu jen hlášení (`Content-Security-Policy-Report-Only`) a pak vynucení. **Neprovedlo se:** CSP se vynucuje od začátku a sběr hlášení není zapnutý (žádný `report-uri`). Skutečné nastavení a přijaté riziko popisuje kapitola 3.1; tabulka výše je původní návrh.
- Výstup uživatelského obsahu (jména, texty) se vždy escapuje. Žádné `dangerouslySetInnerHTML` s uživatelskými daty. Uživatelský SVG se nepřijímá (ADR 0006). Adresy odkazů vložené uživatelem povolit jen `https:` a `mailto:`/`tel:`.

### 3.1 Implementace (`next.config.ts`)

Skutečně nasazená politika (vynucená, ne jen hlášení) je výchozí varianta **bez nonce**:

| Direktiva         | Hodnota v produkci                                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `default-src`     | `'self'`                                                                                                                         |
| `script-src`      | `'self' 'unsafe-inline'` (ve vývoji navíc `'unsafe-eval'` a `https://va.vercel-scripts.com`)                                     |
| `style-src`       | `'self' 'unsafe-inline'`                                                                                                         |
| `img-src`         | `'self' data: blob:` a původ R2 (jen když jsou nastaveny proměnné R2; obrázky jdou přesměrováním z `/media/…`)                   |
| `font-src`        | `'self'` (písma hostuje aplikace)                                                                                                |
| `connect-src`     | `'self'` a původ R2 (PUT originálu z prohlížeče správce); ve vývoji `ws:` a `wss:`                                               |
| `worker-src`      | `'self' blob:`                                                                                                                   |
| `object-src`      | `'none'`                                                                                                                         |
| `base-uri`        | `'self'`                                                                                                                         |
| `form-action`     | `'self'` a původ `app.` (formulář jmen na úvodní stránce se odesílá metodou GET na průvodce)                                     |
| `frame-ancestors` | `'none'`; jen cesta živého náhledu `/vytvorit/nahled` (cs i en) má `'self'` a `X-Frame-Options: SAMEORIGIN` (vkládá ji průvodce) |

Další hlavičky jsou v `next.config.ts` (`nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `X-Frame-Options: DENY`, COOP `same-origin`, HSTS s `includeSubDomains` bez `preload`) a v `src/proxy.ts` (`noindex`, `no-store`, `Referrer-Policy: no-referrer` mimo úvodní stránku).

**Proč bez nonce.** Skripty Next.js jsou vložené do HTML, proto `'unsafe-inline'`. Přísná varianta s `'nonce-…'` a `'strict-dynamic'` vyžaduje dynamické vykreslování všech stránek (žádná statická ani částečně statická stránka), což by zhoršilo výkon a cenu úvodní stránky a zveřejněných webů.

**Přijaté riziko.** S `'unsafe-inline'` CSP **nezastaví** vložený inline skript, takže při chybě escapování by neposkytla druhou obrannou vrstvu proti XSS. Zůstávají tyto vrstvy: React escapuje výstup, žádné `dangerouslySetInnerHTML` s uživatelskými daty, žádné SVG od uživatele, odkazy jen `https:`, `mailto:`, `tel:`, relační cookies `HttpOnly` a `__Host-`, žádný skript třetí strany na webech párů (ADR 0007) a CSP stále omezuje načítání z cizích zdrojů (`default-src 'self'`, `object-src 'none'`, `base-uri`, `form-action`, `frame-ancestors`), takže vynesení dat na cizí adresu skriptem je ztížené (`connect-src` a `img-src` jen vlastní původ a R2). Riziko je přijato do rozhodnutí majitele před betou (přechod na nonce, pokud se ukáže, že dynamické vykreslování je přijatelné). Mapa na webu páru nemá externí zdroj: dlaždice OpenStreetMap stahuje server a prohlížeč hosta je dostane z `/api/map-tile` (vlastní původ), odkazy do Google Maps a Mapy.cz jsou jen odkazy.

## 4. Omezení požadavků

Mechanismus a tabulka limitů jsou v ADR 0010 (čítače v Postgresu, klíče jako HMAC, podle IP i podle e-mailu nebo slugu, stejné odpovědi bez prozrazení existence). Pokrývá přihlášení, PIN správy a hostů, RSVP, slepé porovnání jména, kontrolu slugu, operátorská přihlášení. Ochrana RSVP před boty používá omezení a skrytou past, žádné hádanky (WCAG 3.3.8).

Implementace (M8, `docs/data-model.md` kap. 15):

- **Slepé ověření jména** nikdy neprozradí seznam hostů: žádná shoda, více shod, překročený limit, vyplněná skrytá past i zavřené RSVP dávají stejný stav a stejný text. Limity: 15 porovnání za hodinu na svatbu a IP, 10 odeslání za hodinu na svatbu a IP, 200 odeslání za hodinu na svatbu. Selhání čítačů RSVP selže otevřeně (nemá zablokovat hosty), PINu zavřeně.
- **Skrytá past**: pole `website` mimo obrazovku, `aria-hidden`, `tabindex="-1"`. Robot dostane stejnou odpověď jako host mimo seznam (při porovnání), nebo odpověď vypadající přijatá (při odeslání), nic se nezapíše.
- **PIN hostů**: pauza po 5 chybách podle svatby a IP (15 minut, dvojnásobek každou sérii, strop 24 hodin), pauza celé svatby po 50 chybách ze všech adres, stejná odpověď pro svatbu bez PINu a neexistující svatbu. PIN s chybným tvarem se do chyb nepočítá.
- **Potvrzení e-mailem** jde jen na adresu, kterou host sám zadal, a jen když pár potvrzení zapnul. Riziko rozesílání potvrzení cizím adresám je omezeno týmiž limity odeslání a tím, že odeslat jde jen s platným lístkem (nebo u hosta mimo seznam, který je pár výslovně povolil); zpráva obsahuje jen shrnutí účasti, nikdy zdravotní údaje.
- **Citlivá data za PINem** se bez relace hosta nenačítají z databáze, takže nejsou ani v HTML, ani v RSC payloadu (test `e2e/guest-pin.e2e.ts`).

## 5. Osobní údaje

### 5.1 Role

| Subjekt                                                                                 | Role                                                                               | Pozn.                                                                                                     |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Pár (Klára a Matěj)                                                                     | **správce** údajů hostů                                                            | Rozhoduje, koho pozve a co se ptá                                                                         |
| Provozovatel služby `[PROVOZOVATEL, IČO]`                                               | **zpracovatel** údajů hostů                                                        | Zpracovává na pokyn páru. Podmínky služby musí obsahovat zpracovatelská ujednání (čl. 28 GDPR) `[OTÁZKA]` |
| Provozovatel služby                                                                     | **správce** u vlastních údajů: e-maily správců, operátoři, provozní záznamy, audit | Tuto dvojí roli právník potvrdí `[OTÁZKA]`                                                                |
| Poskytovatelé (hosting, databáze, úložiště fotografií, e-mail, analytika, hlášení chyb) | **dílčí zpracovatelé**                                                             | Seznam dílčích zpracovatelů zveřejnit                                                                     |

### 5.2 Smlouvy o zpracování (DPA) a umístění

DPA a ověření umístění dat, přenosů mimo EU a záruk před spuštěním (brána A) u všech dílčích zpracovatelů. Seznam odpovídá skutečnému stavu kódu (po ADR 0011 a 0006):

| Dílčí zpracovatel        | K čemu                                                                                                  | Jaké údaje                                                                                                                                                | Umístění a poznámka                                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel                   | hosting aplikace, Web Analytics a Speed Insights (jen `se-vezmou.cz` a `app.`, ne weby párů a `admin.`) | přenášené požadavky (IP adresa v záznamech platformy), agregované návštěvnosti bez cookies                                                                | DPA a regiony funkcí ověřit `[OTÁZKA]`                                                                                                                                                   |
| Supabase                 | **jen databáze PostgreSQL** (schéma `se_vezmou`, přímé spojení `pg`)                                    | všechna data aplikace včetně údajů hostů; **Auth a Storage Supabase se nepoužívají** (ADR 0011, 0012, 0006)                                               | region EU, sdílený projekt; DPA a umístění záloh `[OTÁZKA]`                                                                                                                              |
| AWS SES                  | odesílání e-mailů (kódy, upozornění, potvrzení RSVP)                                                    | e-mailová adresa příjemce a obsah zprávy při odeslání; obsah v naší databázi není (jen záznam bez obsahu)                                                 | `eu-central-1`; DKIM, produkční přístup (`docs/launch-checklist.md`)                                                                                                                     |
| Cloudflare R2            | úložiště fotografií páru (privátní bucket, ADR 0006)                                                    | fotografie bez EXIF a GPS; **IP adresa a user agent hosta, jehož prohlížeč si obrázek stahuje** (viz kap. 5.5)                                            | jurisdikce EU; smlouva o zpracování a záloha `[OTÁZKA]` (OQ-56)                                                                                                                          |
| OpenStreetMap Foundation | dlaždice mapy (`tile.openstreetmap.org`) a hledání souřadnic adresy (Nominatim) pro mapu místa konání   | jen ze serveru: textová adresa místa při hledání a souřadnice dlaždic; **bez IP adresy, user agenta a Refereru hosta** (prohlížeč hosta OSM nekontaktuje) | podmínky užívání OSMF (vlastní User-Agent, mezipaměť dlaždic aspoň 7 dní, nejvýš 1 dotaz za sekundu na Nominatim); atribuce na mapě; při růstu provozu vlastní server dlaždic `[OTÁZKA]` |
| Sentry                   | hlášení chyb a výkonu (jen pokud je nastaveno `NEXT_PUBLIC_SENTRY_DSN`)                                 | typ chyby a zásobník; **bez adresy, cesty, query, těla požadavku, cookies, uživatele a drobečkové navigace** (kap. 5.5)                                   | region a DPA podle zvoleného projektu Sentry (EU region) `[OTÁZKA]`; v prohlížeči jen na úvodní stránce; rozhodnutí o zapnutí v `docs/launch-checklist.md`                               |

Detail přenosů mimo EU a záruk `[OTÁZKA]` pro právníka. Seznam dílčích zpracovatelů se zveřejní (kap. 11, bod 5). Dodržet i u ostatních možností, pokud se některý vymění.

### 5.3 Kategorie údajů

| Kategorie                     | Příklady                                                        | Kdo je subjektem        | Citlivost                               | Retence (návrh)                                       |
| ----------------------------- | --------------------------------------------------------------- | ----------------------- | --------------------------------------- | ----------------------------------------------------- |
| Údaje správců                 | e-mail, záložní e-mail, hash PINu                               | snoubenci, pomocníci    | běžná                                   | po dobu existence webu, poté smazat                   |
| Údaje o svatbě                | jména páru, datum, místo, texty                                 | pár                     | běžná                                   | po dobu webu, pak podle stavu                         |
| Hosté a RSVP                  | jméno, účast, doprovod, děti s věkem, ubytování, doprava, píseň | hosté, děti             | běžná, u dětí zvýšená péče              | 3 měsíce po svatbě                                    |
| **Dietní a alergické údaje**  | dieta, alergie                                                  | hosté                   | **zvláštní kategorie (zdravotní údaj)** | **30 dní po svatbě**, bez čekání na export (viz níže) |
| Fotografie                    | galerie páru                                                    | lidé na fotografiích    | běžná, může být citlivá podle obsahu    | jako web a svatba                                     |
| Číslo účtu darů               | IBAN                                                            | pár                     | běžná, za PINem                         | po dobu webu                                          |
| Provozní záznamy              | záznam e-mailu bez obsahu, audit, čítače                        | všichni                 | minimalizovaná                          | krátká, `[LHŮTY]`                                     |
| Analytika                     | události bez PII                                                | nikdo identifikovatelný | minimální                               | `[LHŮTY]`                                             |
| Hlášení chyb (Sentry)         | typ chyby, zásobník, název šablony trasy (bez adresy)           | nikdo identifikovatelný | minimální                               | podle nastavení projektu Sentry `[LHŮTY]`             |
| Koncept průvodce v prohlížeči | jména páru, datum svatby (kap. 5.6)                             | pár                     | běžná, jen v zařízení uživatele         | do smazání v prohlížeči; na serveru se neukládá       |

Lhůty výše jsou výchozí návrh zadání (dieta 30 dní, ostatní údaje hostů 3 měsíce, web veřejně 12 měsíců, pak archiv jen pro správce a smazání zhruba 15 měsíců po svatbě), **schvaluje právník**.

**Smazání zdravotních údajů nečeká na export.** Retenční úloha smaže dietu a alergie v den splatnosti (výchozí 30 dní po svatbě, `app_settings.health_retention_days_after_wedding`), i když pár export nestáhl ani nepotvrdil. Pár před tím dostane upozornění s odkazem na export (M10), ale smazání na stažení nijak nečeká. Je to záměr (zdravotní údaj nemá zůstat déle jen proto, že pár nereaguje); případné čekání na export by vyžadovalo rozhodnutí právníka (kap. 11, bod 1) a změnu úlohy.

### 5.4 Zdravotní údaje (dieta, alergie)

- Pole je **nepovinné**, výslovně označené a s krátkým vysvětlením, k čemu slouží a kdy se smaže. Nepovinnost vynutit i v kódu (odpověď bez diety je platná).
- Uložit **odděleně** od ostatních odpovědí RSVP (samostatná tabulka nebo sloupec s přísnější politikou přístupu), šifrování na úrovni pole zvážit `[OTÁZKA]`.
- **Operátor je nevidí.** Dietní údaje se nezobrazují v seznamu zakázek ani ve výpisech podpory. Nahlédnutí jen s kroky v kapitole 7.
- **Host ověřený jménem je nevidí.** Lístek z `rsvp_match` dostane každý, kdo zná jméno hosta, proto `rsvp_get` dietu, alergie ani kontaktní e-mail z dřívější odpovědi nevrací (jen příznak, že jsou uložené). Při úpravě odpovědi prázdná pole uložené údaje ponechají, vyplněná je nahradí a zaškrtnutím je host smaže. Celé hodnoty vidí jen správce (předvyplnění ručního zápisu).
- Nepřenášejí se do logů, e-mailů (potvrzení RSVP neopakuje dietu), analytiky ani chybových hlášení.
- Smazání 30 dní po svatbě. Před smazáním pár dostane upozornění a možnost exportu, smazání ale na export nečeká (kap. 5.3). Znění informace v RSVP formuláři má lhůtu „30 dní“ napevno v překladu (`rsvp.health.notice`, `src/i18n/messages/*/rsvp.json`), zatímco skutečná lhůta je `health_retention_days_after_wedding`; funkce `rsvp_info` hodnotu nevrací, a proto se do textu nedosazuje. Změní-li se nastavení, musí se změnit i text (OQ-61). Je to právní text k ověření právníkem. Právní základ (výslovný souhlas hosta nebo jiný titul páru jako správce) a text informace pro hosty `[OTÁZKA]` pro právníka, včetně toho, kdo hostům informaci poskytuje (pár) a jak ji služba zobrazí.

### 5.5 Minimalizace

- Web nemá domácí adresu snoubenců. Údaje nezletilých jen to, co pár zadá (jméno a věk dítěte jako součást domácnosti). Fotografie bez EXIF a GPS (ADR 0006).
- **Údaje hostů operátor nevidí.** Agregované počty ano (počet hostů na svatbu bez jmen).
- Záznamy (logy aplikace) neobsahují e-maily, jména, PINy, kódy, odpovědi RSVP ani IP v čitelné podobě. Chybová hlášení (Sentry) bez adresy, cesty, query, těla požadavku, cookies, hlaviček, uživatele a drobečkové navigace: `src/lib/sentry-scrub.ts` je čistí před odesláním (testy `sentry-scrub.test.ts`), Sentry v prohlížeči je zapnutý **jen na hostiteli úvodní stránky**, nikdy na webech párů, `app.` ani `admin.` (ADR 0007: žádný skript třetí strany u hostů); adresa náhledu (`/nahled/<token>`) a slug tedy Sentry nikdy neopustí.
- Informace pro hosty o zpracování: krátké sdělení při RSVP (`src/components/site/rsvp/privacy-notice.tsx`, klíč `rsvp.privacy.notice`, česky i anglicky) jmenuje **pár jako správce**, uvádí, že provozovatel údaje zpracovává na pokyn páru, a odkazuje na zásady zpracování. Zásady (`/soukromi`, `/en/privacy`) se obsluhují jen na hostiteli úvodní stránky, proto odkaz na webu páru míří na absolutní adresu `NEXT_PUBLIC_SITE_URL` a otevírá se v nové záložce (host nepřijde o rozepsanou odpověď). Kontakt na pár `[KONTAKT]` doplní pár do svého webu; stránka zásad je zatím zástupná (`[PROVOZOVATEL, IČO]`). Znění `[OTÁZKA]` pro právníka.
- **Zásady pro hosty musí uvést Cloudflare R2 jako příjemce.** Obrázky na webu páru se doručují přesměrováním z `/media/…` na podepsanou adresu R2, takže **prohlížeč hosta se přímo připojí k Cloudflare R2** a ten vidí jeho IP adresu a user agent (stejně jako Vercel u samotného webu). Nastavení Cloudflare R2 nemá cookies; adresa je podepsaná a časově omezená. Právník posoudí, zda je to nutné uvést v krátkém sdělení, nebo jen v zásadách.
- Cookies: jen technicky nutné (relace) a funkční volba jazyka `NEXT_LOCALE` po výslovném přepnutí (kap. 1.4). Analytika bez cookies (ADR 0007). Posouzení nutnosti souhlasové lišty `[OTÁZKA]` pro právníka.

### 5.6 Koncept průvodce v prohlížeči (localStorage)

Rozpracovaný průvodce se ukládá **v prohlížeči** pod klíčem `sv-wizard-draft-v1` v `localStorage` (záložně v `sessionStorage`, když trvalé úložiště nejde, `src/components/wizard/storage.ts`). Obsahuje vše, co pár v průvodci vyplnil: **jména páru a datum svatby**, vybranou šablonu, program, místa a adresy, kontakty, texty a informaci, zda je PIN hostů zapnutý. **PIN hostů v prostém tvaru se do prohlížeče neukládá** (`storableDraft`, verze konceptu 2): drží ho jen paměť stránky, takže po obnovení stránky ho pár zadá znovu; koncepty verze 1, které ho mohly nést, se při načtení očistí a přepíšou. Na server se prostý PIN také neukládá (`serverDraft`), v databázi je jen hash po zveřejnění; PIN pro obrazovku „Hotovo“ drží jen `sessionStorage` karty do jejího zavření. Neobsahuje e-mail ani údaje hostů. Koncept se maže, až když ho průvodce zveřejněním nebo zjištěním, že web už je zveřejněný jinde (`not_draft`), odstraní (`clearStoredDraft`), nebo když uživatel smaže data webu v prohlížeči; jinak v zařízení zůstává bez časového omezení.

Je to osobní údaj uložený v zařízení uživatele (a na sdíleném počítači ho může vidět další uživatel). Zásady zpracování ho musí uvést (účel: nezmizí práce při obnovení stránky; doba: do smazání; nepřenáší se, dokud pár neuloží koncept na server). Zda je to striktně nutné a souhlas není potřeba, posoudí právník `[OTÁZKA]` (kap. 11, bod 21). Zvážit zkrácení doby (například mazání po neaktivitě, OQ-58). Neukládání prostého PINu do prohlížeče je hotové (OQ-64).

### 5.7 Měřicí pixel v e-mailech správcům (ADR 0014)

Oznámení o vypršení webu (`retention-notice`, druh `site_expiry`) a o trvalém smazání webu (`deletion-notice`, druh `site_purge`) mohou nést průhledný obrázek 1×1 z vlastní instance Umami, jen když je nastavena `UMAMI_PIXEL_URL` (https). Adresa obsahuje jen pevné značky šablony (`utm_source`, `utm_medium`, `utm_content`), nikdy údaje o příjemci ani svatbě; jiné šablony (kódy, bezpečnostní oznámení, e-maily hostům) a oznámení o smazání zdravotních a hostových údajů (`health_purge`, `guest_purge`) pixel nemají. Test `src/lib/email/pixel.test.ts` hlídá tvar adresy, jediný výskyt na konci HTML a nepřítomnost v textu. Právní kvalifikace (oprávněný zájem vs. souhlas, ePrivacy) je `[OTÁZKA]` pro právníka; do doby odpovědi se proměnná v Production nenastavuje.

## 6. Mazání a právo na výmaz

- **Automatické mazání podle retence:** dietní údaje 30 dní po svatbě, ostatní údaje hostů 3 měsíce po svatbě. Pár předem dostane e-mail s odkazem na export hostů, RSVP a fotografií ve správě (FR-LC-2), včetně připomenutí, a blížící se mazání vidí i v přehledu správy. Export se e-mailem neposílá (e-mail by nesl osobní údaje hostů). Lhůty upozornění `[LHŮTY]`.
- **Denní úloha retence** (naplánovaná, idempotentní) vybírá weby podle data svatby a stavu, maže a zapisuje do auditu **bez osobních údajů** (identifikátor svatby, typ mazání, počet řádků, čas). Selhání úlohy se hlásí provozu.
- **Smazání webu párem:** správce si web smaže sám. Nevratné smazání po krátké ochranné lhůtě, v níž ho operátor může obnovit na žádost `[OTÁZKA]` (délka lhůty pro právníka). Fotografie a řádky se smažou včetně prefixu v úložišti.
- **Právo na výmaz hosta:** host se obrátí na pár (správce), který smaže záznam v správě. Pokud se host obrátí na provozovatele, ten ho **odkáže na pár** a na jeho pokyn pomůže. Lhůta odpovědi a postup `[LHŮTY]`. Každá žádost a její vyřízení se zapíše do auditu bez osobních údajů. **Stav implementace:** databázová funkce `erase_guest` (výmaz jednoho hosta, osob, účasti a zdravotních údajů s auditem) existuje a je testovaná, ale **žádná část aplikace ji nevolá** (není tlačítko ani akce). Zdokumentovaným způsobem výmazu jednoho hosta je dnes **smazání domácnosti** v seznamu hostů (`admin_household_delete`), které smaže všechny její členy; výmaz jediného člena domácnosti beze změny ostatních zatím nejde bez úpravy domácnosti (OQ-62).
- **Zálohy:** doba uchování záloh databáze a úložiště musí být krátká a zdokumentovaná. Po obnově ze zálohy se **znovu provedou smazání** (seznam smazaných záznamů nebo opakování úlohy retence). `[OTÁZKA]` pro právníka: přijatelná délka uchování záloh.
- **Adresy:** adresy zveřejněných webů se znovu nepřidělují (FR-PRIV-4), uchovává se jen záznam o použité adrese (slug a čas, bez osobních údajů) `[OTÁZKA]` zda by sama adresa vedená jménem páru nebyla osobním údajem a jak dlouho ji držet.
- **Doklady a platby** mají vlastní zákonnou retenci a smazáním webu se nemažou (ADR 0009).

## 7. Audit

- **Záznam auditu:** kdo (operátor nebo správce, identifikátor), kdy, co (typ akce), u které svatby, důvod (u nahlédnutí povinný), výsledek. Bez osobních údajů hostů a bez obsahu odpovědí.
- **Co se zapisuje:** každý zásah operátora (FR-OPS-7), změna stavu, zablokování, obnova, poslání přihlašovacího odkazu, nahlédnutí do údajů hostů, změna správců, použití záložního kódu, změna PINu (bez hodnoty), mazání (retence a na žádost), export.
- **Nahlédnutí operátora do údajů hostů:** jen **na žádost páru** (souhlas doložit, například potvrzení z e-mailu správce), s **uvedeným důvodem**, na **omezenou dobu**, s **auditem** a oznámením správcům (**nejlepší úsilí**, viz níže). Bez souhlasu systém údaje hostů operátorovi **nevydá** (oprávnění vynucená v databázi a na serveru, ne jen skrytím v rozhraní). Role podpora i majitel jsou stejně omezeny.
- **Oznámení správcům jsou nejlepší úsilí.** Audit se zapisuje v téže transakci jako zásah (vždy), ale e-mail páru o nahlédnutí provozovatele (OQ-53) se posílá **až po skutečném nahlédnutí a po odpovědi**, ne před ním. Selže-li odeslání (SES, síť, chyba aplikace), nahlédnutí už proběhlo a e-mail se znovu neposílá; pár ho vždy uvidí v přehledu přístupu (záznam z auditu), takže žádné nahlédnutí nezůstane bez stopy, ale upozornění do schránky není garantované (OQ-63). Totéž platí o oznámení o změně správců (kap. 13).
- **Ochrana auditu:** jen přidávání (žádná úprava ani mazání operátorem), oddělená tabulka bez práva zápisu pro aplikační roli kromě vložení, retence `[LHŮTY]`. Správci páru vidí audit týkající se jejich webu.

## 8. Tajné hodnoty

- Mimo repozitář. Zdrojem jsou proměnné prostředí ve Vercelu (oddělené pro Production, Preview a Development). Lokálně `.env.local` mimo git. Kontrola, že `.env*` je v `.gitignore` a že repozitář neobsahuje klíče (kontrola tajných hodnot v CI, například skenování před sloučením).
- Přehled tajných hodnot: `DATABASE_URL` (heslo aplikační role `se_vezmou_app`; klíč `service_role` ani JWT secret sdíleného projektu aplikace nepoužívá a na Vercelu být nesmí), `MIGRATE_DATABASE_URL` (vlastník schématu, jen na počítači majitele při nasazení migrací, nikdy na Vercelu), pepper pro PINy (`PIN_PEPPER`), klíč HMAC pro omezení požadavků (`RATE_LIMIT_SECRET`), `AUTH_SECRET`, `OPERATOR_MFA_KEY` (šifrování TOTP operátorů), `CRON_SECRET` (plánované úlohy), přístup k R2 (token omezený na jeden bucket), `SENTRY_AUTH_TOKEN` (jen sestavení), přístup AWS pro SES (omezená IAM role jen na odesílání), tajemství pro podpis webhooků, klíče brány plateb později, tajný klíč relací nebo CSRF (pokud je potřeba).
- Proměnné s údaji pro prohlížeč (`NEXT_PUBLIC_*`) **nesmí** obsahovat tajné hodnoty. Server-only kód je označen balíčkem `server-only` (jako `src/lib/email/ses.ts`). Validace proměnných při startu (`@/env`).
- **Rotace:** postup a termíny pro každou hodnotu. Rotace peppera vyžaduje strategii (starý a nový pepper po přechodné období, nebo vynucená změna PINu) `[OTÁZKA]`.
- Minimální oprávnění: účet AWS jen pro SES, v Supabase oddělení rolí: aplikace se připojuje jako `se_vezmou_app` (bez práv, `set local role` v každé transakci), migrace aplikuje vlastník zvlášť. Přístup k řídicím panelům s dvoufázovým ověřením. Seznam osob s přístupem k produkci vede majitel.
- Logy neobsahují tajné hodnoty. Preview nasazení **bez produkčních dat a tajných hodnot** (oddělený projekt databáze nebo testovací data) `[OTÁZKA]`.

### 8.1 Databáze: aplikační role, vlastník a `set role`

Model hrozeb pro sdílený projekt Supabase (ADR 0011):

- **Vlastník (`postgres`)** vlastní schéma `se_vezmou`, tabulky a funkce. Jen vlastník aplikuje migrace (`npm run db:migrate`, `MIGRATE_DATABASE_URL` na počítači majitele). Jeho heslo na Vercelu nikdy není. Funkce `security definer` běží jako vlastník (obcházejí RLS), proto každá sama filtruje podle `wedding_id` a role a má `set search_path = ''`.
- **Aplikační role `se_vezmou_app`** (`login`, `noinherit`, `nobypassrls`, členství v `authenticated` a `service_role` jen kvůli `set role`) je jediná, která se připojuje z Vercelu. Sama nemá `usage` na schéma ani práva k čemukoli. Každé volání je jedna transakce, která začíná `set local role service_role` (před ověřením, cron, operátor), nebo `set local role authenticated` s claimy `wedding_id`, `wedding_role`, `sub`.
- **Riziko zapomenutého `set role`:** kód, který by dotaz poslal bez přepnutí role, narazí na chybu oprávnění (42501), ne na cizí data. Hlídá to test `supabase/tests/as_app/10_app_role.test.sql` (skutečné přihlášení jako `se_vezmou_app`: bez `set role` nejde číst tabulky ani volat funkce, nejde přepnout na `anon`, `postgres` ani `authenticator`, claimy nepřežijí transakci), jednotkové testy dopravy (role a claimy v téže transakci před voláním) a e2e, které běží jako `se_vezmou_app`, ne jako superuživatel. Role se mění jen `set local`, takže se po commitu vrací a spojení vrácené poolerem nenese cizí totožnost.
- **`FORCE ROW LEVEL SECURITY`:** posouzeno a nezapnuto. Politiky jsou napsané pro `authenticated` a funkce `security definer` čtou tabulky jako vlastník; `FORCE` by je podřídil politikám a rozbil. Přínos by byl jen proti chybě vlastníka, který dotazy z aplikace nespouští. Skutečnou obranou je, že aplikace vlastníkem není a nemá práva, a test `10_structure` hlídá, že FORCE zapnuté není (změna musí být vědomá).
- **Sdílené role projektu** (`anon`, `authenticated`, `service_role`): náš projekt jim dává jen `usage` na schéma `se_vezmou` a explicitní `execute` u vybraných funkcí. Kdo drží klíč `service_role` sdíleného projektu, má stejně plný přístup k celému projektu; proto ho na Vercelu našeho projektu nemáme. Init skript schéma pro PostgREST už nevystavuje; pokud ho starší verze přidala, odebere ho majitel podle volitelného úklidu v `supabase/README.md` (OQ-46).
- **Přijaté riziko (OQ-66):** role `authenticated` má obecná přímá oprávnění k tabulkám tenantů (RLS je omezuje na svatbu správce). Prohlížeč s databází nemluví a kód serveru volá funkce, ne tabulky; odebrání těchto oprávnění je následný úkol.
- **Spojení:** TLS vždy a u vzdálené databáze s ověřením certifikátu: `DATABASE_CA_CERT` (aplikace) a `MIGRATE_CA_CERT` (migrace) jsou povinné, bez nich spojení selže s jasnou zprávou, pokud není výslovně nastaveno `DATABASE_TLS_INSECURE=1` respektive `MIGRATE_TLS_INSECURE=1` (OQ-45). Loopback a unixový socket (CI, lokální vývoj) jsou bez TLS. Heslo se nevypisuje do logů ani chyb (`DbError` nenese argumenty ani text SQL).

## 9. Ochrana proti zneužití subdomén a certifikátů

- **Slug:** převod diakritiky na ASCII, jen `a–z`, číslice, pomlčky, nejvýše 63 znaků, bez pomlčky na kraji a bez dvou za sebou. Rezervované názvy (`www`, `app`, `admin`, `api`, `mail`, `podpora`, `status`, `static`, `cdn`, doplnit `[OTÁZKA]` např. `ns1`, `ns2`, `smtp`, `bounce` kvůli e-mailové doméně) a seznam vulgarismů se blokují. Podobnost s cizími značkami a bankami (phishing) kontrolovat ručním seznamem a hlášením `[OTÁZKA]`.
- **Adresa se aktivuje až po založení svatby**, žádná „předaktivace“. Neexistující adresa vrací 404 bez nabídky jiných webů a bez výpisu (FR-PRIV-3).
- **Před vystavením certifikátu pro novou subdoménu** ověřit, že web existuje. Wildcard certifikát, který spravuje Vercel, pokrývá `*.se-vezmou.cz` bez individuálních žádostí na každý slug, takže útok na kvóty certifikační autority se tím omezuje. Pokud by se někdy přidávaly jednotlivé domény (vlastní domény páru, později), musí platit: doména se přidá a certifikát se požádá **jen po ověření vlastnictví a existence svatby**, s limitem počtu za čas. Přesné chování Vercelu ověřit v aktuální dokumentaci `[OTÁZKA]`.
- **Hlášení zneužití:** kontaktní adresa `[KONTAKT]`, postup zablokování operátorem (stav „zablokováno“, FR-OPS-4), záznam do auditu. Zablokovaný web vrací neutrální stránku.
- **Takeover subdomén:** žádné DNS záznamy CNAME na externí služby bez vlastnictví. Pravidelný přehled záznamů v DNS Vercelu.
- **Uživatelský obsah** (jména, texty, odkazy) nesmí vykreslit skripty ani HTML (viz CSP). Weby párů nemají formuláře mimo RSVP a PIN, takže zneužití k phishingu je omezené. Přesto hlídat odkazy a QR kódy.
- Cookie `__Host-` bez `Domain` brání tomu, aby jeden web páru četl relaci jiného.

## 10. Model hrozeb (stručně)

| Hrozba                                      | Cíl                   | Hlavní opatření                                                                                                              | Zbytkové riziko                                                                          |
| ------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Únik dat mezi svatbami                      | hosté, RSVP           | RLS v databázi, test oddělení před betou (brána B), jedna tabulka, každý řádek se `wedding_id`                               | chyba v politice, proto test jako brána                                                  |
| Zapomenuté `set role` v aplikaci            | všechna data          | aplikační role `se_vezmou_app` nemá žádná práva: dotaz bez `set local role` končí chybou 42501; test `as_app` a test dopravy | chyba v `security definer` funkci (běží jako vlastník), proto filtr `wedding_id` v každé |
| Únik hesla role `se_vezmou_app`             | data jedné aplikace   | heslo jen v `DATABASE_URL` na Vercelu, role bez práv, jen funkce přes `set role`, rotace hesla                               | útočník může volat funkce `service_role` (před ověřením), ne číst tabulky                |
| Migrace změní cizí část sdíleného projektu  | jiné aplikace         | všechno ve schématu `se_vezmou`, test izolace migrací (snímek katalogu), nástroj odmítá změněné a destruktivní migrace       | lidská chyba mimo repozitář (ruční zásah v konzoli)                                      |
| Hrubá síla na PIN                           | správa, citlivé bloky | argon2id + pepper, 5 chyb, zdvojnásobující pauza, limity podle IP a svatby                                                   | šestimístný PIN je nízká entropie, zamknutí správce (řeší cesta e-mailem)                |
| Převzetí schránky správce                   | web páru              | oznámení o přihlášení a změně správců, záložní e-mail, krátké kódy                                                           | schránka je mimo naši kontrolu                                                           |
| Převzetí účtu operátora                     | všechny zakázky       | e-mail OTP + TOTP, relace 30 min / 8 h, audit, role                                                                          | phishing TOTP v reálném čase, později passkey                                            |
| Výčet adres, e-mailů a hostů                | soukromí              | stejné odpovědi, limity, slepé RSVP bez našeptávače                                                                          | informace ze společenského kontextu                                                      |
| Spam v RSVP                                 | data a e-maily        | limity, skrytá past, pole bez hádanek                                                                                        | pomalý, cílený spam                                                                      |
| Zneužití odesílání e-mailů (spam ze služby) | pověst domény         | limity kódů, DMARC, potlačení odrazů, monitorování                                                                           | zneužití přes cizí adresy v kódu, proto limity podle IP a e-mailu                        |
| Phishing pod naší doménou                   | hosté                 | rezervované a blokované názvy, hlášení zneužití, blokace                                                                     | rychlost reakce                                                                          |
| Zneužití certifikátů a subdomén             | doména                | wildcard, aktivace až po založení svatby, ověření existence                                                                  | nové chování platformy                                                                   |
| XSS ve vloženém obsahu                      | relace                | escapování, CSP bez nonce (kap. 3.1), žádné SVG od uživatele, `HttpOnly`                                                     | chyba v knihovně; CSP s `'unsafe-inline'` vložený skript nezastaví                       |
| CSRF                                        | zápisy                | `SameSite`, kontrola `Origin`, tokeny u citlivých akcí                                                                       | nová kombinace verze Next.js                                                             |
| Škodlivé nebo příliš velké obrázky          | úložiště, výkon       | kontrola obsahu, limity, sharp, EXIF pryč                                                                                    | chyby v nativní knihovně, aktualizovat                                                   |
| Únik tajných hodnot                         | vše                   | mimo repozitář, rotace, minimální oprávnění                                                                                  | lidská chyba                                                                             |
| Přístup operátora k údajům hostů            | soukromí              | souhlas, důvod, audit, oprávnění v DB                                                                                        | vnitřní zneužití u majitele                                                              |
| Obnova ze zálohy vrátí smazané údaje        | GDPR                  | krátké uchování záloh, opakování mazání po obnově                                                                            | `[OTÁZKA]` lhůta                                                                         |
| Výpadek e-mailu (kódy nedorazí)             | přihlášení            | záložní kanály (ADR 0005), PIN, více adres                                                                                   | pomalejší obnova                                                                         |

## 11. Seznam věcí pro právníka

Štítky `[OTÁZKA]` (rozhodnutí nebo výklad) a `[LHŮTY]` (číselné lhůty). Návrh lhůt zadání: 30 dní dietní údaje, 3 měsíce ostatní údaje hostů, web 12 měsíců po svatbě.

1. `[LHŮTY]` Schválit retenci: dietní údaje 30 dní po svatbě, ostatní údaje hostů 3 měsíce, web 12 měsíců, termíny upozornění a exportu.
2. `[OTÁZKA]` Právní základ zpracování zdravotních údajů (dieta, alergie) a podoba souhlasu hosta, kdo ho vyžaduje (pár) a jak to služba technicky podporuje.
3. `[OTÁZKA]` Vztah správce a zpracovatel mezi párem a provozovatelem. Zpracovatelské ujednání jako součást podmínek, jeho forma pro spotřebitele (pár jako fyzická osoba mimo podnikání: použije se GDPR i na domácí výjimku?).
4. `[OTÁZKA]` Dvojí role provozovatele: správce u údajů správců a operátorů, zpracovatel u údajů hostů.
5. `[OTÁZKA]` DPA a přenosy mimo EU u dodavatelů (Vercel, Supabase, AWS SES, Cloudflare R2, Sentry). Seznam dílčích zpracovatelů a zda zásady musí uvést, že prohlížeč hosta se připojuje k R2 (IP adresa).
6. `[LHŮTY]` Doba odpovědi na žádost o výmaz a o export a postup, když se host obrátí na provozovatele.
7. `[LHŮTY]` Doba uchování záloh a pravidlo pro obnovu a opakované smazání.
8. `[LHŮTY]` Retence provozních záznamů: záznam e-mailu, audit, čítače omezení požadavků, analytické události.
9. `[OTÁZKA]` Informační povinnost vůči hostům (krátké sdělení při RSVP) a vůči dětem a nezletilým jako subjektům údajů.
10. `[OTÁZKA]` Je nutná souhlasová lišta, pokud jsou jen nezbytné relační cookies, analytika bez cookies a vlastní tabulka událostí?
11. `[OTÁZKA]` Povaha slugu odvozeného od jmen páru a jeho trvalé uchování po skončení webu (FR-PRIV-4).
12. `[OTÁZKA]` Nahlédnutí operátora do údajů hostů: forma souhlasu, doba a rozsah, zda je to zpracování na pokyn správce.
13. `[OTÁZKA]` Fotografie lidí v galerii: odpovědnost páru, postup stažení na žádost osoby, lhůty.
14. `[LHŮTY]` Obnova smazaného webu v retenční lhůtě: délka ochranné lhůty.
15. `[OTÁZKA]` Podmínky služby, prohlášení o přístupnosti a zásady zpracování (znění zadání nepředkládá), včetně textů zaváděcího provozu a podmínek po něm (`[PODMÍNKY]`).
16. `[OTÁZKA]` Doklady a platby po zaváděcím provozu: DPH, faktury, spotřebitelská práva, retence dokladů (ADR 0009), a střet s mazáním dat.
17. `[OTÁZKA]` Hlášení porušení zabezpečení údajů (postup, lhůty pro úřad a subjekty, kdo hlásí). Připravit provozní postup po schválení.
18. `[OTÁZKA]` Identifikace provozovatele a kontakt: `[PROVOZOVATEL, IČO]`, `[KONTAKT]`, zda je nutný pověřenec (předpoklad: ne, ověřit).
19. `[OTÁZKA]` Krátké sdělení pro hosty při RSVP (`rsvp.privacy.notice`) a upozornění u zdravotních údajů (`rsvp.health.notice`, lhůta „30 dní“ napevno): znění, jazyk, zda stačí odkaz na zásady (OQ-61).
20. `[LHŮTY]` Nové lhůty implementované v M10 a po něm: vypršení konceptu 14 dní, přechod archivovaného webu do smazání po 365 dnech od smazání dat hostů, čekací listina 12 měsíců (OQ-58 až OQ-60).
21. `[OTÁZKA]` Koncept průvodce v `localStorage` (kap. 5.6), a zda je nutný souhlas (OQ-64; prostý PIN hostů se už neukládá).
22. `[OTÁZKA]` Výmaz jednoho hosta bez smazání celé domácnosti a doručení oznámení o nahlédnutí operátora jen nejlepším úsilím (OQ-62, OQ-63).

## 12. Načtení náhledu externí galerie (SSRF)

Správa webu umožňuje uvést odkaz na externí fotogalerii. Server k němu při uložení nebo změně odkazu (a na tlačítko „Obnovit náhled“) stáhne název, popis a adresu obrázku z Open Graph značek cílové stránky (`src/admin/site/og.ts`). Adresa je zadaná uživatelem, proto platí tato pravidla; každé je ověřené jednotkovým testem (`og.test.ts`) a e2e testem:

- jen `https` na portu 443, bez přihlašovacích údajů v adrese, jméno hostitele s tečkou (žádné IP adresy, `localhost`, `*.local`, `*.internal`);
- překlad jména provádí server sám a odmítne **celé jméno**, pokud kterákoli adresa je soukromá, loopback, link-local, sdílená (100.64/10), dokumentační, vícesměrová nebo vyhrazená (IPv4, IPv6 včetně `::ffff:`, NAT64, 6to4); spojení jde přímo na ověřenou adresu (žádný druhý překlad, takže DNS rebinding nepomůže), TLS se ověřuje proti jménu hostitele;
- stejná kontrola po každém přesměrování, nejvýše 3;
- časový limit 5 s na celé načtení, odpověď nejvýše 512 kB, jen `text/html`, bez komprese; parsuje se jen začátek dokumentu (`<head>`), nic se nespouští, žádné cookies, vlastní `User-Agent` (`se-vezmou.cz-linkpreview/1.0`);
- nedůvěryhodný text: titulek a popis se zbavují řídicích a směrových znaků, zkracují a na webu se vypisují jako text (React escapuje); adresa obrázku se ukládá jako zdroj a web ji nevykresluje (od M7c jen kopie ve vlastním úložišti), takže host nikdy nevolá cizí stránku;
- omezení počtu načtení na svatbu (20/hod), selhání nic neblokuje (karta spadne na doménu a text odkazu);
- chráněný odkaz (jen po PINu hostů) má chráněnou i kartu: ve veřejném snímku, v HTML ani v RSC payloadu bez odemčení není.
- **Obrázek karty (M7c):** server stáhne i `og:image` stejným strážcem (jen https na 443, bez soukromých adres ani po přesměrování, časový limit 10 s), jen `image/jpeg`, `image/png` a `image/webp` (SVG ani nic jiného), bez komprese, nejvýše 5 MB (hlavička i skutečně přijaté bajty); obsah se nikdy nepodává dál tak, jak přišel: typ se ověří z obsahu a obrázek se překóduje přes `sharp` (limit 25 megapixelů, bez metadat) a uloží do vlastního úložiště. Web vykresluje jen tuto kopii (kap. 14).

Výjimka pro e2e testy: proměnná prostředí `OG_FETCH_TEST_HOST` (`jmeno=127.0.0.1:port`) spojí jedno jméno hostitele bez DNS a bez TLS s loopbackem. Cíl smí být jen `127.0.0.1`, ostatní pravidla (tvar adresy, přesměrování) platí dál. V produkci se proměnná **nenastavuje** (v `.env.example` je jen zakomentovaná s varováním a na Vercelu nesmí být).

## 13. Import souboru, správci a souhlas s nahlédnutím (M7b)

- **Nahraný soubor je cizí vstup.** Velikost se kontroluje z hlavičky i ze skutečných bajtů (1 MB), formát se pozná podle obsahu (ne podle přípony), starý binární `.xls` se odmítá, u `.xlsx` se před rozbalením zkontroluje velikost rozbaleného obsahu z adresáře archivu (20 MB, ochrana před zip bombou) a čtečka vrací jen hodnoty buněk (vzorce se nevyhodnocují). Soubor se neukládá a nelogují se jeho údaje. Zápis je až po potvrzení náhledu a server řádky znovu ověří; import podléhá omezení počtu požadavků (30/hod na svatbu). Export neutralizuje buňky začínající `=`, `+`, `-`, `@` (CSV injection).
- **Správci.** Přidání i odebrání potvrzuje pár v rozhraní a každá změna přístupu posílá e-mail ostatním správcům a na záložní adresu (nejlepší úsilí po odpovědi, nikdy neblokuje změnu; adresy se nelogují a neukládají). Odebraný správce přijde o všechna přihlášení hned. Sám sebe správce odebrat nemůže, počet správců omezuje `max_admins`. Záložní e-mail a PIN se mění jen s přihlášenou relací, změna PINu odvolá ostatní relace dotčené role a posílá oznámení.
- **Souhlas s nahlédnutím provozovatele (OQ-53).** Provozovatel k údajům hostů nemá přístup, dokud pár souhlas výslovně neudělí (důvod, platnost nejvýš 30 dní, jeden aktivní souhlas, kdykoli odvolatelný). Skutečné nahlédnutí (`op_view_guest_data` vrátí hosty) se auditem zaznamená (provozovatel, důvod, počet) a správcům i záložní adrese jde e-mail s důvodem provozovatele; pár vidí záznam nahlédnutí i odepřených pokusů v části Přístup. Žádný z e-mailů ani auditních záznamů nenese jména hostů.
- **Smazání webu.** Vyžaduje napsané potvrzovací slovo a existující relaci správce; web zmizí hned, všechny relace se odvolají, údaje se trvale smažou až retenční úlohou po ochranné lhůtě (M10) a do té doby web obnoví jen provozovatel s auditem.

## 14. Fotografie páru (M7c, ADR 0006)

- **Úložiště:** Cloudflare R2, vlastní bucket (jurisdikce EU), privátní, bez veřejné adresy a bez výpisu. Klíč API je omezený na tento bucket. Izolace svatby stojí na předponě klíče `{wedding_id}/` a na tom, že podepisuje jen server po kontrole v databázi: R2 nemá politiky na úrovni řádků. Klíče se nikdy neskládají z volného vstupu (`parseKey` přijme jen dva tvary: originál v karanténě a varianta), identifikátory jsou UUID.
- **Nahrávání:** server po ověření relace správce, svatby, stavu webu, kvóty (12 fotografií, 40 MB) a omezení počtu požadavků vydá krátkodobě platnou (10 minut) podepsanou adresu pro PUT jen do `incoming/{wedding_id}/{media_id}`; bajty neprocházejí Vercelem. Přímo z prohlížeče lze nahrát jen na tuto adresu (CORS jen pro `app.se-vezmou.cz` a metodu PUT).
- **Zpracování na serveru:** skutečný typ se pozná z obsahu (JPEG, PNG, WebP; SVG, HEIC, GIF a cokoli jiného se odmítne, přípona ani `Content-Type` nerozhodují), rozměry se kontrolují z hlavičky před dekódováním (100 megapixelů, ochrana proti „decompression bomb“), otočí se podle EXIF, převede do sRGB a odstraní se **všechna metadata včetně EXIF a GPS** (test ověřuje, že žádná varianta nenese polohu ani výrobce foťáku). Originál se po zpracování smaže, chybné objekty hned; pravidlo bucketu maže `incoming/` po jednom dni.
- **Doručení:** `/media/{id}/{šířka}` na hostiteli webu páru zkontroluje svatbu a stav (po retenci 404), že médium je ve zveřejněném snímku a že varianta existuje, a odpoví přesměrováním na podepsanou adresu R2 s platností zaokrouhlenou na časové okno (adresa je stabilní, prohlížeč ji cachuje). `Cache-Control: private, max-age=300`, `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`. Fotografie chráněné PINem hostů nejsou ve veřejném snímku, v HTML ani v doručení bez relace po PINu. Neznámé, nezveřejněné, smazané i cizí médium je stejné prázdné 404.
- **Obrázek karty externí galerie** se kopíruje do vlastního úložiště na serveru (stejné ochrany proti SSRF jako u karty, kap. 12; jen JPEG, PNG a WebP, strop 5 MB, překódování přes `sharp`); host nikdy nenačítá cizí obrázek.
- **Mazání:** smazání fotografie páru je okamžité (soubory, potom řádek) a platí i pro už zveřejněný web. Trvalé smazání webu maže celou předponu i karanténu PŘED řádky; selhání web neoznačí za vymazaný.
- **Zbytková rizika:** velikost nahrávaného souboru nelze vynutit podpisem (strop se vynucuje při zpracování a pravidlem bucketu), nahraný soubor leží v karanténě nejvýš den; R2 samo nezálohuje; fotografie lidí v galerii jsou odpovědnost páru (kap. 11, bod 13).
