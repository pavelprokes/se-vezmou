# TODO (otevřené úkoly mimo aktuální vývoj)

Stav k 3. 10. 2026. Úkoly, které čekají na majitele nebo na dokončení služby.

## Právo a obsah

- [ ] **Podmínky služby** (`[PODMÍNKY]`, `/podminky`, `/en/terms`): vymyslet a napsat až po dokončení služeb (cena po zaváděcím provozu, zpracovatelská ujednání podle čl. 28 GDPR). Text musí ověřit skutečný právník. Navazuje OQ-11.
- [ ] **Zásady zpracování osobních údajů** (`/soukromi`, `/en/privacy`) a **prohlášení o přístupnosti**: dokončit s podmínkami; poté zrušit `noindex` a přidat do `indexableRoutes` v `src/seo/sitemap.ts`.
- [ ] **Skutečné reference**: přidat na úvodní stránku sekci s opravdovými recenzemi se souhlasem autorů (jen od párů, které web na se-vezmou.cz opravdu použily, např. první uživatelé; recenze focení sem nepatří). Místo v kódu je připravené: recenze se zapisují do `src/config/testimonials.ts` (postup a pravidla v komentáři), sekce „Co říkají páry“ se ukáže sama, jakmile seznam není prázdný. Žádné vymyšlené recenze, bez `Review` ve strukturovaných datech, dokud nejsou skutečné.

- [ ] **Zásady zpracování:** uvést Cloudflare Turnstile (ochrana průvodce a čekací listiny před roboty, IP adresa a signály prohlížeče) mezi dílčí zpracovatele.

## Newsletter (před první rozesílkou)

- [ ] Souhlasy s verzí `2026-10-v1` platí jen pro jedno oznámení o spuštění, ne pro newsletter: do rozesílky brát jen `consent_text_version = '2026-10-v2'` (nebo je požádat o nové potvrzení). Doplnit do OQ-68.
- [ ] Retence čekací listiny (12 měsíců od `consent_at`) u newsletteru tiše odstraní odběratele: rozhodnout, zda se lhůta počítá od poslední aktivity; aktualizovat OQ-60 a zásady zpracování údajů. Rozesílku zatím nikdo neodesílá.

## Cena

**Rozhodnuto 5. 10. 2026 (Pavel): služba zůstává za 0 Kč**, včetně zveřejnění. Placené zveřejnění (dříve návrh 990 Kč) a placená služba „Nastavíme za vás“ se nezavádějí. Podklad: srovnání v `docs/konkurence-2026-10.md` (web zdarma nabízí většina českých portálů i zahraničních služeb). Texty dál nesmějí slibovat „zdarma navždy“ (OQ-11); `src/config/pricing.ts` se nemění.

## SEO a provoz

- [x] **Google Search Console** (DNS TXT) a **Bing Webmaster Tools** ověřené 5. 10. 2026; **IndexNow** posílá adresy po každém produkčním nasazení. Postup a stav všech nástrojů: `docs/seo-nastroje.md`.
- [ ] **Search Console a Bing**: odeslat `sitemap.xml`, požádat o indexaci hlavních stránek (`docs/seo-nastroje.md`, krok 1).
- [ ] **Seznam Webmaster**: ověření meta značkou, kód do proměnné `SEZNAM_WMT` na Vercelu a redeploy (`docs/seo-nastroje.md`, krok 2).
- [ ] **Vercel Analytics a Speed Insights**: kód hotový, ověřit zapnutí v dashboardu (`docs/seo-nastroje.md`, krok 3).
- [ ] **Firmy.cz a Google Business Profile**: připravené texty v `docs/seo-nastroje.md` (krok 5).
- [x] **Logo**: vybrána varianta A (`docs/brand/`), nasazeno na web, ikony a OG obrázky.
- [ ] **Profily značky a `sameAs`**: logo je hotové; kód pro `sameAs` je připravený (`operator.profiles` v `src/config/operator.ts`), chybí založit profily (Instagram, Facebook, LinkedIn) a doplnit jejich adresy. Weby autora do `sameAs` nepatří (nejsou to profily stejné značky). Postup: `docs/seo-nastroje.md`, krok 4.
- [ ] **Záložní kontakt** `pavel@pavelprokes.cz`: nastavit jako přeposílání / `Reply-To` u `info@se-vezmou.cz` (nezveřejňovat na webu).
- [ ] Linkbuilding a měření (CrUX, analytika) po spuštění Search Console; detaily v `docs/seo-audit-2026-10.md`.

## Hotovo

- [x] Apex `se-vezmou.cz` je primární doména, `www` na něj přesměrovává (Vercel, 3. 10. 2026).
- [x] Provozovatel Pavel Prokeš, IČO 87877601, Křižíkova 424/127, Praha 8 (ARES).
- [x] Kontakt `info@se-vezmou.cz`.

## Plán funkcí (část B zadání)

Stav repa je zmapovaný v `docs/audit-todo-2026-10.md`. Co už stojí, jen odškrtnout, částečné dotáhnout.

- [x] **První verze, hotovo (#55 až #57):** sdílení pozvánky (WhatsApp, SMS, e-mail), QR galerie na pozvánce, IBAN a BIC jako text s „Kopírovat“, banner změny termínu, upozornění páru na novou odpověď, ubytování na mapě.
- [x] **Skupiny hostů s programem a osobní odkaz s QR (#65, #66), heslo na celý web, EPC QR (GiroCode) pro dary ze zahraničí, lhůty po svatbě podle zadání (web 12 měsíců, hosté 3 měsíce; čeká na právníka).**
- [ ] **První verze, zbývá:** tlačítko „přeložit“ se schválením párem.
- [ ] **Druhá verze:** zasedací pořádek, rozpočet, heslo na jednotlivé stránky (filtr hostů podle skupiny s počty a kartičky s QR jsou hotové v #65 a #66).
- [ ] **Seznam darů s rezervací** („tohle beru já“): pár zadá dary, host si jeden zarezervuje bez účtu, ostatní vidí, že je zabraný. Navazuje na blok Dary (za PINem). Běžné u konkurence (`docs/konkurence-2026-10.md`).
- [ ] **Zasedací pořádek:** stoly a přetažení hostů ze seznamu, tisk plánku a čísla stolu na jmenovky. Mají ho Svatebka, Weddee, WeMarry, Svatbovka.
- [ ] **Kvíz a hry pro hosty, rozpočet a checklist:** až po darech a zasedacím pořádku; rozmělňují pozici „nejlepší web pro hosty“.
- [x] **Vzhled, hotovo:** přechody mezi stránkami úvodního webu (View Transitions, `prefers-reduced-motion`), nový vzhled úvodní stránky (#61).
- [x] **Vzhled šablon webu páru:** navigace v jednom řádku (#70), klasické šablony ve vzhledu „Tiskovina“ (pruh Kdy / Kde / Odpověď pod jmény, číslované sekce, nadpis vlevo a obsah vpravo).
- [ ] **Později:** vlastní doména páru (dnes jen subdoména `jmeno-a-jmeno.se-vezmou.cz`, postup v `docs/audit-todo-2026-10.md` A5), anglický alias domény. Placená publikace a „nastavíme web s vámi“ se podle rozhodnutí o ceně nedělají.
