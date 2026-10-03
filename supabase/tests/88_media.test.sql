-- M7c: fotografie na R2 (ADR 0006): tabulka media a media_variants, kvóta, stav zpracování, popisek,
-- mazání, export, doručení (get_public_media) a izolace mezi svatbami.
-- Zdroj: docs/adr/0006-photo-storage.md, docs/data-model.md kap. 3.3 a 5.
begin;
-- testovací hodina (se_vezmou.clock_guard): purge_wedding se volá s časem po ochranné lhůtě, tedy z budoucnosti
select set_config('se_vezmou.test_clock', 'on', true);
select tap.seed();

-- Pomocník: payload variant tak, jak ho sestavuje aplikace (klíč {wedding}/{media}/{šířka}.{formát})
create function tap.variants(p_wedding uuid, p_media uuid, p_widths integer[]) returns jsonb
  language sql as $$
  select jsonb_agg(jsonb_build_object('width', w, 'height', w * 2 / 3, 'format', f, 'bytes', 1000 + w,
           'key', p_wedding::text || '/' || p_media::text || '/' || w::text || '.' || f))
    from unnest(p_widths) w, unnest(array['webp', 'avif']) f
$$;
grant execute on function tap.variants(uuid, uuid, integer[]) to public;

-- ---------------------------------------------------------------------------
-- Oprávnění: jen správce vlastní svatby; návštěvník, host, náhled a anon jsou odmítnuti
-- ---------------------------------------------------------------------------
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'admin_media_list()', 'admin_media_export()',
    format('admin_media_get(%L)', tap.u('A:media')),
    format('admin_media_request(%L, %L, %s)', 'photo', 'image/jpeg', 1000),
    format('admin_media_begin(%L)', tap.u('A:media')),
    format('admin_media_complete(%L, 100, 100, %L::jsonb)', tap.u('A:media'), '[]'),
    format('admin_media_fail(%L, %L)', tap.u('A:media'), 'corrupt'),
    format('admin_media_update(%L, null, true)', tap.u('A:media')),
    format('admin_media_delete(%L)', tap.u('A:media')),
    format('admin_media_variant(%L, 640, %L)', tap.u('A:media'), 'webp')] loop
    perform tap.become('authenticated', tap.wa(), 'visitor');
    perform tap.throws('select se_vezmou.' || v_fn, '42501', v_fn || ': návštěvník je odmítnut');
    perform tap.become('authenticated', tap.wa(), 'guest_pin', tap.u('guest-session'));
    perform tap.throws('select se_vezmou.' || v_fn, '42501', v_fn || ': host po PINu je odmítnut');
    perform tap.become('authenticated', tap.wa(), 'preview');
    perform tap.throws('select se_vezmou.' || v_fn, '42501', v_fn || ': náhled je odmítnut');
    perform tap.reset();
    set local role anon;
    perform tap.throws('select se_vezmou.' || v_fn, '42501', v_fn || ': anon nemá execute');
    perform tap.reset();
  end loop;

  perform tap.ok(not has_function_privilege('service_role', 'se_vezmou.admin_media_list()', 'execute')
                 and not has_function_privilege('service_role', 'se_vezmou.get_public_media(uuid, integer, text)', 'execute')
                 and not has_function_privilege('authenticated', 'se_vezmou.media_json(se_vezmou.media)', 'execute'),
    'service role nespouští funkce médií a interní media_json není pro nikoho');
  perform tap.ok(not has_table_privilege('authenticated', 'se_vezmou.media_variants', 'insert')
                 and not has_table_privilege('authenticated', 'se_vezmou.media_variants', 'update')
                 and not has_table_privilege('authenticated', 'se_vezmou.media_variants', 'delete')
                 and has_table_privilege('authenticated', 'se_vezmou.media_variants', 'select'),
    'varianty správce jen čte (zapisuje je funkce admin_media_complete)');
end
$$;

