# ADR 0015: Stránka volné adresy

- Stav: rozhodnutí majitele (Pavel), 14. 10. 2026; implementace v PR „Stránka volné adresy“.
- Mění: požadavek FR-PRIV-3 (docs/security-privacy.md kap. 9, docs/technical-design.md kap. 2.1) jen pro **volnou** adresu a **jen pro kořenovou stránku**. Ostatní stavy a podstránky zůstávají beze změny.
- Související: ADR 0002 (směrování podle hostitele), ADR 0003 a 0013 (překlady), ADR 0007 (analytika), ADR 0010 (omezení počtu požadavků), ADR 0011 (přístup k databázi), `docs/brand-manual.md`.

## Kontext

Wildcard DNS posílá na aplikaci každou adresu `<slug>.se-vezmou.cz`. Dosud dávala každá adresa, na které není zveřejněný web (neexistující, rozpracovaná, smazaná, zablokovaná), stejnou stránku 404 (FR-PRIV-3). Když pár dostane od známého odkaz typu `https://david-and-lil.se-vezmou.cz/` a ten nikdo nemá, vidí chybu a nic ho nevede dál. Majitel chce, aby se na **volné** adrese napsalo, že je volná, a aby stránka návštěvníka přivedla k založení vlastního webu.

## Rozhodnutí

1. **Co je „volná“.** Adresa, pro kterou databázová funkce `se_vezmou.slug_available` (volaná přes existující `check_slug`, stejná jako živá kontrola v průvodci, FR-WZ-4) vrací pravdu: platný tvar, žádná svatba, žádná platná rezervace (ani rozpracovaného konceptu, rezervace trvá `slug_reservation_days`), žádné vyhrazené slovo ani blokovaný výraz a žádná zveřejněná adresa, která byla vyřazena (zveřejněná adresa se nikdy nepřidělí znovu, FR-PRIV-4). Smazaný web, který nebyl zveřejněn, adresu uvolní už dnes (existující chování, FR-PRIV-4), takže ji ukáže jako volnou. Žádná nová migrace není potřeba: funkce `check_slug` je pro `service_role` už zaručená a obsahuje omezení počtu požadavků.
2. **Kde se to děje.** Jen `src/app/h/tenant/[slug]/[locale]/page.tsx`, tedy kořen adresy v češtině (`/`) a angličtině (`/en`). Volá se až poté, co `getSiteState` vrátil `null`, a jen pro slug, který projde kontrolou tvaru, vyhrazených slov a blokovaných výrazů na straně aplikace (`isFreeAddressCandidate`, bez dotazu do databáze). Podstránky (`/p/…`, `/nahled/…`, `/media/…`, `/upozorneni`, `/og`, ostatní cesty) se nemění a vrací 404. Existující web v jazyce, který nenabízí, je dál 404.
3. **Stránka.** HTTP 200, vykreslená za běhu (`connection()`), bez dlouhého cachování (Next.js u dynamické stránky posílá `Cache-Control: private, no-cache, no-store`, hlídá to e2e). Obsah: stav „Volná“, adresa v `h1`, věta „Tato adresa je volná. Vytvořte si na ní svatební web.“, jedno hlavní tlačítko „Vytvořit web na této adrese“ s poznámkou, že průvodce adresu ověří znovu a nikdo ji nedrží rezervovanou, odkaz na ukázky šablon na úvodní stránce a tři kroky (jména, šablona, zveřejnění). Vzhled z komponent a tokenů úvodní stránky, ne šablona páru. Texty ve jmenném prostoru `address` (cs i en psané samostatně), načítá ho jen tato stránka.
4. **Odkaz do průvodce.** Tlačítko vede na `app.<doména>/vytvorit` s parametry `adresa` (slug) a `jazyk`. Průvodce adresu předvyplní (jen platnou a nevyhrazenou, a ověří ji znovu při psaní i při prvním uložení; skutečnou rezervaci rozhoduje databáze). Jména `jmeno1` a `jmeno2` se předvyplní jen tehdy, když jsou z adresy jednoznačná: právě dvě slova z písmen, mezi nimi spojka jazyka stránky (`-a-` česky, `-and-` anglicky), a `slugFromNames(jména, jazyk)` vyrobí přesně tutéž adresu. Jinak se jména nepředvyplní. Adresa neobsahuje diakritiku, takže jména vyjdou bez ní („Klara“); pár je v prvním kroku upraví.
5. **Hlavičky a SEO.** Stránka je `noindex, nofollow` v hlavičce `X-Robots-Tag` (proxy ji posílá pro všechny tenant hostitele, i pro neexistující svatbu, `applyHeaders`) i v `meta robots`; bez `canonical`, bez `hreflang`, bez náhledu odkazu (Open Graph) a bez JSON-LD; není v mapě webu ani v `llms.txt` (tenant hostitelé je nemají, `robots.txt` zakazuje vše). Wildcard doména tak nevyrobí nekonečno indexovatelných stránek.
6. **Omezení počtu požadavků (ADR 0010).** Nové pravidlo `freeAddressIp`: 20 dotazů za 10 minut podle IP (HMAC klíč `free-address-ip`, počítadlo v databázi uvnitř `check_slug`), přísnější než kontrola v průvodci (60 za 10 minut) a oddělené od ní, takže stránka nespotřebuje rozpočet průvodce. Do počítadla se zapisuje jen dotaz, který se opravdu ptá databáze (neplatný tvar, vyhrazená slova a existující weby ho nespotřebují). Po překročení limitu, při chybě databáze i při čemkoli nejasném je odpověď stejná 404 jako dnes; stránka neříká, že je adresa „zabraná“ ani „omezená“. Stránka neprozrazuje nic, co by nešlo zjistit v průvodci (viz níže).
7. **Soukromí a ADR 0007.** Stránka nezpracovává osobní údaje a nic neukládá; slug z adresy se jen vypíše (ověřen regulárním výrazem, escapuje ho React; doména se bere z hlavičky `Host` jen ve tvaru `slug.doména`). Žádná cookie navíc, žádné měření ani skripty třetích stran (na tenant hostitelích neběží, `Document measure={false}`). Odkaz do průvodce a na úvodní stránku jsou obyčejné odkazy; `Referrer-Policy: no-referrer` platí.

