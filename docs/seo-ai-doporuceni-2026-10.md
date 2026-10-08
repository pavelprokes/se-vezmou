# Doporučení nástroje AI Web Score (říjen 2026)

Zdroj: report nástroje `ai-web-score.pavelprokes.cz` (434 odpovědí asistentů, vygenerováno 7. 10. 2026, před nasazením PR #98 a #99). Souhrn: Se vezmou chybí v odpovědích o šablonách (0 % z 36) a o anglických svatebních webech; asistenti citují cizí weby, kde Se vezmou není uvedeno.

Posouzení: platné = vychází z reálné mezery; prospěšné = hodí se k cíli projektu (soukromí, přístupnost, čeština a angličtina, bez vymyšlených tvrzení).

| #   | Doporučení                            | Platné a prospěšné?                                                                                                   | Stav                                                                                                                                                                 |
| --- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Stránka šablon podle stylu            | Ano: odpovídá reálné mezeře (0 %) a pomáhá i lidem                                                                    | Hotovo (PR #98): `/sablony`, lead s odpovědí na statek a zámek, přehled podle typu svatby, FAQ, odkaz v hlavní navigaci                                              |
| 2   | Česká stránka „Svatební web zdarma“   | Ano, ale cena je zaváděcí (0 Kč „teď“), nikdy „navždy“                                                                | Hotovo (PR #98): `/cenik` s nadpisem „Svatební web zdarma“, bez slibu „navždy“                                                                                       |
| 3   | Anglická stránka pro svatbu v Česku   | Ano: dvojjazyčnost je hlavní odlišení                                                                                 | Hotovo (PR #98 a #99): `/en/bilingual-wedding-website`, FAQ pro hosty ze zahraničí, odkaz v navigaci                                                                 |
| 4   | Základní fakta doslova                | Ano, ale jen pravdivá a ověřitelná tvrzení                                                                            | Hotovo (PR #98 a #99): blok „Základní fakta“ na úvodu, cenách a dvojjazyčné stránce; stejné věty v `llms.txt`                                                        |
| 5   | Zápis na weby, které asistenti citují | Ano, ale mimo kód a bez vymyšlených recenzí                                                                           | **Na majiteli**, viz níže                                                                                                                                            |
| 6   | Strukturovaná data Service a FAQPage  | Částečně: `SoftwareApplication` s nabídkou a `FAQPage` už byly, chyběl `Service`                                      | Hotovo (tento PR): uzel `Service` s cenou, poskytovatelem a územím na úvodu a podstránkách (ne na stránce pro fotografy); cena je ze stejného zdroje jako u aplikace |
| 7   | Sledovat konkurenty WeMarry a LumiWed | Ano, ale je to nastavení v nástroji, ne v kódu                                                                        | **Na majiteli** (profil v nástroji)                                                                                                                                  |
| 8   | Zachovat zákaz trénovacích robotů     | Zákaz ponechat: nástroj sám říká, že se týká jen trénování, ne živých odpovědí; odpovídá OQ-04 a zaměření na soukromí | Beze změny: `GPTBot`, `ClaudeBot`, `Google-Extended` zůstávají zakázané; vyhledávací a odpovědní roboty povolené                                                     |

## Co zbývá udělat majiteli

1. **Zápisy (bod 5)**: založit nebo doplnit profil na `planning.wedding`, `websiteplanet.com` a `wemarry.io`; autorovi `vojtechbruk.cz` nabídnout podklady pro jeho článek (odkaz pro fotografy, QR kód a leták jsou na `/pro-fotografy`). Referenci od páru žádat jen od skutečných uživatelů.
2. **Konkurenti (bod 7)**: v profilu nástroje přidat WeMarry a LumiWed.
3. **Údaje v adresářích (bod 4)**: u zastaralých popisů opravit osm šablon, tvar adresy `jmeno-a-jmeno.se-vezmou.cz`, potvrzení účasti bez registrace a samostatné české a anglické verze.
4. Po nasazení znovu spustit měření a porovnat podíl zmínek u dotazů na šablony a na anglické weby.

## Text pro profily (podklad, ke kontrole před použitím)

Cs: Se vezmou je česká služba na svatební weby. Pár si vybere z osmi šablon, web má vlastní adresu ve tvaru jmeno-a-jmeno.se-vezmou.cz, česká a anglická verze jsou samostatné a hosté potvrzují účast bez registrace a bez aplikace. Weby párů nejsou ve vyhledávačích, celý web nebo jeho část lze skrýt za volitelný PIN. Tvorba i zveřejnění teď stojí 0 Kč.

En: Se vezmou is a Czech wedding website builder. Couples choose from eight templates and get an address like first-and-first.se-vezmou.cz. The Czech and English versions are separate, and guests reply to the invitation without an account or an app. Couples' sites are not indexed by search engines, and the whole site or part of it can be hidden behind an optional PIN. Creating and publishing a site currently costs 0 CZK.
