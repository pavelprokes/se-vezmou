# ADR 0006: Úložiště a zpracování fotografií

Stav: rozhodnuto majitelem pro **Cloudflare R2** (2. 10. 2026). Podrobnosti doručování a limity jsou doporučení k potvrzení. Nahrazuje původní návrh se Supabase Storage (ADR 0011: aplikace mluví s Postgresem přímo a nemá klíč `service_role`, takže Supabase Storage odpadá).

## Kontext

Pár nahrává do webu **malou sadu vlastních fotografií** (blok galerie páru, případně hero): předsvatební focení, příběh páru. Velké galerie celé svatby a fotky od hostů přes QR kód zůstávají v samostatném projektu `g-gallery` (fotograf, `photos.svatebni-fotograf-cechy.cz`). Náš web na ně jen odkazuje (odkaz na externí galerii v administraci, volitelně za PINem hostů).

Požadavky: výkon (Core Web Vitals, více velikostí), popisek povinný nebo označení jako dekorativní (WCAG 1.1.1), minimalizace osobních údajů (EXIF/GPS pryč), soukromí (weby párů jsou `noindex`, fotky nesmí jít najít ani prolistovat), export před vypršením webu (FR-LC-2), mazání podle retence.

Provozní fakta, ze kterých návrh vychází:

- Majitel už R2 používá v `g-gallery` (jurisdikce EU, nahrávání přes podepsané URL, zmenšení a odstranění GPS v prohlížeči). Tuto logiku převezmeme upravenou, místo psaní od nuly.
- DNS domény `se-vezmou.cz` je ve Vercelu (nutné pro wildcard `*.se-vezmou.cz`). Cloudflare Image Transformations a vlastní doména R2 vyžadují zónu v Cloudflare, takže **pro `se-vezmou.cz` nejsou k dispozici**. Postup `g-gallery` s `cdn.<doména>/cdn-cgi/image/…` zde nejde použít.

## Možnosti

| Možnost                                                 | Pro                                                                                                              | Proti                                                                                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| A. R2, předem zmenšené varianty, podepsané URL          | Žádná závislost na DNS. Bez poplatků za odchozí přenos. Přenos obrázků mimo Vercel. Funguje s převzatou logikou. | Pevné velikosti místo transformací za běhu. Podepsané adresy a cache je potřeba navrhnout (viz Doručování).         |
| B. R2 s CDN hostem na zóně `svatebni-fotograf-cechy.cz` | Cloudflare transformace a cache.                                                                                 | V adresách fotek na webech párů by byla doména fotografa. Vazba na cizí zónu a její nastavení.                      |
| C. Supabase Storage / Vercel Blob                       | Jednoduché.                                                                                                      | Supabase Storage odpadá (ADR 0011). Vercel Blob: další dodavatel bez převzaté logiky, přístup podle svatby mimo DB. |

Ceny jsou záměrně neuvedené, ověří se v ceníku `[OTÁZKA]`.

## Rozhodnutí

**Varianta A: Cloudflare R2, nový samostatný bucket pro tento projekt** (ne sdílený s `g-gallery`), **jurisdikce EU** (nastavuje se při vytvoření bucketu a nejde změnit), **privátní**. Přístup jen přes serverové přihlašovací údaje a podepsané adresy. Hranice svatby je předpona klíče `{wedding_id}/…`.

Proměnné prostředí (jen serverové, na Vercelu): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT` (`https://<account-id>.eu.r2.cloudflarestorage.com`), `S3_REGION=auto`. Klíč R2 je omezený jen na tento bucket.

### Postup nahrání

1. Klient požádá server o nahrání (Server Action). Server ověří relaci správce a svatbu, zkontroluje kvótu a vrátí **krátkodobě platnou podepsanou adresu pro PUT** (`aws4fetch`) do karantény `incoming/{wedding_id}/{upload_id}`. Bajty fotografie neprocházejí Vercelem (limit těla požadavku).
2. Prohlížeč před nahráním: otočí podle EXIF orientace, **odstraní EXIF a GPS**, převede do sRGB a vytvoří pevné varianty (šířky 640, 1280 a 1920 px, nezvětšovat nad původní rozměr, výstup **WebP**). Původní soubor se **neukládá**. (AVIF z prohlížeče není spolehlivě dostupný, proto jen WebP.) Převzato z `g-gallery` (zmenšování, odstranění GPS, příprava ve workeru, fronta nahrávání).
3. Nahrají se jen varianty. Klient pak zavolá serverové „dokončit“.
4. **Ověření na serveru** (klientovi se nevěří): z karantény se načte začátek objektu a ověří se **skutečný typ podle obsahu** (magická čísla WebP/JPEG/PNG, ne přípona ani `Content-Type`), velikost, rozměry v pixelech (ochrana proti „decompression bomb“) a počet. SVG od uživatelů se **nepřijímá**. Chybné objekty se smažou. Úspěšné se přesunou pod `{wedding_id}/{media_id}/{width}.webp`.
5. Záznam Média v databázi (svatba, klíče, rozměry, popisek v každém jazyce, příznak dekorativní, stav). Fotografie bez popisku a bez příznaku „dekorativní“ se nezveřejní.
6. Pravidlo životního cyklu bucketu: `incoming/` se maže po 1 dni (opuštěná nahrávání).

