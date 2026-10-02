-- M9: provozní administrace: čtení, zásahy, role (support vs owner), audit v téže transakci, izolace od údajů hostů.
begin;
select tap.seed();

-- Práva: op_* a správa operátorů jen pro service_role
do $$
declare
  v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'se_vezmou'::regnamespace and p.proname like 'op\_%'
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')
          or not has_function_privilege('service_role', p.oid, 'execute'));
  perform tap.ok(v_bad is null, 'op_* spouští jen service_role (porušuje: ' || coalesce(v_bad, '-') || ')');

  perform tap.become('authenticated', tap.wa(), 'admin');
  perform tap.throws(format('select * from se_vezmou.op_list_weddings(%L)', tap.u('operator:owner')), '42501',
    'správce nespustí op_list_weddings');
  perform tap.throws(format('select se_vezmou.op_get_wedding(%L, %L)', tap.u('operator:owner'), tap.wa()), '42501',
    'správce nespustí op_get_wedding');
  perform tap.reset();
end
$$;

-- Každá op_* funkce odmítne neexistujícího i zakázaného operátora
do $$
declare
  v_ops uuid[] := array[tap.u('operator:disabled'), gen_random_uuid()];
  v_op uuid;
begin
  set local role service_role;
  foreach v_op in array v_ops loop
    perform tap.throws(format('select * from se_vezmou.op_list_weddings(%L)', v_op), '42501', 'op_list_weddings odmítne nepovoleného operátora');
    perform tap.throws(format('select se_vezmou.op_get_wedding(%L, %L)', v_op, tap.wa()), '42501', 'op_get_wedding odmítne nepovoleného operátora');
    perform tap.throws(format('select se_vezmou.op_add_note(%L, %L, ''x'')', v_op, tap.wa()), '42501', 'op_add_note odmítne nepovoleného operátora');
    perform tap.throws(format('select se_vezmou.op_overview(%L)', v_op), '42501', 'op_overview odmítne nepovoleného operátora');
    perform tap.throws(format('select * from se_vezmou.op_analytics_summary(%L)', v_op), '42501', 'op_analytics_summary odmítne nepovoleného operátora');
    perform tap.throws(format('select * from se_vezmou.op_list_retention(%L)', v_op), '42501', 'op_list_retention odmítne nepovoleného operátora');
    perform tap.throws(format('select * from se_vezmou.op_list_audit(%L)', v_op), '42501', 'op_list_audit odmítne nepovoleného operátora');
    perform tap.throws(format('select se_vezmou.op_change_slug(%L, %L, ''nova-adresa'', ''x'')', v_op, tap.wa()), '42501', 'op_change_slug odmítne nepovoleného operátora');
    perform tap.throws(format('select se_vezmou.op_restore_wedding(%L, %L, ''x'')', v_op, tap.wa()), '42501', 'op_restore_wedding odmítne nepovoleného operátora');
  end loop;
  perform tap.reset();
end
$$;

-- Seznam zakázek: filtry, hledání, stránkování; podpora i majitel
do $$
declare
  v_support uuid := tap.u('operator:support');
  v_owner uuid := tap.u('operator:owner');
