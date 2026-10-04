# Databáze (Supabase / PostgreSQL)

Schéma, izolace dat mezi svatbami (RLS), funkce `security definer` a testy. Zdroje návrhu: `docs/data-model.md` (hlavní), `docs/adr/0001-database.md`, `docs/adr/0011-dedicated-schema-direct-pg.md`, `docs/adr/0010-rate-limiting.md`, `docs/security-privacy.md`.

**Sdílený projekt.** Na projektu Supabase už žijí jiné věci. Tento projekt smí používat VÝHRADNĚ vlastní schéma `se_vezmou`: všechny tabulky, typy, funkce, triggery, indexy a politiky jsou tam a migrace nic mimo něj nevytvářejí ani nemění (hlídá to test izolace). Aplikace mluví s Postgresem přímo (`pg`) jako role `se_vezmou_app`, nepoužívá PostgREST ani supabase-js. Odchylky implementace od návrhu jsou v `docs/data-model.md`, kapitola 13.

## Obsah

| Cesta                           | K čemu je                                                                                                                                                                                          |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migrations/`                   | Jediný zdroj schématu (schéma `se_vezmou`). Časově číslované soubory, aplikuje je `npm run db:migrate`.                                                                                            |
| `init/`                         | Jednorázové kroky majitele na sdíleném projektu: schéma a rozšíření (`00_`), aplikační role (`01_`). Majitel je už provedl.                                                                        |
| `tests/*.test.sql`              | Testy izolace a pravidel (čisté SQL, kontrola vyvolá výjimku `not ok - ...`).                                                                                                                      |
| `tests/as_app/*.test.sql`       | Testy spouštěné skutečným přihlášením jako `se_vezmou_app` (zapomenuté `set role`, členství, claimy).                                                                                              |
| `tests/catalog_snapshot.sql`    | Snímek katalogu pro test izolace migrací (co existuje mimo schéma `se_vezmou`).                                                                                                                    |
| `tests/helpers.sql`             | Pomocné funkce testů (schéma `tap`) a fixtura se svatbami A a B. **Nenasazuje se.**                                                                                                                |
| `tests/setup/00_shim.sql`       | Náhrada platformy Supabase (role `anon`, `authenticated`, `service_role`, `authenticator`, `se_vezmou_app`, schéma `auth`, výchozí oprávnění ve `public`) pro čistý PostgreSQL. **Nenasazuje se.** |
| `tests/golden/name-vectors.tsv` | Zlaté vektory normalizace jmen (vstup, normalizovaný tvar, klíč se seřazenými tokeny), sdílené s TypeScriptem.                                                                                     |

Migrace:

1. `foundation`: idempotentně schéma `se_vezmou`, rozšíření (`citext`, `pg_trgm`, `pgcrypto` ve schématu `extensions`) a oprávnění (jako `init/00_init_se_vezmou.sql`, bez globálních změn), doména `i18n_text`, funkce pro claimy (`se_vezmou.jwt_claims()`, `wedding_id()`, `wedding_role()`, `actor_id()`), normalizace jmen.
2. `tables_core`, `tables_content`, `tables_guests_rsvp`, `tables_ops`: tabulky, složené cizí klíče, indexy.
3. `seed`: výchozí `app_settings` a rezervovaná slova.
4. `triggers`: retenční data, `last_activity_at`, pravidla slugů, limit správců, verze webu, append-only audit, `updated_at`.
5. `rls`: RLS na každé tabulce, politiky správce, oprávnění rolí.
6. `functions_core`, `functions_public`, `functions_ops`: `rate_limit_hit`, slugy, `auth_*`, `get_public_site`, slepé RSVP, `op_*`, retence.
7. `auth_pins_lockouts` (M4): pauzy po chybách (`auth_lockout_*`, sloupec `lockouts.failures`), PIN správy a hostů (`auth_pin_get`, `auth_pin_other_hash`, `auth_pin_set`), `auth_session_context`.
8. `email_log_functions` (M4): `email_log_insert` a `email_log_set_status` (záznam e-mailu bez osobních údajů).
9. `rsvp` (M8): tolerance překlepů ve jménech (`se_vezmou.names_close`), společný zápis odpovědi `se_vezmou.rsvp_apply`, nové `rsvp_match`, `rsvp_get`, `rsvp_submit`, dále `rsvp_info`, `rsvp_unlisted_form`, `rsvp_submit_unlisted`, správcovské `admin_guest_list`, `admin_rsvp_overview`, `admin_rsvp_household`, `admin_rsvp_enter` a `analytics_record`.
10. `lifecycle_tables`, `lifecycle_functions`, `retention_functions`, `lifecycle_ops_export` (M10): evidence běhů úloh (`job_runs`, zapůjčení zámku) a upozornění (`lifecycle_notices`), archivace po konci provozu, ruční přepsání fáze, plánování a odeslání upozornění, retenční funkce s parametry `p_now`, `p_wedding_id`, `p_dry_run`, úklid, data pro operátorský dohled a export hostů a RSVP (`admin_export_guests`). Testy `96_m10_lifecycle`, `97_m10_retention` a zlaté vektory fáze `golden/phase-vectors.tsv`.
11. `admin_site` (M7a): správa webu páru. `venues.map_url`, `weddings.site_rev`, `weddings.draft_saved_at`; funkce správce `admin_site_load`, `admin_site_save` (optimistické zamykání), `admin_site_publish`, `admin_site_unpublish`, `admin_site_checkpoint`, `admin_site_version_get`, `admin_quick_notice_set`, `admin_my_weddings`; po zveřejnění průvodce pracovní kopii nepřepíše (`wizard_load`, `wizard_save`); `get_public_site` (koncept) nese odkaz na mapu.
12. `operators_auth` (M9, ADR 0012): sloupce `operators.totp_secret_enc`, `totp_confirmed_at`, `totp_last_step`, `last_login_at`, účel výzvy `operator_login`, typ e-mailu `operator_notice`, funkce `auth_operator_*` (vyhledání operátora, relace AAL1 a AAL2, zápis a ověření druhého faktoru TOTP s ochranou proti přehrání, záložní kódy).
13. `operators_ops` (M9): provozní administrace `op_list_weddings`, `op_get_wedding`, `op_add_note`, `op_change_slug`, `op_extend_retention`, `op_restore_wedding`, `op_send_login_link`, `op_overview`, `op_analytics_summary`, `op_list_retention`, `op_list_audit`, správa operátorů (`op_list_operators`, `op_create_operator`, `op_set_operator_disabled`, `op_reset_operator_mfa`) a přepracovaná `op_set_wedding_status` (matice rolí, zveřejnění jen s verzí, obnovení jen přes `op_restore_wedding`).
14. `admin_guests` (M7b): správa hostů a nastavení RSVP správcem: `admin_household_save`, `admin_household_delete`, `admin_guests_import`, `admin_invitations_bulk`, `admin_rsvp_settings_get`, `admin_rsvp_settings_save` (interní `household_write`).
15. `admin_access` (M7b): přístup ke správě: `admin_access_load`, `admin_admin_add`, `admin_admin_remove`, `admin_backup_email_set`, `admin_guest_pin_enabled_set`, `grant_operator_access`, `revoke_operator_access`, `admin_wedding_delete` a pro oznámení o nahlédnutí provozovatele `guest_data_notice_recipients` (service role).
16. `media` (M7c, ADR 0006): fotografie na Cloudflare R2. `media` dostala druh (`photo`, `card`), stav zpracování (`pending`, `processing`, `ready`, `failed`), kód chyby; kontrola `media_alt_required` odpadla (fotografie bez popisku se uloží, ale nezveřejní). Nová tabulka `media_variants` (složený cizí klíč `(wedding_id, media_id)`, klíč objektu `{wedding_id}/{media_id}/{šířka}.{formát}` hlídá kontrola tvaru) a funkce správce `admin_media_list`, `admin_media_get`, `admin_media_request` (kvóta 12 fotografií a 40 MB z `app_settings`), `admin_media_begin`, `admin_media_complete`, `admin_media_fail`, `admin_media_update`, `admin_media_delete`, `admin_media_export`, `admin_media_variant`; doručení `get_public_media` (návštěvník nebo host po PINu) a `public_media_ids`.

17. `settings_bounds_and_retention_dates` (oprava po revizi): meze `app_settings` (`app_setting_bounds`, `app_setting_valid`, spouštěč `app_settings_validate`, nové `op_set_app_setting`), `setting_int` mimo rozsah `integer` vrací výchozí hodnotu, příznaky `health_purge_extended` a `guest_purge_extended` (prodloužení lhůty operátorem přežije změnu data nebo pásma svatby), sloupce `purge_attempts`, `purge_last_attempt_at`, `purge_claimed_at`.
18. `blocked_auth_mail_wizard`: zablokovaný web (`admin_wedding_delete`, `auth_create_session` a `auth_validate_session` ho odmítnou, operátorské relace beze změny), zámek v `op_set_operator_disabled`, monotónní `email_log_set_status`, `wizard_create_draft` rozliší kolizi adresy podle názvu omezení.
19. `clock_guard`: `se_vezmou.clock_guard` a tenké obaly (`purge_*`, `lifecycle_archive_due`, `lifecycle_enqueue_notices`, `lifecycle_notices_claim`) nad přejmenovanými `*_impl`; čas z budoucnosti bez testovací hodiny je chyba `clock_in_future`.
20. `retention_gaps`: nová nastavení `abandoned_draft_days`, `archived_delete_days_after_guest_purge`, `waitlist_retention_months`; `housekeeping` (úklid `lockouts`, opuštěné koncepty, čekací listina), `lifecycle_delete_archived`, `op_erase_waitlist`, `retention_claim`, `retention_release`, záloha v `retention_due_weddings`, `op_restore_wedding` odmítne web převzatý k mazání.
21. `indexes`: zrušené nepoužívané trigramové indexy `weddings`, nový `rsvp_people_guest_idx`.
22. `guest_order`: `guests.created_at` má výchozí `clock_timestamp()`, takže pořadí hostů v domácnosti odpovídá pořadí vložení (dřív ho v rámci jedné transakce určovalo náhodné `id`).
23. `rsvp_guest_privacy` (oprava po revizi): host ověřený jen jménem (`rsvp_get`) nedostane dietu, alergie ani kontaktní e-mail z dřívější odpovědi, jen příznaky `has_health` a `has_email` (`rsvp_guest_view`); `rsvp_submit` s `keep_health` / `keep_email` uložené údaje ponechá, když host pole nechá prázdná. Správce (`admin_rsvp_household`) vidí dál vše.
24. `draft_activity` (oprava po revizi): aktivitou konceptu je i práce na hostech a nastavení RSVP a přihlášení správce; opuštěný koncept dostane běžnou lhůtu pro obnovení (`deleted_site_restore_days`) a koncept obnovený operátorem se před uplynutím lhůty nečinnosti znovu nesmaže.
25. `challenge_lockout_per_client` (oprava po revizi): `auth_verify_challenge` s klíčem klienta (HMAC IP) počítá chyby zvlášť klientovi (pauza po 5) a celému e-mailu s desetinásobným prahem, takže cizí člověk nezablokuje přihlášení majiteli adresy.
26. `admin_active_check` (oprava po revizi): `assert_admin_session()` volaná na začátku každé transakce správce (odebraný správce, smazaná nebo zablokovaná svatba nic nezmění); `admin_admin_remove` zamyká svatbu a po zámku ověří volajícího (dva správci se souběžně neodeberou navzájem).
27. `rate_limit_sliding` (oprava po revizi): `rate_limit_hit` s posuvným oknem (na hranici oken už nejde vyčerpat limit dvakrát); čítače se drží dva dny.
28. `rsvp_notify_couple`: příznak `rsvp_settings.notify_couple`, typ `rsvp_notice` v `email_log`, funkce `admin_rsvp_notify_get`, `admin_rsvp_notify_set` a `rsvp_notify_recipients` (service role).

Matice rolí operátorů (každá `op_*` si roli ověřuje sama, `assert_operator`): čtení, poznámky, poslání přihlašovacího odkazu, nahlédnutí do údajů hostů se souhlasem páru a zablokování webu smí `owner` i `support`; ostatní změny stavu, změnu adresy, prodloužení lhůt, obnovu, audit a správu operátorů jen `owner`. Žádná z nich nevrací jména ani údaje hostů; k nim vede jediná cesta `op_view_guest_data` s aktivním `data_access_grants`, důvodem a auditem.

Dřívější `TODO` v `functions_core.sql` jsou vyřešená (PINy a pauzy dodala M4, koncept a publikaci M5, správu webu M7a, operátory M9, hosty a přístup M7b, e-maily, export a retenci M10). Zbývající komentář `TODO M9` v `functions_ops.sql` (řádek 71, oznámení o nahlédnutí) je zastaralý, oznámení je od M7b hotové; migrace se neupravuje, protože by se změnil její kontrolní součet a `npm run db:migrate` by ji odmítl.

## Spuštění testů

```bash
npm run db:test
```

Skript `scripts/db-test.sh` nejdřív provede **test izolace migrací** (dvakrát: bez a s provedeným init skriptem), pak shim, init skripty, všechny migrace, pomocné funkce a testy (jako vlastník i přihlášením jako `se_vezmou_app`) a nakonec souběžný test atomicity `rate_limit_hit` (osm paralelních spojení). Má dvě varianty:

- **Bez `DATABASE_URL`** (lokálně): skript sám inicializuje dočasný cluster PostgreSQL v `$TMPDIR` (binárky hledá v `/usr/lib/postgresql/*/bin`, jinak v `PG_BIN`), spustí ho jen přes unixový socket a po testech ho smaže. Pod rootem používá uživatele `postgres` přes `runuser`, jinak běží pod aktuálním uživatelem. Docker není potřeba.
- **S `DATABASE_URL`** (CI, service container `postgres:16`): použije zadanou databázi. Skript v ní **smaže** schémata `public`, `se_vezmou`, `auth`, `extensions` a `tap`, proto vyžaduje potvrzení `DB_TEST_ALLOW_RESET=1`. Nikdy ho nesměřujte na databázi s daty.

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres DB_TEST_ALLOW_RESET=1 npm run db:test
```

