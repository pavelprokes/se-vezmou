-- Izolace dat mezi svatbami (data-model.md kap. 12 bod 1; test-plan.md 2.4; brána B).
-- Správce svatby A nečte ani nezapisuje řádky svatby B v žádné tabulce.
begin;
select tap.seed();

-- Matice: tabulka, režim správce a sloupec s identifikátorem svatby.
--   rw      select, insert, update, delete vlastních řádků
--   ro      jen select vlastních řádků (zápis jde přes RPC nebo je vyhrazen operátorovi)
--   insert  select a insert vlastních (site_versions)
--   none    správce nemá k tabulce žádný přístup (tabulka bez politik)
create temp table matrix (tbl text primary key, mode text not null, col text not null);
insert into matrix values
  ('weddings', 'special', 'id'),
  ('pages', 'rw', 'wedding_id'), ('content_blocks', 'rw', 'wedding_id'), ('events', 'rw', 'wedding_id'),
  ('venues', 'rw', 'wedding_id'), ('media', 'rw', 'wedding_id'), ('households', 'rw', 'wedding_id'),
  ('guests', 'rw', 'wedding_id'), ('invitations', 'rw', 'wedding_id'), ('rsvp_settings', 'rw', 'wedding_id'),
  ('rsvp_questions', 'rw', 'wedding_id'), ('rsvp_responses', 'rw', 'wedding_id'), ('rsvp_people', 'rw', 'wedding_id'),
  ('rsvp_attendance', 'rw', 'wedding_id'), ('rsvp_health', 'rw', 'wedding_id'),
  ('wedding_admins', 'ro', 'wedding_id'), ('wedding_auth', 'ro', 'wedding_id'), ('orders', 'ro', 'wedding_id'),
  ('wedding_status_history', 'ro', 'wedding_id'), ('site_version_sensitive', 'ro', 'wedding_id'),
  ('data_access_grants', 'ro', 'wedding_id'), ('audit_log', 'ro', 'wedding_id'),
  ('site_versions', 'insert', 'wedding_id'),
  ('sessions', 'none', 'wedding_id'), ('rsvp_tickets', 'none', 'wedding_id'), ('operator_notes', 'none', 'wedding_id'),
  ('email_log', 'none', 'wedding_id'), ('slug_registry', 'none', 'wedding_id'),
  ('login_challenges', 'none', 'id'), ('rate_limits', 'none', 'bucket_key'), ('lockouts', 'none', 'bucket_key'),
  ('operators', 'none', 'id'), ('operator_sessions', 'none', 'id'), ('operator_backup_codes', 'none', 'operator_id'),
  ('waitlist', 'none', 'id'), ('app_settings', 'none', 'key'), ('analytics_event', 'none', 'id');
grant select on matrix to public;

-- Pojistka: každá nová tabulka musí být v matici (jinak test shodí build)
do $$
declare
  v_missing text;
begin
  select string_agg(c.relname, ', ') into v_missing
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
     and c.relname not in (select tbl from matrix);
  perform tap.ok(v_missing is null, 'všechny tabulky jsou v matici izolačního testu (chybí: ' || coalesce(v_missing, '-') || ')');
end
$$;

-- Správce A: čtení, zápis a mazání cizích řádků po tabulkách
do $$
declare
  r record;
  v_cols text;
  v_row jsonb;
  v_wa uuid := tap.wa();
  v_wb uuid := tap.wb();
  v_n bigint;
  v_own bigint;