begin
  -- příprava: třetí svatba (koncept, angličtina, jiná šablona, jiný měsíc)
  insert into se_vezmou.weddings (id, partner_a_name, partner_b_name, starts_on, default_locale, locales, template)
  values (tap.u('C:wedding'), 'Žofie', 'Řehoř', date '2030-05-15', 'en', array['en', 'cs'], 'modern');
  insert into se_vezmou.wedding_admins (id, wedding_id, email) values (tap.u('C:admin'), tap.u('C:wedding'), 'zofie.rehor@example.test');
  update se_vezmou.weddings set starts_on = date '2030-05-15' where id = tap.wa();
  update se_vezmou.weddings set starts_on = date '2030-05-20' where id = tap.wb();

  set local role service_role;
  perform tap.eq((select count(*) from se_vezmou.op_list_weddings(v_support)), 3, 'podpora vidí všechny zakázky');
  perform tap.eq((select max(total_count) from se_vezmou.op_list_weddings(v_owner)), 3, 'total_count je celkový počet');
  perform tap.eq((select count(*) from se_vezmou.op_list_weddings(v_support, p_status => 'draft')), 1, 'filtr stavu: koncept');
  perform tap.eq((select count(*) from se_vezmou.op_list_weddings(v_support, p_status => 'published')), 2, 'filtr stavu: zveřejněno');
  perform tap.eq((select count(*) from se_vezmou.op_list_weddings(v_support, p_status => 'blocked')), 0, 'filtr stavu: zablokováno');
  perform tap.eq((select count(*) from se_vezmou.op_list_weddings(v_support, p_locale => 'en')), 1, 'filtr jazyka en');
  perform tap.eq((select count(*) from se_vezmou.op_list_weddings(v_support, p_locale => 'cs')), 3, 'filtr jazyka cs (i vícejazyčná)');
  perform tap.eq((select count(*) from se_vezmou.op_list_weddings(v_support, p_template => 'modern')), 1, 'filtr šablony');
  perform tap.eq((select count(*) from se_vezmou.op_list_weddings(v_support, p_month => date '2030-05-01')), 3, 'filtr měsíce svatby (květen 2030)');
  perform tap.eq((select count(*) from se_vezmou.op_list_weddings(v_support, p_month => date '2030-06-10')), 0, 'filtr měsíce svatby (červen 2030)');
  perform tap.eq((select count(*) from se_vezmou.op_list_weddings(v_support, p_status => 'published', p_template => 'editorial')), 2, 'filtry se kombinují');

  -- hledání: jména (bez diakritiky, více slov, pořadí), adresa, e-mail správce
  perform tap.eq((select count(*) from se_vezmou.op_list_weddings(v_support, p_query => 'klara')), 1, 'hledání jména bez diakritiky');
  perform tap.eq((select count(*) from se_vezmou.op_list_weddings(v_support, p_query => 'Klára Matěj')), 1, 'hledání dvou jmen');
  perform tap.eq((select count(*) from se_vezmou.op_list_weddings(v_support, p_query => 'matej klara')), 1, 'pořadí slov nevadí');
  perform tap.eq((select count(*) from se_vezmou.op_list_weddings(v_support, p_query => 'zofie rehor')), 1, 'hledání Ž a Ř bez diakritiky');
  perform tap.eq((select count(*) from se_vezmou.op_list_weddings(v_support, p_query => 'druha-svatba')), 1, 'hledání podle adresy');
  perform tap.eq((select count(*) from se_vezmou.op_list_weddings(v_support, p_query => 'druha')), 1, 'hledání části adresy');
  perform tap.eq((select count(*) from se_vezmou.op_list_weddings(v_support, p_query => 'a-spravce@example.test')), 1, 'hledání e-mailu správce');
  perform tap.eq((select count(*) from se_vezmou.op_list_weddings(v_support, p_query => 'ZOFIE.REHOR@')), 1, 'e-mail bez ohledu na velikost písmen');
  perform tap.eq((select count(*) from se_vezmou.op_list_weddings(v_support, p_query => '%')), 0, 'zástupný znak % se hledá doslova');
  perform tap.eq((select count(*) from se_vezmou.op_list_weddings(v_support, p_query => 'x@_')), 0, 'zástupný znak _ v e-mailu se hledá doslova');
  perform tap.eq((select count(*) from se_vezmou.op_list_weddings(v_support, p_query => 'neexistuje')), 0, 'nic nenalezeno');

  -- hledání nesmí prozradit údaje hostů (jména hostů ani domácností)
  perform tap.eq((select count(*) from se_vezmou.op_list_weddings(v_support, p_query => 'Novák')), 0, 'jméno hosta se nenajde');
  perform tap.eq((select count(*) from se_vezmou.op_list_weddings(v_support, p_query => 'Jan Novák')), 0, 'celé jméno hosta se nenajde');
  perform tap.eq((select count(*) from se_vezmou.op_list_weddings(v_support, p_query => 'Svobodová')), 0, 'jméno hosta druhé svatby se nenajde');
  perform tap.eq((select count(*) from se_vezmou.op_list_weddings(v_support, p_query => 'Rodina A')), 0, 'popisek domácnosti se nenajde');

  -- stránkování
  perform tap.eq((select count(*) from se_vezmou.op_list_weddings(v_support, p_limit => 2)), 2, 'limit 2');
  perform tap.eq((select count(*) from se_vezmou.op_list_weddings(v_support, p_limit => 2, p_offset => 2)), 1, 'druhá strana');
  perform tap.eq((select min(total_count) from se_vezmou.op_list_weddings(v_support, p_limit => 2)), 3, 'total_count nezávisí na stránce');
  perform tap.eq((select count(*) from se_vezmou.op_list_weddings(v_support, p_limit => 0)), 1, 'limit 0 se zvedne na 1');
  perform tap.eq((select count(*) from se_vezmou.op_list_weddings(v_support, p_limit => 100000)), 3, 'limit má strop');

  -- neplatné filtry
  perform tap.throws(format('select * from se_vezmou.op_list_weddings(%L, p_status => ''nic'')', v_support), '22023', 'neznámý stav');
  perform tap.throws(format('select * from se_vezmou.op_list_weddings(%L, p_locale => ''de'')', v_support), '22023', 'neznámý jazyk');
  perform tap.throws(format('select * from se_vezmou.op_list_weddings(%L, p_template => ''x'')', v_support), '22023', 'neznámá šablona');
  perform tap.reset();
end
$$;

-- Detail zakázky: údaje páru, správci, historie, poznámky, agregáty; žádná jména ani odpovědi hostů
do $$
declare
  v_detail jsonb;
begin
  set local role service_role;
  v_detail := se_vezmou.op_get_wedding(tap.u('operator:support'), tap.wa());
  perform tap.reset();
  perform tap.ok(v_detail -> 'wedding' ->> 'slug' = 'klara-a-matej', 'detail: adresa');
  perform tap.ok(v_detail -> 'wedding' ->> 'partner_a_name' = 'Klára', 'detail: jména páru');
  perform tap.ok(jsonb_array_length(v_detail -> 'admins') = 1 and v_detail -> 'admins' -> 0 ->> 'email' = 'a-spravce@example.test',
    'detail: e-mail správce');
  perform tap.ok(v_detail -> 'wedding' ->> 'template' = 'editorial' and v_detail -> 'wedding' -> 'locales' = '["cs"]'::jsonb,
    'detail: šablona a jazyky');
  perform tap.ok(jsonb_array_length(v_detail -> 'history') >= 1, 'detail: historie stavů');
  perform tap.ok(jsonb_array_length(v_detail -> 'notes') = 1, 'detail: poznámky');
  perform tap.ok((v_detail -> 'counts' ->> 'guests')::int = 2 and (v_detail -> 'counts' ->> 'households')::int = 1, 'detail: počty hostů (agregáty)');
  perform tap.ok(v_detail -> 'order' ->> 'plan_code' = 'trial', 'detail: zakázka');
  perform tap.ok(v_detail -> 'slug_state' ->> 'state' = 'active', 'detail: stav adresy');
  perform tap.ok(v_detail -> 'guest_access' = 'null'::jsonb, 'detail: bez souhlasu páru není aktivní přístup k údajům hostů');
  perform tap.ok(v_detail::text not ilike '%Novák%' and v_detail::text not ilike '%Nováková%' and v_detail::text not ilike '%vegetari%'
                 and v_detail::text not ilike '%ořechy%' and v_detail::text not ilike '%Rodina A%',
    'detail neobsahuje jména ani údaje hostů');
  perform tap.ok(v_detail::text not like '%123456/0100%' and v_detail::text not ilike '%hash-admin%' and v_detail::text not ilike '%token%',
    'detail neobsahuje citlivý obsah webu ani hashe');
  set local role service_role;
  perform tap.ok(se_vezmou.op_get_wedding(tap.u('operator:support'), gen_random_uuid()) is null, 'neexistující zakázka vrátí null');
  perform tap.reset();

  -- aktivní souhlas se v detailu ukáže jen jako příznak s konci platnosti
  insert into se_vezmou.data_access_grants (wedding_id, granted_by_admin_id, reason, expires_at)
  values (tap.wa(), tap.u('A:admin'), 'Souhlas páru', now() + interval '2 days');
  set local role service_role;
  v_detail := se_vezmou.op_get_wedding(tap.u('operator:owner'), tap.wa());
  perform tap.reset();
  perform tap.ok(v_detail -> 'guest_access' ->> 'expires_at' is not null, 'detail: aktivní souhlas se ukáže jako konec platnosti');
  perform tap.ok(v_detail::text not ilike '%Novák%', 'ani s aktivním souhlasem detail jména hostů neobsahuje');
  delete from se_vezmou.data_access_grants where wedding_id = tap.wa() and revoked_at is null;
