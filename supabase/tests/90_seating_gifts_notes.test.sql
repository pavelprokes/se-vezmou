-- Zasedací pořádek, věcné dary s rezervací a soukromé poznámky (migrace seating_gifts_notes).
begin;
select tap.seed();

do $$
declare
  v_view jsonb;
  v_rev integer;
  v_gift uuid;
  v_gift2 uuid;
  v_token text;
  v_list jsonb;
  v_vendor uuid;
begin
  -- ---------------------------------------------------------------------------
  -- 1. zasedací pořádek
  -- ---------------------------------------------------------------------------
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  v_view := se_vezmou.admin_seating_get();
  perform tap.eq((v_view ->> 'rev')::bigint, 0, 'nový plán má verzi 0');
  perform tap.eq(jsonb_array_length(v_view -> 'people'), 1, 'osoby: jen ti, kdo potvrdili účast');
  perform tap.ok(v_view -> 'people' -> 0 ->> 'key' = 'g:' || tap.u('A:guest1')::text, 'host ze seznamu má klíč g:<id>');
  perform tap.ok(v_view -> 'people' -> 0 ->> 'household' = 'Rodina A', 'osoba nese název domácnosti');
  perform tap.eq(jsonb_array_length(v_view -> 'events'), 2, 'události s potvrzováním');

  v_rev := se_vezmou.admin_seating_save(
    jsonb_build_object('tables', jsonb_build_array(jsonb_build_object('id', 't1', 'seats', 8)),
                       'assignments', jsonb_build_object('g:' || tap.u('A:guest1')::text, jsonb_build_object('table', 't1'))),
    0);
  perform tap.eq(v_rev, 1, 'uložení zvýší verzi');
  perform tap.throws('select se_vezmou.admin_seating_save(''{}''::jsonb, 0)', 'conflict', 'stará verze se odmítne');
  perform tap.throws('select se_vezmou.admin_seating_save(''[]''::jsonb, 1)', 'invalid_payload', 'plán musí být objekt');
  perform tap.throws(format('select se_vezmou.admin_seating_save(%L::jsonb, 1)',
    jsonb_build_object('tables', (select jsonb_agg(jsonb_build_object('id', 't' || i)) from generate_series(1, 201) i))::text),
    'invalid_payload', 'nejvýš 200 stolů');
  perform tap.ok(se_vezmou.admin_seating_get() -> 'plan' -> 'assignments' ? ('g:' || tap.u('A:guest1')::text), 'plán se načte zpět');
  perform tap.reset();

  -- osoba bez hosta (doprovod) má klíč podle odpovědi a pořadí
  insert into se_vezmou.rsvp_people (id, wedding_id, response_id, guest_id, person_name, is_plus_one)
  values (tap.u('A:plus'), tap.wa(), tap.u('A:response'), null, 'Doprovod Jana', true);
  insert into se_vezmou.rsvp_attendance (wedding_id, person_id, event_id, attending)
  values (tap.wa(), tap.u('A:plus'), tap.u('A:event2'), true);
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.ok(exists (select 1 from jsonb_array_elements(se_vezmou.admin_seating_get() -> 'people') p
                          where p ->> 'key' = 'p:' || tap.u('A:response')::text || ':1'
                            and p ->> 'name' = 'Doprovod Jana' and (p ->> 'is_plus_one')::boolean),
    'doprovod má klíč p:<odpověď>:1');
  perform tap.reset();

  -- izolace a oprávnění
  perform tap.become('authenticated', tap.wb(), 'admin', tap.u('B:admin'));
  perform tap.eq((se_vezmou.admin_seating_get() ->> 'rev')::bigint, 0, 'jiná svatba plán A nevidí');
  perform tap.reset();
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.throws('select se_vezmou.admin_seating_get()', '42501', 'návštěvník plán nedostane');
  perform tap.throws('select se_vezmou.admin_seating_save(''{}''::jsonb, 1)', '42501', 'návštěvník plán neuloží');
  perform tap.reset();

  -- ---------------------------------------------------------------------------
  -- 2. věcné dary
  -- ---------------------------------------------------------------------------
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  v_gift := se_vezmou.admin_gift_save(null, jsonb_build_object(
    'title', jsonb_build_object('cs', 'Mixér', 'en', 'Blender'), 'description', jsonb_build_object('cs', 'Bílý'),
    'url', 'https://example.test/mixer', 'price', '2 500 Kč'));
  v_gift2 := se_vezmou.admin_gift_save(null, jsonb_build_object('title', jsonb_build_object('cs', 'Deka')));
  perform tap.throws('select se_vezmou.admin_gift_save(null, ''{"title": {"cs": "  "}}''::jsonb)', 'invalid_payload', 'dar potřebuje název');
  perform tap.throws('select se_vezmou.admin_gift_save(null, ''{"title": {"de": "X"}}''::jsonb)', 'invalid_payload', 'jen cs a en');
  perform tap.throws('select se_vezmou.admin_gift_save(null, ''{"title": {"cs": "X"}, "url": "http://x.test"}''::jsonb)',
    'invalid_payload', 'odkaz jen https');
  perform tap.throws(format('select se_vezmou.admin_gift_save(null, %L::jsonb)',
    jsonb_build_object('title', jsonb_build_object('cs', repeat('x', 121)))::text), 'invalid_payload', 'název nejvýš 120 znaků');
  perform se_vezmou.admin_gift_move(v_gift2, -1);
  perform tap.ok((se_vezmou.admin_gifts_list() -> 0 ->> 'id')::uuid = v_gift2, 'posun nahoru změní pořadí');
  perform se_vezmou.admin_gift_move(v_gift2, -1);
  perform tap.ok((se_vezmou.admin_gifts_list() -> 0 ->> 'id')::uuid = v_gift2, 'první zůstane první');
  perform tap.reset();

  -- host: archivovaný web dary nevidí
  update se_vezmou.weddings set status = 'archived' where id = tap.wa();
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.ok(se_vezmou.gift_list_public() is null, 'nezveřejněný web: žádné dary');
  perform tap.reset();
  update se_vezmou.weddings set status = 'published', guest_pin_enabled = true where id = tap.wa();

  -- s PINem hostů: návštěvník bez relace vidí jen zámek, rezervovat nemůže
  perform tap.become('authenticated', tap.wa(), 'visitor');
  v_list := se_vezmou.gift_list_public();
  perform tap.ok((v_list ->> 'locked')::boolean and jsonb_array_length(v_list -> 'items') = 0, 'bez PINu jen zámek');
  perform tap.throws(format('select se_vezmou.gift_reserve(%L, null)', v_gift), 'gift_locked', 'bez PINu nejde rezervovat');
  perform tap.reset();

  perform tap.become('authenticated', tap.wa(), 'guest_pin');
  v_list := se_vezmou.gift_list_public();
  perform tap.eq(jsonb_array_length(v_list -> 'items'), 2, 'host po PINu vidí dary');
  v_token := se_vezmou.gift_reserve(v_gift, 'Teta Věra');
  perform tap.ok(v_token ~ '^[0-9a-f]{36}$', 'rezervace vrátí token');
  perform tap.throws(format('select se_vezmou.gift_reserve(%L, null)', v_gift), 'gift_taken', 'zabraný dar nejde rezervovat znovu');
  v_list := se_vezmou.gift_list_public();
  perform tap.ok(position('Věra' in v_list::text) = 0 and position('reserved_by' in v_list::text) = 0,
    'host nevidí, kdo dar zarezervoval');
  perform tap.ok(exists (select 1 from jsonb_array_elements(v_list -> 'items') i
                          where (i ->> 'id')::uuid = v_gift and (i ->> 'reserved')::boolean), 'dar je zabraný');
  perform tap.ok(not se_vezmou.gift_unreserve(v_gift, repeat('0', 36)), 'cizí token rezervaci nezruší');
  perform tap.ok(se_vezmou.gift_unreserve(v_gift, v_token), 'vlastní token rezervaci zruší');
  v_token := se_vezmou.gift_reserve(v_gift, null);
  perform tap.reset();

  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.ok(exists (select 1 from jsonb_array_elements(se_vezmou.admin_gifts_list()) i
                          where (i ->> 'id')::uuid = v_gift and i ->> 'reserved_at' is not null), 'správce vidí rezervaci');
  perform se_vezmou.admin_gift_release(v_gift);
  perform tap.ok(exists (select 1 from jsonb_array_elements(se_vezmou.admin_gifts_list()) i
                          where (i ->> 'id')::uuid = v_gift and i -> 'reserved_at' = 'null'::jsonb), 'správce rezervaci uvolní');
  perform tap.reset();

  -- jiná svatba ani její host dary A nevidí a nemění
  perform tap.become('authenticated', tap.wb(), 'admin', tap.u('B:admin'));
  perform tap.eq(jsonb_array_length(se_vezmou.admin_gifts_list()), 0, 'správce B dary A nevidí');
  perform tap.throws(format('select se_vezmou.admin_gift_delete(%L)', v_gift), 'gift_not_found', 'správce B dar A nesmaže');
  perform tap.throws(format('select se_vezmou.admin_gift_release(%L)', v_gift), 'gift_not_found', 'správce B rezervaci A neuvolní');
  perform tap.reset();
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.throws('select se_vezmou.admin_gifts_list()', '42501', 'návštěvník seznam správce nedostane');
  perform tap.reset();

  -- po svatbě (fáze poděkování) se dary nezobrazují
  update se_vezmou.weddings set phase_override = 'thanks' where id = tap.wa();
  perform tap.become('authenticated', tap.wa(), 'guest_pin');
  perform tap.ok(se_vezmou.gift_list_public() is null, 'po svatbě dary zmizí');
  perform tap.throws(format('select se_vezmou.gift_reserve(%L, null)', v_gift2), 'gift_closed', 'po svatbě nejde rezervovat');
  perform tap.reset();
  update se_vezmou.weddings set phase_override = null where id = tap.wa();

  -- ---------------------------------------------------------------------------
  -- 3. dodavatelé a poznámky
  -- ---------------------------------------------------------------------------
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  v_vendor := se_vezmou.admin_vendor_save(null, jsonb_build_object(
    'category', 'photo', 'name', 'Foto Klára', 'contact', '+420 777 000 111', 'url', 'https://foto.example.test',
    'status', 'booked', 'note', 'Záloha zaplacena'));
  perform tap.eq(jsonb_array_length(se_vezmou.admin_vendors_list()), 1, 'kontakt se uloží');
  perform se_vezmou.admin_vendor_save(v_vendor, jsonb_build_object('category', 'video', 'name', 'Video Matěj'));
  perform tap.ok(se_vezmou.admin_vendors_list() -> 0 ->> 'category' = 'video'
                 and se_vezmou.admin_vendors_list() -> 0 ->> 'status' = 'idea', 'úprava kontaktu');
  perform tap.throws('select se_vezmou.admin_vendor_save(null, ''{"category": "drone", "name": "X"}''::jsonb)',
    'invalid_payload', 'neznámá kategorie');
  perform tap.throws('select se_vezmou.admin_vendor_save(null, ''{"category": "photo", "name": ""}''::jsonb)',
    'invalid_payload', 'kontakt potřebuje jméno');

  perform tap.ok(se_vezmou.admin_notes_get() ->> 'body' = '', 'prázdné poznámky');
  perform tap.eq(se_vezmou.admin_notes_save('Objednat dort do 1. 5.', 0), 1, 'poznámky se uloží');
  perform tap.throws('select se_vezmou.admin_notes_save(''jiný text'', 0)', 'conflict', 'souběžná úprava se odmítne');
  perform tap.throws(format('select se_vezmou.admin_notes_save(%L, 1)', repeat('x', 20001)), 'invalid_payload', 'nejvýš 20 000 znaků');
  perform tap.reset();

  perform tap.become('authenticated', tap.wb(), 'admin', tap.u('B:admin'));
  perform tap.eq(jsonb_array_length(se_vezmou.admin_vendors_list()), 0, 'správce B kontakty A nevidí');
  perform tap.ok(se_vezmou.admin_notes_get() ->> 'body' = '', 'správce B poznámky A nevidí');
  perform tap.throws(format('select se_vezmou.admin_vendor_delete(%L)', v_vendor), 'vendor_not_found', 'správce B kontakt A nesmaže');
  perform tap.reset();
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.throws('select se_vezmou.admin_vendors_list()', '42501', 'návštěvník kontakty nedostane');
  perform tap.throws('select se_vezmou.admin_notes_get()', '42501', 'návštěvník poznámky nedostane');
  perform tap.reset();

  perform tap.ok(not has_table_privilege('authenticated', 'se_vezmou.vendors', 'select')
                 and not has_table_privilege('authenticated', 'se_vezmou.gift_items', 'select')
                 and not has_table_privilege('authenticated', 'se_vezmou.seating_plans', 'select')
                 and not has_table_privilege('authenticated', 'se_vezmou.wedding_notes', 'select'),
    'tabulky bez přímých práv');

  -- ---------------------------------------------------------------------------
  -- 4. retence hostů: usazení a jména u rezervací zmizí, stoly a dary zůstanou
  -- ---------------------------------------------------------------------------
  perform tap.become('authenticated', tap.wa(), 'guest_pin');
  perform se_vezmou.gift_reserve(v_gift2, 'Strýc Karel');
  perform tap.reset();
  update se_vezmou.weddings set guest_purge_at = now() - interval '1 day' where id = tap.wa();
  set local role service_role;
  perform se_vezmou.purge_guest_data();
  perform tap.reset();
  perform tap.ok(not ((select plan from se_vezmou.seating_plans where wedding_id = tap.wa()) ? 'assignments'),
    'retence smaže usazení');
  perform tap.ok(jsonb_array_length((select plan -> 'tables' from se_vezmou.seating_plans where wedding_id = tap.wa())) = 1,
    'stoly zůstanou');
  perform tap.ok((select reserved_by from se_vezmou.gift_items where id = v_gift2) is null
                 and (select reserved_at from se_vezmou.gift_items where id = v_gift2) is not null,
    'retence smaže jméno, rezervace zůstane');
end
$$;

rollback;
