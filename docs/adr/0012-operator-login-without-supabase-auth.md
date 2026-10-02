# ADR 0012: Přihlášení operátorů bez Supabase Auth

- Stav: navrženo a implementováno v M9 (2. 10. 2026), čeká na potvrzení majitelem. Do potvrzení platí jako výchozí volba.
- Související: ADR 0008 (operátorské MFA; varianta A tímto ADR nahrazena), ADR 0011 (aplikace mluví jen přímo s Postgresem), ADR 0002 (relace a hostitelé), ADR 0010 (omezení počtu požadavků), `docs/security-privacy.md`, `docs/data-model.md` (kapitola 17), OQ-47.

## Kontext

ADR 0008 počítal s přihlášením operátorů přes Supabase Auth (e-mail OTP a povinný TOTP s úrovněmi AAL1 a AAL2). Po ADR 0011 aplikace nepoužívá `supabase-js`, PostgREST, `NEXT_PUBLIC_SUPABASE_*` ani klíč `service_role`: mluví jen přímo s Postgresem jako role `se_vezmou_app` ve schématu `se_vezmou` na sdíleném projektu. Supabase Auth se z aplikace volat nedá a její uživatelská tabulka (`auth.users`) patří celému sdílenému projektu, do kterého naše migrace nesmí sahat. Operátor je přitom nejcennější cíl útoku (vidí všechny zakázky a smí zasahovat), takže řešení musí splnit totéž co ADR 0008: jednorázový kód z e-mailu, povinný druhý faktor, záložní postup, relace 30 minut nečinnosti a 8 hodin absolutně, host-only cookie, omezení pokusů, WCAG 3.3.8 (Přístupné ověření), role majitel a podpora a audit.

Tabulky `operators`, `operator_sessions`, `operator_backup_codes` a pomocné funkce už od M3 existovaly; chyběl jen zdroj identity a druhý faktor.

## Možnosti

| Možnost                                                                                                              | Pro                                                                                                                                                                           | Proti                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Vlastní kód z e-mailu (výzvy z M4) + TOTP (RFC 6238) + záložní kódy + vlastní relace v naší databázi**          | Žádný nový dodavatel ani proměnná mimo naše. Využívá hotové výzvy `login_challenges`, omezení počtu požadavků, pauzy a e-maily z M4. Vše v jednom schématu, testovatelné v CI | Vlastní kód kolem druhého faktoru (TOTP, šifrování klíče, záložní kódy, obnova): kus kryptografie k údržbě. TOTP jde v reálném čase vyloudit phishingem                          |
| B. Passkey (WebAuthn) jako druhý faktor hned                                                                         | Odolné proti phishingu, žádné opisování                                                                                                                                       | Větší práce (registrace, ověření podpisu, správa zařízení), složitější záložní postup při ztrátě zařízení, nutná ruční kontrola zařízení a správců hesel. Nechat jako další krok |
| C. Externí identita (Cloudflare Access, Auth0, přihlášení přes GitHub nebo Google s vynuceným MFA) před administrací | Hotové MFA a správa zařízení, passkey                                                                                                                                         | Nový dodavatel, náklady, další závislost v nejcitlivější části a další místo, kam by unikaly e-maily operátorů. Přihlášení by přestalo být součástí našich testů a auditu        |
| D. Vrátit Supabase Auth                                                                                              | Hotové                                                                                                                                                                        | Vyžaduje klíče s právy nad celým sdíleným projektem a `NEXT_PUBLIC_SUPABASE_*`, což majitel vyloučil (ADR 0011). Zamítnuto                                                       |
| E. Jen kód z e-mailu bez druhého faktoru                                                                             | Nejjednodušší                                                                                                                                                                 | Převzetí schránky = převzetí všech zakázek. Nesplňuje zadání                                                                                                                     |

## Rozhodnutí (doporučení)

**Zvolit A.** Passkey (B) přidat jako silnější alternativu k TOTP v dalším kroku (viz TODO níže). Možnosti C až E nepoužívat.

### Postup přihlášení

