-- M3 / 3: obsah webu (stránky, bloky, místa, události, média). Zdroj: docs/data-model.md kap. 3.3.

create table public.pages (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  -- prázdný řetězec = domovská stránka; cesty se nepřekládají (kap. 8)
  path text not null default '' check (path = '' or path ~ '^[a-z0-9]([a-z0-9/-]*[a-z0-9])?$'),
  title public.i18n_text,
  position integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wedding_id, id),
  unique (wedding_id, path)
);
create index pages_wedding_idx on public.pages (wedding_id);

create table public.venues (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  name public.i18n_text not null,
  -- textová adresa vždy (FR-WEB-1), mapa je jen doplněk
  address text not null default '',
  directions public.i18n_text,
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  -- adresa soukromého místa jde do site_version_sensitive
  is_private boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wedding_id, id)
);
create index venues_wedding_idx on public.venues (wedding_id);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  page_id uuid,
  kind text not null default 'other' check (kind in ('ceremony', 'reception', 'other')),
  title public.i18n_text not null,
  description public.i18n_text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  venue_id uuid,
  -- událost je cílem pozvání a větvení RSVP (obřad a hostina zvlášť, FR-RSVP-3)
  rsvp_enabled boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wedding_id, id),
  check (ends_at is null or ends_at >= starts_at),
  foreign key (wedding_id, page_id) references public.pages (wedding_id, id)
    on delete set null (page_id),
  foreign key (wedding_id, venue_id) references public.venues (wedding_id, id)
    on delete set null (venue_id)
);
create index events_wedding_idx on public.events (wedding_id, starts_at);

create table public.content_blocks (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  page_id uuid not null,
  type text not null check (type in (
    'hero', 'program', 'venue', 'lodging', 'dresscode', 'faq', 'contact', 'story', 'gifts',
    'gallery', 'rsvp'
  )),
  enabled boolean not null default true,
  position integer not null,
  anchor text not null check (anchor ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'),
  -- blok se hostům zobrazí až po PINu (např. gifts)
  sensitive boolean not null default false,
  -- schéma podle typu je Zod schéma v src/domain/blocks; texty uvnitř jsou i18n_text
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wedding_id, id),
  -- odložená kontrola, aby šlo přehodit dva bloky v jedné transakci
  constraint content_blocks_page_position_key unique (page_id, position)
    deferrable initially deferred,
  unique (page_id, anchor),
  foreign key (wedding_id, page_id) references public.pages (wedding_id, id) on delete cascade,
  foreign key (wedding_id, updated_by) references public.wedding_admins (wedding_id, id)
    on delete set null (updated_by)
);
create index content_blocks_wedding_idx on public.content_blocks (wedding_id);

create table public.media (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  -- model drží jen metadata; zpracování a umístění souborů určuje ADR 0006
  storage_path text not null check (char_length(storage_path) > 0),
  -- SVG od uživatelů se nepřijímá (riziko skriptů, ADR 0006)
  mime text not null check (mime ~ '^image/' and mime <> 'image/svg+xml'),
  width integer check (width > 0),
  height integer check (height > 0),
  bytes bigint check (bytes > 0),
  alt public.i18n_text,
  decorative boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wedding_id, id),
  -- nedekorativní médium musí mít neprázdné alt (kontrolu všech jazyků webu dělá aplikace)
  constraint media_alt_required check (decorative or (alt is not null and alt <> '{}'::jsonb))
);
create index media_wedding_idx on public.media (wedding_id, created_at);
