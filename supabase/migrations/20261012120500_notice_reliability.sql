-- Oprava po revizi kódu: spolehlivost upozornění před mazáním (M10).
--  1. Poslední upozornění („final“) má okno 2 dny místo 1: cron běží jednou denně (a na Hobby kdykoli během
--     hodiny), takže jeden vynechaný nebo pozdní běh dřív znamenal smazání jen s upozorněním 14 dní předem.
--     Mění se jen výchozí hodnota; vlastní nastavení operátora zůstává.
--  2. Upozornění, které zůstalo ve stavu `sending` (funkce cronu skončila uprostřed odesílání), se převezme
--     nejvýš třikrát (stejně jako `failed`), pak skončí jako `failed`. Dřív se převzalo pokaždé znovu
--     a e-mail mohl odcházet opakovaně.

update se_vezmou.app_settings set value = '2'
 where key = 'retention_final_notice_days_before' and value = '1';

-- ---------------------------------------------------------------------------
-- lifecycle_notices_claim_impl: stejná jako lifecycle_notices_claim v 20261005120100_lifecycle_functions.sql
-- (přejmenovaná v 20261009120200_clock_guard.sql), jen s omezením převzetí uvízlých `sending`
-- ---------------------------------------------------------------------------
create or replace function se_vezmou.lifecycle_notices_claim_impl(
  p_now timestamptz default pg_catalog.now(),
  p_limit integer default 50,
  p_wedding_id uuid default null
) returns table (
  notice_id uuid, wedding_id uuid, kind text, stage text, event_at timestamptz,
  slug text, locale text, timezone text, attempt smallint
)
  language plpgsql volatile security definer set search_path = ''
  as $$
#variable_conflict use_column
begin
  if p_limit is null or p_limit < 1 then
    raise exception 'invalid_batch' using errcode = '22023';
  end if;

  update se_vezmou.lifecycle_notices n
     set status = 'skipped'
   where n.status in ('pending', 'sending', 'failed') and n.stage in ('first', 'final')
     and n.event_at <= p_now
     and (p_wedding_id is null or n.wedding_id = p_wedding_id);
  update se_vezmou.lifecycle_notices n
     set status = 'skipped'
   where n.status in ('pending', 'sending', 'failed')
     and (p_wedding_id is null or n.wedding_id = p_wedding_id)
     and exists (select 1 from se_vezmou.weddings w
                  where w.id = n.wedding_id and (w.status in ('deleted', 'blocked') or w.deleted_at is not null));

  -- uvízlé odesílání po třetím pokusu už se nepřebírá (e-mail mohl odejít, jen se nezapsal výsledek)
  update se_vezmou.lifecycle_notices n
     set status = 'failed'
   where n.status = 'sending' and n.attempts >= 3
     and n.locked_at < pg_catalog.now() - interval '15 minutes'
     and (p_wedding_id is null or n.wedding_id = p_wedding_id);

  return query
  with picked as (
    select n.id from se_vezmou.lifecycle_notices n
     where (p_wedding_id is null or n.wedding_id = p_wedding_id)
       and (n.status = 'pending'
            or (n.status = 'sending' and n.attempts < 3 and n.locked_at < pg_catalog.now() - interval '15 minutes')
            or (n.status = 'failed' and n.attempts < 3 and n.locked_at < pg_catalog.now() - interval '1 hour'))
     order by n.created_at, n.id
     limit p_limit
     for update skip locked
  ), upd as (
    update se_vezmou.lifecycle_notices n
       set status = 'sending', locked_at = pg_catalog.now(), attempts = n.attempts + 1
      from picked
     where n.id = picked.id
    returning n.*
  )
  select u.id, u.wedding_id, u.kind, u.stage, u.event_at, w.slug, w.default_locale, w.timezone, u.attempts
    from upd u join se_vezmou.weddings w on w.id = u.wedding_id
   order by u.created_at, u.id;
end
$$;