Další proměnné: `DB_TEST_VERBOSE=1` vypíše každou úspěšnou kontrolu. Je potřeba klient `psql` a PostgreSQL 15 nebo novější (cílová verze je 16).

V CI běží test jako samostatný job `db` (`.github/workflows/ci.yml`), spolu s testem nástroje pro nasazení migrací (`npm run db:migrate:test`, viz níže).

### Co testy ověřují

- **Izolace migrací** (`scripts/db-test.sh`, `tests/catalog_snapshot.sql`): snímek katalogu (schémata a jejich ACL, tabulky, sloupce, omezení, spouštěče, politiky, funkce, typy, operátory, `pg_default_acl`, role, členství, nastavení rolí, rozšíření) před migracemi a po nich. Mimo schéma `se_vezmou` se nesmí změnit nic; jedinou výjimkou jsou objekty rozšíření `citext`, `pg_trgm` a `pgcrypto`, pokud je migrace instalují poprvé. Shim napodobuje Supabase včetně výchozích oprávnění ve `public`, takže test odhalí i skrytou závislost.
- `as_app/10_app_role`: skutečné přihlášení jako `se_vezmou_app`. Bez `set role` nejde číst tabulky ani volat funkce (chyba 42501), nejde přepnout na `anon` ani `postgres`, `service_role` volá funkce, ale nečte tabulky, claimy role `authenticated` platí jen v transakci.
- `10_structure`: RLS zapnuté na každé tabulce (FORCE ne, viz `docs/security-privacy.md`), žádná práva pro `anon` ani `PUBLIC` na schéma, složené klíče mezi tenant tabulkami, pravidla `security definer` funkcí (prázdný `search_path`, bez `execute` pro `public` a `anon`), audit append-only.
- `20_isolation`: správce svatby A nečte, nevkládá, nemění ani nemaže data svatby B v **žádné tabulce** (matice tabulek; nová tabulka mimo matici test shodí).
- `30_roles`: host, návštěvník, náhled, `anon` a JWT bez claimů nevidí pracovní tabulky ani nevolají funkce service role.
- `40_operator`: operátor bez grantu nevidí údaje hostů, zásah a audit vznikají v jedné transakci, audit nejde změnit.
- `50_foreign_keys`: složené cizí klíče brání křížovým odkazům mezi svatbami.
- `60_slugs`: tvar a rezervovaná slova, rezervace konceptu a její vypršení, zveřejněný slug se znovu nepřidělí, `last_activity_at`.
- `70_rate_limit` a souběžný test ve skriptu: atomicita a okna `rate_limit_hit`.
- `80_rsvp_site`: slepé RSVP (stejný tvar odpovědi), uzavřené RSVP, pozvání na události, `get_public_site`, odvozená fáze.
- `95_auth_pin` (M4): pauzy po chybách (série, zdvojnásobování, strop 24 h, samovolný návrat úrovně, nulování), `auth_pin_get` (skrývá svatbu bez PINu, smazanou, bez správce), nastavení PINu (formát hashe, odvolání relací, audit bez hodnoty), `auth_session_context`, `email_log_*` a že správce tyto funkce nespustí.
- `85_rsvp_m8` (M8): tolerance překlepů (`se_vezmou.osa_distance`, `se_vezmou.names_close`) a nejednoznačnost, vlastní a vestavěné otázky (typy, možnosti, povinnost, otázky k události), doprovod a děti, `rsvp_info`, host mimo seznam (vypnuto, zapnuto, zavřeno, role), správcovský seznam, přehled a ruční zápis (oprávnění, izolace svatby, audit bez osobních údajů), `analytics_record` bez identifikátorů.
- `87_admin_site` (M7a): oprávnění funkcí správy (návštěvník, host, náhled, `anon`, service role), izolace mezi svatbami, optimistické zamykání, zveřejnění, stažení a znovuzveřejnění, průvodce po zveřejnění, oříznutí historie, rychlá změna, výběr svatby, audit bez obsahu webu.
- `88_media` (M7c): oprávnění funkcí fotografií (návštěvník, host, náhled, `anon`, service role), žádost o nahrání (kvóta, typy, velikost, zablokovaná svatba, zapomenutá nahrávání), stavy zpracování (`begin`, `complete`, `fail`, převzetí zaseknutého zpracování), kontrola tvaru klíčů variant, popisek a dekorativní příznak, mazání a export, izolace mezi svatbami (funkce i RLS i složený cizí klíč) a doručení `get_public_media` (jen zveřejněný snímek, chráněné fotografie jen pro hosta po PINu, smazané, nezveřejněné i archivované médium nic nevrací).
- `96_operator_auth` (M9): relace operátora (AAL1 a AAL2, nečinnost, absolutní doba, odvolání, zakázaný operátor), zápis druhého faktoru (rozepsaný klíč se nepřepíše, potvrzení, záložní kódy), ochrana proti přehrání kódu TOTP, jednorázové záložní kódy, účel výzvy `operator_login`, práva funkcí.
- `97_operator_ops` (M9): `op_*` (seznam s filtry a hledáním bez údajů hostů, detail, poznámky, změna adresy a registr slugů, prodloužení lhůt, smazání a obnova, přihlašovací odkaz, přehled, analytika, retence, audit), matice rolí podpora versus majitel, správa operátorů, audit v téže transakci (atomicita), izolace od údajů hostů.
- `88_admin_guests` (M7b): oprávnění funkcí (návštěvník, host, náhled, `anon`, service role), izolace mezi svatbami, domácnosti a hosté, import a limity, hromadné pozvání, nastavení RSVP a otázky, správci a strop, záložní e-mail, PIN hostů, souhlas s nahlédnutím a jeho vazba na `op_view_guest_data`, smazání webu, audit bez osobních údajů.
- `98_db_hardening` (oprava po revizi): meze nastavení a `setting_int`, prodloužení lhůty přežije změnu data a pásma, zablokovaný web (smazání, relace, operátor), úklid `lockouts`, `clock_guard` (čas z budoucnosti, tolerance, testovací hodina, `*_impl` nespustí nikdo), monotónní `email_log_set_status`, kolize adresy ve `wizard_create_draft`, indexy, opuštěné koncepty, archivované weby, čekací listina a výmaz na žádost, převzetí a záloha při trvalém smazání webu. Souběh dvou zakázání posledních majitelů ověřuje `scripts/db-test.sh` dvěma paralelními spojeními.
- `10_structure` navíc: každá funkce schématu (nejen `security definer`) má prázdný `search_path` a nikdo z `PUBLIC` ani `anon` ji nespustí; seznam podle názvu (`lifecycle_*`, `job_run_*`, `retention_*`, `purge_*`, `*_impl`, `op_*`, pomocné funkce) nesmí spustit `authenticated`.
- `90_lifecycle`: relace a výzvy, limit správců, retenční data a mazání, výmaz hosta, normalizace jmen.

