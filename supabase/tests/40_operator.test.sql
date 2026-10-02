-- Operátorská cesta: bez grantu nevidí údaje hostů, zásah a audit v jedné transakci, append-only audit.
begin;
select tap.seed();

-- Servisní role nemá přímý přístup k údajům hostů, relacím ani auditu
do $$
declare
  v_table text;
begin
  set local role service_role;
  foreach v_table in array array['guests', 'households', 'invitations', 'rsvp_responses', 'rsvp_people',
      'rsvp_attendance', 'rsvp_health', 'rsvp_tickets', 'sessions', 'login_challenges', 'weddings',
      'wedding_admins', 'wedding_auth', 'audit_log', 'app_settings', 'slug_registry', 'operators',
      'data_access_grants', 'rate_limits'] loop
    perform tap.throws('select count(*) from se_vezmou.' || v_table, '42501', 'service_role nečte přímo ' || v_table);
  end loop;
  perform tap.throws('update se_vezmou.weddings set status = ''blocked''', '42501', 'service_role nemění svatby přímo');
  perform tap.throws('insert into se_vezmou.audit_log (actor_type, action) values (''system'', ''x'')', '42501',
    'service_role nezapisuje audit přímo');
  -- povolené přímé zápisy
  perform tap.eq(tap.affected('insert into se_vezmou.analytics_event (event, locale) values (''wizard_started'', ''cs'')'), 1,
    'service_role zapíše analytickou událost');
  perform tap.throws('select count(*) from se_vezmou.analytics_event', '42501', 'service_role analytiku nečte (jen souhrny přes funkce)');
  perform tap.reset();
end
$$;

-- Analytická událost: uzavřený seznam a žádné osobní údaje
do $$
begin
  perform tap.throws('insert into se_vezmou.analytics_event (event) values (''cokoli'')', '23514', 'neznámá analytická událost se odmítne');
  perform tap.ok(not exists (select 1 from information_schema.columns
                              where table_name = 'analytics_event'
                                and column_name in ('wedding_id', 'email', 'ip', 'user_agent', 'name')),
    'analytics_event nemá sloupce s identitou');
end
$$;

-- op_view_guest_data bez grantu: nic nevrátí a zapíše odmítnutí
do $$
declare
  v_audit_before bigint;
begin
  set local role service_role;
  -- fixtura má jen zrušený grant
  perform tap.eq((select count(*) from se_vezmou.op_view_guest_data(tap.u('operator:owner'), tap.wa(), 'Žádost o pomoc')), 0,
    'bez aktivního grantu operátor nevidí žádné hosty');
  perform tap.reset();
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where wedding_id = tap.wa() and action = 'guest_data.view_denied'
                          and actor_type = 'operator' and reason = 'Žádost o pomoc'),
    'odmítnuté nahlédnutí je v auditu s důvodem');
end
$$;

