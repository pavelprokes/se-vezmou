-- M7a / 1: správa webu páru (obsah po blocích, koncept a zveřejněná verze, historie, rychlá změna).
--
-- Zdroj: docs/data-model.md kap. 3.3, 5.5, 13; docs/security-privacy.md; FR-ADM-1 až FR-ADM-3, FR-WEB-2.
-- Všechny funkce volá server s claimy role admin (role authenticated, `set local role`): každá
-- vyžaduje se_vezmou.is_wedding_admin() a pracuje výhradně se svatbou z claimu se_vezmou.wedding_id()
-- (žádný argument s identifikátorem svatby). Pravidla jako u ostatních funkcí: set search_path = '',
-- plně kvalifikované názvy, revoke execute from public, anon, grant jen authenticated.
-- Vše je ve schématu se_vezmou, žádné globální změny.

-- ---------------------------------------------------------------------------
-- Nové sloupce
--  * venues.map_url: odkaz na mapu je jen doplněk textové adresy (FR-WEB-1), jen http(s)
--  * weddings.site_rev: číslo revize pracovní kopie pro optimistické zamykání (dvě okna správy
--    nepřepíšou jedno druhé mlčky); weddings.draft_saved_at: kdy se naposledy uložil koncept
--    (nezveřejněné změny = koncept je novější než zveřejněná verze)
-- ---------------------------------------------------------------------------
alter table se_vezmou.venues
  add column map_url text
  check (map_url is null or (map_url ~ '^https?://' and char_length(map_url) <= 500));

alter table se_vezmou.weddings
  add column site_rev integer not null default 0 check (site_rev >= 0),
  add column draft_saved_at timestamptz;

-- ---------------------------------------------------------------------------
-- Interní: svatba z claimu a kontrola role správce (volají jen funkce níže)
-- ---------------------------------------------------------------------------
create function se_vezmou.admin_wedding() returns uuid
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_id uuid := se_vezmou.wedding_id();
begin
  if v_id is null or not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from se_vezmou.weddings w where w.id = v_id and w.deleted_at is null) then
    raise exception 'wedding_not_found' using errcode = 'P0002';
  end if;
  return v_id;
end
$$;

-- Počet uchovávaných verzí je `versions_keep` (výchozí 20): nejstarší verze nad limit se mažou,
-- zveřejněná verze nikdy. Volá se po každém vložení verze.
create function se_vezmou.site_versions_prune(p_wedding_id uuid) returns void
  language sql volatile security definer set search_path = ''
  as $$
  delete from se_vezmou.site_versions v
   where v.wedding_id = p_wedding_id
     and v.id is distinct from (select w.published_version_id from se_vezmou.weddings w where w.id = p_wedding_id)
     and v.version_no <= coalesce((
       select x.version_no from se_vezmou.site_versions x
        where x.wedding_id = p_wedding_id
        order by x.version_no desc
        offset greatest(se_vezmou.setting_int('versions_keep', 20), 1) limit 1), 0)
$$;

-- Společná kontrola snímku verze (zveřejnění i bod pro vrácení).
create function se_vezmou.site_snapshot_valid(p_slug text, p_public jsonb, p_sensitive jsonb)
  returns boolean
  language sql immutable set search_path = ''
  as $$
  select p_public is not null and jsonb_typeof(p_public) = 'object'
     and p_public ->> 'version' = '1'
     and p_public ->> 'slug' is not distinct from p_slug
     and jsonb_typeof(p_public -> 'blocks') = 'array'
     and p_sensitive is not null and jsonb_typeof(p_sensitive) = 'object'
     and pg_catalog.octet_length(p_public::text) <= 400000
     and pg_catalog.octet_length(p_sensitive::text) <= 100000
$$;

-- ---------------------------------------------------------------------------
-- admin_site_load: pracovní kopie webu a historie verzí pro editor
-- ---------------------------------------------------------------------------
create function se_vezmou.admin_site_load() returns jsonb
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
        'directions', v.directions, 'map_url', v.map_url) order by v.created_at, v.id), '[]'::jsonb)
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