-- ---------------------------------------------------------------------------
-- Žádost o nahrání: pending, kvóta, velikost a typ
-- ---------------------------------------------------------------------------
do $$
declare
  j jsonb;
  v_pending uuid;
  v_row se_vezmou.media;
begin
  -- limit snížíme na 3 fotografie (fixtura má jednu hotovou)
  insert into se_vezmou.app_settings (key, value) values ('media_max_photos', '3')
  on conflict (key) do update set value = excluded.value;

  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  j := se_vezmou.admin_media_request('photo', 'image/jpeg', 5000000);
  v_pending := (j ->> 'id')::uuid;
  perform tap.ok(v_pending is not null and jsonb_array_length(j -> 'stale') = 0, 'žádost založí médium a nic zaseknutého');
  perform tap.reset();
  select * into v_row from se_vezmou.media where id = v_pending;
  perform tap.ok(v_row.wedding_id = tap.wa() and v_row.status = 'pending' and v_row.kind = 'photo'
                 and v_row.storage_path = 'incoming/' || tap.wa()::text || '/' || v_pending::text
                 and v_row.mime = 'image/jpeg' and v_row.bytes = 5000000 and not v_row.decorative,
    'čekající médium: vlastní svatba, karanténa incoming/{svatba}/{id}, deklarovaný typ a velikost');

  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform se_vezmou.admin_media_request('photo', 'image/png', 1000);
  perform tap.throws(format('select se_vezmou.admin_media_request(%L, %L, 1000)', 'photo', 'image/webp'), 'media_quota',
    'třetí fotografie nad limit (pending se počítá) se odmítne');
  -- karta externí galerie není fotografie: limit fotografií se jí netýká
  perform se_vezmou.admin_media_request('card', 'image/jpeg', 1000);
  perform tap.ok(true, 'obrázek karty se do limitu fotografií nepočítá');
  perform tap.throws(format('select se_vezmou.admin_media_request(%L, %L, 1000)', 'photo', 'image/svg+xml'), 'invalid_payload', 'SVG se odmítne');
  perform tap.throws(format('select se_vezmou.admin_media_request(%L, %L, 1000)', 'photo', 'image/heic'), 'invalid_payload', 'HEIC se odmítne');
  perform tap.throws(format('select se_vezmou.admin_media_request(%L, %L, 1000)', 'photo', 'image/gif'), 'invalid_payload', 'GIF se odmítne');
  perform tap.throws(format('select se_vezmou.admin_media_request(%L, %L, 1000)', 'video', 'image/png'), 'invalid_payload', 'neznámý druh se odmítne');
  perform tap.throws(format('select se_vezmou.admin_media_request(%L, %L, 41943041)', 'card', 'image/png'), 'media_too_large', 'více než 40 MB se odmítne');
  perform tap.throws(format('select se_vezmou.admin_media_request(%L, %L, 0)', 'card', 'image/png'), 'media_too_large', 'prázdný soubor se odmítne');
  perform tap.reset();

  -- B má vlastní kvótu (fotografie A ji neovlivní)
  perform tap.become('authenticated', tap.wb(), 'admin', tap.u('B:admin'));
  perform se_vezmou.admin_media_request('photo', 'image/jpeg', 1000);
  perform tap.ok(true, 'kvóta se počítá po svatbách');
  perform tap.reset();

  -- zablokovaná svatba nic nenahrává
  update se_vezmou.weddings set status = 'blocked' where id = tap.wa();
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.throws(format('select se_vezmou.admin_media_request(%L, %L, 1000)', 'card', 'image/png'), 'site_not_editable',
    'zablokovaná svatba nenahrává');
  perform tap.reset();
  update se_vezmou.weddings set status = 'published' where id = tap.wa();

  perform tap.ok((select count(*) from se_vezmou.audit_log where wedding_id = tap.wa() and action = 'media.requested') >= 3
                 and not exists (select 1 from se_vezmou.audit_log where action like 'media.%' and meta::text ~* '(jpeg|png|incoming)'),
    'audit žádostí nese jen druh a velikost');
