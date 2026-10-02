-- Průvodce (M5): první uložení v jedné transakci, průběžné ukládání, kolize adres a varianty,
-- odkaz na náhled, zveřejnění, čekací listina, analytické události a blokované výrazy v adresách.
-- Zdroj: docs/data-model.md kap. 6 a 15, FR-WZ-4 až FR-WZ-6, FR-PRIV-4.
begin;
select tap.seed();

-- Pomocná funkce testu: payload pracovní sady tak, jak ji sestavuje aplikace (src/wizard/content.ts)
create function tap.wz_work(p_a text, p_b text, p_venue text default 'Zámecká kaple') returns jsonb
  language sql as $$
  select jsonb_build_object(
    'wedding', jsonb_build_object(
      'partnerA', p_a, 'partnerB', p_b, 'startsOn', '2027-06-19', 'endsOn', null,
      'timezone', 'Europe/Prague', 'locales', jsonb_build_array('cs', 'en'), 'defaultLocale', 'cs',
      'template', 'eukalyptus', 'palette', 'stribrna', 'guestPinEnabled', false),
    'venues', jsonb_build_array(jsonb_build_object(
      'id', tap.u('wiz:venue1'), 'name', jsonb_build_object('cs', p_venue),
      'address', 'Zámecká 1, Dobřichovice', 'directions', null)),
    'events', jsonb_build_array(
      jsonb_build_object('id', tap.u('wiz:event1'), 'kind', 'ceremony',
        'title', jsonb_build_object('cs', 'Obřad', 'en', 'Ceremony'), 'description', null,
        'startsAt', '2027-06-19T14:00:00+02:00', 'endsAt', null, 'venueId', tap.u('wiz:venue1'),
        'rsvpEnabled', true),
      jsonb_build_object('id', tap.u('wiz:event2'), 'kind', 'reception',
        'title', jsonb_build_object('cs', 'Hostina'), 'description', null,
        'startsAt', '2027-06-19T16:00:00+02:00', 'endsAt', null, 'venueId', null, 'rsvpEnabled', true)),
    'blocks', jsonb_build_array(
      jsonb_build_object('id', tap.u('wiz:block1'), 'type', 'hero', 'anchor', 'uvod', 'enabled', true,
        'position', 0, 'sensitive', false, 'data', jsonb_build_object('countdown', true)),
      jsonb_build_object('id', tap.u('wiz:block2'), 'type', 'program', 'anchor', 'program', 'enabled', true,
        'position', 1, 'sensitive', false, 'data', '{}'::jsonb),
      jsonb_build_object('id', tap.u('wiz:block3'), 'type', 'rsvp', 'anchor', 'potvrzeni', 'enabled', true,
        'position', 2, 'sensitive', false, 'data', '{}'::jsonb)),
    'rsvp', jsonb_build_object('opensAt', null, 'closesAt', '2027-05-01T21:59:59+00:00',
      'allowUnlisted', false, 'emailConfirmation', true,
      'questions', jsonb_build_object('plus_one', true, 'diet', true)))
$$;

create function tap.wz_draft(p_a text, p_b text) returns jsonb
  language sql as $$ select jsonb_build_object('version', 1, 'partnerA', p_a, 'partnerB', p_b) $$;

create function tap.wz_content(p_slug text) returns jsonb
  language sql as $$
  select jsonb_build_object('version', 1, 'slug', p_slug,
    'partners', jsonb_build_object('a', 'Lenka', 'b', 'Tomáš'), 'blocks', '[]'::jsonb)
$$;

grant execute on function tap.wz_work(text, text, text), tap.wz_draft(text, text), tap.wz_content(text) to public;

