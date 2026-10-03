-- Bezpečnost: chybné kódy z e-mailu se počítají na e-mail a účel, ne na výzvu.
--
-- Dřív měl každý nový kód vlastních 5 pokusů (`login_challenges.attempts`) a nová výzva (vyžádání kódu)
-- čítač vynulovala: útočník proti cizímu e-mailu dostal 25 pokusů za hodinu na šestimístný kód. Chybné
-- ověření se teď zapisuje do tabulky `lockouts` (klíč z účelu a HMAC e-mailu, který aplikace už zná) a po
-- p_max_attempts chybách v sérii nastane pauza se zdvojnásobováním (15 min, 30 min, ... nejvýš 24 hodin,
-- stejná pravidla jako u PINu: `auth_lockout_failure`). Čítač přežije vyžádání nového kódu. V době pauzy se
-- kód vůbec neporovnává (správný kód také selže), takže pauzu nejde obejít hádáním. Úspěšné ověření čítač
-- vynuluje. Úroveň se sama vrací po 24 hodinách bez chyby.
--
-- Podpis ani oprávnění funkce se nemění (`create or replace`), aplikace se nemění.

create or replace function se_vezmou.auth_verify_challenge(
  p_email_hash bytea,
  p_purpose text,
  p_code_hash bytea,
  p_max_attempts smallint default 5
) returns boolean
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  c se_vezmou.login_challenges;
  v_bucket text := 'challenge:' || p_purpose || ':' || pg_catalog.encode(p_email_hash, 'hex');
  v_locked boolean;
begin
  -- série chyb nad e-mailem a účelem: v pauze se neověřuje nic
  select coalesce(l.locked_until > pg_catalog.now(), false) into v_locked
    from (select 1) d left join se_vezmou.lockouts l on l.bucket_key = v_bucket;
  if v_locked then
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
    return true;
  end if;

  update se_vezmou.login_challenges x
     set attempts = x.attempts + 1,
         consumed_at = case when x.attempts + 1 >= p_max_attempts then pg_catalog.now() end
   where x.id = c.id;
  perform se_vezmou.auth_lockout_failure(v_bucket, greatest(p_max_attempts, 1)::smallint);
  return false;
end
$$;
