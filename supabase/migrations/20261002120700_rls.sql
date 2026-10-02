-- M3 / 8: řádková izolace (RLS) a oprávnění rolí. Zdroj: docs/data-model.md kap. 5.1, 5.3, 5.4, 11.
--
-- Model:
--  * RLS je zapnuté na KAŽDÉ tabulce ve schématu se_vezmou, i na těch bez wedding_id
--    (ty nemají žádnou politiku, takže jsou nepřístupné rolím anon a authenticated).
--  * Tabulky nemají FORCE ROW LEVEL SECURITY; funkce security definer vlastní role s bypassrls
--    (na Supabase postgres).
--  * Politiky povolují jen role authenticated s claimem wedding_id a wedding_role = admin.
--    Hosté (visitor, guest_pin, preview) nemají politiky, jen právo execute na funkce.
--  * service_role má bypassrls, proto mu odebíráme i oprávnění k tabulkám (GRANT platí i pro
--    bypassrls roli): operátorská cesta vede výhradně přes funkce op_* a auth_*.

-- ---------------------------------------------------------------------------
-- 1. RLS zapnout všude (a při dalších migracích hlídá test, že nic nechybí)
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.relname
      from pg_catalog.pg_class c
     where c.relnamespace = 'se_vezmou'::regnamespace and c.relkind in ('r', 'p')
  loop
    execute format('alter table se_vezmou.%I enable row level security', r.relname);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Oprávnění: nejdřív odebrat vše (pojistka proti výchozím právům platformy)
-- ---------------------------------------------------------------------------
revoke all on all tables in schema se_vezmou from public, anon, authenticated, service_role;
revoke all on all sequences in schema se_vezmou from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Správce (admin): obecný vzor politik pro tabulky správce
--    select/insert/update/delete jen pro vlastní svatbu a jen s wedding_role = admin
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'pages', 'content_blocks', 'events', 'venues', 'media',
    'households', 'guests', 'invitations',
    'rsvp_settings', 'rsvp_questions',
    'rsvp_responses', 'rsvp_people', 'rsvp_attendance', 'rsvp_health'
  ] loop
    execute format(
      'create policy %1$I on se_vezmou.%2$I for select to authenticated
         using (wedding_id = se_vezmou.wedding_id() and se_vezmou.is_wedding_admin())',
      t || '_admin_select', t);
    execute format(
      'create policy %1$I on se_vezmou.%2$I for insert to authenticated
         with check (wedding_id = se_vezmou.wedding_id() and se_vezmou.is_wedding_admin())',
      t || '_admin_insert', t);
    execute format(
      'create policy %1$I on se_vezmou.%2$I for update to authenticated
         using (wedding_id = se_vezmou.wedding_id() and se_vezmou.is_wedding_admin())
         with check (wedding_id = se_vezmou.wedding_id() and se_vezmou.is_wedding_admin())',
      t || '_admin_update', t);
    execute format(
      'create policy %1$I on se_vezmou.%2$I for delete to authenticated
         using (wedding_id = se_vezmou.wedding_id() and se_vezmou.is_wedding_admin())',
      t || '_admin_delete', t);
    execute format('grant select, insert, update, delete on se_vezmou.%I to authenticated', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Tabulky, které správce jen čte (zápis jde přes RPC nebo je vyhrazen operátorovi)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'wedding_admins', 'orders', 'wedding_status_history',
    'site_version_sensitive', 'data_access_grants'
  ] loop
    execute format(
      'create policy %1$I on se_vezmou.%2$I for select to authenticated
         using (wedding_id = se_vezmou.wedding_id() and se_vezmou.is_wedding_admin())',
      t || '_admin_select', t);
    execute format('grant select on se_vezmou.%I to authenticated', t);
  end loop;
end
$$;

-- site_versions: čtení a vložení vlastních (zveřejnění jde přes RPC, verze se nepřepisují)
create policy site_versions_admin_select on se_vezmou.site_versions for select to authenticated
  using (wedding_id = se_vezmou.wedding_id() and se_vezmou.is_wedding_admin());
create policy site_versions_admin_insert on se_vezmou.site_versions for insert to authenticated
  with check (wedding_id = se_vezmou.wedding_id() and se_vezmou.is_wedding_admin());
grant select, insert on se_vezmou.site_versions to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Zvláštní případy
-- ---------------------------------------------------------------------------

-- weddings: správce vidí a mění jen svou svatbu, nezakládá ani nemaže (zakládá a maže RPC)
create policy weddings_admin_select on se_vezmou.weddings for select to authenticated
  using (id = se_vezmou.wedding_id() and se_vezmou.is_wedding_admin());
create policy weddings_admin_update on se_vezmou.weddings for update to authenticated
  using (id = se_vezmou.wedding_id() and se_vezmou.is_wedding_admin())
  with check (id = se_vezmou.wedding_id());
grant select on se_vezmou.weddings to authenticated;
-- sloupce status, slug, phase_override, *_purge_at, blocked_at, published_version_id,
-- preview_token_hash a další mění jen RPC:
grant update (default_locale, locales, template, palette, partner_a_name, partner_b_name,
              starts_on, ends_on, timezone, quick_notice, quick_notice_enabled,
              guest_pin_enabled) on se_vezmou.weddings to authenticated;

-- wedding_auth: správce čte nastavení přihlášení, ale nikdy hashe PINů (ověření PINu jde
-- přes funkce auth_* v M4); zápis jen přes RPC
create policy wedding_auth_admin_select on se_vezmou.wedding_auth for select to authenticated
  using (wedding_id = se_vezmou.wedding_id() and se_vezmou.is_wedding_admin());
grant select (wedding_id, login_mode, backup_email, admin_pin_locked_until,
              guest_pin_locked_until, pin_lock_level, created_at, updated_at)
  on se_vezmou.wedding_auth to authenticated;

-- audit_log: správce vidí zásahy operátora u své svatby, nic nemění
create policy audit_admin_select on se_vezmou.audit_log for select to authenticated
  using (wedding_id = se_vezmou.wedding_id() and se_vezmou.is_wedding_admin() and actor_type = 'operator');
grant select on se_vezmou.audit_log to authenticated;
-- append-only: žádný update/delete/truncate ani pro service role (a navíc spouštěč)
revoke update, delete, truncate on se_vezmou.audit_log from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Tabulky bez jakékoli politiky (RLS zapnuto, přístup jen přes funkce security definer):
--    sessions, login_challenges, rsvp_tickets, rate_limits, lockouts, operators,
--    operator_sessions, operator_backup_codes, operator_notes, email_log, waitlist,
--    app_settings, slug_registry, analytics_event
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 7. Servisní role: jen úzká sada přímých zápisů ze serveru, které nejsou tenant daty
-- ---------------------------------------------------------------------------
-- analytika: zápis jen ze serveru, bez čtení (souhrny přes funkce operátorů)
grant insert on se_vezmou.analytics_event to service_role;
-- záznam e-mailů (bez obsahu): odeslání a aktualizace stavu z webhooku SNS
grant select, insert, update on se_vezmou.email_log to service_role;
-- čekací listina (M2): zápis a odhlášení
grant select, insert, delete on se_vezmou.waitlist to service_role;
