-- Složené cizí klíče (wedding_id, id) brání křížovým odkazům mezi svatbami (kap. 1, kap. 12 bod 1).
-- Pokusy běží jako vlastník (obchází RLS), aby se prokázalo, že brání samotný cizí klíč, ne politika.
begin;
select tap.seed();

do $$
declare
  wa uuid := tap.wa();
  wb uuid := tap.wb();
begin
  perform tap.throws(format('insert into se_vezmou.content_blocks (wedding_id, page_id, type, position, anchor) values (%L, %L, ''faq'', 9, ''x'')', wa, tap.u('B:page')),
    '23503', 'blok svatby A nemůže ležet na stránce svatby B');
  perform tap.throws(format('insert into se_vezmou.events (wedding_id, kind, title, starts_at, venue_id) values (%L, ''other'', ''{"cs": "x"}'', now(), %L)', wa, tap.u('B:venue')),
    '23503', 'událost svatby A nemůže odkazovat na místo svatby B');
  perform tap.throws(format('insert into se_vezmou.events (wedding_id, page_id, kind, title, starts_at) values (%L, %L, ''other'', ''{"cs": "x"}'', now())', wa, tap.u('B:page')),
    '23503', 'událost svatby A nemůže ležet na stránce svatby B');
  perform tap.throws(format('insert into se_vezmou.guests (wedding_id, household_id, display_name) values (%L, %L, ''Cizí host'')', wa, tap.u('B:household')),
    '23503', 'host svatby A nemůže patřit do domácnosti svatby B');
  perform tap.throws(format('insert into se_vezmou.invitations (wedding_id, guest_id, event_id) values (%L, %L, %L)', wa, tap.u('A:guest2'), tap.u('B:event2')),
    '23503', 'pozvání nemůže mířit na událost jiné svatby');
  perform tap.throws(format('insert into se_vezmou.invitations (wedding_id, guest_id, event_id) values (%L, %L, %L)', wa, tap.u('B:guest2'), tap.u('A:event2')),
    '23503', 'pozvání nemůže patřit hostu jiné svatby');
  perform tap.throws(format('insert into se_vezmou.rsvp_questions (wedding_id, key, type, label, event_id) values (%L, ''q2'', ''text'', ''{"cs": "x"}'', %L)', wa, tap.u('B:event1')),
    '23503', 'otázka nemůže odkazovat na událost jiné svatby');
  perform tap.throws(format('insert into se_vezmou.rsvp_responses (wedding_id, household_id) values (%L, %L)', wa, tap.u('B:household')),
    '23503', 'odpověď nemůže patřit domácnosti jiné svatby');
  perform tap.throws(format('insert into se_vezmou.rsvp_people (wedding_id, response_id, guest_id, person_name) values (%L, %L, null, ''x'')', wa, tap.u('B:response')),
    '23503', 'osoba nemůže patřit odpovědi jiné svatby');
  perform tap.throws(format('insert into se_vezmou.rsvp_people (wedding_id, response_id, guest_id, person_name) values (%L, %L, %L, ''x'')', wa, tap.u('A:response'), tap.u('B:guest2')),
    '23503', 'osoba nemůže odkazovat na hosta jiné svatby');
  perform tap.throws(format('insert into se_vezmou.rsvp_attendance (wedding_id, person_id, event_id, attending) values (%L, %L, %L, true)', wa, tap.u('A:person'), tap.u('B:event2')),
    '23503', 'účast nemůže mířit na událost jiné svatby');
  perform tap.throws(format('insert into se_vezmou.rsvp_attendance (wedding_id, person_id, event_id, attending) values (%L, %L, %L, true)', wa, tap.u('B:person'), tap.u('A:event2')),
    '23503', 'účast nemůže patřit osobě jiné svatby');
  insert into se_vezmou.rsvp_people (id, wedding_id, response_id, guest_id, person_name)
  values (tap.u('B:person2'), wb, tap.u('B:response'), tap.u('B:guest2'), 'Eva Svobodová');
  perform tap.throws(format('insert into se_vezmou.rsvp_health (person_id, wedding_id, diet) values (%L, %L, ''x'')', tap.u('B:person2'), wa),
    '23503', 'zdravotní údaje nemohou patřit osobě jiné svatby');
  perform tap.throws(format('insert into se_vezmou.rsvp_tickets (token_hash, wedding_id, household_id, expires_at) values (''\x01'', %L, %L, now())', wa, tap.u('B:household')),
    '23503', 'lístek nemůže odkazovat na domácnost jiné svatby');
  insert into se_vezmou.site_versions (id, wedding_id, kind, public_content)
  values (tap.u('B:version2'), wb, 'checkpoint', '{}');
  perform tap.throws(format('insert into se_vezmou.site_version_sensitive (version_id, wedding_id) values (%L, %L)', tap.u('B:version2'), wa),
    '23503', 'citlivá část nemůže patřit verzi jiné svatby');
  perform tap.throws(format('update se_vezmou.weddings set published_version_id = %L where id = %L', tap.u('B:version'), wa),
    '23503', 'svatba A nemůže zveřejnit verzi svatby B');
  perform tap.throws(format('insert into se_vezmou.sessions (token_hash, kind, wedding_id, subject_id, idle_seconds, idle_expires_at, absolute_expires_at) values (''\x02'', ''admin'', %L, %L, 60, now(), now())', wa, tap.u('B:admin')),
    '23503', 'relace svatby A nemůže patřit správci svatby B');
  perform tap.throws(format('insert into se_vezmou.data_access_grants (wedding_id, granted_by_admin_id, reason, expires_at) values (%L, %L, ''x'', now() + interval ''1 day'')', wa, tap.u('B:admin')),
    '23503', 'grant svatby A nemůže udělit správce svatby B');
  perform tap.throws(format('insert into se_vezmou.site_versions (wedding_id, kind, public_content, created_by) values (%L, ''checkpoint'', ''{}'', %L)', wa, tap.u('B:admin')),
    '23503', 'verze svatby A nemůže mít autora ze svatby B');
  perform tap.throws(format('insert into se_vezmou.content_blocks (wedding_id, page_id, type, position, anchor, updated_by) values (%L, %L, ''faq'', 9, ''y'', %L)', wa, tap.u('A:page'), tap.u('B:admin')),
    '23503', 'blok svatby A nemůže mít autora ze svatby B');
  perform tap.throws(format('insert into se_vezmou.wedding_admins (wedding_id, email, added_by) values (%L, ''novy@example.test'', %L)', wa, tap.u('B:admin')),
    '23503', 'správce svatby A nemůže být přidán správcem svatby B');