-- ---------------------------------------------------------------------------
-- admin_site_save: průběžné ukládání pracovní kopie (blok po bloku, ale atomicky).
-- Payload (viz src/admin/site/doc.ts, `docToWork`):
--   { "wedding": { partnerA, partnerB, startsOn, endsOn, timezone, locales[], defaultLocale,
--                  template, palette },
--     "venues": [ { id, name, address, isPrivate, directions, mapUrl } ],
--     "events": [ { id, kind, title, description, startsAt, endsAt, venueId, rsvpEnabled } ],
--     "blocks": [ { id, type, anchor, enabled, position, sensitive, data } ] }
-- Optimistické zamykání: uloží jen tehdy, když p_base_rev odpovídá aktuální revizi, jinak vrátí
-- conflict = true a nic nezmění (druhé okno správy neztratí cizí změny mlčky). `p_touch = false`
-- nemění čas uložení konceptu (jednorázové naplnění pracovní kopie ze zveřejněné verze).
-- Řádky se vždy hledají podle wedding_id: cizí identifikátor v payloadu nic nepřepíše.
-- ---------------------------------------------------------------------------
create function se_vezmou.admin_site_save(p_base_rev integer, p_work jsonb, p_touch boolean default true)
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
  insert into se_vezmou.venues as v (id, wedding_id, name, address, directions, is_private, map_url)
  select (e ->> 'id')::uuid, v_id, coalesce(e -> 'name', '{}'::jsonb), coalesce(e ->> 'address', ''),
         case when jsonb_typeof(e -> 'directions') = 'object' then e -> 'directions' end,
         coalesce((e ->> 'isPrivate')::boolean, false), nullif(e ->> 'mapUrl', '')
    from jsonb_array_elements(p_work -> 'venues') e
  on conflict (id) do update
     set name = excluded.name, address = excluded.address, directions = excluded.directions,
         is_private = excluded.is_private, map_url = excluded.map_url
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

-- ---------------------------------------------------------------------------
-- admin_site_publish: zveřejnění nové verze. Snímek sestavuje a ověřuje aplikace z uložené
-- pracovní kopie (PublicContent, validatePalette); funkce hlídá stav, adresu a PIN hostů.
-- Z konceptu (po stažení z publikace) web znovu zveřejní, z published přidá novou verzi.
-- ---------------------------------------------------------------------------
create function se_vezmou.admin_site_publish(p_public jsonb, p_sensitive jsonb, p_note text default null)
  returns table (version_no integer, slug text)
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_id uuid := se_vezmou.admin_wedding();
  x se_vezmou.weddings;
  v_version uuid;
  v_no integer;
  v_actor uuid := se_vezmou.actor_id();
begin
  select * into x from se_vezmou.weddings t where t.id = v_id for update;
  if x.status not in ('draft', 'published') then
    raise exception 'wedding_not_publishable' using errcode = '55000';
  end if;
  if x.slug is null or not exists (
       select 1 from se_vezmou.slug_registry sr
        where sr.slug = x.slug and sr.wedding_id = x.id and sr.state in ('reserved', 'active')) then
    raise exception 'slug_not_reserved' using errcode = '55000';
  end if;
  if x.guest_pin_enabled and not exists (
       select 1 from se_vezmou.wedding_auth wa
        where wa.wedding_id = x.id and wa.guest_pin_hash is not null) then
    raise exception 'guest_pin_missing' using errcode = '55000';
  end if;
  if not se_vezmou.site_snapshot_valid(x.slug, p_public, p_sensitive) then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;

  insert into se_vezmou.site_versions as sv (wedding_id, kind, public_content, note, created_by, created_at)
  values (x.id, 'publish', p_public, nullif(btrim(p_note), ''), v_actor, pg_catalog.clock_timestamp())
  returning sv.id, sv.version_no into v_version, v_no;
  insert into se_vezmou.site_version_sensitive (version_id, wedding_id, sensitive_content)
  values (v_version, x.id, p_sensitive);

  update se_vezmou.weddings t
     set status = 'published', published_version_id = v_version
   where t.id = x.id;
  if x.status <> 'published' then
    insert into se_vezmou.wedding_status_history (wedding_id, from_status, to_status, actor_type, actor_id)
    values (x.id, x.status, 'published', 'admin', v_actor);
  end if;
  perform se_vezmou.site_versions_prune(x.id);
  perform se_vezmou.write_audit('admin', v_actor, x.id, 'site.published', 'site_version', v_version,
    null, jsonb_build_object('version_no', v_no));

  version_no := v_no;
  slug := x.slug;
  return next;
end
$$;

-- ---------------------------------------------------------------------------
-- admin_site_unpublish: stažení z publikace. Web přestane být vidět (stejná 404 jako
-- u neexistující adresy), adresa zůstává přidělená, zveřejněné verze zůstávají v historii.
-- ---------------------------------------------------------------------------
create function se_vezmou.admin_site_unpublish() returns void
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_id uuid := se_vezmou.admin_wedding();
  x se_vezmou.weddings;
  v_actor uuid := se_vezmou.actor_id();
