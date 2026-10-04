-- Osobní odkaz domácnosti: kód, informace pro web, lístek RSVP, výměna kódu správcem.
begin;
select tap.seed();

do $$
declare
  v_code text := (select invite_code from se_vezmou.households where id = tap.u('A:household'));
  v_b_code text := (select invite_code from se_vezmou.households where id = tap.u('B:household'));
  v_info jsonb;
  v_ticket text;
  v_new text;
begin
  perform tap.ok(v_code ~ '^[0-9a-f]{20}$', 'každá domácnost má kód (i založená před migrací)');
  perform tap.eq((select count(distinct invite_code) from se_vezmou.households),
                 (select count(*) from se_vezmou.households), 'kódy jsou různé');
  perform tap.ok(
    not has_function_privilege('anon', 'se_vezmou.rsvp_invite_info(text)', 'execute')
    and not has_function_privilege('authenticated', 'se_vezmou.invite_household(text)', 'execute')
    and not has_function_privilege('authenticated', 'se_vezmou.new_invite_code()', 'execute')
    and not has_function_privilege('service_role', 'se_vezmou.admin_household_invite_reset(uuid)', 'execute'),
    'interní funkce nikomu, ostatní jen authenticated');

  -- návštěvník webu A
  perform tap.become('authenticated', tap.wa(), 'visitor');
  v_info := se_vezmou.rsvp_invite_info(v_code);
  v_ticket := se_vezmou.rsvp_invite_ticket(v_code);
  perform tap.ok(se_vezmou.rsvp_invite_info(v_b_code) is null, 'kód cizí svatby na webu A neplatí');
  perform tap.ok(se_vezmou.rsvp_invite_info('0123456789abcdef0123') is null, 'neznámý kód: null');
  perform tap.ok(se_vezmou.rsvp_invite_info('nesmysl') is null and se_vezmou.rsvp_invite_ticket(null) is null,
    'neplatný tvar: null');
  perform tap.ok(se_vezmou.rsvp_get(v_ticket) is not null, 'lístek z kódu otevře formulář domácnosti');
  perform tap.reset();

  perform tap.ok(v_info ? 'locale', 'info: jazyk hosta');
  perform tap.ok((select array_agg(x::uuid order by x) from jsonb_array_elements_text(v_info -> 'event_ids') x)
                 is not distinct from
                 (select array_agg(distinct i.event_id order by i.event_id) from se_vezmou.invitations i
                    join se_vezmou.guests g on g.id = i.guest_id where g.household_id = tap.u('A:household')),
    'info: události, na které je domácnost pozvaná');
  perform tap.ok(exists (select 1 from se_vezmou.rsvp_tickets where household_id = tap.u('A:household')
                          and expires_at <= now() + interval '30 minutes'), 'lístek platí 30 minut');

  -- jazyk hosta
  update se_vezmou.guests set locale = 'en' where household_id = tap.u('A:household');
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.ok(se_vezmou.rsvp_invite_info(v_code) ->> 'locale' = 'en', 'info: jazyk z hosta domácnosti');
  perform tap.reset();

  -- mimo otevřené RSVP lístek není, informace pro program ano
  update se_vezmou.rsvp_settings set closes_at = now() - interval '1 minute', opens_at = null
   where wedding_id = tap.wa();
  insert into se_vezmou.rsvp_settings (wedding_id, closes_at)
  select tap.wa(), now() - interval '1 minute'
   where not exists (select 1 from se_vezmou.rsvp_settings where wedding_id = tap.wa());
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.ok(se_vezmou.rsvp_invite_ticket(v_code) is null, 'po uzavření RSVP lístek z kódu není');
  perform tap.ok(se_vezmou.rsvp_invite_info(v_code) is not null, 'po uzavření RSVP informace pro program platí');
  perform tap.reset();

  -- správce vymění kód: starý přestane platit
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.throws(format('select se_vezmou.admin_household_invite_reset(%L)', tap.u('A:household')), '42501',
    'výměna kódu: návštěvník je odmítnut');
  perform tap.reset();
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  v_new := se_vezmou.admin_household_invite_reset(tap.u('A:household'));
  perform tap.throws(format('select se_vezmou.admin_household_invite_reset(%L)', tap.u('B:household')), 'household_not_found',
    'výměna kódu: domácnost cizí svatby se odmítne');
  perform tap.ok((select h ->> 'invite_code' from jsonb_array_elements(se_vezmou.admin_guest_list() -> 'households') h
                   where h ->> 'id' = tap.u('A:household')::text) = v_new, 'admin_guest_list: nový kód');
  perform tap.reset();
  perform tap.ok(v_new <> v_code, 'výměna dá jiný kód');
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.ok(se_vezmou.rsvp_invite_info(v_code) is null, 'starý kód po výměně neplatí');
  perform tap.ok(se_vezmou.rsvp_invite_info(v_new) is not null, 'nový kód platí');
  perform tap.reset();
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where wedding_id = tap.wa() and action = 'guests.invite_reset'
                          and meta = '{}'::jsonb), 'výměna kódu je v auditu bez kódu');
end
$$;

rollback;