end
$$;

-- Poznámky: obě role, bez prázdné a příliš dlouhé, s auditem bez textu
do $$
declare
  v_id uuid;
begin
  set local role service_role;
  v_id := se_vezmou.op_add_note(tap.u('operator:support'), tap.wa(), '  Volala svatební koordinátorka.  ');
  perform tap.ok(v_id is not null, 'podpora přidá poznámku');
  perform tap.ok(se_vezmou.op_add_note(tap.u('operator:owner'), tap.wa(), 'Druhá poznámka') is not null, 'majitel přidá poznámku');
  perform tap.throws(format('select se_vezmou.op_add_note(%L, %L, ''   '')', tap.u('operator:owner'), tap.wa()), '22023', 'prázdná poznámka se odmítne');
  perform tap.throws(format('select se_vezmou.op_add_note(%L, %L, repeat(''x'', 2001))', tap.u('operator:owner'), tap.wa()), '22023', 'příliš dlouhá poznámka se odmítne');
  perform tap.throws(format('select se_vezmou.op_add_note(%L, %L, ''x'')', tap.u('operator:owner'), gen_random_uuid()), 'P0002', 'poznámka k neexistující zakázce');
  perform tap.reset();
  perform tap.ok((select body from se_vezmou.operator_notes where id = v_id) = 'Volala svatební koordinátorka.', 'poznámka je oříznutá o okraje');
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where action = 'wedding.note_add' and target_id = v_id
                          and actor_id = tap.u('operator:support') and wedding_id = tap.wa()), 'poznámka je v auditu');
  perform tap.ok(not exists (select 1 from se_vezmou.audit_log where meta::text ilike '%koordinátorka%'), 'audit neobsahuje text poznámky');
end
$$;

-- Role: podpora smí jen zablokovat, majitel vše; zásah bez práva nic nezmění ani nezapíše
do $$
declare
  v_support uuid := tap.u('operator:support');
  v_owner uuid := tap.u('operator:owner');
  v_audit bigint;
begin
  v_audit := (select count(*) from se_vezmou.audit_log);
  set local role service_role;
  perform tap.throws(format('select se_vezmou.op_set_wedding_status(%L, %L, ''archived'', ''x'')', v_support, tap.wa()), '42501', 'podpora nearchivuje');
  perform tap.throws(format('select se_vezmou.op_set_wedding_status(%L, %L, ''deleted'', ''x'')', v_support, tap.wa()), '42501', 'podpora nemaže');
  perform tap.throws(format('select se_vezmou.op_set_wedding_status(%L, %L, ''published'', ''x'')', v_support, tap.wa()), '42501', 'podpora nezveřejňuje');
  perform tap.throws(format('select se_vezmou.op_change_slug(%L, %L, ''nova-adresa'', ''x'')', v_support, tap.wa()), '42501', 'podpora nemění adresu');
  perform tap.throws(format('select se_vezmou.op_extend_retention(%L, %L, ''service'', current_date + 100, ''x'')', v_support, tap.wa()), '42501', 'podpora neprodlužuje');
  perform tap.throws(format('select se_vezmou.op_restore_wedding(%L, %L, ''x'')', v_support, tap.wa()), '42501', 'podpora neobnovuje');
  perform tap.throws(format('select * from se_vezmou.op_list_audit(%L)', v_support), '42501', 'podpora nečte audit');
  perform tap.throws(format('select * from se_vezmou.op_list_operators(%L)', v_support), '42501', 'podpora nevidí správu operátorů');
  perform tap.throws(format('select se_vezmou.op_create_operator(%L, ''dalsi@example.test'', ''support'')', v_support), '42501', 'podpora nezakládá operátory');
  perform tap.throws(format('select se_vezmou.op_set_operator_disabled(%L, %L, true, ''x'')', v_support, v_owner), '42501', 'podpora nezakazuje operátory');
  perform tap.throws(format('select se_vezmou.op_reset_operator_mfa(%L, %L, ''x'')', v_support, v_owner), '42501', 'podpora neobnovuje faktor');
  perform tap.throws(format('select se_vezmou.op_set_app_setting(%L, ''max_admins'', ''4'')', v_support), '42501', 'podpora nemění nastavení');
  perform tap.reset();
  perform tap.ok((select status from se_vezmou.weddings where id = tap.wa()) = 'published', 'svatba po odmítnutých zásazích beze změny');
  perform tap.ok((select slug from se_vezmou.weddings where id = tap.wa()) = 'klara-a-matej', 'adresa beze změny');
  perform tap.eq((select count(*) from se_vezmou.audit_log), v_audit, 'odmítnuté zásahy nic nezapsaly do auditu');
end
$$;

-- Zablokování a odblokování: podpora zablokuje, odblokovat smí jen majitel
do $$
declare
  v_support uuid := tap.u('operator:support');
  v_owner uuid := tap.u('operator:owner');
