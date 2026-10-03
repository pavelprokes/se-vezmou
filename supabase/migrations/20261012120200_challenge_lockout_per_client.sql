-- Oprava po revizi kódu: pauzu ověřování kódů z e-mailu nejde použít k zablokování cizího účtu.
--
-- Dřív se chybné kódy počítaly jen na e-mail a účel: kdokoli si vyžádal kód pro cizí e-mail, zadal 5 chybných
-- kódů a majitel adresy se pak nemohl přihlásit (pauza až 24 hodin, operátor nemá jinou cestu). Teď volající
-- předá klíč klienta (HMAC IP adresy, `p_client_key`): chyby se počítají zvlášť klientovi (pauza po
-- p_max_attempts chybách, jako dřív) a celému e-mailu s desetinásobným prahem (ochrana proti hádání z mnoha
-- adres). Útočník z jedné adresy tak zablokuje jen sebe. Hádání omezuje i počet pokusů na jeden kód
-- (`login_challenges.attempts`) a limit vyžádání kódů. Bez klíče klienta platí dosavadní chování.
--
-- Podpis se rozšiřuje o volitelný parametr, proto se původní funkce nahrazuje (drop + create) i s oprávněními.

drop function se_vezmou.auth_verify_challenge(bytea, text, bytea, smallint);

create function se_vezmou.auth_verify_challenge(
  p_email_hash bytea,
  p_purpose text,
  p_code_hash bytea,
  p_max_attempts smallint default 5,
  p_client_key text default null
) returns boolean
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  c se_vezmou.login_challenges;
  v_bucket text := 'challenge:' || p_purpose || ':' || pg_catalog.encode(p_email_hash, 'hex');
  v_client_bucket text := case when nullif(p_client_key, '') is not null
                               then v_bucket || ':' || p_client_key end;
  v_max smallint := greatest(p_max_attempts, 1)::smallint;
  v_email_threshold smallint := case when v_client_bucket is null then v_max
                                     else least(v_max * 10, 1000)::smallint end;
begin
  -- pauza klienta nebo celého e-mailu: v ní se neověřuje nic (ani správný kód)
  if exists (select 1 from se_vezmou.lockouts l
              where l.bucket_key in (v_bucket, v_client_bucket) and l.locked_until > pg_catalog.now()) then
    return false;
  end if;

  select * into c from se_vezmou.login_challenges x
   where x.email_hash = p_email_hash and x.purpose = p_purpose
     and x.consumed_at is null and x.expires_at > pg_catalog.now()
   order by x.created_at desc limit 1 for update;
  if not found then
    return false;
  end if;

  if c.attempts >= p_max_attempts then
    update se_vezmou.login_challenges x set consumed_at = pg_catalog.now() where x.id = c.id;
    return false;
  end if;

  if c.code_hash = p_code_hash then
    update se_vezmou.login_challenges x set consumed_at = pg_catalog.now() where x.id = c.id;
    perform se_vezmou.auth_lockout_reset(v_bucket);
    if v_client_bucket is not null then
      perform se_vezmou.auth_lockout_reset(v_client_bucket);
    end if;
    return true;
  end if;

  update se_vezmou.login_challenges x
     set attempts = x.attempts + 1,
         consumed_at = case when x.attempts + 1 >= p_max_attempts then pg_catalog.now() end
   where x.id = c.id;
  perform se_vezmou.auth_lockout_failure(v_bucket, v_email_threshold);
  if v_client_bucket is not null then
    perform se_vezmou.auth_lockout_failure(v_client_bucket, v_max);
  end if;
  return false;
end
$$;

revoke all on function se_vezmou.auth_verify_challenge(bytea, text, bytea, smallint, text) from public, anon;
grant execute on function se_vezmou.auth_verify_challenge(bytea, text, bytea, smallint, text) to service_role;
