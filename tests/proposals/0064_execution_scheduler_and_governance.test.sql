-- Assertions for docs/proposals/0064 (rolled back). Scheduler cycles rank and gate work, queue at most the
-- parallel limit, wait for approvals, respect pause, caps, allowed specialists, window and schedule.
do $$
declare
  uo uuid := gen_random_uuid(); um uuid := gen_random_uuid(); uv uuid := gen_random_uuid(); ux uuid := gen_random_uuid();
  o uuid; w uuid; ta uuid; tb uuid; tc uuid; td uuid; te uuid; tf uuid; k uuid := gen_random_uuid(); c jsonb; c2 jsonb; r jsonb; r2 jsonb;
  st text; n int; rs text; hr int;
  pass int := 0; fail int := 0; failures text := '';
begin
  execute $t$CREATE OR REPLACE FUNCTION public.verify_ai_accounting(_proof text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $b$ BEGIN IF _proof IS DISTINCT FROM 'rollback-fixture-only' THEN RAISE EXCEPTION 'server accounting verification required'; END IF; END $b$ $t$;
  insert into auth.users(id,email,aud,role,instance_id) values
    (uo,'sc-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (um,'sc-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (uv,'sc-viewer@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ux,'sc-outsider@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  perform set_config('request.jwt.claims', json_build_object('sub',uo,'role','authenticated')::text, true); execute 'set local role authenticated';
  o := public.create_organization('Scheduler fixture','S'); select id into w from public.workspaces where org_id = o;
  execute 'reset role';
  insert into public.organization_members(org_id,user_id,role) values(o,um,'member'),(o,uv,'viewer');
  insert into public.workspace_members(workspace_id,user_id,role) values(w,um,'member'),(w,uv,'viewer');
  insert into public.credit_ledger(org_id,delta,reason) values(o,500,'adjustment');

  perform set_config('request.jwt.claims', json_build_object('sub',um,'role','authenticated')::text, true); execute 'set local role authenticated';
  insert into public.tasks(org_id,workspace_id,title,priority,due_date) values(o,w,'A urgent overdue','urgent',current_date-2) returning id into ta;
  insert into public.tasks(org_id,workspace_id,title,priority) values(o,w,'B low','low') returning id into tb;
  insert into public.tasks(org_id,workspace_id,title,priority) values(o,w,'C high blocked','high') returning id into tc;
  insert into public.tasks(org_id,workspace_id,title,priority) values(o,w,'D external','high') returning id into td;
  insert into public.tasks(org_id,workspace_id,title,priority) values(o,w,'E needs approval','medium') returning id into te;
  perform public.assign_task_specialist(ta,'market_research','analysis',false);
  perform public.assign_task_specialist(tb,'seo','analysis',false);
  perform public.assign_task_specialist(tc,'copywriter','preparation',false);
  perform public.assign_task_specialist(td,'advertising','external',false);
  perform public.assign_task_specialist(te,'business_analyst','analysis',true);
  insert into public.execution_notes(org_id,workspace_id,entity_type,entity_id,kind,related_id) values(o,w,'tasks',tc,'dependency',tb);
  -- members cannot run cycles, change governance or pause
  begin perform public.plan_execution_cycle(w,gen_random_uuid(),'manual'); fail:=fail+1; failures:=failures||' member_cycle'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.set_execution_governance(w,'{"max_parallel":3}'); fail:=fail+1; failures:=failures||' member_governance'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.set_execution_paused(w,true,'x'); fail:=fail+1; failures:=failures||' member_pause'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub',uo,'role','authenticated')::text, true); execute 'set local role authenticated';
  -- mode 2 (default) refuses cycles
  begin perform public.plan_execution_cycle(w,gen_random_uuid(),'manual'); fail:=fail+1; failures:=failures||' mode2_cycle'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  perform public.set_execution_settings(w,4,20,200);
  perform public.set_execution_governance(w,'{"max_parallel":1,"timezone":"Europe/Brussels"}');
  begin perform public.set_execution_governance(w,'{"timezone":"Mars/Olympus"}'); fail:=fail+1; failures:=failures||' bad_tz'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.set_execution_governance(w,'{"allowed_specialists":["wizard"]}'); fail:=fail+1; failures:=failures||' bad_specialist'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.set_execution_governance(w,'{"max_parallel":5}'); fail:=fail+1; failures:=failures||' parallel_over_3'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  -- ranking: A (urgent, overdue) first; B low; C blocked; D external; E waits for approval
  -- internal helpers are not API-callable after 0088: read them as the database owner
  execute 'reset role';
  if public.task_priority_score(ta) > public.task_priority_score(tc) and public.task_priority_score(tc) > public.task_priority_score(tb) then pass:=pass+1; else fail:=fail+1; failures:=failures||' score_order'; end if;
  execute 'set local role authenticated';
  c := public.plan_execution_cycle(w,k,'manual');
  if (c->>'queued')::int=1 and (c->>'awaiting')::int=1 and (c->>'skipped')::int=3 and c->>'status'='open' then pass:=pass+1; else fail:=fail+1; failures:=failures||' cycle_counts '||c::text; end if;
  select decision||':'||reason into rs from public.execution_cycle_items where cycle_id=(c->>'id')::uuid and task_id=ta;
  if rs='queued:ready' then pass:=pass+1; else fail:=fail+1; failures:=failures||' a_'||coalesce(rs,'?'); end if;
  select decision||':'||reason into rs from public.execution_cycle_items where cycle_id=(c->>'id')::uuid and task_id=tb;
  if rs='skipped:parallel_limit' then pass:=pass+1; else fail:=fail+1; failures:=failures||' b_'||coalesce(rs,'?'); end if;
  select decision||':'||reason into rs from public.execution_cycle_items where cycle_id=(c->>'id')::uuid and task_id=tc;
  if rs='skipped:blocked_dependency' then pass:=pass+1; else fail:=fail+1; failures:=failures||' c_'||coalesce(rs,'?'); end if;
  select decision||':'||reason into rs from public.execution_cycle_items where cycle_id=(c->>'id')::uuid and task_id=td;
  if rs='skipped:external' then pass:=pass+1; else fail:=fail+1; failures:=failures||' d_'||coalesce(rs,'?'); end if;
  select decision||':'||reason into rs from public.execution_cycle_items where cycle_id=(c->>'id')::uuid and task_id=te;
  if rs='awaiting_approval:needs_approval' then pass:=pass+1; else fail:=fail+1; failures:=failures||' e_'||coalesce(rs,'?'); end if;
  select count(*) into n from public.task_runs where cycle_id=(c->>'id')::uuid; if n=2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' cycle_runs '||n; end if;
  -- the approval run cannot start without a decision
  select status into st from public.task_runs where task_id=te; if st='awaiting_approval' then pass:=pass+1; else fail:=fail+1; failures:=failures||' e_waits'; end if;
  -- idempotent and single-flight
  c2 := public.plan_execution_cycle(w,k,'manual');
  if c2->>'id'=c->>'id' then pass:=pass+1; else fail:=fail+1; failures:=failures||' cycle_idempotent'; end if;
  select count(*) into n from public.task_runs where workspace_id=w; if n=2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' no_duplicate_runs '||n; end if;
  begin perform public.plan_execution_cycle(w,gen_random_uuid(),'manual'); fail:=fail+1; failures:=failures||' second_open_cycle'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  -- parallel limit holds when starting: A starts, a manual B run cannot start alongside it
  r := public.start_task_run_verified((select id from public.task_runs where task_id=ta),'rollback-fixture-only');
  if r->>'status'='running' then pass:=pass+1; else fail:=fail+1; failures:=failures||' a_started'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',um,'role','authenticated')::text, true); execute 'set local role authenticated';
  r2 := public.queue_task_run(tb,gen_random_uuid(),8);
  begin perform public.start_task_run_verified((r2->>'id')::uuid,'rollback-fixture-only'); fail:=fail+1; failures:=failures||' parallel_start'; exception when others then
    if sqlerrm like '%same time%' then pass:=pass+1; else fail:=fail+1; failures:=failures||' parallel_msg '||sqlerrm; end if; end;
  perform public.control_task_run((r2->>'id')::uuid,'cancel');
  execute 'reset role';
  -- finishing the cycle records a summary from runs; closed cycles and decisions are permanent
  perform set_config('request.jwt.claims', json_build_object('sub',uo,'role','authenticated')::text, true); execute 'set local role authenticated';
  c2 := public.finish_execution_cycle((c->>'id')::uuid);
  if c2->>'status'='completed' and (c2->'summary'->>'running')::int=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' finished '||c2::text; end if;
  execute 'reset role';
  begin update public.execution_cycles set reason='forged' where id=(c->>'id')::uuid; fail:=fail+1; failures:=failures||' cycle_mutable'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin update public.execution_cycle_items set reason='forged' where cycle_id=(c->>'id')::uuid; fail:=fail+1; failures:=failures||' items_mutable'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin delete from public.execution_cycles where id=(c->>'id')::uuid; fail:=fail+1; failures:=failures||' cycle_deleted'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;

  -- browser roles cannot write cycles directly
  perform set_config('request.jwt.claims', json_build_object('sub',uo,'role','authenticated')::text, true); execute 'set local role authenticated';
  begin insert into public.execution_cycles(org_id,workspace_id,request_key,trigger,reason,limits,started_by) values(o,w,gen_random_uuid(),'manual','forged','{}',uo);
    fail:=fail+1; failures:=failures||' direct_cycle_insert'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  -- emergency pause blocks queueing, starting and cycles; resume restores
  perform public.set_execution_paused(w,true,'Budget review');
  begin perform public.queue_task_run(tb,gen_random_uuid(),8); fail:=fail+1; failures:=failures||' queued_while_paused'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.plan_execution_cycle(w,gen_random_uuid(),'manual'); fail:=fail+1; failures:=failures||' cycle_while_paused'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  perform public.set_execution_paused(w,false,'');
  execute 'reset role';
  if not (public.task_execution_settings(w)).paused then pass:=pass+1; else fail:=fail+1; failures:=failures||' resumed'; end if;
  execute 'set local role authenticated';
  select count(*) into n from public.audit_logs where org_id=o and action in ('execution.paused','execution.resumed'); if n=2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' pause_audit '||n; end if;
  -- daily cap, allowed specialists and retry limit
  perform public.set_execution_governance(w,'{"max_parallel":3,"daily_credit_cap":5}');
  begin perform public.queue_task_run(tb,gen_random_uuid(),8); fail:=fail+1; failures:=failures||' daily_cap'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  perform public.set_execution_governance(w,'{"max_parallel":3,"allowed_specialists":["market_research"]}');
  execute 'reset role';
  if public.task_run_gate(tb,8,false)='specialist_not_allowed' then pass:=pass+1; else fail:=fail+1; failures:=failures||' allowed_specialists '||coalesce(public.task_run_gate(tb,8,false),'null'); end if;
  execute 'set local role authenticated';
  perform public.set_execution_governance(w,'{"max_parallel":3,"max_attempts":1}');
  execute 'reset role';
  update public.task_runs set lease_until=now()-interval '1 minute' where task_id=ta;
  perform set_config('request.jwt.claims', json_build_object('sub',uo,'role','authenticated')::text, true); execute 'set local role authenticated';
  perform public.reconcile_task_runs(w);
  execute 'reset role';
  if public.task_run_gate(ta,8,false)='retry_limit' then pass:=pass+1; else fail:=fail+1; failures:=failures||' retry_limit '||coalesce(public.task_run_gate(ta,8,false),'null'); end if;
  execute 'set local role authenticated';
  perform public.set_execution_governance(w,'{"max_parallel":3,"max_attempts":3}');
  -- execution window excluding the current hour stops cycles
  hr := extract(hour from now() at time zone 'Europe/Brussels')::int;
  perform public.set_execution_governance(w,jsonb_build_object('max_parallel',3,'window_start',(hr+1)%24,'window_end',(hr+2)%24));
  begin perform public.plan_execution_cycle(w,gen_random_uuid(),'manual'); fail:=fail+1; failures:=failures||' outside_window'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';
  if public.task_run_gate(tb,8,true)='outside_window' and public.task_run_gate(tb,8,false) is null then pass:=pass+1; else fail:=fail+1; failures:=failures||' window_gate'; end if;
  execute 'set local role authenticated';
  -- schedule: off is never due; a passed daily slot is due once
  perform public.set_execution_governance(w,'{"max_parallel":3}');
  begin perform public.plan_execution_cycle(w,gen_random_uuid(),'scheduled'); fail:=fail+1; failures:=failures||' scheduled_when_off'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  perform public.set_execution_governance(w,'{"max_parallel":3,"schedule":"daily","schedule_hour":0}');
  if (public.execution_cycle_due(w)->>'due')::boolean then pass:=pass+1; else fail:=fail+1; failures:=failures||' due'; end if;
  c := public.plan_execution_cycle(w,gen_random_uuid(),'scheduled');
  if c->>'trigger'='scheduled' and c->>'reason' like 'Scheduled daily cycle due at%' then pass:=pass+1; else fail:=fail+1; failures:=failures||' scheduled_cycle '||c::text; end if;
  if not (public.execution_cycle_due(w)->>'due')::boolean then pass:=pass+1; else fail:=fail+1; failures:=failures||' due_once'; end if;
  perform public.finish_execution_cycle((c->>'id')::uuid);
  -- a task with a result waiting for review is not redone by a cycle, but can still be rerun by hand
  execute 'reset role';
  insert into public.agent_runs(org_id,workspace_id,user_id,agent_key,status) values(o,w,uo,'seo','succeeded');
  update public.task_runs set status='succeeded', credits_charged=4, finished_at=now(), lease_until=null where task_id=tb and status in ('queued','running','paused');
  if public.task_run_gate(tb,8,true)='has_result' and public.task_run_gate(tb,8,false) is null then pass:=pass+1; else fail:=fail+1; failures:=failures||' has_result '||coalesce(public.task_run_gate(tb,8,true),'null'); end if;
  execute 'set local role authenticated';
  -- organization out of credits: autonomous gate stops, manual gate leaves it to metered reservation
  execute 'reset role';
  insert into public.credit_ledger(org_id,delta,reason) values(o,-10000,'adjustment');
  insert into public.tasks(org_id,workspace_id,title,created_by) values(o,w,'F credits',uo) returning id into tf;
  insert into public.task_execution_profiles(task_id,org_id,workspace_id,specialist_key,task_type,assigned_by) values(tf,o,w,'seo','analysis',uo);
  execute 'reset role';
  if public.task_run_gate(tf,8,true)='no_credits' and public.task_run_gate(tf,8,false) is null then pass:=pass+1; else fail:=fail+1; failures:=failures||' no_credits '||coalesce(public.task_run_gate(tf,8,true),'null'); end if;
  execute 'set local role authenticated';

  -- viewers read cycles; outsiders read nothing and cannot act
  perform set_config('request.jwt.claims', json_build_object('sub',uv,'role','authenticated')::text, true); execute 'set local role authenticated';
  select count(*) into n from public.execution_cycles where workspace_id=w; if n=2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer_cycles '||n; end if;
  select count(*) into n from public.execution_cycle_items where workspace_id=w; if n>=5 then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer_items '||n; end if;
  begin perform public.plan_execution_cycle(w,gen_random_uuid(),'manual'); fail:=fail+1; failures:=failures||' viewer_cycle'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',ux,'role','authenticated')::text, true); execute 'set local role authenticated';
  select count(*) into n from public.execution_cycles where workspace_id=w; if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_cycles'; end if;
  select count(*) into n from public.execution_cycle_items where workspace_id=w; if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_items'; end if;
  begin perform public.execution_cycle_due(w); fail:=fail+1; failures:=failures||' outsider_due'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.set_execution_paused(w,true,'x'); fail:=fail+1; failures:=failures||' outsider_pause'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';
  -- the gate is not callable by browser roles
  perform set_config('request.jwt.claims', json_build_object('sub',uo,'role','authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.task_run_gate(tb,8,false); fail:=fail+1; failures:=failures||' gate_exposed'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';

  raise exception 'SCHEDULER_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