-- Důvod je povinný, operátor musí existovat, být aktivní a mít roli
do $$
begin
  set local role service_role;
  perform tap.throws(format('select * from se_vezmou.op_view_guest_data(%L, %L, '''')', tap.u('operator:owner'), tap.wa()),
    '22023', 'prázdný důvod se odmítne');
  perform tap.throws(format('select * from se_vezmou.op_view_guest_data(%L, %L, ''   '')', tap.u('operator:owner'), tap.wa()),
    '22023', 'důvod z mezer se odmítne');
  perform tap.throws(format('select * from se_vezmou.op_view_guest_data(%L, %L, ''x'')', tap.u('operator:disabled'), tap.wa()),
    '42501', 'zakázaný operátor je odmítnut');
  perform tap.throws(format('select * from se_vezmou.op_view_guest_data(%L, %L, ''x'')', gen_random_uuid(), tap.wa()),
    '42501', 'neexistující operátor je odmítnut');
  perform tap.throws(format('select * from se_vezmou.op_view_guest_data(null, %L, ''x'')', tap.wa()),
    '42501', 'chybějící operátor je odmítnut');
  perform tap.reset();
end
$$;

-- S aktivním grantem: jména a údaje vidí, vše se zapíše do auditu s důvodem
do $$
declare
  v_rows bigint;
begin
  insert into se_vezmou.data_access_grants (wedding_id, granted_by_admin_id, reason, expires_at)
  values (tap.wa(), tap.u('A:admin'), 'Souhlas páru e-mailem', now() + interval '3 days');

  set local role service_role;
  select count(*) into v_rows from se_vezmou.op_view_guest_data(tap.u('operator:support'), tap.wa(), 'Pomoc s importem');
  perform tap.eq(v_rows, 2, 'se souhlasem páru operátor vidí hosty svatby A');
  perform tap.ok((select diet from se_vezmou.op_view_guest_data(tap.u('operator:support'), tap.wa(), 'x') where display_name = 'Jan Novák') = 'vegetariánská',
    'se souhlasem páru operátor vidí i dietu');
  perform tap.eq((select count(*) from se_vezmou.op_view_guest_data(tap.u('operator:owner'), tap.wb(), 'Jiná svatba')), 0,
    'souhlas A neplatí pro svatbu B');
  perform tap.reset();

  perform tap.ok(exists (select 1 from se_vezmou.audit_log where wedding_id = tap.wa() and action = 'guest_data.view'
                          and actor_id = tap.u('operator:support') and reason = 'Pomoc s importem'
                          and (meta ->> 'guests')::int = 2),
    'nahlédnutí je v auditu s důvodem a počtem (bez jmen)');
  perform tap.ok(not exists (select 1 from se_vezmou.audit_log where meta::text ilike '%Novák%' or meta::text ilike '%vegetari%'),
    'audit neobsahuje jména ani údaje hostů');
end
$$;

-- Prošlý nebo zrušený grant nedává přístup
do $$
begin
  update se_vezmou.data_access_grants set expires_at = now() - interval '1 minute', created_at = now() - interval '2 days'
   where wedding_id = tap.wa() and revoked_at is null;
  set local role service_role;
  perform tap.eq((select count(*) from se_vezmou.op_view_guest_data(tap.u('operator:owner'), tap.wa(), 'Po vypršení')), 0,
    'prošlý grant nedává přístup');
  perform tap.reset();

  insert into se_vezmou.data_access_grants (wedding_id, granted_by_admin_id, reason, expires_at, revoked_at)
  values (tap.wa(), tap.u('A:admin'), 'Zrušeno', now() + interval '2 days', now());
  set local role service_role;
  perform tap.eq((select count(*) from se_vezmou.op_view_guest_data(tap.u('operator:owner'), tap.wa(), 'Po zrušení')), 0,
    'zrušený grant nedává přístup');
  perform tap.reset();
end
$$;

-- op_set_wedding_status: zásah, historie i audit vznikají společně; při chybě nevznikne nic
do $$
begin
  set local role service_role;
  perform se_vezmou.op_set_wedding_status(tap.u('operator:support'), tap.wb(), 'blocked', 'Hlášení zneužití');
  perform tap.reset();
  perform tap.ok((select status from se_vezmou.weddings where id = tap.wb()) = 'blocked', 'stav svatby B je blocked');
  perform tap.ok((select blocked_at from se_vezmou.weddings where id = tap.wb()) is not null, 'blocked_at se nastavilo');
  perform tap.ok(exists (select 1 from se_vezmou.wedding_status_history where wedding_id = tap.wb()
                          and from_status = 'published' and to_status = 'blocked' and actor_type = 'operator'
                          and actor_id = tap.u('operator:support') and reason = 'Hlášení zneužití'),
    'změna stavu je v historii zakázky');
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where wedding_id = tap.wb() and action = 'wedding.status_change'
                          and meta = '{"from_status": "published", "to_status": "blocked"}'),
    'změna stavu je v auditu');

  -- zablokovaný web se neresolvuje
  perform tap.eq((select count(*) from se_vezmou.resolve_slug('druha-svatba')), 0, 'zablokovaná adresa se neresolvuje');

  -- bez důvodu, se špatným stavem a od nepovolaného operátora se nic nestane
  set local role service_role;
  perform tap.throws(format('select se_vezmou.op_set_wedding_status(%L, %L, ''deleted'', '' '')', tap.u('operator:owner'), tap.wa()), '22023', 'zásah bez důvodu se odmítne');
  perform tap.throws(format('select se_vezmou.op_set_wedding_status(%L, %L, ''neznamy'', ''x'')', tap.u('operator:owner'), tap.wa()), '22023', 'neznámý stav se odmítne');
  perform tap.throws(format('select se_vezmou.op_set_wedding_status(%L, %L, ''deleted'', ''x'')', tap.u('operator:disabled'), tap.wa()), '42501', 'zakázaný operátor nic nezmění');
  perform tap.reset();
  perform tap.ok((select status from se_vezmou.weddings where id = tap.wa()) = 'published', 'svatba A zůstala beze změny');
end
$$;

-- Atomicita: zásah a audit jsou v jedné transakci, vrácení transakce zruší obojí
do $$
declare
  v_audit_before bigint := (select count(*) from se_vezmou.audit_log);
  v_history_before bigint := (select count(*) from se_vezmou.wedding_status_history);
begin
  begin
    perform se_vezmou.op_set_wedding_status(tap.u('operator:owner'), tap.wa(), 'blocked', 'Pokus, který se vrátí');
    perform tap.ok((select count(*) from se_vezmou.audit_log) = v_audit_before + 1, 'audit vznikl spolu se zásahem');
    raise exception 'vrátit_transakci';
  exception when others then
    if sqlerrm <> 'vrátit_transakci' then raise; end if;
  end;
  perform tap.ok((select status from se_vezmou.weddings where id = tap.wa()) = 'published', 'po vrácení transakce se stav nezměnil');
  perform tap.eq((select count(*) from se_vezmou.audit_log), v_audit_before, 'po vrácení transakce nezůstal audit bez zásahu');
  perform tap.eq((select count(*) from se_vezmou.wedding_status_history), v_history_before, 'po vrácení transakce nezůstala historie');
end
$$;

-- Správce vidí zásahy operátora u své svatby (a jen u své)
do $$
begin
  perform tap.become('authenticated', tap.wb(), 'admin');
  perform tap.ok(tap.count('select count(*) from se_vezmou.audit_log where action = ''wedding.status_change'' and meta ->> ''to_status'' = ''blocked''') = 1,
    'správce B vidí blokaci své svatby');
  perform tap.reset();
  perform tap.become('authenticated', tap.wa(), 'admin');
  perform tap.eq(tap.count('select count(*) from se_vezmou.audit_log where meta ->> ''to_status'' = ''blocked'''), 0,
    'správce A nevidí zásah u svatby B');
  perform tap.reset();