-- ---------------------------------------------------------------------------
-- Čekací listina: idempotence, žádné prozrazení, validace
-- ---------------------------------------------------------------------------
do $$
begin
  set local role service_role;
  perform tap.ok(public.waitlist_add('Pan@Example.Test ', 'cs', 'v1'), 'první zápis e-mailu vrátí true');
  perform tap.ok(not public.waitlist_add('pan@example.test', 'en', 'v2'), 'stejný e-mail podruhé vrátí false (idempotence)');
  perform tap.ok(not public.waitlist_add('PAN@EXAMPLE.TEST', null, 'v1'), 'velikost písmen na e-mailu nehraje roli');
  perform tap.reset();
  perform tap.eq((select count(*) from public.waitlist where email = 'pan@example.test'), 1, 'v tabulce je jediný řádek');
  perform tap.ok((select consent_text_version from public.waitlist where email = 'pan@example.test') = 'v1',
    'opakovaný zápis nepřepíše původní souhlas');
  perform tap.ok((select locale from public.waitlist where email = 'pan@example.test') = 'cs', 'ani jazyk');
  perform tap.ok((select email::text from public.waitlist where email = 'pan@example.test') = 'pan@example.test',
    'e-mail je uložen normalizovaně (malá písmena, bez mezer)');

  set local role service_role;
  perform tap.throws('select public.waitlist_add(''neni-email'', ''cs'', ''v1'')', '22023', 'neplatný e-mail se odmítne');
  perform tap.throws('select public.waitlist_add(''a@b.cz'', ''de'', ''v1'')', '22023', 'neznámý jazyk se odmítne');
  perform tap.throws('select public.waitlist_add(''a@b.cz'', ''cs'', '' '')', '22023', 'bez verze textu souhlasu se odmítne');
  perform tap.reset();
end
$$;

-- ---------------------------------------------------------------------------
-- Analytické události: uzavřený seznam
-- ---------------------------------------------------------------------------
do $$
begin
  set local role service_role;
  perform public.analytics_record('wizard_started', 'cs', null, null);
  perform public.analytics_record('wizard_step_completed', 'en', 'chateau', 3);
  perform public.analytics_record('site_published', 'cs', 'editorial', null);
  perform tap.throws('select public.analytics_record(''page_view'', ''cs'', null, null)', '22023', 'událost mimo uzavřený seznam se odmítne');
  perform tap.throws('select public.analytics_record(''wizard_started'', ''de'', null, null)', '23514', 'neznámý jazyk události se odmítne');
  perform tap.reset();
  perform tap.eq((select count(*) from public.analytics_event where event = 'wizard_step_completed' and step = 3 and template = 'chateau'), 1,
    'událost se zapsala');
  perform tap.ok(not exists (
      select 1 from information_schema.columns
       where table_name = 'analytics_event' and column_name in ('wedding_id', 'email', 'ip', 'user_agent', 'name')),
    'analytická tabulka nemá sloupec s osobním údajem ani identifikátorem svatby');
end
$$;

-- ---------------------------------------------------------------------------
-- Blokované výrazy v adresách
-- ---------------------------------------------------------------------------
do $$
begin
  set local role service_role;
  perform tap.ok(not (select available from public.check_slug('kurva')), 'vulgarismus není dostupný jako adresa');
  perform tap.ok(not (select available from public.check_slug('kurva-a-matej')), 'adresa s vulgarismem jako dílem není dostupná');
  perform tap.ok(not (select available from public.check_slug('klara-a-hitler')), 'adresa s nenávistným výrazem není dostupná');
  perform tap.ok(not (select available from public.check_slug('moje-paypal-svatba')), 'adresa napodobující cizí značku není dostupná');
  perform tap.ok((select reason from public.check_slug('kurva-a-matej')) = (select reason from public.check_slug('klara-a-matej')),
    'blokovaný výraz a zabraná adresa mají stejný důvod (nelze rozlišit)');
  perform tap.ok((select available from public.check_slug('klara-a-honza')), 'obyčejná adresa projde');
  perform tap.ok((select available from public.check_slug('pop-a-dev')), 'krátké díly (pop, dev) falešnou shodu nedávají');
  perform tap.reset();
  perform tap.ok((select count(*) from public.slug_registry where state = 'reserved_word') >= 60, 'seznam rezervovaných slov a vulgarismů je nasazen');
  perform tap.throws('delete from public.slug_registry where slug = ''kurva''', 'slug_registry_row_is_permanent', 'řádek blokovaného výrazu nejde smazat');
end
$$;

