-- Šablony Statek, Vinice, Louka a Deco: svatba je smí mít, měření je smí zapsat, neznámá šablona dál neprojde.
begin;
select tap.seed();

do $$
declare
  v_template text;
begin
  foreach v_template in array array['statek', 'vinice', 'louka', 'deco'] loop
    update se_vezmou.weddings set template = v_template where id = tap.wa();
    perform tap.ok((select template from se_vezmou.weddings where id = tap.wa()) = v_template,
      'svatba může mít šablonu ' || v_template);
    insert into se_vezmou.analytics_event (event, template) values ('wizard_started', v_template);
  end loop;
  perform tap.eq(
    (select count(*) from se_vezmou.analytics_event where template in ('statek', 'vinice', 'louka', 'deco')),
    4, 'měření přijme nové šablony');
  perform tap.throws(
    format('update se_vezmou.weddings set template = %L where id = %L', 'neznama', tap.wa()),
    '23514', 'neznámá šablona neprojde kontrolou');
  perform tap.throws(
    $q$insert into se_vezmou.analytics_event (event, template) values ('wizard_started', 'neznama')$q$,
    '23514', 'měření neznámou šablonu nepřijme');

  -- filtr provozní administrace: nová šablona projde, neznámá se odmítne jako dřív
  set local role service_role;
  perform tap.eq(
    (select count(*) from se_vezmou.op_list_weddings(tap.u('operator:support'), p_template => 'deco')),
    1, 'filtr podle šablony Deco najde svatbu');
  perform tap.throws(
    format('select * from se_vezmou.op_list_weddings(%L, p_template => %L)', tap.u('operator:support'), 'neznama'),
    'invalid_template', 'neznámou šablonu filtr odmítne');
  perform tap.reset();
end
$$;

rollback;