end
$$;

-- Totéž přes roli správce A: cizí klíč zabrání odkazu i tam, kde by politika prošla
do $$
begin
  perform tap.become('authenticated', tap.wa(), 'admin');
  perform tap.throws(format('insert into se_vezmou.guests (wedding_id, household_id, display_name) values (%L, %L, ''Cizí host'')', tap.wa(), tap.u('B:household')),
    '23503', 'správce A nevloží hosta do domácnosti B (složený FK)');
  perform tap.throws(format('insert into se_vezmou.content_blocks (wedding_id, page_id, type, position, anchor) values (%L, %L, ''faq'', 9, ''x'')', tap.wa(), tap.u('B:page')),
    '23503', 'správce A nevloží blok na stránku B (složený FK)');
  perform tap.throws(format('insert into se_vezmou.invitations (wedding_id, guest_id, event_id) values (%L, %L, %L)', tap.wa(), tap.u('A:guest2'), tap.u('B:event2')),
    '23503', 'správce A nevloží pozvání na událost B (složený FK)');
  perform tap.reset();
end
$$;

-- Vlastní odkazy v téže svatbě fungují
do $$
begin
  insert into se_vezmou.events (wedding_id, kind, title, starts_at, venue_id, page_id)
  values (tap.wa(), 'other', '{"cs": "x"}', now(), tap.u('A:venue'), tap.u('A:page'));
  perform tap.ok(true, 'událost svatby A smí odkazovat na místo a stránku svatby A');

  -- smazání místa vynuluje jen venue_id, wedding_id zůstane (on delete set null (venue_id))
  delete from se_vezmou.venues where id = tap.u('A:venue');
  perform tap.ok((select venue_id from se_vezmou.events where id = tap.u('A:event1')) is null
                 and (select wedding_id from se_vezmou.events where id = tap.u('A:event1')) = tap.wa(),
    'smazání místa vynuluje jen venue_id události');
end
$$;

-- Kaskáda: smazání domácnosti smaže hosty, odpovědi i zdravotní údaje jen té svatby
do $$
begin
  delete from se_vezmou.households where id = tap.u('A:household');
  perform tap.eq((select count(*) from se_vezmou.guests where wedding_id = tap.wa()), 0, 'smazání domácnosti smaže její hosty');
  perform tap.eq((select count(*) from se_vezmou.rsvp_health where wedding_id = tap.wa()), 0, 'smazání domácnosti smaže zdravotní údaje');
  perform tap.eq((select count(*) from se_vezmou.guests where wedding_id = tap.wb()), 2, 'hosté svatby B zůstali');
  perform tap.eq((select count(*) from se_vezmou.rsvp_health where wedding_id = tap.wb()), 1, 'zdravotní údaje svatby B zůstaly');
end
$$;

rollback;
