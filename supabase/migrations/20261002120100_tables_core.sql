-- M3 / 2: svatba, adresy, zakázka, správci, přihlášení, relace, verze webu.
--
-- Zdroj: docs/data-model.md kap. 3.1 až 3.3 a 4. Pravidla:
--  * každá tabulka s daty svatby má wedding_id a unique (wedding_id, id),
--  * podřízené tabulky odkazují složeným cizím klíčem (wedding_id, parent_id),
--  * RLS a oprávnění jsou v samostatné migraci (20261002120700_rls.sql),
--  * spouštěče jsou v migraci 20261002120600_triggers.sql.

-- ---------------------------------------------------------------------------
-- weddings
-- ---------------------------------------------------------------------------
create table public.weddings (
  id uuid primary key default gen_random_uuid(),
  -- null jen u konceptu, jehož rezervace vypršela; unikátnost drží i trvalá tabulka slug_registry
  slug text unique,
  status text not null default 'draft'
    check (status in ('draft', 'pending_payment', 'published', 'archived', 'deleted', 'blocked')),
  phase_override text
    check (phase_override in ('save_the_date', 'rsvp_open', 'rsvp_closed', 'wedding_day', 'thanks')),
  default_locale text not null default 'cs' check (default_locale in ('cs', 'en')),
  locales text[] not null default array['cs'],
  template text not null default 'editorial'
    check (template in ('editorial', 'eukalyptus', 'chateau', 'modern')),
  palette text not null default 'default',
  partner_a_name text not null check (char_length(btrim(partner_a_name)) between 1 and 100),
  partner_b_name text not null check (char_length(btrim(partner_b_name)) between 1 and 100),
  starts_on date,
  ends_on date,
  timezone text not null default 'Europe/Prague',
  published_version_id uuid,
  quick_notice public.i18n_text,
  quick_notice_enabled boolean not null default false,
  guest_pin_enabled boolean not null default false,
  preview_token_hash bytea,
  last_activity_at timestamptz not null default now(),
  published_at timestamptz,
  blocked_at timestamptz,
  deleted_at timestamptz,
  health_purge_at timestamptz,
  guest_purge_at timestamptz,
  purge_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint weddings_slug_format check (
    slug is null
    or (slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' and position('--' in slug) = 0)
  ),
  constraint weddings_locales_valid check (
    cardinality(locales) > 0 and locales <@ array['cs', 'en'] and default_locale = any (locales)
  ),
  constraint weddings_dates_valid check (
    (ends_on is null or starts_on is not null) and (ends_on is null or ends_on >= starts_on)
  ),
  -- zveřejněný web musí mít slug a zveřejněnou verzi
  constraint weddings_published_complete check (
    status <> 'published' or (slug is not null and published_version_id is not null)
  )
);

create index weddings_status_idx on public.weddings (status);
create index weddings_starts_on_idx on public.weddings (starts_on);
create index weddings_draft_activity_idx on public.weddings (last_activity_at) where status = 'draft';
create index weddings_health_purge_idx on public.weddings (health_purge_at) where health_purge_at is not null;
create index weddings_guest_purge_idx on public.weddings (guest_purge_at) where guest_purge_at is not null;
create index weddings_purge_idx on public.weddings (purge_at) where purge_at is not null;
-- Hledání zakázek podle jmen a adresy (FR-OPS-1)
create index weddings_names_trgm_idx on public.weddings
  using gin ((partner_a_name || ' ' || partner_b_name) extensions.gin_trgm_ops);
create index weddings_slug_trgm_idx on public.weddings using gin (slug extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- slug_registry: trvalá tabulka adres (není vázána na tenant politikami)
-- ---------------------------------------------------------------------------
create table public.slug_registry (
  slug text primary key
    check (slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' and position('--' in slug) = 0),
  state text not null check (state in ('reserved_word', 'reserved', 'active', 'retired')),
  -- u retired zůstává pro audit; FK on delete set null
  wedding_id uuid references public.weddings (id) on delete set null,
  reserved_until timestamptz,
  first_published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint slug_registry_state_shape check (
    (state = 'reserved_word' and wedding_id is null and reserved_until is null)
    or (state = 'reserved' and wedding_id is not null and reserved_until is not null)
    or (state = 'active' and wedding_id is not null and reserved_until is null
        and first_published_at is not null)
    or (state = 'retired' and reserved_until is null)
  )
);

-- jedna aktuální adresa na svatbu (rezervovaná nebo aktivní)
create unique index slug_registry_one_current_idx on public.slug_registry (wedding_id)
  where state in ('reserved', 'active');
create index slug_registry_reserved_until_idx on public.slug_registry (reserved_until)
  where state = 'reserved';

-- weddings.slug musí existovat v registru. Odložená kontrola umožní vložit svatbu a rezervaci
-- v jedné transakci v libovolném pořadí; smazání rezervace slug u svatby vynuluje.
alter table public.weddings
  add constraint weddings_slug_registry_fkey
  foreign key (slug) references public.slug_registry (slug)
  on delete set null
  deferrable initially deferred;

-- ---------------------------------------------------------------------------
-- orders, wedding_status_history
-- ---------------------------------------------------------------------------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null unique references public.weddings (id) on delete cascade,
  plan_code text not null default 'trial',
  status text not null default 'trial'
    check (status in ('trial', 'awaiting_payment', 'active', 'expired')),
  service_ends_at timestamptz,
  payment_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wedding_id, id)
);

create table public.wedding_status_history (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  from_status text,
  to_status text not null,
  actor_type text not null check (actor_type in ('admin', 'operator', 'system', 'guest')),
  actor_id uuid,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wedding_id, id)
);
create index wedding_status_history_wedding_idx
  on public.wedding_status_history (wedding_id, created_at);

