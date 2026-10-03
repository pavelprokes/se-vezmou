-- M7a: správa webu páru (pracovní kopie, optimistické zamykání, zveřejnění, stažení z publikace,
-- body pro vrácení, rychlá změna, výběr svatby) a izolace mezi svatbami.
-- Zdroj: docs/data-model.md kap. 3.3, 13 a 17, FR-ADM-1 až FR-ADM-3.
begin;
select tap.seed();

-- Payload pracovní kopie tak, jak ho sestavuje aplikace (src/admin/site/doc.ts, `docToWork`)
create function tap.as_work(p_title text default 'Obřad', p_foreign_block uuid default null) returns jsonb
  language sql as $$
  select jsonb_build_object(
    'wedding', jsonb_build_object(
      'partnerA', 'Klára', 'partnerB', 'Matěj', 'startsOn', '2027-06-19', 'endsOn', null,
      'timezone', 'Europe/Prague', 'locales', jsonb_build_array('cs', 'en'), 'defaultLocale', 'cs',
      'template', 'chateau', 'palette', 'slonova-kost'),
    'venues', jsonb_build_array(
      jsonb_build_object('id', tap.u('as:venue1'), 'name', jsonb_build_object('cs', 'Zámek'),
        'address', 'Zámecká 1', 'isPrivate', false, 'directions', null, 'mapUrl', 'https://mapy.example/zamek'),
      jsonb_build_object('id', tap.u('as:venue2'), 'name', jsonb_build_object('cs', 'Soukromá zahrada'),
        'address', 'Tajná 7', 'isPrivate', true, 'directions', null, 'mapUrl', null)),
    'events', jsonb_build_array(
      jsonb_build_object('id', tap.u('as:event1'), 'kind', 'ceremony',
        'title', jsonb_build_object('cs', p_title, 'en', 'Ceremony'), 'description', null,
        'startsAt', '2027-06-19T14:00:00+02:00', 'endsAt', '2027-06-19T15:00:00+02:00',
        'venueId', tap.u('as:venue1'), 'rsvpEnabled', true)),
    'blocks', jsonb_build_array(
      jsonb_build_object('id', tap.u('as:block1'), 'type', 'hero', 'anchor', 'uvod', 'enabled', true,
        'position', 1, 'sensitive', false, 'data', jsonb_build_object('countdown', true)),
      jsonb_build_object('id', tap.u('as:block2'), 'type', 'gifts', 'anchor', 'dary', 'enabled', true,
        'position', 3, 'sensitive', true,
        'data', jsonb_build_object('intro', jsonb_build_object('cs', 'Dar'), 'account', '19-2000145399/0800')),
      jsonb_build_object('id', coalesce(p_foreign_block, tap.u('as:block3')), 'type', 'faq', 'anchor', 'faq',
        'enabled', false, 'position', 2, 'sensitive', false, 'data', '{"items": []}'::jsonb)))
$$;

create function tap.as_public(p_slug text, p_title text default 'Zveřejněno') returns jsonb
  language sql as $$
  select jsonb_build_object('version', 1, 'slug', p_slug, 'title', p_title,
    'partners', jsonb_build_object('a', 'Klára', 'b', 'Matěj'), 'blocks', '[]'::jsonb)
$$;

grant execute on function tap.as_work(text, uuid), tap.as_public(text, text) to public;

