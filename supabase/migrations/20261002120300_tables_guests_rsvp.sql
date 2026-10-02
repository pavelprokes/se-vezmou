-- M3 / 4: hosté, domácnosti, pozvání, RSVP. Zdroj: docs/data-model.md kap. 3.4 a 3.5.
-- Osobní údaje hostů: retence a mazání viz kap. 10 (funkce purge_* v migraci funkcí).

create table public.households (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  -- např. rodina Novákových, jen pro správce
  label text not null default '',
  invited_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wedding_id, id)
);
create index households_wedding_idx on public.households (wedding_id);

create table public.guests (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  -- každý host patří do domácnosti (jednotlivec = domácnost o jednom)
  household_id uuid not null,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 200),
  name_norm text generated always as (app.normalize_name(display_name)) stored,
  name_key text generated always as (app.name_key(display_name)) stored,
  is_child boolean not null default false,
  -- jen u dětí, jen pokud pár zadá
  age smallint check (age between 0 and 120),
  -- host doplněný ručně při RSVP
  is_plus_one boolean not null default false,
  source text not null default 'manual' check (source in ('import', 'manual', 'rsvp')),
  locale text check (locale in ('cs', 'en')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wedding_id, id),
  check (age is null or is_child),
  foreign key (wedding_id, household_id) references public.households (wedding_id, id)
    on delete cascade
);
create index guests_name_key_idx on public.guests (wedding_id, name_key);
create index guests_household_idx on public.guests (household_id);

create table public.invitations (
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  guest_id uuid not null,
  event_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (guest_id, event_id),
  foreign key (wedding_id, guest_id) references public.guests (wedding_id, id) on delete cascade,
  foreign key (wedding_id, event_id) references public.events (wedding_id, id) on delete cascade
);
create index invitations_wedding_idx on public.invitations (wedding_id);
create index invitations_event_idx on public.invitations (event_id);

create table public.rsvp_settings (
  wedding_id uuid primary key references public.weddings (id) on delete cascade,
  opens_at timestamptz,
  -- null = bez omezení
  closes_at timestamptz,
  allow_unlisted boolean not null default false,
  email_confirmation boolean not null default false,
  -- zapnuté vestavěné otázky jako příznaky: plus_one, children, diet, lodging, transport, song
  enabled_questions jsonb not null default '{}'::jsonb
    check (jsonb_typeof(enabled_questions) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (opens_at is null or closes_at is null or closes_at > opens_at)
);

create table public.rsvp_questions (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,62}$'),
  type text not null check (type in ('text', 'choice', 'bool')),
  label public.i18n_text not null,
  options jsonb,
  required boolean not null default false,
  event_id uuid,
  position integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wedding_id, id),
  unique (wedding_id, key),
  check (type <> 'choice' or (options is not null and jsonb_typeof(options) = 'array')),
  foreign key (wedding_id, event_id) references public.events (wedding_id, id)
    on delete set null (event_id)
);
create index rsvp_questions_wedding_idx on public.rsvp_questions (wedding_id);

-- jedna odpověď za domácnost
create table public.rsvp_responses (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  -- null jen u hosta mimo seznam (pokud pár povolí)
  household_id uuid,
  submitted_at timestamptz not null default now(),
  last_edited_at timestamptz not null default now(),
  -- odpovědi na vestavěné a vlastní otázky, bez zdravotních údajů
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object'),
  -- jen pokud host chce potvrzení e-mailem
  contact_email extensions.citext check (char_length(contact_email::text) <= 254),
  entered_by text not null default 'guest' check (entered_by in ('guest', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wedding_id, id),
  foreign key (wedding_id, household_id) references public.households (wedding_id, id)
    on delete cascade
);
-- jedna odpověď na domácnost
create unique index rsvp_responses_household_idx
  on public.rsvp_responses (wedding_id, household_id) where household_id is not null;

create table public.rsvp_people (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  response_id uuid not null,
  -- plus jedna se zapisuje jako osoba bez guest_id
  guest_id uuid,
  person_name text not null check (char_length(btrim(person_name)) between 1 and 200),
  is_plus_one boolean not null default false,
  is_child boolean not null default false,
  age smallint check (age between 0 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wedding_id, id),
  unique (response_id, guest_id),
  foreign key (wedding_id, response_id) references public.rsvp_responses (wedding_id, id)
    on delete cascade,
  foreign key (wedding_id, guest_id) references public.guests (wedding_id, id) on delete cascade
);
create index rsvp_people_wedding_idx on public.rsvp_people (wedding_id);

create table public.rsvp_attendance (
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  person_id uuid not null,
  event_id uuid not null,
  attending boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (person_id, event_id),
  foreign key (wedding_id, person_id) references public.rsvp_people (wedding_id, id)
    on delete cascade,
  foreign key (wedding_id, event_id) references public.events (wedding_id, id) on delete cascade
);
create index rsvp_attendance_event_idx on public.rsvp_attendance (wedding_id, event_id, attending);

-- Zdravotní údaje zvlášť: přísnější politika, samostatné mazání, mimo běžné exporty a pohledy.
create table public.rsvp_health (
  person_id uuid primary key,
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  diet text check (char_length(diet) <= 1000),
  allergies text check (char_length(allergies) <= 1000),
  exported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (wedding_id, person_id) references public.rsvp_people (wedding_id, id)
    on delete cascade
);
create index rsvp_health_wedding_idx on public.rsvp_health (wedding_id);

-- Krátkodobý lístek, který slepé ověření jména vydá po shodě; neprozrazuje seznam hostů.
-- Nemá sloupec id (klíčem je hash tokenu), proto bez unique (wedding_id, id).
create table public.rsvp_tickets (
  token_hash bytea primary key,
  wedding_id uuid not null references public.weddings (id) on delete cascade,
  household_id uuid not null,
  expires_at timestamptz not null,
  purpose text not null default 'edit' check (purpose in ('edit')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (wedding_id, household_id) references public.households (wedding_id, id)
    on delete cascade
);
create index rsvp_tickets_wedding_idx on public.rsvp_tickets (wedding_id);
create index rsvp_tickets_expires_idx on public.rsvp_tickets (expires_at);