-- ---------------------------------------------------------------------------
-- wizard_create_draft: první uložení
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_w uuid;
begin
  set local role service_role;
  select * into r from public.wizard_create_draft('Lenka@Example.Test', 'zaloha-lenka@example.test', 'lenka-a-tomas',
    tap.wz_draft('Lenka', 'Tomáš'), tap.wz_work('Lenka', 'Tomáš'));
  perform tap.reset();
  perform tap.ok(r.ok and r.wedding_id is not null and r.admin_id is not null and r.variants = '{}', 'první uložení vrátí svatbu a správce');
  v_w := r.wedding_id;

  perform tap.ok((select status from public.weddings where id = v_w) = 'draft', 'svatba je koncept');
  perform tap.ok((select slug from public.weddings where id = v_w) = 'lenka-a-tomas', 'adresa je u svatby');
  perform tap.ok(exists (select 1 from public.slug_registry where slug = 'lenka-a-tomas' and state = 'reserved' and wedding_id = v_w
                           and reserved_until > now() + interval '29 days'), 'adresa je rezervována na 30 dní');
  perform tap.ok((select email::text from public.wedding_admins where wedding_id = v_w) = 'lenka@example.test', 'e-mail správce je normalizován');
  perform tap.ok((select backup_email::text from public.wedding_auth where wedding_id = v_w) = 'zaloha-lenka@example.test', 'záložní e-mail je uložen');
  perform tap.eq((select count(*) from public.orders where wedding_id = v_w), 1, 'vznikla zakázka');
  perform tap.eq((select count(*) from public.pages where wedding_id = v_w and path = ''), 1, 'vznikla domovská stránka');
  perform tap.eq((select count(*) from public.events where wedding_id = v_w), 2, 'vznikly události');
  perform tap.eq((select count(*) from public.venues where wedding_id = v_w), 1, 'vzniklo místo');
  perform tap.eq((select count(*) from public.content_blocks where wedding_id = v_w), 3, 'vznikly bloky');
  perform tap.ok((select closes_at is not null and email_confirmation and enabled_questions ->> 'plus_one' = 'true'
                    from public.rsvp_settings where wedding_id = v_w), 'vzniklo nastavení potvrzení účasti');
  perform tap.ok((select template = 'eukalyptus' and palette = 'stribrna' and starts_on = date '2027-06-19' and locales = array['cs', 'en']
                    from public.weddings where id = v_w), 'údaje svatby jsou zapsány');
  perform tap.ok((select wizard_draft ->> 'partnerA' from public.weddings where id = v_w) = 'Lenka', 'rozpracovaný stav je uložen');
  perform tap.ok(exists (select 1 from public.audit_log where wedding_id = v_w and action = 'wedding.created' and actor_type = 'admin'),
    'vznik svatby je v auditu');
  perform tap.ok(not exists (select 1 from public.audit_log where wedding_id = v_w and meta::text ~* 'lenka'), 'audit neobsahuje jména ani e-maily');
  perform tap.ok(exists (select 1 from public.wedding_status_history where wedding_id = v_w and to_status = 'draft'), 'vznik je v historii stavů');
  perform tap.ok((select count(*) from public.events where wedding_id = v_w and venue_id is not null) = 1, 'obřad je navázán na místo');
end
$$;

-- Kolize: nic se nezaloží, nabídnou se varianty (rok, rok-měsíc, obec, neuhádnutelná)
do $$
declare
  r record;
  v_before_w bigint := (select count(*) from public.weddings);
  v_before_admins bigint := (select count(*) from public.wedding_admins);
  v_before_reg bigint := (select count(*) from public.slug_registry);
