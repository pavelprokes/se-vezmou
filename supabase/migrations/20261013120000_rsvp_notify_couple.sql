-- Upozornění páru e-mailem na novou nebo změněnou odpověď hosta (volitelné, ve výchozím stavu vypnuté).
-- Příznak je ve vlastním sloupci a vlastních funkcích, aby se nemuselo přepisovat uložení nastavení RSVP.

alter table se_vezmou.rsvp_settings
  add column notify_couple boolean not null default false;

alter table se_vezmou.email_log drop constraint email_log_type_check;
alter table se_vezmou.email_log add constraint email_log_type_check
  check (type in ('login_code', 'rsvp_confirmation', 'admin_changed', 'backup_login_notice', 'expiry_notice',
                  'deletion_notice', 'operator_notice', 'waitlist_confirm', 'rsvp_notice'));

-- ---------------------------------------------------------------------------
-- admin_rsvp_notify_get / admin_rsvp_notify_set: příznak upozornění pro svatbu správce
-- ---------------------------------------------------------------------------
create function se_vezmou.admin_rsvp_notify_get() returns boolean
  language plpgsql stable security definer set search_path = ''
  as $$
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return coalesce((select s.notify_couple from se_vezmou.rsvp_settings s
                    where s.wedding_id = se_vezmou.wedding_id()), false);
end
$$;

create function se_vezmou.admin_rsvp_notify_set(p_enabled boolean) returns void
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  insert into se_vezmou.rsvp_settings (wedding_id, notify_couple)
  values (v_wedding_id, p_enabled)
  on conflict (wedding_id) do update set notify_couple = excluded.notify_couple;
  perform se_vezmou.write_audit('admin', se_vezmou.actor_id(), v_wedding_id,
    case when p_enabled then 'rsvp.notify_enabled' else 'rsvp.notify_disabled' end,
    'wedding', v_wedding_id, null, '{}'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------
-- rsvp_notify_recipients: adresy aktivních správců, jen když má svatba upozornění zapnuté
-- Volá aplikace (service role) po odeslání odpovědi; adresy jdou jen na server k odeslání, nikam se
-- neukládají. Jazyk e-mailu je výchozí jazyk svatby (správci nemají vlastní jazyk).
-- ---------------------------------------------------------------------------
create function se_vezmou.rsvp_notify_recipients(p_wedding_id uuid)
  returns table (email text, locale text)
  language sql stable security definer set search_path = ''
  as $$
  select a.email::text, w.default_locale
    from se_vezmou.wedding_admins a
    join se_vezmou.weddings w on w.id = a.wedding_id
    join se_vezmou.rsvp_settings s on s.wedding_id = a.wedding_id
   where a.wedding_id = p_wedding_id and a.removed_at is null and w.deleted_at is null
     and s.notify_couple
$$;

revoke all on function
  se_vezmou.admin_rsvp_notify_get(),
  se_vezmou.admin_rsvp_notify_set(boolean),
  se_vezmou.rsvp_notify_recipients(uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  se_vezmou.admin_rsvp_notify_get(),
  se_vezmou.admin_rsvp_notify_set(boolean)
  to authenticated;
grant execute on function se_vezmou.rsvp_notify_recipients(uuid) to service_role;
