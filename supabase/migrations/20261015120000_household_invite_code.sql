-- Osobní odkaz domácnosti (`https://<slug>.se-vezmou.cz/p/<kód>`, QR na pozvánce): otevře formulář RSVP
-- domácnosti bez hledání jména, web v jazyce hosta a program jen s událostmi, na které je pozvaná.
-- Kód je náhodný (20 hex znaků, 80 bitů), platí jen na webu své svatby a správce ho může vyměnit
-- (starý odkaz tím přestane platit). Kód vidí jen správce; hostovi dává stejná práva jako ověření jménem
-- (žádné zdravotní údaje ani e-mail, viz rsvp_get). Zpětně kompatibilní: nový sloupec s výchozí hodnotou,
-- nové funkce, admin_guest_list jen vrací pole navíc.

create function se_vezmou.new_invite_code() returns text
  language sql volatile set search_path = ''
  as $$
  select pg_catalog.substr(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 10)
      || pg_catalog.substr(pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 10)
$$;

revoke all on function se_vezmou.new_invite_code() from public, anon, authenticated, service_role;

-- výchozí hodnota se spočítá pro každou existující domácnost zvlášť (nestálá funkce)
alter table se_vezmou.households
  add column invite_code text not null default se_vezmou.new_invite_code()
    check (invite_code ~ '^[0-9a-f]{20}$');
create unique index households_invite_code_idx on se_vezmou.households (wedding_id, invite_code);

-- ---------------------------------------------------------------------------
-- invite_household: domácnost svatby z claimů podle kódu, nebo null (interní, volají funkce níže)
-- ---------------------------------------------------------------------------
create function se_vezmou.invite_household(p_code text) returns uuid
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
begin
  if v_wedding_id is null or se_vezmou.wedding_role() not in ('visitor', 'guest_pin')
     or p_code is null or p_code !~ '^[0-9a-f]{20}$' then
    return null;
  end if;
  if not exists (select 1 from se_vezmou.weddings w where w.id = v_wedding_id and w.deleted_at is null) then
    return null;
  end if;
  return (select h.id from se_vezmou.households h where h.wedding_id = v_wedding_id and h.invite_code = p_code);
end
$$;

