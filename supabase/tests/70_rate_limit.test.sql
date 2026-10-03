-- rate_limit_hit (ADR 0010, kap. 3.8): čítač s posuvným oknem, nezávislé klíče, nové okno, neplatné vstupy.
-- Souběžnou atomicitu ověřuje scripts/db-test.sh (skutečná paralelní spojení).
begin;

do $$
declare
  r record;
  v_allowed boolean[] := '{}';
begin
  set local role service_role;

  -- limit 3 za dlouhé okno: tři povolené, další zamítnuté
  for i in 1..5 loop
    select * into r from se_vezmou.rate_limit_hit('test:login:ip', 3, interval '1 day');
    v_allowed := array_append(v_allowed, r.allowed);
    if i = 4 then
      perform tap.ok(r.retry_after between 1 and 86400, 'zamítnutý pokus vrací retry_after v rozsahu okna');
    end if;
    if i <= 3 then
      perform tap.ok(r.retry_after = 0, 'povolený pokus ' || i || ' má retry_after 0');
    end if;
  end loop;
  perform tap.ok(v_allowed = array[true, true, true, false, false], 'povoleny právě tři pokusy, další zamítnuty');

  perform tap.throws('select hits from se_vezmou.rate_limits', '42501', 'service_role nečte rate_limits přímo (čítače jsou jen přes funkci)');
  perform tap.reset();
end
$$;

do $$
declare
  v_hits integer;
  r record;
begin
  -- klíče jsou nezávislé
  set local role service_role;
  perform tap.ok((select allowed from se_vezmou.rate_limit_hit('test:email:a', 1, interval '1 day')), 'klíč A: první pokus projde');
  perform tap.ok(not (select allowed from se_vezmou.rate_limit_hit('test:email:a', 1, interval '1 day')), 'klíč A: druhý pokus je zamítnut');
  perform tap.ok((select allowed from se_vezmou.rate_limit_hit('test:email:b', 1, interval '1 day')), 'klíč B není dotčen klíčem A');
  perform tap.reset();

  -- čítač se zvyšuje i po překročení limitu
  set local role service_role;
  perform se_vezmou.rate_limit_hit('test:count', 1, interval '1 day');
  perform se_vezmou.rate_limit_hit('test:count', 1, interval '1 day');
  perform se_vezmou.rate_limit_hit('test:count', 1, interval '1 day');
  perform tap.reset();
  select hits into v_hits from se_vezmou.rate_limits where bucket_key = 'test:count';
  perform tap.eq(v_hits, 3, 'čítač roste i po překročení limitu');

  -- hodnota limitu se bere z volání (jiný limit nad stejným klíčem a oknem)
  set local role service_role;
  perform tap.ok((select allowed from se_vezmou.rate_limit_hit('test:count', 10, interval '1 day')), 'vyšší limit nad stejným čítačem povolí');
  perform tap.reset();

  -- v databázi je jen předaný (HMAC) klíč; surový identifikátor se neukládá (kontrola struktury)
  perform tap.ok(not exists (select 1 from information_schema.columns where table_name = 'rate_limits' and column_name in ('ip', 'email')),
    'rate_limits nemá sloupce pro IP ani e-mail');
end
$$;

-- Neplatné vstupy
do $$
begin
  set local role service_role;
  perform tap.throws('select * from se_vezmou.rate_limit_hit('''', 3, interval ''1 minute'')', '22023', 'prázdný klíč se odmítne');
  perform tap.throws('select * from se_vezmou.rate_limit_hit(null, 3, interval ''1 minute'')', '22023', 'chybějící klíč se odmítne');
  perform tap.throws('select * from se_vezmou.rate_limit_hit(''x'', 0, interval ''1 minute'')', '22023', 'nulový limit se odmítne');
  perform tap.throws('select * from se_vezmou.rate_limit_hit(''x'', 3, interval ''0 seconds'')', '22023', 'nulové okno se odmítne');
  perform tap.reset();
end
$$;

-- Posuvné okno (okno 2 s, mezi voláními pg_sleep): hned za hranicí oken se předchozí okno ještě počítá,
-- takže limit nejde vyčerpat dvakrát za sebou; po uplynutí celého posuvného okna je čítač nový.
do $$
declare
  v_first boolean;
  v_second boolean;
  v_boundary boolean;
  v_third boolean;
  v_deadline timestamptz;
begin
  set local role service_role;
  -- zarovnání na začátek okna, aby se dvě volání nedostala do různých oken náhodou
  v_deadline := clock_timestamp() + interval '3 seconds';
  while extract(epoch from clock_timestamp())::numeric % 2 > 1.0 and clock_timestamp() < v_deadline loop
    perform pg_sleep(0.05);
  end loop;
  select allowed into v_first from se_vezmou.rate_limit_hit('test:window', 1, interval '2 seconds');
  select allowed into v_second from se_vezmou.rate_limit_hit('test:window', 1, interval '2 seconds');
  -- těsně za hranicí oken (do 0,4 s nového okna): z předchozího okna se počítá většina
  while extract(epoch from clock_timestamp())::numeric % 2 > 0.4 loop
    perform pg_sleep(0.02);
  end loop;
  select allowed into v_boundary from se_vezmou.rate_limit_hit('test:window', 1, interval '2 seconds');
  perform pg_sleep(4.2);
  select allowed into v_third from se_vezmou.rate_limit_hit('test:window', 1, interval '2 seconds');
  perform tap.reset();
  perform tap.ok(v_first, 'okno: první pokus projde');
  perform tap.ok(not v_second, 'okno: druhý pokus ve stejném okně je zamítnut');
  perform tap.ok(not v_boundary, 'posuvné okno: hned za hranicí oken se předchozí okno počítá (žádný dvojnásobek)');
  perform tap.ok(v_third, 'okno: po uplynutí celého posuvného okna je čítač nový');
end
$$;

-- Úklid: housekeeping smaže stará okna
do $$
declare
  v_result jsonb;
begin
  insert into se_vezmou.rate_limits (bucket_key, window_start, hits) values ('test:stare', now() - interval '3 days', 5);
  set local role service_role;
  v_result := se_vezmou.housekeeping();
  perform tap.reset();
  perform tap.ok((v_result ->> 'rate_limits')::int >= 1, 'housekeeping smazal stará okna');
  perform tap.ok(not exists (select 1 from se_vezmou.rate_limits where bucket_key = 'test:stare'), 'staré okno je pryč');
end
$$;

rollback;
