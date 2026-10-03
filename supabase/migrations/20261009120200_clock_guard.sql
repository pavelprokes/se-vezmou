-- Oprava 3/5 (revize kódu): ochrana před časem v budoucnosti u mazacích a plánovacích funkcí service role.
--
-- Funkce purge_*, lifecycle_archive_due, lifecycle_enqueue_notices a lifecycle_notices_claim berou od M10
-- parametr p_now (simulovaný čas v testech). Kdyby ho volající (chyba v aplikaci, ruční volání) předal z budoucnosti,
-- smazaly by se údaje před lhůtou. Nejméně invazivní řešení, které zachová stávající testy i návrh CRON_TEST_CLOCK:
--
--  * původní funkce se přejmenují na `*_impl` (tělo, parametry a chování beze změny) a nikomu se na ně neuděluje
--    `execute`;
--  * pod původním názvem a se stejným podpisem vznikne tenký obal: nejdřív `se_vezmou.clock_guard(p_now)`, potom
--    volání `*_impl`. Podpisy a oprávnění (jen service_role) zůstávají, aplikace se nemění;
--  * `clock_guard` odmítne `p_now` dál než 5 minut v budoucnosti (`clock_in_future`), pokud transakce nemá zapnutou
--    testovací hodinu: `set local se_vezmou.test_clock = 'on'`. Aplikace ji zapíná jen při `CRON_TEST_CLOCK=1`
--    mimo ostrou produkci (src/lib/db/transport.ts); SQL testy ji zapínají na začátku souboru.
--
-- Parametry `p_wedding_id` a `p_dry_run` jen zužují práci nebo ji vracejí zpět, proto je nehlídáme. Minulý čas
-- (p_now dřív než dnes) nic navíc nemaže. Jde o pojistku proti chybě, ne o hranici bezpečnosti proti držiteli
-- přihlašovacích údajů aplikace (ten si testovací hodinu zapne sám): tomu brání oprávnění role a tajnost DATABASE_URL.

create function se_vezmou.clock_guard(p_now timestamptz) returns void
  language plpgsql stable set search_path = ''
  as $$
begin
  if p_now is not null
     and p_now > pg_catalog.clock_timestamp() + interval '5 minutes'
     and coalesce(pg_catalog.current_setting('se_vezmou.test_clock', true), '') <> 'on' then
    raise exception 'clock_in_future' using errcode = '22023';
  end if;
end
$$;

revoke all on function se_vezmou.clock_guard(timestamptz) from public, anon, authenticated, service_role;

alter function se_vezmou.purge_health_data(integer, timestamptz, uuid, boolean) rename to purge_health_data_impl;
alter function se_vezmou.purge_guest_data(integer, timestamptz, uuid, boolean) rename to purge_guest_data_impl;
alter function se_vezmou.purge_wedding(uuid, timestamptz) rename to purge_wedding_impl;
alter function se_vezmou.purge_deleted_weddings(integer, timestamptz, uuid, boolean) rename to purge_deleted_weddings_impl;
alter function se_vezmou.purge_expired_slug_reservations(timestamptz, boolean) rename to purge_expired_slug_reservations_impl;
alter function se_vezmou.lifecycle_archive_due(timestamptz, integer, uuid, boolean) rename to lifecycle_archive_due_impl;
alter function se_vezmou.lifecycle_enqueue_notices(timestamptz, uuid, boolean) rename to lifecycle_enqueue_notices_impl;
alter function se_vezmou.lifecycle_notices_claim(timestamptz, integer, uuid) rename to lifecycle_notices_claim_impl;

