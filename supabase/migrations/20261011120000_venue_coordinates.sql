-- Souřadnice místa konání pro statickou mapu (blok místa, `showMap`).
--
-- Sloupce `venues.lat` a `venues.lng` existují od začátku (s kontrolou rozsahu), ale pracovní kopii zapisovaly
-- jen bez nich. Průvodce (`wizard_apply`) i editor webu (`admin_site_save`, `admin_site_load`) je nově zapisují
-- a čtou; jinak by uložení nebo zveřejnění ze správy souřadnice tiše zahodilo. Souřadnice hledá aplikace z adresy
-- (Nominatim, src/site/map/server.ts); do veřejného snímku jdou jen u veřejných míst (src/site/types.ts).
-- Payload místa se rozšířil o `lat` a `lng` (čísla nebo null). Signatury se nemění, práva zůstávají.

create or replace function se_vezmou.wizard_apply(p_wedding_id uuid, p_work jsonb) returns void
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

  update se_vezmou.weddings x
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

  insert into se_vezmou.pages (wedding_id, path, position)
  values (p_wedding_id, '', 0)
  on conflict (wedding_id, path) do nothing;
  select p.id into v_page from se_vezmou.pages p where p.wedding_id = p_wedding_id and p.path = '';

  -- Místa
  delete from se_vezmou.venues v
   where v.wedding_id = p_wedding_id
     and v.id not in (
       select (e ->> 'id')::uuid from jsonb_array_elements(coalesce(p_work -> 'venues', '[]'::jsonb)) e);
  insert into se_vezmou.venues as v (id, wedding_id, name, address, directions, is_private, lat, lng)
  select (e ->> 'id')::uuid, p_wedding_id,
         coalesce(e -> 'name', '{}'::jsonb),
         coalesce(e ->> 'address', ''),
         case when jsonb_typeof(e -> 'directions') = 'object' then e -> 'directions' end,
         false,
         (e ->> 'lat')::double precision,
         (e ->> 'lng')::double precision
    from jsonb_array_elements(coalesce(p_work -> 'venues', '[]'::jsonb)) e
  on conflict (id) do update
     set name = excluded.name, address = excluded.address, directions = excluded.directions,
         lat = excluded.lat, lng = excluded.lng
   where v.wedding_id = excluded.wedding_id;

  -- Události
  delete from se_vezmou.events ev
   where ev.wedding_id = p_wedding_id
     and ev.id not in (
       select (e ->> 'id')::uuid from jsonb_array_elements(coalesce(p_work -> 'events', '[]'::jsonb)) e);
  insert into se_vezmou.events as ev (id, wedding_id, page_id, kind, title, description, starts_at,
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
  delete from se_vezmou.content_blocks b
   where b.wedding_id = p_wedding_id
     and b.id not in (
       select (e ->> 'id')::uuid from jsonb_array_elements(coalesce(p_work -> 'blocks', '[]'::jsonb)) e);
  insert into se_vezmou.content_blocks as b (id, wedding_id, page_id, type, enabled, position, anchor,
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
  insert into se_vezmou.rsvp_settings as s (wedding_id, opens_at, closes_at, allow_unlisted,
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

create or replace function se_vezmou.admin_site_load() returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_id uuid := se_vezmou.admin_wedding();
  w se_vezmou.weddings;
  v_published se_vezmou.site_versions;
begin
  select * into w from se_vezmou.weddings x where x.id = v_id;
  if w.published_version_id is not null then
    select * into v_published from se_vezmou.site_versions v
     where v.id = w.published_version_id and v.wedding_id = w.id;
  end if;

  return jsonb_build_object(
    'wedding', jsonb_build_object(
      'id', w.id, 'status', w.status, 'slug', w.slug,
      'default_locale', w.default_locale, 'locales', to_jsonb(w.locales),
      'template', w.template, 'palette', w.palette,
      'partner_a_name', w.partner_a_name, 'partner_b_name', w.partner_b_name,
      'starts_on', w.starts_on, 'ends_on', w.ends_on, 'timezone', w.timezone,
      'quick_notice', w.quick_notice, 'quick_notice_enabled', w.quick_notice_enabled,
      'guest_pin_enabled', w.guest_pin_enabled,
      'has_guest_pin', exists (select 1 from se_vezmou.wedding_auth a
                                where a.wedding_id = w.id and a.guest_pin_hash is not null),
      'site_rev', w.site_rev, 'draft_saved_at', w.draft_saved_at,
      'published_at', w.published_at,
      'published_version_no', v_published.version_no,
      'published_version_at', v_published.created_at,
      'has_unpublished_changes', w.draft_saved_at is not null
        and (v_published.id is null or w.draft_saved_at > v_published.created_at)),
    'venues', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', v.id, 'name', v.name, 'address', v.address, 'is_private', v.is_private,
        'directions', v.directions, 'map_url', v.map_url, 'lat', v.lat, 'lng', v.lng)
        order by v.created_at, v.id), '[]'::jsonb)
        from se_vezmou.venues v where v.wedding_id = w.id),
    'events', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'kind', e.kind, 'title', e.title, 'description', e.description,
        'starts_at', e.starts_at, 'ends_at', e.ends_at, 'venue_id', e.venue_id,
        'rsvp_enabled', e.rsvp_enabled) order by e.starts_at, e.position, e.id), '[]'::jsonb)
        from se_vezmou.events e where e.wedding_id = w.id),
    'blocks', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', b.id, 'type', b.type, 'anchor', b.anchor, 'enabled', b.enabled,
        'position', b.position, 'sensitive', b.sensitive, 'data', b.data) order by b.position, b.id),
        '[]'::jsonb)
        from se_vezmou.content_blocks b where b.wedding_id = w.id),
    'versions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'version_no', x.version_no, 'kind', x.kind, 'note', x.note,
        'created_at', x.created_at, 'is_published', x.id = w.published_version_id,
        'by_me', x.created_by is not null and x.created_by = se_vezmou.actor_id())
        order by x.version_no desc), '[]'::jsonb)
        from (select * from se_vezmou.site_versions v where v.wedding_id = w.id
               order by v.version_no desc limit 50) x)
  );
