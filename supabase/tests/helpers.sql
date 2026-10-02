-- Pomocné funkce testů (schéma tap) a fixtura se dvěma svatbami A a B.
-- NENASAZUJE SE. scripts/db-test.sh ho spouští po migracích a před testy.
--
-- Konvence: kontrola, která selže, vyvolá výjimku "not ok - ..." (psql končí s chybou);
-- úspěšná kontrola vypíše NOTICE "ok - ...", které runner počítá.

create schema tap;
grant usage on schema tap to public;

create function tap.ok(p_cond boolean, p_msg text) returns void
  language plpgsql as $$
begin
  if p_cond is not true then
    raise exception 'not ok - %', p_msg;
  end if;
  raise notice 'ok - %', p_msg;
end
$$;

create function tap.eq(p_got bigint, p_want bigint, p_msg text) returns void
  language plpgsql as $$
begin
  if p_got is distinct from p_want then
    raise exception 'not ok - %: očekáváno %, získáno %', p_msg, p_want, p_got;
  end if;
  raise notice 'ok - %', p_msg;
end
$$;

-- Příkaz musí selhat. p_expect je SQLSTATE (5 znaků) nebo část textu chyby.
create function tap.throws(p_sql text, p_expect text, p_msg text) returns void
  language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_expect or sqlerrm ilike '%' || p_expect || '%' then
      raise notice 'ok - %', p_msg;
      return;
    end if;
    raise exception 'not ok - %: očekávána chyba %, získána % (%)', p_msg, p_expect, sqlstate, sqlerrm;
  end;
  raise exception 'not ok - %: příkaz neselhal', p_msg;
end
$$;

-- Počet řádků dotazu (select count(*) ...).
create function tap.count(p_sql text) returns bigint
  language plpgsql as $$
declare
  v_n bigint;
begin
  execute p_sql into v_n;
  return v_n;
end
$$;

-- Počet řádků dotčených příkazem insert/update/delete.
create function tap.affected(p_sql text) returns bigint
  language plpgsql as $$
declare
  v_n bigint;
begin
  execute p_sql;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

-- Tabulka je pro aktuální roli neviditelná: buď chybí oprávnění (42501), nebo je výsledek prázdný.
create function tap.invisible(p_table text, p_msg text) returns void
  language plpgsql as $$
declare
  v_n bigint;
begin
  begin
    execute format('select count(*) from %s', p_table) into v_n;
  exception when insufficient_privilege then
    raise notice 'ok - % (bez oprávnění)', p_msg;
    return;
  end;
  if v_n <> 0 then
    raise exception 'not ok - %: role vidí % řádků', p_msg, v_n;
  end if;
  raise notice 'ok - % (0 řádků)', p_msg;
end
$$;

-- Deterministické UUID z textu (pro fixturu).
create function tap.u(p_text text) returns uuid
  language sql immutable as $$ select md5(p_text)::uuid $$;

-- Přepne roli databáze a claimy JWT jako PostgREST.
create function tap.become(p_role text, p_wedding uuid, p_wedding_role text, p_sub uuid default null)
  returns void
  language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', coalesce(p_sub, tap.u('sub:' || coalesce(p_wedding_role, 'none'))),
    'wedding_id', p_wedding,
    'role', 'authenticated',
    'wedding_role', p_wedding_role)::text, true);
  execute format('set local role %I', p_role);
end
$$;

create function tap.reset() returns void
  language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end
$$;

-- ---------------------------------------------------------------------------
-- Fixtura: kompletní data jedné svatby (každá tabulka s wedding_id aspoň jeden řádek).
-- Značka p_tag je 'A' nebo 'B'. Spouští se jako vlastník (obchází RLS).
-- ---------------------------------------------------------------------------
create function tap.seed_wedding(p_tag text, p_slug text, p_a text, p_b text, p_guest1 text, p_guest2 text)
  returns void
  language plpgsql as $$