Počáteční limity (návrh k potvrzení po měření v betě `[OTÁZKA]`): nejvýše 12 fotografií v galerii páru, nejvýše 15 MB na původní soubor v prohlížeči, nejdelší strana nejvýše 6 000 px. Limity se vynucují na serveru.

### Popisek povinný

Uložení fotografie vyžaduje popisek (alespoň v jazyce webu, další jazyky s upozorněním na chybějící překlad), nebo zaškrtnutí „dekorativní“ (prázdný `alt`). Kontrola je na serveru i v rozhraní.

### Doručování

- Obrázky se podávají **přes vlastní adresu na hostiteli webu páru** (`/media/{media_id}/{width}`), která po kontrole svatby a stavu (po retenci 404) odpoví **přesměrováním na čerstvě podepsanou adresu R2**. Díky tomu v HTML není adresa s vypršením a stránku lze cachovat. Bajty obrázků jdou z R2 přímo, ne přes Vercel.
- Platnost podpisu se zaokrouhluje na časová okna, aby byla adresa po dobu okna stabilní a prohlížeč ji cachoval. Přesměrování má krátké `Cache-Control`, hlavička `X-Robots-Tag: noindex`.
- `<img>` se `srcset` (640, 1280, 1920) a rozměry kvůli posunu rozvržení, `loading="lazy"` mimo první obrazovku.
- Citlivé galerie (odkaz za PINem hostů) mají stejnou kontrolu relace hosta jako ostatní citlivé bloky.
- Bucket se nikdy nevypisuje a nemá veřejnou adresu.

### Mazání a export

- Smazání webu nebo uplynutí retence smaže předponu `{wedding_id}/` (výpis a mazání přes S3 API) a záznamy Médií. Je součástí úlohy retence M10 a zapisuje se do auditu bez osobních údajů.
- Export před vypršením: archiv největších variant ke stažení přes podepsanou adresu.
- Zálohy: R2 samo nezálohuje. Doba uchování případných záloh musí být slučitelná s retencí `[OTÁZKA]` pro právníka. Smlouva o zpracování s Cloudflare a ověření umístění dat (jurisdikce EU) `[OTÁZKA]`.

## Co se z `g-gallery` přebírá a co ne

- **Přebírá se (upraveně):** příprava a zmenšení v prohlížeči, odstranění GPS a čtení orientace, fronta a obnovení nahrávání, kontrola typů a limitů nahrávání, mřížka a lightbox, hlavička pro stabilní podepsané adresy.
- **Nepřebírá se:** `better-auth`, Prisma, ZIP workery, oblíbené, tiskové fronty, push notifikace, sdílecí odkazy s expirací, Cloudflare transformace. Fotky od hostů přes QR a velké galerie zůstávají v `g-gallery`.

## Důsledky

- **Cena:** R2 bez poplatků za odchozí přenos, platí se za úložiště a operace (ověřit v ceníku). Tři velikosti ve WebP znamenají tři soubory na fotografii, proto malý limit na svatbu. Žádný čas funkce na Vercelu za zpracování obrázků, protože zmenšuje prohlížeč.
- **Bezpečnost:** privátní bucket, podpisy s krátkou platností, ověření obsahu na serveru. Odstranění EXIF/GPS v prohlížeči chrání pár před únikem polohy, ale **neumí zabránit, aby si ho zlý klient nechal**. Dopadá jen na jeho vlastní data, proto je serverová kontrola typu a rozměrů povinná a spolehnutí na klienta jen pro soukromí. R2 nemá politiky přístupu na úrovni řádků: izolace svatby stojí na předponě klíče a na tom, že podepisuje jen server po kontrole v databázi (hlídají to testy).
- **Údržba:** vlastní zpracování v prohlížeči, bez nativních závislostí na serveru (výhoda oproti `sharp`). Přenos mezi projekty je kopie s úpravami, ne sdílená knihovna: změny v `g-gallery` se nepřenášejí samy.
- **Otevřené:** limity a počty `[OTÁZKA]`, ceny `[OTÁZKA]`, DPA a záložní politika `[OTÁZKA]`. Pokud se později ukáže, že pevné velikosti nestačí, lze přejít na variantu B (CDN host na zóně v Cloudflare) beze změny datového modelu, protože klíče a Média jsou stejné.
