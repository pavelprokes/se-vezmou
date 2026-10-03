-- Idempotence odeslání: odpověď hosta mimo seznam a hromadný import hostů.
--
-- Dvojklik nebo opakování po výpadku sítě dřív vytvořilo duplicitní odpověď (a poslalo další potvrzení
-- e-mailem), resp. duplicitní hosty. Klient teď posílá nonce (UUID vygenerované při otevření formuláře
-- nebo náhledu importu) a databáze drží jedinečnost (wedding_id, nonce):
--  * `rsvp_responses.nonce`: odpověď hosta mimo seznam. Opakování se stejným nonce vrátí tutéž odpověď
--    s `duplicate: true` a nic nezapíše (aplikace pak neposílá potvrzení).
--  * `guest_import_batches`: dávka importu. Opakování vrátí výsledek první dávky s `duplicate: true`.
-- Souběžná odeslání se řadí advisory zámkem (odpověď) a zámkem řádku svatby (import).
--
-- Kontrola duplicit importu se přesunula z aplikace do databáze: běží pod zámkem svatby a porovnává
-- `name_key` se skutečným stavem seznamu hostů v okamžiku zápisu (dřív se číst seznam a zapisovat dalo
-- v samostatných krocích, takže souběžný import nebo ruční přidání duplicitu nezachytily).

-- ---------------------------------------------------------------------------
-- Odpovědi hostů mimo seznam
-- ---------------------------------------------------------------------------
alter table se_vezmou.rsvp_responses add column nonce uuid;
create unique index rsvp_responses_nonce_idx
  on se_vezmou.rsvp_responses (wedding_id, nonce) where nonce is not null;

create or replace function se_vezmou.rsvp_submit_unlisted(p_payload jsonb) returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
  w se_vezmou.weddings;
  v_settings se_vezmou.rsvp_settings;
  v_response_id uuid;
  v_nonce uuid;
begin
  if v_wedding_id is null or se_vezmou.wedding_role() not in ('visitor', 'guest_pin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  v_nonce := se_vezmou.try_uuid(p_payload ->> 'nonce');
  if v_nonce is null then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;

  -- souběžná odeslání téhož nonce se řadí za sebou; druhé uvidí odpověď prvního
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_wedding_id::text || ':rsvp-unlisted:' || v_nonce::text, 0));
  select r.id into v_response_id from se_vezmou.rsvp_responses r
   where r.wedding_id = v_wedding_id and r.nonce = v_nonce;
  if found then
    return jsonb_build_object('ok', true, 'response_id', v_response_id, 'duplicate', true);
  end if;

  select * into w from se_vezmou.weddings x where x.id = v_wedding_id and x.deleted_at is null;
  if not found or se_vezmou.phase(w) is distinct from 'rsvp_open' then
    raise exception 'rsvp_closed' using errcode = '55000';
  end if;
  select * into v_settings from se_vezmou.rsvp_settings s where s.wedding_id = v_wedding_id;
  if not coalesce(v_settings.allow_unlisted, false) then
    raise exception 'unlisted_not_allowed' using errcode = '42501';
  end if;

  v_response_id := se_vezmou.rsvp_apply(v_wedding_id, null, p_payload, 'guest');
  update se_vezmou.rsvp_responses r set nonce = v_nonce
   where r.id = v_response_id and r.wedding_id = v_wedding_id;
  return jsonb_build_object('ok', true, 'response_id', v_response_id, 'duplicate', false);
end
$$;

-- ---------------------------------------------------------------------------
-- Dávky importu hostů: jen počty, žádné osobní údaje
-- ---------------------------------------------------------------------------
create table se_vezmou.guest_import_batches (
  wedding_id uuid not null references se_vezmou.weddings (id) on delete cascade,
  nonce uuid not null,
  households integer not null check (households >= 0),
  guests integer not null check (guests >= 0),
  skipped integer not null default 0 check (skipped >= 0),
  created_at timestamptz not null default now(),
  primary key (wedding_id, nonce)
);
alter table se_vezmou.guest_import_batches enable row level security;
revoke all on table se_vezmou.guest_import_batches from public, anon, authenticated, service_role;

