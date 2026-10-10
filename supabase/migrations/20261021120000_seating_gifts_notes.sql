-- Fáze 2 plánu funkcí (docs/plan-funkci-2026-10.md): zasedací pořádek, seznam věcných darů s rezervací,
-- soukromé poznámky a kontakty na dodavatele.
--
-- Všechny tři tabulky jsou jen přes funkce security definer (žádné politiky ani práva rolím), izolace
-- podle `wedding_id` z claimů. Migrace jen přidává; jediná náhrada je obal `purge_guest_data`, který
-- po dosavadním mazání údajů hostů navíc smaže usazení hostů a jména u rezervací darů (retence hostů).

-- ---------------------------------------------------------------------------
-- 1. Zasedací pořádek: jeden dokument na svatbu (stoly a usazení), verze `rev` proti souběžnému přepsání
--    Usazení odkazuje na osoby klíči `g:<id hosta>` (host ze seznamu) a `p:<id odpovědi>:<pořadí>`
--    (doprovod, dítě nebo host mimo seznam); jména se do plánu neukládají.
-- ---------------------------------------------------------------------------
create table se_vezmou.seating_plans (
  wedding_id uuid primary key references se_vezmou.weddings (id) on delete cascade,
  plan jsonb not null default '{}'::jsonb check (pg_catalog.jsonb_typeof(plan) = 'object'),
  rev integer not null default 0,
  updated_at timestamptz not null default pg_catalog.now()
);
alter table se_vezmou.seating_plans enable row level security;
revoke all on se_vezmou.seating_plans from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Věcné dary s rezervací. Host rezervuje bez účtu a dostane jednorázový token (v databázi jen jeho
--    hash), kterým rezervaci zruší; pár rezervaci uvolní kdykoli. Jméno u rezervace je nepovinné.
-- ---------------------------------------------------------------------------
create table se_vezmou.gift_items (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  wedding_id uuid not null references se_vezmou.weddings (id) on delete cascade,
  title jsonb not null check (pg_catalog.jsonb_typeof(title) = 'object'),
  description jsonb check (description is null or pg_catalog.jsonb_typeof(description) = 'object'),
  url text check (url is null or (char_length(url) <= 500 and url ~ '^https://')),
  price text check (price is null or char_length(price) <= 40),
  position integer not null default 0,
  reserved_at timestamptz,
  reserved_by text check (reserved_by is null or char_length(reserved_by) <= 80),
  reservation_hash bytea,
  created_at timestamptz not null default pg_catalog.now(),
  unique (wedding_id, id),
  check ((reserved_at is null) = (reservation_hash is null))
);
create index gift_items_wedding_idx on se_vezmou.gift_items (wedding_id, position, created_at);
alter table se_vezmou.gift_items enable row level security;
revoke all on se_vezmou.gift_items from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Soukromé poznámky a kontakty na dodavatele (jen pro správce, hostům se nikdy nezobrazují)
-- ---------------------------------------------------------------------------
create table se_vezmou.vendors (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  wedding_id uuid not null references se_vezmou.weddings (id) on delete cascade,
  category text not null check (category in ('photo', 'video', 'venue', 'catering', 'cake', 'flowers',
    'music', 'decor', 'attire', 'beauty', 'transport', 'officiant', 'other')),
  name text not null check (char_length(name) between 1 and 120),
  contact text check (contact is null or char_length(contact) <= 200),
  url text check (url is null or (char_length(url) <= 500 and url ~ '^https://')),
  price text check (price is null or char_length(price) <= 60),
  status text not null default 'idea' check (status in ('idea', 'contacted', 'booked')),
  note text check (note is null or char_length(note) <= 2000),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (wedding_id, id)
);
create index vendors_wedding_idx on se_vezmou.vendors (wedding_id, category, created_at);
alter table se_vezmou.vendors enable row level security;
revoke all on se_vezmou.vendors from public, anon, authenticated, service_role;

