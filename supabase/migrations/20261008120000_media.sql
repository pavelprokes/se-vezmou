-- M7c / 1: fotografie páru na Cloudflare R2 (ADR 0006): stav zpracování, varianty, funkce správce a doručení.
--
-- Zdroj: docs/adr/0006-photo-storage.md, docs/data-model.md kap. 3.3 (media), 5, 10; FR-WEB-5, FR-LC-2.
-- Soubory leží v R2, databáze drží jen metadata a klíče: originál v karanténě `incoming/{wedding_id}/{media_id}`,
-- zpracované varianty pod `{wedding_id}/{media_id}/{šířka}.{formát}`. Funkce správce volá server s claimy role
-- admin (role authenticated): každá vyžaduje se_vezmou.is_wedding_admin() a pracuje jen se svatbou z claimu
-- (žádný argument s identifikátorem svatby). Doručení (get_public_media) běží s claimy návštěvníka nebo hosta
-- po PINu. Vše ve schématu se_vezmou, žádné globální změny; funkce mají set search_path = '' a plně
-- kvalifikované názvy, revoke execute from public, anon.

-- ---------------------------------------------------------------------------
-- media: druh, stav zpracování, chyba
--  * kind `photo` (fotografie galerie, započítává se do limitu) a `card` (obrázek karty externí galerie, který
--    server zkopíroval z Open Graph cíle; vždy dekorativní, mimo limit fotografií)
--  * status: pending (čeká na nahrání originálu do karantény), processing, ready, failed
--  * popisek (`alt` po jazycích) smí chybět: fotografie bez popisku a bez příznaku dekorativní se prostě
--    nezveřejní (kontrola při sestavení snímku a upozornění v rozhraní), proto kontrola media_alt_required odpadá
-- Existující řádky (fixtury, starší data) zůstávají `photo` a `ready`.
-- ---------------------------------------------------------------------------
alter table se_vezmou.media drop constraint media_alt_required;

alter table se_vezmou.media
  add column kind text not null default 'photo' check (kind in ('photo', 'card')),
  add column status text not null default 'ready'
    check (status in ('pending', 'processing', 'ready', 'failed')),
  add column failure_code text check (failure_code is null or failure_code ~ '^[a-z_]{3,40}$'),
  add column processing_started_at timestamptz,
  add constraint media_failure_code_shape check (status <> 'failed' or failure_code is not null),
  add constraint media_card_decorative check (kind <> 'card' or decorative);

create index media_wedding_kind_status_idx on se_vezmou.media (wedding_id, kind, status, created_at);

-- ---------------------------------------------------------------------------
-- media_variants: zpracované soubory (šířky 640, 1280, 1920 px ve WebP a AVIF, nikdy nad rozměr originálu).
-- Složený cizí klíč (wedding_id, media_id): varianta nemůže patřit médiu jiné svatby. Zapisuje jen funkce
-- admin_media_complete, správce tabulku čte.
-- ---------------------------------------------------------------------------
create table se_vezmou.media_variants (
  wedding_id uuid not null,
  media_id uuid not null,
  width integer not null check (width between 16 and 4000),
  height integer not null check (height > 0),
  format text not null check (format in ('avif', 'webp')),
  bytes bigint not null check (bytes > 0),
  -- úplný klíč objektu v R2: {wedding_id}/{media_id}/{width}.{format}
  storage_key text not null check (char_length(storage_key) between 40 and 200),
  created_at timestamptz not null default now(),
  primary key (media_id, width, format),
  foreign key (wedding_id, media_id) references se_vezmou.media (wedding_id, id) on delete cascade,
  constraint media_variants_key_shape check (
    storage_key = wedding_id::text || '/' || media_id::text || '/' || width::text || '.' || format)
);
create index media_variants_wedding_idx on se_vezmou.media_variants (wedding_id, media_id);

