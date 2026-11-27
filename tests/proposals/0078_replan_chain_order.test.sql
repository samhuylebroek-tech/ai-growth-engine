-- Assertions for docs/proposals/0078 (rolled back): an approved option with an adjusted later deadline pushes the
-- whole dependency chain in order, a shift's "after" must be the task itself or an earlier shift, and a dependent
-- that already lies later is not moved earlier.
do $$
declare
  uo uuid := gen_random_uuid(); o uuid; w1 uuid; ta uuid; tb uuid; tc uuid; td uuid; tz uuid; p1 uuid; j jsonb; d date;
  pass int := 0; fail int := 0; failures text := '';
begin
  execute $t$CREATE FUNCTION pg_temp.su(_u uuid) RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; PERFORM set_config('request.jwt.claims', json_build_object('sub',_u,'role','authenticated')::text, true); SET LOCAL ROLE authenticated; END $b$ $t$;
  insert into auth.users(id,email,aud,role,instance_id) values (uo,'chain-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  perform pg_temp.su(uo);
  o := public.create_organization('Chain fixture','Bakery'); select id into w1 from public.workspaces where org_id=o;
  insert into public.tasks(org_id,workspace_id,title,due_date,created_by) values(o,w1,'A',current_date-3,uo) returning id into ta;
  insert into public.tasks(org_id,workspace_id,title,due_date,created_by) values(o,w1,'B',current_date-1,uo) returning id into tb;
  insert into public.tasks(org_id,workspace_id,title,due_date,created_by) values(o,w1,'C',current_date+1,uo) returning id into tc;
  insert into public.tasks(org_id,workspace_id,title,due_date,created_by) values(o,w1,'D later',current_date+60,uo) returning id into td;
  insert into public.tasks(org_id,workspace_id,title,due_date,created_by) values(o,w1,'Z unrelated',current_date+5,uo) returning id into tz;

  begin perform public.propose_task_replan(w1, gen_random_uuid(), ta, jsonb_build_object('reasons',jsonb_build_array('overdue'),'options',jsonb_build_array(
      jsonb_build_object('key','a','kind','shift_chain','due_date',current_date+3,'shifts',jsonb_build_array(jsonb_build_object('task_id',tb,'due_date',current_date+4,'after',tz)))))); fail:=fail+1; failures:=failures||' bad_after_ok';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' bad_after:'||sqlstate; end if; end;

  j := public.propose_task_replan(w1, gen_random_uuid(), ta, jsonb_build_object('reasons',jsonb_build_array('overdue'),'options',jsonb_build_array(
      jsonb_build_object('key','a','kind','shift_chain','due_date',current_date+3,'shifts',jsonb_build_array(
        jsonb_build_object('task_id',tb,'due_date',current_date+4,'after',ta),
        jsonb_build_object('task_id',tc,'due_date',current_date+5,'after',tb),
        jsonb_build_object('task_id',td,'due_date',current_date+60,'after',tc))))));
  p1 := (j->>'id')::uuid;
  j := public.decide_task_replan(p1, 'approved', 'a', current_date+10, 'supplier is late');
  select due_date into d from public.tasks where id=ta; if d = current_date+10 then pass:=pass+1; else fail:=fail+1; failures:=failures||' a:'||d; end if;
  select due_date into d from public.tasks where id=tb; if d = current_date+11 then pass:=pass+1; else fail:=fail+1; failures:=failures||' b:'||d; end if;
  select due_date into d from public.tasks where id=tc; if d = current_date+12 then pass:=pass+1; else fail:=fail+1; failures:=failures||' c:'||d; end if;
  select due_date into d from public.tasks where id=td; if d = current_date+60 then pass:=pass+1; else fail:=fail+1; failures:=failures||' d:'||d; end if;
  if jsonb_array_length(j->'applied'->'shifted') = 2 and (j->'applied'->>'adjusted')::boolean then pass:=pass+1; else fail:=fail+1; failures:=failures||' applied:'||j::text; end if;
  RESET ROLE;
  raise exception 'REPLAN_CHAIN_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