## Nasazení krok za krokem (pro majitele)

Sdílený projekt Supabase, schéma `se_vezmou`, přímé spojení `pg` přes pooler (`docs/adr/0011`). Kroky 1 a 2 majitel už provedl; jsou tu pro úplnost a pro obnovu.

1. **Init schématu.** V Supabase SQL editoru (role `postgres`) spusťte `supabase/init/00_init_se_vezmou.sql` (idempotentní). Vytvoří schéma `se_vezmou`, rozšíření `citext`, `pg_trgm`, `pgcrypto` ve schématu `extensions`, `usage` pro `authenticated` a `service_role`, `revoke` pro `anon` a `public` a výchozí oprávnění jen `in schema se_vezmou`. Skript **nemění žádné globální nastavení** (zejména nepřepisuje `pgrst.db_schemas`; PostgREST aplikace nepoužívá, ADR 0011, OQ-46). Starší verze skriptu měla poslední krok, který `se_vezmou` přidával do seznamu vystavených schémat; jestli ho majitel spustil, viz volitelný úklid níže.
   **Volitelný úklid po starší verzi init skriptu.** Starší verze `00_init_se_vezmou.sql` měla krok, který do globálního nastavení role `authenticator` (`pgrst.db_schemas`, seznam schémat vystavených přes PostgREST) přidával `se_vezmou`. Aktuální skript to nedělá a PostgREST aplikace nepoužívá (ADR 0011, OQ-46). Pokud jste starší verzi spustili, můžete `se_vezmou` ze seznamu odebrat. Nejdřív si seznam **přečtěte**; příkaz je záměrně zakomentovaný a spouští se ručně v SQL editoru (role `postgres`):

   ```sql
   -- 1) co je dnes nastaveno (nic neměňte, jen čtěte):
   select r.rolname, s as nastaveni
     from pg_db_role_setting d
     join pg_roles r on r.oid = d.setrole, unnest(d.setconfig) as s
    where r.rolname = 'authenticator' and s like 'pgrst.db_schemas=%';

   -- 2) VOLITELNÉ: odebrání se_vezmou ze seznamu, ostatní schémata zůstanou BEZ ZMĚNY.
   --    Nikdy nenastavujte pgrst.db_schemas na pevně napsaný seznam a nikdy nepřepisujte schémata jiných projektů.
   -- do $$
   -- declare
   --   v_list text;
   --   v_new  text;
   -- begin
   --   select substring(s from '^pgrst\.db_schemas=(.*)$') into v_list
   --     from pg_db_role_setting d
   --     join pg_roles r on r.oid = d.setrole, unnest(d.setconfig) as s
   --    where r.rolname = 'authenticator' and s like 'pgrst.db_schemas=%';
   --   if v_list is null then
   --     raise notice 'pgrst.db_schemas není nastaveno, není co odebírat';
   --     return;
   --   end if;
   --   select string_agg(btrim(x), ',' order by ord) into v_new
   --     from unnest(string_to_array(v_list, ',')) with ordinality as t(x, ord)
   --    where btrim(x) <> 'se_vezmou';
   --   if v_new is distinct from v_list then
   --     execute format('alter role authenticator set pgrst.db_schemas = %L', v_new);
   --     notify pgrst, 'reload config';
   --     notify pgrst, 'reload schema';
   --   end if;
   -- end
   -- $$;
   ```

   Stejně v Dashboardu: Settings, API, _Exposed schemas_ (odeberte jen `se_vezmou`).

