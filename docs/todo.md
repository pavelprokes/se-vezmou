# TODO (otevřené úkoly mimo aktuální vývoj)

Stav k 3. 10. 2026. Úkoly, které čekají na majitele nebo na dokončení služby.

## Právo a obsah

- [ ] **Podmínky služby** (`[PODMÍNKY]`, `/podminky`, `/en/terms`): vymyslet a napsat až po dokončení služeb (cena po zaváděcím provozu, zpracovatelská ujednání podle čl. 28 GDPR). Text musí ověřit skutečný právník. Navazuje OQ-11.
- [ ] **Zásady zpracování osobních údajů** (`/soukromi`, `/en/privacy`) a **prohlášení o přístupnosti**: dokončit s podmínkami; poté zrušit `noindex` a přidat do `indexableRoutes` v `src/seo/sitemap.ts`.
- [ ] **Skutečné reference**: přidat na úvodní stránku sekci s opravdovými recenzemi se souhlasem autorů (např. od párů, kterým Pavel fotil svatbu, nebo od prvních uživatelů zaváděcího provozu). Zástupné karty jsou odstraněné, na úvodní stránce je teď jen sekce Oznámení o spuštění (`news-section.tsx`). Žádné vymyšlené recenze, bez `Review` ve strukturovaných datech, dokud nejsou skutečné.

## Newsletter (před první rozesílkou)

- [ ] Souhlasy s verzí `2026-10-v1` platí jen pro jedno oznámení o spuštění, ne pro newsletter: do rozesílky brát jen `consent_text_version = '2026-10-v2'` (nebo je požádat o nové potvrzení). Doplnit do OQ-68.
- [ ] Retence čekací listiny (12 měsíců od `consent_at`) u newsletteru tiše odstraní odběratele: rozhodnout, zda se lhůta počítá od poslední aktivity; aktualizovat OQ-60 a zásady zpracování údajů. Rozesílku zatím nikdo neodesílá.

## Cena po zaváděcím provozu (rozhodnout)

Na webu je dnes „0 Kč“ a „teď“ (slovo „zdarma“ záměrně nepoužíváme kvůli reklamám a SEO a o „zaváděcím provozu“ veřejně nemluvíme, služba funguje a používají ji první páry). Návrh, který je třeba schválit a pak zapsat do `src/config/pricing.ts` a podmínek (OQ-11):

- **Koncept**: 0 Kč vždy (průvodce, všechny šablony, soukromý náhled).
- **Zveřejnění webu**: **990 Kč jednorázově** za svatbu (ne měsíčně, bez poplatků z darů); web běží do svatby a 12 měsíců po ní.
- **Nastavíme za vás**: **2 990 Kč jednorázově** (služba „vyplníme web za vás“).
- Otevřené: zda weby zveřejněné v zaváděcím provozu zůstanou za 0 Kč do své svatby (doporučuji ano, je to férové a nepálí to první uživatele), a kdy zaváděcí provoz skončí (`introEndsOn`).
- Čísla jsou odhad bez průzkumu trhu; před zveřejněním je porovnat s konkurencí a upravit.

## SEO a provoz

- [ ] **Google Search Console, Bing Webmaster Tools, Seznam Webmaster**: ověřit doménu `se-vezmou.cz` (DNS TXT) a odeslat `sitemap.xml`.
- [x] **Logo**: vybrána varianta A (`docs/brand/`), nasazeno na web, ikony a OG obrázky.
- [ ] **Organization `logo` a `sameAs`**: logo už je v `src/seo/json-ld.ts`; zbývá doplnit odkazy na profily na sítích (kandidáti na `sameAs`: `svatebni-fotograf-cechy.cz`, `photos.svatebni-fotograf-cechy.cz`).
- [ ] **Záložní kontakt** `pavel@pavelprokes.cz`: nastavit jako přeposílání / `Reply-To` u `info@se-vezmou.cz` (nezveřejňovat na webu).
- [ ] Linkbuilding a měření (CrUX, analytika) po spuštění Search Console; detaily v `docs/seo-audit-2026-10.md`.

## Hotovo

- [x] Apex `se-vezmou.cz` je primární doména, `www` na něj přesměrovává (Vercel, 3. 10. 2026).
- [x] Provozovatel Pavel Prokeš, IČO 87877601, Křižíkova 424/127, Praha 8 (ARES).
- [x] Kontakt `info@se-vezmou.cz`.