create table se_vezmou.wedding_notes (
  wedding_id uuid primary key references se_vezmou.weddings (id) on delete cascade,
  body text not null default '' check (char_length(body) <= 20000),
  rev integer not null default 0,
  updated_at timestamptz not null default pg_catalog.now()
);
alter table se_vezmou.wedding_notes enable row level security;
revoke all on se_vezmou.wedding_notes from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Pomocné kontroly textů ve dvou jazycích ({cs, en}, aspoň jeden neprázdný)
-- ---------------------------------------------------------------------------
create function se_vezmou.valid_i18n_text(p_value jsonb, p_max integer, p_required boolean) returns boolean
  language sql immutable set search_path = ''
  as $$
  select case
    when p_value is null or p_value = 'null'::jsonb then not p_required
    when pg_catalog.jsonb_typeof(p_value) <> 'object' then false
    when exists (select 1 from pg_catalog.jsonb_each(p_value) e
                  where e.key not in ('cs', 'en') or pg_catalog.jsonb_typeof(e.value) <> 'string'
                     or pg_catalog.char_length(e.value #>> '{}') > p_max) then false
    else not p_required or exists (select 1 from pg_catalog.jsonb_each_text(p_value) e
                                    where pg_catalog.btrim(e.value) <> '')
  end
$$;
revoke all on function se_vezmou.valid_i18n_text(jsonb, integer, boolean) from public, anon, authenticated, service_role;

-- ===========================================================================
-- Zasedací pořádek
-- ===========================================================================

-- admin_seating_get: plán, verze, události a osoby, které potvrdily účast aspoň na jedné události
create function se_vezmou.admin_seating_get() returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return pg_catalog.jsonb_build_object(
    'plan', coalesce((select s.plan from se_vezmou.seating_plans s where s.wedding_id = v_wedding_id), '{}'::jsonb),
    'rev', coalesce((select s.rev from se_vezmou.seating_plans s where s.wedding_id = v_wedding_id), 0),
    'events', (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'id', e.id, 'kind', e.kind, 'title', e.title) order by e.position, e.starts_at), '[]'::jsonb)
        from se_vezmou.events e where e.wedding_id = v_wedding_id and e.rsvp_enabled),
    'people', (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'key', x.key, 'name', x.name, 'household_id', x.household_id, 'household', x.label,
               'is_child', x.is_child, 'age', x.age, 'is_plus_one', x.is_plus_one,
               'attending', x.attending)
             order by x.label nulls last, x.response_id, x.created_at, x.id), '[]'::jsonb)
        from (
          select p.id, p.response_id, p.created_at, p.is_child, p.age, p.is_plus_one,
                 r.household_id, h.label,
                 coalesce(g.display_name, p.person_name) as name,
                 case when p.guest_id is not null then 'g:' || p.guest_id::text
                      else 'p:' || p.response_id::text || ':' || (pg_catalog.row_number() over (
                        partition by p.response_id, (p.guest_id is null)
                        order by p.created_at, p.id))::text end as key,
                 (select coalesce(pg_catalog.jsonb_agg(a.event_id order by a.event_id), '[]'::jsonb)
                    from se_vezmou.rsvp_attendance a
                   where a.person_id = p.id and a.wedding_id = p.wedding_id and a.attending) as attending
            from se_vezmou.rsvp_people p
            join se_vezmou.rsvp_responses r on r.id = p.response_id and r.wedding_id = p.wedding_id
            left join se_vezmou.households h on h.id = r.household_id and h.wedding_id = r.wedding_id
            left join se_vezmou.guests g on g.id = p.guest_id and g.wedding_id = p.wedding_id
           where p.wedding_id = v_wedding_id
        ) x
       where pg_catalog.jsonb_array_length(x.attending) > 0)
  );
end
$$;

-- admin_seating_save: celý plán najednou; `p_rev` musí odpovídat uložené verzi (jinak `conflict`)
create function se_vezmou.admin_seating_save(p_plan jsonb, p_rev integer) returns integer
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
  v_rev integer;
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_plan is null or pg_catalog.jsonb_typeof(p_plan) <> 'object'
     or pg_catalog.octet_length(p_plan::text) > 262144
     or pg_catalog.jsonb_typeof(coalesce(p_plan -> 'tables', '[]'::jsonb)) <> 'array'
     or pg_catalog.jsonb_array_length(coalesce(p_plan -> 'tables', '[]'::jsonb)) > 200
     or pg_catalog.jsonb_typeof(coalesce(p_plan -> 'assignments', '{}'::jsonb)) <> 'object' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  insert into se_vezmou.seating_plans (wedding_id) values (v_wedding_id) on conflict do nothing;
  select s.rev into v_rev from se_vezmou.seating_plans s where s.wedding_id = v_wedding_id for update;
  if v_rev <> coalesce(p_rev, -1) then
    raise exception 'conflict' using errcode = '40001';
  end if;
  update se_vezmou.seating_plans s set plan = p_plan, rev = v_rev + 1, updated_at = pg_catalog.now()
   where s.wedding_id = v_wedding_id;
  return v_rev + 1;
