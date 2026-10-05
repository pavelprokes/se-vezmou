# Nástroje pro vyhledávače, měření a profily značky

Stav k 5. 10. 2026. Souvisí: `docs/seo-audit-2026-10.md` (audit a GEO skóre), ADR 0007 (analytika), `docs/todo.md`.
U každého řádku je, kdo ho dělá: **kód** (v repozitáři, hotovo), **Pavel** (účet, přihlášení, rozhodnutí).

## Přehled

| Nástroj                           | Stav          | Kdo   | Poznámka                                                                                              |
| --------------------------------- | ------------- | ----- | ----------------------------------------------------------------------------------------------------- |
| Google Search Console             | ✅ ověřeno    | Pavel | Doménová vlastnost, DNS TXT `google-site-verification` (5. 10. 2026). Sitemapu odeslat (krok 1).      |
| Bing Webmaster Tools              | ✅ ověřeno    | Pavel | 5. 10. 2026. Zkontrolovat, že je v Sitemaps `https://se-vezmou.cz/sitemap.xml`.                       |
| IndexNow (Bing, Seznam, Yandex)   | ✅ připraveno | kód   | `scripts/indexnow.mjs` + `.github/workflows/indexnow.yml`, běží po každém produkčním nasazení.        |
| Seznam Webmaster                  | ⏳ čeká       | Pavel | Kód v kódu připraven: proměnná `SEZNAM_WMT` (krok 2).                                                 |
| Vercel Web Analytics + Speed Ins. | ✅ v kódu     | Pavel | Komponenty jsou v `src/components/document.tsx`, skripty na produkci odpovídají. Ověřit v dashboardu. |
| Profily značky + `sameAs`         | ⏳ čeká       | Pavel | Kód připraven: `operator.profiles` v `src/config/operator.ts` (krok 4).                               |
| Firmy.cz, Google Business Profile | ⏳ čeká       | Pavel | Texty níže (krok 5).                                                                                  |

## Co udělat ručně (Pavel)

### 1. Search Console: sitemap a indexace

1. Search Console → Sitemapy → `https://se-vezmou.cz/sitemap.xml` → Odeslat.
2. Kontrola adresy URL (horní pole) → postupně `/`, `/en`, `/cenik`, `/sablony`, `/dvojjazycny-svatebni-web`
   → Požádat o indexování.
3. Hlášení „Vyloučeno značkou noindex“ u `app.se-vezmou.cz` a webů párů je **v pořádku** (záměr, weby párů
   a správa se neindexují).

### 2. Seznam Webmaster

1. <https://webmaster.seznam.cz> → přihlásit se Seznam účtem → Přidat web `https://se-vezmou.cz`.
2. Způsob ověření: **meta značka**. Seznam ukáže `<meta name="seznam-wmt" content="XXXX">`; zkopírovat jen hodnotu `XXXX`.
3. Vercel → projekt se-vezmou → Settings → Environment Variables → `SEZNAM_WMT` = `XXXX` (Production).
4. Redeploy produkce (stránky úvodního webu jsou statické, hodnota se do nich dostane jen novým sestavením).
5. Ověřit: `curl -s https://se-vezmou.cz/ | grep seznam-wmt`, pak v Seznam Webmasteru „Ověřit“.
6. Seznam Webmaster → Sitemapy → `https://se-vezmou.cz/sitemap.xml`.

### 3. Vercel Web Analytics a Speed Insights

Vercel → projekt → **Analytics** a **Speed Insights**: zkontrolovat, že jsou zapnuté (Enable). Kód je hotový,
měří jen `se-vezmou.cz` a `app.`, nikdy weby párů (ADR 0007). Bez cookies, souhlasová lišta není potřeba.

### 4. Profily značky a `sameAs`

„Se vezmou“ je běžná fráze, proto AI vyhledávače potřebují signál, že jde o konkrétní službu (GEO audit:
značka 13/100). Založit profily se jménem **Se vezmou**, odkazem na `https://se-vezmou.cz` a stejným popisem:

