-- M10 / 1: životní cyklus, retence a upozornění: nastavení, evidence běhů úloh a upozornění.
-- Zdroj: docs/data-model.md kap. 7 (životní cyklus), 10 (retence), 11 (audit); docs/security-privacy.md kap. 6.
--
-- Vše ve schématu se_vezmou. Tabulky nemají osobní údaje: evidence upozornění nese jen počty
-- adresátů (adresy se do databáze nikdy neukládají), běhy úloh jen počty a stavy.

-- ---------------------------------------------------------------------------
-- Nastavení (nepřepisuje hodnoty, které majitel mezitím změnil). Lhůty schvaluje právník [LHŮTY].
-- ---------------------------------------------------------------------------
insert into se_vezmou.app_settings (key, value) values
  -- kolik dní po posledním dni svatby zůstane web online (režim poděkování, FR-WEB-4); potom ho úloha
  -- životního cyklu archivuje (web přestane být veřejný, data hostů se mažou dál podle retence) [OTÁZKA]
  ('site_online_days_after_wedding', '90'),
  -- druhé, závěrečné upozornění tolik dní před smazáním nebo vypršením [LHŮTY]
  ('retention_final_notice_days_before', '1'),
  -- provozní záznamy bez osobních údajů [LHŮTY]
  ('email_log_retention_days', '180'),
  ('job_runs_retention_days', '90')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- email_log: nový typ zprávy (potvrzení o smazání); expiry_notice (upozornění před) už existuje
-- ---------------------------------------------------------------------------
alter table se_vezmou.email_log drop constraint email_log_type_check;
alter table se_vezmou.email_log add constraint email_log_type_check check (type in (
  'login_code', 'rsvp_confirmation', 'admin_changed', 'backup_login_notice', 'expiry_notice',
  'deletion_notice'
));

-- ---------------------------------------------------------------------------
-- job_runs: běhy plánovaných úloh. Slouží jako zámek proti souběhu (zapůjčení na omezenou dobu:
-- pooler v transakčním režimu nedrží zámky relace) a jako podklad pro provozní dohled (M9).
-- ---------------------------------------------------------------------------
create table se_vezmou.job_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null check (job ~ '^[a-z][a-z_]{1,39}$'),
  started_at timestamptz not null default pg_catalog.clock_timestamp(),
  finished_at timestamptz,
  -- „teď“ tohoto běhu; liší se od started_at jen v testech se simulovaným časem
  clock_at timestamptz not null default pg_catalog.clock_timestamp(),
  status text not null default 'running' check (status in ('running', 'ok', 'partial', 'failed')),
  -- jen počty podle druhů práce; nikdy identifikátory osob ani texty
  counts jsonb not null default '{}'::jsonb check (jsonb_typeof(counts) = 'object'),
  error_code text check (error_code is null or char_length(error_code) <= 100)
);
create index job_runs_job_started_idx on se_vezmou.job_runs (job, started_at desc);
create index job_runs_running_idx on se_vezmou.job_runs (job) where status = 'running';

-- ---------------------------------------------------------------------------
-- lifecycle_notices: evidence upozornění a zpráv o smazání. Jedno upozornění na událost
-- (svatba, druh události, fáze, datum události): unikátní klíč drží idempotenci i při opakovaném
-- spuštění úlohy nebo souběhu. Stav stroje: pending -> sending -> sent | skipped | failed.
-- ---------------------------------------------------------------------------
create table se_vezmou.lifecycle_notices (
  id uuid primary key default gen_random_uuid(),
  wedding_id uuid not null references se_vezmou.weddings (id) on delete cascade,
  -- site_expiry: web přestane být veřejný (archivace); health_purge, guest_purge: smazání údajů hostů
  kind text not null check (kind in ('site_expiry', 'health_purge', 'guest_purge')),
  -- first: X dní předem; final: těsně před; done: zpráva o provedeném smazání
  stage text not null check (stage in ('first', 'final', 'done')),
  -- datum události, o které zpráva je (po prodloužení lhůty vznikne nová událost a nové upozornění)
  event_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  attempts smallint not null default 0,
  locked_at timestamptz,
  sent_at timestamptz,
  -- jen počty; adresy adresátů se neukládají
  recipients smallint,
  failed_recipients smallint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wedding_id, id),
  unique (wedding_id, kind, stage, event_at),
  constraint lifecycle_notices_done_only_for_data check (stage <> 'done' or kind <> 'site_expiry')
);
create index lifecycle_notices_open_idx on se_vezmou.lifecycle_notices (status)
  where status in ('pending', 'sending', 'failed');

create trigger lifecycle_notices_touch_updated_at before update on se_vezmou.lifecycle_notices
  for each row execute function se_vezmou.touch_updated_at();

-- RLS na každé tabulce, bez politik: přístup jen funkce security definer (service role)
alter table se_vezmou.job_runs enable row level security;
alter table se_vezmou.lifecycle_notices enable row level security;