begin
  set local role service_role;
  select * into r from public.wizard_create_draft('jina@example.test', 'zaloha-jina@example.test', 'klara-a-matej',
    tap.wz_draft('Klára', 'Matěj'), tap.wz_work('Klára', 'Matěj'));
  perform tap.reset();
  perform tap.ok(not r.ok and r.wedding_id is null, 'kolize se zveřejněnou adresou: nic se nevytvoří');
  perform tap.ok('klara-a-matej-2027' = any (r.variants), 'varianta s rokem');
  perform tap.ok('klara-a-matej-2027-06' = any (r.variants), 'varianta s rokem a měsícem');
  perform tap.ok('klara-a-matej-obec' = any (r.variants), 'varianta s obcí');
  perform tap.ok(exists (select 1 from unnest(r.variants) v where v ~ '^klara-a-matej-[abcdefghjkmnpqrstuvwxyz2-9]{4}$'), 'neuhádnutelná varianta se čtyřmi znaky');
  perform tap.eq(cardinality(r.variants), 4, 'čtyři varianty');
  perform tap.eq((select count(*) from public.weddings), v_before_w, 'počet svateb se nezměnil');
  perform tap.eq((select count(*) from public.wedding_admins), v_before_admins, 'žádný správce navíc');
  perform tap.eq((select count(*) from public.slug_registry), v_before_reg, 'registr adres se nezměnil');

  set local role service_role;
  select * into r from public.wizard_create_draft('jina@example.test', 'zaloha-jina@example.test', 'lenka-a-tomas',
    tap.wz_draft('Lenka', 'Tomáš'), tap.wz_work('Lenka', 'Tomáš'));
  perform tap.reset();
  perform tap.ok(not r.ok, 'kolize s cizí rezervací konceptu: odmítnuto');
  perform tap.ok(not ('lenka-a-tomas' = any (r.variants)) and cardinality(r.variants) >= 3, 'varianty neobsahují zabranou adresu');

  -- žádná varianta není rezervovaná, použitá ani blokovaná
  perform tap.ok(not exists (
      select 1 from unnest(r.variants) v where not app.slug_available(v)),
    'každá nabídnutá varianta je volná');

  -- rezervované slovo, blokovaný výraz: stejný výsledek jako kolize (nic neprozradí)
  set local role service_role;
  select * into r from public.wizard_create_draft('jina@example.test', 'zaloha-jina@example.test', 'kurva-a-matej',
    tap.wz_draft('A', 'B'), tap.wz_work('A', 'B'));
  perform tap.reset();
  perform tap.ok(not r.ok and r.wedding_id is null, 'blokovaný výraz se nezaloží');
  perform tap.eq((select count(*) from public.weddings), v_before_w, 'a nic nevzniklo');

  perform tap.throws('select * from public.wizard_create_draft(''a@b.cz'', ''c@d.cz'', ''Velke'', ''{}''::jsonb, ''{}''::jsonb)', '22023', 'neplatný tvar adresy je chyba');
  perform tap.throws('select * from public.wizard_create_draft(''a@b.cz'', ''a@b.cz'', ''dobry-slug'', ''{}''::jsonb, ''{}''::jsonb)', 'backup_email_same', 'záložní e-mail nesmí být stejný');
  perform tap.throws('select * from public.wizard_create_draft(''nope'', ''c@d.cz'', ''dobry-slug'', ''{}''::jsonb, ''{}''::jsonb)', 'invalid_email', 'neplatný e-mail');
end
$$;

-- Souběh: dvě svatby o stejnou adresu, jedna vyhraje, druhá dostane varianty bez zbytků
do $$
declare
  r1 record;
  r2 record;
  v_w uuid;
begin
  set local role service_role;
  select * into r1 from public.wizard_create_draft('prvni@example.test', 'zaloha-prvni@example.test', 'eva-a-adam',
    tap.wz_draft('Eva', 'Adam'), tap.wz_work('Eva', 'Adam'));
  select * into r2 from public.wizard_create_draft('druhy@example.test', 'zaloha-druhy@example.test', 'eva-a-adam',
    tap.wz_draft('Eva', 'Adam'), tap.wz_work('Eva', 'Adam'));
  perform tap.reset();
  perform tap.ok(r1.ok and not r2.ok, 'první vyhrává, druhý ne');
  perform tap.eq((select count(*) from public.weddings where partner_a_name = 'Eva' and partner_b_name = 'Adam'), 1, 'jediná svatba Eva a Adam');
  perform tap.eq((select count(*) from public.wedding_admins where email = 'druhy@example.test'), 0, 'neúspěšný pokus nenechal správce');

  -- druhý si vybere variantu a uspěje
  set local role service_role;
  select * into r2 from public.wizard_create_draft('druhy@example.test', 'zaloha-druhy@example.test', 'eva-a-adam-2027',
    tap.wz_draft('Eva', 'Adam'), tap.wz_work('Eva', 'Adam'));
  perform tap.reset();
  perform tap.ok(r2.ok, 'varianta se založí');
  v_w := r2.wedding_id;
  perform tap.ok((select slug from public.weddings where id = v_w) = 'eva-a-adam-2027', 'adresa je varianta');
end
$$;

-- ---------------------------------------------------------------------------
-- wizard_save: průběžné ukládání a kolize adres bez ztráty dat
-- ---------------------------------------------------------------------------
do $$
declare
  v_w uuid := (select id from public.weddings where slug = 'lenka-a-tomas');
  r record;
