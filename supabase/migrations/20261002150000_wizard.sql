-- M5 / 1: průvodce (první uložení, průběžné ukládání, zveřejnění, odkaz na náhled), čekací listina,
-- analytické události a blokované výrazy v adresách.
--
-- Zdroj: docs/data-model.md kap. 5.5, 6, 13 a 15; docs/security-privacy.md; FR-WZ-1 až FR-WZ-7.
-- Všechny funkce jsou jen pro service_role: server je volá až po ověření relace správce (nebo po
-- ověření e-mailu kódem u prvního uložení) a identifikátor svatby předává výslovně, stejně jako
-- funkce auth_* z M4. Pravidla jako u ostatních funkcí: set search_path = '', plně kvalifikované
-- názvy, revoke execute from public, anon, grant jen service_role.

-- ---------------------------------------------------------------------------
-- Rozpracovaný stav průvodce (zdroj pravdy pro návrat k průvodci z jiného zařízení). Pracovní
-- tabulky (stránky, bloky, události, místa, nastavení RSVP) z něj vznikají při každém uložení
-- (app.wizard_apply), aby je četl náhled a pozdější správa (M7). Po zveřejnění se nepoužívá.
-- ---------------------------------------------------------------------------
alter table public.weddings
  add column wizard_draft jsonb
  check (wizard_draft is null or jsonb_typeof(wizard_draft) = 'object');

-- ---------------------------------------------------------------------------
-- Účel výzvy "wizard_create": kód z e-mailu při prvním uložení v průvodci (ověření e-mailu před
-- rezervací adresy). Samostatný účel, aby kód z průvodce nešel použít k přihlášení a naopak
-- (auth_verify_challenge porovnává účel).
-- ---------------------------------------------------------------------------
alter table public.login_challenges drop constraint login_challenges_purpose_check;
alter table public.login_challenges add constraint login_challenges_purpose_check
  check (purpose in ('admin_login', 'admin_add_confirm', 'operator_recovery', 'wizard_create'));

-- ---------------------------------------------------------------------------
-- Blokované výrazy v adresách (OQ-37, FR-WZ-4): vulgarismy, urážlivé a podvodné výrazy.
-- Řádek se nikdy nemaže (spouštěč slug_registry_guard). Seznam je výchozí a majitel ho rozšiřuje
-- vkládáním řádků se state = 'reserved_word'.
-- ---------------------------------------------------------------------------
insert into public.slug_registry (slug, state)
select t, 'reserved_word'
  from unnest(array[
    -- vulgarismy a urážky
    'kurva', 'kurvy', 'kurevnik', 'pica', 'picus', 'pico', 'curak', 'kokot', 'kokoti', 'debil',
    'idiot', 'hovno', 'hovna', 'sracka', 'zmrd', 'jebat', 'jebnuty', 'pizda', 'hajzl', 'buzna',
    'buzerant', 'mrdat', 'mrdka', 'couma', 'kunda', 'prdel', 'negr', 'zidak', 'cikan',
    -- nenávistné výrazy
    'nacista', 'nacismus', 'hitler', 'nazi',
    -- podobnost s cizími značkami, bankami a úřady (podvodné adresy)
    'paypal', 'google', 'facebook', 'instagram', 'seznam', 'csob', 'moneta', 'airbank',
    'raiffeisen', 'komercni', 'sporitelna', 'policie', 'banka', 'platba', 'platby', 'payment',
    'secure', 'verify', 'security', 'account', 'ucet', 'heslo', 'password', 'prihlaseni',
    'overeni', 'ceskaposta', 'financnisprava'
  ]) as t
on conflict (slug) do nothing;

-- Slug je blokovaný, pokud některý jeho díl mezi pomlčkami (alespoň čtyři znaky) je rezervované
-- slovo: "kurva-a-matej" projde jen tak, že neprojde. Kratší díly se neporovnávají, aby nevznikaly
-- falešné shody (např. "pop", "dev", "cs").
create function app.slug_has_reserved_token(p_slug text) returns boolean
  language sql stable security definer set search_path = ''
  as $$
  select exists (
    select 1
      from unnest(string_to_array(p_slug, '-')) as token
      join public.slug_registry sr on sr.slug = token and sr.state = 'reserved_word'
     where char_length(token) >= 4)
