# ADR 0006: Úložiště a zpracování fotografií

Stav: rozhodnuto majitelem pro **Cloudflare R2** (2. 10. 2026), **implementováno v M7c** (odchylky a rozhodnutí implementace jsou na konci dokumentu). Podrobnosti doručování a limity jsou doporučení k potvrzení. Nahrazuje původní návrh se Supabase Storage (ADR 0011: aplikace mluví s Postgresem přímo a nemá klíč `service_role`, takže Supabase Storage odpadá).

## Kontext

Pár nahrává do webu **malou sadu vlastních fotografií** (blok galerie páru, případně hero): předsvatební focení, příběh páru. Velké galerie celé svatby a fotky od hostů přes QR kód zůstávají v samostatném projektu `g-gallery` (fotograf, `photos.svatebni-fotograf-cechy.cz`). Náš web na ně jen odkazuje (odkaz na externí galerii v administraci, volitelně za PINem hostů).

Nahrávat může kdokoli včetně správce **přímo z mobilu nebo foťáku, tedy velké originály**, a nikdo je předem nezmenšuje. Zmenšení tedy musí zajistit systém.

Požadavky: výkon (Core Web Vitals, více velikostí), popisek povinný nebo označení jako dekorativní (WCAG 1.1.1), minimalizace osobních údajů (EXIF/GPS pryč), soukromí (weby párů jsou `noindex`, fotky nesmí jít najít ani prolistovat), export před vypršením webu (FR-LC-2), mazání podle retence.

Provozní fakta, ze kterých návrh vychází:

- Majitel už R2 používá v `g-gallery` (jurisdikce EU, nahrávání přes podepsané URL, zmenšení v prohlížeči). Tuto logiku převezmeme upravenou, místo psaní od nuly.
- DNS domény `se-vezmou.cz` je ve Vercelu (nutné pro wildcard `*.se-vezmou.cz`). Cloudflare Image Transformations a vlastní doména R2 vyžadují zónu v Cloudflare, takže **pro `se-vezmou.cz` nejsou k dispozici**. Postup `g-gallery` s `cdn.<doména>/cdn-cgi/image/…` zde nejde použít.

## Možnosti

| Možnost                                                 | Pro                                                                                                              | Proti                                                                                                                                                    |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. R2, zmenšení na serveru (`sharp`), podepsané URL     | Žádná závislost na DNS. Bez poplatků za odchozí přenos. Přenos obrázků mimo Vercel. Funguje s převzatou logikou. | Pevné velikosti místo transformací za běhu. Zpracování na serveru spotřebuje čas funkce. Podepsané adresy a cache je potřeba navrhnout (viz Doručování). |
| B. R2 s CDN hostem na zóně `svatebni-fotograf-cechy.cz` | Cloudflare transformace a cache.                                                                                 | V adresách fotek na webech párů by byla doména fotografa. Vazba na cizí zónu a její nastavení.                                                           |
| C. Supabase Storage / Vercel Blob                       | Jednoduché.                                                                                                      | Supabase Storage odpadá (ADR 0011). Vercel Blob: další dodavatel bez převzaté logiky, přístup podle svatby mimo DB.                                      |

Ceny jsou záměrně neuvedené, ověří se v ceníku `[OTÁZKA]`.

## Rozhodnutí

**Varianta A: Cloudflare R2, nový samostatný bucket pro tento projekt** (ne sdílený s `g-gallery`), **jurisdikce EU** (nastavuje se při vytvoření bucketu a nejde změnit), **privátní**. Přístup jen přes serverové přihlašovací údaje a podepsané adresy. Hranice svatby je předpona klíče `{wedding_id}/…`.

Proměnné prostředí (jen serverové, na Vercelu): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT` (`https://<account-id>.eu.r2.cloudflarestorage.com`), `S3_REGION=auto`. Klíč R2 je omezený jen na tento bucket.

### Postup nahrání

Počítá se s tím, že kdokoli (pár i správce) nahrává **velké originály rovnou z mobilu nebo foťáku** a nikdo je předem nezmenšuje. Autoritativní zmenšení proto dělá server. Zmenšení v prohlížeči je jen volitelná optimalizace rychlosti.