end
$$;

-- ===========================================================================
-- Věcné dary
-- ===========================================================================

-- admin_gifts_list: seznam pro správce včetně stavu rezervace a nepovinného jména
create function se_vezmou.admin_gifts_list() returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'id', i.id, 'title', i.title, 'description', i.description, 'url', i.url, 'price', i.price,
             'reserved_at', i.reserved_at, 'reserved_by', i.reserved_by)
           order by i.position, i.created_at, i.id), '[]'::jsonb)
      from se_vezmou.gift_items i where i.wedding_id = v_wedding_id
  );
end
$$;

-- admin_gift_save: nový dar (p_id null) nebo úprava; payload {title, description, url, price}
create function se_vezmou.admin_gift_save(p_id uuid, p_payload jsonb) returns uuid
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
  v_id uuid;
  v_url text := nullif(pg_catalog.btrim(coalesce(p_payload ->> 'url', '')), '');
  v_price text := nullif(pg_catalog.btrim(coalesce(p_payload ->> 'price', '')), '');
  v_description jsonb := nullif(p_payload -> 'description', 'null'::jsonb);
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object'
     or not se_vezmou.valid_i18n_text(p_payload -> 'title', 120, true)
     or not se_vezmou.valid_i18n_text(v_description, 500, false)
     or (v_url is not null and (pg_catalog.char_length(v_url) > 500 or v_url !~ '^https://[^\s]+$'))
     or (v_price is not null and pg_catalog.char_length(v_price) > 40) then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  perform 1 from se_vezmou.weddings w where w.id = v_wedding_id for update;
  if p_id is null then
    if (select count(*) from se_vezmou.gift_items i where i.wedding_id = v_wedding_id) >= 100 then
      raise exception 'gift_limit_exceeded' using errcode = '22023';
    end if;
    insert into se_vezmou.gift_items (wedding_id, title, description, url, price, position)
    values (v_wedding_id, p_payload -> 'title', v_description, v_url, v_price,
            coalesce((select max(i.position) + 1 from se_vezmou.gift_items i where i.wedding_id = v_wedding_id), 0))
    returning id into v_id;
  else
    update se_vezmou.gift_items i
       set title = p_payload -> 'title', description = v_description, url = v_url, price = v_price
     where i.id = p_id and i.wedding_id = v_wedding_id
    returning i.id into v_id;
    if v_id is null then
      raise exception 'gift_not_found' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end
$$;

create function se_vezmou.admin_gift_delete(p_id uuid) returns void
  language plpgsql volatile security definer set search_path = ''
  as $$
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from se_vezmou.gift_items i where i.id = p_id and i.wedding_id = se_vezmou.wedding_id();
  if not found then
    raise exception 'gift_not_found' using errcode = 'P0002';
  end if;
end
$$;

-- admin_gift_release: pár zruší rezervaci (host si to rozmyslel, dar se koupil jinak)
create function se_vezmou.admin_gift_release(p_id uuid) returns void
  language plpgsql volatile security definer set search_path = ''
  as $$
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update se_vezmou.gift_items i set reserved_at = null, reserved_by = null, reservation_hash = null
   where i.id = p_id and i.wedding_id = se_vezmou.wedding_id();
  if not found then
    raise exception 'gift_not_found' using errcode = 'P0002';
  end if;
end
$$;