2. **Aplikační role.** Spusťte `supabase/init/01_app_role.sql`, ale **nejdřív v něm nahraďte zástupné heslo** silným náhodným heslem (min. 32 znaků, jen písmena a číslice). Skutečné heslo nikdy neukládejte do repozitáře; po spuštění ho z historie dotazů editoru smažte.
3. **`MIGRATE_DATABASE_URL`** (na vašem počítači v `.env.migrate.local`, který není v gitu, a v tajných hodnotách GitHubu; nikdy na Vercel): spojení **vlastníka** (role `postgres`), přímé (`db.<ref>.supabase.co:5432`) nebo přes session pooler (`...pooler.supabase.com:5432`, uživatel `postgres.<ref>`). Ne transaction pooler (6543) a ne role `se_vezmou_app`; nástroj obojí odmítne. Volitelně `MIGRATE_CA_CERT` (PEM kořenové CA Supabase, stejně jako `DATABASE_CA_CERT` u aplikace): nástroj pak ověřuje certifikát serveru; bez ní je TLS bez ověření řetězu. Také jen na vašem počítači, ne na Vercel.

   ```bash
   cp .env.migrate.example .env.migrate.local   # doplňte MIGRATE_DATABASE_URL a MIGRATE_CA_CERT_FILE
   ```

   `npm run db:migrate` si soubor načte sám. Místo souboru jde i `export MIGRATE_DATABASE_URL=…` a
   `export MIGRATE_CA_CERT="$(cat supabase-root-ca.pem)"` (obsah PEM) v shellu.

   **TLS:** u vzdálené databáze nástroj vždy ověřuje certifikát serveru a kořenová CA je povinná: obsah PEM v `MIGRATE_CA_CERT`, nebo cesta k souboru v `MIGRATE_CA_CERT_FILE`. Bez ní nástroj skončí s jasnou zprávou a nic nespustí. Jen pokud výslovně a vědomě nechcete ověřovat řetězec, nastavte `MIGRATE_TLS_INSECURE=1` (TLS zůstane, ale bez ověření řetězu, takže nechrání před aktivním útočníkem v síti; nedoporučeno, jen přechodně). Lokální databáze (loopback, unixový socket) je bez TLS a nic z toho nepotřebuje.