begin
  set local role service_role;
  perform se_vezmou.op_set_wedding_status(v_support, tap.wa(), 'blocked', 'Hlášení zneužití č. 1');
  perform tap.reset();
  perform tap.ok((select status = 'blocked' and blocked_at is not null from se_vezmou.weddings where id = tap.wa()), 'podpora zablokovala web');
  set local role service_role;
  perform tap.eq((select count(*) from se_vezmou.resolve_slug('klara-a-matej')), 0, 'zablokovaný web se nevydává');
  perform tap.throws(format('select se_vezmou.op_set_wedding_status(%L, %L, ''published'', ''Omyl'')', v_support, tap.wa()), '42501', 'podpora neodblokuje');
  perform se_vezmou.op_set_wedding_status(v_owner, tap.wa(), 'published', 'Nepodložené hlášení');
  perform tap.reset();
  perform tap.ok((select status = 'published' and blocked_at is null from se_vezmou.weddings where id = tap.wa()), 'majitel web odblokoval');
  perform tap.ok((select count(*) from se_vezmou.wedding_status_history where wedding_id = tap.wa() and actor_type = 'operator') = 2,
    'obě změny jsou v historii zakázky');
  perform tap.ok((select count(*) from se_vezmou.audit_log where wedding_id = tap.wa() and action = 'wedding.status_change'
                   and actor_type = 'operator' and reason in ('Hlášení zneužití č. 1', 'Nepodložené hlášení')) = 2,
    'obě změny jsou v auditu s důvodem');

  -- web bez zveřejněné verze nelze zveřejnit (koncept C)
  set local role service_role;
  perform tap.throws(format('select se_vezmou.op_set_wedding_status(%L, %L, ''published'', ''x'')', v_owner, tap.u('C:wedding')), '55000',
    'koncept bez zveřejněné verze nejde zveřejnit');
  perform tap.reset();
end
$$;

-- Smazání a obnova v ochranné lhůtě; po lhůtě ne; ze smazaného stavu jen přes obnovu
do $$
declare
  v_owner uuid := tap.u('operator:owner');
  v_back text;
begin
  set local role service_role;
  perform se_vezmou.op_set_wedding_status(v_owner, tap.wb(), 'deleted', 'Žádost páru o smazání');
  perform tap.reset();
  perform tap.ok((select status = 'deleted' and deleted_at is not null and purge_at is not null from se_vezmou.weddings where id = tap.wb()),
    'smazání nastaví ochrannou lhůtu');

  set local role service_role;
  perform tap.throws(format('select se_vezmou.op_set_wedding_status(%L, %L, ''published'', ''x'')', v_owner, tap.wb()), '55000',
    'ze smazaného stavu se mění jen obnovou');
  perform tap.throws(format('select se_vezmou.op_restore_wedding(%L, %L, ''   '')', v_owner, tap.wb()), '22023', 'obnova bez důvodu');
  perform tap.throws(format('select se_vezmou.op_restore_wedding(%L, %L, ''x'')', v_owner, tap.wa()), '55000', 'obnovit jde jen smazaný web');
  perform tap.throws(format('select se_vezmou.op_restore_wedding(%L, %L, ''x'')', v_owner, gen_random_uuid()), 'P0002', 'obnova neexistující zakázky');
  v_back := se_vezmou.op_restore_wedding(v_owner, tap.wb(), 'Smazáno omylem');
  perform tap.reset();
  perform tap.ok(v_back = 'published', 'web se vrátil do stavu před smazáním');
  perform tap.ok((select status = 'published' and deleted_at is null and purge_at is null from se_vezmou.weddings where id = tap.wb()),
    'obnova zrušila ochrannou lhůtu');
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where action = 'wedding.restore' and wedding_id = tap.wb()
                          and reason = 'Smazáno omylem' and meta = '{"from_status": "deleted", "to_status": "published"}'),
    'obnova je v auditu');
  perform tap.ok(exists (select 1 from se_vezmou.wedding_status_history where wedding_id = tap.wb() and from_status = 'deleted'
                          and to_status = 'published' and actor_type = 'operator'), 'obnova je v historii zakázky');

  -- po uplynutí ochranné lhůty už obnova nejde
  set local role service_role;
  perform se_vezmou.op_set_wedding_status(v_owner, tap.wb(), 'deleted', 'Podruhé');
  perform tap.reset();
  update se_vezmou.weddings set purge_at = now() - interval '1 minute' where id = tap.wb();
  set local role service_role;
  perform tap.throws(format('select se_vezmou.op_restore_wedding(%L, %L, ''Pozdě'')', v_owner, tap.wb()), '55000', 'po lhůtě obnova nejde');
  perform tap.reset();
  update se_vezmou.weddings set purge_at = now() + interval '10 days' where id = tap.wb();
  set local role service_role;
  perform se_vezmou.op_restore_wedding(v_owner, tap.wb(), 'V lhůtě');
  perform tap.reset();
end
$$;

-- Změna adresy: kontroly, registr (starý slug retired, nový active), audit
do $$
declare
  v_owner uuid := tap.u('operator:owner');
