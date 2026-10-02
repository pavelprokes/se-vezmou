-- M10 / 4: data pro operátorský dohled (M9 z nich postaví rozhraní) a export hostů a RSVP (FR-LC-2).
--
-- Operátorské funkce (op_*) ověřují operátora, jako ostatní. Export volá správce svatby (role authenticated,
-- wedding_role admin): vždy jen svá data, s auditem bez osobních údajů a evidencí exported_at u zdravotních údajů.

-- ---------------------------------------------------------------------------
-- Poslední běh každé plánované úlohy (dohled): stav, počty, poslední úspěch, počet selhání za 7 dní
-- ---------------------------------------------------------------------------
create function se_vezmou.op_job_runs_summary(p_operator_id uuid, p_now timestamptz default pg_catalog.now())
  returns table (
    job text, last_started_at timestamptz, last_finished_at timestamptz, last_status text,
    last_counts jsonb, last_error_code text, last_ok_at timestamptz, failures_7d integer, running boolean
  )
  language plpgsql stable security definer set search_path = ''
  as $$
#variable_conflict use_column
begin
  perform se_vezmou.assert_operator(p_operator_id, array['owner', 'support']);
  return query
  select j.job, l.started_at, l.finished_at, l.status, l.counts, l.error_code,
         (select max(o.finished_at) from se_vezmou.job_runs o where o.job = j.job and o.status = 'ok'),
         (select count(*)::integer from se_vezmou.job_runs f
           where f.job = j.job and f.status in ('failed', 'partial')
             and f.started_at > p_now - interval '7 days'),
         exists (select 1 from se_vezmou.job_runs r where r.job = j.job and r.status = 'running')
    from (select distinct r.job from se_vezmou.job_runs r) j
    cross join lateral (
      select r.started_at, r.finished_at, r.status, r.counts, r.error_code
        from se_vezmou.job_runs r where r.job = j.job order by r.started_at desc limit 1) l
   order by j.job;
end
$$;

-- Seznam posledních běhů (nejnovější první), volitelně jedné úlohy
create function se_vezmou.op_job_runs(p_operator_id uuid, p_limit integer default 30, p_job text default null)
  returns table (
    id uuid, job text, started_at timestamptz, finished_at timestamptz, clock_at timestamptz,
    status text, counts jsonb, error_code text
  )
  language plpgsql stable security definer set search_path = ''
  as $$
#variable_conflict use_column
begin
  perform se_vezmou.assert_operator(p_operator_id, array['owner', 'support']);
  return query
  select r.id, r.job, r.started_at, r.finished_at, r.clock_at, r.status, r.counts, r.error_code
    from se_vezmou.job_runs r
   where p_job is null or r.job = p_job
   order by r.started_at desc, r.id
   limit least(greatest(coalesce(p_limit, 30), 1), 200);
end
$$;

-- ---------------------------------------------------------------------------
-- Weby před vypršením a mazáním (seznam pro operátora): události do p_within_days dní od p_now
-- a také zpožděné (po termínu a ještě nezpracované), s evidencí odeslaných upozornění.
-- days_left je záporné u zpožděných. Jména párů jsou v seznamu stejně jako v ostatních operátorských
-- seznamech; údaje hostů ne.
-- ---------------------------------------------------------------------------
create function se_vezmou.op_expiring_weddings(
  p_operator_id uuid,
  p_within_days integer default 60,
  p_now timestamptz default pg_catalog.now()
) returns table (
  wedding_id uuid, slug text, status text, partner_a_name text, partner_b_name text,
  kind text, event_at timestamptz, days_left integer, overdue boolean,
  first_notice_status text, first_notice_sent_at timestamptz,
  final_notice_status text, final_notice_sent_at timestamptz,
  phase_override text
)
  language plpgsql stable security definer set search_path = ''
  as $$
#variable_conflict use_column
begin
  perform se_vezmou.assert_operator(p_operator_id, array['owner', 'support']);
  if p_within_days is null or p_within_days < 0 then
    raise exception 'invalid_range' using errcode = '22023';
  end if;
  return query
  select w.id, w.slug, w.status, w.partner_a_name, w.partner_b_name, e.kind, e.event_at,
         pg_catalog.floor(extract(epoch from (e.event_at - p_now)) / 86400)::integer,
         e.event_at <= p_now,
         f.status, f.sent_at, l.status, l.sent_at,
         w.phase_override
    from se_vezmou.lifecycle_events() e
    join se_vezmou.weddings w on w.id = e.wedding_id
    left join se_vezmou.lifecycle_notices f
      on f.wedding_id = e.wedding_id and f.kind = e.kind and f.event_at = e.event_at and f.stage = 'first'
    left join se_vezmou.lifecycle_notices l
      on l.wedding_id = e.wedding_id and l.kind = e.kind and l.event_at = e.event_at and l.stage = 'final'
   where e.event_at is not null and e.event_at <= p_now + pg_catalog.make_interval(days => p_within_days)
   order by e.event_at, w.id, e.kind;
end
$$;