begin
  select * into x from se_vezmou.weddings t where t.id = v_id for update;
  if x.status <> 'published' then
    raise exception 'wedding_not_published' using errcode = '55000';
  end if;
  update se_vezmou.weddings t set status = 'draft' where t.id = x.id;
  insert into se_vezmou.wedding_status_history (wedding_id, from_status, to_status, actor_type, actor_id)
  values (x.id, 'published', 'draft', 'admin', v_actor);
  perform se_vezmou.write_audit('admin', v_actor, x.id, 'site.unpublished', 'wedding', x.id);
end
$$;

-- ---------------------------------------------------------------------------
-- admin_site_checkpoint: bod pro vrácení (ruční, před obnovením a při otevření editoru po delší pauze)
-- ---------------------------------------------------------------------------
create function se_vezmou.admin_site_checkpoint(p_public jsonb, p_sensitive jsonb, p_note text default null)
  returns table (version_no integer)
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_id uuid := se_vezmou.admin_wedding();
  x se_vezmou.weddings;
  v_version uuid;
  v_no integer;
  v_actor uuid := se_vezmou.actor_id();
begin
  select * into x from se_vezmou.weddings t where t.id = v_id for update;
  if x.status not in ('draft', 'pending_payment', 'published') or x.slug is null then
    raise exception 'site_not_editable' using errcode = '55000';
  end if;
  if not se_vezmou.site_snapshot_valid(x.slug, p_public, p_sensitive) then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  insert into se_vezmou.site_versions as sv (wedding_id, kind, public_content, note, created_by, created_at)
  values (x.id, 'checkpoint', p_public, nullif(btrim(p_note), ''), v_actor, pg_catalog.clock_timestamp())
  returning sv.id, sv.version_no into v_version, v_no;
  insert into se_vezmou.site_version_sensitive (version_id, wedding_id, sensitive_content)
  values (v_version, x.id, p_sensitive);
  perform se_vezmou.site_versions_prune(x.id);
  perform se_vezmou.write_audit('admin', v_actor, x.id, 'site.checkpoint', 'site_version', v_version,
    null, jsonb_build_object('version_no', v_no));
  version_no := v_no;
  return next;
end
$$;

