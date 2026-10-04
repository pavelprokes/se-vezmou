# TODO (otevřené úkoly mimo aktuální vývoj)

Stav k 3. 10. 2026. Úkoly, které čekají na majitele nebo na dokončení služby.

## Právo a obsah

- [ ] **Podmínky služby** (`[PODMÍNKY]`, `/podminky`, `/en/terms`): vymyslet a napsat až po dokončení služeb (cena po zaváděcím provozu, zpracovatelská ujednání podle čl. 28 GDPR). Text musí ověřit skutečný právník. Navazuje OQ-11.
- [ ] **Zásady zpracování osobních údajů** (`/soukromi`, `/en/privacy`) a **prohlášení o přístupnosti**: dokončit s podmínkami; poté zrušit `noindex` a přidat do `indexableRoutes` v `src/seo/sitemap.ts`.
- [ ] **Skutečné reference**: přidat na úvodní stránku sekci s opravdovými recenzemi se souhlasem autorů (např. od párů, kterým Pavel fotil svatbu, nebo od prvních uživatelů zaváděcího provozu). Zástupné karty jsou odstraněné, na úvodní stránce je teď jen sekce Oznámení o spuštění (`launch-section.tsx`). Žádné vymyšlené recenze, bez `Review` ve strukturovaných datech, dokud nejsou skutečné.

## Cena po zaváděcím provozu (rozhodnout)

Na webu je dnes všude „0 Kč po dobu zaváděcího provozu“ (slovo „zdarma“ záměrně nepoužíváme kvůli reklamám a SEO). Návrh, který je třeba schválit a pak zapsat do `src/config/pricing.ts` a podmínek (OQ-11):

- **Koncept**: 0 Kč vždy (průvodce, všechny šablony, soukromý náhled).
- **Zveřejnění webu**: **990 Kč jednorázově** za svatbu (ne měsíčně, bez poplatků z darů); web běží do svatby a 12 měsíců po ní.
- **Nastavíme za vás**: **2 990 Kč jednorázově** (služba „vyplníme web za vás“).
- Otevřené: zda weby zveřejněné v zaváděcím provozu zůstanou za 0 Kč do své svatby (doporučuji ano, je to férové a nepálí to první uživatele), a kdy zaváděcí provoz skončí (`introEndsOn`).
- Čísla jsou odhad bez průzkumu trhu; před zveřejněním je porovnat s konkurencí a upravit.

## SEO a provoz

- [ ] **Google Search Console, Bing Webmaster Tools, Seznam Webmaster**: ověřit doménu `se-vezmou.cz` (DNS TXT) a odeslat `sitemap.xml`.
- [ ] **Logo**: tři návrhy jsou v `docs/brand/` (`logo-a-prsteny.svg`, `logo-b-oblouk.svg`, `logo-c-adresa.svg`, text převedený na křivky, barvy značky). Vybrat jedno, nasadit do hlavičky, favicony a OG obrázku (`scripts/generate-og.mjs`).
- [ ] **Organization `logo` a `sameAs`**: po výběru loga doplnit do `src/seo/json-ld.ts` logo a odkazy na profily na sítích (kandidáti na `sameAs`: `svatebni-fotograf-cechy.cz`, `photos.svatebni-fotograf-cechy.cz`).
- [ ] **Záložní kontakt** `pavel@pavelprokes.cz`: nastavit jako přeposílání / `Reply-To` u `info@se-vezmou.cz` (nezveřejňovat na webu).
- [ ] Linkbuilding a měření (CrUX, analytika) po spuštění Search Console; detaily v `docs/seo-audit-2026-10.md`.

## Hotovo

- [x] Apex `se-vezmou.cz` je primární doména, `www` na něj přesměrovává (Vercel, 3. 10. 2026).
- [x] Provozovatel Pavel Prokeš, IČO 87877601, Křižíkova 424/127, Praha 8 (ARES).
- [x] Kontakt `info@se-vezmou.cz`.
