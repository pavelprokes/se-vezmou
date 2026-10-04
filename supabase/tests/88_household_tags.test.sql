-- Skupiny hostů: štítky domácnosti, seznam, export a hromadné pozvání podle štítku.
begin;
select tap.seed();

do $$
begin
  -- oprávnění: jen správce vlastní svatby
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.throws(format('select se_vezmou.admin_invitations_bulk_tag(%L, true, ''x'')', tap.u('A:event1')),
    '42501', 'bulk_tag: návštěvník je odmítnut');
  perform tap.reset();
  perform tap.ok(
    not has_function_privilege('anon', 'se_vezmou.admin_invitations_bulk_tag(uuid, boolean, text)', 'execute')
    and not has_function_privilege('service_role', 'se_vezmou.admin_invitations_bulk_tag(uuid, boolean, text)', 'execute')
    and not has_function_privilege('authenticated', 'se_vezmou.tags_from_payload(jsonb)', 'execute'),
    'bulk_tag jen pro authenticated, tags_from_payload nikomu');
end
$$;

do $$
declare
  v_h1 uuid;
  v_h2 uuid;
  v_g1 uuid;
  v_list jsonb;
  v_export jsonb;
  v_rows integer;
begin
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  v_h1 := se_vezmou.admin_household_save(null, jsonb_build_object('label', 'Dvořákovi',
    'tags', jsonb_build_array('  Rodina   nevěsty ', 'Kolegové', 'Kolegové ', ''),
    'guests', jsonb_build_array(jsonb_build_object('display_name', 'Karel Dvořák', 'invited_event_ids', '[]'::jsonb))));
  v_h2 := se_vezmou.admin_household_save(null, jsonb_build_object('label', 'Malí',
    'guests', jsonb_build_array(jsonb_build_object('display_name', 'Petr Malý', 'invited_event_ids', '[]'::jsonb))));
  perform tap.reset();

  perform tap.ok((select tags from se_vezmou.households where id = v_h1) = array['Rodina nevěsty', 'Kolegové'],
    'štítky: ořez, sloučení mezer, bez duplicit a prázdných');
  -- svatba B má domácnost se stejnou skupinou: hromadné pozvání A na ni nesmí sáhnout
  insert into se_vezmou.households (wedding_id, label, tags) values (tap.wb(), 'Cizí', array['Kolegové']);
  perform tap.ok((select tags from se_vezmou.households where id = v_h2) = '{}', 'bez štítků: prázdné pole');

  -- úprava bez klíče tags štítky nemění, s prázdným polem je smaže
  select id into v_g1 from se_vezmou.guests where household_id = v_h1;
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform se_vezmou.admin_household_save(v_h1, jsonb_build_object('label', 'Dvořákovi',
    'guests', jsonb_build_array(jsonb_build_object('id', v_g1, 'display_name', 'Karel Dvořák', 'invited_event_ids', '[]'::jsonb))));
  perform tap.reset();
  perform tap.eq((select cardinality(tags) from se_vezmou.households where id = v_h1), 2, 'zápis bez tags štítky zachová');

  -- neplatné štítky se odmítnou a nic se nezapíše
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.throws(format('select se_vezmou.admin_household_save(%L, %L::jsonb)', v_h1, jsonb_build_object('label', 'Změna',
    'tags', jsonb_build_array(repeat('x', 41)),
    'guests', jsonb_build_array(jsonb_build_object('id', v_g1, 'display_name', 'Karel Dvořák')))), '22023', 'štítek delší než 40 znaků se odmítne');
  perform tap.throws(format('select se_vezmou.admin_household_save(null, %L::jsonb)', jsonb_build_object('label', 'x',
    'tags', (select jsonb_agg('t' || n) from generate_series(1, 11) n),
    'guests', jsonb_build_array(jsonb_build_object('display_name', 'Host')))), '22023', 'víc než 10 štítků se odmítne');
  perform tap.throws(format('select se_vezmou.admin_household_save(null, %L::jsonb)', jsonb_build_object('label', 'x',
    'tags', jsonb_build_array('Rodina, přátelé'), 'guests', jsonb_build_array(jsonb_build_object('display_name', 'Host')))), '22023', 'čárka v názvu skupiny se odmítne');
  perform tap.throws(format('select se_vezmou.admin_household_save(null, %L::jsonb)', jsonb_build_object('label', 'x',
    'tags', jsonb_build_array(1), 'guests', jsonb_build_array(jsonb_build_object('display_name', 'Host')))), '22023', 'štítek musí být text');
  perform tap.reset();
  perform tap.ok((select label from se_vezmou.households where id = v_h1) = 'Dvořákovi', 'odmítnutý zápis nic nezměnil');

  -- seznam a export nesou štítky
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  v_list := se_vezmou.admin_guest_list();
  v_export := se_vezmou.admin_export_guests(false);
  perform tap.reset();
  perform tap.ok((select h -> 'tags' from jsonb_array_elements(v_list -> 'households') h where h ->> 'id' = v_h1::text)
                 = '["Rodina nevěsty", "Kolegové"]'::jsonb, 'admin_guest_list: štítky domácnosti');
  perform tap.ok((select p -> 'tags' from jsonb_array_elements(v_export -> 'people') p where p ->> 'name' = 'Petr Malý')
                 = '[]'::jsonb, 'admin_export_guests: osoba bez štítků má prázdné pole');
  perform tap.ok((select p -> 'tags' from jsonb_array_elements(v_export -> 'people') p where p ->> 'name' = 'Karel Dvořák')
                 = '["Rodina nevěsty", "Kolegové"]'::jsonb, 'admin_export_guests: štítky u osoby');

  -- hromadné pozvání jen skupiny (přesná shoda názvu)
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.eq(se_vezmou.admin_invitations_bulk_tag(tap.u('A:event2'), true, 'KOLEGOVÉ'), 0, 'bulk_tag: jiný zápis skupiny nikoho nepozve');
  v_rows := se_vezmou.admin_invitations_bulk_tag(tap.u('A:event2'), true, ' Kolegové ');
  perform tap.reset();
  perform tap.eq(v_rows, 1, 'bulk_tag: pozván jen host skupiny');
  perform tap.ok(exists (select 1 from se_vezmou.invitations where guest_id = v_g1 and event_id = tap.u('A:event2'))
    and not exists (select 1 from se_vezmou.invitations i join se_vezmou.guests g on g.id = i.guest_id
                     where g.household_id = v_h2 and i.event_id = tap.u('A:event2')), 'bulk_tag: ostatní beze změny');
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where wedding_id = tap.wa() and action = 'guests.invite_bulk'
                          and meta ->> 'by_tag' = 'true' and not meta ? 'tag'), 'bulk_tag: audit bez názvu štítku');

  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform se_vezmou.admin_invitations_bulk_tag(tap.u('A:event1'), true, null);
  v_rows := se_vezmou.admin_invitations_bulk_tag(tap.u('A:event1'), false, 'Rodina nevěsty');
  perform tap.reset();
  perform tap.eq(v_rows, 1, 'bulk_tag: zrušení pozvání jen skupině');
  perform tap.ok(exists (select 1 from se_vezmou.invitations i join se_vezmou.guests g on g.id = i.guest_id
                          where g.household_id = v_h2 and i.event_id = tap.u('A:event1')), 'bulk_tag null: pozváni všichni, zrušení skupiny ostatní nechá');

  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.throws(format('select se_vezmou.admin_invitations_bulk_tag(%L, true, ''x'')', tap.u('B:event1')), 'invalid_event',
    'bulk_tag: událost cizí svatby se odmítne');
  perform tap.throws(format('select se_vezmou.admin_invitations_bulk_tag(%L, true, ''  '')', tap.u('A:event1')), '22023',
    'bulk_tag: prázdný štítek se odmítne');
  perform tap.reset();
end
$$;

rollback;
