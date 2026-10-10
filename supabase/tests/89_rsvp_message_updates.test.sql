-- Vzkaz pro novomanžele a upozornění hostů na změny (migrace rsvp_message_and_updates).
begin;
select tap.seed();

do $$
declare
  v_ticket text;
  g1 uuid := tap.u('A:guest1');
  v_people jsonb := jsonb_build_array(jsonb_build_object('guest_id', tap.u('A:guest1'),
    'attendance', jsonb_build_array(jsonb_build_object('event_id', tap.u('A:event1'), 'attending', true))));
  v_view jsonb;
  v_token text;
begin
  delete from se_vezmou.rsvp_questions where wedding_id = tap.wa();
  update se_vezmou.rsvp_settings set enabled_questions = '{"message": true, "updates": true}'
   where wedding_id = tap.wa();

  -- 1. vzkaz: délka, oříznutí, vypnutý příznak
  perform tap.become('authenticated', tap.wa(), 'visitor');
  select ticket into v_ticket from se_vezmou.rsvp_match('Jan Novák');
  perform tap.throws(format('select se_vezmou.rsvp_submit(%L, %L::jsonb)', v_ticket,
    jsonb_build_object('answers', jsonb_build_object('message', repeat('x', 1001)), 'people', v_people)::text),
    'invalid_payload', 'vzkaz delší než 1000 znaků se odmítne');
  perform tap.throws(format('select se_vezmou.rsvp_submit(%L, %L::jsonb)', v_ticket,
    jsonb_build_object('answers', jsonb_build_object('message', 5), 'people', v_people)::text),
    'invalid_payload', 'vzkaz musí být text');

  -- 2. upozornění: neplatné údaje se odmítnou
  perform tap.throws(format('select se_vezmou.rsvp_submit(%L, %L::jsonb)', v_ticket,
    jsonb_build_object('answers', '{}'::jsonb, 'people', v_people,
      'updates', jsonb_build_object('action', 'set', 'email', 'bez-zavinace', 'locale', 'cs'))::text),
    'invalid_payload', 'upozornění: neplatný e-mail se odmítne');
  perform tap.throws(format('select se_vezmou.rsvp_submit(%L, %L::jsonb)', v_ticket,
    jsonb_build_object('answers', '{}'::jsonb, 'people', v_people,
      'updates', jsonb_build_object('action', 'set', 'email', 'jan@example.test', 'phone', 'volejte mi', 'locale', 'cs'))::text),
    'invalid_payload', 'upozornění: telefon jen číslice a oddělovače');
  perform tap.throws(format('select se_vezmou.rsvp_submit(%L, %L::jsonb)', v_ticket,
    jsonb_build_object('answers', '{}'::jsonb, 'people', v_people,
      'updates', jsonb_build_object('action', 'set', 'email', 'jan@example.test', 'locale', 'de'))::text),
    'invalid_payload', 'upozornění: jen čeština a angličtina');

  -- platná odpověď se vzkazem a přihlášením k upozornění
  perform se_vezmou.rsvp_submit(v_ticket, jsonb_build_object(
    'answers', jsonb_build_object('message', '  Těšíme se na vás!  '),
    'people', v_people,
    'updates', jsonb_build_object('action', 'set', 'email', 'Jan@Example.test', 'phone', '+420 777 123 456', 'locale', 'cs')));
  v_view := se_vezmou.rsvp_get(v_ticket);
  perform tap.ok((v_view -> 'response' ->> 'has_updates')::boolean, 'host z lístku vidí jen příznak upozornění');
  perform tap.ok(position('Example.test' in lower(v_view::text)) = 0 and position('777' in v_view::text) = 0,
    'host z lístku nevidí e-mail ani telefon z upozornění');
  perform tap.reset();

  perform tap.ok((select answers ->> 'message' from se_vezmou.rsvp_responses where wedding_id = tap.wa())
                 = 'Těšíme se na vás!', 'vzkaz se uloží oříznutý');
  perform tap.eq((select count(*) from se_vezmou.rsvp_updates where wedding_id = tap.wa()), 1, 'upozornění se uloží');
  perform tap.ok((select phone from se_vezmou.rsvp_updates where wedding_id = tap.wa()) = '+420 777 123 456',
    'telefon se uloží');

  -- úprava bez `updates` záznam ponechá, `remove` ho smaže
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform se_vezmou.rsvp_submit(v_ticket, jsonb_build_object('answers', '{}'::jsonb, 'people', v_people));
  perform tap.reset();
  perform tap.eq((select count(*) from se_vezmou.rsvp_updates where wedding_id = tap.wa()), 1,
    'úprava odpovědi bez volby upozornění záznam ponechá');
  perform tap.ok(not ((select answers from se_vezmou.rsvp_responses where wedding_id = tap.wa()) ? 'message'),
    'prázdný vzkaz se při úpravě smaže');

  -- 3. správce: vzkazy a seznam, souhlas za hosta zapsat nemůže
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform se_vezmou.rsvp_submit(v_ticket, jsonb_build_object(
    'answers', jsonb_build_object('message', 'Ať vám to klape'), 'people', v_people));
  perform tap.reset();
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.eq(jsonb_array_length(se_vezmou.admin_rsvp_messages()), 1, 'správce vidí vzkaz');
  perform tap.ok(se_vezmou.admin_rsvp_messages() -> 0 ->> 'message' = 'Ať vám to klape', 'text vzkazu');
  perform tap.ok(se_vezmou.admin_rsvp_updates() -> 0 ->> 'email' = 'Jan@Example.test', 'správce vidí e-mail');
  perform tap.ok(se_vezmou.admin_rsvp_updates() -> 0 ->> 'phone' = '+420 777 123 456', 'správce vidí telefon');
  perform se_vezmou.admin_rsvp_enter(tap.u('A:household'), jsonb_build_object(
    'answers', '{}'::jsonb, 'people', v_people,
    'updates', jsonb_build_object('action', 'set', 'email', 'jiny@example.test', 'locale', 'cs')));
  perform tap.reset();
  perform tap.ok((select email::text from se_vezmou.rsvp_updates where wedding_id = tap.wa()) = 'Jan@Example.test',
    'ruční zápis správce souhlas hosta nemění');
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  select unsubscribe_token into v_token from se_vezmou.admin_rsvp_updates_recipients();
  perform tap.ok(v_token ~ '^[0-9a-f]{36}$', 'příjemci mají token pro odhlášení');
  perform tap.reset();
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where wedding_id = tap.wa() and action = 'rsvp.updates_sent'),
    'odeslání upozornění se zapíše do auditu');

  -- izolace: správce jiné svatby nic nevidí
  perform tap.become('authenticated', tap.wb(), 'admin', tap.u('B:admin'));
  perform tap.eq(jsonb_array_length(se_vezmou.admin_rsvp_updates()), 0, 'jiná svatba upozornění nevidí');
  perform tap.eq(jsonb_array_length(se_vezmou.admin_rsvp_messages()), 0, 'jiná svatba vzkazy nevidí');
  perform tap.reset();

  -- oprávnění
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.throws('select se_vezmou.admin_rsvp_updates()', '42501', 'návštěvník seznam nedostane');
  perform tap.throws('select se_vezmou.admin_rsvp_messages()', '42501', 'návštěvník vzkazy nedostane');
  perform tap.throws('select * from se_vezmou.admin_rsvp_updates_recipients()', '42501', 'návštěvník adresy nedostane');
  perform tap.reset();
  perform tap.ok(
    has_function_privilege('service_role', 'se_vezmou.rsvp_updates_unsubscribe(text)', 'execute')
    and not has_function_privilege('authenticated', 'se_vezmou.rsvp_updates_unsubscribe(text)', 'execute')
    and not has_function_privilege('anon', 'se_vezmou.rsvp_updates_unsubscribe(text)', 'execute')
    and not has_table_privilege('authenticated', 'se_vezmou.rsvp_updates', 'select'),
    'odhlášení jen service role, tabulka bez přímých práv');

  -- 4. odhlášení tokenem
  set local role service_role;
  perform tap.ok(not se_vezmou.rsvp_updates_unsubscribe('neplatny'), 'neplatný token nic nesmaže');
  perform tap.ok(se_vezmou.rsvp_updates_unsubscribe(v_token), 'platný token odhlásí');
  perform tap.ok(not se_vezmou.rsvp_updates_unsubscribe(v_token), 'druhé odhlášení už nic nenajde');
  perform tap.reset();
  perform tap.eq((select count(*) from se_vezmou.rsvp_updates where wedding_id = tap.wa()), 0, 'po odhlášení záznam není');

  -- 5. kaskáda: smazání odpovědi (retence hostů) smaže i upozornění
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform se_vezmou.rsvp_submit(v_ticket, jsonb_build_object('answers', '{}'::jsonb, 'people', v_people,
    'updates', jsonb_build_object('action', 'set', 'email', 'jan@example.test', 'locale', 'en')));
  perform tap.reset();
  delete from se_vezmou.rsvp_responses where wedding_id = tap.wa();
  perform tap.eq((select count(*) from se_vezmou.rsvp_updates where wedding_id = tap.wa()), 0,
    'smazání odpovědi smaže i upozornění');

  -- 6. vypnutý příznak: upozornění ani vzkaz se neukládají
  update se_vezmou.rsvp_settings set enabled_questions = '{}' where wedding_id = tap.wa();
  perform tap.become('authenticated', tap.wa(), 'visitor');
  select ticket into v_ticket from se_vezmou.rsvp_match('Jan Novák');
  perform se_vezmou.rsvp_submit(v_ticket, jsonb_build_object(
    'answers', jsonb_build_object('message', 'x'), 'people', v_people,
    'updates', jsonb_build_object('action', 'set', 'email', 'jan@example.test', 'locale', 'cs')));
  perform tap.reset();
  perform tap.eq((select count(*) from se_vezmou.rsvp_updates where wedding_id = tap.wa()), 0,
    'vypnutá volba: upozornění se neuloží');
  perform tap.ok(not ((select answers from se_vezmou.rsvp_responses where wedding_id = tap.wa()) ? 'message'),
    'vypnutá volba: vzkaz se zahodí');

  -- 7. nastavení: příznaky projdou a klíče jsou vyhrazené
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform se_vezmou.admin_rsvp_settings_save(jsonb_build_object(
    'opens_at', null, 'closes_at', null, 'allow_unlisted', false, 'email_confirmation', false,
    'enabled_questions', jsonb_build_object('message', true, 'updates', true), 'questions', '[]'::jsonb));
  perform tap.ok((select enabled_questions from se_vezmou.rsvp_settings where wedding_id = tap.wa())
                 @> '{"message": true, "updates": true}', 'příznaky message a updates se uloží');
  perform tap.throws(format('select se_vezmou.admin_rsvp_settings_save(%L::jsonb)', jsonb_build_object(
    'opens_at', null, 'closes_at', null, 'allow_unlisted', false, 'email_confirmation', false,
    'enabled_questions', '{}'::jsonb,
    'questions', jsonb_build_array(jsonb_build_object('key', 'message', 'type', 'text', 'label', jsonb_build_object('cs', 'X'),
      'required', false, 'enabled', true)))::text), 'invalid_question', 'klíč message je vyhrazený');
  perform tap.reset();

  set local role service_role;
  perform tap.ok(se_vezmou.email_log_insert('guest_update', tap.wa(), 'cs', sha256(convert_to('x@example.test', 'UTF8')), 'example.test') is not null,
    'typ guest_update projde kontrolou email_log');
  perform tap.reset();
  perform tap.ok(g1 is not null, 'konec');
end
$$;

rollback;
