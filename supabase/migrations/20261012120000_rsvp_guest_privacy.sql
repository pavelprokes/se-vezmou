-- Oprava po revizi kódu: host ověřený jen jménem (lístek z rsvp_match) nevidí zdravotní údaje ani e-mail
-- z dřívější odpovědi domácnosti. Lístek dostane každý, kdo zná jméno hosta, takže dieta, alergie a kontaktní
-- e-mail z `rsvp_get` mohly vyčíst cizí lidé. Host teď dostane jen příznaky `has_health` a `has_email`;
-- při úpravě odpovědi pole nechá prázdná a s `keep_health` / `keep_email` se uložené hodnoty zachovají
-- (`rsvp_submit`). Správce (`admin_rsvp_household`) vidí dál všechno pro předvyplnění ručního zápisu.

-- ---------------------------------------------------------------------------
-- rsvp_guest_view: pohled domácnosti pro hosta bez zdravotních údajů a e-mailu
-- ---------------------------------------------------------------------------
create function se_vezmou.rsvp_guest_view(p_view jsonb) returns jsonb
  language sql immutable set search_path = ''
  as $$
  select case
    when p_view is null or pg_catalog.jsonb_typeof(p_view -> 'response') is distinct from 'object' then p_view
    else pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(
        pg_catalog.jsonb_set(
          p_view,
          '{response,people}',
          coalesce((
            select pg_catalog.jsonb_agg(
                     (e.p - 'diet' - 'allergies')
                     || pg_catalog.jsonb_build_object(
                          'diet', null,
                          'allergies', null,
                          'has_health', coalesce(e.p ->> 'diet', e.p ->> 'allergies') is not null)
                     order by e.ord)
              from pg_catalog.jsonb_array_elements(p_view -> 'response' -> 'people') with ordinality as e (p, ord)
          ), '[]'::jsonb)),
        '{response,has_email}',
        pg_catalog.to_jsonb((p_view -> 'response' ->> 'contact_email') is not null)),
      '{response,contact_email}',
      'null'::jsonb)
  end
$$;

revoke all on function se_vezmou.rsvp_guest_view(jsonb) from public, anon;

-- ---------------------------------------------------------------------------
-- rsvp_get: dřívější odpověď pro hosta jen bez zdravotních údajů a e-mailu
-- ---------------------------------------------------------------------------
create or replace function se_vezmou.rsvp_get(p_ticket text) returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_household uuid := se_vezmou.ticket_household(p_ticket);
begin
  if v_household is null then
    return null;
  end if;
  return se_vezmou.rsvp_guest_view(se_vezmou.rsvp_household_view(v_household));
end
$$;

-- ---------------------------------------------------------------------------
-- rsvp_submit: úprava odpovědi zachová uložené zdravotní údaje a e-mail, které host neviděl.
-- Osoba z payloadu s `keep_health: true` a bez nové diety i alergií dostane údaje své dřívější odpovědi:
-- host ze seznamu podle guest_id, doprovod a dítě podle původního jména (`health_name`, jinak současného),
-- příznaku dítěte a pořadí mezi stejnojmennými. Osoby payloadu odpovídají novým řádkům v pořadí, v jakém je
-- rsvp_apply vložil. `keep_email: true` bez nového e-mailu ponechá dřívější kontaktní e-mail a funkce ho vrátí
-- serveru jako `kept_email` (kvůli potvrzení e-mailem; prohlížeči se nikdy neposílá).
-- Nový nebo prázdný údaj bez příznaku platí jako dřív.
-- ---------------------------------------------------------------------------
create or replace function se_vezmou.rsvp_submit(p_ticket text, p_payload jsonb) returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
  v_household uuid := se_vezmou.ticket_household(p_ticket);
  w se_vezmou.weddings;
  v_response_id uuid;
  v_old_health jsonb;
  v_old_email extensions.citext;
  v_diet_on boolean;
  v_email_on boolean;
