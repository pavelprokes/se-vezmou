-- Oprava po revizi kódu: omezení počtu požadavků s pevným oknem dovolilo na hranici oken dvojnásobek (celý limit
-- v 59:59 a znovu v 00:00). `rate_limit_hit` teď počítá posuvné okno: povolené požadavky aktuálního okna plus
-- poměrná část povolených z předchozího podle toho, kolik z něj ještě zasahuje do posledních p_window.
-- Do okna se počítají jen POVOLENÉ požadavky (nový sloupec `allowed`); `hits` dál počítá všechny (dohled).
-- Kdyby se počítaly i zamítnuté, trvalé přetížení by se přeneslo do dalšího okna a klíč by se zablokoval úplně.
-- Rozhodnutí probíhá pod zámkem řádku okna, takže souběžné požadavky dostanou nejvýš p_limit povolení.
-- Podpis i oprávnění se nemění.

alter table se_vezmou.rate_limits add column allowed integer not null default 0 check (allowed >= 0);



create or replace function se_vezmou.rate_limit_hit(p_bucket_key text, p_limit integer, p_window interval)
  returns table (allowed boolean, retry_after integer)
  language plpgsql volatile security definer set search_path = ''
  as $$
#variable_conflict use_column
declare
  v_secs numeric := extract(epoch from p_window);
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_start timestamptz;
  v_elapsed numeric;
  v_cur integer;
  v_prev integer;
  v_ok boolean;
  v_room integer;
begin
  if p_bucket_key is null or p_bucket_key = '' or p_limit is null or p_limit < 1 or v_secs < 1 then
    raise exception 'invalid_rate_limit_arguments' using errcode = '22023';
  end if;

  v_start := to_timestamp(floor(extract(epoch from v_now) / v_secs) * v_secs);
  v_elapsed := extract(epoch from (v_now - v_start));

  -- řádek aktuálního okna a jeho zámek: souběžné požadavky téhož klíče se rozhodují postupně
  insert into se_vezmou.rate_limits (bucket_key, window_start, hits, allowed)
  values (p_bucket_key, v_start, 0, 0)
  on conflict (bucket_key, window_start) do nothing;
  select r.allowed into v_cur from se_vezmou.rate_limits r
   where r.bucket_key = p_bucket_key and r.window_start = v_start for update;

  select coalesce(max(r.allowed), 0) into v_prev
    from se_vezmou.rate_limits r
   where r.bucket_key = p_bucket_key
     and r.window_start = v_start - pg_catalog.make_interval(secs => v_secs);

  -- posuvné okno: z předchozího okna se počítá jen část, která ještě spadá do posledních p_window
  v_ok := v_cur + floor(v_prev * (1 - v_elapsed / v_secs)) < p_limit;
  update se_vezmou.rate_limits r
     set hits = r.hits + 1, allowed = r.allowed + case when v_ok then 1 else 0 end
   where r.bucket_key = p_bucket_key and r.window_start = v_start;

  -- oportunistický úklid starých oken (denní cron housekeeping dělá zbytek); předchozí okno se nemaže
  if random() < 0.01 then
    delete from se_vezmou.rate_limits d
     where d.ctid in (
       select x.ctid from se_vezmou.rate_limits x
        where x.window_start < v_now - interval '2 days' limit 200);
  end if;

  allowed := v_ok;
  if v_ok then
    retry_after := 0;
  elsif v_cur >= p_limit or v_prev = 0 then
    -- aktuální okno je samo plné: hned po jeho konci klesne podíl tohoto okna pod limit
    retry_after := greatest(1, ceil(v_secs - v_elapsed)::integer + 1);
  else
    -- plné jen s podílem předchozího okna: čeká se, až jeho podíl klesne pod zbývající místo
    v_room := p_limit - v_cur;
    retry_after := greatest(1, ceil(v_secs * (1 - v_room::numeric / v_prev) - v_elapsed)::integer + 1);
  end if;
  return next;
end
$$;