end
$$;

-- ---------------------------------------------------------------------------
-- Zpracování: begin -> complete, zaseknuté zpracování, selhání
-- ---------------------------------------------------------------------------
do $$
declare
  v_a uuid;
  v_b uuid;
  j jsonb;
  m se_vezmou.media;
begin
  select id into v_a from se_vezmou.media where wedding_id = tap.wa() and status = 'pending' and kind = 'photo' and mime = 'image/jpeg';
  select id into v_b from se_vezmou.media where wedding_id = tap.wb() and status = 'pending';

  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  -- dokončit lze jen to, co se zpracovává
  perform tap.throws(format('select se_vezmou.admin_media_complete(%L, 1000, 667, %L::jsonb)', v_a,
                     tap.variants(tap.wa(), v_a, array[640])::text), 'media_not_processing', 'complete bez begin se odmítne');
  -- cizí médium: B ho nezpracuje, A také ne
  perform tap.throws(format('select se_vezmou.admin_media_begin(%L)', v_b), 'media_not_found', 'správce A nezačne zpracování cizího média');
  j := se_vezmou.admin_media_begin(v_a);
  perform tap.ok(j ->> 'mime' = 'image/jpeg' and j ->> 'kind' = 'photo' and (j ->> 'bytes')::bigint = 5000000, 'begin vrací deklarované údaje');
  perform tap.throws(format('select se_vezmou.admin_media_begin(%L)', v_a), 'media_busy', 'souběžné zpracování se odmítne');
  perform tap.reset();

  -- zaseknuté zpracování (starší než 2 minuty) lze převzít
  update se_vezmou.media set processing_started_at = clock_timestamp() - interval '5 minutes' where id = v_a;
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform se_vezmou.admin_media_begin(v_a);
  perform tap.ok(true, 'zaseknuté zpracování se převezme');

  -- špatné varianty
  perform tap.throws(format('select se_vezmou.admin_media_complete(%L, 1000, 667, %L::jsonb)', v_a, '[]'), 'invalid_payload', 'prázdný seznam variant se odmítne');
  perform tap.throws(format('select se_vezmou.admin_media_complete(%L, 1000, 667, %L::jsonb)', v_a,
      jsonb_build_array(jsonb_build_object('width', 640, 'height', 427, 'format', 'avif', 'bytes', 10,
        'key', tap.wa()::text || '/' || v_a::text || '/640.avif'))::text), 'invalid_payload', 'bez varianty WebP se odmítne');
  perform tap.throws(format('select se_vezmou.admin_media_complete(%L, 1000, 667, %L::jsonb)', v_a,
      jsonb_build_array(jsonb_build_object('width', 640, 'height', 427, 'format', 'webp', 'bytes', 10,
        'key', tap.wb()::text || '/' || v_a::text || '/640.webp'))::text), '23514', 'klíč v předponě cizí svatby se odmítne');
  perform tap.throws(format('select se_vezmou.admin_media_complete(%L, 1000, 667, %L::jsonb)', v_a,
      jsonb_build_array(jsonb_build_object('width', 640, 'height', 427, 'format', 'webp', 'bytes', 10,
        'key', tap.wa()::text || '/' || v_a::text || '/../x.webp'))::text), '23514', 'klíč s .. se odmítne');
  perform tap.throws(format('select se_vezmou.admin_media_complete(%L, 1000, 667, %L::jsonb)', v_a,
      jsonb_build_array(jsonb_build_object('width', 640, 'height', 427, 'format', 'gif', 'bytes', 10,
        'key', tap.wa()::text || '/' || v_a::text || '/640.gif'))::text), '23514', 'jiný formát než avif a webp se odmítne');

  j := se_vezmou.admin_media_complete(v_a, 1000, 667, tap.variants(tap.wa(), v_a, array[640, 1000]));
  perform tap.reset();
  select * into m from se_vezmou.media where id = v_a;
  perform tap.ok(m.status = 'ready' and m.width = 1000 and m.height = 667 and m.mime = 'image/webp'
                 and m.storage_path = tap.wa()::text || '/' || v_a::text || '/' and m.failure_code is null
                 and m.processing_started_at is null,
    'médium je hotové: rozměry, WebP, předpona souborů, bez chyby');
  perform tap.eq((select count(*) from se_vezmou.media_variants where media_id = v_a), 4, 'uloženy čtyři varianty (2 šířky x 2 formáty)');
  perform tap.eq((select bytes from se_vezmou.media where id = v_a),
                 (select sum(bytes)::bigint from se_vezmou.media_variants where media_id = v_a), 'velikost média je součet variant');
  perform tap.ok(jsonb_array_length(j -> 'variants') = 4 and j::text not like '%' || tap.wa()::text || '/%',
    'odpověď nese přehled variant, ne klíče úložiště');

  -- hotové médium už se znovu nezpracovává
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.throws(format('select se_vezmou.admin_media_begin(%L)', v_a), 'media_not_pending', 'hotové médium se nezpracovává znovu');

  -- selhání
  perform se_vezmou.admin_media_begin(
    (select id from se_vezmou.media where wedding_id = tap.wa() and status = 'pending' and mime = 'image/png'));
  perform se_vezmou.admin_media_fail(
    (select id from se_vezmou.media where wedding_id = tap.wa() and status = 'processing'), 'unsupported_type');
  perform tap.throws(format('select se_vezmou.admin_media_fail(%L, %L)', v_a, 'corrupt'), 'media_not_found', 'hotové médium nelze označit za chybné');
  perform tap.throws(format('select se_vezmou.admin_media_fail(%L, %L)', (select id from se_vezmou.media where wedding_id = tap.wa() and status = 'failed'), 'Zlý kód'),
    'invalid_payload', 'kód chyby je jen identifikátor');
  perform tap.reset();
  perform tap.eq((select count(*) from se_vezmou.media where wedding_id = tap.wa() and status = 'failed' and failure_code = 'unsupported_type'), 1,
    'selhání uloží kód chyby');
  perform tap.eq((select count(*) from se_vezmou.media_variants where wedding_id = tap.wa() and media_id in (select id from se_vezmou.media where status = 'failed')), 0,
    'chybné médium nemá varianty');