4. **Plán:** `npm run db:migrate -- --dry-run`. Vypíše čekající migrace (soubor a sha256), nic nezapíše. Zkontrolujte, že čekají všechny a že nevypíše žádný `PROBLÉM`.
5. **Aplikace:** `npm run db:migrate`. Každá migrace běží v jedné transakci a zapíše se do `se_vezmou.schema_migrations` (verze, název, sha256, čas). Opakované spuštění nic nezmění. Změněnou už aplikovanou migraci nástroj odmítne a nikdy nic nemaže (migrace s `drop table`, `truncate`, `delete from` na nejvyšší úrovni odmítne). Stav: `npm run db:migrate -- --status`.
6. **Proměnné na Vercelu** (Project Settings, Environment Variables, jen serverové, žádné `NEXT_PUBLIC_*` pro databázi):
   - `DATABASE_URL`: `postgresql://se_vezmou_app.<ref>:<heslo>@aws-0-<region>.pooler.supabase.com:6543/postgres` (transaction pooler, role `se_vezmou_app`; za tečkou je ref projektu). `DATABASE_CA_CERT` viz níže (povinná).
   - `DATABASE_CA_CERT`: PEM kořenové CA Supabase (stejný certifikát jako `MIGRATE_CA_CERT`), **povinná** pro vzdálenou databázi: bez ní aplikace databázi nepoužije (chyba nasazení s jasnou zprávou). Dočasné vědomé opt-out: `DATABASE_TLS_INSECURE=1` (TLS bez ověření řetězu, nedoporučeno).
   - `AUTH_SECRET`, `RATE_LIMIT_SECRET`, `PIN_PEPPER`, `OPERATOR_MFA_KEY`: čtyři různé náhodné hodnoty, každá **min. 32 znaků** (`openssl rand -base64 48`). `OPERATOR_MFA_KEY` je povinný pro přihlášení operátorů (ztráta nebo změna = nový zápis druhého faktoru u všech).
   - `CRON_SECRET`: **povinné, min. 32 znaků**. Vercel ho posílá cronu v hlavičce `Authorization: Bearer …`; bez nastavené nebo s příliš krátkou hodnotou **každá cesta `/api/cron/*` tiše vrací 401** a nic se nemaže podle retence ani neposílá.
   - Fotografie přes Cloudflare R2: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (a případně `R2_ENDPOINT`, `S3_REGION`), postup níže.
   - E-maily přes AWS SES: `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `EMAIL_FROM` (odesílatel ověřený v SES). Bez nich se e-maily v produkci neodesílají (kódy nedorazí) a jejich obsah se nevypisuje; obsah se vypíše do konzole jen při `NODE_ENV=development`.
   - Dále podle `.env.example` (`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_APP_URL`, `ROOT_DOMAIN`, Sentry).
   - **Nenastavujte** `MIGRATE_DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`: aplikace je nepoužívá.
7. **Ověření po nasazení** (SQL editor, role `postgres`):

   ```sql
   -- migrace aplikovány (počet = počet souborů v supabase/migrations, dnes 31)
   select count(*) from se_vezmou.schema_migrations;
   -- RLS je zapnuté na každé tabulce schématu (0 řádků = v pořádku)
   select relname from pg_class
    where relnamespace = 'se_vezmou'::regnamespace and relkind = 'r' and not relrowsecurity;
   -- aplikační role nemá sama žádná práva ke schématu (false)
   select has_schema_privilege('se_vezmou_app', 'se_vezmou', 'usage');
   -- anon nemá k našemu schématu nic (false)
   select has_schema_privilege('anon', 'se_vezmou', 'usage');
   -- žádné naše objekty mimo schéma se_vezmou (0 řádků)
   select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'app') and c.relname in ('weddings', 'guests', 'sessions', 'operators');
   ```

   Zapomenuté `set role` ověříte přihlášením jako `se_vezmou_app` (např. `psql` s `DATABASE_URL`): `select count(*) from se_vezmou.weddings;` musí skončit `permission denied for schema se_vezmou`. V aplikaci se načte `https://se-vezmou.cz` a přihlášení na `app.se-vezmou.cz` pošle kód e-mailem (bez SES se v produkci neodešle nic a kód se nikam nevypíše). Ve Vercel logu se nesmí objevit `Chybí DATABASE_URL`.

   **Cron a `job_runs`.** Po prvním běhu cronu (denně 03:17 UTC, nebo ručně ve Vercelu _Settings → Cron Jobs → Run_) musí v tabulce přibýt řádek; když ne, je `CRON_SECRET` chybný nebo chybí (cesty `/api/cron/*` pak vrací 401 bez jakékoli viditelné chyby):

   ```sql
   select job, status, started_at, counts from se_vezmou.job_runs order by started_at desc limit 5;
   ```