-- admin_guests_import: hromadný zápis ověřených řádků (jen přidává, nic nepřepisuje)
-- payload: {nonce: uuid, include_duplicates: bool, invited_event_ids: [uuid],
--           households: [{label, guests: [{display_name, is_child, age}]}]}
-- Host, jehož jméno (name_key) už v seznamu je nebo se v dávce opakuje, se bez include_duplicates přeskočí
-- (vrací se v `skipped`); domácnost bez zbylých hostů se nezaloží.
create or replace function se_vezmou.admin_guests_import(p_payload jsonb) returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  c_max_households constant integer := 1000;
  c_max_guests constant integer := 1500;
  v_wedding_id uuid := se_vezmou.wedding_id();
  v_household jsonb;
  v_guest jsonb;
  v_filtered jsonb;
  v_households integer := 0;
  v_guests integer := 0;
  v_skipped integer := 0;
  v_defaults jsonb;
  v_nonce uuid;
  v_include boolean;
  v_key text;
  v_seen text[] := '{}';
  v_batch se_vezmou.guest_import_batches;
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or jsonb_typeof(p_payload -> 'households') is distinct from 'array'
     or jsonb_array_length(p_payload -> 'households') not between 1 and c_max_households
     or pg_catalog.length(p_payload::text) > 2000000 then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  v_defaults := coalesce(p_payload -> 'invited_event_ids', '[]'::jsonb);
  if jsonb_typeof(v_defaults) <> 'array' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  v_nonce := se_vezmou.try_uuid(p_payload ->> 'nonce');
  if v_nonce is null then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  v_include := coalesce(p_payload -> 'include_duplicates' = 'true'::jsonb, false);

  -- zámek svatby: souběžné importy a ruční úpravy se řadí za sebou (strop počtu hostů, kontrola duplicit)
  perform 1 from se_vezmou.weddings w where w.id = v_wedding_id for update;

  select * into v_batch from se_vezmou.guest_import_batches b
   where b.wedding_id = v_wedding_id and b.nonce = v_nonce;
  if found then
    return jsonb_build_object('households', v_batch.households, 'guests', v_batch.guests,
                              'skipped', v_batch.skipped, 'duplicate', true);
  end if;

  for v_household in select value from jsonb_array_elements(p_payload -> 'households') loop
    if jsonb_typeof(v_household) <> 'object'
       or jsonb_typeof(v_household -> 'guests') is distinct from 'array' then
      raise exception 'invalid_payload' using errcode = '22023';
    end if;

    v_filtered := '[]'::jsonb;
    for v_guest in select value from jsonb_array_elements(v_household -> 'guests') loop
      if jsonb_typeof(v_guest) <> 'object' then
        raise exception 'invalid_payload' using errcode = '22023';
      end if;
      v_key := se_vezmou.name_key(pg_catalog.btrim(coalesce(v_guest ->> 'display_name', '')));
      if not v_include and v_key <> ''
         and (v_key = any (v_seen)
              or exists (select 1 from se_vezmou.guests g
                          where g.wedding_id = v_wedding_id and g.name_key = v_key)) then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      v_seen := v_seen || v_key;
      v_filtered := v_filtered || pg_catalog.jsonb_build_array(v_guest);
    end loop;
    if jsonb_array_length(v_filtered) = 0 then
      continue;
    end if;

    perform se_vezmou.household_write(v_wedding_id, null,
      pg_catalog.jsonb_set(v_household, '{guests}', v_filtered), 'import', v_defaults);
    v_households := v_households + 1;
    v_guests := v_guests + jsonb_array_length(v_filtered);
    if v_guests > c_max_guests then
      raise exception 'guest_limit_exceeded' using errcode = '22023';
    end if;
  end loop;

  insert into se_vezmou.guest_import_batches (wedding_id, nonce, households, guests, skipped)
  values (v_wedding_id, v_nonce, v_households, v_guests, v_skipped);

  perform se_vezmou.write_audit('admin', se_vezmou.actor_id(), v_wedding_id, 'guests.import',
    'wedding', v_wedding_id, null,
    jsonb_build_object('households', v_households, 'guests', v_guests, 'skipped', v_skipped));
  return jsonb_build_object('households', v_households, 'guests', v_guests,
                            'skipped', v_skipped, 'duplicate', false);
end
$$;