$$;

revoke all on function app.slug_has_reserved_token(text) from public, anon;

create or replace function app.slug_available(p_slug text) returns boolean
  language sql stable security definer set search_path = ''
  as $$
  select coalesce(app.slug_valid(p_slug), false)
    and not app.slug_has_reserved_token(p_slug)
    and not exists (
      select 1 from public.slug_registry sr
       where sr.slug = p_slug
         and (sr.state in ('reserved_word', 'active')
              or (sr.state = 'reserved' and sr.reserved_until > pg_catalog.now())
              or (sr.state = 'retired' and sr.first_published_at is not null)))
$$;

-- ---------------------------------------------------------------------------
-- Čekací listina (M2): idempotentní zápis. Stejný e-mail podruhé nic nezmění a vrátí false;
-- volající uživateli rozdíl nesděluje (žádné prozrazení, zda už e-mail na listině je).
-- ---------------------------------------------------------------------------
create function public.waitlist_add(p_email text, p_locale text, p_consent_text_version text)
  returns boolean
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_rows integer;
begin
  if char_length(v_email) not between 3 and 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if p_locale is not null and p_locale not in ('cs', 'en') then
    raise exception 'invalid_locale' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_consent_text_version, ''))) = 0 then
    raise exception 'consent_version_required' using errcode = '22023';
  end if;

  insert into public.waitlist (email, locale, consent_at, consent_text_version)
  values (v_email::extensions.citext, p_locale, pg_catalog.now(), btrim(p_consent_text_version))
  on conflict (email) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end
$$;

-- Analytické události zapisuje `public.analytics_record` z migrace 20261002140000_rsvp.sql
-- (uzavřený seznam událostí hlídá check na tabulce); průvodce ji jen volá jako service role.

-- ---------------------------------------------------------------------------
-- Průvodce: zápis pracovních tabulek z payloadu `p_work` (pořizuje ho server, tvar viz
-- src/wizard/content.ts, `toWorkingSet`). Volá se v transakci volající funkce.
--
--   { "wedding": { partnerA, partnerB, startsOn, endsOn, timezone, locales[], defaultLocale,
--                  template, palette, guestPinEnabled },
--     "venues":  [ { id, name, address, directions } ],
--     "events":  [ { id, kind, title, description, startsAt, endsAt, venueId, rsvpEnabled } ],
--     "blocks":  [ { id, type, anchor, enabled, position, sensitive, data } ],
--     "rsvp":    { opensAt, closesAt, allowUnlisted, emailConfirmation, questions {...} } }
--
-- Řádky se vždy hledají podle wedding_id: cizí identifikátor v payloadu nic nepřepíše (zápis se
-- přeskočí a složený cizí klíč následně selže, takže chybná data neprojdou).
-- ---------------------------------------------------------------------------
create function app.wizard_apply(p_wedding_id uuid, p_work jsonb) returns void
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  w jsonb := p_work -> 'wedding';
  v_page uuid;
  v_rsvp jsonb := coalesce(p_work -> 'rsvp', '{}'::jsonb);
