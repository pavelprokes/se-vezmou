-- Zveřejnění je vázané na revizi pracovní kopie (`weddings.site_rev`).
--
-- `admin_site_publish` dřív nic nevědělo o revizi: snímek sestavený ze zastaralé pracovní kopie (druhé okno
-- uložilo změny, jiný správce upravil web) se zveřejnil bez varování. Nově funkce dostane revizi, ze které
-- aplikace snímek sestavila (`p_base_rev`), a při neshodě vrátí `conflict = true`, nic nezapíše a nic
-- nezveřejní (stejný princip jako `admin_site_save`). Návratový tvar se rozšířil o `ok` a `conflict`.

drop function se_vezmou.admin_site_publish(jsonb, jsonb, text);

create function se_vezmou.admin_site_publish(
  p_public jsonb,
  p_sensitive jsonb,
  p_note text,
  p_base_rev integer
) returns table (ok boolean, conflict boolean, version_no integer, slug text)
  language plpgsql volatile security definer set search_path = ''
  as $$
declare
  v_id uuid := se_vezmou.admin_wedding();
  x se_vezmou.weddings;
  v_version uuid;
  v_no integer;
  v_actor uuid := se_vezmou.actor_id();
begin
  select * into x from se_vezmou.weddings t where t.id = v_id for update;
  if x.status not in ('draft', 'published') then
    raise exception 'wedding_not_publishable' using errcode = '55000';
  end if;
  if x.slug is null or not exists (
       select 1 from se_vezmou.slug_registry sr
        where sr.slug = x.slug and sr.wedding_id = x.id and sr.state in ('reserved', 'active')) then
    raise exception 'slug_not_reserved' using errcode = '55000';
  end if;
  if x.guest_pin_enabled and not exists (
       select 1 from se_vezmou.wedding_auth wa
        where wa.wedding_id = x.id and wa.guest_pin_hash is not null) then
    raise exception 'guest_pin_missing' using errcode = '55000';
  end if;
  -- snímek vznikl z pracovní kopie ve verzi p_base_rev; mezitím jiná změna (druhé okno, druhý správce)
  -- znamená, že by se zveřejnil zastaralý obsah: nic se nezapíše a volající načte aktuální stav
  if p_base_rev is distinct from x.site_rev then
    return query select false, true, null::integer, null::text;
    return;
  end if;
  if not se_vezmou.site_snapshot_valid(x.slug, p_public, p_sensitive) then
    raise exception 'invalid_payload' using errcode = '22023';
  end if;

  insert into se_vezmou.site_versions as sv (wedding_id, kind, public_content, note, created_by, created_at)
  values (x.id, 'publish', p_public, nullif(btrim(p_note), ''), v_actor, pg_catalog.clock_timestamp())
  returning sv.id, sv.version_no into v_version, v_no;
  insert into se_vezmou.site_version_sensitive (version_id, wedding_id, sensitive_content)
  values (v_version, x.id, p_sensitive);

  update se_vezmou.weddings t
     set status = 'published', published_version_id = v_version
   where t.id = x.id;
  if x.status <> 'published' then
    insert into se_vezmou.wedding_status_history (wedding_id, from_status, to_status, actor_type, actor_id)
    values (x.id, x.status, 'published', 'admin', v_actor);
  end if;
  perform se_vezmou.site_versions_prune(x.id);
  perform se_vezmou.write_audit('admin', v_actor, x.id, 'site.published', 'site_version', v_version,
    null, jsonb_build_object('version_no', v_no));

  ok := true;
  conflict := false;
  version_no := v_no;
  slug := x.slug;
  return next;
end
$$;

revoke all on function se_vezmou.admin_site_publish(jsonb, jsonb, text, integer) from public, anon;
grant execute on function se_vezmou.admin_site_publish(jsonb, jsonb, text, integer) to authenticated;