### Fotografie: Cloudflare R2 (M7c, `docs/adr/0006-photo-storage.md`)

Fotografie páru leží v **novém samostatném bucketu** (ne v bucketu `g-gallery`), jurisdikce **EU**, **privátní**. Aplikace do něj píše a čte jen serverovými údaji a podepsanými adresami; bucket nemá veřejnou adresu ani vlastní doménu. Bez proměnných níže aplikace běží dál (vývoj a e2e testy používají úložiště v paměti); v produkci bez nich selže teprve použití fotografií (v editoru galerie se místo nahrávání ukáže hláška a do logu jde chyba s názvy chybějících proměnných) a trvalé smazání webu s fotografiemi se odloží, dokud úložiště není nastavené.

1. **Bucket.** Cloudflare Dashboard, R2, _Create bucket_: název např. `se-vezmou-photos`, **Location: European Union (EU) jurisdiction** (nejde později změnit). Veřejný přístup (_Public access_ a vlastní domény) nechte **vypnutý**.
2. **API token omezený na tento bucket.** R2, _Manage API tokens_, _Create API token_: oprávnění **Object Read & Write**, _Specify bucket(s)_: jen `se-vezmou-photos` (ne _Admin_ a ne všechny buckety). Uložte _Access Key ID_ a _Secret Access Key_ (zobrazí se jednou) a _Account ID_ (R2, přehled).
3. **Pravidlo životního cyklu.** Bucket, _Settings_, _Object lifecycle rules_, _Add rule_: předpona `incoming/`, _Delete uploaded objects_ po **1 dni**. Originál s polohou tak v karanténě nepřežije déle než den, i kdyby se zpracování nedokončilo. (Aplikace ho po zpracování maže sama.)
4. **CORS pro nahrávání z prohlížeče.** Bucket, _Settings_, _CORS policy_, vložte (u náhledů nasazení přidejte jejich adresy do `AllowedOrigins`):

   ```json
   [
     {
       "AllowedOrigins": ["https://app.se-vezmou.cz"],
       "AllowedMethods": ["PUT"],
       "AllowedHeaders": ["content-type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   Čtení fotografií CORS nepotřebuje (obrázky jdou přesměrováním z `/media/…`, ne přes `fetch`).

5. **Proměnné na Vercelu** (jen serverové, Production i Preview podle potřeby; změna proměnných vyžaduje nové nasazení, protože adresa úložiště je i v Content-Security-Policy):

   | Proměnná               | Hodnota                                                                              |
   | ---------------------- | ------------------------------------------------------------------------------------ |
   | `R2_ACCOUNT_ID`        | Account ID z Cloudflare                                                              |
   | `R2_ACCESS_KEY_ID`     | Access Key ID z tokenu                                                               |
   | `R2_SECRET_ACCESS_KEY` | Secret Access Key z tokenu                                                           |
   | `R2_BUCKET`            | `se-vezmou-photos` (název bucketu)                                                   |
   | `R2_ENDPOINT`          | `https://<account-id>.eu.r2.cloudflarestorage.com` (bez zadání se odvodí z účtu, EU) |
   | `S3_REGION`            | `auto`                                                                               |

   **Nenastavujte** `STORAGE_DRIVER` (jen pro automatické testy; na `VERCEL_ENV=production` ho aplikace ignoruje).