-- ---------------------------------------------------------------------------
-- Oprávnění a izolace volání: jen správce vlastní svatby
-- ---------------------------------------------------------------------------
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'admin_site_load()', 'admin_site_unpublish()', 'admin_my_weddings()'] loop
    perform tap.become('authenticated', tap.wa(), 'visitor');
    perform tap.throws('select se_vezmou.' || v_fn, '42501', v_fn || ': návštěvník je odmítnut');
    perform tap.become('authenticated', tap.wa(), 'guest_pin', tap.u('guest-session'));
    perform tap.throws('select se_vezmou.' || v_fn, '42501', v_fn || ': host po PINu je odmítnut');
    perform tap.become('authenticated', tap.wa(), 'preview');
    perform tap.throws('select se_vezmou.' || v_fn, '42501', v_fn || ': náhled je odmítnut');
    perform tap.reset();
  end loop;

  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.throws('select se_vezmou.admin_site_save(0, ''{}''::jsonb)', '42501', 'admin_site_save: návštěvník je odmítnut');
  perform tap.throws('select se_vezmou.admin_site_publish(''{}''::jsonb, ''{}''::jsonb, null, (select site_rev from se_vezmou.weddings where id = tap.wa()))', '42501', 'admin_site_publish: návštěvník je odmítnut');
  perform tap.throws('select se_vezmou.admin_site_checkpoint(''{}''::jsonb, ''{}''::jsonb, null)', '42501', 'admin_site_checkpoint: návštěvník je odmítnut');
  perform tap.throws('select se_vezmou.admin_quick_notice_set(null, false)', '42501', 'admin_quick_notice_set: návštěvník je odmítnut');
  perform tap.throws(format('select se_vezmou.admin_site_version_get(%L)', tap.u('A:version')), '42501', 'admin_site_version_get: návštěvník je odmítnut');
  perform tap.reset();

  -- bez claimů a role anon funkce nespustí
  perform tap.throws('select se_vezmou.admin_site_load()', '42501', 'admin_site_load: authenticated bez claimů je odmítnut');
  set local role anon;
  perform tap.throws('select se_vezmou.admin_site_load()', '42501', 'admin_site_load: anon nemá execute');
  perform tap.reset();

  perform tap.ok(not has_function_privilege('authenticated', 'se_vezmou.admin_wedding()', 'execute')
                 and not has_function_privilege('service_role', 'se_vezmou.admin_site_save(integer, jsonb, boolean)', 'execute'),
    'interní admin_wedding není pro nikoho a service role nespouští funkce správce');
end
$$;

-- ---------------------------------------------------------------------------
-- admin_site_load: jen data vlastní svatby, bez hashů a cizích e-mailů
-- ---------------------------------------------------------------------------
do $$
declare
  j jsonb;
