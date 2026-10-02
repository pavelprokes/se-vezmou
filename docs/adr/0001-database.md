# ADR 0001: Databáze, izolace dat mezi svatbami a omezení počtu požadavků

- Stav: navrženo (2. 10. 2026), čeká na schválení majitelem. **Částečně nahrazeno ADR 0011** (vlastní schéma `se_vezmou` na sdíleném projektu, přímé spojení `pg` místo `supabase-js`/PostgREST a krátkodobého JWT, role `se_vezmou_app` a `set local role`). Model izolace (RLS podle `wedding_id`, funkce `security definer`, omezení požadavků) platí dál.
- Související: `docs/data-model.md` (kapitola 5), ADR 0002, ADR 0004.

## Kontext

Zadání vyžaduje, aby každý řádek patřil jedné svatbě a aby kontrola oddělení platila **na úrovni databáze**: chybně napsaný dotaz v aplikaci nesmí ukázat data cizí svatby. Operátorský přístup má být samostatná a auditovaná cesta. Data mají být v EU. Provoz má být levný, tým malý, trh omezený. Součástí rozhodnutí je i omezení počtu požadavků (přihlášení, RSVP, kontrola adres), které musí fungovat bez další služby, pokud to jde.

Zvolená kombinace musí jít otestovat automaticky (test izolace je podmínkou brány B).

## Možnosti

### A. Supabase Postgres (EU, Frankfurt), RLS, krátkodobý JWT z aplikace

- SQL migrace v `supabase/migrations`, RLS na každé tabulce.
- Aplikace po ověření vlastní relace (ADR 0002) vydá krátkodobý JWT s claimy `sub`, `wedding_id`, `role` (databázová role `authenticated`) a pomocným `wedding_role`, a volá `supabase-js` s ním. Politiky porovnávají `wedding_id` s claimem.
- Service role jen pro cron, retenci, operátorské auditované cesty a úzkou sadu `security definer` funkcí (slepé RSVP, kontrola slugu, ověření relace).
- Omezení počtu požadavků: tabulka čítačů (`unlogged`) a RPC `rate_limit_hit`.

### B. Neon Postgres + Drizzle, `SET LOCAL`

- Aplikace otevře transakci, nastaví `set local app.wedding_id = '…'` (a roli) a RLS politiky čtou `current_setting('app.wedding_id')`.
- Plná kontrola nad dotazy a typy v TypeScriptu (Drizzle), žádné PostgREST.
- Vyžaduje vlastní vrstvu kolem každého dotazu, aby žádný nezapomněl `set local`; spojení přes pooler vyžaduje opatrné zacházení s `set local` (jen uvnitř transakce).

### C. Supabase se service role všude a kontrolou v aplikaci

- Nejjednodušší, ale oddělení dat by držel jen kód aplikace. **Zamítnuto**: odporuje zadání (kontrola na úrovni databáze).

### D. Samostatná databáze (nebo schéma) pro každou svatbu

- Nejsilnější izolace, ale nepřiměřený provozní a migrační náklad pro tisíce malých webů a provozní přehledy napříč zakázkami. **Zamítnuto.**

### Omezení počtu požadavků

- **R1.** Tabulka čítačů v Postgresu a RPC (součást A i B).
- **R2.** Upstash (Redis) s knihovnou pro rate limiting: rychlé, ale další dodavatel, další smlouva o zpracování a další tajné hodnoty.

## Doporučení

**Možnost A** (Supabase Postgres, EU Frankfurt, RLS, JWT z aplikace) s **omezením počtu požadavků R1**.

Důvody:

