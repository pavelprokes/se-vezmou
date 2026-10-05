-- Čtyři nové šablony webu páru (docs/konkurence-2026-10.md): Statek, Vinice, Louka a Deco.
-- Jen rozšiřuje povolené hodnoty (zpětně kompatibilní: běžící kód zapisuje jen staré hodnoty).
-- Seznam musí odpovídat `templateKeys` v src/site/themes/palettes.ts.

alter table se_vezmou.weddings drop constraint weddings_template_check;
alter table se_vezmou.weddings add constraint weddings_template_check
  check (template in ('editorial', 'eukalyptus', 'chateau', 'modern', 'statek', 'vinice', 'louka', 'deco'));

alter table se_vezmou.analytics_event drop constraint analytics_event_template_check;
alter table se_vezmou.analytics_event add constraint analytics_event_template_check
  check (template in ('editorial', 'eukalyptus', 'chateau', 'modern', 'statek', 'vinice', 'louka', 'deco'));

-- Filtr provozní administrace podle šablony: stejná funkce, jen delší seznam povolených hodnot.
create or replace function se_vezmou.op_list_weddings(
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
  if p_template is not null and p_template not in ('editorial', 'eukalyptus', 'chateau', 'modern', 'statek', 'vinice', 'louka', 'deco') then
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