6. **Ověření.** V editoru webu (`app.se-vezmou.cz/web`, sekce Fotografie) nahrajte fotografii s polohou, doplňte popisek, zveřejněte a otevřete web: obrázek se načte z adresy `…r2.cloudflarestorage.com` přes přesměrování z `/media/…`. V R2 po zpracování nezůstane nic v `incoming/` a v `{wedding_id}/{media_id}/` je šest souborů (640, 1280 a 1920 px ve WebP a AVIF). Stažení fotografie se nesmí obejít bez podepsané adresy (`https://<account-id>.eu.r2.cloudflarestorage.com/se-vezmou-photos/…` bez podpisu vrací 403).
7. **Smlouva a záloha** (`[OTÁZKA]`, ADR 0006): smlouva o zpracování s Cloudflare a ověření umístění dat (jurisdikce EU) před betou; R2 samo nezálohuje.

### První operátor (majitel) a obnova druhého faktoru

Operátoři se nesmějí zaregistrovat sami (ADR 0012). První operátor vznikne mimo aplikaci spojením vlastníka (`MIGRATE_DATABASE_URL`, stejné jako u migrací):

```bash
npm run db:migrate
npm run ops:create-owner -- majitel@example.cz
```

Skript založí majitele jen když ještě žádný aktivní není (další majitele zakládá majitel v administraci, nebo skript s `--allow-additional`), zapíše audit `operator.bootstrap` bez e-mailu a nic nevypisuje z tajných hodnot. Na Vercel patří navíc `OPERATOR_MFA_KEY` (min. 32 náhodných znaků, `openssl rand -base64 48`; ztráta nebo změna klíče znamená nový zápis druhého faktoru u všech operátorů). Majitel pak otevře `https://admin.se-vezmou.cz/prihlaseni`, opíše kód z e-mailu a zapíše druhý faktor (aplikace TOTP), záložní kódy si uloží mimo telefon. Ztracený faktor majitele obnoví jiný majitel, nebo vlastník databáze: `npm run ops:reset-mfa -- majitel@example.cz` (zneplatní klíč, záložní kódy a relace, zapíše audit). Skripty testuje `npm run db:migrate:test`.

### Automatické nasazení migrací (GitHub Actions)

Po pushi do `main`, který mění `supabase/migrations/` nebo nástroj, spustí workflow `.github/workflows/migrate.yml`
`scripts/db-migrate.mjs` proti produkční databázi (stav, pak aplikace čekajících migrací). Ručně: Actions,
„Migrace databáze“, Run workflow (`apply`, nebo jen `status`).

- **Jednorázové nastavení:** v GitHubu Settings, Secrets and variables, Actions dvě tajné hodnoty:
  `MIGRATE_DATABASE_URL` (spojení vlastníka přes session pooler, port 5432) a `MIGRATE_CA_CERT` (obsah PEM
  kořenové CA Supabase). Job běží v prostředí `production`; v Settings, Environments k němu jde přidat schválení.
  Na Vercel tyto hodnoty nikdy nepatří (ADR 0011): běžící aplikace má jen roli `se_vezmou_app`.
- **Pořadí:** migrace běží souběžně s nasazením na Vercelu, trvají sekundy a build minuty, takže schéma je hotové
  dřív, než se přepne nový kód. Proto musí být **každá migrace zpětně kompatibilní se starým kódem**: přidávat
  (nové funkce, sloupce s výchozí hodnotou, nové přetížení), ne rušit nebo přejmenovávat, na co se starý kód
  spoléhá. Rušení až v další migraci, po nasazení kódu, který už staré nepoužívá.
- **Selhání:** neúspěšná migrace se vrátí celá (transakce) a workflow skončí chybou; nasazený kód pak běží nad
  starým schématem. Opravte migraci (novým souborem, pokud se už některá aplikovala) a pushněte znovu.

### Nástroj `npm run db:migrate`

`scripts/db-migrate.mjs` (node + `pg`, bez Supabase CLI). Evidence je v `se_vezmou.schema_migrations`, **ne** v globální `supabase_migrations` (sdílený projekt). Nástroj odmítne běžet bez `MIGRATE_DATABASE_URL`, u vzdálené databáze bez `MIGRATE_CA_CERT` (bez výslovného `MIGRATE_TLS_INSECURE=1`), s aplikační rolí, s portem 6543, když chybí role platformy Supabase, když spojení není vlastník schématu `se_vezmou`, když je schéma plné tabulek bez evidence, když se změnila už aplikovaná migrace, když aplikovaná migrace v repozitáři chybí a když čekající migrace je starší než poslední aplikovaná.