declare
  w uuid := tap.u(p_tag || ':wedding');
  v_page uuid := tap.u(p_tag || ':page');
  v_venue uuid := tap.u(p_tag || ':venue');
  v_event1 uuid := tap.u(p_tag || ':event1');
  v_event2 uuid := tap.u(p_tag || ':event2');
  v_admin uuid := tap.u(p_tag || ':admin');
  v_version uuid := tap.u(p_tag || ':version');
  v_household uuid := tap.u(p_tag || ':household');
  v_guest1 uuid := tap.u(p_tag || ':guest1');
  v_guest2 uuid := tap.u(p_tag || ':guest2');
  v_response uuid := tap.u(p_tag || ':response');
  v_person uuid := tap.u(p_tag || ':person');
  v_op uuid := tap.u('operator:owner');
begin
  insert into se_vezmou.weddings (id, partner_a_name, partner_b_name, starts_on)
  values (w, p_a, p_b, current_date + 200);
  insert into se_vezmou.slug_registry (slug, state, wedding_id, reserved_until)
  values (p_slug, 'reserved', w, now() + interval '30 days');
  update se_vezmou.weddings set slug = p_slug where id = w;

  insert into se_vezmou.orders (wedding_id) values (w);
  insert into se_vezmou.wedding_admins (id, wedding_id, email)
  values (v_admin, w, lower(p_tag) || '-spravce@example.test');
  insert into se_vezmou.wedding_auth (wedding_id, backup_email, admin_pin_hash, guest_pin_hash)
  values (w, lower(p_tag) || '-zaloha@example.test', 'hash-admin-' || p_tag, 'hash-guest-' || p_tag);
  insert into se_vezmou.wedding_status_history (wedding_id, to_status, actor_type)
  values (w, 'draft', 'system');

  insert into se_vezmou.pages (id, wedding_id, path, title)
  values (v_page, w, '', '{"cs": "Domů", "en": "Home"}');
  insert into se_vezmou.venues (id, wedding_id, name, address)
  values (v_venue, w, '{"cs": "Zámek"}', 'Zámecká 1');
  insert into se_vezmou.events (id, wedding_id, page_id, kind, title, starts_at, venue_id, rsvp_enabled, position)
  values (v_event1, w, v_page, 'ceremony', '{"cs": "Obřad"}', now() + interval '200 days', v_venue, true, 1),
         (v_event2, w, v_page, 'reception', '{"cs": "Hostina"}', now() + interval '200 days 3 hours', v_venue, true, 2);
  insert into se_vezmou.content_blocks (id, wedding_id, page_id, type, position, anchor, sensitive, data)
  values (tap.u(p_tag || ':block1'), w, v_page, 'hero', 1, 'uvod', false, '{"title": {"cs": "Svatba"}}'),
         (tap.u(p_tag || ':block2'), w, v_page, 'gifts', 2, 'darky', true, '{"account": "123456/0100"}');
  insert into se_vezmou.media (id, wedding_id, storage_path, mime, width, height, bytes, alt)
  values (tap.u(p_tag || ':media'), w, w::text || '/foto/1.webp', 'image/webp', 640, 480, 1000, '{"cs": "Pár"}');

  insert into se_vezmou.site_versions (id, wedding_id, version_no, kind, public_content, created_by)
  values (v_version, w, 1, 'publish', ('{"hero": {"title": "Zveřejněno ' || p_tag || '"}}')::jsonb, v_admin);
  insert into se_vezmou.site_version_sensitive (version_id, wedding_id, sensitive_content)
  values (v_version, w, ('{"account": "citlivé ' || p_tag || '"}')::jsonb);

  insert into se_vezmou.households (id, wedding_id, label) values (v_household, w, 'Rodina ' || p_tag);
  insert into se_vezmou.guests (id, wedding_id, household_id, display_name)
  values (v_guest1, w, v_household, p_guest1), (v_guest2, w, v_household, p_guest2);
  insert into se_vezmou.invitations (wedding_id, guest_id, event_id)
  values (w, v_guest1, v_event1), (w, v_guest1, v_event2), (w, v_guest2, v_event1);

  insert into se_vezmou.rsvp_settings (wedding_id, enabled_questions)
  values (w, '{"plus_one": true, "diet": true}');
  insert into se_vezmou.rsvp_questions (wedding_id, key, type, label, event_id)
  values (w, 'song', 'text', '{"cs": "Píseň"}', v_event2);
  insert into se_vezmou.rsvp_responses (id, wedding_id, household_id, answers)
  values (v_response, w, v_household, '{"ubytovani": true}');
  insert into se_vezmou.rsvp_people (id, wedding_id, response_id, guest_id, person_name)
  values (v_person, w, v_response, v_guest1, p_guest1);
  insert into se_vezmou.rsvp_attendance (wedding_id, person_id, event_id, attending)
  values (w, v_person, v_event1, true);
  insert into se_vezmou.rsvp_health (person_id, wedding_id, diet, allergies)
  values (v_person, w, 'vegetariánská', 'ořechy');

  insert into se_vezmou.sessions (token_hash, kind, wedding_id, subject_id, idle_seconds, idle_expires_at, absolute_expires_at)
  values (sha256(convert_to('token-' || p_tag, 'UTF8')), 'admin', w, v_admin, 1209600,
          now() + interval '14 days', now() + interval '60 days');
  insert into se_vezmou.rsvp_tickets (token_hash, wedding_id, household_id, expires_at)
  values (sha256(convert_to('ticket-' || p_tag, 'UTF8')), w, v_household, now() + interval '30 minutes');
  insert into se_vezmou.data_access_grants (wedding_id, granted_by_admin_id, reason, expires_at, revoked_at)
  values (w, v_admin, 'Pomoc s importem', now() + interval '7 days', now());
  insert into se_vezmou.operator_notes (wedding_id, operator_id, body)
  values (w, v_op, 'Poznámka bez osobních údajů ' || p_tag);
  insert into se_vezmou.email_log (wedding_id, type, recipient_hash, recipient_domain)
  values (w, 'login_code', sha256(convert_to('x' || p_tag, 'UTF8')), 'example.test');

  perform se_vezmou.write_audit('operator', v_op, w, 'wedding.status_change', 'wedding', w, 'test',
    jsonb_build_object('from_status', 'draft', 'to_status', 'draft'));
  perform se_vezmou.write_audit('system', null, w, 'retention.purge', 'wedding', w, null,
    jsonb_build_object('kind', 'health', 'rows', 0));

  -- zveřejnění: stav published + zveřejněná verze (spouštěč přepne adresu na active)
  update se_vezmou.weddings set published_version_id = v_version, status = 'published' where id = w;