-- ---------------------------------------------------------------------------
-- Export hostů a RSVP (FR-LC-2): jeden řádek na osobu (host ze seznamu, doprovod, dítě doplněné při RSVP,
-- host mimo seznam) se seznamem událostí a otázek pro záhlaví. Zdravotní údaje (dieta, alergie) jen na
-- výslovnou žádost; jejich vydání se eviduje (rsvp_health.exported_at) a auditem. Volá správce svatby,
-- vždy se jen svá data (wedding_id z claimů), žádný veřejný odkaz.
-- ---------------------------------------------------------------------------
create function se_vezmou.admin_export_guests(p_include_health boolean default false) returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
  v_people jsonb;
  v_count integer;
  v_result jsonb;
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from se_vezmou.weddings w where w.id = v_wedding_id and w.deleted_at is null) then
    raise exception 'wedding_not_found' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(x.j order by x.s1, x.s2, x.s3), '[]'::jsonb), count(*)::integer
    into v_people, v_count
    from (
      select h.label as s1, g.created_at as s2, g.id as s3, jsonb_build_object(
          'household', h.label,
          'name', g.display_name,
          'kind', case when g.is_child then 'child' when g.is_plus_one then 'plus_one' else 'guest' end,
          'age', g.age,
          'invited_event_ids', (
            select coalesce(jsonb_agg(i.event_id order by i.event_id), '[]'::jsonb)
              from se_vezmou.invitations i where i.guest_id = g.id and i.wedding_id = g.wedding_id),
          'answered', p.id is not null,
          'attendance', coalesce((
            select jsonb_agg(jsonb_build_object('event_id', a.event_id, 'attending', a.attending)
                             order by a.event_id)
              from se_vezmou.rsvp_attendance a
             where a.person_id = p.id and a.wedding_id = p.wedding_id), '[]'::jsonb),
          'submitted_at', r.submitted_at,
          'entered_by', r.entered_by,
          'contact_email', r.contact_email,
          'answers', coalesce(r.answers, '{}'::jsonb),
          'diet', case when p_include_health then hl.diet end,
          'allergies', case when p_include_health then hl.allergies end) as j
        from se_vezmou.guests g
        join se_vezmou.households h on h.id = g.household_id and h.wedding_id = g.wedding_id
        left join se_vezmou.rsvp_people p on p.guest_id = g.id and p.wedding_id = g.wedding_id
        left join se_vezmou.rsvp_responses r on r.id = p.response_id and r.wedding_id = p.wedding_id
        left join se_vezmou.rsvp_health hl on hl.person_id = p.id and hl.wedding_id = p.wedding_id
       where g.wedding_id = v_wedding_id
      union all
      select coalesce(h.label, ''), p.created_at, p.id, jsonb_build_object(
          'household', h.label,
          'name', p.person_name,
          'kind', case when r.household_id is null then 'unlisted' when p.is_child then 'child' else 'plus_one' end,
          'age', p.age,
          'invited_event_ids', '[]'::jsonb,
          'answered', true,
          'attendance', coalesce((
            select jsonb_agg(jsonb_build_object('event_id', a.event_id, 'attending', a.attending)
                             order by a.event_id)
              from se_vezmou.rsvp_attendance a
             where a.person_id = p.id and a.wedding_id = p.wedding_id), '[]'::jsonb),
          'submitted_at', r.submitted_at,
          'entered_by', r.entered_by,
          'contact_email', r.contact_email,
          'answers', coalesce(r.answers, '{}'::jsonb),
          'diet', case when p_include_health then hl.diet end,
          'allergies', case when p_include_health then hl.allergies end)
        from se_vezmou.rsvp_people p
        join se_vezmou.rsvp_responses r on r.id = p.response_id and r.wedding_id = p.wedding_id
        left join se_vezmou.households h on h.id = r.household_id and h.wedding_id = r.wedding_id
        left join se_vezmou.rsvp_health hl on hl.person_id = p.id and hl.wedding_id = p.wedding_id
       where p.wedding_id = v_wedding_id and p.guest_id is null
    ) x;

  v_result := jsonb_build_object(
    'wedding', (
      select jsonb_build_object('partner_a_name', w.partner_a_name, 'partner_b_name', w.partner_b_name,
                                'starts_on', w.starts_on, 'default_locale', w.default_locale)
        from se_vezmou.weddings w where w.id = v_wedding_id),
    'include_health', p_include_health,
    'events', (
      select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'starts_at', e.starts_at)
                                order by e.position, e.starts_at), '[]'::jsonb)
        from se_vezmou.events e where e.wedding_id = v_wedding_id and e.rsvp_enabled),
    'questions', (
      select coalesce(jsonb_agg(jsonb_build_object('key', q.key, 'type', q.type, 'label', q.label)
                                order by q.position, q.key), '[]'::jsonb)
        from se_vezmou.rsvp_questions q where q.wedding_id = v_wedding_id),
    'people', v_people);

  if p_include_health then
    update se_vezmou.rsvp_health hl set exported_at = pg_catalog.now() where hl.wedding_id = v_wedding_id;
  end if;
  perform se_vezmou.write_audit('admin', se_vezmou.actor_id(), v_wedding_id, 'export.guests', 'wedding',
    v_wedding_id, null, jsonb_build_object('people', v_count, 'include_health', p_include_health));
  return v_result;
end
$$;

revoke all on function
  se_vezmou.op_job_runs_summary(uuid, timestamptz),
  se_vezmou.op_job_runs(uuid, integer, text),
  se_vezmou.op_expiring_weddings(uuid, integer, timestamptz),
  se_vezmou.admin_export_guests(boolean)
  from public, anon;

grant execute on function
  se_vezmou.op_job_runs_summary(uuid, timestamptz),
  se_vezmou.op_job_runs(uuid, integer, text),
  se_vezmou.op_expiring_weddings(uuid, integer, timestamptz)
  to service_role;

-- export volá správce páru s claimy (role authenticated, wedding_role admin)
grant execute on function se_vezmou.admin_export_guests(boolean) to authenticated;
