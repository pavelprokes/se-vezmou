-- M9 / 2: provozní administrace: čtení (seznam zakázek, detail, přehled, analytika, retence, audit),
-- zásahy (stav, adresa, prodloužení, obnova, přihlašovací odkaz, poznámka) a správa operátorů.
--
-- Pravidla jako u celé operátorské cesty (functions_ops.sql): funkce volá server (service_role) PO ověření relace
-- operátora a jeho druhého faktoru, každá si znovu ověří `operators.role` a `disabled_at` a každý zásah zapíše
-- `audit_log` v téže transakci (zásah bez záznamu technicky nevznikne). Žádná funkce nevrací jména ani údaje hostů;
-- k nim vede jedině `op_view_guest_data` s aktivním souhlasem páru.
--
-- Matice rolí (support = podpora, owner = majitel):
--   čtení (seznam, detail, přehled, analytika, retence) ......... owner, support
--   poznámka, přihlašovací odkaz správci, nahlédnutí se souhlasem  owner, support
--   zablokování webu (stav -> blocked) ........................... owner, support
--   ostatní změny stavu, změna adresy, prodloužení, obnova ....... owner
--   audit log, správa operátorů, nastavení ....................... owner

-- ---------------------------------------------------------------------------
-- op_set_wedding_status: změna uloženého stavu (nahrazuje verzi z M3)
-- Podpora smí jen zablokovat (hlášení zneužití je naléhavé); odblokovat, smazat nebo zveřejnit smí majitel.
-- Ze stavu deleted se vrací jen přes op_restore_wedding. Zveřejnit lze jen web, který už má zveřejněnou verzi.
-- ---------------------------------------------------------------------------
create or replace function se_vezmou.op_set_wedding_status(
  p_operator_id uuid,
  p_wedding_id uuid,
  p_status text,
  p_reason text
) returns void
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_role text;
  v_old text;
  v_slug text;
  v_version uuid;
begin
  v_role := se_vezmou.assert_operator(p_operator_id, array['owner', 'support']);
  if p_status not in ('draft', 'pending_payment', 'published', 'archived', 'deleted', 'blocked') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if v_role = 'support' and p_status <> 'blocked' then
    raise exception 'operator_forbidden' using errcode = '42501';
  end if;

  select w.status, w.slug, w.published_version_id into v_old, v_slug, v_version
    from se_vezmou.weddings w where w.id = p_wedding_id for update;
  if not found then
    raise exception 'wedding_not_found' using errcode = 'P0002';
  end if;
  if v_old = p_status then
    return;
  end if;
  if v_old = 'deleted' then
    raise exception 'use_restore' using errcode = '55000';
  end if;
  if p_status = 'published' and (v_slug is null or v_version is null) then
    raise exception 'cannot_publish' using errcode = '55000';
  end if;

  update se_vezmou.weddings w set status = p_status where w.id = p_wedding_id;
  insert into se_vezmou.wedding_status_history (wedding_id, from_status, to_status, actor_type, actor_id, reason)
  values (p_wedding_id, v_old, p_status, 'operator', p_operator_id, p_reason);
  perform se_vezmou.write_audit('operator', p_operator_id, p_wedding_id, 'wedding.status_change',
    'wedding', p_wedding_id, p_reason, jsonb_build_object('from_status', v_old, 'to_status', p_status));
end
$$;

-- ---------------------------------------------------------------------------
-- op_list_weddings: seznam zakázek s filtry a hledáním (FR-OPS-1, FR-OPS-2)
-- Hledá jen ve jménech páru, adrese a e-mailech správců; nikdy ne v údajích hostů.
-- Více slov = všechna musí sedět (bez diakritiky a velikosti písmen); dotaz s @ hledá e-mail správce.
-- ---------------------------------------------------------------------------
create function se_vezmou.op_list_weddings(
  p_operator_id uuid,
  p_status text default null,
  p_locale text default null,
  p_template text default null,
  p_month date default null,
  p_query text default null,
  p_limit integer default 25,
  p_offset integer default 0
) returns table (
  id uuid, slug text, status text, partner_a_name text, partner_b_name text, template text,
  default_locale text, locales text[], starts_on date, published_at timestamptz,
  last_activity_at timestamptz, created_at timestamptz, admin_count integer, total_count bigint
)
  language plpgsql stable security definer set search_path = ''
  as $$
