-- Oprava po revizi kódu: ověření kódem z aplikace mimo přihlášení (nová sada záložních kódů) se nesmí v auditu
-- tvářit jako přihlášení. `auth_operator_totp_step` jen posune poslední použitý časový krok (kód TOTP jde
-- použít jednou) se stejnými kontrolami jako `auth_operator_mfa_accept`, ale bez `last_login_at`, bez změny
-- úrovně relace a bez záznamu `operator.login`. Akce, která ověření potřebovala, si audit zapíše sama.

create function se_vezmou.auth_operator_totp_step(p_operator_id uuid, p_session_id uuid, p_step bigint)
  returns boolean
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_rows integer;
begin
  if not exists (select 1 from se_vezmou.operator_sessions s
                  where s.id = p_session_id and s.operator_id = p_operator_id and s.revoked_at is null
                    and s.aal2_verified_at is not null
                    and s.idle_expires_at > pg_catalog.now() and s.absolute_expires_at > pg_catalog.now()) then
    return false;
  end if;
  update se_vezmou.operators o
     set totp_last_step = p_step
   where o.id = p_operator_id and o.disabled_at is null and o.totp_confirmed_at is not null
     and (o.totp_last_step is null or o.totp_last_step < p_step);
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end
$$;

revoke all on function se_vezmou.auth_operator_totp_step(uuid, uuid, bigint) from public, anon;
grant execute on function se_vezmou.auth_operator_totp_step(uuid, uuid, bigint) to service_role;