revoke all on function
  se_vezmou.purge_health_data_impl(integer, timestamptz, uuid, boolean),
  se_vezmou.purge_guest_data_impl(integer, timestamptz, uuid, boolean),
  se_vezmou.purge_wedding_impl(uuid, timestamptz),
  se_vezmou.purge_deleted_weddings_impl(integer, timestamptz, uuid, boolean),
  se_vezmou.purge_expired_slug_reservations_impl(timestamptz, boolean),
  se_vezmou.lifecycle_archive_due_impl(timestamptz, integer, uuid, boolean),
  se_vezmou.lifecycle_enqueue_notices_impl(timestamptz, uuid, boolean),
  se_vezmou.lifecycle_notices_claim_impl(timestamptz, integer, uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tenké obaly pod původními názvy (stejné podpisy, výchozí hodnoty i návratové typy)
-- ---------------------------------------------------------------------------
create function se_vezmou.purge_health_data(
  p_batch integer default 100,
  p_now timestamptz default pg_catalog.now(),
  p_wedding_id uuid default null,
  p_dry_run boolean default false
) returns integer
  language plpgsql volatile security definer set search_path = ''
  as $$
begin
  perform se_vezmou.clock_guard(p_now);
  return se_vezmou.purge_health_data_impl(p_batch, p_now, p_wedding_id, p_dry_run);
end
$$;

create function se_vezmou.purge_guest_data(
  p_batch integer default 100,
  p_now timestamptz default pg_catalog.now(),
  p_wedding_id uuid default null,
  p_dry_run boolean default false
) returns integer
  language plpgsql volatile security definer set search_path = ''
  as $$
begin
  perform se_vezmou.clock_guard(p_now);
  return se_vezmou.purge_guest_data_impl(p_batch, p_now, p_wedding_id, p_dry_run);
end
$$;

create function se_vezmou.purge_wedding(
  p_wedding_id uuid,
  p_now timestamptz default pg_catalog.now()
) returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
begin
  perform se_vezmou.clock_guard(p_now);
  return se_vezmou.purge_wedding_impl(p_wedding_id, p_now);
end
$$;

create function se_vezmou.purge_deleted_weddings(
  p_batch integer default 20,
  p_now timestamptz default pg_catalog.now(),
  p_wedding_id uuid default null,
  p_dry_run boolean default false
) returns integer
  language plpgsql volatile security definer set search_path = ''
  as $$
begin
  perform se_vezmou.clock_guard(p_now);
  return se_vezmou.purge_deleted_weddings_impl(p_batch, p_now, p_wedding_id, p_dry_run);
end
$$;

create function se_vezmou.purge_expired_slug_reservations(
  p_now timestamptz default pg_catalog.now(),
  p_dry_run boolean default false
) returns integer
  language plpgsql volatile security definer set search_path = ''
  as $$
begin
  perform se_vezmou.clock_guard(p_now);
  return se_vezmou.purge_expired_slug_reservations_impl(p_now, p_dry_run);
end
$$;

create function se_vezmou.lifecycle_archive_due(
  p_now timestamptz default pg_catalog.now(),
  p_batch integer default 100,
  p_wedding_id uuid default null,
  p_dry_run boolean default false
) returns integer
  language plpgsql volatile security definer set search_path = ''
  as $$
begin
  perform se_vezmou.clock_guard(p_now);
  return se_vezmou.lifecycle_archive_due_impl(p_now, p_batch, p_wedding_id, p_dry_run);
end
$$;

create function se_vezmou.lifecycle_enqueue_notices(
  p_now timestamptz default pg_catalog.now(),
  p_wedding_id uuid default null,
  p_dry_run boolean default false
) returns jsonb
  language plpgsql volatile security definer set search_path = ''
  as $$
begin
  perform se_vezmou.clock_guard(p_now);
  return se_vezmou.lifecycle_enqueue_notices_impl(p_now, p_wedding_id, p_dry_run);
end
$$;

create function se_vezmou.lifecycle_notices_claim(
  p_now timestamptz default pg_catalog.now(),
  p_limit integer default 50,
  p_wedding_id uuid default null
) returns table (
  notice_id uuid, wedding_id uuid, kind text, stage text, event_at timestamptz,
  slug text, locale text, timezone text, attempt smallint
)
  language plpgsql volatile security definer set search_path = ''
  as $$
begin
  perform se_vezmou.clock_guard(p_now);
  return query select * from se_vezmou.lifecycle_notices_claim_impl(p_now, p_limit, p_wedding_id);
end
$$;

revoke all on function
  se_vezmou.purge_health_data(integer, timestamptz, uuid, boolean),
  se_vezmou.purge_guest_data(integer, timestamptz, uuid, boolean),
  se_vezmou.purge_wedding(uuid, timestamptz),
  se_vezmou.purge_deleted_weddings(integer, timestamptz, uuid, boolean),
  se_vezmou.purge_expired_slug_reservations(timestamptz, boolean),
  se_vezmou.lifecycle_archive_due(timestamptz, integer, uuid, boolean),
  se_vezmou.lifecycle_enqueue_notices(timestamptz, uuid, boolean),
  se_vezmou.lifecycle_notices_claim(timestamptz, integer, uuid)
  from public, anon, authenticated;

grant execute on function
  se_vezmou.purge_health_data(integer, timestamptz, uuid, boolean),
  se_vezmou.purge_guest_data(integer, timestamptz, uuid, boolean),
  se_vezmou.purge_wedding(uuid, timestamptz),
  se_vezmou.purge_deleted_weddings(integer, timestamptz, uuid, boolean),
  se_vezmou.purge_expired_slug_reservations(timestamptz, boolean),
  se_vezmou.lifecycle_archive_due(timestamptz, integer, uuid, boolean),
  se_vezmou.lifecycle_enqueue_notices(timestamptz, uuid, boolean),
  se_vezmou.lifecycle_notices_claim(timestamptz, integer, uuid)
  to service_role;