begin
  if p_work is null or jsonb_typeof(p_work) <> 'object' or jsonb_typeof(w) is distinct from 'object' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  if length(p_work::text) > 200000 then
    raise exception 'payload_too_large' using errcode = '22023';
  end if;

  update public.weddings x
     set partner_a_name = btrim(w ->> 'partnerA'),
         partner_b_name = btrim(w ->> 'partnerB'),
         default_locale = w ->> 'defaultLocale',
         locales = array(select jsonb_array_elements_text(w -> 'locales')),
         template = w ->> 'template',
         palette = w ->> 'palette',
         starts_on = nullif(w ->> 'startsOn', '')::date,
         ends_on = nullif(w ->> 'endsOn', '')::date,
         timezone = coalesce(nullif(w ->> 'timezone', ''), 'Europe/Prague'),
         guest_pin_enabled = coalesce((w ->> 'guestPinEnabled')::boolean, false)
   where x.id = p_wedding_id;

  insert into public.pages (wedding_id, path, position)
  values (p_wedding_id, '', 0)
  on conflict (wedding_id, path) do nothing;
  select p.id into v_page from public.pages p where p.wedding_id = p_wedding_id and p.path = '';

  -- Místa
  delete from public.venues v
   where v.wedding_id = p_wedding_id
     and v.id not in (
       select (e ->> 'id')::uuid from jsonb_array_elements(coalesce(p_work -> 'venues', '[]'::jsonb)) e);
  insert into public.venues as v (id, wedding_id, name, address, directions, is_private)
  select (e ->> 'id')::uuid, p_wedding_id,
         coalesce(e -> 'name', '{}'::jsonb),
         coalesce(e ->> 'address', ''),
         case when jsonb_typeof(e -> 'directions') = 'object' then e -> 'directions' end,
         false
    from jsonb_array_elements(coalesce(p_work -> 'venues', '[]'::jsonb)) e
  on conflict (id) do update
     set name = excluded.name, address = excluded.address, directions = excluded.directions
   where v.wedding_id = excluded.wedding_id;

  -- Události
  delete from public.events ev
   where ev.wedding_id = p_wedding_id
     and ev.id not in (
       select (e ->> 'id')::uuid from jsonb_array_elements(coalesce(p_work -> 'events', '[]'::jsonb)) e);
  insert into public.events as ev (id, wedding_id, page_id, kind, title, description, starts_at,
                                   ends_at, venue_id, rsvp_enabled, position)
  select (e ->> 'id')::uuid, p_wedding_id, v_page, e ->> 'kind',
         coalesce(e -> 'title', '{}'::jsonb),
         case when jsonb_typeof(e -> 'description') = 'object' then e -> 'description' end,
         (e ->> 'startsAt')::timestamptz,
         nullif(e ->> 'endsAt', '')::timestamptz,
         nullif(e ->> 'venueId', '')::uuid,
         coalesce((e ->> 'rsvpEnabled')::boolean, false),
         (row_number() over (order by (e ->> 'startsAt')::timestamptz) - 1)::integer
    from jsonb_array_elements(coalesce(p_work -> 'events', '[]'::jsonb)) e
  on conflict (id) do update
     set kind = excluded.kind, title = excluded.title, description = excluded.description,
         starts_at = excluded.starts_at, ends_at = excluded.ends_at, venue_id = excluded.venue_id,
         rsvp_enabled = excluded.rsvp_enabled, position = excluded.position, page_id = excluded.page_id
   where ev.wedding_id = excluded.wedding_id;

  -- Bloky (pořadí je odložená kontrola, takže přeuspořádání v jedné transakci projde)
  delete from public.content_blocks b
   where b.wedding_id = p_wedding_id
     and b.id not in (
       select (e ->> 'id')::uuid from jsonb_array_elements(coalesce(p_work -> 'blocks', '[]'::jsonb)) e);
  insert into public.content_blocks as b (id, wedding_id, page_id, type, enabled, position, anchor,
                                          sensitive, data)
  select (e ->> 'id')::uuid, p_wedding_id, v_page, e ->> 'type',
         coalesce((e ->> 'enabled')::boolean, true), (e ->> 'position')::integer, e ->> 'anchor',
         coalesce((e ->> 'sensitive')::boolean, false), coalesce(e -> 'data', '{}'::jsonb)
    from jsonb_array_elements(coalesce(p_work -> 'blocks', '[]'::jsonb)) e
  on conflict (id) do update
     set type = excluded.type, enabled = excluded.enabled, position = excluded.position,
         anchor = excluded.anchor, sensitive = excluded.sensitive, data = excluded.data
   where b.wedding_id = excluded.wedding_id;

  -- Nastavení potvrzení účasti (zápis jen tabulky rsvp_settings; funkce rsvp_* tím nedotčeny)
  insert into public.rsvp_settings as s (wedding_id, opens_at, closes_at, allow_unlisted,
                                         email_confirmation, enabled_questions)
  values (p_wedding_id,
          nullif(v_rsvp ->> 'opensAt', '')::timestamptz,
          nullif(v_rsvp ->> 'closesAt', '')::timestamptz,
          coalesce((v_rsvp ->> 'allowUnlisted')::boolean, false),
          coalesce((v_rsvp ->> 'emailConfirmation')::boolean, false),
          case when jsonb_typeof(v_rsvp -> 'questions') = 'object' then v_rsvp -> 'questions' else '{}'::jsonb end)
  on conflict (wedding_id) do update
     set opens_at = excluded.opens_at, closes_at = excluded.closes_at,
         allow_unlisted = excluded.allow_unlisted, email_confirmation = excluded.email_confirmation,
         enabled_questions = excluded.enabled_questions;