1. Klient požádá server o nahrání (Server Action). Server ověří relaci správce a svatbu, zkontroluje kvótu a vrátí **krátkodobě platnou podepsanou adresu pro PUT** (`aws4fetch`) do karantény `incoming/{wedding_id}/{upload_id}`. Bajty fotografie neprocházejí Vercelem (limit těla požadavku).
2. Prohlížeč (volitelně, jen pokud to zvládne): otočí podle EXIF orientace a zmenší původní soubor na rozumnou velikost (nejdelší strana nejvýše 4 000 px, JPEG/WebP), aby nahrávání z mobilní sítě netrvalo zbytečně dlouho. Když zmenšení selže (paměť telefonu, neznámý formát), nahraje se **původní soubor**. Převzato z `g-gallery` (příprava ve workeru, fronta nahrávání a obnovení, kontrola typů). Pole pro výběr souboru má `accept` jen na JPEG, PNG a WebP: iOS pak při výběru z knihovny převede HEIC na JPEG samo. Skutečný HEIC bez převodu se odmítne srozumitelnou zprávou.
3. Klient zavolá serverové „dokončit“.
4. **Zpracování na serveru** (Server Action s vyšším `maxDuration`, `sharp`): objekt se čte z karantény proudově.
   - Ověření **skutečného typu podle obsahu** (ne podle přípony nebo `Content-Type`), limitu velikosti a rozměrů v pixelech (`limitInputPixels`, ochrana proti „decompression bomb“). SVG od uživatelů se **nepřijímá**.
   - Otočení podle EXIF orientace, převod do sRGB, **odstranění všech metadat včetně EXIF a GPS** (výchozí chování `sharp`, ověřit testem).
   - Výstup: šířky **640, 1280 a 1920 px** ve **WebP a AVIF** (nezvětšovat nad původní rozměr). Uloží se pod `{wedding_id}/{media_id}/{width}.{format}`.
   - **Původní soubor se po úspěšném zpracování smaže** (pár má originál u sebe). Chybné objekty se smažou hned.
5. Záznam Média v databázi (svatba, klíče, rozměry, popisek v každém jazyce, příznak dekorativní, stav zpracování). Fotografie bez popisku a bez příznaku „dekorativní“ se nezveřejní.
6. Pravidlo životního cyklu bucketu: `incoming/` se maže po 1 dni (opuštěná nahrávání a nedokončené zpracování), takže originál s GPS v karanténě nepřežije déle.

Počáteční limity (návrh k potvrzení po měření v betě `[OTÁZKA]`): nejvýše 12 fotografií v galerii páru, nejvýše 40 MB na nahrávaný soubor, nejvýše 100 megapixelů. Limity se vynucují na serveru.

### Popisek povinný

Uložení fotografie vyžaduje popisek (alespoň v jazyce webu, další jazyky s upozorněním na chybějící překlad), nebo zaškrtnutí „dekorativní“ (prázdný `alt`). Kontrola je na serveru i v rozhraní.

### Doručování

- Obrázky se podávají **přes vlastní adresu na hostiteli webu páru** (`/media/{media_id}/{width}`), která po kontrole svatby a stavu (po retenci 404) odpoví **přesměrováním na čerstvě podepsanou adresu R2**. Díky tomu v HTML není adresa s vypršením a stránku lze cachovat. Bajty obrázků jdou z R2 přímo, ne přes Vercel.
- Platnost podpisu se zaokrouhluje na časová okna, aby byla adresa po dobu okna stabilní a prohlížeč ji cachoval. Přesměrování má krátké `Cache-Control`, hlavička `X-Robots-Tag: noindex`.
- `<picture>` se `srcset` (640, 1280, 1920), AVIF před WebP, s rozměry kvůli posunu rozvržení, `loading="lazy"` mimo první obrazovku.
- Citlivé galerie (odkaz za PINem hostů) mají stejnou kontrolu relace hosta jako ostatní citlivé bloky.
- Bucket se nikdy nevypisuje a nemá veřejnou adresu.

### Mazání a export

