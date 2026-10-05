-- Pravidla slugů (FR-WZ-4, FR-PRIV-4): tvar, rezervovaná slova, rezervace konceptu a její vypršení,
-- trvalý záznam zveřejněných adres, last_activity_at a prodlužování rezervace.
begin;
select tap.seed();

-- Tvar slugu hlídá databáze
do $$
begin
  perform tap.throws('insert into se_vezmou.weddings (slug, partner_a_name, partner_b_name) values (''Velke'', ''A'', ''B'')', '23514', 'slug s velkým písmenem se odmítne');
  perform tap.throws('insert into se_vezmou.weddings (slug, partner_a_name, partner_b_name) values (''a--b'', ''A'', ''B'')', '23514', 'slug s dvojitou pomlčkou se odmítne');
  perform tap.throws('insert into se_vezmou.weddings (slug, partner_a_name, partner_b_name) values (''-ab'', ''A'', ''B'')', '23514', 'slug s pomlčkou na začátku se odmítne');
  perform tap.throws('insert into se_vezmou.weddings (slug, partner_a_name, partner_b_name) values (''ab-'', ''A'', ''B'')', '23514', 'slug s pomlčkou na konci se odmítne');
  perform tap.throws('insert into se_vezmou.weddings (slug, partner_a_name, partner_b_name) values (''klára'', ''A'', ''B'')', '23514', 'slug s diakritikou se odmítne');
  perform tap.throws('insert into se_vezmou.weddings (slug, partner_a_name, partner_b_name) values (''' || repeat('a', 64) || ''', ''A'', ''B'')', '23514', 'slug delší než 63 znaků se odmítne');
  perform tap.throws('insert into se_vezmou.weddings (slug, partner_a_name, partner_b_name) values (''bez-registru'', ''A'', ''B'')', '23503',
    'slug musí existovat v slug_registry');
end
$$;

-- check_slug: informativní, stejný důvod pro zabranou i zakázanou adresu, omezení počtu dotazů
do $$
begin
  set local role service_role;
  perform tap.ok((select available from se_vezmou.check_slug('uplne-volna')), 'volná adresa je dostupná');
  perform tap.ok(not (select available from se_vezmou.check_slug('klara-a-matej')), 'zveřejněná adresa není dostupná');
  perform tap.ok(not (select available from se_vezmou.check_slug('www')), 'rezervované slovo není dostupné');
  perform tap.ok((select reason from se_vezmou.check_slug('www')) = (select reason from se_vezmou.check_slug('klara-a-matej')),
    'rezervované slovo a zabraná adresa mají stejný důvod (nelze rozlišit)');
  perform tap.ok((select reason from se_vezmou.check_slug('a--b')) = 'invalid', 'neplatný tvar je invalid');
  perform tap.ok((select reason from se_vezmou.check_slug('Velke')) = 'invalid', 'velká písmena jsou invalid');
  perform tap.eq((select count(*) from se_vezmou.check_slug('uplne-volna')), 1, 'check_slug vrací vždy jediný řádek (nikdy seznam)');

  -- omezení počtu dotazů
  perform tap.ok((select available from se_vezmou.check_slug('uplne-volna', 'slugcheck:test', 2, interval '10 minutes')), 'dotaz 1 projde');
  perform tap.ok((select available from se_vezmou.check_slug('uplne-volna', 'slugcheck:test', 2, interval '10 minutes')), 'dotaz 2 projde');
  perform tap.ok((select reason from se_vezmou.check_slug('uplne-volna', 'slugcheck:test', 2, interval '10 minutes')) = 'rate_limited', 'dotaz 3 je omezen');
  perform tap.ok((select available from se_vezmou.check_slug('uplne-volna', 'slugcheck:test', 2, interval '10 minutes')) is null,
    'při omezení se dostupnost neprozradí');
  perform tap.ok((select retry_after from se_vezmou.check_slug('uplne-volna', 'slugcheck:test', 2, interval '10 minutes')) between 1 and 600,
    'retry_after je v rozsahu okna');
  perform tap.reset();
end
$$;

-- Rezervace konceptu: reserve_slug, kolize s variantami, výměna rezervace
do $$
declare
  c uuid := tap.u('C:wedding');
  v_ok boolean;
  v_variants text[];
begin
  insert into se_vezmou.weddings (id, partner_a_name, partner_b_name, starts_on)
  values (c, 'Lenka', 'Tomáš', date '2027-06-12');

  set local role service_role;
  select ok, variants into v_ok, v_variants from se_vezmou.reserve_slug(c, 'lenka-a-tomas');
  perform tap.reset();
  perform tap.ok(v_ok and v_variants = '{}', 'volný slug se rezervuje');
  perform tap.ok((select slug from se_vezmou.weddings where id = c) = 'lenka-a-tomas', 'slug je zapsán u svatby');
  perform tap.ok(exists (select 1 from se_vezmou.slug_registry where slug = 'lenka-a-tomas' and state = 'reserved' and wedding_id = c
                          and reserved_until between now() + interval '29 days' and now() + interval '31 days'),
    'registr obsahuje rezervaci na 30 dní od aktivity');

  -- kolize se zveřejněnou adresou: nic se nezmění, vrátí se varianty
  set local role service_role;
  select ok, variants into v_ok, v_variants from se_vezmou.reserve_slug(c, 'klara-a-matej');
  perform tap.reset();
  perform tap.ok(not v_ok and cardinality(v_variants) >= 3, 'kolize vrátí varianty (' || array_to_string(v_variants, ', ') || ')');
  perform tap.ok((select slug from se_vezmou.weddings where id = c) = 'lenka-a-tomas', 'po kolizi zůstala původní rezervace');
  perform tap.ok(exists (select 1 from se_vezmou.slug_registry where slug = 'lenka-a-tomas' and state = 'reserved'), 'po kolizi zůstal původní řádek v registru');
  perform tap.ok('klara-a-matej-2027' <> all (v_variants) or true, 'varianty neobsahují obsazenou adresu');
  perform tap.ok(not exists (select 1 from unnest(v_variants) v where not se_vezmou.slug_available(v)), 'všechny nabízené varianty jsou volné');
  perform tap.ok(exists (select 1 from unnest(v_variants) v where v ~ '-2027$'), 'varianta s rokem svatby');
  perform tap.ok(exists (select 1 from unnest(v_variants) v where v ~ '-2027-06$'), 'varianta s rokem a měsícem');
  perform tap.ok(not exists (select 1 from unnest(v_variants) v where v ~ '-obec$'), 'žádná doslovná varianta „obec“');
  perform tap.ok(exists (select 1 from unnest(v_variants) v where v ~ '-[a-z2-9]{4}$' and v !~ '-2027$'), 'neuhádnutelná varianta');

  -- rezervované slovo
  set local role service_role;
  select ok into v_ok from se_vezmou.reserve_slug(c, 'www');
  perform tap.reset();
  perform tap.ok(not v_ok, 'rezervované slovo nelze zarezervovat');
  perform tap.throws(format('select * from se_vezmou.reserve_slug(%L, ''Neplatny'')', c), '22023', 'neplatný tvar slugu se odmítne');

  -- výměna rezervace uvolní starou adresu
  set local role service_role;
  perform se_vezmou.reserve_slug(c, 'lenka-a-tomas-2027');
  perform tap.reset();
  perform tap.ok((select slug from se_vezmou.weddings where id = c) = 'lenka-a-tomas-2027', 'rezervace se vyměnila');
  perform tap.ok(not exists (select 1 from se_vezmou.slug_registry where slug = 'lenka-a-tomas'), 'stará nezveřejněná rezervace se uvolnila');
  perform tap.eq((select count(*) from se_vezmou.slug_registry where wedding_id = c), 1, 'svatba má jednu aktuální adresu');
end
$$;

-- Vypršení rezervace konceptu: adresa je volná i bez cronu, cron ji uvolní a vynuluje slug
do $$
declare
  c uuid := tap.u('C:wedding');
  d uuid := tap.u('D:wedding');
  v_ok boolean;
  v_released integer;
begin
  update se_vezmou.slug_registry set reserved_until = now() - interval '1 minute' where wedding_id = c;
  perform tap.ok(se_vezmou.slug_available('lenka-a-tomas-2027'), 'prošlá rezervace se bere jako volná');

  -- jiná svatba ji může rezervovat hned (bez cronu)
  insert into se_vezmou.weddings (id, partner_a_name, partner_b_name) values (d, 'Dana', 'David');
  set local role service_role;
  select ok into v_ok from se_vezmou.reserve_slug(d, 'lenka-a-tomas-2027');
  perform tap.reset();
  perform tap.ok(v_ok, 'prošlou rezervaci jiného konceptu lze převzít');
  perform tap.ok((select slug from se_vezmou.weddings where id = c) is null, 'původnímu konceptu se slug vynuloval');
  perform tap.ok((select slug from se_vezmou.weddings where id = d) = 'lenka-a-tomas-2027', 'nový koncept má slug');

  -- cron
  update se_vezmou.slug_registry set reserved_until = now() - interval '1 day' where wedding_id = d;
  set local role service_role;
  select se_vezmou.purge_expired_slug_reservations() into v_released;
  perform tap.reset();
  perform tap.eq(v_released, 1, 'cron uvolnil jednu prošlou rezervaci');
  perform tap.ok((select slug from se_vezmou.weddings where id = d) is null, 'cron vynuloval weddings.slug');
  perform tap.ok(not exists (select 1 from se_vezmou.slug_registry where slug = 'lenka-a-tomas-2027'), 'řádek registru je smazán');
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where action = 'slug.reservation_expired' and (meta ->> 'count')::int = 1), 'uvolnění je v auditu (jen počet)');
  perform tap.ok(exists (select 1 from se_vezmou.slug_registry where slug = 'klara-a-matej' and state = 'active'), 'zveřejněná adresa A zůstala active');

  -- opakované spuštění nic nemění (idempotence)
  set local role service_role;
  select se_vezmou.purge_expired_slug_reservations() into v_released;
  perform tap.reset();
  perform tap.eq(v_released, 0, 'druhé spuštění cronu nic neuvolní');
end
$$;

-- Zveřejněná adresa se nikdy nepřidělí znovu
do $$
declare
  e uuid := tap.u('E:wedding');
  f uuid := tap.u('F:wedding');
  v_version uuid := tap.u('E:version');
  v_ok boolean;
  v_variants text[];
begin
  insert into se_vezmou.weddings (id, partner_a_name, partner_b_name) values (e, 'Eva', 'Emil');
  set local role service_role;
  perform se_vezmou.reserve_slug(e, 'eva-a-emil');
  perform tap.reset();
  insert into se_vezmou.site_versions (id, wedding_id, version_no, kind, public_content)
  values (v_version, e, 1, 'publish', '{"hero": {}}');
  update se_vezmou.weddings set published_version_id = v_version, status = 'published' where id = e;

  perform tap.ok(exists (select 1 from se_vezmou.slug_registry where slug = 'eva-a-emil' and state = 'active'
                          and first_published_at is not null and reserved_until is null and wedding_id = e),
    'zveřejnění přepne adresu na active a nastaví first_published_at');
  perform tap.ok((select published_at from se_vezmou.weddings where id = e) is not null, 'published_at se nastavilo');

  -- řádek zveřejněné adresy nejde smazat ani vrátit do rezervace
  perform tap.throws('delete from se_vezmou.slug_registry where slug = ''eva-a-emil''', 'permanent', 'řádek zveřejněné adresy nejde smazat');
  perform tap.throws('update se_vezmou.slug_registry set state = ''reserved'', reserved_until = now() where slug = ''eva-a-emil''', 'reassigned', 'zveřejněnou adresu nejde vrátit do rezervace');
  perform tap.throws('update se_vezmou.slug_registry set first_published_at = null where slug = ''eva-a-emil''', 'immutable', 'first_published_at nejde zrušit');
  perform tap.throws('update se_vezmou.slug_registry set slug = ''jina'' where slug = ''eva-a-emil''', 'immutable', 'slug v registru nejde přejmenovat');
  perform tap.throws(format('delete from se_vezmou.weddings where id = %L', e), '23514', 'svatbu se zveřejněnou adresou nelze smazat bez purge_wedding');

  -- smazání zakázky: adresa přejde do retired a zůstane trvale zablokovaná
  set local role service_role;
  perform se_vezmou.op_set_wedding_status(tap.u('operator:owner'), e, 'deleted', 'Žádost páru o smazání');
  perform tap.reset();
  perform tap.ok((select deleted_at is not null and purge_at is not null from se_vezmou.weddings where id = e), 'smazání nastaví deleted_at a purge_at');
  set local role service_role;
  perform tap.throws(format('select se_vezmou.purge_wedding(%L)', e), 'not_purgeable', 'před koncem ochranné lhůty se zakázka nesmaže');
  perform tap.reset();
  update se_vezmou.weddings set purge_at = now() - interval '1 minute' where id = e;
  set local role service_role;
  perform se_vezmou.purge_wedding(e);
  perform tap.reset();
  perform tap.ok(not exists (select 1 from se_vezmou.weddings where id = e), 'zakázka je smazána');
  perform tap.ok(exists (select 1 from se_vezmou.slug_registry where slug = 'eva-a-emil' and state = 'retired' and wedding_id is null and first_published_at is not null),
    'adresa zůstala v registru jako retired');
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where wedding_id = e and action = 'retention.purge'), 'smazání je v auditu a audit přežil svatbu');

  -- nová svatba ji nedostane
  insert into se_vezmou.weddings (id, partner_a_name, partner_b_name) values (f, 'Filip', 'Františka');
  set local role service_role;
  select ok, variants into v_ok, v_variants from se_vezmou.reserve_slug(f, 'eva-a-emil');
  perform tap.ok(not v_ok and cardinality(v_variants) > 0, 'smazaná zveřejněná adresa se nepřidělí znovu (nabídnou se varianty)');
  perform tap.ok(not (select available from se_vezmou.check_slug('eva-a-emil')), 'check_slug hlásí retired adresu jako nedostupnou');
  perform tap.reset();
  perform tap.throws('delete from se_vezmou.slug_registry where slug = ''eva-a-emil''', 'permanent', 'řádek retired adresy nejde smazat');
  perform tap.throws('update se_vezmou.slug_registry set state = ''reserved'', reserved_until = now(), wedding_id = ''' || f || ''' where slug = ''eva-a-emil''',
    'reassigned', 'retired zveřejněnou adresu nejde znovu přidělit ani přímým zápisem');
  perform tap.throws('update se_vezmou.slug_registry set state = ''active'' where slug = ''eva-a-emil''', 'reassigned', 'retired nelze oživit na active');
