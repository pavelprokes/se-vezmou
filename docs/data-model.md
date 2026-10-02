# Datový model

Stav: návrh ke schválení (2. 10. 2026); schéma implementováno v milníku M3 (`supabase/migrations`), odchylky implementace jsou v kapitole 13. Navazuje na `docs/technical-design.md` a ADR 0001 (databáze), 0002 (relace). Přesné tabulky a politiky vzniknou jako SQL migrace v `supabase/migrations`. Co zadání nedefinuje, je označeno `[OTÁZKA]` nebo `[OVĚŘIT]` (ověřit v aktuální dokumentaci dodavatele před implementací). Ukázková jména jsou Klára a Matěj.

## 1. Zásady

- **Jeden tenant = jedna svatba.** Každá tabulka s daty svatby má sloupec `wedding_id uuid not null`. Jediná výjimka je samotná `weddings`, kde je klíčem `id`.
- **Databáze hlídá izolaci**, ne jen aplikace: RLS je zapnuté na každé tabulce, výchozí stav je zákaz, politiky povolují jen řádky s `wedding_id` z JWT (kapitola 5).
- **Složené cizí klíče proti křížovým odkazům.** Každá tabulka s `wedding_id` má `unique (wedding_id, id)`. Podřízené tabulky odkazují `foreign key (wedding_id, parent_id) references parent (wedding_id, id)`. Řádek tak nikdy nemůže ukazovat na záznam jiné svatby, ani kdyby aplikace poslala špatné ID.
- Identifikátory `uuid` (`gen_random_uuid()`), časy `timestamptz` v UTC, e-maily `citext`, stavy `text` s `check` (jednodušší migrace než typ `enum`). Názvy tabulek a sloupců anglicky, `snake_case`.
- Texty viditelné hostům jsou `i18n_text` (kapitola 9). Texty rozhraní nejsou v databázi, jsou v překladových souborech.
- Mazání: `weddings` se maže měkce (`deleted_at`), osobní údaje hostů se mažou tvrdě podle retence (kapitola 10).
- Hodnoty, které majitel mění bez nasazení (počet správců N, délka rezervace slugu, retenční lhůty), jsou v tabulce `app_settings` (kapitola 3.9). Žádná lhůta není pevně v kódu.

## 2. Přehled vztahů

```
weddings 1 ─ 1 wedding_auth
         1 ─ * wedding_admins
         1 ─ * sessions                      (kind: admin | guest_pin)
         1 ─ 1 slug_registry (aktuální slug)  * ─ 1 slug_registry (historie)
         1 ─ * pages 1 ─ * content_blocks
         1 ─ * events * ─ 0..1 venues
         1 ─ * media
         1 ─ * site_versions 1 ─ 1 site_version_sensitive
         1 ─ 1 rsvp_settings 1 ─ * rsvp_questions
         1 ─ * households 1 ─ * guests * ─ * events   (přes invitations)
         1 ─ * rsvp_responses 1 ─ * rsvp_people 1 ─ * rsvp_attendance * ─ 1 events
                                      rsvp_people 1 ─ 0..1 rsvp_health
         1 ─ * rsvp_tickets
         1 ─ 1 orders
         1 ─ * wedding_status_history, operator_notes, data_access_grants
         audit_log (wedding_id bez cizího klíče, přežije smazání)
operators 1 ─ * operator_sessions, operator_backup_codes
Mimo tenant: slug_registry (rezervovaná slova), login_challenges, rate_limits,
             lockouts, email_log, waitlist, app_settings
```

## 3. Tabulky

Sloupce `created_at timestamptz default now()` a `updated_at` jsou u všech tabulek a dále se neuvádějí.

### 3.1 Svatba, adresa, zakázka

**`weddings`**

| Pole                                       | Typ               | Poznámka                                                                                                                               |
| ------------------------------------------ | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                       | uuid pk           |                                                                                                                                        |
| `slug`                                     | text null, unique | null jen u konceptu, jehož rezervace vypršela. Check: `^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$` a bez `--`. Zveřejněný web musí mít slug. |
| `status`                                   | text              | `draft`, `pending_payment`, `published`, `archived`, `deleted`, `blocked` (FR-OPS-2)                                                   |
| `phase_override`                           | text null         | ruční zásah do fáze (viz kapitola 7), jen operátor, vždy s auditem                                                                     |
| `default_locale`                           | text              | `cs` nebo `en`                                                                                                                         |
| `locales`                                  | text[]            | podmnožina `{cs,en}`, obsahuje `default_locale`                                                                                        |
| `template`                                 | text              | `editorial`, `eukalyptus`, `chateau`, `modern`                                                                                         |
| `palette`                                  | text              | klíč palety, platnost ve vztahu k šabloně hlídá aplikace a test kontrastu                                                              |
| `partner_a_name`, `partner_b_name`         | text              | např. Klára a Matěj; nepřekládají se                                                                                                   |
| `starts_on`, `ends_on`                     | date              | `ends_on` null u jednodenní svatby, vícedenní svatby ji vyplní                                                                         |
| `timezone`                                 | text              | výchozí `Europe/Prague`; fáze se počítají v tomto pásmu                                                                                |
| `published_version_id`                     | uuid null         | odkaz na `site_versions` (složený FK)                                                                                                  |
| `quick_notice`                             | i18n_text null    | „rychlá změna“ (FR-ADM-3)                                                                                                              |
| `quick_notice_enabled`                     | bool              |                                                                                                                                        |
| `guest_pin_enabled`                        | bool              |                                                                                                                                        |
| `preview_token_hash`                       | bytea null        | neuhádnutelný odkaz na náhled konceptu, uložen jen jako hash                                                                           |
| `last_activity_at`                         | timestamptz       | aktualizuje se při uložení správcem (omezeně, ne při každém úhozu); řídí rezervaci slugu                                               |
| `published_at`, `blocked_at`, `deleted_at` | timestamptz null  |                                                                                                                                        |
| `health_purge_at`, `guest_purge_at`        | timestamptz null  | vypočítá trigger z `ends_on`/`starts_on` a `app_settings`; operátor je smí prodloužit s auditem                                        |
| `purge_at`                                 | timestamptz null  | tvrdé smazání zakázky po měkkém smazání (lhůta `[LHŮTY]`)                                                                              |

**`slug_registry`** (trvalá tabulka adres, není vázána na tenant politikami)