- Smazání webu nebo uplynutí retence smaže předponu `{wedding_id}/` (výpis a mazání přes S3 API) a záznamy Médií. Je součástí úlohy retence M10 a zapisuje se do auditu bez osobních údajů.
- Export před vypršením: archiv největších variant ke stažení přes podepsanou adresu.
- Zálohy: R2 samo nezálohuje. Doba uchování případných záloh musí být slučitelná s retencí `[OTÁZKA]` pro právníka. Smlouva o zpracování s Cloudflare a ověření umístění dat (jurisdikce EU) `[OTÁZKA]`.

## Co se z `g-gallery` přebírá a co ne

- **Přebírá se (upraveně):** nahrávání přes podepsané URL, fronta a obnovení nahrávání, volitelná příprava v prohlížeči (zmenšení před odesláním), kontrola typů a limitů nahrávání, mřížka a lightbox, hlavička pro stabilní podepsané adresy. Odstranění EXIF/GPS a zmenšení na varianty dělá u nás autoritativně server.
- **Nepřebírá se:** `better-auth`, Prisma, ZIP workery, oblíbené, tiskové fronty, push notifikace, sdílecí odkazy s expirací, Cloudflare transformace. Fotky od hostů přes QR a velké galerie zůstávají v `g-gallery`.

## Důsledky

- **Cena:** R2 bez poplatků za odchozí přenos, platí se za úložiště a operace (ověřit v ceníku). Tři velikosti ve dvou formátech znamenají šest souborů na fotografii, proto malý limit na svatbu. Zpracování spotřebuje **čas funkce na Vercelu** (jedna fotografie řádově sekundy, limity doby běhu a paměti na zvoleném tarifu ověřit `[OTÁZKA]`). Nahrávání probíhá po jednom souboru a fronta běží v prohlížeči, takže jedna funkce nezpracovává celou sadu najednou.
- **Bezpečnost:** privátní bucket, podpisy s krátkou platností, autoritativní ověření obsahu a odstranění EXIF/GPS na serveru (nezávisí na klientovi). Originál s GPS leží v karanténě nejvýše den a po zpracování se maže. R2 nemá politiky přístupu na úrovni řádků: izolace svatby stojí na předponě klíče a na tom, že podepisuje jen server po kontrole v databázi (hlídají to testy).
- **Údržba:** `sharp` je nativní závislost, hlídat kompatibilitu s prostředím Vercelu (Node 24) a bezpečnostní aktualizace. Přenos z `g-gallery` je kopie s úpravami, ne sdílená knihovna: změny v `g-gallery` se nepřenášejí samy.
- **Omezení:** HEIC se na serveru nedekóduje (patentově omezená podpora v předsestavené `sharp`), proto `accept` na JPEG, PNG a WebP, aby iOS převedl HEIC při výběru. Pro soubory, které prohlížeč ani server nezvládnou, je srozumitelná chybová zpráva s návodem (export do JPEG).
- **Otevřené:** limity a počty `[OTÁZKA]`, ceny `[OTÁZKA]`, DPA a záložní politika `[OTÁZKA]`, limity funkcí na Vercelu `[OTÁZKA]`. Pokud se později ukáže, že pevné velikosti nestačí, lze přejít na variantu B (CDN host na zóně v Cloudflare) beze změny datového modelu, protože klíče a Média jsou stejné.

## Implementace (M7c)

Kód: `src/lib/storage` (rozhraní `PhotoStorage`, implementace `r2.ts` přes `aws4fetch`, `memory.ts` pro vývoj a testy), `src/lib/media` (limity, zpracování `sharp`, služba nahrávání), `src/lib/db/media.ts`, migrace `20261008120000_media.sql`, doručení `src/app/h/tenant/[slug]/[locale]/media/[id]/[width]/route.ts`, editor `src/components/admin/photos.tsx`, galerie a prohlížeč `src/components/site/blocks/gallery.tsx` a `gallery-lightbox.tsx`. Postup nasazení pro majitele (bucket, token, pravidlo životního cyklu, CORS, proměnné) je v `supabase/README.md`.