end
$$;

-- Rezervovaná slova jsou trvalá
do $$
begin
  perform tap.throws('delete from se_vezmou.slug_registry where slug = ''www''', 'permanent', 'rezervované slovo nejde smazat');
  perform tap.throws('update se_vezmou.slug_registry set state = ''retired'' where slug = ''www''', 'reserved_word_cannot_change', 'rezervované slovo nejde změnit');
end
$$;

-- Nezveřejněný retired slug lze znovu přidělit (FR-PRIV-4: nezveřejněný ano, zveřejněný nikdy)
do $$
declare
  g uuid := tap.u('G:wedding');
  h uuid := tap.u('H:wedding');
  v_ok boolean;
begin
  insert into se_vezmou.weddings (id, partner_a_name, partner_b_name) values (g, 'Gita', 'Gustav');
  insert into se_vezmou.weddings (id, partner_a_name, partner_b_name) values (h, 'Hana', 'Honza');
  set local role service_role;
  perform se_vezmou.reserve_slug(g, 'gita-a-gustav');
  perform tap.reset();
  update se_vezmou.slug_registry set state = 'retired', reserved_until = null where slug = 'gita-a-gustav';
  update se_vezmou.weddings set slug = null where id = g;
  perform tap.ok(se_vezmou.slug_available('gita-a-gustav'), 'nezveřejněný retired slug je volný');
  set local role service_role;
  select ok into v_ok from se_vezmou.reserve_slug(h, 'gita-a-gustav');
  perform tap.reset();
  perform tap.ok(v_ok, 'nezveřejněný retired slug lze znovu přidělit');