end
$$;

-- kvóta po selhání: chybné médium se do limitu nepočítá
do $$
begin
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform se_vezmou.admin_media_request('photo', 'image/webp', 1000);
  perform tap.ok(true, 'chybné médium se do kvóty nepočítá');
  perform tap.reset();
end
$$;

-- ---------------------------------------------------------------------------
-- Popisek a dekorativní příznak
-- ---------------------------------------------------------------------------
do $$
declare
  v_a uuid;
  j jsonb;
begin
  select id into v_a from se_vezmou.media where wedding_id = tap.wa() and status = 'ready' and width = 1000;
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  j := se_vezmou.admin_media_update(v_a, '{"cs": "  Na zámku  ", "en": ""}', false);
  perform tap.ok(j -> 'alt' = '{"cs": "Na zámku"}'::jsonb and not (j ->> 'decorative')::boolean, 'popisek se ořízne a prázdný jazyk zmizí');
  j := se_vezmou.admin_media_update(v_a, '{"cs": "  ", "en": ""}', false);
  perform tap.ok(j -> 'alt' = 'null'::jsonb, 'bez jediného popisku je alt null');
  j := se_vezmou.admin_media_update(v_a, null, true);
  perform tap.ok((j ->> 'decorative')::boolean, 'dekorativní příznak se uloží');
  perform tap.throws(format('select se_vezmou.admin_media_update(%L, %L, false)', v_a, '{"de": "Schloss"}'), 'invalid_payload', 'cizí jazyk se odmítne');
  perform tap.throws(format('select se_vezmou.admin_media_update(%L, %L, false)', v_a, '["cs"]'), 'invalid_payload', 'jiný tvar než objekt se odmítne');
  perform tap.throws(format('select se_vezmou.admin_media_update(%L, %L, false)', v_a, jsonb_build_object('cs', repeat('x', 301))::text), 'invalid_payload', 'příliš dlouhý popisek se odmítne');
  perform tap.throws(format('select se_vezmou.admin_media_update(%L, %L, false)', v_a, '{"cs": 5}'), 'invalid_payload', 'popisek jiného typu než text se odmítne');
  perform tap.throws(format('select se_vezmou.admin_media_update(%L, %L, false)', (select id from se_vezmou.media where wedding_id = tap.wa() and kind = 'card'), '{"cs": "x"}'),
    'media_not_editable', 'obrázek karty se nepopisuje (a čeká na nahrání)');
  perform tap.throws(format('select se_vezmou.admin_media_update(%L, %L, false)', tap.u('B:media'), '{"cs": "Cizí"}'), 'media_not_found', 'správce A nepopíše cizí fotografii');
  perform se_vezmou.admin_media_update(v_a, '{"cs": "Na zámku", "en": "At the chateau"}', false);
  perform tap.reset();
  perform tap.ok((select alt from se_vezmou.media where id = tap.u('B:media')) = '{"cs": "Pár"}'::jsonb, 'cizí popisek zůstal beze změny');