-- ---------------------------------------------------------------------------
-- Správci a jejich přihlášení (kap. 3.2)
-- ---------------------------------------------------------------------------
create table public.wedding_admins (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  email extensions.citext not null check (char_length(email::text) <= 254 and email::text ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  added_by uuid,
  added_at timestamptz not null default now(),
  removed_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wedding_id, id),
  foreign key (wedding_id, added_by) references public.wedding_admins (wedding_id, id)
    on delete set null (added_by)
);
create unique index wedding_admins_active_email_idx
  on public.wedding_admins (wedding_id, email) where removed_at is null;
create index wedding_admins_email_idx on public.wedding_admins (email) where removed_at is null;
-- funkce security definer mají prázdný search_path a porovnávají e-maily přes lower(email::text)
create index wedding_admins_email_lower_idx
  on public.wedding_admins ((lower(email::text))) where removed_at is null;
create index wedding_admins_wedding_idx on public.wedding_admins (wedding_id);

create table public.wedding_auth (
  wedding_id uuid primary key references public.weddings (id) on delete cascade,
  login_mode text not null default 'email' check (login_mode in ('email', 'pin')),
  -- bez záložního e-mailu se wedding_auth nezapíše
  backup_email extensions.citext not null check (char_length(backup_email::text) <= 254),
  admin_pin_hash text,
  guest_pin_hash text,
  admin_pin_failures integer not null default 0,
  admin_pin_locked_until timestamptz,
  guest_pin_failures integer not null default 0,
  guest_pin_locked_until timestamptz,
  pin_lock_level smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wedding_auth_pin_mode check (login_mode <> 'pin' or admin_pin_hash is not null)
);

-- Bez wedding_id: přihlášení začíná e-mailem, svatby se určí až po ověření.
create table public.login_challenges (
  id uuid primary key default gen_random_uuid(),
  email_hash bytea not null,
  purpose text not null check (purpose in ('admin_login', 'admin_add_confirm', 'operator_recovery')),
  code_hash bytea not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  attempts smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index login_challenges_email_idx on public.login_challenges (email_hash, created_at desc);
create index login_challenges_expires_idx on public.login_challenges (expires_at);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  -- SHA-256 neprůhledného 32bajtového tokenu; token je jen v cookii (ADR 0002)
  token_hash bytea not null unique,
  kind text not null check (kind in ('admin', 'guest_pin')),
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  subject_id uuid,
  last_seen_at timestamptz not null default now(),
  -- délka klouzavého okna nečinnosti (odchylka od data-model.md: potřebná pro prodlužování)
  idle_seconds integer not null check (idle_seconds > 0),
  idle_expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wedding_id, id),
  foreign key (wedding_id, subject_id) references public.wedding_admins (wedding_id, id)
    on delete cascade,
  constraint sessions_subject_by_kind check (
    (kind = 'admin' and subject_id is not null) or (kind = 'guest_pin' and subject_id is null)
  )
);
create index sessions_wedding_idx on public.sessions (wedding_id);
create index sessions_absolute_expires_idx on public.sessions (absolute_expires_at);

-- ---------------------------------------------------------------------------
-- site_versions, site_version_sensitive (kap. 3.3)
-- ---------------------------------------------------------------------------
create table public.site_versions (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  version_no integer not null check (version_no > 0),
  kind text not null check (kind in ('publish', 'checkpoint')),
  public_content jsonb not null check (jsonb_typeof(public_content) = 'object'),
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wedding_id, id),
  unique (wedding_id, version_no),
  foreign key (wedding_id, created_by) references public.wedding_admins (wedding_id, id)
    on delete set null (created_by)
);
create index site_versions_wedding_idx on public.site_versions (wedding_id, created_at);

create table public.site_version_sensitive (
  version_id uuid primary key,
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  sensitive_content jsonb not null default '{}'::jsonb
    check (jsonb_typeof(sensitive_content) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (wedding_id, version_id) references public.site_versions (wedding_id, id)
    on delete cascade
);
create index site_version_sensitive_wedding_idx on public.site_version_sensitive (wedding_id);

-- zveřejněná verze: složený FK, svatba nikdy neukazuje na verzi jiné svatby
alter table public.weddings
  add constraint weddings_published_version_fkey
  foreign key (id, published_version_id) references public.site_versions (wedding_id, id);