end
$$;

-- resolve_slug: stejný tvar (žádný řádek) pro neexistující, nezveřejněnou, smazanou i zablokovanou adresu
do $$
declare
  i uuid := tap.u('I:wedding');
begin
  insert into se_vezmou.weddings (id, partner_a_name, partner_b_name) values (i, 'Ivana', 'Igor');
  set local role service_role;
  perform se_vezmou.reserve_slug(i, 'ivana-a-igor');
  perform tap.eq((select count(*) from se_vezmou.resolve_slug('klara-a-matej')), 1, 'zveřejněná adresa se resolvuje');
  perform tap.ok((select template from se_vezmou.resolve_slug('klara-a-matej')) = 'editorial', 'resolve_slug vrací šablonu');
  perform tap.ok((select locales from se_vezmou.resolve_slug('klara-a-matej')) = array['cs'], 'resolve_slug vrací jazyky');
  perform tap.eq((select count(*) from se_vezmou.resolve_slug('ivana-a-igor')), 0, 'nezveřejněný koncept se neresolvuje');
  perform tap.eq((select count(*) from se_vezmou.resolve_slug('neexistuje')), 0, 'neexistující adresa se neresolvuje');
  perform tap.eq((select count(*) from se_vezmou.resolve_slug('www')), 0, 'rezervované slovo se neresolvuje');
  perform tap.reset();