revoke all on function se_vezmou.invite_household(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- rsvp_invite_info: platí kód? Jazyk hosta (první vyplněný v domácnosti), události s potvrzováním na webu
-- a ty z nich, na které je domácnost pozvaná (program podle hosta). Funguje v každé fázi, i po uzavření RSVP.
-- ---------------------------------------------------------------------------
create function se_vezmou.rsvp_invite_info(p_code text) returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_household uuid := se_vezmou.invite_household(p_code);
begin
  if v_household is null then
    return null;
  end if;
  return jsonb_build_object(
    'locale', (select g.locale from se_vezmou.guests g
                where g.household_id = v_household and g.locale is not null
                order by g.created_at, g.id limit 1),
    'event_ids', (
      select coalesce(jsonb_agg(distinct i.event_id), '[]'::jsonb)
        from se_vezmou.invitations i
        join se_vezmou.guests g on g.id = i.guest_id and g.wedding_id = i.wedding_id
       where g.household_id = v_household),
    'rsvp_event_ids', (
      select coalesce(jsonb_agg(e.id), '[]'::jsonb)
        from se_vezmou.events e
       where e.wedding_id = se_vezmou.wedding_id() and e.rsvp_enabled));
end
$$;

-- ---------------------------------------------------------------------------
-- rsvp_invite_get: formulář domácnosti kódu pro vykreslení stránky (jen čtení, nic nezapisuje), stejný pohled
-- jako rsvp_get (bez zdravotních údajů a e-mailu); null pro neplatný kód a mimo otevřené RSVP.
-- ---------------------------------------------------------------------------
create function se_vezmou.rsvp_invite_get(p_code text) returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_household uuid := se_vezmou.invite_household(p_code);
  w se_vezmou.weddings;
begin
  if v_household is null then
    return null;
  end if;
  select * into w from se_vezmou.weddings x where x.id = se_vezmou.wedding_id();
  if se_vezmou.phase(w) is distinct from 'rsvp_open' then
    return null;
  end if;
  return se_vezmou.rsvp_guest_view(se_vezmou.rsvp_household_view(v_household));
end
$$;

-- ---------------------------------------------------------------------------
-- rsvp_invite_ticket: lístek RSVP (30 minut, jako po ověření jména) pro domácnost kódu; null pro neplatný
-- kód a mimo otevřené RSVP. Vydává se jen při odeslání odpovědi (omezené počtem odeslání), ne při zobrazení.
-- ---------------------------------------------------------------------------
create function se_vezmou.rsvp_invite_ticket(p_code text) returns text
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
  v_household uuid := se_vezmou.invite_household(p_code);
  w se_vezmou.weddings;
  v_token text;
begin
  if v_household is null then
    return null;
  end if;
  select * into w from se_vezmou.weddings x where x.id = v_wedding_id;
  if se_vezmou.phase(w) is distinct from 'rsvp_open' then
    return null;
  end if;
  v_token := pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')
          || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
  insert into se_vezmou.rsvp_tickets (token_hash, wedding_id, household_id, expires_at, purpose)
  values (pg_catalog.sha256(pg_catalog.convert_to(v_token, 'UTF8')), v_wedding_id, v_household,
          pg_catalog.now() + interval '30 minutes', 'edit');
  return v_token;
end
$$;

-- ---------------------------------------------------------------------------
-- admin_household_invite_reset: nový kód domácnosti (starý odkaz a QR přestanou platit)
-- ---------------------------------------------------------------------------
create function se_vezmou.admin_household_invite_reset(p_household_id uuid) returns text
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
  v_code text;
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update se_vezmou.households h set invite_code = se_vezmou.new_invite_code()
   where h.id = p_household_id and h.wedding_id = v_wedding_id
  returning h.invite_code into v_code;
  if v_code is null then
    raise exception 'household_not_found' using errcode = 'P0002';
  end if;
  perform se_vezmou.write_audit('admin', se_vezmou.actor_id(), v_wedding_id, 'guests.invite_reset',
    'household', p_household_id, null, '{}'::jsonb);
  return v_code;
end
$$;

revoke all on function
  se_vezmou.rsvp_invite_get(text),
  se_vezmou.rsvp_invite_info(text),
  se_vezmou.rsvp_invite_ticket(text),
  se_vezmou.admin_household_invite_reset(uuid)
  from public, anon, service_role;
grant execute on function
  se_vezmou.rsvp_invite_get(text),
  se_vezmou.rsvp_invite_info(text),
  se_vezmou.rsvp_invite_ticket(text),
  se_vezmou.admin_household_invite_reset(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- admin_guest_list: jako v 20261014120000_household_tags.sql, navíc kód osobního odkazu
-- ---------------------------------------------------------------------------
create or replace function se_vezmou.admin_guest_list() returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'events', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'kind', e.kind, 'title', e.title, 'starts_at', e.starts_at,
        'rsvp_enabled', e.rsvp_enabled) order by e.position, e.starts_at), '[]'::jsonb)
        from se_vezmou.events e where e.wedding_id = v_wedding_id),
    'households', (
      select coalesce(jsonb_agg(x.j order by x.label, x.created_at, x.id), '[]'::jsonb)
        from (
          select h.label, h.created_at, h.id, jsonb_build_object(
            'id', h.id, 'label', h.label, 'invited_note', h.invited_note, 'tags', to_jsonb(h.tags), 'invite_code', h.invite_code,
            'guests', (
              select coalesce(jsonb_agg(jsonb_build_object(
                'id', g.id, 'display_name', g.display_name, 'is_child', g.is_child, 'age', g.age,
                'is_plus_one', g.is_plus_one, 'source', g.source,
                'invited_event_ids', (
                  select coalesce(jsonb_agg(i.event_id order by i.event_id), '[]'::jsonb)
                    from se_vezmou.invitations i where i.guest_id = g.id and i.wedding_id = g.wedding_id),
                'attendance', (
                  select coalesce(jsonb_agg(jsonb_build_object('event_id', a.event_id, 'attending', a.attending)
                                            order by a.event_id), '[]'::jsonb)
                    from se_vezmou.rsvp_people p
                    join se_vezmou.rsvp_attendance a on a.person_id = p.id and a.wedding_id = p.wedding_id
                   where p.guest_id = g.id and p.wedding_id = g.wedding_id)
              ) order by g.created_at, g.id), '[]'::jsonb)
                from se_vezmou.guests g where g.household_id = h.id and g.wedding_id = h.wedding_id),
            'response', (
              select jsonb_build_object(
                'id', r.id, 'submitted_at', r.submitted_at, 'last_edited_at', r.last_edited_at,
                'entered_by', r.entered_by, 'has_email', r.contact_email is not null,
                'attending', exists (
                  select 1 from se_vezmou.rsvp_people p
                    join se_vezmou.rsvp_attendance a on a.person_id = p.id and a.wedding_id = p.wedding_id
                   where p.response_id = r.id and p.wedding_id = r.wedding_id and a.attending))
                from se_vezmou.rsvp_responses r
               where r.household_id = h.id and r.wedding_id = h.wedding_id)
          ) as j
          from se_vezmou.households h where h.wedding_id = v_wedding_id
        ) x),
    -- odpovědi hostů mimo seznam (bez domácnosti)
    'unlisted', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'submitted_at', r.submitted_at,
        'people', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'person_name', p.person_name, 'is_child', p.is_child, 'age', p.age,
            'attendance', (
              select coalesce(jsonb_agg(jsonb_build_object('event_id', a.event_id, 'attending', a.attending)
                                        order by a.event_id), '[]'::jsonb)
                from se_vezmou.rsvp_attendance a where a.person_id = p.id and a.wedding_id = p.wedding_id))
            order by p.created_at, p.id), '[]'::jsonb)
            from se_vezmou.rsvp_people p where p.response_id = r.id and p.wedding_id = r.wedding_id))
        order by r.submitted_at, r.id), '[]'::jsonb)
        from se_vezmou.rsvp_responses r where r.wedding_id = v_wedding_id and r.household_id is null)
  );
end
$$;

