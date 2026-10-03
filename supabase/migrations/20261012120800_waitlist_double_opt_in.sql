-- Oprava po revizi kódu: čekací listina s potvrzením e-mailem (double opt-in). Dřív šlo zapsat cizí adresu
-- s „souhlasem“, který nikdo neověřil; oznámení o spuštění by pak šlo na neověřené adresy (stížnosti, souhlas
-- nejde doložit). Zápis teď nese otisk jednorázového tokenu (SHA-256, 7 dní) a adresa platí až po potvrzení
-- odkazem z e-mailu (`waitlist_confirm`). Oznámení o spuštění smí jít jen na řádky s `confirmed_at`.
-- Řádky z doby před touto migrací token nemají a zůstávají nepotvrzené (rozhodne provozovatel, OQ-68).

alter table se_vezmou.waitlist
  add column confirmed_at timestamptz,
  add column confirm_token_hash bytea unique check (confirm_token_hash is null or octet_length(confirm_token_hash) = 32),
  add column confirm_expires_at timestamptz;

alter table se_vezmou.email_log drop constraint email_log_type_check;
alter table se_vezmou.email_log add constraint email_log_type_check
  check (type in ('login_code', 'rsvp_confirmation', 'admin_changed', 'backup_login_notice', 'expiry_notice',
                  'deletion_notice', 'operator_notice', 'waitlist_confirm'));

-- ---------------------------------------------------------------------------
-- waitlist_add: zápis s tokenem potvrzení. Vrací true, když se má poslat e-mail s odkazem: nový zápis, nebo
-- nepotvrzený zápis s tokenem starším než 15 minut (nový odkaz; dřívější souhlas, jazyk ani čas se nepřepisují).
-- Bez tokenu (p_token_hash null) se chová jako dřív: true jen u nového řádku.
-- ---------------------------------------------------------------------------
drop function se_vezmou.waitlist_add(text, text, text);

create function se_vezmou.waitlist_add(
  p_email text,
  p_locale text,
  p_consent_text_version text,
  p_token_hash bytea default null
) returns boolean
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_rows integer;
  v_expires timestamptz := pg_catalog.now() + interval '7 days';
begin
  if char_length(v_email) not between 3 and 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if p_locale is not null and p_locale not in ('cs', 'en') then
    raise exception 'invalid_locale' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_consent_text_version, ''))) = 0 then
    raise exception 'consent_version_required' using errcode = '22023';
  end if;
  if p_token_hash is not null and octet_length(p_token_hash) <> 32 then
    raise exception 'invalid_token' using errcode = '22023';
  end if;

  insert into se_vezmou.waitlist (email, locale, consent_at, consent_text_version, confirm_token_hash, confirm_expires_at)
  values (v_email::extensions.citext, p_locale, pg_catalog.now(), btrim(p_consent_text_version),
          p_token_hash, case when p_token_hash is not null then v_expires end)
  on conflict (email) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    return true;
  end if;
  if p_token_hash is null then
    return false;
  end if;

  -- nepotvrzený zápis: nový odkaz nejvýš jednou za 15 minut (cizí člověk nezaplaví schránku)
  update se_vezmou.waitlist w
     set confirm_token_hash = p_token_hash, confirm_expires_at = v_expires
   where w.email = v_email::extensions.citext and w.confirmed_at is null
     and (w.confirm_expires_at is null or w.confirm_expires_at < v_expires - interval '15 minutes');
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end
$$;

revoke all on function se_vezmou.waitlist_add(text, text, text, bytea) from public, anon;
grant execute on function se_vezmou.waitlist_add(text, text, text, bytea) to service_role;

-- ---------------------------------------------------------------------------
-- waitlist_confirm: potvrzení odkazem z e-mailu (platný, nevypršelý token; jednorázový)
-- ---------------------------------------------------------------------------
create function se_vezmou.waitlist_confirm(p_token_hash bytea) returns boolean
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_rows integer;
begin
  update se_vezmou.waitlist w
     set confirmed_at = pg_catalog.now(), confirm_token_hash = null, confirm_expires_at = null
   where w.confirm_token_hash = p_token_hash and w.confirm_expires_at > pg_catalog.now()
     and w.confirmed_at is null;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end
$$;

revoke all on function se_vezmou.waitlist_confirm(bytea) from public, anon;
grant execute on function se_vezmou.waitlist_confirm(bytea) to service_role;