begin
  for r in select * from matrix where mode in ('rw', 'ro', 'insert', 'special') order by tbl loop
    -- (zdrojový řádek svatby A pro pokus o vložení kopie s cizím wedding_id; čteme jako vlastník)
    perform tap.reset();
    execute format('select to_jsonb(t) from public.%I t where t.%I = $1 limit 1', r.tbl, r.col)
      into v_row using v_wa;
    perform tap.ok(v_row is not null, r.tbl || ': fixtura obsahuje řádek svatby A');

    -- sloupce bez generovaných (name_norm, name_key) a identity always (audit_log.id)
    select string_agg(format('%I', a.attname), ', ' order by a.attnum) into v_cols
      from pg_attribute a
     where a.attrelid = ('public.' || r.tbl)::regclass and a.attnum > 0 and not a.attisdropped
       and a.attgenerated = '' and a.attidentity <> 'a';

    execute format('select count(*) from public.%I where %I = $1', r.tbl, r.col) into v_own using v_wa;
    perform tap.become('authenticated', v_wa, 'admin');

    -- čtení: vlastní řádky ano, cizí ne
    execute format('select count(*) from public.%I where %I = $1', r.tbl, r.col) into v_n using v_wa;
    perform tap.ok(v_n >= 1, r.tbl || ': správce A čte vlastní řádky');
    execute format('select count(*) from public.%I where %I = $1', r.tbl, r.col) into v_n using v_wb;
    perform tap.eq(v_n, 0, r.tbl || ': správce A nečte řádky svatby B');

    -- vložení kopie řádku s wedding_id svatby B musí selhat (politika nebo chybějící právo)
    if r.mode <> 'special' then
      perform tap.throws(
        format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, %3$L::jsonb || jsonb_build_object(''wedding_id'', %4$L)) ',
               r.tbl, v_cols,
               (v_row || case when v_row ? 'id' then jsonb_build_object('id', gen_random_uuid()) else '{}'::jsonb end)::text,
               v_wb),
        '42501', r.tbl || ': správce A nevloží řádek se svatbou B');
    end if;

    if r.mode in ('rw', 'special') then
      -- cizí řádky nelze změnit ani smazat (RLS je odfiltruje, 0 dotčených řádků)
      if r.mode = 'rw' then
        perform tap.eq(tap.affected(format('update public.%I set %I = %I where %I = %L', r.tbl, r.col, r.col, r.col, v_wb)),
          0, r.tbl || ': správce A nezmění řádky svatby B');
        perform tap.eq(tap.affected(format('delete from public.%I where %I = %L', r.tbl, r.col, v_wb)),
          0, r.tbl || ': správce A nesmaže řádky svatby B');
        -- vlastní řádky ano
        perform tap.ok(tap.affected(format('update public.%I set %I = %I where %I = %L', r.tbl, r.col, r.col, r.col, v_wa)) >= 1,
          r.tbl || ': správce A změní vlastní řádky');
        -- příkazy bez WHERE (jen politika pro delete/update rozhoduje) zasáhnou výhradně vlastní řádky;
        -- podtransakce se vrátí, aby fixtura zůstala pro další tabulky
        begin
          perform tap.eq(tap.affected(format('update public.%I set %I = %I', r.tbl, r.col, r.col)), v_own,
            r.tbl || ': update bez WHERE zasáhne jen řádky svatby A');
          perform tap.eq(tap.affected(format('delete from public.%I', r.tbl)), v_own,
            r.tbl || ': delete bez WHERE smaže jen řádky svatby A');
          raise exception 'vrátit_podtransakci';
        exception when others then
          if sqlerrm <> 'vrátit_podtransakci' then raise; end if;
        end;
        -- přepsání wedding_id vlastního řádku na svatbu B selže na politice (with check)
        perform tap.throws(format('update public.%I set wedding_id = %L where wedding_id = %L', r.tbl, v_wb, v_wa),
          '42501', r.tbl || ': správce A nepřehodí řádek do svatby B');
      end if;
    else
      -- jen čtení: zápis selže pro chybějící právo
      perform tap.throws(format('update public.%I set %I = %I where %I = %L', r.tbl, r.col, r.col, r.col, v_wb),
        '42501', r.tbl || ': správce A nemá právo update');
      perform tap.throws(format('delete from public.%I where %I = %L', r.tbl, r.col, v_wb),
        '42501', r.tbl || ': správce A nemá právo delete');
    end if;

    perform tap.reset();
  end loop;
end
$$;

-- Svatba (zvláštní případ): správce vidí a mění jen svou, jen povolené sloupce
do $$
declare
  v_wa uuid := tap.wa();
  v_wb uuid := tap.wb();