1. RLS s `wedding_id` v JWT dává izolaci vynucenou databází a dobře se testuje (pgTAP, `docs/data-model.md`, kapitola 12). Složené cizí klíče `(wedding_id, id)` zabraňují odkazům mezi svatbami.
2. Supabase poskytuje spravovaný Postgres, lokální vývoj přes CLI, migrace, zálohy a Auth pro operátory (e-mail OTP + TOTP) v jedné službě, takže pro malý tým je méně součástí k provozu.
3. Prohlížeč nikdy nevolá databázi přímo; JWT vzniká jen na serveru a žije minuty. Anon key se nepoužívá.
4. R1 nepřidává dodavatele. Počet zápisů je nízký, protože čítače se zapisují jen u přihlášení, RSVP a kontroly adres, ne při zobrazení stránky.

**Alternativa B (Neon + Drizzle) zůstává připravená** jako záložní plán: kdyby se ukázalo, že vlastní podpis JWT u zvolené verze klíčů Supabase nejde `[OVĚŘIT]`, nebo že PostgREST omezuje potřebné dotazy. Schéma a politiky jsou psané tak, aby šly přenést: helper `app.wedding_id()` lze změnit z čtení `auth.jwt()` na `current_setting('app.wedding_id')` jednou změnou funkce.

Doplňující rozhodnutí:

- `supabase/migrations` je jediný zdroj schématu; typy se generují (`supabase gen types`) do `src/data/database.types.ts`.
- Pravidla funkcí `security definer`: prázdný `search_path`, odebrané `execute` pro `public` a `anon`, vždy filtr `wedding_id = app.wedding_id()`, seznam hlídá pgTAP test.
- Dva datové klienty: `tenantClient(claims)` a `privileged` (service role, `server-only`, lint omezuje importy).
- JWT: krátkodobý (návrh pět minut), vydává se pro požadavek serveru a nikdy se neukládá do cookie ani neposílá prohlížeči. Claim `role` nese databázovou roli požadovanou PostgREST; aplikační roli nese `wedding_role`.

## Důsledky

### Cena

- Supabase: produkční provoz s denními zálohami a případně obnovou k bodu v čase vyžaduje placený tarif `[OVĚŘIT aktuální tarify a ceny; číslo nezapisuji]`. Bezplatný tarif nepředpokládám pro produkci kvůli pozastavení neaktivních projektů a zálohám `[OVĚŘIT]`.
- Dvě databáze (`staging`, `prod`) plus lokální Supabase v Dockeru; cena `staging` je samostatná položka `[OVĚŘIT]`.
- R1 zatěžuje databázi několika zápisy na citlivý požadavek; pro očekávané objemy zanedbatelné `[předpoklad, ověřit zátěžovým testem před betou]`.

### Bezpečnost

- Izolace dat je vynucená databází; chyba v dotazu aplikace neukáže cizí svatbu.
- **Riziko:** únik podpisového klíče JWT nebo service role je kompromitace všech dat. Klíče jsou jen v tajných proměnných Vercelu, odlišné pro `staging` a `prod`, jejich rotace je zdokumentovaný postup.
- RPC `security definer` obchází RLS; proto mají pevná pravidla a automatické testy.
- Smlouva o zpracování s dodavatelem, ověření umístění dat (EU Frankfurt) a podmínky záloh: úkol pro právníka a DevOps `[OVĚŘIT]`.
- Operátoři nemají politiky na tabulkách s údaji hostů; vše jde přes funkce s auditem a podmínkou souhlasu páru.

### Údržba

- Jedno místo pro schéma (SQL migrace) a ruční psaní politik: víc práce než ORM, ale explicitní a testovatelné.
- Každá nová tabulka s `wedding_id` musí mít RLS a testy; pgTAP test shodí build, pokud RLS chybí.
- Závislost na chování PostgREST a Supabase Auth (verze, změny klíčů); upgrady se řídí changelogem dodavatele.
- Přechod na variantu B je možný, ale nenulový (nahradit klienta, vrstvu dotazů a Auth operátorů).
- Rate limiting v Postgresu: nutný úklid (cron `housekeeping`); při výrazně vyšším objemu přejít na Upstash (změna uvnitř `src/auth/rate-limit.ts`, rozhraní zůstává).
