-- Oprava po revizi kódu: náhled konceptu podle odkazu počítá fázi s termínem potvrzení účasti. Odpověď pro roli
-- `preview` nese navíc `rsvp_closes_at` (konec potvrzování z nastavení RSVP); zbytek funkce je beze změny
-- (stejná jako v 20261006100000_admin_site.sql).

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
        'timezone', w.timezone,
        'rsvp_closes_at', (select s.closes_at from se_vezmou.rsvp_settings s where s.wedding_id = w.id)),
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
