-- Opravy po revizi kódu (fáze 1): zdravotní údaje a e-mail v RSVP hosta, aktivita konceptu a obnovitelný
-- úklid opuštěných konceptů (migrace 20261012120000_rsvp_guest_privacy, 20261012120100_draft_activity).
begin;
select tap.seed();

-- ---------------------------------------------------------------------------
-- rsvp_submit: uložené zdravotní údaje a e-mail, které host neviděl, zůstanou jen s keep_*
-- ---------------------------------------------------------------------------
do $$
declare
  v_ticket text;
  g1 uuid := tap.u('A:guest1');
  e1 uuid := tap.u('A:event1');
  e2 uuid := tap.u('A:event2');
  v_att jsonb := jsonb_build_array(jsonb_build_object('event_id', e1, 'attending', true),
                                   jsonb_build_object('event_id', e2, 'attending', true));
begin
  update se_vezmou.rsvp_settings set email_confirmation = true where wedding_id = tap.wa();
  update se_vezmou.rsvp_responses set contact_email = 'jan@example.test' where wedding_id = tap.wa();

  perform tap.become('authenticated', tap.wa(), 'visitor');
  select ticket into v_ticket from se_vezmou.rsvp_match('Jan Novák');
  perform tap.ok((se_vezmou.rsvp_get(v_ticket) #>> '{response,has_email}')::boolean,
    'pohled hosta nese příznak uloženého e-mailu');
  perform tap.ok(se_vezmou.rsvp_get(v_ticket)::text not like '%jan@example.test%', 'pohled hosta e-mail neobsahuje');

  -- úprava bez nových údajů s keep_health a keep_email: hodnoty zůstanou
  perform se_vezmou.rsvp_submit(v_ticket, jsonb_build_object('keep_email', true, 'people', jsonb_build_array(
    jsonb_build_object('guest_id', g1, 'keep_health', true, 'attendance', v_att))));
  perform tap.reset();
  perform tap.ok((select diet = 'vegetariánská' and allergies = 'ořechy' from se_vezmou.rsvp_health
                   where wedding_id = tap.wa()), 'keep_health ponechá dietu i alergie');
  perform tap.ok((select contact_email = 'jan@example.test' from se_vezmou.rsvp_responses where wedding_id = tap.wa()),
    'keep_email ponechá e-mail pro potvrzení');

  -- nová hodnota má přednost před keep_health
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform se_vezmou.rsvp_submit(v_ticket, jsonb_build_object('people', jsonb_build_array(
    jsonb_build_object('guest_id', g1, 'keep_health', true, 'diet', 'vegan', 'attendance', v_att))));
  perform tap.reset();
  perform tap.ok((select diet = 'vegan' and allergies is null from se_vezmou.rsvp_health where wedding_id = tap.wa()),
    'vyplněná dieta nahradí uložené údaje');
  perform tap.ok((select contact_email is null from se_vezmou.rsvp_responses where wedding_id = tap.wa()),
    'bez keep_email a bez nového e-mailu se e-mail smaže');

  -- bez příznaku (host údaje smazal) se nic neponechá
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform se_vezmou.rsvp_submit(v_ticket, jsonb_build_object('people', jsonb_build_array(
    jsonb_build_object('guest_id', g1, 'attendance', v_att))));
  perform tap.reset();
  perform tap.eq((select count(*) from se_vezmou.rsvp_health where wedding_id = tap.wa()), 0,
    'bez keep_health se uložené údaje smažou');

  -- vypnutá dieta: keep_health nic neobnoví
  insert into se_vezmou.rsvp_health (person_id, wedding_id, diet)
    select p.id, tap.wa(), 'bez lepku' from se_vezmou.rsvp_people p where p.wedding_id = tap.wa() and p.guest_id = g1;
  update se_vezmou.rsvp_settings set enabled_questions = '{"plus_one": true}' where wedding_id = tap.wa();
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform se_vezmou.rsvp_submit(v_ticket, jsonb_build_object('people', jsonb_build_array(
    jsonb_build_object('guest_id', g1, 'keep_health', true, 'attendance', v_att))));
  perform tap.reset();
  perform tap.eq((select count(*) from se_vezmou.rsvp_health where wedding_id = tap.wa()), 0,
    'při vypnuté dietě se zdravotní údaje neobnoví');
end
$$;

-- doprovod: uložené údaje se ponechají podle jména
do $$
declare
  v_ticket text;
  g1 uuid := tap.u('A:guest1');
  e1 uuid := tap.u('A:event1');
  v_att jsonb := jsonb_build_array(jsonb_build_object('event_id', e1, 'attending', true));
begin
  update se_vezmou.rsvp_settings set enabled_questions = '{"plus_one": true, "diet": true}' where wedding_id = tap.wa();
  perform tap.become('authenticated', tap.wa(), 'visitor');
  select ticket into v_ticket from se_vezmou.rsvp_match('Jan Novák');
  perform se_vezmou.rsvp_submit(v_ticket, jsonb_build_object('people', jsonb_build_array(
    jsonb_build_object('guest_id', g1, 'attendance', v_att),
    jsonb_build_object('guest_id', null, 'person_name', 'Doprovod Hosta', 'allergies', 'laktóza', 'attendance', v_att))));
  perform se_vezmou.rsvp_submit(v_ticket, jsonb_build_object('people', jsonb_build_array(
    jsonb_build_object('guest_id', g1, 'attendance', v_att),
    jsonb_build_object('guest_id', null, 'person_name', 'Doprovod Hosta', 'keep_health', true, 'attendance', v_att))));
  perform tap.reset();
  perform tap.ok((select h.allergies = 'laktóza' from se_vezmou.rsvp_health h
                    join se_vezmou.rsvp_people p on p.id = h.person_id
                   where p.wedding_id = tap.wa() and p.person_name = 'Doprovod Hosta'),
    'keep_health u doprovodu ponechá jeho alergie');
end
$$;

-- ---------------------------------------------------------------------------
-- Aktivita konceptu: hosté, nastavení RSVP a přihlášení správce
-- ---------------------------------------------------------------------------
do $$
declare
  v_old timestamptz := now() - interval '20 days';
begin
  update se_vezmou.weddings set last_activity_at = v_old where id = tap.wa();
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', tap.u('A:admin'), 'wedding_id', tap.wa(), 'role', 'authenticated', 'wedding_role', 'admin')::text, true);
  insert into se_vezmou.households (wedding_id, label) values (tap.wa(), 'Nová domácnost');
  perform tap.reset();
  perform tap.ok((select last_activity_at > now() - interval '1 minute' from se_vezmou.weddings where id = tap.wa()),
    'úprava seznamu hostů správcem je aktivita');

  update se_vezmou.weddings set last_activity_at = v_old where id = tap.wa();
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', tap.u('A:admin'), 'wedding_id', tap.wa(), 'role', 'authenticated', 'wedding_role', 'admin')::text, true);
  update se_vezmou.rsvp_settings set allow_unlisted = true where wedding_id = tap.wa();
  perform tap.reset();
  perform tap.ok((select last_activity_at > now() - interval '1 minute' from se_vezmou.weddings where id = tap.wa()),
    'změna nastavení RSVP správcem je aktivita');

  update se_vezmou.weddings set last_activity_at = v_old where id = tap.wa();
  insert into se_vezmou.sessions (token_hash, kind, wedding_id, subject_id, idle_seconds, idle_expires_at, absolute_expires_at)
  values (sha256(convert_to('token-login-A', 'UTF8')), 'admin', tap.wa(), tap.u('A:admin'), 1209600,
          now() + interval '14 days', now() + interval '60 days');
  perform tap.ok((select last_activity_at > now() - interval '1 minute' from se_vezmou.weddings where id = tap.wa()),
    'přihlášení správce je aktivita');

  -- úklid (bez claims správce) aktivitu nezakládá
  update se_vezmou.weddings set last_activity_at = v_old where id = tap.wa();
  update se_vezmou.households set label = 'Úklid' where wedding_id = tap.wa() and label = 'Nová domácnost';
  perform tap.ok((select last_activity_at < now() - interval '19 days' from se_vezmou.weddings where id = tap.wa()),
    'změna hostů mimo relaci správce aktivitu nezakládá');
end
$$;

-- ---------------------------------------------------------------------------
-- Opuštěný koncept: obnovitelný a po obnovení se hned znovu nesmaže
-- ---------------------------------------------------------------------------
do $$
declare
  v_draft uuid := tap.u('d:restored');
  v_res jsonb;
begin
  insert into se_vezmou.weddings (id, partner_a_name, partner_b_name) values (v_draft, 'Obnovená', 'Svatba');
  update se_vezmou.weddings set last_activity_at = now() - interval '40 days' where id = v_draft;
  insert into se_vezmou.wedding_status_history (wedding_id, from_status, to_status, actor_type, reason, created_at)
  values (v_draft, 'deleted', 'draft', 'operator', 'restore', now() - interval '1 day');

  set local role service_role;
  v_res := se_vezmou.housekeeping();
  perform tap.reset();
  perform tap.ok((select status from se_vezmou.weddings where id = v_draft) = 'draft',
    'koncept obnovený operátorem se před uplynutím lhůty nečinnosti znovu nesmaže');
end
$$;

rollback;