end
$$;

-- ---------------------------------------------------------------------------
-- Seznam, izolace, export
-- ---------------------------------------------------------------------------
do $$
declare
  j jsonb;
  v_a uuid;
begin
  select id into v_a from se_vezmou.media where wedding_id = tap.wa() and status = 'ready' and width = 1000;
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  j := se_vezmou.admin_media_list();
  perform tap.ok(j::text not like '%' || tap.u('B:media')::text || '%' and j::text not like '%' || tap.wb()::text || '%',
    'seznam nenese nic ze svatby B');
  perform tap.ok(j::text not like '%incoming/%', 'seznam nenese klíče úložiště');
  perform tap.ok(se_vezmou.admin_media_get(tap.u('B:media')) is null, 'cizí médium správce A nevidí (get)');
  perform tap.ok(se_vezmou.admin_media_variant(tap.u('B:media'), 640, 'webp') is null, 'klíč varianty cizí svatby správce A nedostane');
  perform tap.ok(se_vezmou.admin_media_variant(v_a, 640, 'webp') = tap.wa()::text || '/' || v_a::text || '/640.webp', 'klíč vlastní varianty ano');
  perform tap.ok(se_vezmou.admin_media_variant(v_a, 777, 'webp') is null and se_vezmou.admin_media_variant(v_a, 640, 'gif') is null, 'neexistující varianta nemá klíč');

  -- export: největší varianta každé hotové fotografie, WebP před AVIF
  j := se_vezmou.admin_media_export();
  perform tap.ok(jsonb_array_length(j) = 2, 'export: dvě hotové fotografie (fixtura a nová)');
  perform tap.ok((select count(*) from jsonb_array_elements(j) e where e ->> 'media_id' = v_a::text and (e ->> 'width')::int = 1000 and e ->> 'format' = 'webp') = 1,
    'export: největší šířka ve WebP');
  perform tap.ok(j::text not like '%' || tap.wb()::text || '%', 'export nenese nic ze svatby B');
  perform tap.reset();

  perform tap.become('authenticated', tap.wb(), 'admin', tap.u('B:admin'));
  perform tap.ok(jsonb_array_length(se_vezmou.admin_media_list()) = 2, 'B vidí vlastní dvě média (fixtura a čekající)');
  perform tap.ok(se_vezmou.admin_media_get(v_a) is null, 'správce B nevidí médium svatby A');
  perform tap.throws(format('select se_vezmou.admin_media_delete(%L)', v_a), 'media_not_found', 'správce B nesmaže médium svatby A');
  perform tap.throws(format('select se_vezmou.admin_media_complete(%L, 10, 10, %L::jsonb)', v_a, tap.variants(tap.wb(), v_a, array[640])::text), 'media_not_found',
    'správce B nedokončí cizí médium');
  perform tap.ok(se_vezmou.admin_media_variant(v_a, 640, 'webp') is null, 'správce B nedostane klíč varianty svatby A');
  perform tap.reset();
