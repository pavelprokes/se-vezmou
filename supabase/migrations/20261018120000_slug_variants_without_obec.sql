-- Varianty adresy při kolizi bez doslovné koncovky „-obec“ (pro páry nesrozumitelná). Místo svatby
-- nebo celé datum si pár doplní sám v průvodci (pole „Doplnit k adrese“); databáze dál nabízí rok,
-- rok a měsíc a neuhádnutelnou variantu. Stejná signatura, oprávnění zůstávají.
create or replace function se_vezmou.slug_variants(p_slug text, p_starts_on date) returns text[]
  language plpgsql volatile set search_path = ''
  as $$
declare
  c_alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  v_result text[] := '{}';
  v_candidates text[] := '{}';
  v_candidate text;
  v_suffix text;
  v_try integer := 0;
begin
  if p_starts_on is not null then
    v_candidates := array_append(v_candidates, extract(year from p_starts_on)::integer::text);
    v_candidates := array_append(v_candidates,
      extract(year from p_starts_on)::integer::text || '-' || lpad(extract(month from p_starts_on)::integer::text, 2, '0'));
  end if;

  foreach v_suffix in array v_candidates loop
    v_candidate := regexp_replace(left(p_slug, 63 - length(v_suffix) - 1), '-+$', '') || '-' || v_suffix;
    if se_vezmou.slug_available(v_candidate) then
      v_result := array_append(v_result, v_candidate);
    end if;
  end loop;

  -- neuhádnutelná varianta se čtyřmi náhodnými znaky
  while v_try < 10 loop
    v_try := v_try + 1;
    v_suffix := '';
    for i in 1..4 loop
      v_suffix := v_suffix || substr(c_alphabet, 1 + floor(random() * length(c_alphabet))::integer, 1);
    end loop;
    v_candidate := regexp_replace(left(p_slug, 63 - 5), '-+$', '') || '-' || v_suffix;
    if se_vezmou.slug_available(v_candidate) then
      v_result := array_append(v_result, v_candidate);
      exit;
    end if;
  end loop;

  return v_result;
end
$$;