-- admin_gift_move: posun v pořadí o jedno místo nahoru (-1) nebo dolů (1)
create function se_vezmou.admin_gift_move(p_id uuid, p_delta integer) returns void
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
  v_ids uuid[];
  v_index integer;
  v_target integer;
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_delta not in (-1, 1) then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  perform 1 from se_vezmou.weddings w where w.id = v_wedding_id for update;
  select pg_catalog.array_agg(i.id order by i.position, i.created_at, i.id) into v_ids
    from se_vezmou.gift_items i where i.wedding_id = v_wedding_id;
  v_index := pg_catalog.array_position(v_ids, p_id);
  if v_index is null then
    raise exception 'gift_not_found' using errcode = 'P0002';
  end if;
  v_target := v_index + p_delta;
  if v_target < 1 or v_target > pg_catalog.cardinality(v_ids) then
    return;
  end if;
  v_ids[v_index] := v_ids[v_target];
  v_ids[v_target] := p_id;
  update se_vezmou.gift_items i set position = x.ord - 1
    from pg_catalog.unnest(v_ids) with ordinality as x (id, ord)
   where i.id = x.id and i.wedding_id = v_wedding_id;
end
$$;

-- gift_access: smí host (návštěvník webu) vidět a rezervovat dary? Vrací 'ok', 'locked' (chce PIN
-- hostů) nebo 'closed' (web není zveřejněný, nebo je po svatbě).
create function se_vezmou.gift_access() returns text
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_role text := se_vezmou.wedding_role();
  w se_vezmou.weddings;
begin
  if se_vezmou.wedding_id() is null or v_role is null or v_role not in ('visitor', 'guest_pin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into w from se_vezmou.weddings x where x.id = se_vezmou.wedding_id();
  if w.id is null or w.status <> 'published' or se_vezmou.phase(w) = 'thanks' then
    return 'closed';
  end if;
  if w.guest_pin_enabled and v_role <> 'guest_pin' then
    return 'locked';
  end if;
  return 'ok';
end
$$;
revoke all on function se_vezmou.gift_access() from public, anon, authenticated, service_role;

-- gift_list_public: dary pro hosta bez jmen a bez údajů o rezervaci (jen „zabráno“); bez darů null
create function se_vezmou.gift_list_public() returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
  v_access text := se_vezmou.gift_access();
begin
  if v_access = 'closed'
     or not exists (select 1 from se_vezmou.gift_items i where i.wedding_id = v_wedding_id) then
    return null;
  end if;
  if v_access = 'locked' then
    return pg_catalog.jsonb_build_object('locked', true, 'items', '[]'::jsonb);
  end if;
  return pg_catalog.jsonb_build_object('locked', false, 'items', (
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'id', i.id, 'title', i.title, 'description', i.description, 'url', i.url, 'price', i.price,
             'reserved', i.reserved_at is not null)
           order by i.position, i.created_at, i.id)
      from se_vezmou.gift_items i where i.wedding_id = v_wedding_id));
end
$$;

-- gift_reserve: rezervace daru hostem; vrací token pro zrušení (v databázi jen jeho hash)
create function se_vezmou.gift_reserve(p_id uuid, p_name text) returns text
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_access text := se_vezmou.gift_access();
  v_name text := nullif(pg_catalog.btrim(coalesce(p_name, '')), '');
  v_token text;
  v_item se_vezmou.gift_items;
begin
  if v_access <> 'ok' then
    raise exception 'gift_%', v_access using errcode = '42501';
  end if;
  if v_name is not null and pg_catalog.char_length(v_name) > 80 then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  select * into v_item from se_vezmou.gift_items i
   where i.id = p_id and i.wedding_id = se_vezmou.wedding_id() for update;
  if v_item.id is null then
    raise exception 'gift_not_found' using errcode = 'P0002';
  end if;
  if v_item.reserved_at is not null then
    raise exception 'gift_taken' using errcode = '23505';
  end if;
  v_token := pg_catalog.encode(extensions.gen_random_bytes(18), 'hex');
  update se_vezmou.gift_items i
     set reserved_at = pg_catalog.now(), reserved_by = v_name,
         reservation_hash = pg_catalog.sha256(pg_catalog.convert_to(v_token, 'UTF8'))
   where i.id = p_id;
  return v_token;
end
$$;

