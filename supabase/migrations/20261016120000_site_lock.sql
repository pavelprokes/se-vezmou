-- Heslo na celý web páru: zamčený web vydá návštěvníkovi bez relace hosta (PIN, nebo osobní odkaz) jen jména
-- páru a jazyky, žádný obsah. Zámek platí jen se zapnutým PINem hostů (bez něj by se na web nedostal nikdo).
-- Zpětně kompatibilní: nový sloupec s výchozí hodnotou false (web odemčený jako dosud); get_public_site
-- dostane obal, který zámek kontroluje, a původní tělo zůstává beze změny pod novým interním jménem.

alter table se_vezmou.weddings add column site_locked boolean not null default false;

-- původní funkce se přejmenuje a stane se interní (volá ji jen obal níže)
alter function se_vezmou.get_public_site() rename to get_public_site_unlocked;
revoke all on function se_vezmou.get_public_site_unlocked() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- get_public_site: jako dosud, jen návštěvník (visitor) zamčeného webu dostane místo obsahu
-- {mode: 'locked', locked: {partners, locales, defaultLocale, template, palette}}.
-- Host po PINu (guest_pin), správce a náhled konceptu vidí web jako dřív.
-- ---------------------------------------------------------------------------
create function se_vezmou.get_public_site() returns jsonb
  language plpgsql stable security definer set search_path = ''
  as $$
declare
  v_result jsonb := se_vezmou.get_public_site_unlocked();
  w se_vezmou.weddings;
begin
  if v_result is null or se_vezmou.wedding_role() is distinct from 'visitor'
     or v_result ->> 'mode' is distinct from 'published' then
    return v_result;
  end if;
  select * into w from se_vezmou.weddings x where x.id = se_vezmou.wedding_id();
  if not (w.site_locked and w.guest_pin_enabled) then
    return v_result;
  end if;
  return jsonb_build_object(
    'mode', 'locked',
    'phase', v_result -> 'phase',
    'locked', jsonb_build_object(
      'partners', v_result -> 'content' -> 'partners',
      'locales', v_result -> 'content' -> 'locales',
      'defaultLocale', v_result -> 'content' -> 'defaultLocale',
      'template', v_result -> 'content' -> 'template',
      'palette', v_result -> 'content' -> 'palette'));
end
$$;

revoke all on function se_vezmou.get_public_site() from public, anon;
grant execute on function se_vezmou.get_public_site() to authenticated;

-- ---------------------------------------------------------------------------
-- admin_site_lock_get / admin_site_lock_set: zámek webu správcem (zamknout jen se zapnutým PINem hostů)
-- ---------------------------------------------------------------------------
create function se_vezmou.admin_site_lock_get() returns boolean
  language plpgsql stable security definer set search_path = ''
  as $$
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return (select w.site_locked from se_vezmou.weddings w where w.id = se_vezmou.wedding_id());
end
$$;

create function se_vezmou.admin_site_lock_set(p_locked boolean) returns void
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_locked is null then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;
  if p_locked and not exists (
       select 1 from se_vezmou.weddings w join se_vezmou.wedding_auth wa on wa.wedding_id = w.id
        where w.id = v_wedding_id and w.guest_pin_enabled and wa.guest_pin_hash is not null) then
    raise exception 'pin_missing' using errcode = '55000';
  end if;
  update se_vezmou.weddings w set site_locked = p_locked where w.id = v_wedding_id;
  perform se_vezmou.write_audit('admin', se_vezmou.actor_id(), v_wedding_id,
    case when p_locked then 'site.locked' else 'site.unlocked' end,
    'wedding', v_wedding_id, null, '{}'::jsonb);
end
$$;

revoke all on function se_vezmou.admin_site_lock_get(), se_vezmou.admin_site_lock_set(boolean)
  from public, anon, service_role;
grant execute on function se_vezmou.admin_site_lock_get(), se_vezmou.admin_site_lock_set(boolean)
  to authenticated;