alter table se_vezmou.media_variants enable row level security;
revoke all on se_vezmou.media_variants from public, anon, authenticated, service_role;
create policy media_variants_admin_select on se_vezmou.media_variants
  for select to authenticated
  using (wedding_id = se_vezmou.wedding_id() and se_vezmou.is_wedding_admin());
grant select on se_vezmou.media_variants to authenticated;

-- ---------------------------------------------------------------------------
-- Interní: JSON jednoho média s přehledem variant (bez klíčů v úložišti; ty zná jen server)
-- ---------------------------------------------------------------------------
create function se_vezmou.media_json(m se_vezmou.media) returns jsonb
  language sql stable security definer set search_path = ''
  as $$
  select pg_catalog.jsonb_build_object(
    'id', m.id, 'kind', m.kind, 'status', m.status, 'failure_code', m.failure_code,
    'width', m.width, 'height', m.height, 'bytes', m.bytes,
    'alt', m.alt, 'decorative', m.decorative, 'created_at', m.created_at,
    'variants', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'width', v.width, 'height', v.height, 'format', v.format, 'bytes', v.bytes)
             order by v.width, v.format)
        from se_vezmou.media_variants v
       where v.media_id = m.id and v.wedding_id = m.wedding_id), '[]'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- admin_media_list: všechna média vlastní svatby (pro editor galerie)
-- ---------------------------------------------------------------------------
create function se_vezmou.admin_media_list() returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_id uuid := se_vezmou.admin_wedding();
begin
  return coalesce((
    select pg_catalog.jsonb_agg(se_vezmou.media_json(m) order by m.created_at, m.id)
      from se_vezmou.media m where m.wedding_id = v_id), '[]'::jsonb);
end
$$;