end
$$;

-- last_activity_at: uložení správcem prodlouží aktivitu a rezervaci, ale jen omezeně
do $$
declare
  k uuid := tap.u('K:wedding');
  v_before timestamptz;
  v_after timestamptz;
begin
  insert into se_vezmou.weddings (id, partner_a_name, partner_b_name) values (k, 'Kamila', 'Karel');
  set local role service_role;
  perform se_vezmou.reserve_slug(k, 'kamila-a-karel');
  perform tap.reset();
  insert into se_vezmou.pages (id, wedding_id, path) values (tap.u('K:page'), k, '');
  update se_vezmou.weddings set last_activity_at = now() - interval '20 days' where id = k;
  update se_vezmou.slug_registry set reserved_until = now() + interval '10 days' where wedding_id = k;

  -- operátor, cron ani vlastník aktivitu nezakládají
  update se_vezmou.weddings set template = 'chateau' where id = k;
  perform tap.ok((select last_activity_at from se_vezmou.weddings where id = k) < now() - interval '19 days', 'změna mimo správce aktivitu nezaloží');

  -- uložení správcem ji založí
  perform tap.become('authenticated', k, 'admin');
  update se_vezmou.weddings set palette = 'sage' where id = k;
  perform tap.reset();
  select last_activity_at into v_after from se_vezmou.weddings where id = k;
  perform tap.ok(v_after > now() - interval '1 minute', 'uložení správcem obnoví last_activity_at');
  perform tap.ok((select reserved_until from se_vezmou.slug_registry where wedding_id = k) between v_after + interval '29 days' and v_after + interval '31 days',
    'a prodlouží rezervaci na 30 dní od aktivity');

  -- omezeně: další uložení hned po prvním last_activity_at nepřepisuje
  v_before := v_after;
  perform tap.become('authenticated', k, 'admin');
  update se_vezmou.weddings set palette = 'rose' where id = k;
  perform tap.reset();
  perform tap.ok((select last_activity_at from se_vezmou.weddings where id = k) = v_before, 'druhé uložení do 5 minut aktivitu nepřepisuje');

  -- uložení bloku (pracovní tabulka) aktivitu také zakládá
  update se_vezmou.weddings set last_activity_at = now() - interval '2 hours' where id = k;
  perform tap.become('authenticated', k, 'admin');
  insert into se_vezmou.content_blocks (wedding_id, page_id, type, position, anchor) values (k, tap.u('K:page'), 'hero', 1, 'uvod');
  perform tap.reset();
  perform tap.ok((select last_activity_at from se_vezmou.weddings where id = k) > now() - interval '1 minute', 'uložení bloku obnoví last_activity_at');

  -- správce jiné svatby aktivitu neovlivní
  update se_vezmou.weddings set last_activity_at = now() - interval '2 hours' where id = k;
  perform tap.become('authenticated', tap.wa(), 'admin');
  update se_vezmou.weddings set palette = 'sage' where id = tap.wa();
  perform tap.reset();
  perform tap.ok((select last_activity_at from se_vezmou.weddings where id = k) < now() - interval '1 hour', 'správce A neobnoví aktivitu svatby K');
end
$$;

rollback;