begin
  -- změna dat: jiné místo, jiný blok; nový payload nahradí staré řádky, cizí řádky nezmění
  set local role service_role;
  select * into r from public.wizard_save(v_w, 'lenka-a-tomas', tap.wz_draft('Lenka', 'Tomáš II'),
    jsonb_set(tap.wz_work('Lenka', 'Tomáš II', 'Kostel sv. Jakuba'), '{blocks}', jsonb_build_array(
      jsonb_build_object('id', tap.u('wiz:block1'), 'type', 'hero', 'anchor', 'uvod', 'enabled', true,
        'position', 0, 'sensitive', false, 'data', '{}'::jsonb))));
  perform tap.reset();
  perform tap.ok(r.slug = 'lenka-a-tomas' and r.slug_status = 'ok' and r.reserved_until > now() + interval '29 days', 'uložení téže adresy: ok');
  perform tap.ok((select partner_b_name from public.weddings where id = v_w) = 'Tomáš II', 'jméno se změnilo');
  perform tap.ok((select name ->> 'cs' from public.venues where wedding_id = v_w) = 'Kostel sv. Jakuba', 'místo se aktualizovalo');
  perform tap.eq((select count(*) from public.content_blocks where wedding_id = v_w), 1, 'nepoužité bloky se odstranily');
  perform tap.ok((select wizard_draft ->> 'partnerB' from public.weddings where id = v_w) = 'Tomáš II', 'rozpracovaný stav se přepsal');

  -- změna adresy na volnou
  set local role service_role;
  select * into r from public.wizard_save(v_w, 'tomas-a-lenka', tap.wz_draft('Lenka', 'Tomáš'), tap.wz_work('Lenka', 'Tomáš'));
  perform tap.reset();
  perform tap.ok(r.slug = 'tomas-a-lenka' and r.slug_status = 'ok', 'změna adresy na volnou projde');
  perform tap.ok(not exists (select 1 from public.slug_registry where slug = 'lenka-a-tomas'), 'stará rezervace se uvolnila (nezveřejněná)');
  perform tap.eq((select count(*) from public.slug_registry where wedding_id = v_w and state = 'reserved'), 1, 'jediná rezervace na svatbu');

  -- kolize: data se uloží, dosavadní adresa zůstane, přijdou varianty
  set local role service_role;
  select * into r from public.wizard_save(v_w, 'klara-a-matej', tap.wz_draft('Lenka', 'Tomáš nově'), tap.wz_work('Lenka', 'Tomáš nově'));
  perform tap.reset();
  perform tap.ok(r.slug = 'tomas-a-lenka' and r.slug_status = 'taken' and cardinality(r.variants) >= 3, 'kolize: dosavadní adresa zůstává a přijdou varianty');
  perform tap.ok((select partner_b_name from public.weddings where id = v_w) = 'Tomáš nově', 'kolize adresy data neztratila');

  -- neplatný tvar, žádná adresa (null = beze změny)
  set local role service_role;
  select * into r from public.wizard_save(v_w, 'Velke-Pismeno', tap.wz_draft('Lenka', 'Tomáš'), tap.wz_work('Lenka', 'Tomáš'));
  perform tap.ok(r.slug_status = 'invalid' and r.slug = 'tomas-a-lenka', 'neplatný tvar: adresa se nemění');
  select * into r from public.wizard_save(v_w, null, tap.wz_draft('Lenka', 'Tomáš'), tap.wz_work('Lenka', 'Tomáš'));
  perform tap.ok(r.slug = 'tomas-a-lenka', 'bez adresy se adresa nemění');
  perform tap.reset();

  -- cizí svatba: identifikátor cizího místa v payloadu nic nepřepíše
  perform tap.throws(
    format('select * from public.wizard_save(%L, null, ''{}''::jsonb, %L::jsonb)', v_w,
      jsonb_set(tap.wz_work('Lenka', 'Tomáš'), '{venues}', jsonb_build_array(jsonb_build_object(
        'id', tap.u('B:venue'), 'name', jsonb_build_object('cs', 'Přepsáno'), 'address', 'X', 'directions', null)))),
    '23503', 'událost nemůže odkazovat na místo jiné svatby');
  perform tap.ok((select name ->> 'cs' from public.venues where id = tap.u('B:venue')) = 'Zámek', 'místo svatby B zůstalo beze změny');

  -- zveřejněnou svatbu průvodce nemění, neexistující svatba je chyba
  set local role service_role;
  perform tap.throws(format('select * from public.wizard_save(%L, null, ''{}''::jsonb, %L::jsonb)', tap.wa(), tap.wz_work('A', 'B')),
    '55000', 'zveřejněný web průvodce neukládá');
  perform tap.throws(format('select * from public.wizard_save(%L, null, ''{}''::jsonb, %L::jsonb)', gen_random_uuid(), tap.wz_work('A', 'B')),
    'P0002', 'neexistující svatba je chyba');
  perform tap.reset();