-- gift_unreserve: host zruší vlastní rezervaci tokenem; cizí ani neplatný token nic nezmění
create function se_vezmou.gift_unreserve(p_id uuid, p_token text) returns boolean
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_access text := se_vezmou.gift_access();
begin
  if v_access <> 'ok' then
    raise exception 'gift_%', v_access using errcode = '42501';
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{36}$' then
    return false;
  end if;
  update se_vezmou.gift_items i set reserved_at = null, reserved_by = null, reservation_hash = null
   where i.id = p_id and i.wedding_id = se_vezmou.wedding_id()
     and i.reservation_hash = pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8'));
  return found;
end
$$;

-- ===========================================================================
-- Dodavatelé a poznámky
-- ===========================================================================

create function se_vezmou.admin_vendors_list() returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'id', v.id, 'category', v.category, 'name', v.name, 'contact', v.contact, 'url', v.url,
             'price', v.price, 'status', v.status, 'note', v.note, 'updated_at', v.updated_at)
           order by v.created_at, v.id), '[]'::jsonb)
      from se_vezmou.vendors v where v.wedding_id = se_vezmou.wedding_id()
  );
end
$$;

-- admin_vendor_save: nový kontakt (p_id null) nebo úprava; payload {category, name, contact, url, price, status, note}
create function se_vezmou.admin_vendor_save(p_id uuid, p_payload jsonb) returns uuid
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
  v_id uuid;
  v_name text := pg_catalog.btrim(coalesce(p_payload ->> 'name', ''));
  v_contact text := nullif(pg_catalog.btrim(coalesce(p_payload ->> 'contact', '')), '');
  v_url text := nullif(pg_catalog.btrim(coalesce(p_payload ->> 'url', '')), '');
  v_price text := nullif(pg_catalog.btrim(coalesce(p_payload ->> 'price', '')), '');
  v_note text := nullif(pg_catalog.btrim(coalesce(p_payload ->> 'note', '')), '');
  v_category text := p_payload ->> 'category';
  v_status text := coalesce(p_payload ->> 'status', 'idea');
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object'
     or v_name = '' or pg_catalog.char_length(v_name) > 120
     or v_category is null or v_category not in ('photo', 'video', 'venue', 'catering', 'cake', 'flowers',
       'music', 'decor', 'attire', 'beauty', 'transport', 'officiant', 'other')
     or v_status not in ('idea', 'contacted', 'booked')
     or (v_contact is not null and pg_catalog.char_length(v_contact) > 200)
     or (v_url is not null and (pg_catalog.char_length(v_url) > 500 or v_url !~ '^https://[^\s]+$'))
     or (v_price is not null and pg_catalog.char_length(v_price) > 60)
     or (v_note is not null and pg_catalog.char_length(v_note) > 2000) then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  perform 1 from se_vezmou.weddings w where w.id = v_wedding_id for update;
  if p_id is null then
    if (select count(*) from se_vezmou.vendors v where v.wedding_id = v_wedding_id) >= 100 then
      raise exception 'vendor_limit_exceeded' using errcode = '22023';
    end if;
    insert into se_vezmou.vendors (wedding_id, category, name, contact, url, price, status, note)
    values (v_wedding_id, v_category, v_name, v_contact, v_url, v_price, v_status, v_note)
    returning id into v_id;
  else
    update se_vezmou.vendors v
       set category = v_category, name = v_name, contact = v_contact, url = v_url, price = v_price,
           status = v_status, note = v_note, updated_at = pg_catalog.now()
     where v.id = p_id and v.wedding_id = v_wedding_id
    returning v.id into v_id;
    if v_id is null then
      raise exception 'vendor_not_found' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end
$$;

create function se_vezmou.admin_vendor_delete(p_id uuid) returns void
  language plpgsql volatile security definer set search_path = ''
  as $$
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from se_vezmou.vendors v where v.id = p_id and v.wedding_id = se_vezmou.wedding_id();
  if not found then
    raise exception 'vendor_not_found' using errcode = 'P0002';
  end if;
end
$$;

create function se_vezmou.admin_notes_get() returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return coalesce(
    (select pg_catalog.jsonb_build_object('body', n.body, 'rev', n.rev, 'updated_at', n.updated_at)
       from se_vezmou.wedding_notes n where n.wedding_id = v_wedding_id),
    pg_catalog.jsonb_build_object('body', '', 'rev', 0, 'updated_at', null));
end
$$;