begin
  set local role service_role;
  perform tap.throws(format('select se_vezmou.op_change_slug(%L, %L, ''Neplatná adresa'', ''x'')', v_owner, tap.wa()), '22023', 'neplatný tvar adresy');
  perform tap.throws(format('select se_vezmou.op_change_slug(%L, %L, ''nova-adresa'', '' '')', v_owner, tap.wa()), '22023', 'změna adresy bez důvodu');
  perform tap.throws(format('select se_vezmou.op_change_slug(%L, %L, ''druha-svatba'', ''x'')', v_owner, tap.wa()), '23505', 'obsazená adresa se odmítne');
  perform tap.throws(format('select se_vezmou.op_change_slug(%L, %L, ''admin'', ''x'')', v_owner, tap.wa()), '23505', 'rezervované slovo se odmítne');
  perform tap.throws(format('select se_vezmou.op_change_slug(%L, %L, ''x'', ''x'')', v_owner, gen_random_uuid()), 'P0002', 'neexistující zakázka');
  perform se_vezmou.op_change_slug(v_owner, tap.wa(), 'klara-a-matej', 'Beze změny');
  perform se_vezmou.op_change_slug(v_owner, tap.wa(), 'klara-matej-2030', 'Přání páru');
  perform tap.reset();

  perform tap.ok((select slug from se_vezmou.weddings where id = tap.wa()) = 'klara-matej-2030', 'zakázka má novou adresu');
  perform tap.ok((select state = 'active' and first_published_at is not null and wedding_id = tap.wa()
                    from se_vezmou.slug_registry where slug = 'klara-matej-2030'), 'nová adresa je active (web byl zveřejněn)');
  perform tap.ok((select state = 'retired' and first_published_at is not null from se_vezmou.slug_registry where slug = 'klara-a-matej'),
    'stará zveřejněná adresa je retired');
  set local role service_role;
  perform tap.eq((select count(*) from se_vezmou.resolve_slug('klara-matej-2030')), 1, 'web je dostupný na nové adrese');
  perform tap.eq((select count(*) from se_vezmou.resolve_slug('klara-a-matej')), 0, 'stará adresa web nevydává');
  perform tap.reset();
  perform tap.ok(not se_vezmou.slug_available('klara-a-matej'), 'zveřejněná stará adresa se znovu nepřidělí');
  set local role service_role;
  perform tap.throws(format('select se_vezmou.op_change_slug(%L, %L, ''klara-a-matej'', ''Zpět'')', v_owner, tap.wb()), '23505',
    'cizí zakázka nezíská starou zveřejněnou adresu');
  perform tap.throws(format('select se_vezmou.op_change_slug(%L, %L, ''klara-a-matej'', ''Zpět'')', v_owner, tap.wa()), '23505',
    'ani táž zakázka se na starou zveřejněnou adresu nevrátí');
  perform tap.reset();
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where action = 'wedding.slug_change' and wedding_id = tap.wa() and reason = 'Přání páru'
                          and meta = '{"old_slug": "klara-a-matej", "new_slug": "klara-matej-2030"}'), 'změna adresy je v auditu');
  perform tap.eq((select count(*) from se_vezmou.audit_log where action = 'wedding.slug_change' and wedding_id = tap.wa()), 1,
    'změna na stejnou adresu audit nezapsala');

  -- koncept dostane rezervaci, ne aktivní adresu; předchozí rezervace přejde do retired a uvolní se
  insert into se_vezmou.slug_registry (slug, state, wedding_id, reserved_until)
  values ('zofie-a-rehor', 'reserved', tap.u('C:wedding'), now() + interval '30 days');
  update se_vezmou.weddings set slug = 'zofie-a-rehor' where id = tap.u('C:wedding');
  set local role service_role;
  perform se_vezmou.op_change_slug(v_owner, tap.u('C:wedding'), 'zofie-rehor', 'Oprava');
  perform tap.reset();
  perform tap.ok((select state = 'reserved' and reserved_until is not null from se_vezmou.slug_registry where slug = 'zofie-rehor'),
    'koncept dostane rezervaci');
  perform tap.ok((select state = 'retired' from se_vezmou.slug_registry where slug = 'zofie-a-rehor'), 'stará rezervace přešla do retired');
  perform tap.ok(se_vezmou.slug_available('zofie-a-rehor'), 'nezveřejněná stará adresa je volná');
end
$$;

-- Prodloužení provozu a retence: jen prodloužit, jen budoucnost, s auditem
do $$
declare
  v_owner uuid := tap.u('operator:owner');
  v_before timestamptz;
begin
  set local role service_role;
  perform tap.throws(format('select se_vezmou.op_extend_retention(%L, %L, ''x'', current_date + 100, ''x'')', v_owner, tap.wa()), '22023', 'neznámý druh lhůty');
  perform tap.throws(format('select se_vezmou.op_extend_retention(%L, %L, ''service'', current_date + 100, '' '')', v_owner, tap.wa()), '22023', 'prodloužení bez důvodu');
  perform tap.throws(format('select se_vezmou.op_extend_retention(%L, %L, ''service'', current_date - 1, ''x'')', v_owner, tap.wa()), '22023', 'datum v minulosti');
  perform se_vezmou.op_extend_retention(v_owner, tap.wa(), 'service', current_date + 365, 'Prodloužení provozu o rok');
  perform tap.throws(format('select se_vezmou.op_extend_retention(%L, %L, ''service'', current_date + 100, ''Zkrácení'')', v_owner, tap.wa()), '22023', 'provoz nejde zkrátit');
  perform tap.reset();
  perform tap.ok((select service_ends_at > now() + interval '364 days' from se_vezmou.orders where wedding_id = tap.wa()), 'konec provozu se posunul');
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where action = 'wedding.retention_extend' and wedding_id = tap.wa()
                          and meta ->> 'kind' = 'service' and reason = 'Prodloužení provozu o rok'), 'prodloužení provozu je v auditu');

  v_before := (select health_purge_at from se_vezmou.weddings where id = tap.wa());
  set local role service_role;
  perform tap.throws(format('select se_vezmou.op_extend_retention(%L, %L, ''health'', (current_date + 100), ''x'')', v_owner, tap.wa()), '22023',
    'smazání dietních údajů nejde zkrátit');
  perform se_vezmou.op_extend_retention(v_owner, tap.wa(), 'health', date '2031-01-15', 'Žádost páru');
  perform se_vezmou.op_extend_retention(v_owner, tap.wa(), 'guests', date '2032-01-15', 'Žádost páru');
  perform tap.reset();
  perform tap.ok((select health_purge_at > v_before from se_vezmou.weddings where id = tap.wa()), 'lhůta dietních údajů se prodloužila');
  perform tap.ok((select guest_purge_at > now() + interval '899 days' from se_vezmou.weddings where id = tap.wa()), 'lhůta údajů hostů se prodloužila');

  -- změna data svatby prodlouženou lhůtu nepřepíše na hodnotu odvozenou z data
  update se_vezmou.weddings set updated_at = now() where id = tap.wa();
  perform tap.ok((select guest_purge_at > now() + interval '899 days' from se_vezmou.weddings where id = tap.wa()), 'obyčejná změna lhůtu nepřepíše');