| Pole                 | Typ              | Poznámka                                                                                                                                                                                              |
| -------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slug`               | text pk          |                                                                                                                                                                                                       |
| `state`              | text             | `reserved_word` (např. `www`, `app`, `admin`, `api`, `mail`, `podpora`, `status`, `static`, `cdn`, vulgarismy), `reserved` (koncept), `active` (zveřejněno), `retired` (po zániku webu, změně adresy) |
| `wedding_id`         | uuid null        | FK na `weddings`; u `retired` zůstává pro audit, FK `on delete set null`                                                                                                                              |
| `reserved_until`     | timestamptz null | jen pro `reserved`                                                                                                                                                                                    |
| `first_published_at` | timestamptz null |                                                                                                                                                                                                       |

Pravidla: řádek se nikdy nemaže, pokud slug byl zveřejněn (`first_published_at is not null`) nebo je `reserved_word`. Slug konceptu bez zveřejnění se po vypršení rezervace uvolní (řádek se smaže, `weddings.slug = null`). Rezervace trvá 30 dní od `weddings.last_activity_at` (hodnota `slug_reservation_days` v `app_settings`). Nezveřejněný `retired` slug lze znovu přidělit, zveřejněný nikdy (FR-PRIV-4, výchozí hodnota „nepřidělovat znovu“). Rezervaci i její kolizi řeší `unique` na `slug` v jedné transakci s vložením do `weddings`, ne aplikační kontrola.

**`orders`** (zakázka a plán)

| Pole               | Typ              | Poznámka                                                            |
| ------------------ | ---------------- | ------------------------------------------------------------------- |
| `id`, `wedding_id` | uuid             | `wedding_id` unique (jedna zakázka na svatbu)                       |
| `plan_code`        | text             | `trial` v MVP; další kódy až po rozhodnutí o cenách `[OTÁZKA]`      |
| `status`           | text             | `trial`, `awaiting_payment`, `active`, `expired`                    |
| `service_ends_at`  | timestamptz null | konec provozu; hodnotu zadá majitel (`[PODMÍNKY]`), do té doby null |
| `payment_ref`      | text null        | rezerva pro platební bránu; v MVP se nepoužívá                      |

**`wedding_status_history`**: `id`, `wedding_id`, `from_status`, `to_status`, `actor_type`, `actor_id`, `reason`, `created_at`. Slouží detailu zakázky (FR-OPS-3). Každý přechod zapisuje i `audit_log`.

### 3.2 Přístup správců, výzvy, relace

**`wedding_admins`**: `id`, `wedding_id`, `email citext`, `added_by` (admin id, null u zakladatele), `added_at`, `removed_at`, `last_login_at`. Unique `(wedding_id, email)` kde `removed_at is null`. Trigger hlídá počet aktivních správců proti `max_admins` z `app_settings` (výchozí 3, tvrdý strop 5 jako `check` ve funkci, ne v konfiguraci).

**`wedding_auth`**: `wedding_id` pk, `login_mode` (`email` nebo `pin`), `backup_email citext not null`, `admin_pin_hash`, `guest_pin_hash` (nullable), `admin_pin_failures`, `admin_pin_locked_until`, `guest_pin_failures`, `guest_pin_locked_until`, `pin_lock_level`. Hash PINu je pomalý hash s tajnou přísadou (detaily v `docs/security-privacy.md`). Společný PIN pro obě role je zakázán: při nastavení aplikace ověří, že nový PIN neodpovídá druhému hashi. Bez záložního e-mailu se `wedding_auth` nezapíše (not null).

**`login_challenges`** (bez `wedding_id`; přihlášení začíná e-mailem, svatby se určí až po ověření)

| Pole          | Typ              | Poznámka                                                                           |
| ------------- | ---------------- | ---------------------------------------------------------------------------------- |
| `id`          | uuid pk          |                                                                                    |
| `email_hash`  | bytea            | HMAC e-mailu; odpověď na vyžádání kódu je vždy stejná, ať e-mail existuje, nebo ne |
| `purpose`     | text             | `admin_login`, `admin_add_confirm`, `operator_recovery`                            |
| `code_hash`   | bytea            | hash šestimístného kódu nebo odkazu                                                |
| `expires_at`  | timestamptz      | 10 minut                                                                           |
| `consumed_at` | timestamptz null | jednou použitelný                                                                  |
| `attempts`    | smallint         | po překročení se výzva zneplatní                                                   |

**`sessions`** (správci a hosté, ADR 0002)

| Pole                                     | Typ              | Poznámka                                                                                                           |
| ---------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| `id`                                     | uuid pk          |                                                                                                                    |
| `token_hash`                             | bytea unique     | SHA-256 neprůhledného 32bajtového tokenu; token je jen v cookii                                                    |
| `kind`                                   | text             | `admin` nebo `guest_pin`                                                                                           |
| `wedding_id`                             | uuid             |                                                                                                                    |
| `subject_id`                             | uuid null        | `wedding_admins.id` u `admin`                                                                                      |
| `last_seen_at`                           | timestamptz      | zapisuje se nejvýše jednou za několik minut, aby relace nezatěžovaly DB `[předpoklad]`                             |
| `idle_expires_at`, `absolute_expires_at` | timestamptz      | správce: 14 dní nečinnosti, 60 dní absolutně. Host po PINu: hodnoty `[OTÁZKA]`, návrh stejný princip, kratší lhůty |
| `revoked_at`                             | timestamptz null |                                                                                                                    |

**`rsvp_tickets`**: `token_hash` pk, `wedding_id`, `household_id`, `expires_at`, `purpose` (`edit`). Krátkodobý lístek, který slepé ověření jména vydá po shodě; neprozrazuje seznam hostů.

### 3.3 Obsah webu

**`pages`**: `id`, `wedding_id`, `path text` (prázdný řetězec = domovská stránka), `title i18n_text`, `position`, `enabled`. Unique `(wedding_id, path)`. V MVP má každá svatba jednu stránku s `path = ''` (kapitola 8).

**`content_blocks`**

| Pole                          | Typ       | Poznámka                                                                                                  |
| ----------------------------- | --------- | --------------------------------------------------------------------------------------------------------- |
| `id`, `wedding_id`, `page_id` | uuid      | složený FK na `pages`                                                                                     |
| `type`                        | text      | `hero`, `program`, `venue`, `lodging`, `dresscode`, `faq`, `contact`, `story`, `gifts`, `gallery`, `rsvp` |
| `enabled`                     | bool      | zapínatelné bloky (FR-ADM-1)                                                                              |
| `position`                    | int       | pořadí na stránce; unique `(page_id, position)` deferrable, aby šlo přehodit dva bloky v jedné transakci  |
| `anchor`                      | text      | kotva v URL; unique v rámci stránky                                                                       |
| `sensitive`                   | bool      | blok se hostům zobrazí až po PINu (např. `gifts`)                                                         |
| `data`                        | jsonb     | obsah podle typu; schéma pro každý typ je Zod schéma v `src/domain/blocks`; texty uvnitř jsou `i18n_text` |
| `updated_by`                  | uuid null | `wedding_admins.id`                                                                                       |

Tabulka je pracovní kopie pro editor. Hosté ji nikdy nečtou, čtou zveřejněný snímek.

**`site_versions`** (historie a zveřejněná verze, FR-ADM-2)

| Pole               | Typ       | Poznámka                                                                          |
| ------------------ | --------- | --------------------------------------------------------------------------------- |
| `id`, `wedding_id` | uuid      |                                                                                   |
| `version_no`       | int       | unique `(wedding_id, version_no)`                                                 |
| `kind`             | text      | `publish` (zveřejněná verze), `checkpoint` (bod pro vrácení)                      |
| `public_content`   | jsonb     | vykreslitelný obsah bez citlivých bloků, včetně nastavení šablony, palety, jazyků |
| `note`             | text null |                                                                                   |
| `created_by`       | uuid null |                                                                                   |

**`site_version_sensitive`**: `version_id` pk, `wedding_id`, `sensitive_content jsonb` (číslo účtu, adresa soukromého místa a další bloky se `sensitive = true`). Oddělení do druhé tabulky umožňuje řešit „jen po PINu“ na úrovni řádkové politiky a RPC, ne filtrováním v aplikaci. Vrácení verze = načtení snímku do pracovních tabulek jako nový koncept a nová publikace; staré verze se nepřepisují. Počet uchovávaných verzí je v `app_settings` (`versions_keep`, hodnotu určí implementace).

**`events`** (program a události pro větvení RSVP)

| Pole                               | Typ         | Poznámka                                                                    |
| ---------------------------------- | ----------- | --------------------------------------------------------------------------- |
| `id`, `wedding_id`, `page_id null` | uuid        |                                                                             |
| `kind`                             | text        | `ceremony`, `reception`, `other`                                            |
| `title`, `description`             | i18n_text   |                                                                             |
| `starts_at`, `ends_at`             | timestamptz | `ends_at` null                                                              |
| `venue_id`                         | uuid null   | složený FK na `venues`                                                      |
| `rsvp_enabled`                     | bool        | událost je cílem pozvání a větvení RSVP (obřad a hostina zvlášť, FR-RSVP-3) |
| `position`                         | int         |                                                                             |

**`venues`**: `id`, `wedding_id`, `name i18n_text`, `address text` (textová adresa vždy, FR-WEB-1), `directions i18n_text null`, `lat`, `lng` (null, mapa je jen doplněk), `is_private bool` (adresa jde do `site_version_sensitive`).

**`media`**: `id`, `wedding_id`, `kind` (`photo`, `card`), `status` (`pending`, `processing`, `ready`, `failed`), `failure_code`, `storage_path`, `mime`, `width`, `height`, `bytes`, `alt i18n_text null`, `decorative bool default false`, `deleted_at`. Popisek (`alt`) může chybět: fotografie bez popisku a bez příznaku `decorative` se **nezveřejní** (kontrola při sestavení snímku v aplikaci, upozornění v rozhraní; M7c, kontrola `media_alt_required` odpadla). Obrázek karty externí galerie (`card`) je vždy dekorativní. Zpracování obrázků a umístění souborů určuje ADR 0006; model drží metadata a klíče.

**`media_variants`** (M7c): `wedding_id`, `media_id`, `width`, `height`, `format` (`avif`, `webp`), `bytes`, `storage_key`. Primární klíč `(media_id, width, format)`, složený cizí klíč `(wedding_id, media_id)` na `media` (kaskáda), kontrola tvaru klíče `{wedding_id}/{media_id}/{width}.{format}`. Správce tabulku jen čte, zapisuje ji funkce `admin_media_complete`.

### 3.4 Hosté, domácnosti, pozvání

**`households`**: `id`, `wedding_id`, `label text` (např. rodina Novákových, jen pro správce), `invited_note`.

**`guests`**

| Pole               | Typ                   | Poznámka                                                                                                                      |
| ------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `id`, `wedding_id` | uuid                  |                                                                                                                               |
| `household_id`     | uuid                  | složený FK; každý host patří do domácnosti (jednotlivec = domácnost o jednom)                                                 |
| `display_name`     | text                  |                                                                                                                               |
| `name_norm`        | text generated stored | `se_vezmou.normalize_name(display_name)`: Unicode NFKD bez diakritiky, malá písmena, odstraněná interpunkce a zbytečné mezery |
| `name_key`         | text generated stored | `name_norm` s tokeny seřazenými abecedně (shoda „Novák Matěj“ a „Matěj Novák“)                                                |
| `is_child`         | bool                  |                                                                                                                               |
| `age`              | smallint null         | jen u dětí, jen pokud pár zadá                                                                                                |
| `is_plus_one`      | bool                  | host doplněný ručně při RSVP                                                                                                  |
| `source`           | text                  | `import`, `manual`, `rsvp`                                                                                                    |
| `locale`           | text null             | jazyk e-mailu                                                                                                                 |

**`invitations`**: `wedding_id`, `guest_id`, `event_id`, pk `(guest_id, event_id)`. Hosté vidí jen otázky a události, na které mají řádek.

Normalizaci jmen zajišťuje jedna implementace v SQL (nemění se mezi aplikací a databází). TypeScript `src/lib/rsvp/names.ts` (M8) slouží k náhledu a deduplikaci při importu; obě implementace ověřuje společný soubor zlatých vektorů (Vitest `names.test.ts` i SQL test `90_lifecycle`).

### 3.5 RSVP

**`rsvp_settings`**: `wedding_id` pk, `opens_at`, `closes_at` (null = bez omezení), `allow_unlisted bool` (FR-RSVP-7), `email_confirmation bool`, `enabled_questions jsonb` (zapnuté vestavěné otázky: doprovod, děti, dieta, ubytování, doprava, píseň).

**`rsvp_questions`** (vlastní otázky páru): `id`, `wedding_id`, `key`, `type` (`text`, `choice`, `bool`), `label i18n_text`, `options jsonb null` (u `choice`, texty jako `i18n_text`), `required`, `event_id null` (otázka jen pro událost), `position`, `enabled`.

**`rsvp_responses`** (jedna odpověď za domácnost)

| Pole                             | Typ         | Poznámka                                                               |
| -------------------------------- | ----------- | ---------------------------------------------------------------------- |
| `id`, `wedding_id`               | uuid        |                                                                        |
| `household_id`                   | uuid null   | null jen u hosta mimo seznam (pokud pár povolí)                        |
| `submitted_at`, `last_edited_at` | timestamptz |                                                                        |
| `answers`                        | jsonb       | odpovědi na vestavěné a vlastní otázky (bez zdravotních údajů)         |
| `contact_email`                  | citext null | jen pokud host chce potvrzení e-mailem; po odeslání se nepoužije jinak |
| `entered_by`                     | text        | `guest` nebo `admin` (ruční zápis telefonického hosta, FR-ADM-5)       |

**`rsvp_people`**: `id`, `wedding_id`, `response_id`, `guest_id null`, `person_name`, `is_plus_one`, `is_child`, `age`. Plus jedna se zapisuje jako osoba bez `guest_id`.

**`rsvp_attendance`**: `wedding_id`, `person_id`, `event_id`, `attending bool`, pk `(person_id, event_id)`.

**`rsvp_health`** (zdravotní údaje zvlášť): `person_id` pk, `wedding_id`, `diet text`, `allergies text`, `exported_at null`. Samostatná tabulka umožňuje přísnější politiku, samostatné mazání a vynechání z běžných exportů a operátorských pohledů.

Volný text vlastních otázek pár nemůže technicky odlišit od zdravotních údajů. Rozhraní proto u vlastní otázky upozorní, že zdravotní údaje patří do pole pro dietu `[OTÁZKA k právníkovi]`.

### 3.6 Operátoři a audit

**`operators`**: `id`, `auth_user_id uuid unique` (identita u poskytovatele přihlášení, bez cizího klíče na `auth.users`, ADR 0011), `email citext unique`, `role` (`owner`, `support`), `disabled_at`. Účty zakládá jen majitel.

**`operator_sessions`**: stejná struktura jako `sessions` plus `operator_id`, `aal2_verified_at`; nečinnost 30 minut, absolutně 8 hodin. Supabase Auth ověřuje identitu a TOTP; relace aplikace nese časové limity (limity relací Supabase Auth bývají vázané na tarif `[OVĚŘIT]`).

**`operator_backup_codes`**: `operator_id`, `code_hash`, `used_at`. Záložní kódy generuje aplikace (nativní podporu v Supabase Auth `[OVĚŘIT]`); jednorázové, uložené jen jako hash.

**`data_access_grants`**: `id`, `wedding_id`, `granted_by_admin_id`, `reason text`, `scope` (`guest_data`), `expires_at`, `revoked_at`. Bez aktivního záznamu nevrátí operátorská funkce žádná jména ani dietní údaje (zadání: nahlédnutí jen na žádost páru).

**`operator_notes`**: `id`, `wedding_id`, `operator_id`, `body` (poznámky bez osobních údajů hostů).

**`audit_log`**

| Pole                       | Typ             | Poznámka                                                            |
| -------------------------- | --------------- | ------------------------------------------------------------------- |
| `id`                       | bigint identity |                                                                     |
| `at`                       | timestamptz     |                                                                     |
| `actor_type`               | text            | `admin`, `operator`, `system`, `guest`                              |
| `actor_id`                 | uuid null       |                                                                     |
| `wedding_id`               | uuid null       | bez cizího klíče, záznam přežije smazání svatby                     |
| `action`                   | text            | např. `wedding.status_change`, `guest_data.view`, `retention.purge` |
| `target_type`, `target_id` | text, uuid null |                                                                     |
| `reason`                   | text null       | povinný u nahlédnutí do údajů hostů                                 |
| `meta`                     | jsonb           | jen ID, počty a stavy; žádná jména, e-maily ani texty hostů         |
| `request_id`               | text null       |                                                                     |

Tabulka je append-only (kapitola 11).

### 3.7 E-maily a čekací listina

**`email_log`**: `id`, `wedding_id null`, `type` (`login_code`, `rsvp_confirmation`, `admin_changed`, `backup_login_notice`, `expiry_notice`), `locale`, `recipient_hash bytea`, `recipient_domain text`, `status` (`queued`, `sent`, `delivered`, `bounced`, `complained`, `failed`), `provider_message_id`, `error_code`, `created_at`, `delivered_at`. Bez obsahu a bez celé adresy příjemce.

**`waitlist`**: `id`, `email citext unique`, `locale`, `consent_at`, `consent_text_version`. Čekací listina je v MVP (zadání), potvrzení e-mailem (double opt-in) `[OTÁZKA]`, doporučení ano.

### 3.8 Omezení počtu požadavků

**`rate_limits`** (`unlogged`): `bucket_key text` (HMAC se scope a hodnotou, např. `login:ip`), `window_start timestamptz`, `hits int`, pk `(bucket_key, window_start)`.

**`lockouts`**: `bucket_key pk`, `level smallint`, `locked_until`. Postupné prodlužování pauzy po chybných PINech a kódech.

RPC `rate_limit_hit(bucket_key, limit, window)` vrací `(allowed, retry_after)`. Čistí je cron a oportunisticky sama funkce. Alternativa Upstash je v ADR 0001.

### 3.9 Nastavení

**`app_settings`**: `key text pk`, `value jsonb`, `updated_by`, `updated_at`. Klíče: `max_admins` (výchozí 3), `slug_reservation_days` (30), `versions_keep`, `health_retention_days_after_wedding` (30), `guest_retention_months_after_wedding` (12), `retention_notice_days_before` `[OTÁZKA]`, `deleted_site_restore_days` `[LHŮTY]`. Čtení pro aplikaci přes funkci, zápis jen majitel s auditem.

### 3.10 Analytické události

**`analytics_event`**: `id`, `event` (uzavřený seznam: `wizard_started`, `wizard_step_completed`, `site_published`, `rsvp_completed`), `locale`, `template` null, `step` smallint null, `created_at`. Bez `wedding_id`, jména, e-mailu, IP a user agenta (viz ADR 0007). Zápis jen ze serveru (service role), čtení jen operátoři v souhrnech. Mazání po 24 měsících `[LHŮTY]`.

## 4. Indexy

Primární a unikátní klíče jsou z kapitoly 3. Dále:

| Tabulka                         | Index                                                                                            | Důvod                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| všechny s `wedding_id`          | `(wedding_id)`; u časově řazených `(wedding_id, created_at)`                                     | RLS filtr a výpisy                           |
| `weddings`                      | `(status)`, `(starts_on)`, `(last_activity_at) where status = 'draft'`                           | filtry provozní administrace, cron rezervací |
| `weddings`                      | `(health_purge_at) where health_purge_at is not null`, `(guest_purge_at) ... `, `(purge_at) ...` | cron retence                                 |
| `slug_registry`                 | `(reserved_until) where state = 'reserved'`                                                      | uvolnění rezervací                           |
| `wedding_admins`                | `(email) where removed_at is null`                                                               | přihlášení e-mailem (hledání svateb správce) |
| `login_challenges`              | `(email_hash, created_at desc)`, `(expires_at)`                                                  | omezení vyžádání kódů, úklid                 |
| `sessions`, `operator_sessions` | unikátní `token_hash`; `(absolute_expires_at)`                                                   | ověření relace, úklid                        |
| `content_blocks`                | `(page_id, position)`                                                                            | vykreslení a řazení                          |
| `guests`                        | `(wedding_id, name_key)`, `(household_id)`                                                       | slepé ověření jména                          |
| `rsvp_responses`                | `(wedding_id, household_id)` unique where `household_id is not null`                             | jedna odpověď na domácnost                   |
| `rsvp_attendance`               | `(wedding_id, event_id, attending)`                                                              | přehled RSVP                                 |
| `audit_log`                     | `(wedding_id, at desc)`, `(actor_id, at desc)`                                                   | detail zakázky, kontrola zásahů              |
| `email_log`                     | `(wedding_id, created_at desc)`                                                                  | doručitelnost                                |
| `rate_limits`                   | pk stačí, `(window_start)` pro úklid                                                             |                                              |

Hledání zakázek podle jmen, adresy a e-mailu (FR-OPS-1): `pg_trgm` index na `partner_a_name || ' ' || partner_b_name` a `slug`, hledání e-mailů přes `wedding_admins.email`. Na řádově stovkách hostů na svatbu stačí filtr podle `wedding_id` bez trigramového indexu na `guests` `[předpoklad, ověřit měřením se zkušebními daty]`.

## 5. Řádková izolace (RLS)

### 5.1 Model přístupu

- RLS je zapnuté na **každé** tabulce, i na těch bez `wedding_id` (ty nemají žádnou politiku, tedy nepřístupné rolím `anon` a `authenticated`). Tabulky nemají `force row level security`: DEFINER funkce vlastní vlastník schématu (role `postgres` s `bypassrls`) a `FORCE` by je zablokoval. Aplikace se připojuje jako `se_vezmou_app`, která tabulky nevlastní a nemá k nim žádná práva (viz níže a `docs/security-privacy.md`).
- Všechno žije ve schématu `se_vezmou` (ADR 0011; schéma `app` zaniklo, ve `public` nemáme nic). Role `anon` nemá žádná práva na schéma `se_vezmou` a prohlížeč nikdy nevolá Supabase přímo (žádný klient v prohlížeči, anon key se nepoužívá).
- Aplikace po ověření vlastní relace nastaví v transakci claimy (`select set_config('request.jwt.claims', <json>, true)`, jen pro tu transakci; **ne JWT**: nic se nepodepisuje a nic neopouští server, ADR 0011): `sub` (id správce nebo hosta-relace, u návštěvníka konstantní), `wedding_id` a `wedding_role` s hodnotami `admin`, `guest_pin`, `visitor`, `preview`. Databázová role se nenese v claimu, ale příkazem `set local role authenticated` ve stejné transakci.
- Připojení: role `se_vezmou_app` (`login`, `noinherit`, `nobypassrls`, členství v `authenticated` a `service_role` jen kvůli `set role`) nemá sama žádná práva; zapomenuté `set role` proto končí chybou oprávnění. Hlídá to test `supabase/tests/as_app/10_app_role.test.sql`.
- **Service role** (`set local role service_role` v transakci, jen server) smí jen: cron a retenci, operátorské akce (RPC se zápisem auditu v téže transakci), a úzkou sadu funkcí před ověřením (`auth_*` relace a výzvy, `resolve_slug`, `check_slug`, `rate_limit_hit`). Tuto sadu hlídá lint pravidlo a test.
- Funkce pro hosty (`get_public_site`, `rsvp_match`, `rsvp_get`, `rsvp_submit`) volá server s claimy role `visitor`, `guest_pin` nebo `preview`. Hosté nemají politiky na tabulkách, jen právo `execute` na tyto funkce.

### 5.2 Pomocné funkce

```sql
create function se_vezmou.jwt_claims() returns jsonb
  language sql stable set search_path = ''
  as $$ select coalesce(nullif(pg_catalog.current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function se_vezmou.wedding_id() returns uuid
  language sql stable set search_path = ''
  as $$ select nullif(se_vezmou.jwt_claims() ->> 'wedding_id', '')::uuid $$;
create function se_vezmou.wedding_role() returns text
  language sql stable set search_path = ''
  as $$ select se_vezmou.jwt_claims() ->> 'wedding_role' $$;
create function se_vezmou.is_wedding_admin() returns boolean
  language sql stable set search_path = ''
  as $$ select se_vezmou.wedding_role() = 'admin' and se_vezmou.wedding_id() is not null $$;
-- + se_vezmou.actor_id() (claim sub); funkce čtou nastavení transakce přímo, ne schéma auth
```

### 5.3 Matice

| Tabulka                                                                                          | Správce (`admin`)                                                       | Návštěvník / host                            | Operátor (service role přes RPC)                   |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------- |
| `weddings`                                                                                       | čtení a úprava vlastní řádky; bez insertu a delete (zakládá a maže RPC) | jen přes `get_public_site`                   | RPC, zápis s auditem                               |
| `wedding_auth`, `wedding_admins`                                                                 | čtení; zápis jen přes RPC (limit N, notifikace)                         | ne                                           | RPC (odeslání přihlašovacího odkazu)               |
| `sessions`, `login_challenges`, `rsvp_tickets`, `rate_limits`, `lockouts`                        | ne (bez politik)                                                        | ne                                           | jen funkce `auth_*`                                |
| `pages`, `content_blocks`, `events`, `venues`, `media`                                           | plný přístup k vlastním řádkům                                          | jen přes `get_public_site`                   | čtení obsahu přes RPC bez údajů hostů              |
| `media_variants`                                                                                 | čtení vlastních; zápis jen přes `admin_media_complete`                  | jen přes `get_public_media` (klíč varianty)  | ne                                                 |
| `site_versions`                                                                                  | čtení a vložení vlastních                                               | jen zveřejněná verze přes funkci             | RPC                                                |
| `site_version_sensitive`                                                                         | čtení vlastních                                                         | jen role `guest_pin` a `preview` přes funkci | ne                                                 |
| `households`, `guests`, `invitations`                                                            | plný přístup k vlastním                                                 | ne (slepé ověření přes `rsvp_match`)         | jen s aktivním `data_access_grants`, jinak ne      |
| `rsvp_settings`, `rsvp_questions`                                                                | plný přístup k vlastním                                                 | čtení otevřených otázek přes funkci          | RPC                                                |
| `rsvp_responses`, `rsvp_people`, `rsvp_attendance`                                               | čtení a ruční zápis vlastních                                           | zápis a úprava jen přes `rsvp_submit`        | agregované počty; detail jen s grantem             |
| `rsvp_health`                                                                                    | čtení vlastních a export                                                | zápis přes `rsvp_submit`                     | nikdy v běžných pohledech; jen s grantem a auditem |
| `orders`, `wedding_status_history`                                                               | čtení vlastních                                                         | ne                                           | RPC                                                |
| `audit_log`                                                                                      | čtení zásahů operátora u vlastní svatby                                 | ne                                           | jen insert funkcemi                                |
| `operators`, `operator_*`, `data_access_grants` (zápis), `email_log`, `waitlist`, `app_settings` | ne                                                                      | ne                                           | RPC                                                |
| `slug_registry`                                                                                  | ne                                                                      | ne                                           | `resolve_slug`, `check_slug`                       |

### 5.4 Konkrétní politiky

Obecný vzor pro tabulky správce (`pages`, `content_blocks`, `events`, `venues`, `media`, `households`, `guests`, `invitations`, `rsvp_settings`, `rsvp_questions`):

```sql
alter table content_blocks enable row level security;

create policy content_blocks_admin_select on content_blocks
  for select to authenticated
  using (wedding_id = se_vezmou.wedding_id() and se_vezmou.is_wedding_admin());

create policy content_blocks_admin_insert on content_blocks
  for insert to authenticated
  with check (wedding_id = se_vezmou.wedding_id() and se_vezmou.is_wedding_admin());

create policy content_blocks_admin_update on content_blocks
  for update to authenticated
  using (wedding_id = se_vezmou.wedding_id() and se_vezmou.is_wedding_admin())
  with check (wedding_id = se_vezmou.wedding_id() and se_vezmou.is_wedding_admin());

create policy content_blocks_admin_delete on content_blocks
  for delete to authenticated
  using (wedding_id = se_vezmou.wedding_id() and se_vezmou.is_wedding_admin());
```

Zvláštní případy:

```sql
-- weddings: správce vidí a mění jen svou svatbu, nezakládá ani nemaže
create policy weddings_admin_select on weddings for select to authenticated
  using (id = se_vezmou.wedding_id() and se_vezmou.is_wedding_admin());
create policy weddings_admin_update on weddings for update to authenticated
  using (id = se_vezmou.wedding_id() and se_vezmou.is_wedding_admin())
  with check (id = se_vezmou.wedding_id());
-- sloupce status, slug, phase_override, *_purge_at, blocked_at mění jen RPC:
revoke update on weddings from authenticated;
grant update (default_locale, locales, template, palette, partner_a_name, partner_b_name,
              starts_on, ends_on, timezone, quick_notice, quick_notice_enabled,
              guest_pin_enabled) on weddings to authenticated;

-- rsvp_health: čtení jen správce, zápis jen funkce rsvp_submit a ruční zápis správcem
create policy rsvp_health_admin_select on rsvp_health for select to authenticated
  using (wedding_id = se_vezmou.wedding_id() and se_vezmou.is_wedding_admin());

-- audit_log: správce vidí zásahy operátora u své svatby, nic nemění
create policy audit_admin_select on audit_log for select to authenticated
  using (wedding_id = se_vezmou.wedding_id() and se_vezmou.is_wedding_admin()
         and actor_type = 'operator');
-- audit_log je append-only: žádný update/delete ani pro service role
revoke update, delete, truncate on audit_log from public, anon, authenticated, service_role;
```

Tabulky `sessions`, `login_challenges`, `rsvp_tickets`, `rate_limits`, `lockouts`, `operators`, `operator_*`, `email_log`, `waitlist`, `app_settings`, `slug_registry` mají RLS zapnuté a žádnou politiku; přístup jen přes `security definer` funkce.

### 5.5 Funkce `security definer`

Povinná pravidla pro každou: `set search_path = ''`, plně kvalifikované názvy, `revoke execute ... from public, anon`, explicitní `grant execute` jen potřebné roli, a **vždy filtr `wedding_id = se_vezmou.wedding_id()`** (kromě funkcí service role před ověřením).

| Funkce                                                 | Volá                                       | Co dělá                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolve_slug(slug)`                                   | server (service role)                      | vrátí `wedding_id`, stav, jazyky, šablonu; nebo nic. Odpověď má stejný tvar u neexistující, nezveřejněné i zablokované adresy, aby nešlo zjistit rozdíl                                                                                                                                       |
| `check_slug(slug)`                                     | server                                     | informativní dostupnost s omezením počtu dotazů; nikdy nevrací seznam                                                                                                                                                                                                                         |
| `reserve_slug(wedding_id, slug)`                       | server                                     | rezervace při prvním uložení, `unique` hlídá kolizi, při kolizi vrátí varianty (FR-WZ-4)                                                                                                                                                                                                      |
| `get_public_site()`                                    | `visitor`, `guest_pin`, `preview`, `admin` | vrátí zveřejněný snímek; část `sensitive` jen pro `guest_pin` a `admin`; pro `preview` koncept podle tokenu                                                                                                                                                                                   |
| `rsvp_match(name)`                                     | `visitor`                                  | normalizuje jméno, porovná v rámci `se_vezmou.wedding_id()` s tolerancí překlepů (trigramy a seřazené tokeny, prahy se ladí na testovacích datech), vydá `rsvp_tickets` nebo obecnou odpověď. Nikdy nevrací seznam ani počet kandidátů; při nejednoznačnosti žádá o upřesnění bez výpisu jmen |
| `rsvp_get(ticket)`, `rsvp_submit(ticket, payload)`     | `visitor`                                  | čtení a zápis odpovědi domácnosti; zkontroluje otevření a uzavření RSVP, pozvání na události a povolení hostů mimo seznam                                                                                                                                                                     |
| `rate_limit_hit(...)`                                  | server                                     | viz 3.8                                                                                                                                                                                                                                                                                       |
| `auth_*` (vytvoření a ověření výzvy, relace, odvolání) | server                                     | před ověřením, jediná cesta ke `sessions` a `login_challenges`                                                                                                                                                                                                                                |
| `op_*`                                                 | server (service role)                      | operátorské čtení a zásahy; každá kontroluje `operators.role`, `disabled_at` a píše `audit_log` v téže transakci                                                                                                                                                                              |
| `op_view_guest_data(wedding_id, reason)`               | server                                     | vrací údaje hostů jen při aktivním `data_access_grants`; zapíše audit s důvodem                                                                                                                                                                                                               |
| `purge_*`                                              | cron                                       | retence (kapitola 10)                                                                                                                                                                                                                                                                         |

## 6. Slugy

1. Při psaní jmen v kroku 1 a 2 volá průvodce `check_slug` (informativně, s omezením počtu dotazů).
2. První uložení (zadání e-mailu a záložního e-mailu) volá `reserve_slug`: v jedné transakci vznikne `weddings` (`status = draft`), `wedding_admins`, `wedding_auth`, `orders`, `pages`, `rsvp_settings` a řádek `slug_registry (state = reserved, reserved_until = last_activity_at + slug_reservation_days)`.
3. Kolize na `unique` nezruší rozepsaná data: vrátí varianty `klara-a-matej-2027`, `klara-a-matej-2027-06`, `klara-a-matej-obec` a neuhádnutelnou `klara-a-matej-k7m2`. Rok v nabízené adrese prozradí rok svatby z tištěného oznámení; pár na to rozhraní upozorní.
4. Zveřejnění přepne `slug_registry.state` na `active` a nastaví `first_published_at`. Od té chvíle se adresa trvale nepřiděluje znovu.
5. Cron denně uvolní rezervace po `reserved_until` u nezveřejněných konceptů (`weddings.slug = null`, řádek `slug_registry` smazán). Pár při návratu dostane novou kontrolu a případně varianty.
6. Změna adresy operátorem (FR-OPS-4): starý slug přejde do `retired` (zveřejněný zůstává zablokovaný), nový se zapíše přes stejné kontroly.

## 7. Životní cyklus

Rozlišuji dvě věci, aby přechody podle dat nepotřebovaly neustálé zápisy:

- **Uložený stav** `weddings.status`: `draft`, `pending_payment`, `published`, `archived`, `deleted`, `blocked` (FR-OPS-2). Mění ho jen akce (publikace, platba, archivace, smazání, blokace) a cron.
- **Odvozená fáze** (funkce `se_vezmou.phase(wedding)` a stejná čistá funkce v `src/domain/lifecycle`): u `published` z dat `rsvp_settings.opens_at`, `closes_at`, `starts_on`, `ends_on` a `timezone`:
  `save_the_date` → `rsvp_open` → `rsvp_closed` → `wedding_day` → `thanks` (po svatbě: odpočet a RSVP zmizí, dary se skryjí, galerie zůstane, FR-WEB-4). `archived` a `deleted` jsou uložené stavy po `thanks`.
- `phase_override` dovolí operátorovi ruční zásah (FR-LC-1); platí do zrušení a je v auditu.

Cron zapisuje do `wedding_status_history` a `audit_log` jen skutečné změny uloženého stavu a odesílá e-maily; zobrazení fáze nečeká na cron. Hranice dat: den svatby se počítá v časovém pásmu svatby.

## 8. Více stránek

MVP: jedna dlouhá stránka s kotvami = jedna řádka `pages` s `path = ''`, bloky seřazené podle `position`, kotvy z `content_blocks.anchor`. Model je připraven na více stránek bez migrace dat:

- `pages.path` určuje adresu (`/`, `/ubytovani`, `/den-2`), `position` pořadí v navigaci, `enabled` zapíná stránku. Překlad cesty stránky `[OTÁZKA]` (návrh: cesty stránek se nepřekládají, překládá se jen titulek, aby se nerozbíjely odkazy v oznámeních).
- Vícedenní a zahraniční svatby: `weddings.ends_on`, `events.starts_at` v různých dnech, program se seskupí podle dne v časovém pásmu události. Událost v jiném pásmu `[OTÁZKA]`; výchozí je jedno pásmo svatby.
- Routa webu páru počítá s volitelným segmentem cesty (`[[...page]]`), takže přechod na více stránek je změna dat a editoru, ne schématu.
- `site_versions.public_content` ukládá celý strom stránek a bloků, takže zveřejnění je atomické napříč stránkami.

## 9. Vícejazyčná pole

Doména `i18n_text` je `jsonb` s klíči jen z `{cs, en}`:

```sql
create domain i18n_text as jsonb
  check (value is null or (jsonb_typeof(value) = 'object'
         and (value - array['cs','en']) = '{}'::jsonb));
```

Hodnota vypadá `{"cs": "Obřad v zámecké kapli", "en": "Ceremony in the castle chapel"}`. Pravidla:

- Povolené jazyky svatby jsou `weddings.locales`. Pár zadává text v každém jazyce zvlášť (FR-WEB-2). Přidání třetího jazyka později je změna domény a konfigurace, ne struktury tabulek.
- Čtení vždy přes funkci `pick(text, locale, default_locale)` (SQL a TS): požadovaný jazyk, pak výchozí jazyk svatby, pak libovolný neprázdný. Prázdné místo ani klíč se nezobrazí.
- Při publikaci a v kroku „kontrola“ aplikace spočítá chybějící překlady podle `locales` a vypíše je správci; publikace nechybějící překlad nezakazuje (zadání: zobrazí se dostupný jazyk a hlásí se správci).
- Automatický překlad je volitelný a jeho výsledek se označuje: návrh `{"cs": ..., "en": ..., "_auto": ["en"]}` je nepovolený klíč v doméně, proto příznak žije vedle pole (`content_blocks.data.machine_translated: ["en"]`) `[OTÁZKA: poskytovatel a smluvní zpracování, v MVP nezařazeno]`.
- `media.alt` je `i18n_text`; `decorative = true` alt nahrazuje.
- Texty vyžadující českou typografii se normalizují při vykreslení (`typo()`, ADR 0003), nikoli při ukládání, aby se do databáze nikdy nezapsala upravená verze textu páru.

## 10. Retence

Lhůty jsou výchozí návrh, schvaluje právník (`[LHŮTY]`). Čte je cron z `app_settings`, hodnoty nejsou v kódu.

| Údaj                                                                                                      | Kdy se maže                                                               | Jak                                                                        | Upozornění a export                                                                              |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `rsvp_health` (dieta, alergie)                                                                            | 30 dní po `ends_on` (nebo `starts_on`)                                    | tvrdé `delete`, `exported_at` se eviduje                                   | před smazáním e-mail s možností exportu `[OTÁZKA: kolik dní předem; návrh stanovit s právníkem]` |
| `households`, `guests`, `invitations`, `rsvp_responses`, `rsvp_people`, `rsvp_attendance`, `rsvp_tickets` | 12 měsíců po svatbě                                                       | tvrdé `delete`, v tomto pořadí                                             | e-mail s exportem hostů, RSVP a fotografií (FR-LC-2)                                             |
| `sessions`                                                                                                | po `idle_expires_at` nebo `absolute_expires_at`                           | denní cron                                                                 |                                                                                                  |
| `login_challenges`, `rsvp_tickets`, `rate_limits`, `lockouts`                                             | po vypršení                                                               | denní cron a oportunisticky                                                |                                                                                                  |
| `email_log`                                                                                               | `[LHŮTY]` (návrh: krátká, bez osobních údajů)                             | cron                                                                       |                                                                                                  |
| `audit_log`                                                                                               | `[LHŮTY]`; neobsahuje osobní údaje, proto může být delší                  | cron, jen archivace                                                        |                                                                                                  |
| `weddings` a obsah (`pages`, `content_blocks`, `events`, `venues`, `site_versions`, `media`)              | měkké smazání → po `deleted_site_restore_days` tvrdé smazání (`purge_at`) | `purge_wedding(wedding_id)` smaže v pořadí závislostí a soubory z úložiště | obnovení v lhůtě provede operátor (FR-OPS-4)                                                     |
| `slug_registry` zveřejněného webu                                                                         | nikdy                                                                     | řádek zůstává `retired`                                                    |                                                                                                  |
| `wedding_admins`, `wedding_auth`                                                                          | s tvrdým smazáním svatby                                                  |                                                                            |                                                                                                  |
| `waitlist`                                                                                                | po odhlášení nebo `[LHŮTY]`                                               |                                                                            |                                                                                                  |

Další pravidla:

- Smazání je nevratné a zapisuje se do `audit_log` jen s počty řádků (`retention.purge`, bez osobních údajů).
- **Výmaz na žádost** hosta nebo páru: funkce `erase_guest(wedding_id, guest_id)` smaže hosta, jeho osoby, účast a zdravotní údaje a zapíše audit. Provede se v rozumné lhůtě a se záznamem.
- **Zálohy** databáze mohou smazané údaje držet do vypršení jejich retence. Délka a možnosti zálohování závisejí na tarifu Supabase `[OVĚŘIT]`; musí být uvedena v informacích o zpracování a v podkladech pro právníka.
- Cron je idempotentní: bere dávky, používá `pg_try_advisory_lock`, po chybě pokračuje při dalším běhu.

## 11. Audit

- Každý operátorský zásah zapisuje funkce `op_*` do `audit_log` **ve stejné transakci** jako zásah, takže zásah bez záznamu technicky nevznikne.
- Do auditu patří též: změny stavu, změny správců, nastavení nebo změna PINu (bez hodnot), přihlášení operátorů, nahlédnutí do údajů hostů (s důvodem), retenční mazání, prodloužení lhůt.
- `meta` smí obsahovat jen identifikátory, počty a stavy. Allowlist klíčů hlídá aplikační vrstva a test (žádné `email`, `name`, `diet`).
- Append-only: oprávnění `update`, `delete`, `truncate` odebrána všem rolím včetně service role a navíc trigger `before update or delete` vyvolá chybu.
- Správce vidí v rozhraní zásahy operátora u své svatby (politika `audit_admin_select`), což je i podklad pro informování páru o nahlédnutí.

## 12. Ověření izolace

Testy v `supabase/tests` (čisté SQL skripty se spouštěčem `npm run db:test` proti PostgreSQL 16, bez pgTAP a bez Dockeru; odchylka od původního návrhu, viz kapitola 13; ADR 0004):

1. Pro každou tabulku s `wedding_id`: správce svatby A nemůže `select`, `insert`, `update` ani `delete` řádek svatby B; vložení řádku s cizím `wedding_id` selže na politice, vložení s odkazem na cizí rodičovský řádek selže na složeném cizím klíči.
2. Role `anon` a `authenticated` bez claimu `wedding_id` nevidí nic.
3. Seznam všech `security definer` funkcí: `search_path` je prázdný, `execute` nemá `public` ani `anon`.
4. Tabulka, kde je `wedding_id`, ale RLS není zapnuté, test shodí (kontrola přes `pg_class`).
5. `rsvp_match` nevrací seznam ani rozdíl mezi „žádná shoda“ a „více shod“ ve tvaru odpovědi; `rsvp_submit` odmítne uzavřené RSVP a událost, na kterou host není pozván.
6. `audit_log` nejde změnit ani smazat.
7. Zlaté vektory normalizace jmen shodné s TypeScriptem (soubor `supabase/tests/golden/name-vectors.tsv`, strana TypeScriptu je `src/lib/rsvp/names.ts`, test `src/lib/rsvp/names.test.ts`).

Test je podmínkou brány B (izolace dat).

## 13. Odchylky implementace (M3)

Zapsáno při implementaci schématu v `supabase/migrations` (milník M3). Kde zde není uvedeno jinak, platí kapitoly 1 až 12.

**Schéma a tabulky**

- `sessions` a `operator_sessions` mají navíc sloupec `idle_seconds` (délka klouzavého okna nečinnosti), aby šlo `idle_expires_at` prodlužovat bez znalosti druhu relace. Hodnoty lhůt zadává aplikace při vytvoření relace (`auth_create_session`), v databázi nejsou pevně.
- `updated_at` mají všechny tabulky kromě `audit_log` (append-only, má `at`), `analytics_event` a `rate_limits`. Spouštěč se zakládá hromadně pro každou tabulku s tímto sloupcem.
- `unique (wedding_id, id)` mají všechny tabulky s oběma sloupci kromě `audit_log`, `email_log` a `slug_registry` (bez složených klíčů na `weddings`). Tabulky s přirozeným klíčem bez sloupce `id` (`wedding_auth`, `rsvp_settings`, `invitations`, `rsvp_attendance`, `rsvp_health`, `rsvp_tickets`, `site_version_sensitive`) mají složené cizí klíče na rodiče, ale vlastní `unique (wedding_id, id)` nemají. Test kontroluje, že každý cizí klíč mezi tenant tabulkami obsahuje `wedding_id`.
- Složené cizí klíče s volitelným odkazem používají `on delete set null (sloupec)` (PostgreSQL 15 a novější), aby se nevynuloval `wedding_id`.
- `weddings`: navíc kontrola `published` vyžaduje i `published_version_id` (nejen slug); `weddings.slug` má odložený cizí klíč na `slug_registry.slug` (`on delete set null`), takže koncept s uvolněnou rezervací dostane `slug = null` automaticky. `slug_registry` má kontrolu tvaru řádku podle stavu a jedinečnost aktuální adresy na svatbu.
- Rozšíření (`citext`, `pg_trgm`, `pgcrypto`) leží ve schématu `extensions` (jako na Supabase); `foundation` je idempotentně zajistí. Funkce `security definer` s prázdným `search_path` proto porovnávají e-maily přes `lower(email::text)`; k tomu je funkční index na `wedding_admins`.
- `media.mime` navíc odmítá `image/svg+xml` (ADR 0006: SVG od uživatelů se nepřijímá).
- `wedding_auth`: správce čte jen nehašované sloupce (sloupcové `grant select`); hashe PINů nečte nikdy, ověření PINu bude přes funkce `auth_*` (M4).
- `rsvp_settings.enabled_questions` je objekt s příznaky `plus_one`, `children`, `diet`, `lodging`, `transport`, `song`. Zdravotní údaje a doprovod `rsvp_submit` přijme jen při zapnutých příznacích `diet` a `plus_one`.
- `data_access_grants`: správce má právo `select` (vidí, komu dal přístup); zápis jde přes RPC (M7/M9).
- `app_settings` má navíc klíče `activity_touch_minutes` (5), `session_touch_minutes` (5), `rsvp_match_threshold` (0,7) a `analytics_retention_months` (24). Hodnoty `retention_notice_days_before` (14) a `deleted_site_restore_days` (30) jsou **zástupné** do rozhodnutí právníka (`[OTÁZKA]`, `[LHŮTY]`), výchozí `versions_keep` je 20.

**Schéma `se_vezmou` a přímé spojení (ADR 0011)**

- Všechny objekty (dříve `app.*` a `public.*`) jsou ve schématu `se_vezmou`; schéma `app` zaniklo. Migrace nic nevytvářejí ani nemění mimo něj (kromě rozšíření ve schématu `extensions`, `if not exists`), bez `alter default privileges` mimo `in schema se_vezmou` a bez `grant`/`revoke` na schéma `public`. Hlídá to test izolace migrací.
- `operators.auth_user_id` nemá cizí klíč na `auth.users` (cizí klíč by přidal spouštěče do cizí tabulky). Vazbu na identitu hlídá aplikace.
- Pomocné funkce čtou claimy z `request.jwt.claims` přímo (`se_vezmou.jwt_claims()`, `wedding_id()`, `wedding_role()`, `actor_id()`), ne přes `auth.jwt()` a `auth.uid()`.
- Každá funkce `security definer` výslovně odebírá `execute` pro `public` a `anon`: `alter default privileges in schema` nemůže odebrat globální výchozí `execute` pro `public` u funkcí.
- `FORCE ROW LEVEL SECURITY` se nezapíná: `security definer` funkce vlastní vlastník schématu a politiky jsou psané jen pro `authenticated`, takže by funkce přestaly číst vlastní data. Ochranu před chybně napsaným dotazem aplikace dává to, že se aplikace připojuje jako `se_vezmou_app` bez práv a tabulky čte jen přes funkce.

**Oprávnění a funkce**

- Role `service_role` má `bypassrls`, proto jí migrace odebírá i práva k tabulkám (`grant` platí i pro `bypassrls`). Přímá práva zůstala jen u `analytics_event` (insert), `email_log` (select, insert, update) a `waitlist` (select, insert, delete). Všechno ostatní jde výhradně přes funkce `security definer`. Je to přísnější než původní text kapitoly 5.1 a test to hlídá.
- `reserve_slug(wedding_id, slug)` rezervuje adresu pro již existující koncept a vrací `(ok, variants)`. Založení celé svatby v jedné transakci (kapitola 6 bod 2) bude funkce `wizard_create_draft` v M5.
- `check_slug(slug, rate_key, rate_limit, rate_window)` volitelně sám zavolá `rate_limit_hit`; při překročení vrátí `reason = 'rate_limited'` a `available = null`. Důvod `unavailable` je stejný pro zabranou, rezervovanou i zakázanou adresu.
- `resolve_slug` vrací jen svatby ve stavu `published` (stav `archived` zůstává `[OTÁZKA]`, viz OQ-23). Přibyla funkce `resolve_preview(slug, token_hash)` pro náhled konceptu.
- `rsvp_match` vrací vždy přesně jeden řádek se sloupcem `ticket`; žádná shoda, více shod, zavřené RSVP i chybná role dávají `ticket = null` (kapitola 12 bod 5 má přednost před "žádá o upřesnění" v kapitole 5.5; výzvu k upřesnění zobrazí rozhraní při každém `null`).
- `erase_guest(guest_id)` má jediný argument; svatba je vždy `se_vezmou.wedding_id()` (kapitola 5.5). Volá ji správce, ne server s service role.
- `op_view_guest_data` bez aktivního grantu nevrací řádky a zapíše `guest_data.view_denied` do auditu; akce `guest_data.*` bez důvodu odmítne i kontrola na tabulce `audit_log`.
- `audit_log`: navíc spouštěč odmítne `meta` s klíči, které vypadají jako osobní údaje (`email`, `name`, `diet`, `allergies`, `phone`, `address`, `ip`, `user_agent`), a to i vnořené. Je to obrana do hloubky vedle allowlistu v aplikaci.
- Retenční a úklidové funkce: `purge_health_data`, `purge_guest_data`, `purge_wedding`, `purge_deleted_weddings`, `purge_expired_slug_reservations`, `housekeeping`. Berou dávky a drží `pg_try_advisory_xact_lock`. Odesílání upozornění, export před smazáním a mazání souborů z úložiště (`purge_wedding` vrací cesty) zůstávaly na M10 (hotovo, kap. 17).
- `last_activity_at` se zapisuje jen při uložení správcem této svatby (úprava svatby, stránky, bloku, události, místa nebo média) a nejvýše jednou za `activity_touch_minutes`; zároveň prodlužuje rezervaci slugu konceptu.
- Retenční data `health_purge_at` a `guest_purge_at` se přepočítávají při vložení a při změně `starts_on`, `ends_on` nebo `timezone`, ale ne tehdy, když téže změnou sloupec přepisuje operátor (prodloužení lhůty).

**Testy**

- Místo pgTAP a `supabase test db` (ADR 0004, D1) jsou testy čisté SQL skripty (`supabase/tests/*.test.sql`) se spouštěčem `scripts/db-test.sh` (`npm run db:test`). Důvod: běží na samotném PostgreSQL 16 bez Dockeru, Supabase CLI a rozšíření pgTAP, lokálně i v CI přes `DATABASE_URL`. Platformu Supabase (role, `auth`, výchozí oprávnění ve `public`) nahrazuje jen testovací shim `supabase/tests/setup/00_shim.sql`, který se nenasazuje. Součástí je test izolace migrací (snímek katalogu před a po: mimo schéma `se_vezmou` se nesmí změnit nic) a test jako skutečně přihlášená role `se_vezmou_app`. ADR 0004 tím není upraven; pokud se později přejde na pgTAP, zůstanou scénáře stejné.

## 14. Odchylky implementace (M4)

Zapsáno při implementaci přihlášení (migrace `20261002130000_auth_pins_lockouts.sql` a `20261002130100_email_log_functions.sql`, kód v `src/auth`, `src/lib/db`, `src/lib/email`). Kde zde není uvedeno jinak, platí kapitoly 1 až 13.

- **Pauzy po chybách** jsou v tabulce `lockouts` (klíč je HMAC `scope + hodnota`, tedy bez slugů a IP v databázi), ne ve sloupcích `wedding_auth.*_pin_failures`, `*_pin_locked_until` a `pin_lock_level`. Důvod: stejný mechanismus platí pro svatbu, IP i neexistující adresu (pauza se chová stejně, ať web existuje, nebo ne). Sloupce v `wedding_auth` zůstávají nepoužité (rezerva, případně odstranit v pozdější migraci). `lockouts` má navíc sloupec `failures` (počet chyb v právě běžící sérii).
- **Pravidlo pauzy** (`auth_lockout_failure`): 5 chyb v sérii spustí pauzu `15 minut × 2^(úroveň − 1)`, nejvýše 24 hodin; v době pauzy se chyby nepočítají; úroveň se sama vrátí na nulu, když od konce poslední pauzy uplyne 24 hodin; úspěch (`auth_lockout_reset`) řádek smaže. Hodnoty předává aplikace (`src/auth/config.ts`), databáze je jen vykonává.
- **PIN správy je jeden na svatbu**, relace po přihlášení PINem se vede na nejstaršího aktivního správce (`auth_pin_get.admin_id`), protože `sessions.subject_id` je u správce povinné. Oznámení o přihlášení jde na záložní e-mail svatby.
- **Společný PIN pro obě role** kontroluje aplikace (`setPin`): hash je solený, takže `auth_pin_other_hash` vrací hash druhé role a nový PIN se s ním porovná přes argon2. Databáze brání jen nevalidnímu hashi (musí být `$argon2id$`) a chybějícímu záložnímu e-mailu (bez řádku `wedding_auth` se PIN nenastaví). Změna PINu odvolá relace dotčené role kromě aktuální a zapíše audit `pin.change` bez hodnoty.
- **Přihlášení kódem**: `login_challenges.email_hash` je HMAC (klíč `AUTH_SECRET`) a `code_hash` je HMAC kódu svázaný s e-mailem. Výzva vzniká i pro neznámý e-mail (stejná práce v databázi, e-mail se neposílá), takže odpověď ani čas neprozradí existenci účtu. Odkaz z e-mailu nese zapečetěný (AES-256-GCM) e-mail, kód a platnost; otevře potvrzovací stránku a přihlásí až odeslání formuláře.
- **Správce více svateb**: po ověření kódu se otevře nejstarší svatba (`auth_list_admin_weddings`); výběr svatby přijde se správou (M7).
- **`email_log`**: aplikace zapisuje jen přes funkce `email_log_insert` a `email_log_set_status` (service role má na tabulku sice přímá práva, kapitola 13, ale tenká vrstva `src/lib/db/rpc.ts` je nepoužívá). `recipient_hash` je HMAC adresy, `recipient_domain` doména; předmět ani tělo se nikdy neukládají.
- **Funkce `auth_session_context`** vrací pro zástupný přehled jen adresu, stav a jména svatby po ověření relace na serveru.

## 15. Odchylky implementace (M8)

Zapsáno při implementaci RSVP hostů, PINu hostů a správcovské strany RSVP (migrace `20261002140000_rsvp.sql`, kód v `src/lib/rsvp`, `src/auth/guest-*`, `src/components/site`). Kde zde není uvedeno jinak, platí kapitoly 1 až 14.

**Slepé porovnání jména (`rsvp_match`)**

- Trigramová podobnost (`pg_trgm`) se k porovnání **nepoužívá**: u krátkých jmen pouští jiného člověka (Jana ~ Jan, podobnost 0,82). Po přesné shodě seřazených slov (`name_key`) se toleruje překlep **po slovech** (`se_vezmou.names_close`): stejný počet slov, ve stejném pořadí nejvýš jedna úprava na slovo (dvě u slov od devíti znaků; úprava je vložení, smazání, záměna nebo prohození sousedních znaků, `se_vezmou.osa_distance`), celkem nejvýš dvě; slovo kratší než čtyři znaky se musí shodovat přesně. Jednoznačnost se posuzuje podle domácností: dvě shody v různých domácnostech dávají stejnou odpověď jako neshoda. Vstup delší než 200 znaků je neshoda. Klíč `app_settings.rsvp_match_threshold` zůstává v nastavení jako nepoužitá rezerva.
- Odpověď má vždy stejný tvar (jeden řádek, `ticket = null`) pro neshodu, více shod, zavřené RSVP i chybnou roli (kap. 12 bod 5). Aplikace navíc vrací stejný stav `not_found` při překročení limitu a při vyplněné skryté pasti.

**Zápis odpovědi (`se_vezmou.rsvp_apply`)**

- `rsvp_submit`, `rsvp_submit_unlisted` a `admin_rsvp_enter` sdílejí jeden zápis `se_vezmou.rsvp_apply(wedding, household, payload, entered_by)`. Pořadí kontrol u `rsvp_submit`: lístek, otevření RSVP, teprve potom obsah (chyby `invalid_ticket`, `rsvp_closed`, pak `invalid_payload`, `invalid_guest`, `event_not_invited`, `plus_one_not_allowed`, `children_not_allowed`, `too_many_plus_one`, `answer_required`).
- `enabled_questions.plus_one` znamená **nejvýš jednoho** doprovodu (dospělá osoba bez `guest_id`, `is_plus_one = true`). `enabled_questions.children` povoluje děti **doplněné hostem** (osoba bez `guest_id`, `is_child`, věk 0 až 17 povinný); děti ze seznamu hostů se řídí seznamem a příznak nepotřebují. Osoby odpovědi si drží pořadí z payloadu (`created_at` z `clock_timestamp()`).
- Vestavěné odpovědi v `answers`: `lodging` (`need`, `own`, `unsure`), `transport` (`need`, `own`, `offer`), `song` (text do 200 znaků); při vypnuté otázce se klíč zahodí. Vlastní otázky: `text` (do 1000 znaků), `bool` (boolean), `choice` (hodnota musí být `options[].value`; **tvar `options` je pole `{ "value": text, "label": i18n_text }`**). Povinná otázka bez odpovědi je chyba (`answer_required`), kromě ručního zápisu správcem. Otázka vázaná na událost se týká jen toho, kdo na ni v téže odpovědi přijde; jinak se odpověď zahodí a povinnost odpadne. Neznámé klíče v `answers` se nemažou (zpětná shoda s M3).
- Databáze nevynucuje úplnost odpovědí (že host odpověděl na každou pozvanou událost); vynucuje ji formulář a `parseSubmission`. Chybějící řádek v `rsvp_attendance` znamená „neodpověděl“ a přehled správce ho tak počítá.
- Zdravotní údaje: `diet` a `allergies` do 1000 znaků, jen při `enabled_questions.diet`, prázdné se neukládají.

**Host mimo seznam (FR-RSVP-7)**

- `rsvp_unlisted_form()` (události s `rsvp_enabled`, otázky, nastavení; jinak `null`) a `rsvp_submit_unlisted(payload)` jen při `allow_unlisted` a otevřeném RSVP, jinak `unlisted_not_allowed` nebo `rsvp_closed`. Odpověď má `household_id = null`, osoby bez `guest_id` a bez `is_plus_one`, nejvýš šest osob. **Každé odeslání je samostatná odpověď a nejde později upravit** (host nemá domácnost ani lístek); rozhraní to říká před odesláním i v potvrzení. Dospělých může být víc, děti jen při `children`.
- `rsvp_info()` vrací host-friendly stav bez údajů o hostech: `phase`, `open`, `allow_unlisted` (jen za otevřeného RSVP), `email_confirmation`, `closes_at`. Stránka webu páru podle něj za běhu přepisuje fázi snapshotu (`loadGuestContext`), takže uzavření RSVP platí hned, ne až s novým zveřejněním.
- `rsvp_get` (a `admin_rsvp_household`) vrací navíc `wedding.timezone` a `wedding.default_locale` (čas událostí a náhradní jazyk textů), `household_id` a `response.entered_by`.

**Správcovská strana (UI přijde v M7)**

- `admin_guest_list()` (domácnosti, hosté, pozvání, odpovědi po hostech, stav domácnosti, odpovědi hostů mimo seznam), `admin_rsvp_overview()` (domácnosti odpověděly a čekají; po událostech pozvaní, přijdou po hlavách včetně doprovodu a hostů mimo seznam, nepřijdou, `pending` = pozvaní bez odpovědi), `admin_rsvp_household(id)` (pohled pro předvyplnění, jediná funkce správcovské strany se zdravotními údaji) a `admin_rsvp_enter(household_id, payload)` (ruční zápis telefonické odpovědi). Každá vyžaduje `se_vezmou.is_wedding_admin()` (jinak `forbidden`) a filtruje podle `se_vezmou.wedding_id()`.
- Ruční zápis nezávisí na otevření RSVP (pozdní telefonát po uzavření), nevynucuje povinné otázky, neukládá e-mail, nastaví `entered_by = 'admin'`, nahradí případnou odpověď hosta a zapíše do `audit_log` akci `rsvp.manual_entry` s prázdným `meta` (jen identifikátor domácnosti).
- Typované API: `src/lib/rsvp/admin.ts` (`listGuests`, `getRsvpOverview`, `getHouseholdForEntry`, `enterResponseManually`, zod schémata v `types.ts`).

**Analytika**

- `analytics_record(event, locale, template, step)` (jen service role) zapisuje do `analytics_event`; tabulka nemá sloupec pro svatbu, osobu, IP ani odpověď (test `85_rsvp_m8`). `rsvp_completed` se zapisuje jen s jazykem, a to při první odpovědi domácnosti a při každé odpovědi hosta mimo seznam, ne při úpravě.

**Relace a cookie hosta (ADR 0002, `docs/security-privacy.md` kap. 1.3)**

- Relace hosta po PINu (`sessions.kind = 'guest_pin'`, `subject_id` null, JWT `sub` = id relace): nečinnost **6 hodin**, absolutně **2 dny** (`GUEST_SESSION` v `src/auth/config.ts`, `[OTÁZKA]` OQ-41). Cookie `__Host-sv_guest` (lokálně `sv_guest`), `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, bez `Domain`, `Max-Age` = 2 dny.
- Lístek RSVP: cookie `__Host-sv_rsvp` s týmž hostitelem a atributy, `Max-Age` 30 minut (stejně jako `rsvp_tickets.expires_at`, neprodlužuje se). Zvoleno: **lístek v cookie** pro úpravu bez opětovného zadání jména (WCAG 3.3.7), host-only a `HttpOnly`, a **zároveň** úprava slepým ověřením jména kdykoli (lístek není jediná cesta). Tlačítko „Zadat jiné jméno“ cookie smaže (sdílené zařízení). Odpověď domácnosti tedy po odeslání zůstane na zařízení čitelná nejvýš 30 minut (`[OTÁZKA]` OQ-42).
- PIN hostů: pauza podle svatby a IP (5 chyb, 15 minut, dvojnásobek každou sérii, strop 24 hodin, `lockouts` s HMAC klíčem), navíc pauza celé svatby po 50 chybách ze všech adres (úspěch kteréhokoli hosta čítače nuluje), hrubý strop 60 pokusů za hodinu na svatbu a IP. Svatba bez PINu hostů, neexistující svatba a chybný PIN stojí stejný výpočet (argon2id) a dávají totéž včetně pauzy. Selhání čítačů selže zavřeně. E-mail páru o pauze celé svatby zatím není (`[OTÁZKA]` OQ-43).
- Citlivý obsah: `SensitiveContent` má navíc `venues` (adresa, mapa a popis cesty soukromých míst podle `venue.id`). Veřejný snímek soukromého místa (`venue.isPrivate`) nesmí mít `address`, `mapUrl` ani `directions` (kontrola v `publicContentSchema`). Bez relace hosta se citlivá část z databáze vůbec nenačítá a komponenty ji nedostávají, takže není v HTML ani v RSC payloadu (e2e `guest-pin.e2e.ts`).

**Omezení počtu požadavků (ADR 0010, `RATE_RULES`)**

- `rsvpMatch` 15/hod podle svatby a IP (překročení = stejná odpověď jako neshoda), `rsvpSubmitIp` 10/hod podle svatby a IP, `rsvpSubmitWedding` 200/hod za svatbu (překročení = obecná zpráva). Selhání čítačů RSVP selže **otevřeně** (výpadek čítačů nesmí zablokovat hosty), zbývá skrytá past a omezení v databázi. Klíče jsou HMAC `RATE_LIMIT_SECRET`.

**Potvrzení e-mailem (FR-RSVP-6)**

- Odesílá se jen při `email_confirmation` a zadané adrese, po odpovědi (`after()`), šablona `rsvp-confirmation` cs/en bez zdravotních údajů; `email_log` nese jen typ `rsvp_confirmation`, jazyk, HMAC adresy a doménu. Adresa se ukládá do `rsvp_responses.contact_email` jen při zapnutém potvrzení (vynucuje databáze).

## 16. Odchylky a rozhodnutí implementace (M5, průvodce)

Migrace `20261002150000_wizard.sql`. Všechny nové funkce jsou `security definer`, mají `set search_path = ''` a právo spuštění jen pro `service_role`.

- **`weddings.wizard_draft`** (jsonb): koncept průvodce bez PINu. Pracovní tabulky (události, místa, stránky a bloky) z něj projektuje `app.wizard_apply`; průvodce je tedy jediný zapisovatel těchto řádků, dokud web nepřevezme editor (M7).
- **`wizard_create_draft`** vytvoří v jedné transakci svatbu, správce, rezervaci slugu (30 dní) a pracovní data. Při kolizi slugu nevytvoří nic a vrátí varianty (`variants`). Slug je rezervován až při prvním uložení, tedy po ověření e-mailu kódem (`login_challenges.purpose = 'wizard_create'`).
- **`wizard_save`** ukládá koncept i další změny slugu u rezervace; **`wizard_load`** koncept vrací.
- **`check_slug`** (informativní kontrola dostupnosti) má databázové omezení počtu dotazů a stejnou odpověď „nedostupné“ pro obsazený, rezervovaný i blokovaný slug. Seznam vulgarismů je v `slug_registry` (blokované tokeny od 4 znaků), `app.slug_available` je rozšířena o kontrolu tokenů.
- **`set_preview_token`** ukládá jen hash tokenu; odkaz na náhled je nehádatelný a stránka je `noindex` a `no-store`.
- **`publish_site`** přijme snapshot z `toPublicContent` (zvalidovaný `publicContentSchema`, `validateDraft` a `validatePalette` v aplikaci), vytvoří novou verzi webu a nastaví stav `published`. Zveřejněný slug se nikdy nepřidělí jinému webu. `getPublicContent` a `resolve_slug` čtou z databáze; fixtury slouží jen pro vývojový katalog a testy. Neznámý, blokovaný i nezveřejněný slug dává stejné 404.
- **`waitlist_add`** (čekací listina); události analytiky zapisuje `analytics_record` z migrace M8, průvodce zapisuje `wizard_started`, `wizard_step_completed`, `site_published` (bez osobních údajů).

## 17. Odchylky a rozhodnutí implementace (M10, životní cyklus, retence a upozornění)

Migrace `20261005120000_lifecycle_tables.sql`, `20261005120100_lifecycle_functions.sql`, `20261005120200_retention_functions.sql` a `20261005120300_lifecycle_ops_export.sql`; kód v `src/lib/cron`, `src/lib/lifecycle`, `src/lib/storage`, `src/lib/export`, `src/lib/email/templates` (`retention-notice`, `deletion-notice`) a `src/app/api/cron/*`. Kde zde není uvedeno jinak, platí kapitoly 1 až 16.

**Konec provozu a archivace (FR-LC-1)**

- Uložený stav `published` -> `archived` přepíná úloha `lifecycle` (`se_vezmou.lifecycle_archive_due`), když uplyne **konec provozu** webu: `site_online_days_after_wedding` (výchozí 90, zástupná hodnota `[OTÁZKA]`) dní po posledním dni svatby (`ends_on`, jinak `starts_on`, půlnoc v pásmu svatby, `se_vezmou.lifecycle_expires_at`). Končí-li dřív objednaný provoz (`orders.service_ends_at`), platí dřívější z obou. Svatba bez data a bez konce provozu se automaticky nearchivuje.
- Fáze (`save_the_date` až `thanks`) se nikdy nezapisují: odvozuje je `se_vezmou.phase` a stejná čistá funkce `src/lib/lifecycle/phase.ts`. Shodu hlídají zlaté vektory `supabase/tests/golden/phase-vectors.tsv` (SQL test `96_m10_lifecycle` i `phase.test.ts`).
- Ruční přepsání fáze: `op_set_phase_override(operátor, svatba, fáze | null, důvod)` s auditem `wedding.phase_override` (z jaké a na jakou fázi, důvod). Přepisuje jen odvozenou fázi, **neodkládá archivaci ani retenci**: ty řídí data a nastavení.
- Archivace zapisuje do `wedding_status_history` (aktér `system`, důvod `service_expired`) a do auditu `wedding.status_change`. `resolve_slug` archivovaný web nevrací (404 bez rozdílu), správci se do správy přihlásí dál (export a smazání).
- **Konzistence se spouštěči M3:** retenční data `health_purge_at` a `guest_purge_at` počítá spouštěč `weddings_before_write` z data svatby při vložení a při změně dat nebo pásma (ne při změně nastavení). Archivace je nepřepisuje; doplní je jen tam, kde zůstala `null` (web zveřejněný bez data svatby), a to od okamžiku archivace. Ruční prodloužení operátorem (změna `*_purge_at`) tím zůstává platné a vytvoří novou událost s novým upozorněním.

**Plánované úlohy (Vercel Cron)**

- Cesty `/api/cron/lifecycle`, `retention`, `housekeeping` a `daily` (všechny tři za sebou v pořadí retence, životní cyklus, úklid, aby se zprávy o smazání odešly týž den). `vercel.json` plánuje jen `/api/cron/daily` (jednou denně, 03:17 UTC): na tarifu Hobby je omezený počet cron úloh a nejvýše denní frekvence s hodinovou přesností, na vyšším tarifu lze naplánovat úlohy zvlášť `[OVĚŘIT]`. Cron běží jen na produkčním nasazení.
- Autorizace `Authorization: Bearer ${CRON_SECRET}` (porovnání hashů SHA-256 přes `timingSafeEqual`, tedy v konstantním čase); bez nastavené proměnné nebo se špatnou hodnotou 401 a nic se nespustí. Proxy cesty `/api/cron/*` vynechává (`src/proxy.ts`), proto je kontrola v obsluhovači. GET i POST.
- Parametry: `dry_run=1` (úloha provede práci v podtransakci a vrátí ji zpět: ohlásí přesně to, co by skutečný běh udělal, a nic nezapíše, neodešle ani nesmaže), `batch` (1 až 500), `wedding_id` (omezení na jednu svatbu). **Simulovaný čas** `now` (ISO) je povolen jen s `CRON_TEST_CLOCK=1` a vždy spolu s `wedding_id`, ne u úklidu a denního běhu; zapnutá testovací hodina při `VERCEL_ENV=production` je chyba nasazení (500, úloha neběží), stejně jako `EMAIL_TRANSPORT=outbox`.
- Zámek proti souběhu: tabulka `job_runs` (zapůjčení na 10 minut, `job_run_start` a `job_run_finish`), protože pooler v transakčním režimu nedrží zámky relace; navíc každá funkce `purge_*` drží `pg_try_advisory_xact_lock`. Výsledek běhu (stav, počty, kód chyby) jde do `job_runs` a do auditu `job.run` bez osobních údajů. Klíče počtů nesmějí vypadat jako osobní údaje (spouštěč `audit_log_guard` odmítne klíč obsahující `email`, `name`, `address` a podobně: proto `messages_sent` a v úklidu `mail_log`).
- Dávky a časový rozpočet: `maxDuration = 60` s (platí na všech tarifech), rozpočet jednoho požadavku 50 s; co se nestihne, dokončí další běh (výsledek `partial`). Strukturovaný log je jedna řádka JSON; smí nést jen název úlohy, stav, počty a kód chyby (chyby jen názvem, funkcí a kódem).
- Odpověď je 500, když úloha selže (Vercel i monitoring to uvidí; selhání jde i do Sentry s názvem úlohy a kódem), jinak 200 s počty.

**Retence a mazání (FR-OPS-5)**

- Funkce `purge_health_data`, `purge_guest_data`, `purge_wedding`, `purge_deleted_weddings`, `purge_expired_slug_reservations` a `housekeeping` mají nové parametry `p_now` (simulovaný čas, výchozí `now()`), `p_wedding_id` (omezení na svatbu) a `p_dry_run`; volání bez argumentů funguje jako dřív. Přibyla `retention_due_weddings` (weby k trvalému smazání s počtem souborů).
- Zdravotní údaje se mažou zvlášť (30 dní po svatbě), ostatní údaje hostů po 12 měsících; mazání hostů smaže i zbylé zdravotní údaje. Lhůty jsou z `app_settings`, nikoli z kódu. Do auditu jde jen `retention.purge` s druhem a počtem řádků.
- Trvalé smazání webu proběhne **nejdřív po `purge_at`** (`deleted_site_restore_days` od smazání) a jen u stavu `deleted`; obnovení v lhůtě (operátor, M9) `purge_at` zruší, takže web už nikdy nebude v seznamu ke smazání. `purge_wedding` to znovu ověřuje pod zámkem řádku.
- **Soubory dřív než řádky:** úloha `retention` pro každý web nejdřív zavolá `deletePrefix(weddingId)` (rozhraní `src/lib/storage`, předpona `{wedding_id}/`), teprve potom `purge_wedding`. Selže-li mazání souborů, web zůstane ve stavu `deleted` a další běh to zkusí znovu. `purge_deleted_weddings` je jen databázový nástroj (testy, svatby bez souborů); cron ji nevolá, protože by smazala řádky dřív než soubory. Úzké okno mezi smazáním souborů a řádků (milisekundy) při současném obnovení operátorem se nepodařilo uzavřít bez zásahu do spouštěče stavu; následek je web bez souborů, nikoli bez dat.
- Adresa zveřejněného webu zůstane v `slug_registry` jako `retired` (nepřidělí se znovu, test `97_m10_retention`); rezervace nezveřejněného konceptu se uvolní.
- `housekeeping` navíc maže analytické události po `analytics_retention_months`, `email_log` po `email_log_retention_days` (výchozí 180, `[LHŮTY]`) a běhy úloh po `job_runs_retention_days`. `audit_log` se nemaže (append-only, `[LHŮTY]`).

**Upozornění a zprávy o smazání (FR-LC-2, FR-MAIL-1)**

- Druhy událostí: `site_expiry` (konec provozu webu), `health_purge`, `guest_purge`; fáze `first` (`retention_notice_days_before`, výchozí 14, dní předem), `final` (`retention_final_notice_days_before`, výchozí 1, dní předem; je-li jeho okno už otevřené, vznikne jen ono) a `done` (zpráva o provedeném smazání). Smazaný web se před trvalým smazáním neupozorňuje (správce se nepřihlásí); po něm dostanou správci zprávu bez odkazu (adresy se čtou před smazáním, odeslání je nejlepší úsilí, adresy se nikam neukládají).
- Evidence `lifecycle_notices` (unikátní klíč svatba, druh, fáze, datum události = **jedno upozornění na událost**, i při souběhu a opakování; po prodloužení lhůty vznikne nová událost): `pending` -> `sending` -> `sent` | `skipped` | `failed`. Neúspěch se opakuje po hodině nejvýš třikrát, zaseknuté převzetí po 15 minutách; částečné doručení je `sent` (ostatní nedostanou duplicitu); upozornění před událostí, která už nastala, nebo u smazané či zablokované svatby se přeskočí. Evidence nese jen počty adresátů.
- Adresáti jsou aktivní správci svatby, jazyk e-mailu je výchozí jazyk webu. Šablony cs/en přes `src/lib/email` s `typo()`; `email_log` nese typ `expiry_notice` nebo `deletion_notice` (nový), jazyk, HMAC adresy a její doménu. Zpráva nese datum (v pásmu svatby), adresu webu a odkaz na přihlášení, nikdy údaje hostů.

**Export (FR-LC-2)**

- `admin_export_guests(p_include_health)` (volá správce, claimy `admin`): jeden řádek na osobu (host, doprovod, dítě, host mimo seznam) se sloupci pro události a otázky; audit `export.guests` s počty. Dieta a alergie jen na výslovnou žádost, jejich vydání se eviduje v `rsvp_health.exported_at`.
- `src/lib/export`: `exportGuestsAndRsvp(session, { format: "csv" | "xlsx", locale, includeHealth })`. CSV: středník, BOM UTF-8, CRLF, neutralizace vzorců (CSV injection). Excel: knihovna `write-excel-file` (jedna závislost, jen zápis, bez nativního kódu, texty vždy jako textové buňky; `exceljs` je zhruba dvacetkrát větší). Žádný veřejný odkaz na export: funkci volá jen kód s ověřenou relací správce. Rozhraní správy ji zapojí M7.
- Export fotografií je rozhraní `planPhotoExport` s `TODO(M7c)`; úložiště je za rozhraním `PhotoStorage` (`listPrefix`, `deletePrefix`), výchozí implementace nic neuchovává, pro testy `createMemoryStorage`.

**Dohled pro operátora (data pro M9, bez rozhraní)**

- `op_job_runs_summary(operátor)` (poslední běh každé úlohy, poslední úspěch, selhání za 7 dní, běží), `op_job_runs(operátor, limit, úloha)` a `op_expiring_weddings(operátor, dní, teď)` (události do `dní` a zpožděné, s evidencí upozornění a přepsáním fáze).

**Nastavení (`app_settings`, zástupné hodnoty ke schválení právníkem `[LHŮTY]`):** `site_online_days_after_wedding` 90, `retention_final_notice_days_before` 1, `email_log_retention_days` 180, `job_runs_retention_days` 90.

**Testy:** SQL `96_m10_lifecycle` a `97_m10_retention` (injektovaný čas, hranice lhůt, dry_run, idempotence, izolace svateb, audit bez osobních údajů, slug), Vitest (`src/lib/cron`, `src/lib/email/templates/retention-notice.test.ts`, `src/lib/export`, `src/lib/storage`, `src/lib/lifecycle`) a e2e `e2e/cron.e2e.ts` (autorizace, simulovaný průběh času, upozornění v outboxu, mazání po lhůtách).

## 18. Odchylky a rozhodnutí implementace (M9, provozní administrace)

Migrace `20261006120000_operators_auth.sql` a `20261006120100_operators_ops.sql`. Všechny nové funkce jsou `security definer`, mají `set search_path = ''` a právo spuštění jen pro `service_role`; operátor nemá politiky na žádné tabulce. Rozhodnutí o přihlášení bez Supabase Auth je v ADR 0012.

- **`operators`**: `auth_user_id` už nikdo nedodává (výchozí `gen_random_uuid()`, sloupec zůstává kvůli kompatibilitě). Nové sloupce `totp_secret_enc` (šifrovaný klíč TOTP, šifruje aplikace klíčem `OPERATOR_MFA_KEY`), `totp_confirmed_at`, `totp_last_step` (poslední použitý časový krok, ochrana proti přehrání) a `last_login_at`.
- **Úrovně přihlášení**: AAL1 = relace s `aal2_verified_at is null` (po kódu z e-mailu), AAL2 = druhý faktor ověřen. Relaci posouvá `auth_operator_validate_session` nejvýše jednou za minutu (nečinnost 30 minut, absolutně 8 hodin zadává aplikace).
- **Výzvy a e-maily**: `login_challenges.purpose` má nový účel `operator_login`, `email_log.type` nový typ `operator_notice`.
- **Hledání zakázek** (`op_list_weddings`): jména páru (bez diakritiky a velikosti písmen, více slov = všechna), adresa a e-maily aktivních správců; dotaz s `@` hledá jen e-mail. Údaje hostů se nehledají. Odchylka od kapitoly 4 (trigramový index na jmenech): hledání používá `normalize_name`, což se na stovkách až tisících zakázek obejde bez indexu.
- **Detail** (`op_get_wedding`) vrací agregáty (počty hostů, domácností a odpovědí) a stav souhlasu s nahlédnutím (jen konec platnosti), nikdy jména ani odpovědi hostů. Odkaz na náhled konceptu se nezobrazuje: ukládá se jen otisk tajného odkazu a operátor ho nezná (zobrazí se jen odkaz na zveřejněný web).
- **Změna stavu** (`op_set_wedding_status`): podpora smí jen zablokovat, ze smazaného stavu se vrací jen `op_restore_wedding`, zveřejnit jde jen web se zveřejněnou verzí a adresou.
- **Změna adresy** (`op_change_slug`): starý slug přejde do `retired` (zveřejněný zůstává trvale zablokovaný), nový se zapíše jako `active` u už zveřejněného webu a jako `reserved` u konceptu; kontrola jako v průvodci (`slug_available`, vč. rezervovaných slov).
- **Prodloužení** (`op_extend_retention`): `service` (`orders.service_ends_at`), `health` a `guests` (`health_purge_at`, `guest_purge_at`); lhůtu jde jen prodloužit a jen do budoucnosti, platí do konce zadaného dne v pásmu svatby.
- **Poslání přihlašovacího odkazu** (`op_send_login_link`): HMAC e-mailu a kódu počítá aplikace, databáze v téže transakci vytvoří výzvu `admin_login` a zapíše audit, e-mail jde po odpovědi. Odkaz správce nepřihlásí sám (potvrzovací stránka z M4).
- **Audit** (`op_list_audit`) čte jen majitel; `meta` zůstává jen s identifikátory, počty a stavy (hlídá spouštěč).
- **Správa operátorů**: zakázání odvolá relace, majitel nezakáže ani neobnoví faktor sám sobě, obnova faktoru zneplatní klíč, záložní kódy a relace. První majitel vzniká skriptem `npm run ops:create-owner` (vlastník databáze).
- **Neimplementováno**: oznámení správcům o nahlédnutí operátora do údajů hostů (M7, OQ-53); `op_view_guest_data` zapisuje audit s důvodem a počtem hostů.

## 19. Odchylky a rozhodnutí implementace (M7a, správa webu)

Migrace `20261006100000_admin_site.sql`, kód v `src/admin/site`, `src/components/admin` a `src/app/h/app/(sprava)`. Všechny funkce jsou `security definer` s prázdným `search_path`, právo spuštění má jen `authenticated`; každá vyžaduje `se_vezmou.is_wedding_admin()` a pracuje jen se svatbou z claimu (žádný argument s identifikátorem svatby).

**Pracovní kopie a verze**

- Pracovní kopií jsou tabulky `pages`, `content_blocks`, `events`, `venues` a sloupce `weddings`; zveřejněnou verzí je `site_versions` + `site_version_sensitive`. Hosté čtou jen zveřejněný snímek (`get_public_site`), koncept čte jen správce a rámec náhledu. Do prvního zveřejnění patří koncept průvodci (`wizard_apply`); po něm editoru. `wizard_load` hlásí stažený web jako `unpublished` a `wizard_save` pracovní kopii po zveřejnění odmítne (`wedding_not_draft`), takže ji průvodce nepřepíše.
- Nové sloupce: `venues.map_url` (jen http a https, doplněk textové adresy), `weddings.site_rev` (číslo revize pracovní kopie) a `weddings.draft_saved_at` (nezveřejněné změny = koncept je novější než zveřejněná verze).
- `admin_site_load` vrací pracovní kopii, příznaky (`has_guest_pin`, `has_unpublished_changes`) a posledních 50 verzí bez e-mailů a hashů. `admin_site_save(p_base_rev, p_work, p_touch)` ukládá celý dokument atomicky; **optimistické zamykání**: při jiné revizi vrátí `conflict` a nic nezmění (dvě okna správy se mlčky nepřepíší). Prázdné jméno páru se neukládá (zůstane poslední platné, databáze ho nepřijme) a editor zveřejnění s prázdným jménem nepustí. `p_touch = false` je jednorázové naplnění pracovní kopie ze zveřejněné verze (svatba zveřejněná mimo průvodce), nepočítá se jako nezveřejněná změna. Cizí identifikátor řádku v payloadu nic nepřepíše (`where wedding_id = excluded.wedding_id`).
- `admin_site_publish(p_public, p_sensitive, p_note)` vloží novou verzi (`kind = publish`) z konceptu i po stažení z publikace; `admin_site_unpublish` vrací `published` na `draft` (adresa zůstává `active`, verze zůstávají; web dává stejnou 404 jako neexistující); `admin_site_checkpoint` ukládá bod pro vrácení (`kind = checkpoint`; ruční, před vrácením verze a při otevření editoru, když poslední verze je starší než půl hodiny a koncept má nezveřejněné změny); `admin_site_version_get` čte obsah jedné verze (cizí verze dává `null`). Po každém vložení verze `site_versions_prune` smaže nejstarší verze nad `versions_keep` (zveřejněnou nikdy). `created_at` verzí a `draft_saved_at` jsou `clock_timestamp()`, aby pořadí „uloženo, pak zveřejněno“ platilo i v jedné transakci testu.
- **Vrácení verze** (aplikace, `restoreVersion`): nejdřív bod pro vrácení se současným stavem (návrat jde vrátit), pak snímek verze jako koncept přes `admin_site_save`; nová publikace je výslovný další krok. Pozvání hostů na události, které ve verzi nejsou, se při nahrazení pracovní kopie ruší (kaskáda); rozhraní na to upozorní před potvrzením.
- `admin_quick_notice_set(p_notice, p_enabled)`: rychlá změna platí hned (`get_public_site` čte živou hodnotu), bez nové verze; audit nese jen příznak zapnuto/vypnuto, ne text. `admin_my_weddings` vrací svatby téhož správce (stejný e-mail) pro výběr svatby; přepnutí zkontroluje, že cílová svatba je v tomto seznamu, a založí novou relaci.
- Audit (`site.published`, `site.unpublished`, `site.checkpoint`, `site.quick_notice`) nese jen číslo verze nebo příznak; test hlídá, že v něm není obsah webu.

**Dokument editoru** (`src/admin/site/doc.ts`): jeden dokument (`EditorDoc`) pro editor, ukládání, náhled i snímek. Číslo účtu u darů, adresa soukromého místa a chráněný odkaz na galerii jsou v dokumentu u bloku nebo místa a při sestavení snímku (`docToPublic`) se přesunou do `SensitiveContent`; `publicToDoc` je vrací zpět (vrácení verze). Každý druh bloku je v dokumentu nejvýš jednou, úvod je vždy první a zapnutý, kotvy jsou pevné podle druhu. Události se řadí podle okamžiku, ne podle řetězce (formulář zapisuje posun pásma svatby, databáze UTC). `PublicContent.events[].rsvpEnabled` je nepovinné (starší snímky bez něj: obřad a hostina ano, ostatní ne). Ověřeno schématem `editorDocSchema` s limity délek, kontrolou obsahu `validateDoc` (chyby brání zveřejnění, upozornění ne; včetně `validatePalette`) a schématem `publicContentSchema`.

**Odkaz na externí galerii** (`gallery.link`): nahrávání fotek zůstává mimo rozsah (OQ-47). Veřejný snímek nese `link { url, label, protected, card }`; adresa je jen `https`. Při `protected = true` není ve veřejném snímku ani adresa, ani karta (schéma to vynucuje): jsou v `SensitiveContent.gallery { url, card }` a vykreslí se až po PINu hostů. Karta (`title`, `description`, `imageUrl`, `fetchedAt`, `status`) se načítá na serveru při uložení nebo změně odkazu a na tlačítko „Obnovit náhled“, nikdy při zobrazení webu; `imageUrl` se uchovává pro pozdější zkopírování do vlastního úložiště a **web ho nevykresluje** (žádný hotlink, host nevolá cizí web). Ochrana proti SSRF a omezení viz `docs/security-privacy.md` kap. 12.

**Omezení počtu požadavků** (`RATE_RULES`): `siteSaveWedding` 1500/hod, `siteVersionWedding` 60/hod (zveřejnění, stažení, bod, vrácení), `galleryCardWedding` 20/hod.

**Testy**: `supabase/tests/87_admin_site.test.sql` (oprávnění všech rolí, izolace mezi svatbami, optimistické zamykání, zveřejnění a stažení, oříznutí historie, rychlá změna, výběr svatby, audit bez obsahu), Vitest `src/admin/site/*.test.ts`, e2e a axe `e2e/admin-site.e2e.ts` a `e2e/admin-site.a11y.ts`.

## 20. Odchylky a rozhodnutí implementace (M7c, fotografie na Cloudflare R2)

Migrace `20261008120000_media.sql`, kód v `src/lib/storage`, `src/lib/media`, `src/lib/db/media.ts`, `src/admin/site` a `src/components`. Rozhodnutí o úložišti je v `docs/adr/0006-photo-storage.md` (kapitola Implementace). Všechny funkce jsou `security definer` s prázdným `search_path`; právo spuštění má jen `authenticated`.

**Tabulky a sloupce.** `media` dostala `kind`, `status`, `failure_code`, `processing_started_at`; kontrola `media_alt_required` odpadla (viz kap. 3.3), přibyly kontroly `media_failure_code_shape` (chybné médium nese kód) a `media_card_decorative`. Nová tabulka `media_variants` (složený cizí klíč, RLS, správce jen čte). Existující řádky (fixtury) zůstávají `photo` a `ready`.

**Funkce správce** (claimy `admin`, svatba je jen z relace): `admin_media_list`, `admin_media_get`, `admin_media_request(kind, mime, bytes)` (zamkne svatbu, ověří stav webu, typ `image/jpeg|png|webp`, velikost z `app_settings.media_max_bytes` (40 MB) a kvótu `media_max_photos` (12; karta nejvýš 3); zapomenutá nahrávání starší než den označí `failed` s kódem `expired` a vrátí jejich identifikátory k úklidu souborů), `admin_media_begin` (zaseknuté zpracování starší než 2 minuty se převezme, souběh vrací `media_busy`), `admin_media_complete` (varianty s klíči přesně `{wedding_id}/{media_id}/{šířka}.{formát}`, povinně aspoň WebP), `admin_media_fail`, `admin_media_update` (popisek jen `cs` a `en`, nejvýše 300 znaků, prázdné jazyky zmizí), `admin_media_delete` (soubory maže aplikace PŘED řádkem), `admin_media_export` (největší varianta, WebP před AVIF), `admin_media_variant` (klíč pro náhled v rozhraní správy, i nezveřejněné fotografie vlastní svatby). Audit (`media.requested`, `media.processed`, `media.failed`, `media.deleted`) nese jen druh, velikost a počet variant.

**Doručení** (claimy `visitor` nebo `guest_pin`): `get_public_media(media_id, width, format)` vrací klíč varianty jen když je svatba zveřejněná a nesmazaná (po retenci je web `archived`, tedy nic = 404), médium hotové, varianta existuje a médium je ve **zveřejněném snímku** (`public_content.media`); fotografie chráněné PINem jsou jen v `site_version_sensitive.sensitive_content.photos` a vidí je jen `guest_pin`. Nezveřejněné, smazané i cizí médium vrací nic. `public_media_ids()` vrací hotová média svatby: web podle nich vyřadí ze snímku média, která pár mezitím smazal (smazání platí hned, bez nové publikace).

**Snímek webu** (`PublicContent`): `media[].widths` (šířky variant; bez nich se vykreslí jediný obrázek na `src`, starší snímky a fixtury), `galleryData.photosProtected`, `galleryCardSchema.imageMediaId` (kopie obrázku karty), `SensitiveContent.photos`. Pracovní kopie (`EditorDoc`) drží jen pořadí (`gallery.mediaIds`), soubory a popisky jsou v tabulce `media`; `reconcileGalleryMedia` sjednotí pořadí s tabulkou (smazané zmizí, nové přibudou na konec) a `docToPublic` do snímku pustí jen hotové, zveřejnitelné fotografie ze zapnutého bloku.

**Retence a export (M10).** Trvalé smazání webu volá `deletePrefix` (`{wedding_id}/` i karanténa `incoming/{wedding_id}/`) PŘED `purge_wedding`; selhání nebo nenastavené úložiště u webu s fotografiemi web neoznačí za vymazaný. `planPhotoExport` (rozhraní M10) čte výpis úložiště a vybírá největší variantu každého média; odkazy ke stažení vydává správci akce „Stáhnout všechny fotografie“.

**Omezení počtu požadavků** (`RATE_RULES`): `mediaUploadWedding` 60/hod, `mediaProcessWedding` 60/hod, `mediaEditWedding` 600/hod, `mediaExportWedding` 20/hod. Kvótu 12 fotografií a 40 MB hlídá databáze.

**Testy**: `supabase/tests/88_media.test.sql` (oprávnění, kvóta, stavy, kontrola klíčů, popisek, mazání, export, doručení a izolace svateb), matice izolace (`20_isolation`) a fixtura (`helpers.sql`) rozšířené o `media_variants`; test izolace migrací (snímek katalogu) beze změny, protože migrace nic mimo schéma `se_vezmou` nemění. Vitest: `src/lib/storage` (R2 přes falešný `fetch`, paměť, výběr úložiště), `src/lib/media` (zpracování: typ podle obsahu, pixely, EXIF a GPS pryč, otočení, sRGB, varianty bez zvětšení; služba s databází v paměti), `src/admin/site/og-image.test.ts` (SSRF u obrázku karty), `doc-media.test.ts`, `src/components/admin/upload-queue.test.ts`, `src/components/site/gallery.test.tsx`, trasa doručení `src/app/h/tenant/**/media/**/route.test.ts`. E2E a axe: `e2e/photos.e2e.ts`, `e2e/photos.a11y.ts` (úložiště v paměti).