begin
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  j := se_vezmou.admin_site_load();
  perform tap.reset();
  perform tap.ok(j #>> '{wedding,id}' = tap.wa()::text, 'load: vrací vlastní svatbu');
  perform tap.ok(j #>> '{wedding,partner_a_name}' = 'Klára', 'load: jména páru');
  perform tap.ok(jsonb_array_length(j -> 'blocks') = 2 and jsonb_array_length(j -> 'events') = 2, 'load: bloky a události vlastní svatby');
  perform tap.ok(j::text not like '%Alena%' and j::text not like '%Svoboda%' and j::text not like '%druha-svatba%', 'load: nic z cizí svatby');
  perform tap.ok(j::text not like '%hash-%' and j::text not like '%@example.test%', 'load: žádné hashe PINů ani e-mailové adresy');
  perform tap.ok((j #>> '{wedding,has_guest_pin}')::boolean, 'load: has_guest_pin je jen příznak');
  perform tap.ok(jsonb_array_length(j -> 'versions') = 1 and (j #>> '{versions,0,is_published}')::boolean, 'load: historie obsahuje zveřejněnou verzi');
  perform tap.ok(not (j #>> '{wedding,has_unpublished_changes}')::boolean, 'load: bez uložení konceptu nejsou nezveřejněné změny');
end
$$;

-- p_touch = false (naplnění pracovní kopie ze zveřejněné verze) nemění čas uložení konceptu;
-- sonda se vrátí zpět (podtransakce), aby nezměnila fixturu pro další kontroly
do $$
declare
  r record;
begin
  begin
    perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
    select * into r from se_vezmou.admin_site_save(0, tap.as_work(), false);
    perform tap.reset();
    perform tap.ok(r.ok and r.rev = 1, 'save s p_touch = false uloží a zvýší revizi');
    perform tap.ok((select draft_saved_at from se_vezmou.weddings where id = tap.wa()) is null,
      'save s p_touch = false nemění čas uložení konceptu');
    raise exception 'sonda_vratit_zpet';
  exception when others then
    if sqlerrm <> 'sonda_vratit_zpet' then
      raise;
    end if;
  end;
  perform tap.reset();
end
$$;

-- ---------------------------------------------------------------------------
-- admin_site_save: zápis, optimistické zamykání, nepřepsání cizích řádků, vazby
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  j jsonb;
  v_b_block uuid := tap.u('B:block1');
  v_b_before jsonb;
begin
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));

  select * into r from se_vezmou.admin_site_save(5, tap.as_work());
  perform tap.ok(r.conflict and not r.ok and r.rev = 0, 'save: špatná revize je konflikt a nic se nezmění');
  perform tap.reset();
  perform tap.ok((select template from se_vezmou.weddings where id = tap.wa()) <> 'chateau', 'konflikt nezměnil svatbu');

  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  select * into r from se_vezmou.admin_site_save(0, tap.as_work());
  perform tap.ok(r.ok and not r.conflict and r.rev = 1, 'save: správná revize uloží a zvýší číslo');
  select * into r from se_vezmou.admin_site_save(0, tap.as_work());
  perform tap.ok(r.conflict and r.rev = 1, 'save: opakovaná stará revize je konflikt');
  j := se_vezmou.admin_site_load();
  perform tap.reset();

  perform tap.ok(j #>> '{wedding,template}' = 'chateau' and j #>> '{wedding,palette}' = 'slonova-kost', 'save: šablona a paleta');
  perform tap.ok(jsonb_array_length(j -> 'blocks') = 3, 'save: bloky nahrazeny (hero, faq, dary)');
  perform tap.ok(exists (select 1 from se_vezmou.content_blocks where id = tap.u('as:block2') and wedding_id = tap.wa() and sensitive
                                and data ->> 'account' = '19-2000145399/0800'), 'save: citlivý blok nese číslo účtu jen v pracovní kopii');
  perform tap.ok(exists (select 1 from se_vezmou.venues where id = tap.u('as:venue2') and is_private and address = 'Tajná 7'), 'save: soukromé místo');
  perform tap.ok(exists (select 1 from se_vezmou.venues where id = tap.u('as:venue1') and map_url = 'https://mapy.example/zamek'), 'save: odkaz na mapu');
  perform tap.eq((select count(*) from se_vezmou.events where wedding_id = tap.wa()), 1, 'save: odebraná událost zmizela');
  perform tap.ok(not exists (select 1 from se_vezmou.invitations where wedding_id = tap.wa() and event_id = tap.u('A:event1')), 'save: pozvání odebrané události zmizela');
  perform tap.ok((select draft_saved_at from se_vezmou.weddings where id = tap.wa()) is not null, 'save: čas uložení konceptu');
  perform tap.ok((select updated_by from se_vezmou.content_blocks where id = tap.u('as:block1')) = tap.u('A:admin'), 'save: blok nese autora změny');

  -- cizí identifikátor bloku v payloadu nepřepíše svatbu B
  select to_jsonb(b) into v_b_before from se_vezmou.content_blocks b where b.id = v_b_block;
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  select * into r from se_vezmou.admin_site_save(1, tap.as_work('Obřad 2', v_b_block));
  perform tap.reset();
  perform tap.ok(r.ok, 'save: payload s cizím id bloku se zpracuje');
  perform tap.ok((select to_jsonb(b) from se_vezmou.content_blocks b where b.id = v_b_block) = v_b_before, 'save: blok svatby B zůstal beze změny');
  perform tap.ok(not exists (select 1 from se_vezmou.content_blocks where wedding_id = tap.wa() and id = v_b_block), 'save: cizí id bloku se k svatbě A nepřiřadilo');
  perform tap.eq((select count(*) from se_vezmou.content_blocks where wedding_id = tap.wb()), 2, 'save: svatba B má všechny bloky');
  perform tap.ok(not exists (select 1 from se_vezmou.weddings where id = tap.wb() and template = 'chateau'), 'save: svatba B nemá změněnou šablonu');

  -- chybné vstupy
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.throws('select * from se_vezmou.admin_site_save(2, ''[]''::jsonb)', '22023', 'save: payload musí být objekt');
  perform tap.throws('select * from se_vezmou.admin_site_save(2, ''{"wedding": {}}''::jsonb)', '22023', 'save: chybí pole venues, events, blocks');
  perform tap.throws(format('select * from se_vezmou.admin_site_save(2, %L::jsonb)',
    jsonb_set(tap.as_work(), '{wedding,template}', '"neexistuje"')::text), '23514', 'save: neznámá šablona selže na kontrole');
  perform tap.throws(format('select * from se_vezmou.admin_site_save(2, %L::jsonb)',
    jsonb_set(tap.as_work(), '{venues,0,mapUrl}', '"javascript:alert(1)"')::text), '23514', 'save: odkaz na mapu jen http(s)');
  perform tap.throws(format('select * from se_vezmou.admin_site_save(2, %L::jsonb)',
    jsonb_set(jsonb_set(tap.as_work(), '{wedding,locales}', '["cs"]'), '{wedding,defaultLocale}', '"en"')::text), '23514', 'save: výchozí jazyk musí být mezi jazyky webu');
  perform tap.reset();
  perform tap.ok((select site_rev from se_vezmou.weddings where id = tap.wa()) = 2, 'neúspěšné uložení revizi nezměnilo');
end
$$;

-- ---------------------------------------------------------------------------
-- Zveřejnění, stažení z publikace, nové zveřejnění, verze a jejich oříznutí
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  j jsonb;
begin
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  j := se_vezmou.admin_site_load();
  perform tap.ok((j #>> '{wedding,has_unpublished_changes}')::boolean, 'po uložení koncept je novější než zveřejněná verze');

  perform tap.throws('select * from se_vezmou.admin_site_publish(''{}''::jsonb, ''{}''::jsonb, null, (select site_rev from se_vezmou.weddings where id = tap.wa()))', '22023', 'publish: prázdný snímek se odmítne');
  perform tap.throws(format('select * from se_vezmou.admin_site_publish(%L::jsonb, ''{}''::jsonb, null, (select site_rev from se_vezmou.weddings where id = tap.wa()))', tap.as_public('jina-adresa')::text),
    '22023', 'publish: snímek s cizí adresou se odmítne');
  perform tap.throws(format('select * from se_vezmou.admin_site_publish(%L::jsonb, ''[]''::jsonb, null, (select site_rev from se_vezmou.weddings where id = tap.wa()))', tap.as_public('klara-a-matej')::text),
    '22023', 'publish: citlivá část musí být objekt');

  select * into r from se_vezmou.admin_site_publish(tap.as_public('klara-a-matej', 'Verze 2'),
    '{"gifts": {"account": "1/0100"}}'::jsonb, '  druhá verze  ', (select site_rev from se_vezmou.weddings where id = tap.wa()));
  perform tap.ok(r.version_no = 2 and r.slug = 'klara-a-matej', 'publish: nová verze č. 2');
  j := se_vezmou.admin_site_load();
  perform tap.reset();
  perform tap.ok((select published_version_id from se_vezmou.weddings where id = tap.wa()) =
                 (select id from se_vezmou.site_versions where wedding_id = tap.wa() and version_no = 2), 'publish: zveřejněná je verze 2');
  perform tap.ok((select note from se_vezmou.site_versions where wedding_id = tap.wa() and version_no = 2) = 'druhá verze', 'publish: poznámka se ořízne');
  perform tap.ok(exists (select 1 from se_vezmou.site_version_sensitive where wedding_id = tap.wa()
       and version_id = (select id from se_vezmou.site_versions where wedding_id = tap.wa() and version_no = 2)
       and sensitive_content -> 'gifts' ->> 'account' = '1/0100'), 'publish: citlivá část je ve vlastní tabulce');
  perform tap.ok(not (j #>> '{wedding,has_unpublished_changes}')::boolean, 'po zveřejnění nejsou nezveřejněné změny');
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where wedding_id = tap.wa() and action = 'site.published'
       and actor_id = tap.u('A:admin') and meta = '{"version_no": 2}'), 'publish: audit bez textů');

  -- host vidí novou verzi
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.ok((se_vezmou.get_public_site() #>> '{content,title}') = 'Verze 2', 'host vidí zveřejněnou verzi 2');
  perform tap.reset();

  -- stažení z publikace: web zmizí (null), adresa zůstává
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform se_vezmou.admin_site_unpublish();
  perform tap.throws('select se_vezmou.admin_site_unpublish()', '55000', 'unpublish: dvakrát nejde');
  perform tap.reset();
  perform tap.ok((select status from se_vezmou.weddings where id = tap.wa()) = 'draft', 'unpublish: stav draft');
  perform tap.ok(exists (select 1 from se_vezmou.slug_registry where slug = 'klara-a-matej' and state = 'active'), 'unpublish: adresa zůstává přidělená');
  perform tap.ok(exists (select 1 from se_vezmou.wedding_status_history where wedding_id = tap.wa() and from_status = 'published' and to_status = 'draft'), 'unpublish: historie stavů');
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.ok(se_vezmou.get_public_site() is null, 'po stažení host nic nevidí');
  perform tap.reset();
  set local role service_role;
  perform tap.ok(not exists (select 1 from se_vezmou.resolve_slug('klara-a-matej')), 'po stažení se adresa nerozlišuje (stejná 404)');
  perform tap.reset();

  -- koncept po stažení jde dál editovat a znovu zveřejnit; průvodce ho nepřepíše
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  select * into r from se_vezmou.admin_site_save(2, tap.as_work('Obřad 3'));
  perform tap.ok(r.ok, 'po stažení lze koncept ukládat');
  select * into r from se_vezmou.admin_site_publish(tap.as_public('klara-a-matej', 'Verze 3'), '{}'::jsonb, null, (select site_rev from se_vezmou.weddings where id = tap.wa()));
  perform tap.ok(r.version_no = 3, 'znovuzveřejnění vytvoří verzi 3');
  perform tap.reset();
  perform tap.ok((select status from se_vezmou.weddings where id = tap.wa()) = 'published', 'znovu zveřejněno');
end
$$;

-- Průvodce po prvním zveřejnění pracovní kopii nepřepíše
do $$
begin
  update se_vezmou.weddings set status = 'draft' where id = tap.wa();
  set local role service_role;
  perform tap.ok((select status from se_vezmou.wizard_load(tap.wa())) = 'unpublished', 'wizard_load: stažený web hlásí unpublished');
  perform tap.throws(format('select * from se_vezmou.wizard_save(%L, null, ''{}''::jsonb, %L::jsonb)', tap.wa(), tap.as_work()::text),
    '55000', 'wizard_save: web po zveřejnění průvodce nepřepíše');
  perform tap.reset();
  update se_vezmou.weddings set status = 'published' where id = tap.wa();
end
$$;

-- Zablokovaný web se needituje ani nezveřejňuje
do $$
declare
  r record;
begin
  update se_vezmou.weddings set status = 'blocked' where id = tap.wa();
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.throws(format('select * from se_vezmou.admin_site_save(%s, %L::jsonb)',
    (select site_rev from se_vezmou.weddings where id = tap.wa()), tap.as_work()::text), '55000', 'zablokovaný web: uložení se odmítne');
  perform tap.throws(format('select * from se_vezmou.admin_site_publish(%L::jsonb, ''{}''::jsonb, null, (select site_rev from se_vezmou.weddings where id = tap.wa()))', tap.as_public('klara-a-matej')::text),
    '55000', 'zablokovaný web: zveřejnění se odmítne');
  perform tap.throws('select se_vezmou.admin_quick_notice_set(''{"cs": "x"}'', true)', '55000', 'zablokovaný web: rychlá změna se odmítne');
  perform tap.reset();
  update se_vezmou.weddings set status = 'published' where id = tap.wa();
end
$$;

-- Zveřejnění s PINem hostů vyžaduje nastavený PIN
do $$
begin
  update se_vezmou.weddings set guest_pin_enabled = true where id = tap.wa();
  update se_vezmou.wedding_auth set guest_pin_hash = null where wedding_id = tap.wa();
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.throws(format('select * from se_vezmou.admin_site_publish(%L::jsonb, ''{}''::jsonb, null, (select site_rev from se_vezmou.weddings where id = tap.wa()))', tap.as_public('klara-a-matej')::text),
    'guest_pin_missing', 'publish: zapnutý PIN hostů bez hodnoty se odmítne');
  perform tap.reset();
  update se_vezmou.weddings set guest_pin_enabled = false where id = tap.wa();
  update se_vezmou.wedding_auth set guest_pin_hash = 'hash-guest-A' where wedding_id = tap.wa();
end
$$;

-- Body pro vrácení, čtení verze a oříznutí historie
do $$
declare
  r record;
  j jsonb;
  v_b_version uuid := tap.u('B:version');
begin
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  select * into r from se_vezmou.admin_site_checkpoint(tap.as_public('klara-a-matej', 'Bod 1'), '{}'::jsonb, 'před úpravou');
  perform tap.ok(r.version_no = 4, 'checkpoint: číslo verze 4');
  perform tap.ok((select kind from se_vezmou.site_versions where wedding_id = tap.wa() and version_no = 4) = 'checkpoint', 'checkpoint: druh checkpoint');
  perform tap.throws('select * from se_vezmou.admin_site_checkpoint(''{}''::jsonb, ''{}''::jsonb, null)', '22023', 'checkpoint: neplatný snímek se odmítne');

  j := se_vezmou.admin_site_version_get((select id from se_vezmou.site_versions where wedding_id = tap.wa() and version_no = 4));
  perform tap.ok(j #>> '{public_content,title}' = 'Bod 1' and j ->> 'note' = 'před úpravou', 'version_get: obsah vlastní verze');
  perform tap.ok(se_vezmou.admin_site_version_get(v_b_version) is null, 'version_get: verze svatby B se nevrátí');
  perform tap.ok(se_vezmou.admin_site_version_get(gen_random_uuid()) is null, 'version_get: neznámá verze je null');
  perform tap.reset();

  -- versions_keep = 3: nejstarší verze se smažou, zveřejněná zůstane
  update se_vezmou.app_settings set value = '3' where key = 'versions_keep';
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform se_vezmou.admin_site_checkpoint(tap.as_public('klara-a-matej', 'Bod 2'), '{}'::jsonb, null);
  perform se_vezmou.admin_site_checkpoint(tap.as_public('klara-a-matej', 'Bod 3'), '{}'::jsonb, null);
  j := se_vezmou.admin_site_load();
  perform tap.reset();
  perform tap.ok(jsonb_array_length(j -> 'versions') <= 4, 'prune: historie je oříznutá (nejvýš limit a zveřejněná)');
  perform tap.ok(exists (select 1 from se_vezmou.site_versions where id = (select published_version_id from se_vezmou.weddings where id = tap.wa())),
    'prune: zveřejněná verze zůstala');
  perform tap.ok(not exists (select 1 from se_vezmou.site_versions where wedding_id = tap.wa() and version_no = 1), 'prune: nejstarší verze zmizela');
  perform tap.ok(not exists (select 1 from se_vezmou.site_version_sensitive s where s.wedding_id = tap.wa()
       and not exists (select 1 from se_vezmou.site_versions v where v.id = s.version_id)), 'prune: citlivá část smazané verze zmizela');
  perform tap.eq((select count(*) from se_vezmou.site_versions where wedding_id = tap.wb()), 1, 'prune: svatba B má všechny verze');
  update se_vezmou.app_settings set value = '20' where key = 'versions_keep';
end
$$;

-- ---------------------------------------------------------------------------
-- Rychlá změna: platí hned, validace, audit bez textu
-- ---------------------------------------------------------------------------
do $$
begin
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform se_vezmou.admin_quick_notice_set('{"cs": "Změna: obřad v 15:00", "en": "Ceremony at 3 pm"}', true);
  perform tap.reset();
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.ok((se_vezmou.get_public_site() #>> '{quick_notice,cs}') = 'Změna: obřad v 15:00', 'rychlá změna je hned na webu bez nové verze');
  perform tap.reset();

  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform se_vezmou.admin_quick_notice_set('{"cs": "Změna: obřad v 15:00"}', false);
  perform tap.reset();
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.ok((se_vezmou.get_public_site() -> 'quick_notice') = 'null'::jsonb or (se_vezmou.get_public_site() -> 'quick_notice') is null,
    'vypnutá rychlá změna se nezobrazuje');
  perform tap.reset();
  perform tap.ok((select quick_notice ->> 'cs' from se_vezmou.weddings where id = tap.wa()) = 'Změna: obřad v 15:00', 'vypnutá změna zůstává uložená');

  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.throws('select se_vezmou.admin_quick_notice_set(''{"cs": "  "}'', true)', 'notice_empty', 'zapnout prázdný text nejde');
  perform tap.throws('select se_vezmou.admin_quick_notice_set(null, true)', 'notice_empty', 'zapnout bez textu nejde');
  perform tap.throws('select se_vezmou.admin_quick_notice_set(''{"de": "x"}'', true)', '22023', 'neznámý jazyk se odmítne');
  perform tap.throws('select se_vezmou.admin_quick_notice_set(''{"cs": 5}'', true)', '22023', 'text musí být řetězec');
  perform tap.throws(format('select se_vezmou.admin_quick_notice_set(%L::jsonb, true)', jsonb_build_object('cs', repeat('x', 501))::text),
    '22023', 'příliš dlouhý text se odmítne');
  perform se_vezmou.admin_quick_notice_set(null, false);
  perform tap.reset();
  perform tap.ok(not exists (select 1 from se_vezmou.audit_log where wedding_id = tap.wa() and action = 'site.quick_notice'
       and meta::text like '%obřad%'), 'audit rychlé změny neobsahuje text');
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where wedding_id = tap.wa() and action = 'site.quick_notice' and meta = '{"enabled": true}'),
    'audit rychlé změny nese jen příznak');
end
$$;

-- ---------------------------------------------------------------------------
-- Výběr svatby: svatby téhož správce (stejný e-mail), nikdy cizí
-- ---------------------------------------------------------------------------
do $$
declare
  v_n bigint;
begin
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  select count(*) into v_n from se_vezmou.admin_my_weddings();
  perform tap.reset();
  perform tap.eq(v_n, 1, 'admin_my_weddings: správce jedné svatby vidí jen ji');

  -- stejný e-mail správuje i svatbu B
  insert into se_vezmou.wedding_admins (id, wedding_id, email)
  values (tap.u('B:admin2'), tap.wb(), 'A-SPRAVCE@example.test');
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  select count(*) into v_n from se_vezmou.admin_my_weddings();
  perform tap.eq(v_n, 2, 'admin_my_weddings: správce více svateb vidí obě (e-mail bez ohledu na velikost písmen)');
  perform tap.ok((select count(*) from se_vezmou.admin_my_weddings() where is_current) = 1
                 and (select wedding_id from se_vezmou.admin_my_weddings() where is_current) = tap.wa(), 'admin_my_weddings: právě jedna aktuální');
  perform tap.ok((select string_agg(x::text, '') from se_vezmou.admin_my_weddings() x) not like '%@%', 'admin_my_weddings: žádné e-maily');
  perform tap.reset();

  -- odebraný správce svatbu nevidí
  update se_vezmou.wedding_admins set removed_at = now() where id = tap.u('B:admin2');
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  select count(*) into v_n from se_vezmou.admin_my_weddings();
  perform tap.reset();
  perform tap.eq(v_n, 1, 'admin_my_weddings: odebraný správce svatbu nevidí');

  -- správce svatby B nečte data svatby A funkcemi správy
  perform tap.become('authenticated', tap.wb(), 'admin', tap.u('B:admin'));
  perform tap.ok(se_vezmou.admin_site_load() #>> '{wedding,id}' = tap.wb()::text, 'správce B čte jen svou svatbu');
  perform tap.ok(se_vezmou.admin_site_version_get(tap.u('A:version')) is null, 'správce B nečte verzi svatby A');
  perform tap.reset();
end
$$;

-- Audit zásahů správy neobsahuje osobní údaje ani obsah
do $$
begin
  perform tap.ok(not exists (select 1 from se_vezmou.audit_log
    where wedding_id = tap.wa() and action in ('site.published', 'site.unpublished', 'site.checkpoint', 'site.quick_notice')
      and meta::text ~* '(Klára|Matěj|Zámek|Tajná|účet|account)'), 'audit správy webu nenese obsah webu');
end
$$;

-- ---------------------------------------------------------------------------
-- M7a oprava: zveřejnění je vázané na revizi pracovní kopie
-- ---------------------------------------------------------------------------
do $$
declare
  v_rev integer;
  r record;
begin
  select site_rev into v_rev from se_vezmou.weddings where id = tap.wa();

  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  select * into r from se_vezmou.admin_site_publish(tap.as_public('klara-a-matej', 'Zastaralá'), '{}'::jsonb, null, v_rev - 1);
  perform tap.ok(r.conflict and not r.ok and r.version_no is null, 'publish: zastaralá revize je konflikt');
  select * into r from se_vezmou.admin_site_publish(tap.as_public('klara-a-matej', 'Bez revize'), '{}'::jsonb, null, null);
  perform tap.ok(r.conflict, 'publish: chybějící revize je konflikt');
  perform tap.reset();
  perform tap.ok((select site_rev from se_vezmou.weddings where id = tap.wa()) = v_rev, 'konflikt nezměnil revizi');
  perform tap.ok(not exists (select 1 from se_vezmou.site_versions where wedding_id = tap.wa() and public_content::text like '%Zastaralá%'),
    'konflikt nic nezveřejnil');

  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  select * into r from se_vezmou.admin_site_publish(tap.as_public('klara-a-matej', 'Aktuální'), '{}'::jsonb, null, v_rev);
  perform tap.ok(r.ok and not r.conflict and r.version_no is not null, 'publish: aktuální revize zveřejní');
  -- druhý pokus se stejnou revizí po uložení jinou změnou
  perform se_vezmou.admin_site_save(v_rev, tap.as_work('Jiná změna'));
  select * into r from se_vezmou.admin_site_publish(tap.as_public('klara-a-matej', 'Po změně'), '{}'::jsonb, null, v_rev);
  perform tap.ok(r.conflict, 'publish: po uložení z jiného okna je stará revize konflikt');
  perform tap.reset();
end
$$;

-- ---------------------------------------------------------------------------
-- Souřadnice místa pro mapu: uložení, načtení, rozsah
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  j jsonb;
  v_rev integer := (select site_rev from se_vezmou.weddings where id = tap.wa());
  v_work jsonb := jsonb_set(jsonb_set(tap.as_work('Mapa'), '{venues,0,lat}', '49.92556'), '{venues,0,lng}', '14.27639');
begin
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  select * into r from se_vezmou.admin_site_save(v_rev, v_work);
  j := se_vezmou.admin_site_load();
  perform tap.reset();
  perform tap.ok(r.ok, 'souřadnice: uložení projde');
  perform tap.ok(exists (select 1 from se_vezmou.venues where id = tap.u('as:venue1') and lat = 49.92556 and lng = 14.27639),
    'souřadnice: zapsané do místa');
  perform tap.ok((select v ->> 'lat' from jsonb_array_elements(j -> 'venues') v where v ->> 'id' = tap.u('as:venue1')::text) = '49.92556',
    'souřadnice: načtení je vrací editoru');

  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  select * into r from se_vezmou.admin_site_save(v_rev + 1, tap.as_work('Mapa'));
  perform tap.reset();
  perform tap.ok(exists (select 1 from se_vezmou.venues where id = tap.u('as:venue1') and lat is null and lng is null),
    'souřadnice: payload bez nich je smaže (změna adresy)');

  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.throws(format('select * from se_vezmou.admin_site_save(%s, %L::jsonb)', v_rev + 2,
    jsonb_set(tap.as_work('Mapa'), '{venues,0,lat}', '91')), '23514', 'souřadnice: mimo rozsah odmítne kontrola tabulky');
  perform tap.reset();
end
$$;

rollback;
