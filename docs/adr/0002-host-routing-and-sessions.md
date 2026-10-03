# ADR 0002: Směrování podle hostitele a relace

- Stav: navrženo (2. 10. 2026), čeká na schválení majitelem. Poznámka (ADR 0011): krátkodobý JWT pro `supabase-js` zanikl, claimy se nastavují v transakci přímého spojení `pg`; zdroj identity operátorů bez `supabase-js` je otevřený (OQ-47).
- Související: `docs/technical-design.md` (kapitola 2), `docs/data-model.md` (`sessions`, `operator_sessions`), ADR 0001, `docs/security-privacy.md`.

## Kontext

Jedna aplikace na Vercelu obsluhuje `se-vezmou.cz`, `app.se-vezmou.cz`, `admin.se-vezmou.cz` a `jmeno-a-jmeno.se-vezmou.cz`. Podle `Host` se musí poznat, co se vykreslí. Interní struktura nesmí být zvenku dostupná. Cookies platí vždy jen pro konkrétního hostitele, nikdy pro celou doménu. Správce a host se přihlašují bez hesla a operátor má druhý faktor. Next.js 16 v repozitáři nahrazuje `middleware` souborem `proxy` (běží v Node.js runtime).

## Možnosti

### Směrování

- **S1. `src/proxy.ts` přepíše cestu podle `Host`** na interní segmenty (`/h/marketing`, `/h/app`, `/h/admin`, `/h/tenant/[slug]`), interní prefix zvenku vrací 404. Jedna aplikace, jedno nasazení.
- **S2. Samostatné projekty Vercelu** pro každý druh hostitele (monorepo). Silnější izolace nasazení, ale čtyři nasazení, sdílené balíčky, víc konfigurace a nákladů; zadání požaduje jednu aplikaci.
- **S3. Cesty místo hostitelů** (`se-vezmou.cz/app`, `/s/klara-a-matej`). Jednodušší, ale odporuje zadání (subdomény) a nedovoluje cookies oddělené podle hostitele.

### Relace správců a hostů

- **R1. Vlastní relace:** neprůhledný náhodný token, v DB jen hash, cookie jen pro hostitele.
- **R2. Supabase Auth pro všechny** (e-mail OTP). Hotové, ale PIN správy a PIN hostů by byly vlastní kód stejně, hosté by dostali uživatelské účty, které zadání nechce, a model relace by určoval dodavatel.
- **R3. Bezstavový podepsaný token v cookie** (např. knihovna pro šifrované cookie). Bez zápisu do DB, ale nejde odvolat jednotlivou relaci ani vynutit absolutní platnost bez seznamu odvolaných.

### Operátoři

- **O1. Supabase Auth (e-mail OTP) + povinné TOTP se záložními kódy**, passkey později.
- **O2. Jen passkey (WebAuthn) od začátku.** Nejlepší odolnost proti phishingu, ale záložní postup a podpora zařízení jsou složitější pro prvního operátora, a Supabase Auth ho nemusí nativně podporovat `[OVĚŘIT]`.
- **O3. Heslo + TOTP.** Zadání chce přihlášení bez hesla pro správce; u operátorů zbytečně přidává tajemství k uložení.

## Doporučení

### Směrování: S1

`src/proxy.ts` podle `Host` přepíše na interní segmenty:

| Hostitel              | Segment                                       |
| --------------------- | --------------------------------------------- |
| `se-vezmou.cz`        | `/h/marketing/{cs                             | en}` |
| `app.se-vezmou.cz`    | `/h/app`                                      |
| `admin.se-vezmou.cz`  | `/h/admin` (jazyk z předpony `/en`, ADR 0013) |
| `<slug>.se-vezmou.cz` | `/h/tenant/<slug>/{locale}`                   |

- Interní prefixy zvenku blokovat (404), stejně jako neznámé hostitele a víceúrovňové subdomény.
- Lokálně `*.localhost`; pro náhledy předvolby v env (`HOST_PRESET`, `PREVIEW_TENANT_SLUG`), které produkce nikdy nečte.
- Proxy nedělá dotazy do DB a není bezpečnostní hranice: každá Server Action a route handler ověřuje relaci a oprávnění sama (varování dokumentace `proxy.md`: vyloučení cesty z matcheru by jinak odebralo kontrolu i Server Actions).

### Relace správců a hostů: R1

