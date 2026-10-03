-- Upozornění páru na odpověď hosta: příznak, oprávnění a adresy příjemců.
begin;
select tap.seed();

do $$
begin
  -- oprávnění: příznak jen správce vlastní svatby, adresy jen service role
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.throws('select se_vezmou.admin_rsvp_notify_get()', '42501', 'notify_get: návštěvník je odmítnut');
  perform tap.throws('select se_vezmou.admin_rsvp_notify_set(true)', '42501', 'notify_set: návštěvník je odmítnut');
  perform tap.reset();
  perform tap.become('authenticated', tap.wa(), 'guest_pin', tap.u('guest-session'));
  perform tap.throws('select se_vezmou.admin_rsvp_notify_set(true)', '42501', 'notify_set: host po PINu je odmítnut');
  perform tap.reset();
  perform tap.ok(
    not has_function_privilege('authenticated', 'se_vezmou.rsvp_notify_recipients(uuid)', 'execute')
    and not has_function_privilege('anon', 'se_vezmou.rsvp_notify_recipients(uuid)', 'execute')
    and has_function_privilege('service_role', 'se_vezmou.rsvp_notify_recipients(uuid)', 'execute')
    and not has_function_privilege('service_role', 'se_vezmou.admin_rsvp_notify_set(boolean)', 'execute'),
    'adresy k upozornění jen service role, příznak jen správce');
end
$$;

do $$
begin
  -- výchozí stav je vypnuto a bez příznaku nejsou žádní příjemci
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.ok(not se_vezmou.admin_rsvp_notify_get(), 'notify_get: ve výchozím stavu vypnuto');
  perform tap.reset();
  set local role service_role;
  perform tap.eq((select count(*) from se_vezmou.rsvp_notify_recipients(tap.wa())), 0, 'vypnuto: žádní příjemci');
  perform tap.reset();

  -- zapnutí
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform se_vezmou.admin_rsvp_notify_set(true);
  perform tap.ok(se_vezmou.admin_rsvp_notify_get(), 'notify_set: zapnuto');
  perform tap.throws('select se_vezmou.admin_rsvp_notify_set(null)', '22023', 'notify_set: null se odmítne');
  perform tap.reset();
  set local role service_role;
  perform tap.ok((select count(*) from se_vezmou.rsvp_notify_recipients(tap.wa())) >= 1, 'zapnuto: příjemci jsou aktivní správci');
  perform tap.eq((select count(*) from se_vezmou.rsvp_notify_recipients(tap.wb())), 0, 'jiná svatba příjemce nemá (izolace)');
  perform tap.reset();
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where wedding_id = tap.wa() and action = 'rsvp.notify_enabled'),
    'zapnutí se zapíše do auditu');

  -- vypnutí
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform se_vezmou.admin_rsvp_notify_set(false);
  perform tap.reset();
  set local role service_role;
  perform tap.eq((select count(*) from se_vezmou.rsvp_notify_recipients(tap.wa())), 0, 'vypnuto zpět: žádní příjemci');
  perform tap.ok(se_vezmou.email_log_insert('rsvp_notice', tap.wa(), 'cs', sha256(convert_to('x@example.test', 'UTF8')), 'example.test') is not null,
    'typ rsvp_notice projde kontrolou email_log');
  perform tap.reset();
end
$$;

rollback;