-- admin_notes_save: poznámky jako jeden text; `p_rev` hlídá souběžnou úpravu dvou správců (`conflict`)
create function se_vezmou.admin_notes_save(p_body text, p_rev integer) returns integer
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
  v_rev integer;
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_body is null or pg_catalog.char_length(p_body) > 20000 then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  insert into se_vezmou.wedding_notes (wedding_id) values (v_wedding_id) on conflict do nothing;
  select n.rev into v_rev from se_vezmou.wedding_notes n where n.wedding_id = v_wedding_id for update;
  if v_rev <> coalesce(p_rev, -1) then
    raise exception 'conflict' using errcode = '40001';
  end if;
  update se_vezmou.wedding_notes n set body = p_body, rev = v_rev + 1, updated_at = pg_catalog.now()
   where n.wedding_id = v_wedding_id;
  return v_rev + 1;
end
$$;

-- ===========================================================================
-- Retence hostů: po smazání údajů hostů (purge_guest_data_impl) se smaže i usazení a jména u rezervací
-- ===========================================================================
create or replace function se_vezmou.purge_guest_data(
  p_batch integer default 100,
  p_now timestamptz default pg_catalog.now(),
  p_wedding_id uuid default null,
  p_dry_run boolean default false
) returns integer
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_total integer;
begin
  perform se_vezmou.clock_guard(p_now);
  v_total := se_vezmou.purge_guest_data_impl(p_batch, p_now, p_wedding_id, p_dry_run);
  if not p_dry_run then
    -- svatby po lhůtě, kterým už žádní hosté ani odpovědi nezůstali
    update se_vezmou.seating_plans s set plan = s.plan - 'assignments', rev = s.rev + 1,
           updated_at = pg_catalog.now()
      from se_vezmou.weddings w
     where w.id = s.wedding_id and w.guest_purge_at is not null and w.guest_purge_at <= p_now
       and (p_wedding_id is null or w.id = p_wedding_id)
       and s.plan ? 'assignments'
       and not exists (select 1 from se_vezmou.households h where h.wedding_id = w.id)
       and not exists (select 1 from se_vezmou.rsvp_responses r where r.wedding_id = w.id);
    update se_vezmou.gift_items i set reserved_by = null
      from se_vezmou.weddings w
     where w.id = i.wedding_id and w.guest_purge_at is not null and w.guest_purge_at <= p_now
       and (p_wedding_id is null or w.id = p_wedding_id)
       and i.reserved_by is not null;
  end if;
  return v_total;
end
$$;

-- ---------------------------------------------------------------------------
-- Práva
-- ---------------------------------------------------------------------------
revoke all on function
  se_vezmou.admin_seating_get(),
  se_vezmou.admin_seating_save(jsonb, integer),
  se_vezmou.admin_gifts_list(),
  se_vezmou.admin_gift_save(uuid, jsonb),
  se_vezmou.admin_gift_delete(uuid),
  se_vezmou.admin_gift_release(uuid),
  se_vezmou.admin_gift_move(uuid, integer),
  se_vezmou.gift_list_public(),
  se_vezmou.gift_reserve(uuid, text),
  se_vezmou.gift_unreserve(uuid, text),
  se_vezmou.admin_vendors_list(),
  se_vezmou.admin_vendor_save(uuid, jsonb),
  se_vezmou.admin_vendor_delete(uuid),
  se_vezmou.admin_notes_get(),
  se_vezmou.admin_notes_save(text, integer)
  from public, anon, authenticated, service_role;
grant execute on function
  se_vezmou.admin_seating_get(),
  se_vezmou.admin_seating_save(jsonb, integer),
  se_vezmou.admin_gifts_list(),
  se_vezmou.admin_gift_save(uuid, jsonb),
  se_vezmou.admin_gift_delete(uuid),
  se_vezmou.admin_gift_release(uuid),
  se_vezmou.admin_gift_move(uuid, integer),
  se_vezmou.gift_list_public(),
  se_vezmou.gift_reserve(uuid, text),
  se_vezmou.gift_unreserve(uuid, text),
  se_vezmou.admin_vendors_list(),
  se_vezmou.admin_vendor_save(uuid, jsonb),
  se_vezmou.admin_vendor_delete(uuid),
  se_vezmou.admin_notes_get(),
  se_vezmou.admin_notes_save(text, integer)
  to authenticated;
