-- M3 / 6: výchozí hodnoty (app_settings) a rezervovaná slova (slug_registry).
-- Idempotentní: opakované spuštění nepřepíše hodnoty, které majitel mezitím změnil.

insert into public.app_settings (key, value) values
  -- počet správců na svatbu; tvrdý strop 5 je ve spouštěči (kap. 3.2), ne v konfiguraci
  ('max_admins', '3'),
  -- rezervace adresy konceptu od last_activity_at (OQ-06)
  ('slug_reservation_days', '30'),
  -- počet uchovávaných verzí webu; hodnotu určuje implementace (kap. 3.3)
  ('versions_keep', '20'),
  -- retence (kap. 10); lhůty schvaluje právník [LHŮTY]
  ('health_retention_days_after_wedding', '30'),
  ('guest_retention_months_after_wedding', '12'),
  -- [OTÁZKA] kolik dní předem upozornit na mazání: zástupná hodnota ke schválení
  ('retention_notice_days_before', '14'),
  -- [LHŮTY] ochranná lhůta před tvrdým smazáním webu: zástupná hodnota ke schválení
  ('deleted_site_restore_days', '30'),
  -- analytické události se mažou po 24 měsících [LHŮTY]
  ('analytics_retention_months', '24'),
  -- jak často se nejvýše zapisuje last_activity_at a last_seen_at relace (ne při každém úhozu)
  ('activity_touch_minutes', '5'),
  ('session_touch_minutes', '5'),
  -- práh podobnosti jmen ve slepém RSVP; ladí se na testovacích datech (kap. 5.5)
  ('rsvp_match_threshold', '0.7')
on conflict (key) do nothing;

-- Rezervovaná slova (security-privacy.md kap. 9, OQ-37). Slovo ze seznamu nelze zaregistrovat
-- jako adresa webu. Řádek se nikdy nemaže (viz spouštěč v migraci spouštěčů).
-- TODO (M5, majitel): doplnit seznam vulgarismů a podobností s cizími značkami a bankami;
-- mechanismus je hotový, stačí vložit řádky se state = 'reserved_word'.
insert into public.slug_registry (slug, state) values
  ('www', 'reserved_word'), ('app', 'reserved_word'), ('admin', 'reserved_word'),
  ('api', 'reserved_word'), ('mail', 'reserved_word'), ('podpora', 'reserved_word'),
  ('status', 'reserved_word'), ('static', 'reserved_word'), ('cdn', 'reserved_word'),
  -- kvůli e-mailové doméně (security-privacy.md, [OTÁZKA])
  ('ns1', 'reserved_word'), ('ns2', 'reserved_word'), ('smtp', 'reserved_word'),
  ('bounce', 'reserved_word'), ('imap', 'reserved_word'), ('pop', 'reserved_word'),
  ('mx', 'reserved_word'), ('webmail', 'reserved_word'), ('autodiscover', 'reserved_word'),
  ('autoconfig', 'reserved_word'), ('ftp', 'reserved_word'),
  -- prostředí a značka
  ('staging', 'reserved_word'), ('pre-prod', 'reserved_word'), ('preview', 'reserved_word'),
  ('dev', 'reserved_word'), ('test', 'reserved_word'), ('se-vezmou', 'reserved_word'),
  ('sevezmou', 'reserved_word'), ('vezmou', 'reserved_word'),
  -- obvyklé provozní názvy
  ('login', 'reserved_word'), ('support', 'reserved_word'), ('help', 'reserved_word'),
  ('docs', 'reserved_word'), ('blog', 'reserved_word'), ('en', 'reserved_word'),
  ('cs', 'reserved_word')
on conflict (slug) do nothing;