end
$$;

create or replace function se_vezmou.admin_site_save(p_base_rev integer, p_work jsonb, p_touch boolean default true)
  returns table (ok boolean, conflict boolean, rev integer)
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_id uuid := se_vezmou.admin_wedding();
  x se_vezmou.weddings;
  w jsonb := p_work -> 'wedding';
  v_page uuid;
  v_actor uuid := se_vezmou.actor_id();
begin
  select * into x from se_vezmou.weddings t where t.id = v_id for update;
  if x.status not in ('draft', 'pending_payment', 'published')
     or (x.status <> 'published' and x.published_version_id is null) then
    -- koncept průvodce (bez zveřejnění) patří průvodci, zablokovaný a archivovaný web se needituje
    raise exception 'site_not_editable' using errcode = '55000';
  end if;
  if p_work is null or jsonb_typeof(p_work) <> 'object' or jsonb_typeof(w) is distinct from 'object'
     or jsonb_typeof(p_work -> 'venues') is distinct from 'array'
     or jsonb_typeof(p_work -> 'events') is distinct from 'array'
     or jsonb_typeof(p_work -> 'blocks') is distinct from 'array' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  if pg_catalog.octet_length(p_work::text) > 400000 then
    raise exception 'payload_too_large' using errcode = '22023';
  end if;

  if p_base_rev is distinct from x.site_rev then
    return query select false, true, x.site_rev;
    return;
  end if;

  update se_vezmou.weddings t
     -- prázdné jméno se neukládá (databáze ho nepřijme); zůstane poslední platné a aplikace
     -- zveřejnění s prázdným jménem v editoru nepustí
     set partner_a_name = coalesce(nullif(btrim(w ->> 'partnerA'), ''), t.partner_a_name),
         partner_b_name = coalesce(nullif(btrim(w ->> 'partnerB'), ''), t.partner_b_name),
         default_locale = w ->> 'defaultLocale',
         locales = array(select jsonb_array_elements_text(w -> 'locales')),
         template = w ->> 'template',
         palette = w ->> 'palette',
         starts_on = nullif(w ->> 'startsOn', '')::date,
         ends_on = nullif(w ->> 'endsOn', '')::date,
         timezone = coalesce(nullif(w ->> 'timezone', ''), 'Europe/Prague'),
         site_rev = t.site_rev + 1,
         -- p_touch = false: naplnění pracovní kopie ze zveřejněné verze není nezveřejněná změna
         draft_saved_at = case when coalesce(p_touch, true)
                               then pg_catalog.clock_timestamp() else t.draft_saved_at end
   where t.id = v_id
  returning t.site_rev into rev;

  insert into se_vezmou.pages (wedding_id, path, position)
  values (v_id, '', 0)
  on conflict (wedding_id, path) do nothing;
  select p.id into v_page from se_vezmou.pages p where p.wedding_id = v_id and p.path = '';

  -- události (odebraná událost odnese pozvání hostů, kaskádou)
  delete from se_vezmou.events ev
   where ev.wedding_id = v_id
     and ev.id not in (select (e ->> 'id')::uuid from jsonb_array_elements(p_work -> 'events') e);

  -- místa
  insert into se_vezmou.venues as v (id, wedding_id, name, address, directions, is_private, map_url,
                                  lat, lng)
  select (e ->> 'id')::uuid, v_id, coalesce(e -> 'name', '{}'::jsonb), coalesce(e ->> 'address', ''),
         case when jsonb_typeof(e -> 'directions') = 'object' then e -> 'directions' end,
         coalesce((e ->> 'isPrivate')::boolean, false), nullif(e ->> 'mapUrl', ''),
         (e ->> 'lat')::double precision, (e ->> 'lng')::double precision
    from jsonb_array_elements(p_work -> 'venues') e
  on conflict (id) do update
     set name = excluded.name, address = excluded.address, directions = excluded.directions,
         is_private = excluded.is_private, map_url = excluded.map_url,
         lat = excluded.lat, lng = excluded.lng
   where v.wedding_id = excluded.wedding_id;

  insert into se_vezmou.events as ev (id, wedding_id, page_id, kind, title, description, starts_at,
                                   ends_at, venue_id, rsvp_enabled, position)
  select (e ->> 'id')::uuid, v_id, v_page, e ->> 'kind', coalesce(e -> 'title', '{}'::jsonb),
         case when jsonb_typeof(e -> 'description') = 'object' then e -> 'description' end,
         (e ->> 'startsAt')::timestamptz, nullif(e ->> 'endsAt', '')::timestamptz,
         nullif(e ->> 'venueId', '')::uuid, coalesce((e ->> 'rsvpEnabled')::boolean, false),
         (row_number() over (order by (e ->> 'startsAt')::timestamptz) - 1)::integer
    from jsonb_array_elements(p_work -> 'events') e
  on conflict (id) do update
     set kind = excluded.kind, title = excluded.title, description = excluded.description,
         starts_at = excluded.starts_at, ends_at = excluded.ends_at, venue_id = excluded.venue_id,
         rsvp_enabled = excluded.rsvp_enabled, position = excluded.position, page_id = excluded.page_id
   where ev.wedding_id = excluded.wedding_id;

  delete from se_vezmou.venues v
   where v.wedding_id = v_id
     and v.id not in (select (e ->> 'id')::uuid from jsonb_array_elements(p_work -> 'venues') e);

  -- bloky (pořadí a kotva se kontrolují až při commitu, přeuspořádání v jedné transakci projde)
  delete from se_vezmou.content_blocks b
   where b.wedding_id = v_id
     and b.id not in (select (e ->> 'id')::uuid from jsonb_array_elements(p_work -> 'blocks') e);
  insert into se_vezmou.content_blocks as b (id, wedding_id, page_id, type, enabled, position, anchor,
                                          sensitive, data, updated_by)
  select (e ->> 'id')::uuid, v_id, v_page, e ->> 'type', coalesce((e ->> 'enabled')::boolean, true),
         (e ->> 'position')::integer, e ->> 'anchor', coalesce((e ->> 'sensitive')::boolean, false),
         coalesce(e -> 'data', '{}'::jsonb), v_actor
    from jsonb_array_elements(p_work -> 'blocks') e
  on conflict (id) do update
     set type = excluded.type, enabled = excluded.enabled, position = excluded.position,
         anchor = excluded.anchor, sensitive = excluded.sensitive, data = excluded.data,
         updated_by = excluded.updated_by
   where b.wedding_id = excluded.wedding_id;

  ok := true;
  conflict := false;
  return next;
end
$$;