## Proč je to bezpečné

- Informace „adresa je volná“ je dnes veřejná: kdokoli ji zjistí kontrolou dostupnosti v průvodci (`app.<doména>/vytvorit`, bez účtu), která má stejný limit podle IP a stejnou funkci. Stránka přidává jen jiný způsob, jak se na ni zeptat, a přísnější limit.
- Všechny ostatní stavy dávají dál **stejnou 404** (stejné tělo, stejné hlavičky): zveřejněný web v jiném jazyce, rozpracovaná a rezervovaná adresa, zveřejněná a pak vyřazená adresa, zablokovaný web, zamčený web (zobrazí bránu jako dosud), vyhrazené slovo a neplatný tvar. Z 404 se tedy nepozná, zda adresa existuje, je rezervovaná, smazaná nebo zablokovaná; z „volné“ stránky se pozná jen to, že adresa volná je.
- Procházení všech adres brání limit podle IP (20 za 10 minut, cca 120 za hodinu na IP) a to, že je zjistitelná jen volnost, ne obsazenost jména.
- Adresa se mezi zobrazením a založením webu může zabrat. Stránka to říká otevřeně („nikdo ji nedrží rezervovanou, průvodce ji ověří znovu“).

## Možnosti, které se zamítly

- Nová databázová funkce a migrace: není potřeba, `check_slug` už dělá to, co je třeba, včetně limitu.
- Indexovatelná stránka (nápověda „volné adresy“ ve vyhledávačích): na wildcard doméně nekonečně mnoho stránek, riziko nízké kvality; zamítnuto.
- Pevná cache stránky (CDN): adresa se může zabrat a limit podle IP by přestal fungovat; zamítnuto.
- Předvyplnit jména z libovolné adresy: nejednoznačné (`anna-marie-a-jan`), zamítnuto; jen případy, které projdou zpětnou kontrolou.

## Důsledky

- Test „neexistující adresa vrací 404“ už nesmí používat volný slug: e2e používají vyhrazená slova (`staging`, `docs`) a rozpracované a zablokované weby (`e2e/hosts.e2e.ts`, `e2e/pages.e2e.ts`, `e2e/wizard.e2e.ts`).
- Průvodce umí `adresa` v odkazu (`WIZARD_PARAMS.slug`), stejně jako dosud `jmeno1`, `jmeno2`, `jazyk`.
- Dotaz na databázi přibývá u každého zobrazení kořene adresy bez webu (jeden `check_slug`, omezený podle IP).

## Otevřená rozhodnutí pro majitele

- Zda smí stránka nabídnout také `og:` náhled odkazu (dnes ne: bez náhledu, aby se volné adresy nešířily jako karty).
- Zda zvýšit nebo snížit limit 20 za 10 minut po zkušenostech z provozu (např. sdílená IP v kanceláři nebo na Wi-Fi svatebního salonu).
- Zda smazaný a nezveřejněný web má ukazovat volnou stránku hned, nebo až po lhůtě (dnes se adresa uvolní okamžitě, FR-PRIV-4).