-- ---------------------------------------------------------------------------
-- admin_site_version_get: obsah jedné verze (pro obnovení a pro inicializaci pracovní kopie)
-- ---------------------------------------------------------------------------
create function se_vezmou.admin_site_version_get(p_version_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_id uuid := se_vezmou.admin_wedding();
begin
  return (
    select jsonb_build_object(
      'id', v.id, 'version_no', v.version_no, 'kind', v.kind, 'note', v.note,
      'created_at', v.created_at, 'public_content', v.public_content,
      'sensitive_content', coalesce(s.sensitive_content, '{}'::jsonb))
      from se_vezmou.site_versions v
      left join se_vezmou.site_version_sensitive s on s.version_id = v.id and s.wedding_id = v.wedding_id
     where v.id = p_version_id and v.wedding_id = v_id);
end
$$;

-- ---------------------------------------------------------------------------
-- admin_quick_notice_set: „rychlá změna“ (FR-ADM-3). Platí hned (get_public_site čte živou
-- hodnotu), bez nové publikace. Audit nese jen stav zapnuto/vypnuto, ne text.
-- ---------------------------------------------------------------------------
create function se_vezmou.admin_quick_notice_set(p_notice jsonb, p_enabled boolean) returns void
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_id uuid := se_vezmou.admin_wedding();
  x se_vezmou.weddings;
  v_filled boolean;
begin
  select * into x from se_vezmou.weddings t where t.id = v_id for update;
  if x.status not in ('draft', 'pending_payment', 'published') then
    raise exception 'site_not_editable' using errcode = '55000';
  end if;
  if p_notice is not null and (jsonb_typeof(p_notice) <> 'object'
       or (p_notice - array['cs', 'en']) <> '{}'::jsonb
       or exists (select 1 from jsonb_each(p_notice) kv
                   where jsonb_typeof(kv.value) <> 'string' or char_length(kv.value #>> '{}') > 500)) then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  v_filled := p_notice is not null and exists (
    select 1 from jsonb_each_text(p_notice) kv where btrim(kv.value) <> '');
  if coalesce(p_enabled, false) and not v_filled then
    raise exception 'notice_empty' using errcode = '22023';
  end if;

  update se_vezmou.weddings t
     set quick_notice = p_notice::se_vezmou.i18n_text,
         quick_notice_enabled = coalesce(p_enabled, false)
   where t.id = x.id;
  perform se_vezmou.write_audit('admin', se_vezmou.actor_id(), x.id, 'site.quick_notice', 'wedding', x.id,
    null, jsonb_build_object('enabled', coalesce(p_enabled, false)));
end
$$;

-- ---------------------------------------------------------------------------
-- admin_my_weddings: svatby téhož správce (stejný e-mail) pro výběr svatby. Vrací jen to,
-- co správce vidí v přehledu (adresa, stav, jména páru); cizí e-maily nikdy.
-- ---------------------------------------------------------------------------
create function se_vezmou.admin_my_weddings()
  returns table (admin_id uuid, wedding_id uuid, slug text, status text, partner_a_name text,
                 partner_b_name text, is_current boolean)
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_id uuid := se_vezmou.admin_wedding();
begin
  return query
  select a.id, w.id, w.slug, w.status, w.partner_a_name, w.partner_b_name, w.id = v_id
    from se_vezmou.wedding_admins me
    join se_vezmou.wedding_admins a
      on lower(a.email::text) = lower(me.email::text) and a.removed_at is null
    join se_vezmou.weddings w on w.id = a.wedding_id and w.deleted_at is null
   where me.id = se_vezmou.actor_id() and me.wedding_id = v_id and me.removed_at is null
   order by w.created_at, w.id;
end
$$;

-- ---------------------------------------------------------------------------
-- Průvodce po prvním zveřejnění: koncept už nepatří průvodci. wizard_load hlásí stažený web
-- jako 'unpublished' (průvodce ho neotevře) a wizard_save odmítne přepsat pracovní kopii.
-- ---------------------------------------------------------------------------
create or replace function se_vezmou.wizard_load(p_wedding_id uuid)
  returns table (status text, slug text, reserved_until timestamptz, draft jsonb,
                 preview_enabled boolean)
  language sql stable security definer set search_path = ''
  as $$
  select case when w.status = 'draft' and w.published_version_id is not null
              then 'unpublished' else w.status end,
         w.slug,
         (select sr.reserved_until from se_vezmou.slug_registry sr
           where sr.wedding_id = w.id and sr.state = 'reserved'),
         w.wizard_draft, w.preview_token_hash is not null
    from se_vezmou.weddings w
   where w.id = p_wedding_id and w.deleted_at is null
$$;

create or replace function se_vezmou.wizard_save(
  p_wedding_id uuid,
  p_slug text,
  p_draft jsonb,
  p_work jsonb
) returns table (slug text, slug_status text, variants text[], reserved_until timestamptz)
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  x se_vezmou.weddings;
  v_status text := 'none';
  v_variants text[] := '{}';
  v_touch interval := pg_catalog.make_interval(mins => se_vezmou.setting_int('activity_touch_minutes', 5));
  v_ok boolean;
  v_until timestamptz;
begin
  select * into x from se_vezmou.weddings w where w.id = p_wedding_id for update;
  if not found or x.deleted_at is not null then
    raise exception 'wedding_not_found' using errcode = 'P0002';
  end if;
  if x.status <> 'draft' or x.published_version_id is not null then
    raise exception 'wedding_not_draft' using errcode = '55000';
  end if;
  if p_draft is null or jsonb_typeof(p_draft) <> 'object' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;

  perform se_vezmou.wizard_apply(p_wedding_id, p_work);
  update se_vezmou.weddings w set wizard_draft = p_draft where w.id = p_wedding_id;

  if pg_catalog.now() - x.last_activity_at >= v_touch then
    update se_vezmou.weddings w set last_activity_at = pg_catalog.now() where w.id = p_wedding_id;
  end if;

  if p_slug is not null and p_slug is distinct from x.slug then
    if not se_vezmou.slug_valid(p_slug) then
      v_status := 'invalid';
    else
      select r.ok, r.variants into v_ok, v_variants from se_vezmou.reserve_slug(p_wedding_id, p_slug) r;
      v_status := case when v_ok then 'ok' else 'taken' end;
    end if;
  elsif x.slug is not null and p_slug is not distinct from x.slug then
    v_status := 'ok';
  end if;

  select w.slug into slug from se_vezmou.weddings w where w.id = p_wedding_id;
  select sr.reserved_until into v_until from se_vezmou.slug_registry sr
   where sr.wedding_id = p_wedding_id and sr.state = 'reserved';
  slug_status := v_status;
  variants := v_variants;
  reserved_until := v_until;
  return next;
end
$$;

-- ---------------------------------------------------------------------------
-- get_public_site: koncept (role preview) navíc nese odkaz na mapu veřejných míst.
-- ---------------------------------------------------------------------------
create or replace function se_vezmou.get_public_site() returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
  v_role text := se_vezmou.wedding_role();
  w se_vezmou.weddings;
  v_version se_vezmou.site_versions;
  v_sensitive jsonb;
begin
  if v_wedding_id is null or v_role is null or v_role not in ('visitor', 'guest_pin', 'preview', 'admin') then
    return null;
  end if;

  select * into w from se_vezmou.weddings x where x.id = v_wedding_id and x.deleted_at is null;
  if not found then
    return null;
  end if;

  if v_role = 'preview' then
    if w.status = 'blocked' then
      return null;
    end if;
    return jsonb_build_object(
      'mode', 'preview',
      'wedding', jsonb_build_object(
        'default_locale', w.default_locale, 'locales', w.locales, 'template', w.template,
        'palette', w.palette, 'partner_a_name', w.partner_a_name,
        'partner_b_name', w.partner_b_name, 'starts_on', w.starts_on, 'ends_on', w.ends_on,
        'timezone', w.timezone),
      'pages', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'path', p.path, 'title', p.title, 'position', p.position,
          'blocks', (
            select coalesce(jsonb_agg(jsonb_build_object(
              'id', b.id, 'type', b.type, 'anchor', b.anchor, 'sensitive', b.sensitive,
              'data', b.data) order by b.position), '[]'::jsonb)
              from se_vezmou.content_blocks b
             where b.wedding_id = w.id and b.page_id = p.id and b.enabled)
        ) order by p.position), '[]'::jsonb)
          from se_vezmou.pages p where p.wedding_id = w.id and p.enabled),
      'events', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', e.id, 'kind', e.kind, 'title', e.title, 'description', e.description,
          'starts_at', e.starts_at, 'ends_at', e.ends_at, 'venue_id', e.venue_id,
          'rsvp_enabled', e.rsvp_enabled) order by e.position, e.starts_at), '[]'::jsonb)
          from se_vezmou.events e where e.wedding_id = w.id),
      'venues', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', v.id, 'name', v.name, 'directions', v.directions, 'lat', v.lat, 'lng', v.lng,
          'address', case when v.is_private then null else v.address end,
          'map_url', case when v.is_private then null else v.map_url end,
          'is_private', v.is_private)), '[]'::jsonb)
          from se_vezmou.venues v where v.wedding_id = w.id)
    );
  end if;

  -- visitor, guest_pin, admin: jen zveřejněná verze
  if w.status <> 'published' or w.published_version_id is null then
    return null;
  end if;
  select * into v_version from se_vezmou.site_versions v
   where v.id = w.published_version_id and v.wedding_id = w.id;
  if not found then
    return null;
  end if;

  if v_role in ('guest_pin', 'admin') then
    select s.sensitive_content into v_sensitive from se_vezmou.site_version_sensitive s
     where s.version_id = v_version.id and s.wedding_id = w.id;
  end if;

  return jsonb_build_object(
    'mode', 'published',
    'version_no', v_version.version_no,
    'phase', se_vezmou.phase(w),
    'content', v_version.public_content,
    'sensitive', v_sensitive,
    'quick_notice', case when w.quick_notice_enabled then w.quick_notice end
  );