end
$$;

-- Přihlašovací odkaz správci: výzva pro e-mail správce, audit, jen aktivní správce nezablokované zakázky
do $$
declare
  v_email bytea := sha256(convert_to('a-spravce@example.test', 'UTF8'));
  v_code bytea := sha256(convert_to('424242', 'UTF8'));
  v_result text;
begin
  set local role service_role;
  v_result := se_vezmou.op_send_login_link(tap.u('operator:support'), tap.wa(), tap.u('A:admin'), v_email, v_code, 600);
  perform tap.ok(v_result = 'a-spravce@example.test', 'funkce vrátí e-mail správce pro odeslání');
  perform tap.ok(se_vezmou.auth_verify_challenge(v_email, 'admin_login', v_code), 'výzva pro správce platí jako přihlašovací kód');
  perform tap.throws(format('select se_vezmou.op_send_login_link(%L, %L, %L, %L, %L)', tap.u('operator:support'), tap.wa(), tap.u('B:admin'), v_email, v_code),
    'P0002', 'správce jiné zakázky se odmítne');
  perform tap.throws(format('select se_vezmou.op_send_login_link(%L, %L, %L, %L, %L)', tap.u('operator:disabled'), tap.wa(), tap.u('A:admin'), v_email, v_code),
    '42501', 'zakázaný operátor odkaz nepošle');
  perform tap.throws(format('select se_vezmou.op_send_login_link(%L, %L, %L, %L, %L, 99999)', tap.u('operator:owner'), tap.wa(), tap.u('A:admin'), v_email, v_code),
    '22023', 'příliš dlouhá platnost výzvy se odmítne');
  perform tap.reset();
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where action = 'wedding.login_link_sent' and wedding_id = tap.wa()
                          and target_id = tap.u('A:admin') and actor_id = tap.u('operator:support')), 'poslání odkazu je v auditu');
  perform tap.ok(not exists (select 1 from se_vezmou.audit_log where meta::text ilike '%spravce%'), 'audit neobsahuje e-mail správce');

  -- zablokovaná zakázka odkaz nedostane
  update se_vezmou.wedding_admins set removed_at = now() where id = tap.u('B:admin');
  set local role service_role;
  perform tap.throws(format('select se_vezmou.op_send_login_link(%L, %L, %L, %L, %L)', tap.u('operator:owner'), tap.wb(), tap.u('B:admin'), v_email, v_code),
    'P0002', 'odebraný správce odkaz nedostane');
  perform tap.reset();
  update se_vezmou.wedding_admins set removed_at = null where id = tap.u('B:admin');
  set local role service_role;
  perform se_vezmou.op_set_wedding_status(tap.u('operator:owner'), tap.wb(), 'blocked', 'Zneužití');
  perform tap.throws(format('select se_vezmou.op_send_login_link(%L, %L, %L, %L, %L)', tap.u('operator:owner'), tap.wb(), tap.u('B:admin'), v_email, v_code),
    '55000', 'zablokovaná zakázka odkaz nedostane');
  perform se_vezmou.op_set_wedding_status(tap.u('operator:owner'), tap.wb(), 'published', 'Odblokováno');
  perform tap.reset();
end
$$;

-- Nahlédnutí do údajů hostů: výchozí stav nevrací nic ani pro majitele; audit s důvodem
do $$
begin
  set local role service_role;
  perform tap.eq((select count(*) from se_vezmou.op_view_guest_data(tap.u('operator:owner'), tap.wa(), 'Bez souhlasu')), 0,
    'majitel bez souhlasu páru nevidí hosty');
  perform tap.eq((select count(*) from se_vezmou.op_view_guest_data(tap.u('operator:support'), tap.wa(), 'Bez souhlasu')), 0,
    'podpora bez souhlasu páru nevidí hosty');
  perform tap.reset();
  perform tap.ok((select count(*) from se_vezmou.audit_log where action = 'guest_data.view_denied' and wedding_id = tap.wa()) >= 2,
    'odmítnutá nahlédnutí jsou v auditu');
end
$$;

-- Přehled, analytika, retence, audit
do $$
declare
  v_overview jsonb;
  v_rows bigint;
