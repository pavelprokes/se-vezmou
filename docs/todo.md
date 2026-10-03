# TODO (otevřené úkoly mimo aktuální vývoj)

Stav k 3. 10. 2026. Úkoly, které čekají na majitele nebo na dokončení služby.

## Právo a obsah

- [ ] **Podmínky služby** (`[PODMÍNKY]`, `/podminky`, `/en/terms`): vymyslet a napsat až po dokončení služeb (cena po zaváděcím provozu, zpracovatelská ujednání podle čl. 28 GDPR). Text musí ověřit skutečný právník. Navazuje OQ-11.
- [ ] **Zásady zpracování osobních údajů** (`/soukromi`, `/en/privacy`) a **prohlášení o přístupnosti**: dokončit s podmínkami; poté zrušit `noindex` a přidat do `indexableRoutes` v `src/seo/sitemap.ts`.
- [ ] **Skutečné reference**: přidat na úvodní stránku sekci s opravdovými recenzemi se souhlasem autorů (např. od párů, kterým Pavel fotil svatbu, nebo od prvních uživatelů zaváděcího provozu). Zástupné karty jsou odstraněné, na úvodní stránce je teď jen sekce Oznámení o spuštění (`launch-section.tsx`). Žádné vymyšlené recenze, bez `Review` ve strukturovaných datech, dokud nejsou skutečné.

## SEO a provoz

- [ ] **Google Search Console, Bing Webmaster Tools, Seznam Webmaster**: ověřit doménu `se-vezmou.cz` (DNS TXT) a odeslat `sitemap.xml`.
- [ ] **Organization `logo` a `sameAs`**: dodat logo (PNG/SVG) a odkazy na profily na sítích, doplnit do `src/seo/json-ld.ts`.
- [ ] **Záložní kontakt** `pavel@pavelprokes.cz`: nastavit jako přeposílání / `Reply-To` u `info@se-vezmou.cz` (nezveřejňovat na webu).
- [ ] Linkbuilding a měření (CrUX, analytika) po spuštění Search Console; detaily v `docs/seo-audit-2026-10.md`.

## Hotovo

- [x] Apex `se-vezmou.cz` je primární doména, `www` na něj přesměrovává (Vercel, 3. 10. 2026).
- [x] Provozovatel Pavel Prokeš, IČO 87877601, Křižíkova 424/127, Praha 8 (ARES).
- [x] Kontakt `info@se-vezmou.cz`.
