-- Oprava po revizi kódu: omezení počtu požadavků s pevným oknem dovolilo na hranici oken dvojnásobek (celý limit
-- v 59:59 a znovu v 00:00). `rate_limit_hit` teď počítá posuvné okno: zásahy aktuálního okna plus poměrná část
-- předchozího podle toho, kolik z něj ještě zasahuje do posledních p_window. Zvýšení čítače zůstává jediným
-- atomickým příkazem; souběžné požadavky v prázdném předchozím okně dál dostanou přesně p_limit povolení.
-- Podpis i oprávnění se nemění.

create or replace function se_vezmou.rate_limit_hit(p_bucket_key text, p_limit integer, p_window interval)
  returns table (allowed boolean, retry_after integer)
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_secs numeric := extract(epoch from p_window);
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_start timestamptz;
  v_hits integer;
  v_prev integer;
  v_elapsed numeric;
  v_effective numeric;
  v_room integer;
  v_wait numeric;
begin
  if p_bucket_key is null or p_bucket_key = '' or p_limit is null or p_limit < 1 or v_secs < 1 then
    raise exception 'invalid_rate_limit_arguments' using errcode = '22023';
  end if;

  v_start := to_timestamp(floor(extract(epoch from v_now) / v_secs) * v_secs);
  v_elapsed := extract(epoch from (v_now - v_start));

  -- jediný příkaz = atomické zvýšení i při souběžných požadavcích (řádek zamyká unikátní klíč)
  insert into se_vezmou.rate_limits as r (bucket_key, window_start, hits)
  values (p_bucket_key, v_start, 1)
  on conflict (bucket_key, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;

  select coalesce(max(r.hits), 0) into v_prev
    from se_vezmou.rate_limits r
   where r.bucket_key = p_bucket_key
     and r.window_start = v_start - pg_catalog.make_interval(secs => v_secs);

  -- oportunistický úklid starých oken (denní cron housekeeping dělá zbytek); předchozí okno se nemaže
  if random() < 0.01 then
    delete from se_vezmou.rate_limits d
     where d.ctid in (
       select x.ctid from se_vezmou.rate_limits x
        where x.window_start < v_now - interval '2 days' limit 200);
  end if;

  -- posuvné okno: z předchozího okna se počítá jen část, která ještě spadá do posledních p_window
  v_effective := v_hits + floor(v_prev * (1 - v_elapsed / v_secs));
  allowed := v_effective <= p_limit;
  if allowed then
    retry_after := 0;
  elsif v_hits > p_limit or v_prev = 0 then
    -- aktuální okno je samo plné: čeká se do jeho konce
    retry_after := greatest(1, ceil(v_secs - v_elapsed)::integer);
  else
    -- plné jen s podílem předchozího okna: čeká se, až jeho podíl klesne pod zbývající místo
    v_room := p_limit - v_hits;
    v_wait := v_secs * (1 - v_room::numeric / v_prev) - v_elapsed;
    retry_after := greatest(1, least(ceil(v_wait), ceil(v_secs - v_elapsed))::integer);
  end if;
  return next;
end
$$;