begin
  perform tap.become('authenticated', v_wa, 'admin');
  perform tap.eq(tap.affected(format('update public.weddings set template = ''modern'' where id = %L', v_wa)), 1,
    'správce A změní šablonu své svatby');
  perform tap.eq(tap.affected(format('update public.weddings set template = ''modern'' where id = %L', v_wb)), 0,
    'správce A nezmění šablonu svatby B');
  perform tap.throws(format('update public.weddings set status = ''blocked'' where id = %L', v_wa), '42501',
    'správce A nezmění status ani své svatby');
  perform tap.throws(format('update public.weddings set slug = ''jiny'' where id = %L', v_wa), '42501',
    'správce A nezmění slug');
  perform tap.throws(format('update public.weddings set id = %L where id = %L', v_wb, v_wa), '42501',
    'správce A nezmění identifikátor svatby (ani na B)');
  perform tap.throws(format('update public.weddings set purge_at = now() where id = %L', v_wa), '42501',
    'správce A nezmění purge_at');
  perform tap.throws(format('update public.weddings set published_version_id = %L where id = %L', tap.u('B:version'), v_wa), '42501',
    'správce A nepřepne zveřejněnou verzi přímo');
  perform tap.throws(format('delete from public.weddings where id = %L', v_wa), '42501', 'správce A nesmaže svatbu');
  perform tap.throws('insert into public.weddings (partner_a_name, partner_b_name) values (''X'', ''Y'')', '42501',
    'správce A nezaloží svatbu přímo');
  -- wedding_auth: čtení nastavení ano, hash PINu ne
  perform tap.ok(tap.count(format('select count(*) from public.wedding_auth where wedding_id = %L', v_wa)) = 1,
    'správce A čte nastavení přihlášení');
  perform tap.throws('select admin_pin_hash from public.wedding_auth', '42501', 'správce A nečte hash PINu správy');
  perform tap.throws('select guest_pin_hash from public.wedding_auth', '42501', 'správce A nečte hash PINu hostů');
  perform tap.throws('select * from public.wedding_auth', '42501', 'select * z wedding_auth selže (citlivé sloupce)');
  perform tap.reset();
end
$$;

-- Audit: správce vidí jen zásahy operátora u své svatby, ne systémové záznamy ani cizí svatbu
do $$
begin
  perform tap.become('authenticated', tap.wa(), 'admin');
  perform tap.eq(tap.count('select count(*) from public.audit_log'), 1, 'správce A vidí jen zásah operátora u své svatby');
  perform tap.eq(tap.count('select count(*) from public.audit_log where actor_type <> ''operator'''), 0, 'správce A nevidí systémové záznamy');
  perform tap.reset();
end
$$;

-- Tabulky bez politik: správce k nim nemá přístup vůbec
do $$
declare
  r record;
begin
  perform tap.become('authenticated', tap.wa(), 'admin');
  for r in select * from matrix where mode = 'none' order by tbl loop
    perform tap.throws(format('select count(*) from public.%I', r.tbl), '42501', r.tbl || ': správce A nemá přístup');
    perform tap.throws(format('delete from public.%I', r.tbl), '42501', r.tbl || ': správce A nemůže mazat');
  end loop;
  perform tap.reset();
end
$$;

-- Zápis správce B do svatby A (symetrie): stejné pravidlo platí oběma směry
do $$
begin
  perform tap.become('authenticated', tap.wb(), 'admin');
  perform tap.eq(tap.count(format('select count(*) from public.guests where wedding_id = %L', tap.wa())), 0,
    'správce B nečte hosty svatby A');
  perform tap.eq(tap.count(format('select count(*) from public.rsvp_health where wedding_id = %L', tap.wa())), 0,
    'správce B nečte zdravotní údaje svatby A');
  perform tap.eq(tap.affected(format('delete from public.guests where wedding_id = %L', tap.wa())), 0,
    'správce B nesmaže hosty svatby A');
  perform tap.throws(format('insert into public.pages (wedding_id, path) values (%L, ''x'')', tap.wa()), '42501',
    'správce B nevloží stránku do svatby A');
  perform tap.reset();
end
$$;

-- Dotaz bez filtru podle svatby nevrátí cizí data díky RLS
do $$
begin
  perform tap.become('authenticated', tap.wa(), 'admin');
  perform tap.eq(tap.count('select count(*) from public.guests where wedding_id <> ''' || tap.wa() || ''''), 0,
    'dotaz bez filtru nevrátí hosty cizí svatby');
  perform tap.eq(tap.count('select count(*) from public.guests'), 2, 'dotaz bez filtru vrátí jen vlastní hosty');
  perform tap.eq(tap.count('select count(*) from public.weddings'), 1, 'dotaz bez filtru vrátí jen vlastní svatbu');
  perform tap.reset();
end
$$;

rollback;
