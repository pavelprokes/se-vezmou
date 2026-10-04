-- Heslo na celý web: zamčený web vydá návštěvníkovi jen jména a jazyky, host po PINu a správce vidí vše.
begin;
select tap.seed();

do $$
declare
  v_open jsonb;
  v_locked jsonb;
begin
  perform tap.ok(
    not has_function_privilege('authenticated', 'se_vezmou.get_public_site_unlocked()', 'execute')
    and not has_function_privilege('anon', 'se_vezmou.get_public_site()', 'execute')
    and has_function_privilege('authenticated', 'se_vezmou.get_public_site()', 'execute')
    and not has_function_privilege('service_role', 'se_vezmou.admin_site_lock_set(boolean)', 'execute'),
    'původní tělo je interní, obal má stejná práva jako dřív');

  perform tap.become('authenticated', tap.wa(), 'visitor');
  v_open := se_vezmou.get_public_site();
  perform tap.reset();
  perform tap.ok(v_open ->> 'mode' = 'published', 'bez zámku: návštěvník vidí zveřejněný web');

  -- zamknout jde jen se zapnutým PINem hostů
  update se_vezmou.weddings set guest_pin_enabled = false where id = tap.wa();
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.throws('select se_vezmou.admin_site_lock_set(true)', 'pin_missing', 'bez PINu hostů nejde zamknout');
  perform tap.reset();
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.throws('select se_vezmou.admin_site_lock_set(true)', '42501', 'návštěvník zámek nemění');
  perform tap.reset();

  insert into se_vezmou.wedding_auth (wedding_id, backup_email, guest_pin_hash) values (tap.wa(), 'zaloha@example.test', 'hash')
  on conflict (wedding_id) do update set guest_pin_hash = 'hash';
  update se_vezmou.weddings set guest_pin_enabled = true where id = tap.wa();
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform se_vezmou.admin_site_lock_set(true);
  perform tap.ok(se_vezmou.admin_site_lock_get(), 'zámek je zapnutý');
  perform tap.reset();
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where wedding_id = tap.wa() and action = 'site.locked'),
    'zamčení je v auditu');

  perform tap.become('authenticated', tap.wa(), 'visitor');
  v_locked := se_vezmou.get_public_site();
  perform tap.ok(cardinality(se_vezmou.public_media_ids()) = 0, 'zamčeno: seznam médií je prázdný');
  perform tap.reset();
  perform tap.ok(v_locked ->> 'mode' = 'locked', 'zamčeno: návštěvník dostane režim locked');
  perform tap.ok(not (v_locked ? 'content') and not (v_locked ? 'sensitive'), 'zamčeno: žádný obsah ani citlivá část');
  perform tap.ok(v_locked ? 'locked'
                 and v_locked -> 'locked' -> 'partners' = coalesce(v_open -> 'content' -> 'partners', 'null'::jsonb)
                 and v_locked -> 'locked' -> 'locales' = coalesce(v_open -> 'content' -> 'locales', 'null'::jsonb),
    'zamčeno: jména a jazyky pro bránu');

  perform tap.ok(
    not has_function_privilege('authenticated', 'se_vezmou.get_public_media_unlocked(uuid, integer, text)', 'execute')
    and not has_function_privilege('authenticated', 'se_vezmou.public_media_ids_unlocked()', 'execute')
    and has_function_privilege('authenticated', 'se_vezmou.get_public_media(uuid, integer, text)', 'execute'),
    'původní funkce médií jsou interní, obaly mají stejná práva');

  perform tap.become('authenticated', tap.wa(), 'guest_pin', tap.u('guest-session'));
  perform tap.ok(se_vezmou.get_public_site() ->> 'mode' = 'published', 'host po PINu vidí web');
  perform tap.reset();
  perform tap.become('authenticated', tap.wb(), 'visitor');
  perform tap.ok(se_vezmou.get_public_site() ->> 'mode' is distinct from 'locked', 'zámek svatby A neplatí pro B');
  perform tap.reset();

  -- vypnutý PIN hostů zámek nevynucuje (web by byl nedostupný všem)
  update se_vezmou.weddings set guest_pin_enabled = false where id = tap.wa();
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.ok(se_vezmou.get_public_site() ->> 'mode' = 'published', 'bez zapnutého PINu zámek neplatí');
  perform tap.reset();
end
$$;

rollback;