-- admin_media_get: jedno médium vlastní svatby (nebo null)
create function se_vezmou.admin_media_get(p_media_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_id uuid := se_vezmou.admin_wedding();
begin
  return (select se_vezmou.media_json(m) from se_vezmou.media m
           where m.id = p_media_id and m.wedding_id = v_id);
end
$$;

-- ---------------------------------------------------------------------------
-- admin_media_request: založí médium čekající na nahrání (kvóta se kontroluje atomicky, svatba je zamčená).
-- Limity jsou výchozí návrh k potvrzení (OQ-25), čtou se z app_settings: media_max_photos (12) a
-- media_max_bytes (40 MB). Zapomenutá nahrávání (pending nebo processing starší než den) se označí jako
-- failed (`expired`) a jejich identifikátory se vrátí, aby aplikace smazala případné soubory.
-- ---------------------------------------------------------------------------
create function se_vezmou.admin_media_request(p_kind text, p_mime text, p_bytes bigint) returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_id uuid := se_vezmou.admin_wedding();
  x se_vezmou.weddings;
  v_new uuid := pg_catalog.gen_random_uuid();
  v_stale uuid[];
  v_max_photos integer := se_vezmou.setting_int('media_max_photos', 12);
  v_max_bytes bigint := se_vezmou.setting_int('media_max_bytes', 41943040);
begin
  -- zámek svatby: souběžná nahrávání nepřekročí kvótu
  select * into x from se_vezmou.weddings t where t.id = v_id for update;
  if x.status not in ('draft', 'pending_payment', 'published') then
    raise exception 'site_not_editable' using errcode = '55000';
  end if;
  if p_kind is null or p_kind not in ('photo', 'card')
     or p_mime is null or p_mime not in ('image/jpeg', 'image/png', 'image/webp') then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  if p_bytes is null or p_bytes < 1 or p_bytes > v_max_bytes then
    raise exception 'media_too_large' using errcode = '22023';
  end if;

  with stale as (
    update se_vezmou.media m
       set status = 'failed', failure_code = 'expired', processing_started_at = null
     where m.wedding_id = v_id and m.status in ('pending', 'processing')
       and coalesce(m.processing_started_at, m.created_at) < pg_catalog.clock_timestamp() - interval '1 day'
    returning m.id)
  select coalesce(pg_catalog.array_agg(s.id), '{}') into v_stale from stale s;

  if p_kind = 'photo' and (
       select pg_catalog.count(*) from se_vezmou.media m
        where m.wedding_id = v_id and m.kind = 'photo' and m.status in ('pending', 'processing', 'ready')
     ) >= v_max_photos then
    raise exception 'media_quota' using errcode = '54000';
  end if;
  if p_kind = 'card' and (
       select pg_catalog.count(*) from se_vezmou.media m
        where m.wedding_id = v_id and m.kind = 'card' and m.status in ('pending', 'processing', 'ready')
     ) >= 3 then
    raise exception 'media_quota' using errcode = '54000';
  end if;

  insert into se_vezmou.media (id, wedding_id, kind, status, storage_path, mime, bytes, decorative)
  values (v_new, v_id, p_kind, 'pending', 'incoming/' || v_id::text || '/' || v_new::text,
          p_mime, p_bytes, p_kind = 'card');
  perform se_vezmou.write_audit('admin', se_vezmou.actor_id(), v_id, 'media.requested', 'media', v_new,
    null, pg_catalog.jsonb_build_object('kind', p_kind, 'bytes', p_bytes));
  return pg_catalog.jsonb_build_object('id', v_new, 'stale', pg_catalog.to_jsonb(v_stale));
end
$$;

-- ---------------------------------------------------------------------------
-- admin_media_begin: začátek zpracování (jen z pending; zaseknuté zpracování starší než 2 minuty se převezme)
-- ---------------------------------------------------------------------------
create function se_vezmou.admin_media_begin(p_media_id uuid) returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_id uuid := se_vezmou.admin_wedding();
  m se_vezmou.media;
begin
  select * into m from se_vezmou.media t where t.id = p_media_id and t.wedding_id = v_id for update;
  if not found then
    raise exception 'media_not_found' using errcode = 'P0002';
  end if;
  if m.status = 'processing'
     and m.processing_started_at > pg_catalog.clock_timestamp() - interval '2 minutes' then
    raise exception 'media_busy' using errcode = '55000';
  end if;
  if m.status not in ('pending', 'processing') then
    raise exception 'media_not_pending' using errcode = '55000';
  end if;
  update se_vezmou.media t
     set status = 'processing', processing_started_at = pg_catalog.clock_timestamp(), failure_code = null
   where t.id = m.id;
  return pg_catalog.jsonb_build_object('id', m.id, 'kind', m.kind, 'mime', m.mime, 'bytes', m.bytes);
end
$$;

-- ---------------------------------------------------------------------------
-- admin_media_complete: zpracování dokončeno. p_variants: [{width, height, format, bytes, key}], klíč musí být
-- přesně {wedding_id}/{media_id}/{width}.{format} (kontrola i v tabulce), povinně aspoň varianta WebP.
-- ---------------------------------------------------------------------------
create function se_vezmou.admin_media_complete(
  p_media_id uuid, p_width integer, p_height integer, p_variants jsonb
) returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_id uuid := se_vezmou.admin_wedding();
  m se_vezmou.media;
  v_total bigint;
begin
  select * into m from se_vezmou.media t where t.id = p_media_id and t.wedding_id = v_id for update;
  if not found then
    raise exception 'media_not_found' using errcode = 'P0002';
  end if;
  if m.status <> 'processing' then
    raise exception 'media_not_processing' using errcode = '55000';
  end if;
  if p_width is null or p_width < 1 or p_height is null or p_height < 1
     or p_variants is null or pg_catalog.jsonb_typeof(p_variants) <> 'array'
     or pg_catalog.jsonb_array_length(p_variants) not between 1 and 8 then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;

  insert into se_vezmou.media_variants (wedding_id, media_id, width, height, format, bytes, storage_key)
  select v_id, m.id, r.width, r.height, r.format, r.bytes, r.key
    from pg_catalog.jsonb_to_recordset(p_variants)
         as r (width integer, height integer, format text, bytes bigint, key text);
  if not exists (select 1 from se_vezmou.media_variants v
                  where v.media_id = m.id and v.wedding_id = v_id and v.format = 'webp') then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  select pg_catalog.sum(v.bytes) into v_total from se_vezmou.media_variants v
   where v.media_id = m.id and v.wedding_id = v_id;

  update se_vezmou.media t
     set status = 'ready', failure_code = null, processing_started_at = null,
         width = p_width, height = p_height, bytes = v_total, mime = 'image/webp',
         storage_path = v_id::text || '/' || m.id::text || '/'
   where t.id = m.id;
  perform se_vezmou.write_audit('admin', se_vezmou.actor_id(), v_id, 'media.processed', 'media', m.id,
    null, pg_catalog.jsonb_build_object('kind', m.kind, 'variants', pg_catalog.jsonb_array_length(p_variants)));
  return (select se_vezmou.media_json(t) from se_vezmou.media t where t.id = m.id);
end
$$;

-- admin_media_fail: zpracování selhalo (kód je jen identifikátor chyby, žádný text ze souboru)
create function se_vezmou.admin_media_fail(p_media_id uuid, p_code text) returns void
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_id uuid := se_vezmou.admin_wedding();
  v_n integer;
begin
  if p_code is null or p_code !~ '^[a-z_]{3,40}$' then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  update se_vezmou.media t
     set status = 'failed', failure_code = p_code, processing_started_at = null
   where t.id = p_media_id and t.wedding_id = v_id and t.status in ('pending', 'processing');
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'media_not_found' using errcode = 'P0002';
  end if;
  -- varianty nedokončeného zpracování (pro jistotu) mizí s řádkem při smazání, tady žádné nejsou
  perform se_vezmou.write_audit('admin', se_vezmou.actor_id(), v_id, 'media.failed', 'media', p_media_id,
    null, pg_catalog.jsonb_build_object('code', p_code));
end
$$;

-- ---------------------------------------------------------------------------
-- admin_media_update: popisek po jazycích a příznak dekorativní (obrázek karty se nemění)
-- ---------------------------------------------------------------------------
create function se_vezmou.admin_media_update(p_media_id uuid, p_alt jsonb, p_decorative boolean)
  returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_id uuid := se_vezmou.admin_wedding();
  m se_vezmou.media;
  v_alt jsonb;
begin
  select * into m from se_vezmou.media t where t.id = p_media_id and t.wedding_id = v_id for update;
  if not found then
    raise exception 'media_not_found' using errcode = 'P0002';
  end if;
  if m.kind <> 'photo' or m.status <> 'ready' then
    raise exception 'media_not_editable' using errcode = '55000';
  end if;
  if p_alt is not null and (
       pg_catalog.jsonb_typeof(p_alt) <> 'object'
       or (p_alt - array['cs', 'en']) <> '{}'::jsonb
       or exists (select 1 from pg_catalog.jsonb_each(p_alt) kv
                   where pg_catalog.jsonb_typeof(kv.value) <> 'string'
                      or pg_catalog.char_length(kv.value #>> '{}') > 300)) then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  -- prázdné jazyky se neukládají; bez jediného popisku je alt null
  select pg_catalog.jsonb_object_agg(kv.key, pg_catalog.to_jsonb(pg_catalog.btrim(kv.value #>> '{}')))
    into v_alt
    from pg_catalog.jsonb_each(coalesce(p_alt, '{}'::jsonb)) kv
   where pg_catalog.btrim(kv.value #>> '{}') <> '';
  update se_vezmou.media t
     set alt = v_alt::se_vezmou.i18n_text, decorative = coalesce(p_decorative, false)
   where t.id = m.id;
  return (select se_vezmou.media_json(t) from se_vezmou.media t where t.id = m.id);
end
$$;

-- ---------------------------------------------------------------------------
-- admin_media_delete: smaže řádek (varianty kaskádou). Soubory v úložišti maže aplikace PŘED voláním
-- (selhání mazání souborů řádek nesmaže, takže jde zopakovat).
-- ---------------------------------------------------------------------------
create function se_vezmou.admin_media_delete(p_media_id uuid) returns void
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_id uuid := se_vezmou.admin_wedding();
  v_kind text;
begin
  delete from se_vezmou.media t where t.id = p_media_id and t.wedding_id = v_id returning t.kind into v_kind;
  if not found then
    raise exception 'media_not_found' using errcode = 'P0002';
  end if;
  perform se_vezmou.write_audit('admin', se_vezmou.actor_id(), v_id, 'media.deleted', 'media', p_media_id,
    null, pg_catalog.jsonb_build_object('kind', v_kind));
end
$$;

-- ---------------------------------------------------------------------------
-- admin_media_export: největší varianta každé fotografie (export před vypršením webu, FR-LC-2);
-- při stejné šířce má WebP přednost před AVIF (širší podpora)
-- ---------------------------------------------------------------------------
create function se_vezmou.admin_media_export() returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_id uuid := se_vezmou.admin_wedding();
begin
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'media_id', b.media_id, 'width', b.width, 'height', b.height, 'format', b.format,
             'bytes', b.bytes, 'key', b.storage_key, 'alt', b.alt, 'decorative', b.decorative)
           order by b.created_at, b.media_id)
      from (
        select distinct on (v.media_id) v.media_id, v.width, v.height, v.format, v.bytes, v.storage_key,
               m.alt, m.decorative, m.created_at
          from se_vezmou.media_variants v
          join se_vezmou.media m on m.id = v.media_id and m.wedding_id = v.wedding_id
         where v.wedding_id = v_id and m.kind = 'photo' and m.status = 'ready'
         order by v.media_id, v.width desc, (v.format = 'webp') desc
      ) b), '[]'::jsonb);
end
$$;

-- admin_media_variant: klíč varianty pro náhled v rozhraní správy (i nezveřejněné fotografie vlastní svatby)
create function se_vezmou.admin_media_variant(p_media_id uuid, p_width integer, p_format text)
  returns text
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_id uuid := se_vezmou.admin_wedding();
begin
  return (select v.storage_key
            from se_vezmou.media_variants v
            join se_vezmou.media m on m.id = v.media_id and m.wedding_id = v.wedding_id
           where v.wedding_id = v_id and v.media_id = p_media_id and v.width = p_width
             and v.format = p_format and m.status = 'ready');
end
$$;

-- ---------------------------------------------------------------------------
-- get_public_media: klíč varianty pro doručení na webu páru (route /media/{id}/{šířka}). Volá se s claimy
-- návštěvníka nebo hosta po PINu. Vrací řádek jen když: svatba je zveřejněná a nesmazaná (po retenci je web
-- archived a vrací se nic, tedy 404), médium je hotové, varianta existuje a médium je ve ZVEŘEJNĚNÉM snímku
-- (public_content.media). Fotografie chráněné PINem hostů jsou jen v citlivé části snímku (sensitive_content.photos)
-- a vidí je jen role guest_pin. Nezveřejněná, smazaná i cizí média vrací nic.
-- ---------------------------------------------------------------------------
create function se_vezmou.get_public_media(p_media_id uuid, p_width integer, p_format text)
  returns table (storage_key text, bytes bigint)
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_wedding uuid := se_vezmou.wedding_id();
  v_role text := se_vezmou.wedding_role();
  w se_vezmou.weddings;
  v_version se_vezmou.site_versions;
  v_vars jsonb := pg_catalog.jsonb_build_object('id', p_media_id::text);
  v_allowed boolean;
begin
  if v_wedding is null or v_role is null or v_role not in ('visitor', 'guest_pin')
     or p_media_id is null or p_width is null or p_format not in ('avif', 'webp') then
    return;
  end if;
  select * into w from se_vezmou.weddings x where x.id = v_wedding and x.deleted_at is null;
  if not found or w.status <> 'published' or w.published_version_id is null then
    return;
  end if;
  select * into v_version from se_vezmou.site_versions v
   where v.id = w.published_version_id and v.wedding_id = w.id;
  if not found then
    return;
  end if;

  v_allowed := pg_catalog.jsonb_path_exists(v_version.public_content, '$.media[*] ? (@.id == $id)', v_vars);
  if not v_allowed and v_role = 'guest_pin' then
    v_allowed := exists (
      select 1 from se_vezmou.site_version_sensitive s
       where s.version_id = v_version.id and s.wedding_id = w.id
         and pg_catalog.jsonb_path_exists(s.sensitive_content, '$.photos[*] ? (@.id == $id)', v_vars));
  end if;
  if not v_allowed then
    return;
  end if;

  return query
  select var.storage_key, var.bytes
    from se_vezmou.media_variants var
    join se_vezmou.media m on m.id = var.media_id and m.wedding_id = var.wedding_id
   where var.wedding_id = w.id and var.media_id = p_media_id and var.width = p_width
     and var.format = p_format and m.status = 'ready';
end
$$;

-- public_media_ids: hotová média svatby z claimu. Web podle nich vyřadí ze snímku fotografie, které pár mezitím
-- smazal (smazání platí hned, i když nová verze ještě nebyla zveřejněna).
create function se_vezmou.public_media_ids() returns uuid[]
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_wedding uuid := se_vezmou.wedding_id();
  v_role text := se_vezmou.wedding_role();
begin
  if v_wedding is null or v_role is null or v_role not in ('visitor', 'guest_pin') then
    return '{}';
  end if;
  return coalesce((
    select pg_catalog.array_agg(m.id order by m.id)
      from se_vezmou.media m
      join se_vezmou.weddings w on w.id = m.wedding_id and w.deleted_at is null
     where m.wedding_id = v_wedding and m.status = 'ready'), '{}');
end
$$;

-- ---------------------------------------------------------------------------
-- Oprávnění
-- ---------------------------------------------------------------------------
revoke all on function se_vezmou.media_json(se_vezmou.media)
  from public, anon, authenticated, service_role;

revoke all on function
  se_vezmou.admin_media_list(),
  se_vezmou.admin_media_get(uuid),
  se_vezmou.admin_media_request(text, text, bigint),
  se_vezmou.admin_media_begin(uuid),
  se_vezmou.admin_media_complete(uuid, integer, integer, jsonb),
  se_vezmou.admin_media_fail(uuid, text),
  se_vezmou.admin_media_update(uuid, jsonb, boolean),
  se_vezmou.admin_media_delete(uuid),
  se_vezmou.admin_media_export(),
  se_vezmou.admin_media_variant(uuid, integer, text),
  se_vezmou.get_public_media(uuid, integer, text),
  se_vezmou.public_media_ids()
  from public, anon;
grant execute on function
  se_vezmou.admin_media_list(),
  se_vezmou.admin_media_get(uuid),
  se_vezmou.admin_media_request(text, text, bigint),
  se_vezmou.admin_media_begin(uuid),
  se_vezmou.admin_media_complete(uuid, integer, integer, jsonb),
  se_vezmou.admin_media_fail(uuid, text),
  se_vezmou.admin_media_update(uuid, jsonb, boolean),
  se_vezmou.admin_media_delete(uuid),
  se_vezmou.admin_media_export(),
  se_vezmou.admin_media_variant(uuid, integer, text),
  se_vezmou.get_public_media(uuid, integer, text),
  se_vezmou.public_media_ids()
  to authenticated;
