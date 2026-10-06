# ADR 0014: Měřicí pixel v oznámeních pro pár a správce

- Stav: přijato majitelem (6. 10. 2026); právní stanovisko (bod 6) čeká.
- Mění: větu „Žádné sledovací pixely“ v ADR 0005 (kap. Šablony). Ostatní části ADR 0005 platí dál.
- Související: ADR 0007 (analytika), `docs/security-privacy.md` (kap. 5), `src/lib/email/pixel.ts`.

## Kontext

Majitel chce vědět, zda oznámení o vypršení a smazání webu správci vůbec otevírají (jejich smysl je, aby si pár včas stáhl export). Používáme vlastní instanci Umami (`analytics.pavelprokes.cz`, ADR 0007), ne službu třetí strany.

## Rozhodnutí

1. **Jen dvě zprávy**: `retention-notice` druhu `site_expiry` (vypršení webu, `utm_content=smazani-upozorneni`) a `deletion-notice` druhu `site_purge` (trvalé smazání webu, `utm_content=smazani-potvrzeni`). Příjemcem je správce webu, ne host. Oznámení o smazání dietních a alergických (`health_purge`) a ostatních údajů hostů (`guest_purge`) pixel nemají: samotné otevření by prozradilo vztah ke zdravotní kategorii.
2. **Nikdy**: přihlašovací a ověřovací kódy (`login-code`, `wizard-code`, `operator`), bezpečnostní oznámení (`backup-login-notice`, `admin-notice`) a e-maily hostům (`rsvp-confirmation`). Tyto e-maily pixel nedostanou ani po změně nastavení; nová šablona ho nemá, dokud ji tento ADR nezmíní.
3. **Adresa nese jen pevné značky šablony** (`utm_source=se-vezmou`, `utm_medium=email`, `utm_content=<slug>`). Žádná adresa, jméno, svatba, token ani číslo zprávy. `getEmailPixelUrl` zahodí cizí parametry a fragment z nastavené adresy.
4. **Vypnuto ve výchozím stavu**: bez `UMAMI_PIXEL_URL` se pixel nevloží. Přijímá se jen `https:`. Nastavovat jen pro Production.
5. Pixel je v HTML části na konci těla, v textové verzi není, a e-mail stále obsahuje všechna sdělení bez obrázků (otevření nelze zjistit od klientů, kteří obrázky blokují, a to je v pořádku).
6. Zásady zpracování osobních údajů zmíní, že oznámení správcům mohou obsahovat měřicí obrázek a že se z něj zaznamená čas načtení, IP adresa (jako hash v Umami) a typ klienta `[OTÁZKA]` pro právníka: zda stačí oprávněný zájem, nebo je u správců potřeba souhlas (§ 89 zákona o elektronických komunikacích, ePrivacy).

## Důsledky

- Stav „otevřeno“ je odhad: předběžné načtení (např. Apple Mail Privacy Protection) otevření nadhodnotí.
- Bez souhlasu právníka a bez proměnné v Production se nic nemění.
