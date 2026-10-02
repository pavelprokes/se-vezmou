# ADR 0006: Úložiště a zpracování fotografií

Stav: navrženo (čeká na schválení majitele)

## Kontext

Pár nahrává fotografie do galerie a případně do hera webu. Fotografie hostů přes QR jsou mimo MVP. Požadavky zadání: moderní formáty ve více velikostech (výkon, Core Web Vitals), popisek povinný, nebo označit jako dekorativní (WCAG 1.1.1), minimalizace osobních údajů, export fotografií před vypršením webu (FR-LC-2), mazání podle retence. Fotografie mohou vyzrazovat polohu (EXIF/GPS) a zobrazují lidi, takže jde o osobní údaje.

## Možnosti

| Možnost                  | Pro                                                                                                                                   | Proti                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| A. Supabase Storage (EU) | Stejný dodavatel jako databáze (ADR o databázi), privátní buckety, politiky přístupu vedle dat, podepsané adresy s omezenou platností | Vazba na jednoho dodavatele. Transformace obrázků za příplatek nebo v tarifu, proto je zpracování vlastní     |
| B. Vercel Blob           | Blízko hostingu, jednoduché API                                                                                                       | Přístupová kontrola podle svatby a mazání podle retence by byly mimo databázi. Umístění dat a podmínky ověřit |
| C. Cloudflare R2         | Bez poplatků za odchozí přenos, S3 API                                                                                                | Další dodavatel a účet, DPA a umístění ověřit, politiky přístupu mimo databázi                                |

Ceny nejsou zde uvedeny, ověří se v ceníku `[OTÁZKA]`.

## Rozhodnutí (doporučení)

Zvolit **A: Supabase Storage, projekt v regionu EU, privátní bucket**. Soubory se nikdy nepublikují přímou veřejnou adresou bucketu.

### Postup nahrání

1. Klient požádá server o nahrání (Server Action nebo route). Server ověří relaci správce a svatbu, zkontroluje celkovou kvótu svatby `[OTÁZKA]`.
2. Soubor se nahraje na server (nebo přes krátkodobě platnou nahrávací adresu) do **původního** privátního prostoru. Původní soubor se po zpracování nezveřejňuje.
3. Server ověří **skutečný typ podle obsahu** (ne podle přípony nebo hlavičky `Content-Type`). Povolit jen běžné rastrové formáty (JPEG, PNG, WebP, HEIC dle podpory knihovny `[OTÁZKA]`). SVG od uživatelů **nepřijímat** (riziko skriptů).
4. Limity: maximální velikost souboru, maximální rozměry v pixelech (ochrana proti „decompression bomb“), maximální počet fotografií na svatbu. Konkrétní čísla `[OTÁZKA]`, doporučení stanovit po měření v betě. Limit vynutit na serveru, ne jen v prohlížeči.
5. Zpracování knihovnou **sharp** na serveru: otočení podle EXIF orientace, pak **odstranění všech metadat včetně EXIF a GPS** (sharp je ve výchozím stavu nepřenáší, ověřit testem), převod do sRGB.
6. Výstupy: šířky **640, 1280 a 1920 px** ve **WebP a AVIF** (nezvětšovat nad původní rozměr). Uložit do privátního bucketu pod cestou s identifikátorem svatby (`{wedding_id}/{media_id}/{width}.{format}`).
7. Záznam Média v databázi: svatba, cesty, rozměry, popisek v každém jazyce, příznak dekorativní, stav zpracování.
8. Původní soubor smazat po úspěšném zpracování, nebo ponechat jen na pár dní pro opakované zpracování a poté smazat (doporučení: smazat hned, pár má originál u sebe).

### Popisek povinný

Uložení fotografie do galerie vyžaduje buď popisek (alespoň v jazyce webu, další jazyky s upozorněním na chybějící překlad), nebo zaškrtnutí „dekorativní“. Kontrola je na serveru i v rozhraní. Dekorativní obrázek dostane prázdný `alt`. Fotografie bez rozhodnutí se nezveřejní.

### Doručování

- Veřejná část (galerie na webu páru): server vygeneruje podepsané adresy s krátkou platností, nebo obrázky podává přes vlastní route s kontrolou svatby a stavu (po retenci 404). Nikdy nevypisovat obsah bucketu. Doporučení: vlastní route na hostiteli webu páru, jednotná hlavička `Cache-Control` a `X-Robots-Tag: noindex`.
- Obrázky podávat v `<picture>` se `srcset`, AVIF před WebP, s rozměry kvůli posunu rozvržení.
- Politiky Supabase Storage (RLS) zakazují čtení a zápis mimo prefix vlastní svatby. Klíč `service_role` je jen na serveru.

### Mazání a export

- Smazání webu a uplynutí retence smaže soubory (prefix svatby) a záznamy Médií. Výmaz je součástí úlohy retence (viz `docs/security-privacy.md`) a zapisuje se do auditu bez osobních údajů.
- Export před vypršením: archiv původních zpracovaných variant (největší varianta) ke stažení přes podepsanou adresu.
- Zálohy databáze a úložiště: doba uchování záloh musí být slučitelná s retencí, jinak se smazané údaje v zálohách vrátí po obnově `[OTÁZKA]` pro právníka.

## Důsledky

- **Cena:** úložiště a přenos nejsou zdarma při růstu. Tři velikosti ve dvou formátech znamenají zhruba šest souborů na fotografii, proto kvóta na svatbu. Zpracování sharp spotřebuje čas funkce na Vercelu (nutné ověřit limity doby běhu a paměti) `[OTÁZKA]`.
- **Bezpečnost:** odstranění EXIF/GPS zabraňuje úniku polohy. Privátní bucket a podepsané adresy brání prolistování. Validace obsahu a limity omezují zneužití (nahrávání škodlivých souborů, vyčerpání úložiště). Fotografie lidí je osobní údaj: pár je správce, provozovatel zpracovatel.
- **Údržba:** vlastní kód zpracování (sharp je nativní závislost, hlídat kompatibilitu s prostředím Vercelu a bezpečnostní aktualizace). Jedna sada politik přístupu vedle databáze. Možný pozdější přesun na R2 (C) díky tenké vrstvě `storage` s rozhraním nahrát, podepsat adresu, smazat prefix.