end
$$;

revoke all on function app.wizard_apply(uuid, jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- wizard_create_draft: první uložení (kap. 6 bod 2). V jedné transakci vznikne svatba (draft),
-- správce, záložní e-mail, zakázka, domovská stránka, nastavení RSVP a rezervace adresy.
-- Při kolizi adresy se nic nezaloží (blok s výjimkou se vrátí zpět) a vrátí se nabídka variant;
-- pár o rozepsaná data nepřijde, protože je drží prohlížeč.
-- E-mail správce musí server ověřit kódem PŘED voláním (ověření e-mailu před rezervací adresy).
-- ---------------------------------------------------------------------------
create function public.wizard_create_draft(
  p_email text,
  p_backup_email text,
  p_slug text,
  p_draft jsonb,
  p_work jsonb
) returns table (ok boolean, wedding_id uuid, admin_id uuid, variants text[])
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  c_email_re constant text := '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_backup text := lower(btrim(coalesce(p_backup_email, '')));
  w jsonb := p_work -> 'wedding';
  v_id uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_starts date;
  v_until timestamptz;
begin
  if char_length(v_email) > 254 or v_email !~ c_email_re
     or char_length(v_backup) > 254 or v_backup !~ c_email_re then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if v_email = v_backup then
    -- záložní e-mail slouží jako nezávislá cesta zpět; stejná adresa by nic nezajistila
    raise exception 'backup_email_same' using errcode = '22023';
  end if;
  if p_draft is null or jsonb_typeof(p_draft) <> 'object'
     or p_work is null or jsonb_typeof(w) is distinct from 'object' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  if not app.slug_valid(p_slug) then
    raise exception 'invalid_slug' using errcode = '22023';
  end if;
  v_starts := nullif(w ->> 'startsOn', '')::date;

  -- uvolnění prošlých rezervací a nezveřejněných retired adres téhož slugu (jako reserve_slug)
  delete from public.slug_registry sr
   where sr.slug = p_slug and sr.first_published_at is null
     and ((sr.state = 'reserved' and sr.reserved_until <= pg_catalog.now()) or sr.state = 'retired');

  if not app.slug_available(p_slug) then
    return query select false, null::uuid, null::uuid, app.slug_variants(p_slug, v_starts);
    return;
  end if;

  v_until := pg_catalog.now()
    + pg_catalog.make_interval(days => app.setting_int('slug_reservation_days', 30));

  begin
    insert into public.weddings (id, partner_a_name, partner_b_name)
    values (v_id, btrim(w ->> 'partnerA'), btrim(w ->> 'partnerB'));
    -- unikátní klíč adresy rozhoduje souběh dvou párů; prohra vrátí celý blok zpět
    insert into public.slug_registry (slug, state, wedding_id, reserved_until)
    values (p_slug, 'reserved', v_id, v_until);
    update public.weddings x set slug = p_slug where x.id = v_id;

    insert into public.wedding_admins (id, wedding_id, email)
    values (v_admin, v_id, v_email::extensions.citext);
    insert into public.wedding_auth (wedding_id, backup_email)
    values (v_id, v_backup::extensions.citext);
    insert into public.orders (wedding_id) values (v_id);

    perform app.wizard_apply(v_id, p_work);
    update public.weddings x set wizard_draft = p_draft where x.id = v_id;
  exception when unique_violation then
    return query select false, null::uuid, null::uuid, app.slug_variants(p_slug, v_starts);
    return;
  end;

  insert into public.wedding_status_history (wedding_id, from_status, to_status, actor_type, actor_id)
  values (v_id, null, 'draft', 'admin', v_admin);
  perform app.write_audit('admin', v_admin, v_id, 'wedding.created', 'wedding', v_id);

  return query select true, v_id, v_admin, '{}'::text[];
end
$$;

-- ---------------------------------------------------------------------------
-- wizard_save: průběžné ukládání. Vždy uloží data; adresu mění jen když je zadaná a liší se.
-- Kolize adresy data neohrozí: vrátí slug_status = 'taken' a varianty, svatba si ponechá
-- dosavadní adresu (nebo žádnou, pokud rezervace vypršela).
-- ---------------------------------------------------------------------------
create function public.wizard_save(
  p_wedding_id uuid,
  p_slug text,
  p_draft jsonb,
  p_work jsonb
) returns table (slug text, slug_status text, variants text[], reserved_until timestamptz)
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  x public.weddings;
  v_status text := 'none';
  v_variants text[] := '{}';
  v_touch interval := pg_catalog.make_interval(mins => app.setting_int('activity_touch_minutes', 5));
  v_ok boolean;
  v_until timestamptz;
begin
  select * into x from public.weddings w where w.id = p_wedding_id for update;
  if not found or x.deleted_at is not null then
    raise exception 'wedding_not_found' using errcode = 'P0002';
  end if;
  if x.status <> 'draft' then
    raise exception 'wedding_not_draft' using errcode = '55000';
  end if;
  if p_draft is null or jsonb_typeof(p_draft) <> 'object' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;

  perform app.wizard_apply(p_wedding_id, p_work);
  update public.weddings w set wizard_draft = p_draft where w.id = p_wedding_id;

  -- aktivita prodlužuje rezervaci adresy (nejvýše jednou za activity_touch_minutes, kap. 13)
  if pg_catalog.now() - x.last_activity_at >= v_touch then
    update public.weddings w set last_activity_at = pg_catalog.now() where w.id = p_wedding_id;
  end if;

  if p_slug is not null and p_slug is distinct from x.slug then
    if not app.slug_valid(p_slug) then
      v_status := 'invalid';
    else
      select r.ok, r.variants into v_ok, v_variants from public.reserve_slug(p_wedding_id, p_slug) r;
      v_status := case when v_ok then 'ok' else 'taken' end;
    end if;
  elsif x.slug is not null and p_slug is not distinct from x.slug then
    v_status := 'ok';
  end if;

  select w.slug into slug from public.weddings w where w.id = p_wedding_id;
  select sr.reserved_until into v_until from public.slug_registry sr
   where sr.wedding_id = p_wedding_id and sr.state = 'reserved';
  slug_status := v_status;
  variants := v_variants;
  reserved_until := v_until;
  return next;
end
$$;

-- ---------------------------------------------------------------------------
-- wizard_load: rozpracovaný stav pro návrat k průvodci (jen tento tenant, volá server po relaci)
-- ---------------------------------------------------------------------------
create function public.wizard_load(p_wedding_id uuid)
  returns table (status text, slug text, reserved_until timestamptz, draft jsonb,
                 preview_enabled boolean)
  language sql stable security definer set search_path = ''
  as $$
  select w.status, w.slug,
         (select sr.reserved_until from public.slug_registry sr
           where sr.wedding_id = w.id and sr.state = 'reserved'),
         w.wizard_draft, w.preview_token_hash is not null
    from public.weddings w
   where w.id = p_wedding_id and w.deleted_at is null
$$;

-- ---------------------------------------------------------------------------
-- set_preview_token: neuhádnutelný odkaz na náhled konceptu (FR-WZ-5). Uložen jen jako hash;
-- nový token zneplatní starý. Samotný token zná jen volající (zobrazí se jednou).
-- ---------------------------------------------------------------------------
create function public.set_preview_token(
  p_wedding_id uuid,
  p_token_hash bytea,
  p_actor_admin_id uuid default null
) returns void
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  x public.weddings;
begin
  if p_token_hash is null or octet_length(p_token_hash) <> 32 then
    raise exception 'invalid_token_hash' using errcode = '22023';
  end if;
  select * into x from public.weddings w where w.id = p_wedding_id for update;
  if not found or x.deleted_at is not null then
    raise exception 'wedding_not_found' using errcode = 'P0002';
  end if;
  if x.status not in ('draft', 'pending_payment', 'published') then
    raise exception 'wedding_not_previewable' using errcode = '55000';
  end if;
  if x.slug is null then
    raise exception 'slug_required' using errcode = '55000';
  end if;
  update public.weddings w set preview_token_hash = p_token_hash where w.id = p_wedding_id;
  perform app.write_audit(case when p_actor_admin_id is null then 'system' else 'admin' end,
    p_actor_admin_id, p_wedding_id, 'preview.token_set', 'wedding', p_wedding_id);
end
$$;

-- ---------------------------------------------------------------------------
-- publish_site: zveřejnění (kap. 6 bod 4). Vloží neměnnou verzi webu (snímek sestavený
-- a ověřený aplikací podle PublicContent), citlivý obsah zvlášť, přepne stav na published.
-- Spouštěč weddings_after_write přepne adresu na active a nastaví first_published_at; od té
-- chvíle se adresa nikdy nepřidělí znovu. Zveřejnit lze jen koncept s platnou rezervací adresy.
-- ---------------------------------------------------------------------------
create function public.publish_site(
  p_wedding_id uuid,
  p_actor_admin_id uuid,
  p_public_content jsonb,
  p_sensitive jsonb default '{}'::jsonb
) returns table (version_no integer, slug text)
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  x public.weddings;
  v_version uuid;
  v_no integer;
begin
  select * into x from public.weddings w where w.id = p_wedding_id for update;
  if not found or x.deleted_at is not null then
    raise exception 'wedding_not_found' using errcode = 'P0002';
  end if;
  if x.status <> 'draft' then
    raise exception 'wedding_not_draft' using errcode = '55000';
  end if;
  if x.slug is null or not exists (
       select 1 from public.slug_registry sr
        where sr.slug = x.slug and sr.wedding_id = x.id and sr.state = 'reserved') then
    raise exception 'slug_not_reserved' using errcode = '55000';
  end if;
  if x.guest_pin_enabled and not exists (
       select 1 from public.wedding_auth wa
        where wa.wedding_id = x.id and wa.guest_pin_hash is not null) then
    raise exception 'guest_pin_missing' using errcode = '55000';
  end if;
  if p_public_content is null or jsonb_typeof(p_public_content) <> 'object'
     or p_public_content ->> 'version' is distinct from '1'
     or p_public_content ->> 'slug' is distinct from x.slug
     or jsonb_typeof(p_public_content -> 'blocks') is distinct from 'array'
     or p_sensitive is null or jsonb_typeof(p_sensitive) <> 'object' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;

  insert into public.site_versions (wedding_id, kind, public_content, created_by)
  values (x.id, 'publish', p_public_content, p_actor_admin_id)
  returning id, site_versions.version_no into v_version, v_no;

  insert into public.site_version_sensitive (version_id, wedding_id, sensitive_content)
  values (v_version, x.id, p_sensitive);

  update public.weddings w
     set status = 'published', published_version_id = v_version
   where w.id = x.id;

  insert into public.wedding_status_history (wedding_id, from_status, to_status, actor_type, actor_id)
  values (x.id, 'draft', 'published', 'admin', p_actor_admin_id);
  perform app.write_audit('admin', p_actor_admin_id, x.id, 'site.published', 'site_version', v_version,
    null, jsonb_build_object('version_no', v_no));

  return query select v_no, x.slug;
end
$$;

revoke all on function
  public.waitlist_add(text, text, text),
  public.wizard_create_draft(text, text, text, jsonb, jsonb),
  public.wizard_save(uuid, text, jsonb, jsonb),
  public.wizard_load(uuid),
  public.set_preview_token(uuid, bytea, uuid),
  public.publish_site(uuid, uuid, jsonb, jsonb)
  from public, anon;
grant execute on function
  public.waitlist_add(text, text, text),
  public.wizard_create_draft(text, text, text, jsonb, jsonb),
  public.wizard_save(uuid, text, jsonb, jsonb),
  public.wizard_load(uuid),
  public.set_preview_token(uuid, bytea, uuid),
  public.publish_site(uuid, uuid, jsonb, jsonb)
  to service_role;
