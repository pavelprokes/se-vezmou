-- Oprava po revizi kódu: správce, kterého mezitím odebrali (nebo svatbu smazali či zablokovali), nesmí v rozběhnuté
-- transakci nic měnit, a dva správci se nesmí souběžně odebrat navzájem (svatba by zůstala bez správce).
--
--  1. `assert_admin_session()`: aplikace ji volá na začátku každé transakce správce (`src/lib/db/transport.ts`).
--     Relace se ověřuje v jiné transakci, takže funkce, které kontrolují jen claim role (`is_wedding_admin()`),
--     by jinak propustily volání odebraného správce nebo zápis do smazané či zablokované svatby.
--  2. `admin_admin_remove`: zamkne řádek svatby a po zámku znovu ověří, že volající je stále aktivní správce.

create function se_vezmou.assert_admin_session() returns void
  language plpgsql stable security definer set search_path = ''
  as $$
begin
  if se_vezmou.wedding_role() is distinct from 'admin' or se_vezmou.wedding_id() is null
     or not exists (
       select 1 from se_vezmou.wedding_admins a
         join se_vezmou.weddings w on w.id = a.wedding_id
        where a.id = se_vezmou.actor_id() and a.wedding_id = se_vezmou.wedding_id()
          and a.removed_at is null and w.deleted_at is null and w.status <> 'blocked') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end
$$;

revoke all on function se_vezmou.assert_admin_session() from public, anon;
grant execute on function se_vezmou.assert_admin_session() to authenticated;

-- ---------------------------------------------------------------------------
-- admin_admin_remove: stejná jako v 20261010120100_backup_email_confirmation.sql + zámek svatby a kontrola
-- ---------------------------------------------------------------------------
create or replace function se_vezmou.admin_admin_remove(p_admin_id uuid) returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_wedding_id uuid := se_vezmou.wedding_id();
  v_removed text;
  v_total integer;
begin
  if not se_vezmou.is_wedding_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_admin_id is not distinct from se_vezmou.actor_id() then
    raise exception 'cannot_remove_self' using errcode = '55000';
  end if;

  -- souběžná odebrání ve stejné svatbě jdou za sebou; po zámku musí být volající pořád aktivní správce
  perform 1 from se_vezmou.weddings w where w.id = v_wedding_id for update;
  if not exists (select 1 from se_vezmou.wedding_admins a
                  where a.id = se_vezmou.actor_id() and a.wedding_id = v_wedding_id and a.removed_at is null) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update se_vezmou.wedding_admins a set removed_at = pg_catalog.now()
   where a.id = p_admin_id and a.wedding_id = v_wedding_id and a.removed_at is null
  returning a.email::text into v_removed;
  if not found then
    raise exception 'admin_not_found' using errcode = 'P0002';
  end if;

  update se_vezmou.sessions s set revoked_at = pg_catalog.now()
   where s.wedding_id = v_wedding_id and s.subject_id = p_admin_id and s.revoked_at is null;

  select count(*) into v_total from se_vezmou.wedding_admins a
   where a.wedding_id = v_wedding_id and a.removed_at is null;
  perform se_vezmou.write_audit('admin', se_vezmou.actor_id(), v_wedding_id, 'admin.remove',
    'wedding_admin', p_admin_id, null, jsonb_build_object('admins_after', v_total));

  return jsonb_build_object('removed', v_removed, 'notify', (
    select coalesce(jsonb_agg(x.e), '[]'::jsonb) from (
      select a.email::text as e from se_vezmou.wedding_admins a
       where a.wedding_id = v_wedding_id and a.removed_at is null
      union
      select wa.backup_email::text from se_vezmou.wedding_auth wa where wa.wedding_id = v_wedding_id
         and wa.backup_email_confirmed_at is not null
    ) x));
end
$$;