Test (`npm run db:migrate:test`, v CI job `db`) běží na čistém clusteru: dry-run, ostrý běh, idempotence, změněný checksum, chybějící a starší migrace, selhání s návratem zpět, destruktivní příkazy, strukturální testy nad databází vytvořenou nástrojem.

Ruční alternativa (jen vývoj): `for f in supabase/migrations/*.sql; do psql "$URL" -v ON_ERROR_STOP=1 -1 -f "$f"; done`. Na sdíleném projektu ji nepoužívejte, nezapisuje evidenci.

## Pasti při verzích migrací

- **Verze `20261005…` až `20261009…` leží v budoucnosti** (dnešní datum je dřívější než jejich časová značka). Je to záměr (M10, M9, M7 a opravy po revizi mají nad sebou pevné pořadí), ale znamená to, že **nová migrace musí mít verzi větší než poslední aplikovaná** (dnes `20261009120500`), ne dnešní datum. Zkontrolujte `npm run db:migrate -- --status` nebo `select max(version) from se_vezmou.schema_migrations`.
- `npm run db:migrate` **odmítne čekající migraci, která je starší než poslední aplikovaná** (zpráva o pořadí): aplikovat ji mimo pořadí by na ostrých datech mohlo dopadnout jinak než v testech. Kdo omylem pojmenuje migraci dnešním datem (např. `20261003…`), dostane tuto chybu po aplikaci novějších; řešením je soubor přejmenovat na novější verzi dřív, než se aplikuje.
- Soubory pojmenujte `RRRRMMDDHHMMSS_popis.sql` (14 číslic, malá písmena a podtržítka). Při souběžné práci dvou větví zvolte různé verze; po sloučení musí pořadí zůstat takové, v jakém se bude aplikovat. Hotovou, už aplikovanou migraci nikdy neměňte (změní se její checksum).
- Po přidání migrace aktualizujte seznam výše a počet v ověření po nasazení.

## Testovací hodina a ochrana času

Funkce `purge_*`, `lifecycle_archive_due`, `lifecycle_delete_archived`, `lifecycle_enqueue_notices`, `lifecycle_notices_claim`, `retention_claim` a `housekeeping` berou parametr `p_now` (simulovaný čas v testech). Aby ho chyba v aplikaci nebo ruční volání nemohly použít k předčasnému smazání, odmítnou `p_now` dál než 5 minut v budoucnosti (`clock_in_future`), pokud transakce nemá `se_vezmou.test_clock = 'on'`. Aplikace to zapíná jen při `CRON_TEST_CLOCK=1` mimo `VERCEL_ENV=production` (e2e, `src/lib/db/transport.ts`); SQL testy volají `select set_config('se_vezmou.test_clock', 'on', true)` na začátku souboru. V produkci se nenastavuje nic. Je to pojistka proti chybě, ne ochrana proti držiteli přihlašovacích údajů aplikace (ten si hodinu zapne sám); `p_wedding_id` a `p_dry_run` práci jen zužují nebo vracejí zpět.

## Výmaz čekací listiny na žádost

Čekací listina se maže sama po `waitlist_retention_months` (výchozí 12, čeká na schválení právníkem) od souhlasu. Na žádost o výmaz dřív to udělá majitel (operátor s rolí `owner`) v SQL editoru (role `postgres`) nebo přes `MIGRATE_DATABASE_URL`; `<id operátora>` je jeho `id` v `se_vezmou.operators`:

```sql
select se_vezmou.op_erase_waitlist('<id operátora>', 'zadatel@example.cz', 'žádost o výmaz ze dne …');
-- vrací počet smazaných řádků (0 = adresa v čekací listině není); do auditu jde jen počet, ne adresa
```

Postup si poznamenejte do evidence žádostí (odpověď žadateli do jednoho měsíce).

## Přijaté riziko: přímá oprávnění `authenticated`

Role `authenticated` má k tabulkám tenantů obecná přímá oprávnění (RLS je omezuje na svatbu správce). Prohlížeč s databází nemluví a aplikace volá jen funkce `security definer`, takže je to hloubková obrana, ne cesta použitá kódem. Zúžení nebo odebrání je následný úkol (`docs/open-questions.md`, OQ-66) a v této větvi se nemění.

## Pravidla pro další migrace

- Nová tabulka s `wedding_id`: zapnout RLS, přidat politiky, složené cizí klíče `(wedding_id, id)`, přidat ji do matice v `tests/20_isolation.test.sql` a napsat test. Chybějící RLS nebo matice shodí `npm run db:test`.
- Nová funkce `security definer`: `set search_path = ''`, plně kvalifikované názvy, `revoke ... from public, anon`, výslovný `grant` jen potřebné roli, filtr podle `se_vezmou.wedding_id()` (kromě funkcí service role před ověřením). Vše patří do schématu `se_vezmou`, žádný `alter default privileges` bez `in schema se_vezmou`, žádný `grant`/`revoke` na schéma `public` ani na jiné schéma než `se_vezmou`; test izolace to hlídá.
- Hotové migrace se po nasazení (`schema_migrations`) neupravují; změny jdou novým souborem. Změněná aplikovaná migrace nasazení zastaví.

## Funkce s obalem (zámek webu)

`get_public_site`, `get_public_media` a `public_media_ids` jsou od migrace `20261016120000_site_lock.sql`
obaly, které kontrolují heslo na celý web; původní těla jsou interní funkce `*_unlocked`. Změnu chování
dělejte v `*_unlocked` (`create or replace`), obal nepřepisujte celým tělem: zámek by tiše zmizel
(hlídá to `supabase/tests/89_site_lock.test.sql`).
