# ADR 0008: Přihlášení operátorů a druhý faktor

Stav: navrženo (čeká na schválení majitele). **Varianta A (Supabase Auth) je nahrazena ADR 0012**: operátoři se přihlašují vlastním kódem z e-mailu a TOTP přímo v naší databázi (bez `supabase-js`, ADR 0011, OQ-47). Postup přihlášení, záložní kódy, obnova přes majitele, relace, omezení a role z tohoto ADR platí dál; úrovně AAL1 a AAL2 jsou naše (`operator_sessions.aal2_verified_at`), passkey zůstává TODO v ADR 0012.

## Kontext

Operátoři (majitel a podpora) vidí všechny zakázky a mohou zasahovat (změna stavu, zablokování, obnova, poslání přihlašovacího odkazu). Je to nejcennější cíl útoku. Zadání: jednorázový kód na e-mail plus druhý faktor, musí splnit WCAG 3.3.8 (Přístupné ověření, minimum) a mít záložní postup. Role: majitel (vše), podpora (čtení a omezené zásahy, bez údajů hostů ve výchozím stavu). Každý zásah do auditu.

## Možnosti

| Možnost                                                           | Pro                                                                                                             | Proti                                                                                                         |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| A. Supabase Auth: e-mail OTP + povinný TOTP MFA se záložními kódy | Vestavěná podpora (TOTP, úrovně ověření AAL1/AAL2), žádný nový dodavatel, jde vložit kód ze schránky i aplikace | Záložní kódy a obnova je třeba doplnit vlastním postupem. TOTP se dá vyloudit phishingem v reálném čase       |
| B. Passkey (WebAuthn) jako druhý faktor hned                      | Odolné proti phishingu, žádné opisování                                                                         | Podpora v Supabase Auth a zkušenost týmu ověřit `[OTÁZKA]`, riziko ztráty zařízení, složitější záložní postup |
| C. SMS kód                                                        | Snadné                                                                                                          | Slabší bezpečnost (výměna SIM), další náklady a dodavatel, nedoporučeno                                       |

## Rozhodnutí (doporučení)

Zvolit **A** pro MVP, **passkey (B) přidat později** jako silnější alternativu k TOTP. SMS nepoužívat.

### Postup přihlášení

1. Operátor zadá e-mail. Odpověď je vždy stejná (bez prozrazení, zda je adresa operátorská). Jen předem založené operátorské účty se mohou přihlásit (žádná registrace).
2. Jednorázový kód z e-mailu (platnost 10 minut, jednou použitelný), který jde **vložit ze schránky** (pole bez blokace vložení, `autocomplete="one-time-code"`, bez obrázků a hádanek). Po ověření úroveň AAL1.
3. Povinný druhý faktor: šestimístný kód z aplikace TOTP, také vkládatelný. Po ověření AAL2. **Operátorská rozhraní a citlivé zásahy vyžadují AAL2**, kontrola na serveru u každého zásahu, ne jen u vstupu.
4. První přihlášení nového operátora vynutí zápis TOTP a vygenerování záložních kódů. Bez zapsaného druhého faktoru nelze rozhraní otevřít.
5. WCAG 3.3.8: žádný krok nevyžaduje paměťový test, opisování obrázku, hádanku ani rozeznání předmětů. Pole pro kód nesmí blokovat vkládání a správce hesel.

### Záložní kódy a obnova

- Při zápisu TOTP se vygeneruje sada jednorázových záložních kódů (počet `[OTÁZKA]`, doporučení: řádově jednotky až desítky). Zobrazí se jednou, uloží se jen jejich hash. Použitý kód se zneplatní a použití se oznámí e-mailem a zapíše do auditu.
- **Obnova přes majitele:** pokud podpora ztratí druhý faktor a záložní kódy, majitel po ověření totožnosti (osobně nebo jiným dohodnutým kanálem `[OTÁZKA]`) zneplatní její faktor a vynutí nový zápis. Zásah se zapíše do auditu a oznámí podpoře.
- **Majitel ztratí druhý faktor a záložní kódy:** postup vyžaduje zásah v databázi nebo konzoli dodavatele autentizace a je popsán v provozním postupu. Doporučení: dva vlastníci s přístupem do konzole dodavatele, nebo uložit záložní kódy majitele mimo zařízení (například v správci hesel `[OTÁZKA]`). Jinak ztráta znamená ztrátu přístupu k administraci.

### Relace a omezení

- Relace operátora: nečinnost 30 minut, absolutně 8 hodin (viz `docs/security-privacy.md`). Po vypršení nová ověření včetně druhého faktoru.
- Operátorská cookie `__Host-` jen na hostiteli `admin.se-vezmou.cz`.
- Omezení pokusů pro kód e-mailu i TOTP (ADR 0010). Neúspěšné pokusy se počítají podle e-mailu i podle IP.
- Přihlášení operátora se oznamuje (e-mail operátorovi). Seznam operátorů je malý a spravuje ho majitel.
- Přístup k údajům hostů: jen s doložením souhlasu páru a důvodem, s auditem (viz `docs/security-privacy.md`). Role podpora nemá oprávnění ani s AAL2 bez tohoto souhlasu.

## Důsledky

- **Cena:** v rámci Supabase Auth, bez poplatku za faktor. Čas na návrh záložního postupu a provozní příručku. Uvedení limitů tarifu (např. počet aktivních uživatelů) ověřit v ceníku `[OTÁZKA]`.
- **Bezpečnost:** dva faktory výrazně snižují riziko převzetí účtu z uniklé schránky. TOTP je odolný vůči prostému úniku hesla, ale ne vůči phishingu v reálném čase, proto passkey později. Operátor je centrální riziko, proto audit a oddělení rolí.
- **Údržba:** vlastní kód záložních kódů, obnovy a vynucení AAL2. Sledovat změny API Supabase Auth. Výhledově přidat passkey a uložit historii k aktualizaci tohoto ADR.