end
$$;

-- Aktivita prodlužuje rezervaci (nejvýše jednou za activity_touch_minutes)
do $$
declare
  v_w uuid := (select id from public.weddings where slug = 'tomas-a-lenka');
  v_until timestamptz;
begin
  update public.weddings set last_activity_at = now() - interval '20 days' where id = v_w;
  update public.slug_registry set reserved_until = now() + interval '10 days' where wedding_id = v_w and state = 'reserved';
  set local role service_role;
  perform * from public.wizard_save(v_w, null, tap.wz_draft('Lenka', 'Tomáš'), tap.wz_work('Lenka', 'Tomáš'));
  perform tap.reset();
  select reserved_until into v_until from public.slug_registry where wedding_id = v_w and state = 'reserved';
  perform tap.ok(v_until > now() + interval '29 days', 'uložení prodloužilo rezervaci na 30 dní od teď');

  -- hned další uložení last_activity_at nepřepisuje (omezení četnosti)
  perform tap.ok((select last_activity_at from public.weddings where id = v_w) > now() - interval '1 minute', 'last_activity_at je čerstvý');
end
$$;

-- ---------------------------------------------------------------------------
-- wizard_load
-- ---------------------------------------------------------------------------
do $$
declare
  v_w uuid := (select id from public.weddings where slug = 'tomas-a-lenka');
  r record;
begin
  set local role service_role;
  select * into r from public.wizard_load(v_w);
  perform tap.reset();
  perform tap.ok(r.status = 'draft' and r.slug = 'tomas-a-lenka' and r.draft ->> 'partnerA' = 'Lenka' and not r.preview_enabled
                 and r.reserved_until is not null, 'wizard_load vrací stav, adresu a rozpracovaná data');
  set local role service_role;
  perform tap.eq((select count(*) from public.wizard_load(gen_random_uuid())), 0, 'neexistující svatba nevrátí nic');
  perform tap.reset();
end
$$;

-- ---------------------------------------------------------------------------
-- set_preview_token a resolve_preview
-- ---------------------------------------------------------------------------
do $$
declare
  v_w uuid := (select id from public.weddings where slug = 'tomas-a-lenka');
  v_admin uuid := (select id from public.wedding_admins where wedding_id = v_w);
  v_t1 bytea := sha256(convert_to('token-1', 'UTF8'));
  v_t2 bytea := sha256(convert_to('token-2', 'UTF8'));
begin
  set local role service_role;
  perform public.set_preview_token(v_w, v_t1, v_admin);
  perform tap.eq((select count(*) from public.resolve_preview('tomas-a-lenka', v_t1)), 1, 'odkaz na náhled najde koncept');
  perform tap.eq((select count(*) from public.resolve_preview('tomas-a-lenka', v_t2)), 0, 'jiný token nenajde nic');
  perform tap.eq((select count(*) from public.resolve_preview('klara-a-matej', v_t1)), 0, 'token jedné svatby neplatí na adrese jiné');
  perform public.set_preview_token(v_w, v_t2, v_admin);
  perform tap.eq((select count(*) from public.resolve_preview('tomas-a-lenka', v_t1)), 0, 'nový token zneplatní starý');
  perform tap.eq((select count(*) from public.resolve_preview('tomas-a-lenka', v_t2)), 1, 'nový token platí');
  perform tap.ok((select preview_enabled from public.wizard_load(v_w)), 'wizard_load hlásí zapnutý náhled');
  perform tap.throws(format('select public.set_preview_token(%L, ''\x1234''::bytea, null)', v_w), '22023', 'token musí být 32bajtový hash');
  perform tap.throws(format('select public.set_preview_token(%L, %L, null)', gen_random_uuid(), v_t1), 'P0002', 'neexistující svatba');
  perform tap.reset();
  perform tap.ok((select preview_token_hash from public.weddings where id = v_w) = v_t2, 'v databázi je jen hash tokenu');
  perform tap.ok(exists (select 1 from public.audit_log where wedding_id = v_w and action = 'preview.token_set'), 'změna odkazu je v auditu');
end
$$;

