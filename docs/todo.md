# TODO (otevřené úkoly mimo aktuální vývoj)

Stav k 3. 10. 2026. Úkoly, které čekají na majitele nebo na dokončení služby.

## Právo a obsah

- [ ] **Podmínky služby** (`[PODMÍNKY]`, `/podminky`, `/en/terms`): vymyslet a napsat až po dokončení služeb (cena po zaváděcím provozu, zpracovatelská ujednání podle čl. 28 GDPR). Text musí ověřit skutečný právník. Navazuje OQ-11.
- [ ] **Zásady zpracování osobních údajů** (`/soukromi`, `/en/privacy`) a **prohlášení o přístupnosti**: dokončit s podmínkami; poté zrušit `noindex` a přidat do `indexableRoutes` v `src/seo/sitemap.ts`.
- [ ] **Skutečné reference**: nahradit tři „Zástupný text" opravdovými recenzemi se souhlasem autorů (např. od párů, kterým Pavel fotil svatbu, nebo od prvních uživatelů zaváděcího provozu). Do té doby je v sekci čekací listina. Žádné vymyšlené recenze.

## SEO a provoz

- [ ] **Google Search Console, Bing Webmaster Tools, Seznam Webmaster**: ověřit doménu `se-vezmou.cz` (DNS TXT) a odeslat `sitemap.xml`.
- [ ] **Organization `logo` a `sameAs`**: dodat logo (PNG/SVG) a odkazy na profily na sítích, doplnit do `src/seo/json-ld.ts`.
- [ ] **Záložní kontakt** `pavel@pavelprokes.cz`: nastavit jako přeposílání / `Reply-To` u `info@se-vezmou.cz` (nezveřejňovat na webu).
- [ ] Linkbuilding a měření (CrUX, analytika) po spuštění Search Console; detaily v `docs/seo-audit-2026-10.md`.

## Hotovo

- [x] Apex `se-vezmou.cz` je primární doména, `www` na něj přesměrovává (Vercel, 3. 10. 2026).
- [x] Provozovatel Pavel Prokeš, IČO 87877601, Křižíkova 424/127, Praha 8 (ARES).
- [x] Kontakt `info@se-vezmou.cz`.

## Plán funkcí (část B zadání)

Stav repa je zmapovaný v `docs/audit-todo-2026-10.md`. Co už stojí, jen odškrtnout, částečné dotáhnout.

- [ ] **První verze:** skupiny hostů s programem, osobní odkaz a QR hosta s jazykem, sdílení pozvánky (WhatsApp, SMS, e-mail), tlačítko „přeložit“ se schválením párem, QR galerie na pozvánce, IBAN a BIC jako text s „Kopírovat“ v EN, heslo na web, banner změny termínu, upozornění páru na novou odpověď, politika hostingu po svatbě (rozpor s dnešními lhůtami viz audit A5).
- [ ] **Druhá verze:** zasedací pořádek, rozpočet, filtr hostů podle štítku s počty, heslo na jednotlivé stránky, tisknutelná karta s QR, EPC QR (GiroCode).
- [ ] **Vzhled:** plynulé přechody mezi stránkami (View Transitions, `prefers-reduced-motion`), dotažení designu šablon.
- [ ] **Později:** vlastní doména páru, placená publikace (jednorázově nebo ročně, bez poplatků z darů), služba „nastavíme web s vámi“, anglický alias domény.