- **Token:** 32 náhodných bajtů (`crypto.getRandomValues`), v cookie base64url; v databázi `sessions.token_hash` (SHA-256; token má vysokou entropii, pomalý hash není potřeba). Hash se porovnává v konstantním čase přes unikátní index.
- **Cookie:** jméno s prefixem `__Host-` (např. `__Host-sv_admin` na `app.`, `__Host-sv_guest` na webu páru, `__Host-sv_op` na `admin.`), atributy `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, **bez `Domain`**. Prefix `__Host-` prohlížeč vynutí jen pro přesného hostitele.
- **Správce:** nečinnost 14 dní, absolutně 60 dní. **Operátor:** nečinnost 30 minut, absolutně 8 hodin. Host po PINu: vlastní kratší lhůty `[OTÁZKA k potvrzení; návrh stejný princip]`.
- Zápis `last_seen_at` jen jednou za několik minut. Relace se po změně oprávnění (přidání nebo odebrání správce, změna PINu) odvolá nebo obnoví s novým tokenem; odhlášení smaže řádek.
- Po ověření relace server vydá krátkodobý JWT pro `supabase-js` (ADR 0001); JWT s relací nikdy neopouští server.
- CSRF: `SameSite=Lax`, kontrola `Origin` u Server Actions (Next.js ji dělá porovnáním s hostitelem; u náhledů ověřit `allowedOrigins` `[OVĚŘIT]`), mutace jen přes POST.
- Přihlášení správce jednorázovým kódem a PINem, omezení pokusů a postupné pauzy: `docs/security-privacy.md`; všude platí omezení počtu požadavků podle adresy i IP a stejná odpověď bez ohledu na existenci účtu.

### Operátoři: O1

- Identitu ověří **Supabase Auth** (e-mail OTP) a povinně **TOTP** (úroveň zabezpečení `aal2`). Operátora zakládá jen majitel v tabulce `operators` (propojení přes `auth_user_id`); bez řádku v `operators` a bez `aal2` aplikace nepustí.
- Po ověření aplikace vystaví vlastní `operator_sessions` s limity (30 minut nečinnost, 8 hodin absolutně); Supabase Auth je zdroj identity a MFA, ne správce délky relace (jeho časové limity závisejí na tarifu `[OVĚŘIT]`).
- **Záložní kódy:** generuje je aplikace, jednorázové, uložené jako hash (`operator_backup_codes`). Pokud Supabase Auth záložní kódy nativně nabízí, použít je místo vlastních `[OVĚŘIT]`.
- **Passkey později** (WebAuthn jako druhý faktor nebo náhrada TOTP) po ověření podpory zvolené služby. Splňuje WCAG 3.3.8: kód jde vložit, bez opisování obrázku.
- Obnova: majitel resetuje faktor operátora podpory (s auditem). Ztráta přístupu majitele: postup přes správu Supabase `[OTÁZKA: popsat „break-glass“ postup s majitelem, nikdo jiný ho dělat nesmí]`.
- Operátorské funkce používají service role jen přes RPC `op_*` zapisující audit ve stejné transakci.

## Důsledky

### Cena

- Proxy a relace nepřidávají platbu za dodavatele. Zápisy relací jsou řídké (omezený `last_seen_at`).
- Supabase Auth je součást zvolené služby; MFA a pokročilé limity relací mohou záviset na tarifu `[OVĚŘIT]`.
- Jedno nasazení místo čtyř (S1 oproti S2) ušetří provoz i sestavení.

### Bezpečnost

- Odvolání a absolutní platnost lze vynutit jedním řádkem (R1 oproti R3). Únik databáze neprozradí použitelné tokeny, jen jejich hash.
- `__Host-` cookie bez `Domain` brání tomu, aby subdoména jednoho páru (obsah páru je jeho vlastní, nedůvěryhodný) četla nebo přepsala cookie správy nebo operátora. To je hlavní důvod proti cookie pro celou doménu.
- Sdílený obsah v subdoménách (stránky páru) je potenciální cíl XSS; proto přísná CSP, escapování obsahu a oddělení hostitelů cookie prefixem.
- S1 znamená, že chyba v proxy může zpřístupnit interní segment; proto je blokace `/h/` s testem (e2e testuje, že přímý požadavek vrací 404 na všech čtyřech druzích hostitelů).
- Operátoři mají dva faktory, časově krátké relace, audit; podpora nevidí údaje hostů bez souhlasu páru.

### Údržba

- Vlastní relace jsou vlastní kód (vydání, rotace, úklid, odvolání). Vyžadují důkladné testy (Vitest a e2e, ADR 0004) a uzavřený seznam míst, kde se čte cookie (`src/auth/session.ts`).
- Správa dvou systémů identity (vlastní relace a Supabase Auth pro operátory) je záměrná a malá: operátorů je jednotky.
- Proxy musí zůstat tenké a bez dotazů do DB; nové pravidlo směrování vyžaduje test pro všech pět tříd hostitelů (marketing, app, admin, tenant, neplatný).
- Změna mechanismu `proxy` v dalších verzích Next.js: před upgradem číst `node_modules/next/dist/docs/` (AGENTS.md).