begin
  if v_household is null then
    raise exception 'invalid_ticket' using errcode = '28000';
  end if;

  select * into w from se_vezmou.weddings x where x.id = v_wedding_id and x.deleted_at is null;
  if not found or se_vezmou.phase(w) is distinct from 'rsvp_open' then
    raise exception 'rsvp_closed' using errcode = '55000';
  end if;

  -- dřívější údaje, které host po ověření jménem nevidí (rsvp_apply osoby nahrazuje)
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'guest_id', o.guest_id, 'name', o.person_name, 'is_child', o.is_child, 'rn', o.rn,
           'diet', o.diet, 'allergies', o.allergies)), '[]'::jsonb)
    into v_old_health
    from (
      select p.guest_id, p.person_name, p.is_child, h.diet, h.allergies,
             pg_catalog.row_number() over (
               partition by p.guest_id, case when p.guest_id is null then p.person_name end, p.is_child
               order by p.created_at, p.id) as rn
        from se_vezmou.rsvp_responses r
        join se_vezmou.rsvp_people p on p.wedding_id = r.wedding_id and p.response_id = r.id
        left join se_vezmou.rsvp_health h on h.person_id = p.id
       where r.wedding_id = v_wedding_id and r.household_id = v_household
    ) o
   where o.diet is not null or o.allergies is not null;
  select r.contact_email into v_old_email
    from se_vezmou.rsvp_responses r
   where r.wedding_id = v_wedding_id and r.household_id = v_household;

  v_response_id := se_vezmou.rsvp_apply(v_wedding_id, v_household, p_payload, 'guest');

  -- zdravotní údaje jen při zapnuté dietě (stejně jako rsvp_apply)
  select coalesce((s.enabled_questions ->> 'diet')::boolean, false), s.email_confirmation
    into v_diet_on, v_email_on
    from se_vezmou.rsvp_settings s where s.wedding_id = v_wedding_id;
  if coalesce(v_diet_on, false) then
    insert into se_vezmou.rsvp_health (person_id, wedding_id, diet, allergies)
    with n as (
      select np.id, np.guest_id, np.is_child, np.person_name,
             pg_catalog.row_number() over (order by np.created_at, np.id) as pos
        from se_vezmou.rsvp_people np
       where np.wedding_id = v_wedding_id and np.response_id = v_response_id
    ), k as (
      select n.id, n.guest_id, n.is_child, n.pos,
             coalesce(nullif(pg_catalog.btrim(pp.v ->> 'health_name'), ''), n.person_name) as hname,
             (pp.v ->> 'keep_health') = 'true'
               and nullif(pg_catalog.btrim(coalesce(pp.v ->> 'diet', '')), '') is null
               and nullif(pg_catalog.btrim(coalesce(pp.v ->> 'allergies', '')), '') is null as keep
        from n
        join pg_catalog.jsonb_array_elements(p_payload -> 'people') with ordinality as pp (v, ord)
          on pp.ord = n.pos
    ), r as (
      select k.*, pg_catalog.row_number() over (
               partition by k.guest_id, case when k.guest_id is null then k.hname end, k.is_child
               order by k.pos) as rn
        from k
    )
    select r.id, v_wedding_id, o ->> 'diet', o ->> 'allergies'
      from r
      join pg_catalog.jsonb_array_elements(v_old_health) as o
        on (o ->> 'rn')::bigint = r.rn
       and (o ->> 'is_child')::boolean = r.is_child
       and case
             when r.guest_id is not null then se_vezmou.try_uuid(o ->> 'guest_id') = r.guest_id
             else (o ->> 'guest_id') is null and o ->> 'name' = r.hname
           end
     where r.keep
       and not exists (select 1 from se_vezmou.rsvp_health h where h.person_id = r.id);
  end if;

  -- e-mail jen při zapnutém potvrzení e-mailem (jinak ho rsvp_apply neukládá)
  if v_old_email is not null and coalesce(v_email_on, false) and (p_payload ->> 'keep_email') = 'true'
     and nullif(pg_catalog.btrim(coalesce(p_payload ->> 'contact_email', '')), '') is null then
    update se_vezmou.rsvp_responses r set contact_email = v_old_email
     where r.wedding_id = v_wedding_id and r.id = v_response_id;
    return jsonb_build_object('ok', true, 'response_id', v_response_id, 'kept_email', v_old_email::text);
  end if;

  return jsonb_build_object('ok', true, 'response_id', v_response_id);
end
$$;