end
$$;

-- přímý přístup (RLS): správce A nevidí varianty svatby B a nic nevloží
do $$
begin
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.eq(tap.count('select count(*) from se_vezmou.media_variants where wedding_id <> ''' || tap.wa() || ''''), 0, 'správce A nečte varianty svatby B');
  perform tap.throws(format('insert into se_vezmou.media_variants (wedding_id, media_id, width, height, format, bytes, storage_key) values (%L, %L, 640, 480, ''webp'', 1, %L)',
      tap.wa(), tap.u('A:media'), tap.wa()::text || '/' || tap.u('A:media')::text || '/640.avif'), '42501', 'správce A varianty přímo nezapisuje');
  perform tap.reset();
  -- složený FK: varianta svatby A nemůže patřit médiu svatby B (jako vlastník, obchází RLS)
  perform tap.throws(format('insert into se_vezmou.media_variants (wedding_id, media_id, width, height, format, bytes, storage_key) values (%L, %L, 320, 240, ''webp'', 1, %L)',
      tap.wa(), tap.u('B:media'), tap.wa()::text || '/' || tap.u('B:media')::text || '/320.webp'), '23503', 'varianta nemůže patřit médiu jiné svatby (složený FK)');
  perform tap.throws(format('insert into se_vezmou.media_variants (wedding_id, media_id, width, height, format, bytes, storage_key) values (%L, %L, 320, 240, ''webp'', 1, %L)',
      tap.wa(), tap.u('A:media'), tap.wb()::text || '/' || tap.u('A:media')::text || '/320.webp'), '23514', 'klíč musí odpovídat svatbě a médiu (kontrola tvaru)');
end
$$;

-- ---------------------------------------------------------------------------
-- Doručení: get_public_media a public_media_ids
-- ---------------------------------------------------------------------------
do $$
declare
  v_a uuid;
  v_key text;
  n integer;
begin
  select id into v_a from se_vezmou.media where wedding_id = tap.wa() and status = 'ready' and width = 1000;

  -- zveřejněný snímek A zatím médium nenese: nic se nedoručí
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.eq((select count(*) from se_vezmou.get_public_media(tap.u('A:media'), 640, 'webp')), 0, 'médium mimo zveřejněný snímek se nedoručí');
  perform tap.reset();

  -- snímek A nese média (veřejná fotografie a chráněná PINem)
  -- (verze jsou neměnné: zveřejníme novou)
  insert into se_vezmou.site_versions (id, wedding_id, version_no, kind, public_content, created_by)
  values (tap.u('A:version2'), tap.wa(), 2, 'publish',
          jsonb_build_object('version', 1, 'media', jsonb_build_array(jsonb_build_object('id', tap.u('A:media')::text))),
          tap.u('A:admin'));
  insert into se_vezmou.site_version_sensitive (version_id, wedding_id, sensitive_content)
  values (tap.u('A:version2'), tap.wa(),
          jsonb_build_object('photos', jsonb_build_array(jsonb_build_object('id', v_a::text))));
  update se_vezmou.weddings set published_version_id = tap.u('A:version2') where id = tap.wa();

  perform tap.become('authenticated', tap.wa(), 'visitor');
  select storage_key into v_key from se_vezmou.get_public_media(tap.u('A:media'), 640, 'webp');
  perform tap.ok(v_key = tap.wa()::text || '/' || tap.u('A:media')::text || '/640.webp', 'návštěvník dostane klíč veřejné fotografie');
  select count(*) into n from se_vezmou.get_public_media(tap.u('A:media'), 640, 'avif');
  perform tap.eq(n, 0, 'varianta, která neexistuje (AVIF), se nedoručí');
  select count(*) into n from se_vezmou.get_public_media(tap.u('A:media'), 1280, 'webp');
  perform tap.eq(n, 0, 'šířka, která neexistuje, se nedoručí');
  select count(*) into n from se_vezmou.get_public_media(tap.u('A:media'), 640, 'jpeg');
  perform tap.eq(n, 0, 'neznámý formát se nedoručí');
  select count(*) into n from se_vezmou.get_public_media(v_a, 640, 'webp');
  perform tap.eq(n, 0, 'fotografii chráněnou PINem návštěvník nedostane');
  select count(*) into n from se_vezmou.get_public_media(tap.u('B:media'), 640, 'webp');
  perform tap.eq(n, 0, 'médium jiné svatby návštěvník nedostane (ani když zná jeho identifikátor)');
  select count(*) into n from se_vezmou.get_public_media(null, 640, 'webp');
  perform tap.eq(n, 0, 'null identifikátor nic nevrací');
  perform tap.ok(se_vezmou.public_media_ids() @> array[tap.u('A:media'), v_a] and not se_vezmou.public_media_ids() @> array[tap.u('B:media')],
    'public_media_ids: hotová média vlastní svatby');
  perform tap.reset();

  perform tap.become('authenticated', tap.wa(), 'guest_pin', tap.u('guest-session'));
  select count(*) into n from se_vezmou.get_public_media(v_a, 640, 'webp');
  perform tap.eq(n, 1, 'host po PINu dostane fotografii chráněnou PINem');
  select count(*) into n from se_vezmou.get_public_media(tap.u('A:media'), 640, 'webp');
  perform tap.eq(n, 1, 'host po PINu dostane i veřejnou fotografii');
  perform tap.reset();

  -- náhled, správce a role mimo web nedostanou nic přes doručení
  perform tap.become('authenticated', tap.wa(), 'preview');
  perform tap.eq((select count(*) from se_vezmou.get_public_media(tap.u('A:media'), 640, 'webp')), 0, 'role náhledu nic nedostane');
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform tap.eq((select count(*) from se_vezmou.get_public_media(tap.u('A:media'), 640, 'webp')), 0, 'správce používá svou cestu (admin_media_variant), ne doručení');
  perform tap.reset();

  -- po smazání fotografie páru zmizí z doručení hned, i když snímek na ni ještě odkazuje
  delete from se_vezmou.media where id = tap.u('A:media');
  perform tap.become('authenticated', tap.wa(), 'visitor');
  perform tap.eq((select count(*) from se_vezmou.get_public_media(tap.u('A:media'), 640, 'webp')), 0, 'smazané médium se nedoručí');
  perform tap.ok(not se_vezmou.public_media_ids() @> array[tap.u('A:media')], 'smazané médium není v public_media_ids');
  perform tap.reset();
  perform tap.eq((select count(*) from se_vezmou.media_variants where media_id = tap.u('A:media')), 0, 'smazání média smaže varianty kaskádou');

  -- web, který už není zveřejněný (po retenci archived, nezveřejněný, zablokovaný), nic nedoručuje
  foreach v_key in array array['archived', 'blocked', 'draft'] loop
    update se_vezmou.weddings set status = v_key where id = tap.wa();
    perform tap.become('authenticated', tap.wa(), 'guest_pin', tap.u('guest-session'));
    perform tap.eq((select count(*) from se_vezmou.get_public_media(v_a, 640, 'webp')), 0, 'stav ' || v_key || ': nic se nedoručí (404)');
    perform tap.eq(coalesce(array_length(se_vezmou.public_media_ids(), 1), 0), coalesce(array_length(se_vezmou.public_media_ids(), 1), 0), 'stav ' || v_key || ': bez chyby');
    perform tap.reset();
  end loop;
  update se_vezmou.weddings set status = 'published' where id = tap.wa();
  perform tap.become('authenticated', tap.wa(), 'guest_pin', tap.u('guest-session'));
  perform tap.eq((select count(*) from se_vezmou.get_public_media(v_a, 640, 'webp')), 1, 'po opětovném zveřejnění se doručuje');
  perform tap.reset();

  -- smazaná svatba (deleted_at) nic nedoručuje
  update se_vezmou.weddings set deleted_at = now() where id = tap.wa();
  perform tap.become('authenticated', tap.wa(), 'guest_pin', tap.u('guest-session'));
  perform tap.eq((select count(*) from se_vezmou.get_public_media(v_a, 640, 'webp')), 0, 'smazaná svatba nic nedoručuje');
  perform tap.ok(coalesce(array_length(se_vezmou.public_media_ids(), 1), 0) = 0, 'smazaná svatba nemá žádná média');
  perform tap.reset();
  update se_vezmou.weddings set deleted_at = null where id = tap.wa();
end
$$;

-- ---------------------------------------------------------------------------
-- Smazání a zapomenutá nahrávání
-- ---------------------------------------------------------------------------
do $$
declare
  v_stale uuid;
  j jsonb;
begin
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  perform se_vezmou.admin_media_delete((select id from se_vezmou.media where wedding_id = tap.wa() and status = 'failed' limit 1));
  perform tap.throws(format('select se_vezmou.admin_media_delete(%L)', tap.u('A:media')), 'media_not_found', 'smazat lze jen existující médium');
  perform tap.reset();
  perform tap.ok(exists (select 1 from se_vezmou.audit_log where wedding_id = tap.wa() and action = 'media.deleted'), 'smazání se zapíše do auditu');

  -- zapomenuté nahrávání starší než den: označí se jako failed (expired) a vrátí se jeho identifikátor
  select id into v_stale from se_vezmou.media where wedding_id = tap.wa() and status = 'pending' limit 1;
  update se_vezmou.media set created_at = now() - interval '2 days' where id = v_stale;
  perform tap.become('authenticated', tap.wa(), 'admin', tap.u('A:admin'));
  j := se_vezmou.admin_media_request('card', 'image/png', 1000);
  perform tap.ok(j -> 'stale' @> to_jsonb(array[v_stale]), 'zapomenuté nahrávání se vrátí k úklidu souborů');
  perform tap.reset();
  perform tap.ok((select status = 'failed' and failure_code = 'expired' from se_vezmou.media where id = v_stale), 'zapomenuté nahrávání je failed (expired)');
end
$$;

-- ---------------------------------------------------------------------------
-- Svatba a její média: tvrdé smazání svatby odstraní média i varianty, cizí zůstanou (kaskáda)
-- ---------------------------------------------------------------------------
do $$
declare
  v_purge_at timestamptz;
begin
  perform tap.ok((select count(*) from se_vezmou.media_variants where wedding_id = tap.wb()) = 1, 'varianty svatby B existují před mazáním');
  update se_vezmou.weddings set status = 'deleted' where id = tap.wb();
  select purge_at into v_purge_at from se_vezmou.weddings where id = tap.wb();
  set local role service_role;
  perform se_vezmou.purge_wedding(tap.wb(), v_purge_at);
  perform tap.reset();
  perform tap.eq((select count(*) from se_vezmou.media where wedding_id = tap.wb()), 0, 'trvalé smazání svatby smaže její média');
  perform tap.eq((select count(*) from se_vezmou.media_variants where wedding_id = tap.wb()), 0, 'trvalé smazání svatby smaže její varianty');
end
$$;

rollback;