end
$$;

-- op_set_app_setting: jen majitel, jen známý klíč a platná hodnota, s auditem
do $$
begin
  set local role service_role;
  perform tap.throws(format('select se_vezmou.op_set_app_setting(%L, ''max_admins'', ''4'')', tap.u('operator:support')), '42501', 'podpora nemění nastavení');
  perform tap.throws(format('select se_vezmou.op_set_app_setting(%L, ''max_admins'', ''6'')', tap.u('operator:owner')), '22023', 'max_admins nad tvrdý strop 5 se odmítne');
  perform tap.throws(format('select se_vezmou.op_set_app_setting(%L, ''max_admins'', ''"tri"'')', tap.u('operator:owner')), '22023', 'nečíselná hodnota se odmítne');
  perform tap.throws(format('select se_vezmou.op_set_app_setting(%L, ''neexistuje'', ''1'')', tap.u('operator:owner')), '22023', 'neznámý klíč se odmítne');
  perform se_vezmou.op_set_app_setting(tap.u('operator:owner'), 'max_admins', '4');
  perform tap.ok((select value from se_vezmou.get_app_settings() where key = 'max_admins') = '4', 'get_app_settings vrací novou hodnotu');
  perform tap.reset();
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where action = 'app_settings.update' and actor_id = tap.u('operator:owner')
                          and meta ->> 'setting_key' = 'max_admins'),
    'změna nastavení je v auditu');
  perform tap.ok((select updated_by from se_vezmou.app_settings where key = 'max_admins') = tap.u('operator:owner'), 'updated_by je vyplněno');
end
$$;

-- audit_log je append-only (i pro vlastníka tabulky, díky spouštěči)
do $$
declare
  v_id bigint := (select min(id) from se_vezmou.audit_log);
begin
  perform tap.throws(format('update se_vezmou.audit_log set action = ''x'' where id = %s', v_id), 'append_only', 'update auditu selže');
  perform tap.throws(format('delete from se_vezmou.audit_log where id = %s', v_id), 'append_only', 'delete auditu selže');
  perform tap.throws('delete from se_vezmou.audit_log', 'append_only', 'hromadný delete auditu selže');
  perform tap.throws('truncate se_vezmou.audit_log', 'append_only', 'truncate auditu selže');
  -- meta nesmí obsahovat osobní údaje
  perform tap.throws('select se_vezmou.write_audit(''system'', null, null, ''x.y'', null, null, null, ''{"email": "a@b.cz"}'')', 'personal_data',
    'meta s klíčem email se odmítne');
  perform tap.throws('select se_vezmou.write_audit(''system'', null, null, ''x.y'', null, null, null, ''{"x": {"display_name": "Jan"}}'')', 'personal_data',
    'meta s vnořeným klíčem display_name se odmítne');
  perform tap.throws('select se_vezmou.write_audit(''system'', null, null, ''x.y'', null, null, null, ''{"diet": "bez lepku"}'')', 'personal_data',
    'meta s klíčem diet se odmítne');
  perform tap.ok(se_vezmou.write_audit('system', null, null, 'x.y', null, null, null, '{"rows": 3, "kind": "health"}') > 0,
    'meta s počty a stavy projde');
  -- nahlédnutí do údajů hostů bez důvodu nelze zapsat ani přímo
  perform tap.throws('select se_vezmou.write_audit(''operator'', null, null, ''guest_data.view'')', '23514',
    'guest_data.* bez důvodu se odmítne');
end
$$;

rollback;