end
$$;

-- Fixtura: operátoři (vlastník, podpora, zakázaný) a svatby A (Klára a Matěj) a B.
create function tap.seed() returns void
  language plpgsql as $$
begin
  insert into se_vezmou.operators (id, auth_user_id, email, role, disabled_at) values
    (tap.u('operator:owner'), tap.u('auth:owner'), 'majitel@example.test', 'owner', null),
    (tap.u('operator:support'), tap.u('auth:support'), 'podpora@example.test', 'support', null),
    (tap.u('operator:disabled'), tap.u('auth:disabled'), 'zakazany@example.test', 'support', now());

  perform tap.seed_wedding('A', 'klara-a-matej', 'Klára', 'Matěj', 'Jan Novák', 'Marie Nováková');
  perform tap.seed_wedding('B', 'druha-svatba', 'Alena', 'Petr', 'Petr Svoboda', 'Eva Svobodová');

  -- odložené kontroly (slug_registry <-> weddings) ověřit hned
  set constraints all immediate;
end
$$;

-- Identifikátory svateb ve fixtuře
create function tap.wa() returns uuid language sql immutable as $$ select tap.u('A:wedding') $$;
create function tap.wb() returns uuid language sql immutable as $$ select tap.u('B:wedding') $$;

grant execute on all functions in schema tap to public;