**Výběr úložiště** (`getStorage`): proměnné `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (volitelně `R2_ENDPOINT`, `S3_REGION`) nastavené -> R2. Bez nich mimo produkci úložiště v paměti (jedna instance na proces, nahrání i doručení fungují přes podepsané adresy na interní cestu `/api/dev-storage`), takže vývoj a e2e testy fungují bez Cloudflare; e2e proti produkčnímu sestavení ho zapíná `STORAGE_DRIVER=memory` (na `VERCEL_ENV=production` se ignoruje). V produkci bez R2 se aplikace nerozbije při startu: výpis a mazání nic nedělají, ale jakékoli použití fotografií selže srozumitelně (`not_configured`, hláška v editoru, v logu názvy chybějících proměnných) a úloha retence **nesmaže web, který má fotografie**, dokud úložiště není nastavené.

**Odchylky a upřesnění proti textu rozhodnutí**

- **Popisek při zveřejnění, ne při uložení.** Fotografie se po nahrání uloží i bez popisku (jinak by se popisek musel zadat ještě před nahráním), ale **nezveřejní se**: při sestavení snímku se vynechá, editor ji hlásí upozorněním a v seznamu. Kontrola `media_alt_required` v databázi proto odpadla. Chybějící překlad (popisek jen v jednom jazyce) zveřejnění nebrání (zobrazí se dostupný jazyk, `lang` se označí).
- **Rozměry média** (`media.width`, `height`) jsou rozměry největší varianty (poměr stran pro `<img width height>`), ne originálu. Šířky variant: 640, 1280 a 1920 px, jen ty nepřesahující originál; je-li originál menší než 1920 px a o víc než 10 % větší než nejbližší menší varianta, přibude jeho vlastní šířka (nikdy se nezvětšuje).
- **Velikost při podepsaném PUT.** `aws4fetch` nepodepisuje `Content-Length` ani `Content-Type`, strop 40 MB proto nelze vynutit podpisem. Server ho vynucuje při dokončení (`HEAD` a čtení proudu se stropem, nad limit se objekt hned smaže); pravidlo bucketu maže karanténu po dni. Žádost o adresu odmítne deklarovanou velikost nad limit a databáze kvótu 12 fotografií hlídá atomicky (zámek svatby).
- **Formát v adrese:** `/media/{id}/{šířka}?f=avif|webp` (výchozí WebP). Přípona v cestě by proxy (`isStaticAsset`) nepřepsala na web páru.
- **Export:** místo archivu ZIP odkazy ke stažení největší varianty každé fotografie (`planPhotoExport` čte výpis předpony, `presignPhotoDownload`); u desítek fotografií je to pro pár i Vercel jednodušší a spolehlivější než archiv sestavovaný na serveru.
- **Zmenšení v prohlížeči** probíhá v hlavním vlákně přes `createImageBitmap` a `OffscreenCanvas` (asynchronní dekódování mimo vlákno), ne ve vlastním workeru; při selhání se nahraje původní soubor.
- **Smazání fotografie je okamžité** i z už zveřejněného webu: nejdřív se smažou soubory (originál i varianty), potom řádek; doručení vrací 404 a web média, která už nejsou v databázi, ze snímku vyřadí (`public_media_ids`), takže se po smazání nezobrazí rozbitý obrázek.
- **Fotografie jen pro hosty s PINem** (`galleryData.photosProtected`): v takovém případě nejsou ve veřejném snímku ani jako identifikátory, jsou v `SensitiveContent.photos` a doručení (`get_public_media`) je podá jen roli `guest_pin`.
- **Obrázek karty externí galerie** je médium druhu `card` (dekorativní, varianty 640 a 1280, mimo limit fotografií). Server ho stáhne se stejnými zárukami proti SSRF jako kartu (jen https na 443, žádné soukromé adresy ani po přesměrování, jen JPEG, PNG a WebP, strop 5 MB, časový limit), překóduje ho přes `sharp` jako každou fotografii a uloží; zůstanou dva nejnovější (současný a předchozí, na který může odkazovat zveřejněná verze). Bez nastaveného úložiště se nic nekopíruje (dnešní chování: karta bez obrázku).
- **Content-Security-Policy:** původ R2 se doplní do `img-src` (přesměrování z `/media/…` se kontroluje i na cíli) a `connect-src` (PUT originálu z prohlížeče) při sestavení, jen když jsou proměnné R2 nastavené (`next.config.ts`).