1. **E-mail.** Operátor zadá e-mail. Odpověď je vždy stejná (stejná práce v databázi, e-mail se posílá až po odpovědi), takže nejde zjistit, kdo je operátor. Registrace neexistuje: operátora zakládá majitel.
2. **Kód z e-mailu** (výzva `login_challenges.purpose = 'operator_login'`, platnost 10 minut, jednou použitelný, po pěti chybách se zneplatní, v databázi jen HMAC). Pole je obyčejné, jde do něj vložit ze schránky i s mezerou (`autocomplete="one-time-code"`, `inputmode="numeric"`). Po ověření vznikne relace **AAL1** (`operator_sessions.aal2_verified_at = null`).
3. **Druhý faktor.** Kód TOTP z aplikace (6 číslic, krok 30 s, tolerance ±1 krok) nebo záložní kód, v jednom poli (podle tvaru se pozná, o který jde). Po ověření se nastaví `aal2_verified_at` (**AAL2**). Každý časový krok TOTP jde použít jednou (`operators.totp_last_step`, atomická změna v databázi), takže odposlechnutý kód nejde přehrát.
4. **První přihlášení.** Operátor bez zapsaného faktoru se nedostane do administrace, dokud neotevře stránku zápisu: ukáže se QR kód i klíč textově, operátor potvrdí kódem z aplikace a dostane deset záložních kódů, které se ukážou jednou.
5. **WCAG 3.3.8.** Žádný krok nevyžaduje paměťový test, opisování obrázku ani hádanku; pole nebrání vkládání; QR kód má vždy textovou náhradu (klíč). Chyby jsou napsané slovy a zaměřují chybné pole.

Celá administrace (stránky i Server Actions) vyžaduje **AAL2 a roli**, a to při každém požadavku a každém zásahu na serveru (`authorizeOperator`), ne jen při vstupu. Funkce `op_*` si navíc roli a stav operátora ověřují v databázi a zásah zapisují do `audit_log` v téže transakci.

### Technické provedení

- **Tajný klíč TOTP** je v databázi jen zašifrovaný (AES-256-GCM přes `seal`, klíč odvozený HKDF z proměnné `OPERATOR_MFA_KEY`, identifikátor operátora je součástí ověřovaných dat, takže šifrový text nejde přenést k jinému operátorovi). Čitelný klíč se ukáže jen na stránce zápisu a je i v QR kódu; nikam se nezapisuje ani neloguje.
- **Záložní kódy:** deset kódů po deseti znacích z abecedy bez zaměnitelných znaků (`ABCDE-FGHJK`), v databázi jen HMAC svázaný s operátorem a klíčem. Použití je jednorázové (atomicky), zapíše se do auditu a oznámí e-mailem. Operátor si může vytvořit novou sadu (stará se zneplatní).
- **Relace:** neprůhledný token (32 náhodných bajtů), v databázi SHA-256, cookie `__Host-sv_operator` (lokálně `sv_operator`), `HttpOnly`, `Secure`, `SameSite=Lax`, bez `Domain`, jen pro `admin.`. Nečinnost 30 minut (posun nejvýše jednou za minutu), absolutně 8 hodin. Nová relace při přihlášení odvolá starou (fixace relace). Zakázání operátora odvolá všechny jeho relace a relace s ním přestane platit okamžitě.
- **Omezení počtu požadavků** (ADR 0010, `src/ops/config.ts`): vyžádání kódu 5 za hodinu na e-mail a 20 na IP, ověření kódu 30 na IP, druhý faktor 30 na IP a navíc pauza podle operátora (5 chyb, 15 minut, dvojnásobek každou sérii, strop 24 hodin). Selhání úložiště čítačů přihlášení zavře (výjimka).
- **Oznámení:** každé přihlášení a každé použití záložního kódu nebo nová sada kódů se oznámí e-mailem operátorovi (typ `operator_notice` v `email_log`, bez obsahu).
- **Role** (`operators.role`): `owner` smí vše; `support` smí číst, psát poznámky, poslat správci přihlašovací odkaz, nahlédnout do údajů hostů se souhlasem páru a zablokovat web. Změnu adresy, prodloužení lhůt, obnovu, ostatní změny stavu, audit a správu operátorů dělá jen majitel. Matice je v `src/ops/roles.ts` a v migraci `20261004120100_operators_ops.sql`, hlídají ji testy SQL i e2e.
- **Údaje hostů** operátor ve výchozím stavu nevidí ani jako majitel. `op_view_guest_data` vrátí něco jen při aktivním `data_access_grants` (souhlas páru z M7, platnost a odvolání), vyžaduje důvod a každý pokus (i odmítnutý) zapíše do auditu. Seznam zakázek a hledání pracují jen s jmény páru, adresou a e-maily správců.

### Založení prvního operátora (majitele)

První operátor vznikne mimo aplikaci spojením **vlastníka databáze**, ne přes veřejnou cestu a bez hesel v repozitáři:

```bash
export MIGRATE_DATABASE_URL='postgresql://postgres:<heslo>@db.<ref>.supabase.co:5432/postgres'
npm run db:migrate                                   # aplikuje i migrace M9
npm run ops:create-owner -- majitel@example.cz
```

Skript odmítne aplikační roli a port 6543, založí majitele jen když ještě žádný aktivní není (další majitele zakládá majitel v administraci; skript je vyžaduje s `--allow-additional`), a zapíše audit (`operator.bootstrap`, aktér `system`, bez e-mailu). Majitel pak otevře `https://admin.se-vezmou.cz/prihlaseni`, opíše kód z e-mailu a zapíše druhý faktor. Na Vercelu musí být nastavené `OPERATOR_MFA_KEY` (min. 32 náhodných znaků, `openssl rand -base64 48`), spolu s `AUTH_SECRET`, `RATE_LIMIT_SECRET` a údaji AWS SES, jinak se kód nepošle. Další operátory zakládá majitel na stránce Operátoři; podpora si faktor zapíše při prvním přihlášení.

### Obnova druhého faktoru

- **Podpora ztratí faktor i záložní kódy:** majitel na stránce Operátoři po ověření totožnosti zneplatní její faktor, kódy i relace (`op_reset_operator_mfa`, audit s důvodem). Podpora si při dalším přihlášení zapíše nový.
- **Majitel ztratí faktor a záložní kódy:** majitel si faktor sám neobnoví (zásah u sebe se odmítne), obnoví ho jiný majitel, nebo vlastník databáze: `npm run ops:reset-mfa -- majitel@example.cz` (stejné spojení jako při zakládání). Doporučení: druhý majitel a záložní kódy uložené mimo telefon (správce hesel).
- **Rotace `OPERATOR_MFA_KEY`:** změna klíče znamená, že uložené klíče TOTP nejdou dešifrovat; všichni operátoři musí zapsat faktor znovu (`ops:reset-mfa` pro každého). Rotaci tedy plánovat a oznámit; dvojí klíč (starý a nový) by byl vhodným rozšířením, kdyby rotace byla častá.

## Důsledky

- **Cena:** žádná nová služba ani poplatek; práce na vlastním kódu (TOTP, záložní kódy, obnova) a na jeho testech (jednotkové testy včetně vektorů z RFC 4226 a 6238, SQL testy, e2e).
- **Bezpečnost:** dva faktory výrazně snižují riziko převzetí účtu z uniklé schránky. Přijatá rizika:
  - TOTP jde vyloudit phishingem v reálném čase (proto passkey později) a SHA-1 v RFC 6238 se nedá změnit, aniž by se přestaly shodovat aplikace.
  - **Okno před prvním zápisem faktoru:** dokud nový operátor (nebo operátor po obnově) faktor nezapíše, stačí k zápisu přístup do jeho schránky. Majitel má operátora zakládat těsně před jeho prvním přihlášením.
  - Kdo ovládá schránku a opakovaně žádá o kód, může operátorovi vyčerpat limit vyžádání kódu (5 za hodinu); je to stejný kompromis jako u správců a řeší se omezením podle IP a případně ručním zásahem majitele.
  - Operátor je centrální riziko, proto audit, oddělení rolí a nulový přístup k údajům hostů bez souhlasu.
- **Údržba:** při změně formátu šifrování klíče nebo záložních kódů je nutná migrace dat (nebo obnova faktorů). `OPERATOR_MFA_KEY` je nová tajná hodnota v provozní příručce.
- **Co se mění oproti ADR 0008:** varianta A už neznamená Supabase Auth; úrovně AAL1 a AAL2 jsou naše (`operator_sessions.aal2_verified_at`). Zbytek ADR 0008 (postup přihlášení, záložní kódy, obnova přes majitele, relace, omezení, role) platí.

## TODO a otevřené

- **Passkey (WebAuthn)** jako silnější druhý faktor vedle TOTP (OQ-50): tabulka pověření, registrace a ověření podpisu, záložní postup při ztrátě zařízení, aktualizace tohoto ADR.
- **Oznámení páru o nahlédnutí operátora** do údajů hostů (e-mail správcům, `docs/security-privacy.md` kap. 5): patří k správě souhlasu v M7, funkce `op_view_guest_data` už zapisuje audit s důvodem a počtem (OQ-51).
- Zda majitel chce, aby audit mohla číst i podpora (výchozí: jen majitel) a zda mají být relace operátora vázané na IP nebo zařízení (OQ-52).