- Instagram (doporučeno, svatby jsou vizuální obor), Facebook stránka, LinkedIn stránka společnosti,
  případně Pinterest.

Adresy profilů pak doplnit do `profiles` v `src/config/operator.ts` (stačí poslat Claudovi). `sameAs` se do
strukturovaných dat vypíše samo; weby autora (`svatebni-fotograf-cechy.cz`) tam **nepatří**, nejsou to profily
stejné značky.

### 5. Firmy.cz a Google Business Profile

- **Firmy.cz** (<https://admin.firmy.cz>): Seznam ho ukazuje ve výsledcích a je to silný český signál značky.
- **Google Business Profile** (<https://business.google.com>): jako „firma bez provozovny“ (oblast působnosti
  Česko), adresu sídla zobrazit jen tehdy, když tam opravdu přijímáte zákazníky (jinak ji Google u služby bez provozovny skryje).
- Kategorie (vyberte nejbližší, kterou nabídka nástroje má): tvorba webových stránek / svatební služby.

## Připravené texty pro profily

Fakta odpovídají webu (cena 0 Kč „teď“, slovo „zdarma“ záměrně nepoužíváme, viz `docs/todo.md`).

- **Název:** Se vezmou
- **Web:** https://se-vezmou.cz
- **E-mail:** info@se-vezmou.cz
- **Provozovatel:** Pavel Prokeš, IČO 87877601

**Krátký popis (cs, do 160 znaků):**

> Vytvořte si svatební web za jeden večer: program, místo, ubytování a potvrzení účasti hostů na jedné adrese. Česky i anglicky, 0 Kč.

**Short description (en):**

> Create a wedding website in one evening: the schedule, venue, accommodation and guest RSVPs at one address. In Czech and English, 0 CZK.

**Delší popis (cs, Firmy.cz, Google Business Profile, „O nás“ na sítích):**

> Se vezmou je český nástroj pro tvorbu svatebního webu. Pár za jeden večer sestaví web s programem dne, místem
> a mapou, ubytováním, dress codem a častými dotazy, česky i anglicky. Hosté potvrdí účast přímo na webu, bez
> registrace a bez aplikace. Na výběr jsou čtyři šablony (Editorial, Eukalyptus, Chateau, Modern). Weby párů se
> neindexují ve vyhledávačích a citlivé údaje jdou skrýt za PIN. Tvorba i zveřejnění teď stojí 0 Kč. Za službou
> stojí svatební fotograf Pavel Prokeš.

## Kontrolní nástroje (bez účtu, kdykoli)

- **Rich Results Test** (<https://search.google.com/test/rich-results>): `/`, `/cenik`, `/sablony` a článek
  blogu. Očekávané: FAQ, drobečková navigace, článek (Article), u ceny SoftwareApplication s nabídkou.
- **validator.schema.org**: totéž bez omezení na typy, které Google zobrazuje.
- **Facebook Sharing Debugger** a **LinkedIn Post Inspector**: náhled odkazu (OG obrázek) a jeho obnovení.
- **PageSpeed Insights** (<https://pagespeed.web.dev>): Core Web Vitals; data od skutečných návštěvníků (CrUX)
  až při dostatečné návštěvnosti.

## Jak funguje IndexNow (kód)

- Klíč `30e95dcbaab848a8237b081b30d89194` leží veřejně v `public/30e95dcbaab848a8237b081b30d89194.txt`
  (není tajný, prokazuje jen vlastnictví domény). Shodu klíče a souboru hlídá `scripts/indexnow.test.ts`.
- Vercel po nasazení pošle GitHubu stav nasazení; workflow **IndexNow** při úspěšném produkčním nasazení
  spustí `node scripts/indexnow.mjs`, který ověří soubor s klíčem a pošle adresy z `sitemap.xml` na
  `api.indexnow.org` (předá je Bingu, Seznamu a dalším).
- Ručně: GitHub → Actions → IndexNow → Run workflow; lokálně `node scripts/indexnow.mjs --dry-run` jen vypíše adresy.
- Google IndexNow nepoužívá, tomu stačí Search Console a sitemapa.