#variable_conflict use_column
declare
  v_q text := nullif(btrim(left(coalesce(p_query, ''), 100)), '');
  v_email_pattern text;
  v_tokens text[];
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  perform se_vezmou.assert_operator(p_operator_id, array['owner', 'support']);
  if p_status is not null and p_status not in ('draft', 'pending_payment', 'published', 'archived', 'deleted', 'blocked') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if p_locale is not null and p_locale not in ('cs', 'en') then
    raise exception 'invalid_locale' using errcode = '22023';
  end if;
  if p_template is not null and p_template not in ('editorial', 'eukalyptus', 'chateau', 'modern') then
    raise exception 'invalid_template' using errcode = '22023';
  end if;

  if v_q is not null and position('@' in v_q) > 0 then
    v_email_pattern := '%' || replace(replace(replace(lower(v_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  elsif v_q is not null then
    v_tokens := regexp_split_to_array(nullif(se_vezmou.normalize_name(v_q), ''), ' ');
  end if;

  return query
    select w.id, w.slug, w.status, w.partner_a_name, w.partner_b_name, w.template, w.default_locale, w.locales,
           w.starts_on, w.published_at, w.last_activity_at, w.created_at,
           (select count(*)::integer from se_vezmou.wedding_admins a
             where a.wedding_id = w.id and a.removed_at is null),
           count(*) over ()
      from se_vezmou.weddings w
     where (p_status is null or w.status = p_status)
       and (p_locale is null or p_locale = any (w.locales))
       and (p_template is null or w.template = p_template)
       and (p_month is null or (w.starts_on >= date_trunc('month', p_month)::date
                                and w.starts_on < (date_trunc('month', p_month) + interval '1 month')::date))
       and (v_q is null
            or (v_email_pattern is not null and exists (
                  select 1 from se_vezmou.wedding_admins a
                   where a.wedding_id = w.id and a.removed_at is null
                     and lower(a.email::text) like v_email_pattern escape '\'))
            or (v_tokens is not null and not exists (
                  select 1 from unnest(v_tokens) t
                   where not (
                     se_vezmou.normalize_name(w.partner_a_name || ' ' || w.partner_b_name) like '%' || t || '%'
                     or lower(coalesce(w.slug, '')) like '%' || t || '%'
                     or exists (select 1 from se_vezmou.wedding_admins a
                                 where a.wedding_id = w.id and a.removed_at is null
                                   and lower(a.email::text) like '%' || t || '%')))))
     order by w.created_at desc, w.id
     limit v_limit offset v_offset;
end
$$;

-- ---------------------------------------------------------------------------
-- op_get_wedding: detail zakázky (FR-OPS-3). Agregáty a údaje páru, nikdy jména ani odpovědi hostů.
-- ---------------------------------------------------------------------------
create function se_vezmou.op_get_wedding(p_operator_id uuid, p_wedding_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  w se_vezmou.weddings;
  v_result jsonb;
begin
  perform se_vezmou.assert_operator(p_operator_id, array['owner', 'support']);
  select * into w from se_vezmou.weddings x where x.id = p_wedding_id;
  if not found then
    return null;
  end if;

  select jsonb_build_object(
    'wedding', jsonb_build_object(
      'id', w.id, 'slug', w.slug, 'status', w.status, 'template', w.template, 'palette', w.palette,
      'default_locale', w.default_locale, 'locales', to_jsonb(w.locales),
      'partner_a_name', w.partner_a_name, 'partner_b_name', w.partner_b_name,
      'starts_on', w.starts_on, 'ends_on', w.ends_on, 'timezone', w.timezone,
      'published_at', w.published_at, 'blocked_at', w.blocked_at, 'deleted_at', w.deleted_at,
      'purge_at', w.purge_at, 'health_purge_at', w.health_purge_at, 'guest_purge_at', w.guest_purge_at,
      'created_at', w.created_at, 'last_activity_at', w.last_activity_at,
      'published_version_no', (select v.version_no from se_vezmou.site_versions v where v.id = w.published_version_id),
      'has_preview', w.preview_token_hash is not null),
    'order', (select jsonb_build_object('plan_code', o.plan_code, 'status', o.status,
                                        'service_ends_at', o.service_ends_at)
                from se_vezmou.orders o where o.wedding_id = w.id),
    'slug_state', (select jsonb_build_object('state', sr.state, 'reserved_until', sr.reserved_until,
                                             'first_published_at', sr.first_published_at)
                     from se_vezmou.slug_registry sr
                    where sr.slug = w.slug and sr.wedding_id = w.id),
    'admins', coalesce((select jsonb_agg(jsonb_build_object(
                          'id', a.id, 'email', a.email::text, 'added_at', a.added_at,
                          'removed_at', a.removed_at, 'last_login_at', a.last_login_at)
                        order by a.added_at, a.id)
                          from se_vezmou.wedding_admins a where a.wedding_id = w.id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(h2.j order by h2.created_at desc, h2.id desc) from (
                          select h.id, h.created_at, jsonb_build_object(
                            'from_status', h.from_status, 'to_status', h.to_status, 'actor_type', h.actor_type,
                            'reason', h.reason, 'created_at', h.created_at) as j
                            from se_vezmou.wedding_status_history h where h.wedding_id = w.id
                           order by h.created_at desc, h.id desc limit 50) h2), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(n2.j order by n2.created_at desc, n2.id desc) from (
                        select n.id, n.created_at, jsonb_build_object(
                          'id', n.id, 'body', n.body, 'created_at', n.created_at,
                          'operator_email', op.email::text) as j
                          from se_vezmou.operator_notes n
                          join se_vezmou.operators op on op.id = n.operator_id
                         where n.wedding_id = w.id
                         order by n.created_at desc, n.id desc limit 50) n2), '[]'::jsonb),
    'counts', jsonb_build_object(
      'guests', (select count(*) from se_vezmou.guests g where g.wedding_id = w.id),
      'households', (select count(*) from se_vezmou.households h where h.wedding_id = w.id),
      'responses', (select count(*) from se_vezmou.rsvp_responses r where r.wedding_id = w.id)),
    'guest_access', (select jsonb_build_object('expires_at', g.expires_at)
                       from se_vezmou.data_access_grants g
                      where g.wedding_id = w.id and g.scope = 'guest_data' and g.revoked_at is null
                        and g.expires_at > pg_catalog.now()
                      order by g.expires_at desc limit 1))
  into v_result;
  return v_result;
end
$$;

-- ---------------------------------------------------------------------------
-- op_add_note: poznámka k zakázce (bez osobních údajů hostů)
-- ---------------------------------------------------------------------------
create function se_vezmou.op_add_note(p_operator_id uuid, p_wedding_id uuid, p_body text) returns uuid
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
begin
  perform se_vezmou.assert_operator(p_operator_id, array['owner', 'support']);
  if char_length(v_body) = 0 or char_length(v_body) > 2000 then
    raise exception 'invalid_note' using errcode = '22023';
  end if;
  perform 1 from se_vezmou.weddings w where w.id = p_wedding_id for share;
  if not found then
    raise exception 'wedding_not_found' using errcode = 'P0002';
  end if;
  insert into se_vezmou.operator_notes (wedding_id, operator_id, body)
  values (p_wedding_id, p_operator_id, v_body) returning id into v_id;
  perform se_vezmou.write_audit('operator', p_operator_id, p_wedding_id, 'wedding.note_add', 'operator_note',
    v_id, null, jsonb_build_object('length', char_length(v_body)));
  return v_id;
end
$$;

-- ---------------------------------------------------------------------------
-- op_change_slug (FR-OPS-4, data-model kap. 6 bod 6): jen majitel. Starý slug přejde do retired
-- (zveřejněný zůstává trvale zablokovaný), nový projde stejnou kontrolou jako v průvodci.
-- ---------------------------------------------------------------------------
create function se_vezmou.op_change_slug(p_operator_id uuid, p_wedding_id uuid, p_slug text, p_reason text)
  returns void
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  w se_vezmou.weddings;
  v_old text;
  v_active boolean;
begin
  perform se_vezmou.assert_operator(p_operator_id, array['owner']);
  if char_length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if p_slug is null or not se_vezmou.slug_valid(p_slug) then
    raise exception 'invalid_slug' using errcode = '22023';
  end if;

  select * into w from se_vezmou.weddings x where x.id = p_wedding_id for update;
  if not found then
    raise exception 'wedding_not_found' using errcode = 'P0002';
  end if;
  if w.deleted_at is not null then
    raise exception 'wedding_deleted' using errcode = '55000';
  end if;
  if w.slug = p_slug then
    return;
  end if;

  -- prošlé rezervace a nezveřejněné retired adresy téhož slugu se uvolní (jako u reserve_slug)
  delete from se_vezmou.slug_registry sr
   where sr.slug = p_slug and sr.first_published_at is null
     and ((sr.state = 'reserved' and sr.reserved_until <= pg_catalog.now()) or sr.state = 'retired');
  if not se_vezmou.slug_available(p_slug) then
    raise exception 'slug_unavailable' using errcode = '23505';
  end if;

  v_old := w.slug;
  if v_old is not null then
    update se_vezmou.slug_registry sr set state = 'retired', reserved_until = null
     where sr.slug = v_old and sr.wedding_id = w.id and sr.state in ('reserved', 'active');
  end if;

  -- zveřejněná zakázka dostane aktivní adresu hned, koncept rezervaci jako po průvodci
  v_active := w.published_at is not null;
  if v_active then
    insert into se_vezmou.slug_registry (slug, state, wedding_id, first_published_at)
    values (p_slug, 'active', w.id, pg_catalog.now());
  else
    insert into se_vezmou.slug_registry (slug, state, wedding_id, reserved_until)
    values (p_slug, 'reserved', w.id,
            w.last_activity_at + pg_catalog.make_interval(days => se_vezmou.setting_int('slug_reservation_days', 30)));
  end if;
  update se_vezmou.weddings x set slug = p_slug where x.id = w.id;

  perform se_vezmou.write_audit('operator', p_operator_id, w.id, 'wedding.slug_change', 'wedding', w.id,
    p_reason, jsonb_build_object('old_slug', v_old, 'new_slug', p_slug));
end
$$;

-- ---------------------------------------------------------------------------
-- op_extend_retention (FR-OPS-4): jen majitel. Lhůtu lze jen prodloužit (nikdy zkrátit ani dát do minulosti).
-- p_kind: service (konec provozu, orders.service_ends_at), health (smazání dietních údajů),
-- guests (smazání ostatních údajů hostů). Datum platí do konce zadaného dne v pásmu svatby.
-- ---------------------------------------------------------------------------
create function se_vezmou.op_extend_retention(
  p_operator_id uuid,
  p_wedding_id uuid,
  p_kind text,
  p_until date,
  p_reason text
) returns void
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  w se_vezmou.weddings;
  v_new timestamptz;
  v_old timestamptz;
begin
  perform se_vezmou.assert_operator(p_operator_id, array['owner']);
  if p_kind not in ('service', 'health', 'guests') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if p_until is null then
    raise exception 'invalid_date' using errcode = '22023';
  end if;

  select * into w from se_vezmou.weddings x where x.id = p_wedding_id for update;
  if not found then
    raise exception 'wedding_not_found' using errcode = 'P0002';
  end if;
  if w.deleted_at is not null then
    raise exception 'wedding_deleted' using errcode = '55000';
  end if;

  v_new := (p_until + 1)::timestamp at time zone w.timezone;
  if v_new <= pg_catalog.now() then
    raise exception 'date_in_past' using errcode = '22023';
  end if;

  if p_kind = 'service' then
    select o.service_ends_at into v_old from se_vezmou.orders o where o.wedding_id = w.id for update;
    if not found then
      raise exception 'order_not_found' using errcode = 'P0002';
    end if;
    if v_old is not null and v_new <= v_old then
      raise exception 'not_an_extension' using errcode = '22023';
    end if;
    update se_vezmou.orders o set service_ends_at = v_new where o.wedding_id = w.id;
  elsif p_kind = 'health' then
    v_old := w.health_purge_at;
    if v_old is not null and v_new <= v_old then
      raise exception 'not_an_extension' using errcode = '22023';
    end if;
    update se_vezmou.weddings x set health_purge_at = v_new where x.id = w.id;
  else
    v_old := w.guest_purge_at;
    if v_old is not null and v_new <= v_old then
      raise exception 'not_an_extension' using errcode = '22023';
    end if;
    update se_vezmou.weddings x set guest_purge_at = v_new where x.id = w.id;
  end if;

  perform se_vezmou.write_audit('operator', p_operator_id, w.id, 'wedding.retention_extend', 'wedding', w.id,
    p_reason, jsonb_build_object('kind', p_kind, 'old_until', v_old, 'new_until', v_new));
end
$$;

-- ---------------------------------------------------------------------------
-- op_restore_wedding (FR-OPS-4): jen majitel, jen smazaný web před uplynutím ochranné lhůty (purge_at).
-- Vrací se do stavu před smazáním (z historie), jinak do konceptu.
-- ---------------------------------------------------------------------------
create function se_vezmou.op_restore_wedding(p_operator_id uuid, p_wedding_id uuid, p_reason text) returns text
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  w se_vezmou.weddings;
  v_target text;
begin
  perform se_vezmou.assert_operator(p_operator_id, array['owner']);
  if char_length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  select * into w from se_vezmou.weddings x where x.id = p_wedding_id for update;
  if not found then
    raise exception 'wedding_not_found' using errcode = 'P0002';
  end if;
  if w.status <> 'deleted' or (w.purge_at is not null and w.purge_at <= pg_catalog.now()) then
    raise exception 'not_restorable' using errcode = '55000';
  end if;

  select h.from_status into v_target from se_vezmou.wedding_status_history h
   where h.wedding_id = w.id and h.to_status = 'deleted'
   order by h.created_at desc, h.id desc limit 1;
  if v_target is null or v_target = 'deleted'
     or (v_target = 'published' and (w.slug is null or w.published_version_id is null)) then
    v_target := 'draft';
  end if;

  update se_vezmou.weddings x set status = v_target where x.id = w.id;
  insert into se_vezmou.wedding_status_history (wedding_id, from_status, to_status, actor_type, actor_id, reason)
  values (w.id, 'deleted', v_target, 'operator', p_operator_id, p_reason);
  perform se_vezmou.write_audit('operator', p_operator_id, w.id, 'wedding.restore', 'wedding', w.id,
    p_reason, jsonb_build_object('from_status', 'deleted', 'to_status', v_target));
  return v_target;
end
$$;

-- ---------------------------------------------------------------------------
-- op_send_login_link (FR-OPS-4): vytvoří jednorázovou výzvu pro správce a vrátí jeho e-mail, na který
-- server pošle kód a odkaz. Hash e-mailu a kódu počítá aplikace (HMAC s tajnou hodnotou), databáze
-- ověří jen, že jde o aktivního správce této zakázky. Odkaz správce nepřihlásí sám (potvrzovací stránka).
-- ---------------------------------------------------------------------------
create function se_vezmou.op_send_login_link(
  p_operator_id uuid,
  p_wedding_id uuid,
  p_admin_id uuid,
  p_email_hash bytea,
  p_code_hash bytea,
  p_ttl_seconds integer default 600
) returns text
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_email text;
  v_status text;
begin
  perform se_vezmou.assert_operator(p_operator_id, array['owner', 'support']);
  select a.email::text, w.status into v_email, v_status
    from se_vezmou.wedding_admins a
    join se_vezmou.weddings w on w.id = a.wedding_id
   where a.id = p_admin_id and a.wedding_id = p_wedding_id and a.removed_at is null and w.deleted_at is null;
  if not found then
    raise exception 'admin_not_found' using errcode = 'P0002';
  end if;
  if v_status = 'blocked' then
    raise exception 'wedding_blocked' using errcode = '55000';
  end if;

  perform se_vezmou.auth_create_challenge(p_email_hash, 'admin_login', p_code_hash, p_ttl_seconds);
  perform se_vezmou.write_audit('operator', p_operator_id, p_wedding_id, 'wedding.login_link_sent', 'wedding_admin',
    p_admin_id, null, jsonb_build_object('ttl_seconds', p_ttl_seconds));
  return v_email;
end
$$;

-- ---------------------------------------------------------------------------
-- op_overview (FR-OPS-6): počty podle stavu, svatby podle měsíců, šablon a jazyků. Bez osobních údajů.
-- ---------------------------------------------------------------------------
create function se_vezmou.op_overview(p_operator_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
begin
  perform se_vezmou.assert_operator(p_operator_id, array['owner', 'support']);
  return jsonb_build_object(
    'by_status', coalesce((select jsonb_object_agg(s.status, s.n)
                             from (select w.status, count(*) as n from se_vezmou.weddings w group by w.status) s),
                          '{}'::jsonb),
    'by_month', coalesce((select jsonb_agg(jsonb_build_object('month', m.month, 'count', m.n) order by m.month)
                            from (select to_char(w.starts_on, 'YYYY-MM') as month, count(*) as n
                                    from se_vezmou.weddings w
                                   where w.starts_on is not null and w.status <> 'deleted'
                                   group by 1) m), '[]'::jsonb),
    'without_date', (select count(*) from se_vezmou.weddings w where w.starts_on is null and w.status <> 'deleted'),
    'by_template', coalesce((select jsonb_object_agg(t.template, t.n)
                               from (select w.template, count(*) as n from se_vezmou.weddings w
                                      where w.status <> 'deleted' group by w.template) t), '{}'::jsonb),
    'by_locale', coalesce((select jsonb_object_agg(l.locale, l.n)
                             from (select u.locale, count(*) as n
                                     from se_vezmou.weddings w, unnest(w.locales) as u(locale)
                                    where w.status <> 'deleted' group by u.locale) l), '{}'::jsonb));
end
$$;

-- ---------------------------------------------------------------------------
-- op_analytics_summary (FR-OPS-6): souhrny z analytic_event za posledních p_days dní (bez PII)
-- ---------------------------------------------------------------------------
create function se_vezmou.op_analytics_summary(p_operator_id uuid, p_days integer default 30)
  returns table (event text, locale text, template text, step smallint, events bigint)
  language plpgsql stable security definer set search_path = ''
  as $$
#variable_conflict use_column
begin
  perform se_vezmou.assert_operator(p_operator_id, array['owner', 'support']);
  return query
    select e.event, e.locale, e.template, e.step, count(*)
      from se_vezmou.analytics_event e
     where e.created_at >= pg_catalog.now() - pg_catalog.make_interval(days => least(greatest(coalesce(p_days, 30), 1), 365))
     group by e.event, e.locale, e.template, e.step
     order by e.event, e.step nulls first, e.locale nulls first, e.template nulls first;
end
$$;

-- ---------------------------------------------------------------------------
-- op_list_retention (FR-OPS-5): zakázky s blížícím se vypršením (bez mazání; mazání je M10).
-- kind: service (konec provozu), health (dietní údaje), guests (ostatní údaje hostů), purge (smazaný web).
-- ---------------------------------------------------------------------------
create function se_vezmou.op_list_retention(p_operator_id uuid, p_within_days integer default 60)
  returns table (
    wedding_id uuid, slug text, status text, partner_a_name text, partner_b_name text,
    kind text, due_at timestamptz
  )
  language plpgsql stable security definer set search_path = ''
  as $$
#variable_conflict use_column
declare
  v_until timestamptz := pg_catalog.now()
    + pg_catalog.make_interval(days => least(greatest(coalesce(p_within_days, 60), 1), 3650));
begin
  perform se_vezmou.assert_operator(p_operator_id, array['owner', 'support']);
  return query
    select d.wedding_id, d.slug, d.status, d.partner_a_name, d.partner_b_name, d.kind, d.due_at
      from (
        select w.id as wedding_id, w.slug, w.status, w.partner_a_name, w.partner_b_name, 'service'::text as kind,
               o.service_ends_at as due_at
          from se_vezmou.weddings w join se_vezmou.orders o on o.wedding_id = w.id
         where o.service_ends_at is not null and o.service_ends_at <= v_until and w.status <> 'deleted'
        union all
        select w.id, w.slug, w.status, w.partner_a_name, w.partner_b_name, 'health', w.health_purge_at
          from se_vezmou.weddings w
         where w.health_purge_at is not null and w.health_purge_at <= v_until
           and exists (select 1 from se_vezmou.rsvp_health h where h.wedding_id = w.id)
        union all
        select w.id, w.slug, w.status, w.partner_a_name, w.partner_b_name, 'guests', w.guest_purge_at
          from se_vezmou.weddings w
         where w.guest_purge_at is not null and w.guest_purge_at <= v_until
           and exists (select 1 from se_vezmou.households h where h.wedding_id = w.id)
        union all
        select w.id, w.slug, w.status, w.partner_a_name, w.partner_b_name, 'purge', w.purge_at
          from se_vezmou.weddings w
         where w.status = 'deleted' and w.purge_at is not null and w.purge_at <= v_until
      ) d
     order by d.due_at, d.kind, d.wedding_id;
end
$$;

-- ---------------------------------------------------------------------------
-- op_list_audit: audit log s filtrem (jen majitel). Meta obsahuje jen identifikátory, počty a stavy.
-- ---------------------------------------------------------------------------
create function se_vezmou.op_list_audit(
  p_operator_id uuid,
  p_action text default null,
  p_wedding_id uuid default null,
  p_actor_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 50,
  p_offset integer default 0
) returns table (
  id bigint, at timestamptz, actor_type text, actor_id uuid, actor_email text, wedding_id uuid, action text,
  target_type text, target_id uuid, reason text, meta jsonb, total_count bigint
)
  language plpgsql stable security definer set search_path = ''
  as $$
#variable_conflict use_column
declare
  v_action text := nullif(btrim(left(coalesce(p_action, ''), 80)), '');
  v_pattern text;
begin
  perform se_vezmou.assert_operator(p_operator_id, array['owner']);
  if v_action is not null then
    v_pattern := replace(replace(replace(v_action, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  return query
    select a.id, a.at, a.actor_type, a.actor_id, op.email::text, a.wedding_id, a.action, a.target_type,
           a.target_id, a.reason, a.meta, count(*) over ()
      from se_vezmou.audit_log a
      left join se_vezmou.operators op on op.id = a.actor_id and a.actor_type = 'operator'
     where (v_pattern is null or a.action like v_pattern escape '\')
       and (p_wedding_id is null or a.wedding_id = p_wedding_id)
       and (p_actor_id is null or a.actor_id = p_actor_id)
       and (p_from is null or a.at >= p_from)
       and (p_to is null or a.at < p_to)
     order by a.at desc, a.id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end
$$;

-- ---------------------------------------------------------------------------
-- Správa operátorů (jen majitel)
-- ---------------------------------------------------------------------------
create function se_vezmou.op_list_operators(p_operator_id uuid)
  returns table (
    id uuid, email text, role text, disabled_at timestamptz, totp_confirmed boolean,
    backup_codes_left integer, last_login_at timestamptz, created_at timestamptz
  )
  language plpgsql stable security definer set search_path = ''
  as $$
#variable_conflict use_column
begin
  perform se_vezmou.assert_operator(p_operator_id, array['owner']);
  return query
    select o.id, o.email::text, o.role, o.disabled_at, o.totp_confirmed_at is not null,
           (select count(*)::integer from se_vezmou.operator_backup_codes b
             where b.operator_id = o.id and b.used_at is null),
           o.last_login_at, o.created_at
      from se_vezmou.operators o
     order by o.created_at, o.id;
end
$$;

-- Nový operátor: bez faktoru; druhý faktor si zapíše při prvním přihlášení.
create function se_vezmou.op_create_operator(p_owner_id uuid, p_email text, p_role text) returns uuid
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_id uuid;
begin
  perform se_vezmou.assert_operator(p_owner_id, array['owner']);
  if p_role not in ('owner', 'support') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  if char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  insert into se_vezmou.operators (email, role) values (v_email, p_role) returning id into v_id;
  perform se_vezmou.write_audit('operator', p_owner_id, null, 'operator.create', 'operator', v_id, null,
    jsonb_build_object('role', p_role));
  return v_id;
end
$$;

create function se_vezmou.op_set_operator_disabled(
  p_owner_id uuid,
  p_target_id uuid,
  p_disabled boolean,
  p_reason text
) returns void
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  t se_vezmou.operators;
begin
  perform se_vezmou.assert_operator(p_owner_id, array['owner']);
  if char_length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  select * into t from se_vezmou.operators x where x.id = p_target_id for update;
  if not found then
    raise exception 'operator_not_found' using errcode = 'P0002';
  end if;
  if p_target_id = p_owner_id then
    raise exception 'self_not_allowed' using errcode = '22023';
  end if;
  if p_disabled then
    if t.role = 'owner' and t.disabled_at is null and not exists (
         select 1 from se_vezmou.operators o
          where o.role = 'owner' and o.disabled_at is null and o.id <> t.id) then
      raise exception 'last_owner' using errcode = '55000';
    end if;
    update se_vezmou.operators x set disabled_at = coalesce(x.disabled_at, pg_catalog.now()) where x.id = t.id;
    update se_vezmou.operator_sessions s set revoked_at = pg_catalog.now()
     where s.operator_id = t.id and s.revoked_at is null;
  else
    update se_vezmou.operators x set disabled_at = null where x.id = t.id;
  end if;
  perform se_vezmou.write_audit('operator', p_owner_id, null,
    case when p_disabled then 'operator.disable' else 'operator.enable' end,
    'operator', t.id, p_reason, '{}'::jsonb);
end
$$;

-- Obnova druhého faktoru přes majitele (ADR 0008, 0012): zneplatní klíč i záložní kódy a odvolá relace,
-- operátor si při dalším přihlášení zapíše nový faktor. Majitel sám sobě faktor nemění (to je zásah v databázi).
create function se_vezmou.op_reset_operator_mfa(p_owner_id uuid, p_target_id uuid, p_reason text) returns void
  language plpgsql volatile security definer set search_path = ''
  as $$
begin
  perform se_vezmou.assert_operator(p_owner_id, array['owner']);
  if char_length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if p_target_id = p_owner_id then
    raise exception 'self_not_allowed' using errcode = '22023';
  end if;
  perform 1 from se_vezmou.operators x where x.id = p_target_id for update;
  if not found then
    raise exception 'operator_not_found' using errcode = 'P0002';
  end if;
  update se_vezmou.operators x
     set totp_secret_enc = null, totp_confirmed_at = null, totp_last_step = null
   where x.id = p_target_id;
  delete from se_vezmou.operator_backup_codes b where b.operator_id = p_target_id;
  update se_vezmou.operator_sessions s set revoked_at = pg_catalog.now()
   where s.operator_id = p_target_id and s.revoked_at is null;
  perform se_vezmou.write_audit('operator', p_owner_id, null, 'operator.mfa_reset', 'operator', p_target_id,
    p_reason, '{}'::jsonb);
end
$$;

revoke all on function
  se_vezmou.op_set_wedding_status(uuid, uuid, text, text),
  se_vezmou.op_list_weddings(uuid, text, text, text, date, text, integer, integer),
  se_vezmou.op_get_wedding(uuid, uuid),
  se_vezmou.op_add_note(uuid, uuid, text),
  se_vezmou.op_change_slug(uuid, uuid, text, text),
  se_vezmou.op_extend_retention(uuid, uuid, text, date, text),
  se_vezmou.op_restore_wedding(uuid, uuid, text),
  se_vezmou.op_send_login_link(uuid, uuid, uuid, bytea, bytea, integer),
  se_vezmou.op_overview(uuid),
  se_vezmou.op_analytics_summary(uuid, integer),
  se_vezmou.op_list_retention(uuid, integer),
  se_vezmou.op_list_audit(uuid, text, uuid, uuid, timestamptz, timestamptz, integer, integer),
  se_vezmou.op_list_operators(uuid),
  se_vezmou.op_create_operator(uuid, text, text),
  se_vezmou.op_set_operator_disabled(uuid, uuid, boolean, text),
  se_vezmou.op_reset_operator_mfa(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function
  se_vezmou.op_set_wedding_status(uuid, uuid, text, text),
  se_vezmou.op_list_weddings(uuid, text, text, text, date, text, integer, integer),
  se_vezmou.op_get_wedding(uuid, uuid),
  se_vezmou.op_add_note(uuid, uuid, text),
  se_vezmou.op_change_slug(uuid, uuid, text, text),
  se_vezmou.op_extend_retention(uuid, uuid, text, date, text),
  se_vezmou.op_restore_wedding(uuid, uuid, text),
  se_vezmou.op_send_login_link(uuid, uuid, uuid, bytea, bytea, integer),
  se_vezmou.op_overview(uuid),
  se_vezmou.op_analytics_summary(uuid, integer),
  se_vezmou.op_list_retention(uuid, integer),
  se_vezmou.op_list_audit(uuid, text, uuid, uuid, timestamptz, timestamptz, integer, integer),
  se_vezmou.op_list_operators(uuid),
  se_vezmou.op_create_operator(uuid, text, text),
  se_vezmou.op_set_operator_disabled(uuid, uuid, boolean, text),
  se_vezmou.op_reset_operator_mfa(uuid, uuid, text)
  to service_role;
