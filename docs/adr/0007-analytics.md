# ADR 0007: Analytika bez zbytečných cookies

Stav: navrženo (čeká na schválení majitele)

## Kontext

Produkt a marketing potřebují měřit dokončení kroků průvodce, publikaci a dokončení RSVP bez zbytečných cookies (požadavek role Hana Kolářová). Cíl bety: medián času do zveřejnitelného webu do 10 minut, dokončení RSVP u hostů, kteří formulář otevřeli, alespoň 80 % (návrhy zadání). Weby párů navštěvují hosté, kteří nic nevěděli o naší službě a nemají s námi vztah, proto tam nesmí běžet žádný skript třetí strany. Vercel Web Analytics je už v layoutu.

## Možnosti

| Možnost                                                                  | Pro                                                                       | Proti                                                                                            |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| A. Vercel Web Analytics (bez cookies) + vlastní tabulka událostí bez PII | Žádná nová služba, bez cookies, funnel z vlastních dat pod naší kontrolou | Omezené možnosti analýzy ve Vercelu (ověřit aktuální funkce a tarif), vlastní dotazy píšeme sami |
| B. Plausible (cloud EU nebo vlastní hosting)                             | Zralý nástroj bez cookies, cíle a trychtýře                               | Další dodavatel, cena nebo provoz vlastní instance, další skript                                 |
| C. Umami (vlastní hosting nebo cloud)                                    | Open source, bez cookies                                                  | Provoz a aktualizace na nás při vlastním hostingu, další skript                                  |

## Rozhodnutí (doporučení)

Zvolit **A**. Rozsah:

- **Vercel Web Analytics** jen na hostitelích `se-vezmou.cz` (úvodní stránka) a `app.se-vezmou.cz` (průvodce a správa). Komponenta se vykresluje podle hostitele, **na webech párů a na `admin.` se nenačítá vůbec**.
- **Vlastní tabulka událostí** (`analytics_event`, viz `docs/data-model.md`) zapisovaná ze serveru. Povolené události (uzavřený seznam v kódu): `wizard_step_completed` (číslo kroku), `wizard_started`, `site_published`, `rsvp_completed`. Pole: typ události, čas, hrubé údaje bez identifikace (jazyk, šablona, číslo kroku). Žádné jméno, e-mail, IP, user agent, text, adresa webu v čitelné podobě ani identifikátor, který jde spojit s osobou. Pro počet kroků na koncept se použije náhodný identifikátor konceptu, který se po zveřejnění nebo vypršení smaže nebo odpojí `[OTÁZKA]` pro právníka.
- **RSVP:** událost `rsvp_completed` nese jen příznak úspěchu a čas, **nikdy** odpovědi, jména, dietu, ani identifikátor svatby, pokud by šel zpětně spojit s jednotlivým hostem. Pro dokončení RSVP „u hostů, kteří formulář otevřeli“ se čítá otevření formuláře a odeslání jako dva agregované čítače za týden a svatbu `[OTÁZKA]` (hrozí zpětná identifikace u malých svateb, proto agregace na úrovni celé služby).
- **Sentry (hlášení chyb)** není analytika, ale skript třetí strany a zpracovatel: v prohlížeči je zapnutý **jen na hostiteli úvodní stránky** (`instrumentation-client.ts`, `isSentryBrowserHost`), na webech párů, `app.` a `admin.` se nespouští. Na serveru a v edge se každá událost čistí (`src/lib/sentry-scrub.ts`): bez adresy, cesty, query, těla požadavku, cookies, uživatele a drobečkové navigace, takže slug ani `/nahled/<token>` Sentry neopustí. Bez `NEXT_PUBLIC_SENTRY_DSN` se nic neodesílá (OQ-65).
- Žádné cookies pro analytiku. Žádný souhlasový banner není potřeba pro to, co je striktně nutné a cookieless. Stanovisko k právní kvalifikaci (zejména vlastní tabulka) `[OTÁZKA]` pro právníka.
- Search Console a Bing Webmaster Tools se napojují přes ověření DNS nebo meta značku jen na úvodní stránce (zadání, kapitola SEO).

## Důsledky

- **Cena:** Vercel Web Analytics má limity podle tarifu (ověřit aktuální). Vlastní tabulka stojí jen úložiště. Žádný další pevný poplatek.
- **Bezpečnost a soukromí:** nejmenší možná sada údajů, žádné skripty třetích stran u hostů. Riziko: zpětná identifikace malých souborů, proto agregace a uzavřený seznam událostí. Kód zápisu se kontroluje testem, že do události neprojde pole mimo seznam.
- **Údržba:** vlastní dotazy a jednoduchý přehled v provozní administraci (počty konceptů, kroků, publikací). Při potřebě bohatších analýz je možný přechod na B nebo C pro úvodní stránku, aniž by se měnila vlastní tabulka. Retence událostí `[LHŮTY]` (doporučení: agregovat a starší řádky mazat).