end
$$;

revoke all on function
  se_vezmou.admin_wedding(),
  se_vezmou.site_versions_prune(uuid),
  se_vezmou.site_snapshot_valid(text, jsonb, jsonb)
  from public, anon, authenticated, service_role;

revoke all on function
  se_vezmou.admin_site_load(),
  se_vezmou.admin_site_save(integer, jsonb, boolean),
  se_vezmou.admin_site_publish(jsonb, jsonb, text),
  se_vezmou.admin_site_unpublish(),
  se_vezmou.admin_site_checkpoint(jsonb, jsonb, text),
  se_vezmou.admin_site_version_get(uuid),
  se_vezmou.admin_quick_notice_set(jsonb, boolean),
  se_vezmou.admin_my_weddings()
  from public, anon;
grant execute on function
  se_vezmou.admin_site_load(),
  se_vezmou.admin_site_save(integer, jsonb, boolean),
  se_vezmou.admin_site_publish(jsonb, jsonb, text),
  se_vezmou.admin_site_unpublish(),
  se_vezmou.admin_site_checkpoint(jsonb, jsonb, text),
  se_vezmou.admin_site_version_get(uuid),
  se_vezmou.admin_quick_notice_set(jsonb, boolean),
  se_vezmou.admin_my_weddings()
  to authenticated;