-- Nepublikovaný koncept se anonymně nevykreslí (resolve_slug) a koncept bez tokenu nemá náhled
do $$
declare
  v_w uuid := (select id from public.weddings where slug = 'tomas-a-lenka');
begin
  set local role service_role;
  perform tap.eq((select count(*) from public.resolve_slug('tomas-a-lenka')), 0, 'koncept se nerozpozná jako zveřejněný web');
  perform tap.reset();
end
$$;

-- ---------------------------------------------------------------------------
-- publish_site
-- ---------------------------------------------------------------------------
do $$
declare
  v_w uuid := (select id from public.weddings where slug = 'tomas-a-lenka');
  v_admin uuid := (select id from public.wedding_admins where wedding_id = v_w);
  r record;
begin
  set local role service_role;
  perform tap.throws(format('select * from public.publish_site(%L, %L, %L::jsonb)', v_w, v_admin, tap.wz_content('jina-adresa')),
    '22023', 'snímek s jinou adresou se odmítne');
  perform tap.throws(format('select * from public.publish_site(%L, %L, %L::jsonb)', v_w, v_admin, '{"version":1,"slug":"tomas-a-lenka"}'),
    '22023', 'snímek bez bloků se odmítne');
  perform tap.reset();

  -- PIN hostů zapnutý bez hashe: zveřejnění se odmítne
  update public.weddings set guest_pin_enabled = true where id = v_w;
  set local role service_role;
  perform tap.throws(format('select * from public.publish_site(%L, %L, %L::jsonb)', v_w, v_admin, tap.wz_content('tomas-a-lenka')),
    'guest_pin_missing', 'zapnutý PIN hostů bez hashe zveřejnění zablokuje');
  perform tap.reset();
  update public.weddings set guest_pin_enabled = false where id = v_w;

  set local role service_role;
  select * into r from public.publish_site(v_w, v_admin, tap.wz_content('tomas-a-lenka'), '{"gifts": {"account": "1/0100"}}');
  perform tap.reset();
  perform tap.ok(r.version_no = 1 and r.slug = 'tomas-a-lenka', 'zveřejnění vrátí číslo verze a adresu');
  perform tap.ok((select status = 'published' and published_version_id is not null and published_at is not null from public.weddings where id = v_w),
    'stav je published, verze a čas nastaveny');
  perform tap.ok(exists (select 1 from public.slug_registry where slug = 'tomas-a-lenka' and state = 'active'
                           and first_published_at is not null and reserved_until is null), 'adresa je active');
  perform tap.ok((select public_content ->> 'slug' from public.site_versions where wedding_id = v_w and version_no = 1) = 'tomas-a-lenka',
    'snímek je uložen');
  perform tap.ok((select sensitive_content -> 'gifts' ->> 'account' from public.site_version_sensitive where wedding_id = v_w) = '1/0100',
    'citlivý obsah je zvlášť');
  perform tap.ok(not (select public_content::text like '%0100%' from public.site_versions where wedding_id = v_w), 'veřejný snímek citlivý obsah neobsahuje');
  perform tap.ok(exists (select 1 from public.wedding_status_history where wedding_id = v_w and from_status = 'draft' and to_status = 'published'),
    'přechod je v historii stavů');
  perform tap.ok(exists (select 1 from public.audit_log where wedding_id = v_w and action = 'site.published'), 'zveřejnění je v auditu');

  set local role service_role;
  perform tap.eq((select count(*) from public.resolve_slug('tomas-a-lenka')), 1, 'zveřejněný web resolve_slug najde');
  perform tap.throws(format('select * from public.publish_site(%L, %L, %L::jsonb)', v_w, v_admin, tap.wz_content('tomas-a-lenka')),
    '55000', 'podruhé zveřejnit nejde (už není koncept)');
  perform tap.throws(format('select * from public.wizard_save(%L, null, ''{}''::jsonb, %L::jsonb)', v_w, tap.wz_work('A', 'B')),
    '55000', 'po zveřejnění průvodce neukládá');
  perform tap.reset();

  -- zveřejněná adresa se nikdy nepřidělí znovu: ani po odpojení svatby
  perform tap.ok(not (select available from public.check_slug('tomas-a-lenka')), 'zveřejněná adresa není dostupná');
  update public.slug_registry set state = 'retired' where slug = 'tomas-a-lenka';
  set local role service_role;
  perform tap.ok(not (select available from public.check_slug('tomas-a-lenka')), 'zveřejněná a vyřazená adresa se nepřidělí znovu');
  perform tap.reset();