begin
  insert into se_vezmou.analytics_event (event, locale, template, step) values
    ('wizard_started', 'cs', null, null), ('wizard_started', 'en', null, null),
    ('wizard_step_completed', 'cs', null, 1), ('wizard_step_completed', 'cs', null, 1), ('wizard_step_completed', 'cs', null, 2),
    ('site_published', 'cs', 'editorial', null);
  insert into se_vezmou.analytics_event (event, locale, created_at) values ('wizard_started', 'cs', now() - interval '60 days');

  set local role service_role;
  v_overview := se_vezmou.op_overview(tap.u('operator:support'));
  perform tap.ok((v_overview -> 'by_status' ->> 'published')::int = 2 and (v_overview -> 'by_status' ->> 'draft')::int = 1, 'přehled: počty podle stavu');
  perform tap.ok(jsonb_array_length(v_overview -> 'by_month') >= 1, 'přehled: svatby podle měsíců');
  perform tap.ok((v_overview -> 'by_template' ->> 'editorial')::int = 2 and (v_overview -> 'by_template' ->> 'modern')::int = 1, 'přehled: podle šablon');
  perform tap.ok((v_overview -> 'by_locale' ->> 'cs')::int = 3 and (v_overview -> 'by_locale' ->> 'en')::int = 1, 'přehled: podle jazyků');
  perform tap.eq((select sum(events)::bigint from se_vezmou.op_analytics_summary(tap.u('operator:support'), 30)), 6, 'analytika za 30 dní');
  perform tap.eq((select sum(events)::bigint from se_vezmou.op_analytics_summary(tap.u('operator:support'), 90)), 7, 'analytika za 90 dní');
  perform tap.eq((select events from se_vezmou.op_analytics_summary(tap.u('operator:owner'), 30) where event = 'wizard_step_completed' and step = 1), 2,
    'analytika: kroky průvodce');
  perform tap.reset();
  perform tap.ok(v_overview::text not ilike '%@%' and v_overview::text not ilike '%Klára%', 'přehled neobsahuje osobní údaje');

  -- retence: web s blížícím se koncem provozu a smazání dietních údajů
  update se_vezmou.orders set service_ends_at = now() + interval '20 days' where wedding_id = tap.wb();
  update se_vezmou.weddings set health_purge_at = now() + interval '10 days' where id = tap.wb();
  set local role service_role;
  select count(*) into v_rows from se_vezmou.op_list_retention(tap.u('operator:support'), 30) where wedding_id = tap.wb();
  perform tap.eq(v_rows, 2, 'retence: konec provozu a dietní údaje do 30 dní');
  select count(*) into v_rows from se_vezmou.op_list_retention(tap.u('operator:support'), 15) where wedding_id = tap.wb();
  perform tap.eq(v_rows, 1, 'retence: okno 15 dní');
  perform tap.ok((select due_at from se_vezmou.op_list_retention(tap.u('operator:support'), 30) where wedding_id = tap.wb() order by due_at limit 1)
                 < now() + interval '11 days', 'retence: seřazeno podle termínu');
  perform tap.reset();

  -- audit log s filtrem (majitel)
  set local role service_role;
  perform tap.ok((select count(*) from se_vezmou.op_list_audit(tap.u('operator:owner'))) > 5, 'audit: výpis');
  perform tap.ok((select max(total_count) from se_vezmou.op_list_audit(tap.u('operator:owner'), p_limit => 2)) > 2, 'audit: total_count');
  perform tap.eq((select count(*) from se_vezmou.op_list_audit(tap.u('operator:owner'), p_limit => 2)), 2, 'audit: stránkování');
  perform tap.ok((select bool_and(action like 'wedding.%') from se_vezmou.op_list_audit(tap.u('operator:owner'), p_action => 'wedding.')),
    'audit: filtr předpony akce');
  perform tap.eq((select count(*) from se_vezmou.op_list_audit(tap.u('operator:owner'), p_action => 'wedding.slug_change')), 2, 'audit: filtr přesné akce');
  perform tap.eq((select count(*) from se_vezmou.op_list_audit(tap.u('operator:owner'), p_action => '%')), 0, 'audit: zástupný znak se hledá doslova');
  perform tap.ok((select bool_and(wedding_id = tap.wa()) from se_vezmou.op_list_audit(tap.u('operator:owner'), p_wedding_id => tap.wa())),
    'audit: filtr zakázky');
  perform tap.ok((select bool_and(actor_id = tap.u('operator:support')) from se_vezmou.op_list_audit(tap.u('operator:owner'), p_actor_id => tap.u('operator:support'))),
    'audit: filtr operátora');
  perform tap.ok((select actor_email from se_vezmou.op_list_audit(tap.u('operator:owner'), p_actor_id => tap.u('operator:support')) limit 1) = 'podpora@example.test',
    'audit: e-mail operátora k záznamu');
  perform tap.eq((select count(*) from se_vezmou.op_list_audit(tap.u('operator:owner'), p_from => now() + interval '1 day')), 0, 'audit: filtr od');
  perform tap.ok((select count(*) from se_vezmou.op_list_audit(tap.u('operator:owner'), p_to => now() + interval '1 day')) > 5, 'audit: filtr do');
  perform tap.ok((select bool_and(a::text not ilike '%Novák%' and a::text not ilike '%vegetari%') from se_vezmou.op_list_audit(tap.u('operator:owner'), p_limit => 200) a),
    'audit neobsahuje údaje hostů');
  perform tap.reset();
end
$$;

-- Správa operátorů (majitel): založení, zakázání, obnova faktoru; poslední majitel nejde zakázat
do $$
declare
  v_owner uuid := tap.u('operator:owner');
  v_new uuid;
  v_second uuid;
  v_tok bytea := sha256(convert_to('operator-token-9', 'UTF8'));
