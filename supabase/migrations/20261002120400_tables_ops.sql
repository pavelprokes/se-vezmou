-- M3 / 5: operátoři, audit, e-maily, čekací listina, omezení počtu požadavků, nastavení, analytika.
-- Zdroj: docs/data-model.md kap. 3.6 až 3.10, docs/adr/0010-rate-limiting.md.

-- `auth_user_id` je identita operátora u poskytovatele přihlášení (UUID uživatele Supabase Auth).
-- Záměrně BEZ cizího klíče na auth.users: sdílený projekt, migrace nesmí měnit nic mimo schéma
-- se_vezmou (cizí klíč by přidal spouštěče do auth.users a ovlivnil mazání cizích uživatelů).
-- Vazbu hlídá aplikace při zakládání operátora (ADR 0008, ADR 0011).
create table se_vezmou.operators (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique,
  email extensions.citext not null unique,
  role text not null check (role in ('owner', 'support')),
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Relace aplikace: stejná struktura jako sessions plus operátor a čas ověření druhého faktoru.
-- Nečinnost 30 minut, absolutně 8 hodin (ADR 0002, ADR 0008); délky určuje aplikace.
create table se_vezmou.operator_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique,
  operator_id uuid not null references se_vezmou.operators (id) on delete cascade,
  aal2_verified_at timestamptz,
  last_seen_at timestamptz not null default now(),
  idle_seconds integer not null check (idle_seconds > 0),
  idle_expires_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index operator_sessions_absolute_expires_idx on se_vezmou.operator_sessions (absolute_expires_at);
create index operator_sessions_operator_idx on se_vezmou.operator_sessions (operator_id);

create table se_vezmou.operator_backup_codes (
  operator_id uuid not null references se_vezmou.operators (id) on delete cascade,
  code_hash bytea not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (operator_id, code_hash)
);

-- Bez aktivního záznamu nevrátí operátorská funkce žádná jména ani dietní údaje.
create table se_vezmou.data_access_grants (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references se_vezmou.weddings (id) on delete cascade,
  granted_by_admin_id uuid not null,
  reason text not null check (char_length(btrim(reason)) > 0),
  scope text not null default 'guest_data' check (scope in ('guest_data')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wedding_id, id),
  check (expires_at > created_at),
  foreign key (wedding_id, granted_by_admin_id) references se_vezmou.wedding_admins (wedding_id, id)
);
create index data_access_grants_wedding_idx on se_vezmou.data_access_grants (wedding_id, expires_at);

-- Poznámky bez osobních údajů hostů.
create table se_vezmou.operator_notes (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references se_vezmou.weddings (id) on delete cascade,
  operator_id uuid not null references se_vezmou.operators (id),
  body text not null check (char_length(btrim(body)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wedding_id, id)
);
create index operator_notes_wedding_idx on se_vezmou.operator_notes (wedding_id, created_at);

-- Audit: append-only (spouštěče a oprávnění v dalších migracích). wedding_id bez cizího klíče,
-- záznam přežije smazání svatby. Bez updated_at (nemění se).
create table se_vezmou.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_type text not null check (actor_type in ('admin', 'operator', 'system', 'guest')),
  actor_id uuid,
  wedding_id uuid,
  action text not null check (char_length(action) > 0),
  target_type text,
  target_id uuid,
  -- povinný u nahlédnutí do údajů hostů
  reason text,
  -- jen identifikátory, počty a stavy; žádná jména, e-maily ani texty hostů
  meta jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object'),
  request_id text,
  constraint audit_log_guest_data_reason check (
    action not like 'guest_data.%' or char_length(btrim(coalesce(reason, ''))) > 0
  )
);
create index audit_log_wedding_idx on se_vezmou.audit_log (wedding_id, at desc);
create index audit_log_actor_idx on se_vezmou.audit_log (actor_id, at desc);

-- Bez obsahu a bez celé adresy příjemce.
create table se_vezmou.email_log (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid references se_vezmou.weddings (id) on delete set null,
  type text not null check (type in (
    'login_code', 'rsvp_confirmation', 'admin_changed', 'backup_login_notice', 'expiry_notice'
  )),
  locale text check (locale in ('cs', 'en')),
  recipient_hash bytea not null,
  recipient_domain text,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'delivered', 'bounced', 'complained', 'failed')),
  provider_message_id text,
  error_code text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index email_log_wedding_idx on se_vezmou.email_log (wedding_id, created_at desc);

create table se_vezmou.waitlist (
  id uuid primary key default gen_random_uuid(),
  email extensions.citext not null unique check (char_length(email::text) <= 254),
  locale text check (locale in ('cs', 'en')),
  consent_at timestamptz not null,
  consent_text_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Omezení počtu požadavků (ADR 0010). Čítače nepřežijí pád databáze, což je u nich přijatelné.
-- bucket_key je HMAC se scope a hodnotou (v databázi nejsou surové IP ani e-maily).
create unlogged table se_vezmou.rate_limits (
  bucket_key text not null check (char_length(bucket_key) between 1 and 200),
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket_key, window_start)
);
create index rate_limits_window_idx on se_vezmou.rate_limits (window_start);

-- Postupné prodlužování pauzy po chybných PINech a kódech (logika v M4).
create table se_vezmou.lockouts (
  bucket_key text primary key check (char_length(bucket_key) between 1 and 200),
  level smallint not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Hodnoty, které majitel mění bez nasazení. Čtení pro aplikaci přes funkci, zápis jen op_*.
create table se_vezmou.app_settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  value jsonb not null,
  updated_by uuid references se_vezmou.operators (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Bez wedding_id, jména, e-mailu, IP a user agenta (ADR 0007). Zápis jen ze serveru.
create table se_vezmou.analytics_event (
  id bigint generated always as identity primary key,
  event text not null
    check (event in ('wizard_started', 'wizard_step_completed', 'site_published', 'rsvp_completed')),
  locale text check (locale in ('cs', 'en')),
  template text check (template in ('editorial', 'eukalyptus', 'chateau', 'modern')),
  step smallint check (step between 1 and 50),
  created_at timestamptz not null default now()
);
create index analytics_event_created_idx on se_vezmou.analytics_event (created_at);