end
$$;

-- Zveřejnit lze jen koncept s platnou rezervací adresy
do $$
declare
  r record;
  v_w uuid;
  v_admin uuid;
begin
  set local role service_role;
  select * into r from public.wizard_create_draft('rez@example.test', 'zaloha-rez@example.test', 'rezervace-jedna',
    tap.wz_draft('Rez', 'Test'), tap.wz_work('Rez', 'Test'));
  perform tap.reset();
  v_w := r.wedding_id;
  v_admin := r.admin_id;

  -- rezervace vypršela a adresu mezitím získal někdo jiný: zveřejnění se odmítne a adresa je u svatby prázdná
  update public.slug_registry set reserved_until = now() - interval '1 day' where slug = 'rezervace-jedna';
  set local role service_role;
  perform tap.ok((select available from public.check_slug('rezervace-jedna')), 'prošlá rezervace se bere jako volná');
  select * into r from public.wizard_create_draft('jiny@example.test', 'zaloha-jiny@example.test', 'rezervace-jedna',
    tap.wz_draft('Jiný', 'Pár'), tap.wz_work('Jiný', 'Pár'));
  perform tap.reset();
  perform tap.ok(r.ok, 'jiný pár si adresu po vypršení rezervace vezme');
  perform tap.ok((select slug from public.weddings where id = v_w) is null, 'původní koncept přišel o adresu (slug = null), data zůstala');
  perform tap.ok((select partner_a_name from public.weddings where id = v_w) = 'Rez', 'ale rozepsaná data jsou zachována');
  set local role service_role;
  perform tap.throws(format('select * from public.publish_site(%L, %L, %L::jsonb)', v_w, v_admin, tap.wz_content('rezervace-jedna')),
    'slug_not_reserved', 'bez platné rezervace se nezveřejní');

  -- původní pár se vrátí, uloží a dostane novou kontrolu a varianty
  select * into r from public.wizard_save(v_w, 'rezervace-jedna', tap.wz_draft('Rez', 'Test'), tap.wz_work('Rez', 'Test'));
  perform tap.reset();
  perform tap.ok(r.slug_status = 'taken' and r.slug is null and cardinality(r.variants) >= 3, 'po návratu přijdou varianty');
  set local role service_role;
  select * into r from public.wizard_save(v_w, 'rezervace-jedna-2027', tap.wz_draft('Rez', 'Test'), tap.wz_work('Rez', 'Test'));
  perform tap.reset();
  perform tap.ok(r.slug = 'rezervace-jedna-2027' and r.slug_status = 'ok', 'varianta se rezervuje');
end
$$;

-- Uvolnění prošlých rezervací (cron) a trvalost zveřejněných adres
do $$
declare
  v_w uuid := (select id from public.weddings where slug = 'rezervace-jedna-2027');
  v_n integer;
begin
  update public.slug_registry set reserved_until = now() - interval '1 day' where slug = 'rezervace-jedna-2027';
  set local role service_role;
  v_n := public.purge_expired_slug_reservations();
  perform tap.reset();
  perform tap.ok(v_n >= 1, 'cron uvolnil prošlé rezervace');
  perform tap.ok((select slug from public.weddings where id = v_w) is null, 'koncept přišel o adresu');
  perform tap.ok(not exists (select 1 from public.slug_registry where slug = 'rezervace-jedna-2027'), 'řádek registru zmizel');
  perform tap.ok(exists (select 1 from public.slug_registry where slug = 'klara-a-matej' and state = 'active'), 'zveřejněná adresa zůstala');
end
$$;

-- ---------------------------------------------------------------------------
-- Oprávnění: funkce průvodce jsou jen pro service_role
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('wizard_create_draft', 'wizard_save', 'wizard_load', 'publish_site',
                       'set_preview_token', 'waitlist_add', 'analytics_record')
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'));
  perform tap.ok(v_bad is null, 'správce ani host funkce průvodce nespustí (' || coalesce(v_bad, '-') || ')');
  perform tap.ok(not has_function_privilege('service_role', 'app.wizard_apply(uuid, jsonb)', 'execute'),
    'interní app.wizard_apply nemá execute pro nikoho');
  perform tap.ok(not has_column_privilege('authenticated', 'public.weddings', 'wizard_draft', 'update'),
    'správce nezapisuje wizard_draft přímo');
end
$$;

rollback;
