# SEO audit se-vezmou.cz (říjen 2026)

> **Oprava po kontrole kódu:** původní verze chybně uváděla, že chybí `FAQPage` schema. Existuje (spolu se `SoftwareApplication` a `BreadcrumbList`). Zástupné texty (`[KONTAKT]`, `[PROVOZOVATEL, IČO]`, reference) jsou záměrné a čekají na údaje od majitele (`src/config/operator.ts`); do JSON-LD se nepíšou.

## Stav implementace

| Doporučení                                                                    | Stav                                                                       |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Nové title/meta domovské stránky (CS, EN)                                     | Hotovo                                                                     |
| Stránky cena, šablony, dvojjazyčný web (CS + EN), sitemapa, navigace, patička | Hotovo (+ testy)                                                           |
| Apex jako primární doména ve Vercelu                                          | **Čeká na Pavla** (nastavení mimo repozitář)                               |
| Doplnění provozovatele, kontaktu, podmínek, reálných recenzí                  | **Čeká na Pavla** (údaje)                                                  |
| Organization `logo`, `sameAs`                                                 | Čeká na podklady (logo, profily)                                           |
| GSC, Bing, Seznam Webmaster                                                   | **Čeká na Pavla** (ověření domény)                                         |
| Blog / pillar (8–12 článků)                                                   | Odloženo: obsah musí vzniknout z reálných podkladů, ne z vymyšlených faktů |
| Linkbuilding, měření (CrUX, analytika)                                        | Odloženo                                                                   |

Rozsah: kompletní audit marketingového webu (CS `/` a EN `/en`, právní stránky), keyword research, content gap, technika, srovnání s konkurencí, plus návrhy titulků/meta, content briefy a kalendář obsahu.

**Metodika a limity.** Bez připojeného Ahrefs/Semrush/GSC. Objemy a obtížnost jsou **orientační odhady** (Vysoký/Střední/Nízký) z SERP a web searche, ne přesná čísla. Konkurence byla měřena přímým stažením HTML (title, meta, H1, schema, velikost sitemapy). U The Knot a Minted se nepodařilo stáhnout HTML (blokace), jsou v srovnání jen z veřejných recenzí.

---

## 1. Executive summary

Technický základ je nadprůměrný: Next.js SSR, HSTS, CSP, korektní 404, rychlé TTFB (~0,1 s z CDN), hreflang CS/EN, sitemap, OG/Twitter karty, Organization, WebSite, SoftwareApplication, FAQPage a BreadcrumbList JSON-LD, prosté AI-search roboty povolené (OAI-SearchBot, Claude-SearchBot, PerplexityBot) a trénovací zakázané. Největší síla: **jediný český tvůrce svatebních webů s plnou CS/EN verzí** a vlastní subdoménou páru.

Tři priority s největším dopadem:

1. **Konflikt www/apex (kritické).** Vercel přesměrovává `se-vezmou.cz` → `www.se-vezmou.cz` (308), ale canonical, hreflang, sitemap, OG a JSON-LD ukazují na `se-vezmou.cz`. Canonical míří na URL, která přesměrovává zpět. Google si vybere sám a sitemap hlásí „přesměrované stránky".
2. **V produkci jsou zástupné texty** (`[KONTAKT]`, `[PODMÍNKY]`, `[PROVOZOVATEL, IČO]`, `[DD. MM. RRRR]`, tři „Zástupný text, nahradí skutečnou recenzi"). Je to chybějící E-E-A-T/trust signál, u firmy bez uvedeného provozovatele hrozí i problém se zařazením mezi důvěryhodné weby a s právní stránkou.
3. **Web má v indexu jen 2 URL + 6 právních.** Páry jsou záměrně noindex, takže **veškerá organika musí jít přes marketingový host**. Konkurenti mají 47–120 URL (brzy-svoji 121, Vowly 47) a blog. Bez cenové stránky, ukázek a obsahového hubu nebude web na hlavní dotazy („svatební web", „svatební web zdarma") rankovat.

Celkově: **solidní základ, potřebuje práci** (nic není rozbité, ale chybí obsah a jedna konfigurační oprava).

---

## 2. Keyword opportunity table

Objem/obtížnost = odhad. Skóre = poptávka × dosažitelnost × relevance.

| Keyword                                       | Jazyk | Odhad. obtížnost        | Skóre   | Aktuální pozice | Intent     | Doporučený obsah                           |
| --------------------------------------------- | ----- | ----------------------- | ------- | --------------- | ---------- | ------------------------------------------ |
| svatební web zdarma                           | CS    | Střední–těžká           | Vysoké  | mimo            | Komerční   | Landing `/svatebni-web-zdarma` + cena      |
| svatební web                                  | CS    | Těžká                   | Vysoké  | mimo            | Komerční   | Home (přepsat title/H1)                    |
| vytvořit svatební web                         | CS    | Střední                 | Vysoké  | mimo            | Transakční | Landing „Jak vytvořit" (průvodce)          |
| svatební webové stránky                       | CS    | Střední                 | Vysoké  | mimo            | Komerční   | Home + landing                             |
| svatební web šablony                          | CS    | Střední                 | Vysoké  | mimo            | Komerční   | Galerie šablon `/sablony`                  |
| svatební web ukázka / příklad                 | CS    | Nízká                   | Vysoké  | mimo            | Komerční   | Živá demo `klara-a-matej` + stránka ukázek |
| svatební web ceník / cena                     | CS    | Nízká                   | Vysoké  | mimo            | Komerční   | `/cenik` (v nav už je „Cena")              |
| svatební web s RSVP / potvrzení účasti        | CS    | Střední                 | Vysoké  | mimo            | Komerční   | Feature stránka RSVP                       |
| co napsat na svatební web                     | CS    | Střední                 | Vysoké  | mimo            | Informační | Blog guide + šablona textů                 |
| texty na svatební oznámení                    | CS    | Těžká                   | Střední | mimo            | Informační | Blog, funnel do webu                       |
| RSVP na svatbu (co to je, texty)              | CS    | Střední                 | Střední | mimo            | Informační | Blog                                       |
| harmonogram / program svatby                  | CS    | Těžká                   | Střední | mimo            | Informační | Blog + šablona                             |
| dress code na svatbě                          | CS    | Střední                 | Střední | mimo            | Informační | Blog (sedí na FAQ blok)                    |
| svatební dary číslo účtu / peníze místo darů  | CS    | Nízká                   | Střední | mimo            | Informační | Blog + feature „Dary za PINem"             |
| dvojjazyčný svatební web (česky a anglicky)   | CS    | Nízká                   | Vysoké  | mimo            | Komerční   | Landing – unikátní výhoda                  |
| svatební web pro hosty ze zahraničí           | CS    | Nízká                   | Vysoké  | mimo            | Komerční   | Landing / blog                             |
| soukromý svatební web / s heslem (PIN)        | CS    | Nízká                   | Střední | mimo            | Komerční   | Feature stránka                            |
| svatební web QR kód                           | CS    | Nízká                   | Střední | mimo            | Informační | Blog/návod                                 |
| ubytování pro svatební hosty (jak řešit)      | CS    | Střední                 | Nízké   | mimo            | Informační | Blog                                       |
| bilingual wedding website                     | EN    | Střední                 | Vysoké  | mimo            | Komerční   | EN landing                                 |
| wedding website Czech Republic                | EN    | Nízká                   | Vysoké  | mimo            | Komerční   | EN landing                                 |
| free wedding website builder                  | EN    | Velmi těžká (Zola, Joy) | Nízké   | mimo            | Komerční   | Neútočit přímo                             |
| wedding website for international guests      | EN    | Nízká                   | Střední | mimo            | Komerční   | EN blog                                    |
| destination wedding Czech Republic guest info | EN    | Střední                 | Střední | mimo            | Informační | EN blog/guide                              |
| how to word cash gifts wedding website        | EN    | Střední                 | Nízké   | mimo            | Informační | EN blog (pozdější fáze)                    |

**Strategie.** Na anglické generické dotazy nesoutěžit se Zola/Joy; cílit na dvojici **„Česko + dvojjazyčný"**, kde je konkurence prakticky nulová.

---

## 3. On-page problémy

| Stránka        | Problém                                                                                        | Závažnost    | Doporučená oprava                                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------- |
| CS/EN home     | Canonical, og:url, hreflang a JSON-LD míří na `se-vezmou.cz`, ale ten přesměrovává na `www.`   | **Kritická** | Ve Vercelu nastavit apex jako primární a `www` → apex (kód už apex předpokládá, viz `NEXT_PUBLIC_SITE_URL`) |
| CS home        | Zástupné texty `[KONTAKT]`, `[PODMÍNKY]`, `[PROVOZOVATEL, IČO]` v těle a patičce               | **Kritická** | Doplnit reálné údaje před jakoukoli propagací                                                               |
| CS home        | Tři „Zástupný text" recenze + `[Jména páru]`                                                   | Vysoká       | Skrýt sekci, dokud nejsou reálné recenze; falešně vypadající placeholdery jsou trust minus                  |
| CS home        | `[DD. MM. RRRR] · [místo]` v ukázkách šablon                                                   | Střední      | Nahradit konkrétním fiktivním datem a místem                                                                |
| CS home        | Title „Svatební web bez starostí \| Se vezmou" neobsahuje „zdarma" ani „vytvořit"              | Vysoká       | Viz návrhy v kap. 8                                                                                         |
| CS home        | FAQ (5 otázek) bez `FAQPage` JSON-LD                                                           | Střední      | Přidat schema (konkurenti brzy-svoji, Vowly, Zola, Joy ho mají)                                             |
| CS/EN home     | Organization schema bez `logo`, `sameAs`, kontaktu                                             | Střední      | Doplnit logo + sociální profily                                                                             |
| CS/EN home     | Žádné `<img>` (vše SVG/CSS) – žádný alt text, žádný obrazový SEO signál                        | Nízká        | Ukázky šablon jako `<img>` s alt textem; nebo `role="img"` + `aria-label` u SVG                             |
| Home           | Jediná stránka cílí na všechny dotazy; sekce jsou jen kotvy                                    | Vysoká       | Rozdělit na samostatné URL (cena, šablony, ukázka, FAQ)                                                     |
| Home           | Chybí `SoftwareApplication`/`Offer` schema (cena 0 Kč v zaváděcím provozu)                     | Nízká        | Přidat po spuštění                                                                                          |
| EN home        | Anglický text přeložen dobře, ale chybí EN-specifický úhel (hosté ze zahraničí, Czech wedding) | Střední      | Viz EN landing                                                                                              |
| Právní stránky | Zřejmě bez meta description a hreflang specifik                                                | Nízká        | Zkontrolovat; `noindex` zvážit u `/dostupnost` není nutné                                                   |
| Interní odkazy | Navigace odkazuje jen na kotvy `#`, patička 3 právní odkazy                                    | Střední      | Po přidání stránek navigovat na reálné URL                                                                  |

---

## 4. Content gap

| Téma                                                   | Proč                                                                                                                                 | Formát                   | Priorita | Úsilí                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ | -------- | ------------------------ |
| Ceník / „Cena"                                         | V navigaci je, ale kotva; konkurenti (brzy-svoji 490–990 Kč, WeMarry 1 490 Kč jednorázově) ho mají jako vlastní URL; komerční intent | Landing                  | Vysoká   | Půl dne                  |
| Živá ukázka / galerie šablon                           | Dotaz „svatební web ukázka" + zvyšuje konverzi; máte 4 šablony                                                                       | Landing s odkazy na demo | Vysoká   | Půl dne                  |
| Dvojjazyčný svatební web / hosté ze zahraničí          | Unikát, žádný CZ konkurent to nehlásí v title                                                                                        | Landing CS + EN          | Vysoká   | Půl dne                  |
| Co napsat na svatební web                              | Top informační dotaz, konkurenti brzy-svoji a svatbeni.cz                                                                            | Guide + šablony textů    | Vysoká   | Vícedenní                |
| Jak vytvořit svatební web krok za krokem               | Dotaz „vytvořit svatební web", HowTo schema                                                                                          | Guide                    | Vysoká   | Půl dne                  |
| RSVP na svatbu (texty, kdy, jak)                       | Střední poptávka, přirozený funnel                                                                                                   | Blog                     | Střední  | Půl dne                  |
| Svatební harmonogram / program dne                     | Vysoká informační poptávka                                                                                                           | Blog + šablona           | Střední  | Půl dne                  |
| Dress code, dary, ubytování pro hosty                  | Mapují přímo sekce vašeho produktu                                                                                                   | 3× blog                  | Střední  | 3× půl dne               |
| Srovnání služeb (Se vezmou vs. Wix/Webnode/brzy-svoji) | Komerční, ale pozor na tón                                                                                                           | Comparison page          | Nízká    | Půl dne                  |
| Hub / pillar „Svatební web: kompletní průvodce"        | Topic cluster, interní prolinkování                                                                                                  | Pillar                   | Vysoká   | Vícedenní                |
| Přístupnost/WCAG 2.2 AA jako diferenciátor             | Nikdo z konkurence ho nezmiňuje                                                                                                      | Feature stránka          | Nízká    | 1–2 h (už je prohlášení) |

**Funnel.** Awareness: žádný obsah. Consideration: jen home. Decision: formulář/čekací listina. Je potřeba aspoň 8–12 stránek, aby Google označil doménu jako relevantní pro téma.

---

## 5. Technický checklist

| Kontrola                             | Stav         | Detail                                                                                                                              |
| ------------------------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| HTTPS + HSTS                         | Pass         | `max-age=63072000; includeSubDomains`                                                                                               |
| Přesměrování http → https → www      | **Warning**  | Dva skoky (`http://se-vezmou.cz` → `https://se-vezmou.cz/` → `https://www…`)                                                        |
| Canonical konzistentní s finální URL | **Fail**     | Canonical = apex, finální URL = www                                                                                                 |
| Sitemap URL = finální URL            | **Fail**     | `sitemap.xml` na www vypisuje apex URL, které se přesměrují                                                                         |
| robots.txt                           | Pass         | Povoluje search + AI-search roboty, blokuje GPTBot, ClaudeBot, CCBot, Google-Extended; `Sitemap:` ukazuje na apex (stejný konflikt) |
| hreflang CS/EN/x-default             | Pass (obsah) | V HTML i sitemapě, vzájemné; adresy ale trpí problémem www                                                                          |
| Struktura nadpisů                    | Pass         | 1× H1, logické H2/H3                                                                                                                |
| Strukturovaná data                   | Warning      | Organization, WebSite, SoftwareApplication, FAQPage i BreadcrumbList existují; chybí `logo` a `sameAs`                              |
| Meta description                     | Pass         | 156 znaků CS; OK                                                                                                                    |
| Title délka                          | Pass         | ~39 znaků CS (lze využít víc)                                                                                                       |
| OG/Twitter                           | Pass         | 1200×630, alt text                                                                                                                  |
| 404                                  | Pass         | Vrací 404                                                                                                                           |
| Mobilní viewport                     | Pass         | Správný viewport                                                                                                                    |
| Rychlost                             | Pass         | TTFB ~0,1 s (cache HIT, Vercel fra1); LCP/CLS neměřeno (doporučeno PageSpeed Insights + CrUX po spuštění)                           |
| Bezpečnostní hlavičky                | Pass         | CSP, X-Frame-Options, Referrer-Policy                                                                                               |
| Noindex na weby párů                 | Pass (záměr) | Zajišťuje soukromí, ale znamená 0 organického zisku z tenantů                                                                       |
| Zástupné texty v produkci            | **Fail**     | Viz kap. 3                                                                                                                          |
| llms.txt                             | Info         | Není; nízká priorita, volitelné                                                                                                     |
| Hodnocení/AggregateRating            | N/A          | Žádné reálné recenze                                                                                                                |

---

## 6. Srovnání s konkurencí

Zdroj: stažené HTML k 3. 10. 2026, ceny z jejich veřejných webů.

| Dimenze                            | Se vezmou       | Brzy-svoji.cz             | WeMarry.io                                  | Vowly.love     | BudeVeselka.cz      | Weddingplan.online | Zola    | Joy (WithJoy)            | Vítěz                         |
| ---------------------------------- | --------------- | ------------------------- | ------------------------------------------- | -------------- | ------------------- | ------------------ | ------- | ------------------------ | ----------------------------- |
| Počet URL v sitemapě               | 2               | 121                       | ? (1 index)                                 | 47             | 8                   | 12 445             | 56      | ?                        | Weddingplan / Brzy-svoji (CZ) |
| Slov na úvodní straně              | ~1 025          | ~833                      | ~1 876                                      | ~724           | ~1 840              | ~554               | ~1 357  | ~4 899                   | Joy                           |
| Blog / obsah                       | Ne              | Ano                       | Ano                                         | Ano            | Částečně            | Ano                | Ano     | Ano                      | Brzy-svoji (CZ)               |
| Schema                             | Org + WebSite   | FAQPage, Org, WebSite     | SoftwareApplication, AggregateRating, Offer | FAQPage, Offer | Žádné               | FAQPage, HowTo     | FAQPage | FAQPage, AggregateRating | Joy / WeMarry                 |
| hreflang                           | CS+EN           | Ne                        | Ano                                         | Ne             | Ano                 | 16 jazyků          | Ne      | Ano                      | Weddingplan                   |
| Cena                               | 0 Kč (zaváděcí) | 490 Kč/rok, 990 Kč/2 roky | 1 490 Kč jednorázově                        | ?              | placený ceník       | zdarma             | zdarma  | zdarma                   | Se vezmou/Zola/Joy            |
| Dvojjazyčný web hostů              | **Ano**         | Částečně                  | Ano                                         | Ne             | ?                   | Ano                | EN only | EN only                  | **Se vezmou** (v CZ kontextu) |
| Title obsahuje „zdarma"/„vytvořit" | Ne              | Ne (RSVP)                 | Ne                                          | Ne             | Ne (ceník)          | Ano                | Ano     | Ano                      | Zahraniční                    |
| Technický stav                     | Silný           | Střední                   | Těžký (243 kB HTML)                         | Střední        | Těžký (2,4 MB HTML) | Střední            | Střední | Těžký                    | Se vezmou                     |

**Zahraniční trojka** (Zola, The Knot, Joy; Minted jako čtvrtý): hlavně autorita a obsah. Nepřebít je na obecných EN dotazech. Vowly a Brzy-svoji jsou nejbližší český konkurenti (obsahový blog, FAQ schema, galerie). Naseano.cz projekt **ukončen** (příležitost převzít jejich RSVP dotazy). Svatbona.cz, svatbeni.cz, Svatební asistentka jsou **agregátory/magazíny**, ne produkty. Ty jsou v SERP před vámi na „svatební web zdarma", a proto má smysl o ně usilovat linky (pozor na placené zmínky).

---

## 7. Akční plán

### Quick wins (tento týden)

| Akce                                                                                                 | Dopad   | Úsilí  | Závislosti                 |
| ---------------------------------------------------------------------------------------------------- | ------- | ------ | -------------------------- |
| Ve Vercelu nastavit apex jako primární doménu, `www` přesměrovat na apex; ověřit `http` → jeden skok | Vysoký  | 15 min | Přístup do Vercelu         |
| Doplnit `[KONTAKT]`, `[PROVOZOVATEL, IČO]`, `[PODMÍNKY]`                                             | Vysoký  | 1 h    | Právní údaje provozovatele |
| Skrýt sekci „Co říkají páry" (nebo nahradit reálnými)                                                | Střední | 30 min | –                          |
| Nahradit `[DD. MM. RRRR] · [místo]` konkrétním ukázkovým textem                                      | Nízký   | 30 min | –                          |
| Přepsat title/meta (kap. 8)                                                                          | Střední | 30 min | –                          |
| Založit Google Search Console + Bing Webmaster + Seznam Webmaster, odeslat sitemapu                  | Vysoký  | 1 h    | Ověření domény             |
| Přidat `logo` a `sameAs` do Organization                                                             | Nízký   | 30 min | Sociální profily           |

### Strategické investice (čtvrtletí)

| Akce                                                                                                                                                                    | Dopad   | Úsilí              | Závislosti                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------ | ------------------------------- |
| Přidat stránky do `pathnames.ts`: `/cenik` `/en/pricing`, `/sablony` `/en/templates`, `/ukazka` `/en/demo`, `/dvojjazycny-svatebni-web` `/en/bilingual-wedding-website` | Vysoký  | Vícedenní          | Texty CS/EN, `i18n:check`       |
| Blog / „Průvodce" s 8–12 články (kap. 9)                                                                                                                                | Vysoký  | Vícedenní průběžně | Autor, redakce                  |
| Pillar „Svatební web: kompletní průvodce" + cluster                                                                                                                     | Vysoký  | Vícedenní          | Blog                            |
| Měření: GSC, CrUX, Plausible/GA4                                                                                                                                        | Střední | 1 den              | Souhlas s cookies dle zásad     |
| Linkbuilding: svatební magazíny (svatbeni.cz, svatbona.cz, svatebni-silenstvi.cz), svatební veletrhy, katalogy dodavatelů                                               | Vysoký  | Průběžně           | Hotový obsah a reálné reference |
| AggregateRating až po reálných recenzích                                                                                                                                | Střední | Po spuštění        | Reálné páry                     |
| Zvážit `llms.txt` a „fakta" stránku pro AI citace                                                                                                                       | Nízký   | 2 h                | –                               |

---

## 8. Optimalizované title a meta description

Hranice: title ≤ 60 znaků, description ≤ 155.

| Stránka                                 | Title                                                                                                                  | Meta description                                                                                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| CS home                                 | `Svatební web zdarma online – Se vezmou` (38)                                                                          | `Vytvořte si svatební web za jeden večer: program, mapa, ubytování a potvrzení účasti hostů. Česky i anglicky, zdarma v zaváděcím provozu.` (≈139) |
| EN home                                 | `Free Wedding Website for Czech Weddings – Se vezmou` (51)                                                             | `Create a bilingual Czech–English wedding website in one evening: schedule, map, accommodation and RSVPs. Free during launch.` (≈124)              |
| `/cenik`                                | `Cena svatebního webu – zdarma v zaváděcím provozu` (49)                                                               | `Kolik stojí svatební web Se vezmou? Zatím nic: tvorba i zveřejnění jsou zdarma. Později cenu oznámíme předem.` (≈109)                             |
| `/sablony`                              | `Šablony svatebního webu: Editorial, Eukalyptus, Chateau, Modern` (62, zkrátit na „Šablony svatebního webu – 4 styly") | `Vyberte si ze čtyř šablon svatebního webu od minimalistické po zámeckou. Náhled hned, bez registrace hostů.` (≈105)                               |
| `/dvojjazycny-svatebni-web`             | `Dvojjazyčný svatební web: česky a anglicky` (41)                                                                      | `Hosté ze zahraničí rozumí všemu. Každý text vyplníte zvlášť v češtině a angličtině, hosté si přepnou jazyk jedním klepnutím.` (≈124)              |
| EN `/en/bilingual-wedding-website`      | `Bilingual Wedding Website (Czech & English)` (43)                                                                     | `A wedding website your Czech and international guests can both read: schedule, venue, RSVP in two languages.` (≈108)                              |
| `/soukromi`, `/podminky`, `/dostupnost` | `Zásady zpracování osobních údajů – Se vezmou` atd.                                                                    | Krátký popis (≤ 120 znaků)                                                                                                                         |

Pozn.: slovo „zdarma" v title používejte jen dokud platí zaváděcí provoz; po zpoplatnění změnit (a upravit schema `Offer`).

---

## 9. Content briefy (top 5)

### Brief 1 – „Co napsat na svatební web" (blog, CS)

- **Cíl**: informační dotaz → funnel do průvodce. **Délka**: 1 800–2 200 slov.
- **Osnova**: úvod (co hosté hledají), 10 sekcí (jména a datum, program, místo/mapa, doprava, ubytování, dress code, RSVP, dary, kontakt, FAQ), hotové ukázkové texty ke kopírování, checklist.
- **Klíčová slova**: co napsat na svatební web, svatební web texty, svatební web obsah.
- **CTA**: „Vytvořit web zdarma" po 3. a 10. sekci. **Interní odkazy**: ukázka, šablony, FAQ.
- **Schema**: Article + BreadcrumbList. **Konkurence**: svatbeni.cz (11 věcí), brzy-svoji (blog).

### Brief 2 – „Jak vytvořit svatební web krok za krokem" (guide, CS)

- **Osnova**: 4 kroky z vašeho průvodce (jména/datum → šablona → obsah → zveřejnit), screenshoty, časová osa „za jeden večer".
- **Klíčová slova**: vytvořit svatební web, jak vytvořit svatební web.
- **Schema**: HowTo + FAQPage. **Délka**: 1 200–1 500 slov.

### Brief 3 – „Dvojjazyčný svatební web" (landing, CS + EN)

- **Cíl**: unikátní pozice. **Osnova**: problém (hosté ze zahraničí, smíšené páry), jak funguje (každý text zvlášť), ukázka s přepínačem CS/EN, FAQ, CTA.
- **Klíčová slova**: dvojjazyčný svatební web, svatební web pro hosty ze zahraničí / bilingual wedding website, wedding website Czech Republic.
- **Délka**: 700–900 slov každá verze, **ne** strojový překlad (řídí `i18n:check`).

### Brief 4 – „Cena" (`/cenik`, CS + EN)

- **Osnova**: tabulka plánů (Koncept 0 Kč, Zveřejněný web 0 Kč v zaváděcím provozu), co zahrnuje, co se změní po skončení, FAQ o ceně.
- **Klíčová slova**: svatební web cena, svatební web ceník, svatební web zdarma.
- **Schema**: Offer + FAQPage. **Důležité**: soulad s `src/config` (cena) a podmínkami.

### Brief 5 – „Ukázky a šablony" (`/sablony`, CS + EN)

- **Osnova**: 4 šablony (Editorial, Eukalyptus, Chateau, Modern), každá s popisem pro koho, náhledy jako `<img>` s alt textem, odkaz na živé demo (`klara-a-matej`; pozor, tenant host je noindex, takže odkaz vede ven z indexu, což je v pořádku).
- **Klíčová slova**: svatební web šablony, svatební web ukázka. **Schema**: ItemList.

---

## 10. Content kalendář (12 týdnů)

| Týden | CS                                                                      | EN                                             | Technické                                |
| ----- | ----------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------- |
| 1     | Oprava www/apex, doplnění placeholderů, FAQPage schema, nové title/meta | –                                              | GSC + Bing + Seznam, sitemap             |
| 2     | `/cenik`                                                                | `/en/pricing`                                  | Úprava navigace na reálné URL            |
| 3     | `/sablony` s `<img>` + alt                                              | `/en/templates`                                | –                                        |
| 4     | `/dvojjazycny-svatebni-web`                                             | `/en/bilingual-wedding-website`                | hreflang v sitemapě                      |
| 5     | Blog: Co napsat na svatební web                                         | –                                              | Article schema, breadcrumbs              |
| 6     | Blog: Jak vytvořit svatební web (HowTo)                                 | Blog: How to build a bilingual wedding website | –                                        |
| 7     | Blog: RSVP na svatbu                                                    | –                                              | Měření konverzí (průvodce)               |
| 8     | Blog: Harmonogram / program svatby                                      | –                                              | PageSpeed + CrUX audit                   |
| 9     | Blog: Dress code                                                        | Blog: Czech wedding guide for foreign guests   | –                                        |
| 10    | Blog: Dary a číslo účtu                                                 | –                                              | –                                        |
| 11    | Pillar: Svatební web – kompletní průvodce                               | –                                              | Interní prolinkování clusteru            |
| 12    | Revize výsledků v GSC, aktualizace nejlepších článků                    | Revize                                         | AggregateRating až po reálných recenzích |

---

## 11. Hlubší sekce (stručně)

**A. Oprava domény (nejdůležitější technická věc).** Příčina je ve Vercel Domains: `www` je primární. `src/host/resolve.ts:71` to výslovně přenechává Vercelu. Nejjednodušší oprava je bez kódu: Vercel → Domains → `se-vezmou.cz` jako primární, `www.se-vezmou.cz` redirect na apex. Druhá možnost (nastavit `NEXT_PUBLIC_SITE_URL=https://www.se-vezmou.cz`) je horší, protože weby párů jsou na `<slug>.se-vezmou.cz` a apex zůstane kořenem. Ověření: `curl -sIL https://www.se-vezmou.cz/` má skončit na apex jedním skokem a canonical musí odpovídat finální URL.

**B. AI vyhledávače (GEO).** Robots.txt už správně povoluje search/user-fetch roboty a blokuje trénovací. Zlepšit citovatelnost: krátké definiční odstavce na začátku sekcí („Se-vezmou.cz je česká služba…" už existuje), FAQPage schema, autorský podpis a datum aktualizace u článků, konzistentní název entity.

**C. Lokalizace.** Pro EN verzi používat `en_GB` (už je), cílit na „Czech Republic" a zahraniční hosty, ne na obecný trh USA. CS a EN texty psát nezávisle, ne překladem.

**D. Soukromí vs. SEO.** Tenanty zůstávají noindex (viditelný slib produktu: „Skrytý před Googlem"). Neměnit; místo toho pro důkaz kvality používat jeden veřejný demo web (`klara-a-matej`) s oddělenou indexovatelnou kopií na marketingové doméně, pokud ji budete chtít.

**E. Co jsem neměřil.** Skutečné objemy a pozice klíčových slov, backlinky, Core Web Vitals z terénu (CrUX), indexaci v Googlu. Po zapojení GSC a Ahrefs/Semrush doporučuji audit zopakovat (zhruba za 6–8 týdnů).
