# Audit stavu repa (část A zadání „úkoly a TODO“)

Stav k 4. 10. 2026, `main` = `32a5ddc` (první verze auditu 3. 10. nad `092efad`, pak doplněno o PR #55 až #64). Zmapováno čtením kódu a docs. ✅ je, 🟡 částečně, ❌ není.

## A1. Hosté a RSVP

- ✅ **Model hostů a domácností.** `households`, `guests` (display_name, is_child, age, is_plus_one, source, locale), `invitations` (host × akce): `supabase/migrations/20261002120300_tables_guests_rsvp.sql`. Host nemá e-mail ani telefon, jen volitelný `rsvp_responses.contact_email`.
- ✅ **RSVP pole.** Jídlo, diety, alergie, doprovod, děti, písnička, ubytování, doprava: `src/components/site/rsvp/rsvp-form.tsx`, `src/lib/rsvp/form.ts`. Pár zapíná jednotlivé otázky (`enabled_questions`). Diety a alergie jsou zvlášť v `rsvp_health` (zdravotní údaje).
- ✅ **Vlastní otázky.** `rsvp_questions` (text, výběr, ano/ne, lokalizovaný popisek, volitelně vázané na akci), max 10: `src/components/admin/guests/rsvp-settings.tsx`.
- ✅ **Více akcí.** `events` (obřad, hostina, jiné), `rsvp_attendance`; `invitations` určují, ke kterým akcím je host pozván.
- ❌ **Skupiny a štítky hostů.** Jen volný text `households.label`, viditelný jen adminovi.
- 🟡 **Program podle skupiny.** Skupiny nejsou, ale pozvánky po hostech (`invited_event_ids`) dávají program na míru jednotlivci.
- ❌ **Unikátní odkaz nebo QR hosta.** Host se najde zadáním jména, krátké `rsvp_tickets`. QR je jen na adresu webu (`src/components/wizard/done.tsx`) a platební.
- 🟡 **Jazyk hosta.** `guests.locale` (cs/en), plní import (`src/admin/guests/import-parse.ts`), používá e-mail s potvrzením. Bez osobního odkazu se jinde neuplatní.
- ✅ **Upozornění páru na novou odpověď.** Volitelné (`notify_couple`, migrace `20261013120000_rsvp_notify_couple.sql`), e-mail `src/lib/email/templates/rsvp-notice.ts` jen se jmény a účastí, bez diet a kontaktů; odesílá `src/lib/rsvp/service.ts`.
- ✅ **Export hostů.** CSV i xlsx: `src/app/h/app/(sprava)/hoste/export/route.ts`, `src/lib/export/*`. Rate limit, audit, diety jen na výslovnou žádost.

## A2. Pozvánky a plánovací nástroje

- 🟡 **Online pozvánky.** Veřejný web, odkaz a QR na obrazovce „Hotovo“, tisknutelné PDF oznámení s QR a PINem (`src/wizard/pdf/announcement.ts`), PIN brána (`src/components/site/pin-gate.tsx`). Doručení e-mailem není.
- ✅ **Sdílení přes WhatsApp, SMS, e-mail.** `src/components/share-links.tsx` (obrazovka „Hotovo“ průvodce a přehled ve správě).
- ❌ **Zasedací pořádek.**
- ❌ **Rozpočet a checklist.**
- ✅ **Dva přístupy.** `wedding_admins` (`max_admins` = 3), přihlášení kódem e-mailem nebo PINem: `src/admin/access/`.

## A3. Obsah webu páru

Společný model bloků v `src/site/types.ts` (`blockTypes`). Editorial, Chateau a Modern jsou jedna kostra `src/components/site/templates/classic.tsx` + `site.css` (Chateau přidává monogram), Eukalyptus má vlastní `templates/eukalyptus/blocks.tsx`.

| Blok      | Datové vstupy                                                                       |
| --------- | ----------------------------------------------------------------------------------- |
| hero      | countdown, tagline, photoMediaId; jména, datum, fáze, první místo                   |
| program   | intro; události (druh, název, popis, od–do, místo)                                  |
| venue     | venueIds, intro, showMap; místa (název, adresa, isPrivate, pokyny, mapUrl, lat/lng) |
| lodging   | items (název, popis, url), transport (volný text)                                   |
| dresscode | text                                                                                |
| faq       | items (otázka, odpověď)                                                             |
| contact   | people (jméno, role, e-mail, telefon)                                               |
| story     | text, mediaId                                                                       |
| gifts     | intro; citlivé: account, iban, holder, paymentMessage                               |
| gallery   | mediaIds, photosProtected, link (url, popisek, chráněný, karta)                     |
| rsvp      | intro, stav RSVP                                                                    |

Každý blok má `anchor`, `enabled`, `position`, `sensitive`. Společné prvky: přepínač jazyka, rychlé upozornění, ukotvené RSVP tlačítko, PIN brána, patička.

- ✅ **Mapa.** Statická OSM přes vlastní `/api/map-tile`, geokódování Nominatim, odkazy na Google a Mapy.cz; soukromá místa se nemapují: `src/components/site/venue-map.tsx`, `src/site/map/`. Ubytování s adresou může být na mapě místa konání (#56), špendlíky a legenda podle šablony (#57).
- ✅ **Ubytování, doprava, dress code, FAQ, časová osa dne.** Doprava je volný text v bloku lodging, ne samostatný blok. Časová osa: `programDays()` v `src/components/site/models.ts`.
- ✅ **Sekce Fotky.** Mozaika a lightbox, volitelně za PINem.
- 🟡 **Odkaz na galerii.** `gallery.link` přijme libovolné https URL (karta z Open Graph). Doména `photos.svatebni-fotograf-cechy.cz` v kódu napevno není, pár ji vkládá ručně.
- ✅ **QR galerie vedle pozvánky.** Druhý QR kód v PDF oznámení, jen pro zapnutý blok s veřejným odkazem (`galleryUrl` v `src/wizard/pdf/announcement.ts`).
- ✅ **Svatební dar.** Číslo účtu a držitel jako text, QR SPAYD `SPD*1.0*ACC:<IBAN>*CC:CZK[*MSG:…]` bez částky, zpráva bez diakritiky max 60 znaků, validace IBAN (mod 97): `src/site/payment.ts`, `blocks/gifts.tsx`. Za PINem.
- ✅ **IBAN a BIC jako text.** Převod ze zahraničí s příjemcem, IBAN, BIC a zprávou, každé s tlačítkem „Kopírovat“: `src/components/site/blocks/foreign-payment.tsx`, `copy-button.tsx`, validace v `src/site/payment.ts`.
- 🟡 **Heslo na web.** Celý web heslo nemá. PIN odemyká jen citlivé části (dar, soukromá místa, chráněné fotky). Náhled konceptu `/nahled/[token]`.
- ✅ **Banner „změna termínu“.** `quickNotice` s předvyplněným textem „Změna termínu“ ve všech jazycích webu podle data svatby: `src/admin/site/date-change-notice.ts`, `src/components/admin/quick-notice.tsx`.

## A4. Jazyky

- ✅ **Překlady.** Vlastní tenká vrstva, ne next-intl (ADR 0003): `src/i18n/*`, texty UI v `src/i18n/messages/{cs,en}/<namespace>.json`; `npm run i18n:check` hlídá klíče, placeholdery a typografii.
- ✅ **Texty páru.** Po jazycích jako `jsonb {cs,en}` (`src/site/i18n-text.ts`). Fallback `pick()`: požadovaný jazyk, výchozí jazyk svatby, cokoli neprázdného. `missingLocales()` varuje při publikaci. Jména, telefony a e-maily jsou obyčejné řetězce.
- ✅ **Routing a hreflang.** cs bez prefixu, `/en`; web páru jazyk nenegociuje, rozhoduje URL; `alternates.languages` přes `languageAlternates()`. Web páru je `noindex`, marketing má hreflang a sitemap. Blog (#50) má vlastní namespace `blog` a dvojjazyčné články v `content/blog/`.
- 🟡 **E-maily.** Všechny šablony v `src/lib/email/templates/` mají `COPY[locale]` (kód přihlášení, RSVP potvrzení, retence, oznámení adminům). Oznámení adminům je napevno jen cs/en. Operátorské e-maily jsou jen česky.
- ❌ **AI překlad textů páru.** Není (data-model: „volitelné, mimo MVP“), `machine_translated` neimplementováno. Pár překládá ručně.

## A5. Technika a životní cyklus

- ✅ **Subdomény.** `src/proxy.ts` → `src/host/route.ts` a `resolve.ts`; validace slugu a rezervované slugy; proxy nesahá do DB (ADR 0002). 🟡 Wildcard `*.se-vezmou.cz` na Vercelu je popsaný v `docs/technical-design.md`, certifikát označen `[OVĚŘIT]`.
- ❌ **Vlastní domény párů.** Jen zmínka „později, placené“. Bylo by potřeba:
  - tabulka `wedding_domains` a integrace Vercel Domains API s ověřením (TXT/NS),
  - vyhledání hostitele → svatba mimo proxy (např. rewrite na `/h/custom/<host>`),
  - úprava `resolveHost`, CSP a kontroly Origin u Server Actions,
  - canonical a sitemap, přesměrování ze subdomény, smazání domény při purge.
- ✅ **Datum svatby.** `weddings.starts_on`, `ends_on`, `timezone`; `rsvp_settings.opens_at`, `closes_at`.
- ✅ **Fáze.** Odvozují se (`src/lib/lifecycle/phase.ts`): save_the_date, rsvp_open, rsvp_closed, wedding_day, thanks; `phaseOverride` ručně. RSVP se zavírá odvozením z `closes_at`, ne cronem.
- ✅ **Cron.** `/api/cron/daily` v 03:17 UTC (`vercel.json`): retence, lifecycle, úklid. `/api/cron/blog` v 00:01 pražského času zveřejní naplánované články blogu (#63, #64). Idempotentní, `CRON_SECRET`, záznam do `job_runs`.
  - Diety a alergie se mažou **30 dní** po svatbě, bez ohledu na export páru.
  - Hosté a RSVP **12 měsíců** po svatbě.
  - Web `published` → `archived` po **90 dnech** po svatbě (`site_online_days_after_wedding`), pak `deleted` 90 dní po smazání hostů a purge po 30 dnech odkladu (obnova operátorem).
  - Upozornění adminům 14 dní a 1 den předem.
  - Všechny lhůty čekají na právní schválení (`docs/security-privacy.md` §5.3, §11).
- ⚠ **Rozpor s návrhem v zadání.** Návrh chce web 12 měsíců po svatbě, osobní údaje po 90 dnech a před smazáním e-mail s CSV exportem. Kód má web 90 dní, hosty 12 měsíců, diety 30 dní a export e-mailem neposílá. Archiv jen pro čtení po 12 měsících v kódu není.
- ✅ **Osobní údaje hostů.** Postgres, schéma `se_vezmou` (tabulky v A1); fotky v R2 pod `{wedding_id}/`.
- ✅ **Animace.** Žádná knihovna (ani framer-motion). Jen CSS: `site-rise`, lišta a hover v Eukalyptu; přechody mezi stránkami úvodního webu přes `@view-transition` (`src/app/h/marketing/[locale]/transitions.css`). Ilustrace hera s `art-draw`/`art-float` nahrazena živým náhledem (#61). Globální `prefers-reduced-motion` v `src/app/globals.css`.

## Souhrn pro část B

- **Už stojí:** RSVP (jídlo, diety, doprovod, děti, písnička), více akcí, vlastní otázky, export hostů, dva přístupy, jazyková infrastruktura cs/en, logistické bloky, Fotky, dar s QR SPAYD, PIN; od 3. 10. navíc upozornění páru na odpověď, sdílení pozvánky, QR galerie v PDF, IBAN a BIC s „Kopírovat“, banner změny termínu, přechody mezi stránkami úvodního webu, ubytování na mapě.
- **Částečné:** program podle skupiny, jazyk hosta, online pozvánka, odkaz na galerii, heslo, e-maily ve dvou jazycích, politika po svatbě.
- **Chybí:** štítky a skupiny, osobní odkaz a QR hosta, tlačítko „přeložit“, zasedací pořádek, rozpočet, vlastní domény.