begin
  set local role service_role;
  v_new := se_vezmou.op_create_operator(v_owner, '  Nova.Podpora@Example.test ', 'support');
  perform tap.ok(v_new is not null, 'majitel založí operátora');
  perform tap.ok((select count(*) from se_vezmou.op_list_operators(v_owner)) = 4, 'seznam operátorů');
  perform tap.ok((select email from se_vezmou.op_list_operators(v_owner) where id = v_new) = 'nova.podpora@example.test', 'e-mail operátora je normalizovaný');
  perform tap.ok((select not totp_confirmed from se_vezmou.op_list_operators(v_owner) where id = v_new), 'nový operátor nemá druhý faktor');
  perform tap.throws(format('select se_vezmou.op_create_operator(%L, ''nova.podpora@example.test'', ''support'')', v_owner), '23505', 'duplicitní e-mail se odmítne');
  perform tap.throws(format('select se_vezmou.op_create_operator(%L, ''neni-email'', ''support'')', v_owner), '22023', 'neplatný e-mail se odmítne');
  perform tap.throws(format('select se_vezmou.op_create_operator(%L, ''a@b.cz'', ''admin'')', v_owner), '22023', 'neznámá role se odmítne');

  -- zakázání odvolá relace a zabrání přihlášení
  perform se_vezmou.auth_operator_create_session(v_new, v_tok, 1800, 28800);
  perform tap.eq((select count(*) from se_vezmou.auth_operator_validate_session(v_tok)), 1, 'relace nového operátora platí');
  perform tap.throws(format('select se_vezmou.op_set_operator_disabled(%L, %L, true, '' '')', v_owner, v_new), '22023', 'zakázání bez důvodu');
  perform tap.throws(format('select se_vezmou.op_set_operator_disabled(%L, %L, true, ''x'')', v_owner, v_owner), '22023', 'majitel nezakáže sám sebe');
  perform se_vezmou.op_set_operator_disabled(v_owner, v_new, true, 'Odchod');
  perform tap.eq((select count(*) from se_vezmou.auth_operator_validate_session(v_tok)), 0, 'zakázání ukončí relace');
  perform tap.eq((select count(*) from se_vezmou.auth_operator_find('nova.podpora@example.test')), 0, 'zakázaný operátor se nepřihlásí');
  perform se_vezmou.op_set_operator_disabled(v_owner, v_new, false, 'Návrat');
  perform tap.eq((select count(*) from se_vezmou.auth_operator_find('nova.podpora@example.test')), 1, 'povolený operátor se může přihlásit');
  perform tap.reset();

  -- zakázaný majitel už nic nezmůže; majitel nezakáže sám sebe, takže vždy zůstane aktivní majitel
  set local role service_role;
  perform tap.throws(format('select se_vezmou.op_set_operator_disabled(%L, %L, true, ''x'')', v_new, v_owner), '42501', 'podpora nezakazuje majitele');
  v_second := se_vezmou.op_create_operator(v_owner, 'druhy.majitel@example.test', 'owner');
  perform se_vezmou.op_set_operator_disabled(v_owner, v_second, true, 'Zkouška zakázání majitele');
  perform tap.throws(format('select se_vezmou.op_list_operators(%L)', v_second), '42501', 'zakázaný majitel už nic nezmůže');
  perform tap.reset();

  -- obnova faktoru: zneplatní klíč, záložní kódy a relace; sobě ne
  set local role service_role;
  perform se_vezmou.auth_operator_mfa_begin(tap.u('operator:support'), 'sifrovany-klic-podpory-1234567890');
  perform se_vezmou.auth_operator_mfa_confirm(tap.u('operator:support'),
    se_vezmou.auth_operator_create_session(tap.u('operator:support'), sha256('t-support'), 1800, 28800), 50, array[sha256('s1'), sha256('s2')]);
  perform tap.ok((select confirmed from se_vezmou.auth_operator_mfa_get(tap.u('operator:support'))), 'podpora má faktor');
  perform tap.throws(format('select se_vezmou.op_reset_operator_mfa(%L, %L, ''x'')', v_owner, v_owner), '22023', 'majitel si faktor neobnoví sám');
  perform tap.throws(format('select se_vezmou.op_reset_operator_mfa(%L, %L, '' '')', v_owner, tap.u('operator:support')), '22023', 'obnova bez důvodu');
  perform se_vezmou.op_reset_operator_mfa(v_owner, tap.u('operator:support'), 'Ztracený telefon');
  perform tap.ok((select not confirmed and secret_enc is null from se_vezmou.auth_operator_mfa_get(tap.u('operator:support'))), 'faktor je zneplatněn');
  perform tap.eq(se_vezmou.auth_operator_backup_codes_left(tap.u('operator:support')), 0, 'záložní kódy jsou zneplatněny');
  perform tap.eq((select count(*) from se_vezmou.auth_operator_validate_session(sha256('t-support'))), 0, 'relace operátora jsou odvolány');
  perform tap.reset();
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where action = 'operator.mfa_reset' and target_id = tap.u('operator:support')
                          and actor_id = v_owner and reason = 'Ztracený telefon'), 'obnova faktoru je v auditu');
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where action = 'operator.create' and target_id = v_new), 'založení operátora je v auditu');
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where action = 'operator.disable' and target_id = v_new), 'zakázání operátora je v auditu');
  perform tap.ok(not exists (select 1 from se_vezmou.audit_log where meta::text ilike '%@%'), 'audit neobsahuje e-maily');
end
$$;

-- Atomicita: zásah a audit vznikají společně, vrácení transakce zruší obojí
do $$
declare
  v_audit bigint := (select count(*) from se_vezmou.audit_log);
  v_notes bigint := (select count(*) from se_vezmou.operator_notes);
begin
  begin
    perform se_vezmou.op_add_note(tap.u('operator:owner'), tap.wa(), 'Poznámka, která se vrátí');
    perform se_vezmou.op_change_slug(tap.u('operator:owner'), tap.wa(), 'vracena-adresa', 'Pokus');
    perform tap.ok((select count(*) from se_vezmou.audit_log) = v_audit + 2, 'oba zásahy zapsaly audit');
    raise exception 'vrátit_transakci';
  exception when others then
    if sqlerrm <> 'vrátit_transakci' then raise; end if;
  end;
  perform tap.eq((select count(*) from se_vezmou.audit_log), v_audit, 'po vrácení transakce nezůstal audit bez zásahu');
  perform tap.eq((select count(*) from se_vezmou.operator_notes), v_notes, 'po vrácení transakce nezůstala poznámka');
  perform tap.ok((select slug from se_vezmou.weddings where id = tap.wa()) = 'klara-matej-2030', 'po vrácení transakce adresa beze změny');

  -- selhání zásahu uprostřed (neplatná adresa po poznámce v téže funkci neexistuje); samostatný zásah při chybě nezapíše audit
  begin
    perform se_vezmou.op_change_slug(tap.u('operator:owner'), tap.wa(), 'druha-svatba', 'Kolize');
  exception when unique_violation then
    null;
  end;
  perform tap.eq((select count(*) from se_vezmou.audit_log), v_audit, 'neúspěšný zásah audit nezapsal');
end
$$;

-- Audit zůstává append-only i pro operátorské funkce
do $$
declare
  v_id bigint := (select min(id) from se_vezmou.audit_log);
begin
  perform tap.throws(format('update se_vezmou.audit_log set action = ''x'' where id = %s', v_id), 'append_only', 'update auditu selže');
  perform tap.throws('delete from se_vezmou.audit_log', 'append_only', 'delete auditu selže');
  set local role service_role;
  perform tap.throws('delete from se_vezmou.audit_log', '42501', 'service_role nemaže audit');
  perform tap.reset();
end
$$;

rollback;
