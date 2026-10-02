-- M4 / 2: záznam e-mailů bez osobních údajů (docs/adr/0005-email.md).
--
-- Zapisuje se jen typ, jazyk, svatba, HMAC příjemce a jeho doména; nikdy předmět, tělo ani kód.
-- Aplikace volá jen tyto funkce (stejně jako u ostatních tabulek service role nepoužívá přímý zápis).

create function public.email_log_insert(
  p_type text,
  p_wedding_id uuid,
  p_locale text,
  p_recipient_hash bytea,
  p_recipient_domain text
) returns uuid
  language sql volatile security definer set search_path = ''
  as $$
  insert into public.email_log (type, wedding_id, locale, recipient_hash, recipient_domain)
  values (p_type, p_wedding_id, p_locale, p_recipient_hash, lower(left(p_recipient_domain, 255)))
  returning id
$$;

create function public.email_log_set_status(
  p_id uuid,
  p_status text,
  p_provider_message_id text default null,
  p_error_code text default null
) returns boolean
  language sql volatile security definer set search_path = ''
  as $$
  with u as (
    update public.email_log e
       set status = p_status,
           provider_message_id = coalesce(p_provider_message_id, e.provider_message_id),
           error_code = left(p_error_code, 100)
     where e.id = p_id
    returning 1
  )
  select exists (select 1 from u)
$$;

revoke all on function
  public.email_log_insert(text, uuid, text, bytea, text),
  public.email_log_set_status(uuid, text, text, text)
  from public, anon;
grant execute on function
  public.email_log_insert(text, uuid, text, bytea, text),
  public.email_log_set_status(uuid, text, text, text)
  to service_role;
