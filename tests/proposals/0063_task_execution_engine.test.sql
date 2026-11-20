-- Assertions for docs/proposals/0063 (rolled back). Task runs: members queue and control, admins approve,
-- viewers and outsiders cannot act, the AI outcome follows the recorded request, nothing runs twice.
do $$
declare
  uo uuid := gen_random_uuid(); um uuid := gen_random_uuid(); uv uuid := gen_random_uuid(); ux uuid := gen_random_uuid();
  o uuid; w uuid; t1 uuid; t2 uuid; t3 uuid; k1 uuid := gen_random_uuid(); k2 uuid := gen_random_uuid(); r jsonb; r2 jsonb; run uuid; ar uuid; sr uuid;
  st text; n int; c int;
  pass int := 0; fail int := 0; failures text := '';
begin
  execute $t$CREATE OR REPLACE FUNCTION public.verify_ai_accounting(_proof text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $b$ BEGIN IF _proof IS DISTINCT FROM 'rollback-fixture-only' THEN RAISE EXCEPTION 'server accounting verification required'; END IF; END $b$ $t$;
  insert into auth.users(id,email,aud,role,instance_id) values
    (uo,'te-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (um,'te-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (uv,'te-viewer@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ux,'te-outsider@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  perform set_config('request.jwt.claims', json_build_object('sub',uo,'role','authenticated')::text, true); execute 'set local role authenticated';
  o := public.create_organization('Task execution fixture','T'); select id into w from public.workspaces where org_id = o;
  execute 'reset role';
  insert into public.organization_members(org_id,user_id,role) values(o,um,'member'),(o,uv,'viewer');
  insert into public.workspace_members(workspace_id,user_id,role) values(w,um,'member'),(w,uv,'viewer');

  -- member creates tasks, assigns a specialist and queues a run
  perform set_config('request.jwt.claims', json_build_object('sub',um,'role','authenticated')::text, true); execute 'set local role authenticated';
  insert into public.tasks(org_id,workspace_id,title) values(o,w,'Analyse lunch demand') returning id into t1;
  insert into public.tasks(org_id,workspace_id,title) values(o,w,'Write the offer page') returning id into t2;
  insert into public.tasks(org_id,workspace_id,title) values(o,w,'Launch LinkedIn ads') returning id into t3;
  begin perform public.queue_task_run(t1,k1,8); fail:=fail+1; failures:=failures||' queued_without_specialist'; exception when others then pass:=pass+1; end;
  perform public.assign_task_specialist(t1,'market_research','analysis',false);
  perform public.assign_task_specialist(t2,'copywriter','preparation',false);
  perform public.assign_task_specialist(t3,'advertising','external',false);
  begin perform public.assign_task_specialist(t1,'wizard','analysis',false); fail:=fail+1; failures:=failures||' unknown_specialist'; exception when others then pass:=pass+1; end;
  begin perform public.queue_task_run(t3,gen_random_uuid(),8); fail:=fail+1; failures:=failures||' external_queued'; exception when others then pass:=pass+1; end;
  begin perform public.queue_task_run(t1,gen_random_uuid(),21); fail:=fail+1; failures:=failures||' over_run_cap'; exception when others then pass:=pass+1; end;
  -- dependency: t2 depends on t1, so it is blocked until t1 is done
  insert into public.execution_notes(org_id,workspace_id,entity_type,entity_id,kind,related_id) values(o,w,'tasks',t2,'dependency',t1);
  begin perform public.queue_task_run(t2,gen_random_uuid(),8); fail:=fail+1; failures:=failures||' dependency_ignored'; exception when others then pass:=pass+1; end;
  r := public.queue_task_run(t1,k1,8); run := (r->>'id')::uuid;
  if r->>'status'='queued' and (r->>'attempt')::int=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' queued'; end if;
  r2 := public.queue_task_run(t1,k1,8);
  if r2->>'id'=r->>'id' then pass:=pass+1; else fail:=fail+1; failures:=failures||' idempotent'; end if;
  begin perform public.queue_task_run(t1,gen_random_uuid(),8); fail:=fail+1; failures:=failures||' second_active_run'; exception when others then pass:=pass+1; end;
  select status into st from public.tasks where id=t1; if st='in_progress' then pass:=pass+1; else fail:=fail+1; failures:=failures||' task_in_progress'; end if;
  begin insert into public.task_runs(org_id,workspace_id,task_id,request_key,specialist_key,task_type,mode,attempt,status,estimated_credits,requested_by) values(o,w,t1,gen_random_uuid(),'seo','analysis',2,1,'queued',1,um); fail:=fail+1; failures:=failures||' direct_insert';
  exception when others then pass:=pass+1; end;
  begin update public.task_runs set status='succeeded' where id=run; get diagnostics n = row_count; if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' direct_update'; end if;
  exception when others then pass:=pass+1; end;
  -- pause / resume
  r := public.control_task_run(run,'pause'); if r->>'status'='paused' then pass:=pass+1; else fail:=fail+1; failures:=failures||' paused'; end if;
  begin perform public.start_task_run_verified(run,'rollback-fixture-only'); fail:=fail+1; failures:=failures||' started_paused'; exception when others then pass:=pass+1; end;
  r := public.control_task_run(run,'resume'); if r->>'status'='queued' then pass:=pass+1; else fail:=fail+1; failures:=failures||' resumed'; end if;
  -- server-only start
  begin perform public.start_task_run_verified(run,'forged'); fail:=fail+1; failures:=failures||' start_without_proof'; exception when others then pass:=pass+1; end;
  r := public.start_task_run_verified(run,'rollback-fixture-only'); if r->>'status'='running' then pass:=pass+1; else fail:=fail+1; failures:=failures||' running'; end if;
  begin perform public.control_task_run(run,'cancel'); fail:=fail+1; failures:=failures||' cancelled_running'; exception when others then pass:=pass+1; end;
  execute 'reset role';

  -- viewer and outsider
  perform set_config('request.jwt.claims', json_build_object('sub',uv,'role','authenticated')::text, true); execute 'set local role authenticated';
  select count(*) into c from public.task_runs where id=run; if c=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer_reads'; end if;
  begin perform public.queue_task_run(t2,gen_random_uuid(),8); fail:=fail+1; failures:=failures||' viewer_queued'; exception when others then pass:=pass+1; end;
  begin perform public.assign_task_specialist(t2,'seo','analysis',false); fail:=fail+1; failures:=failures||' viewer_assigned'; exception when others then pass:=pass+1; end;
  begin perform public.reconcile_task_runs(w); fail:=fail+1; failures:=failures||' viewer_reconciled'; exception when others then pass:=pass+1; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',ux,'role','authenticated')::text, true); execute 'set local role authenticated';
  select count(*) into c from public.task_runs where workspace_id=w; if c=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_reads_runs'; end if;
  select count(*) into c from public.task_execution_profiles where workspace_id=w; if c=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_reads_profiles'; end if;
  begin perform public.control_task_run(run,'pause'); fail:=fail+1; failures:=failures||' outsider_controlled'; exception when others then pass:=pass+1; end;
  begin perform public.set_execution_settings(w,4,50,1000); fail:=fail+1; failures:=failures||' outsider_settings'; exception when others then pass:=pass+1; end;
  execute 'reset role';

  -- the outcome follows the recorded AI request (simulated as the accounting functions would leave it)
  insert into public.agent_runs(org_id,workspace_id,user_id,agent_key,status) values(o,w,um,'market_research','succeeded') returning id into ar;
  insert into public.single_ai_requests(org_id,workspace_id,user_id,request_key,kind,input,run_id,status,reply,credits)
    values(o,w,um,k1,'research','{"request":"x"}',ar,'succeeded','# Result',6) returning id into sr;
  perform set_config('request.jwt.claims', json_build_object('sub',um,'role','authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.link_task_run_request_verified(run,gen_random_uuid(),'rollback-fixture-only'); fail:=fail+1; failures:=failures||' linked_foreign'; exception when others then pass:=pass+1; end;
  perform public.link_task_run_request_verified(run,sr,'rollback-fixture-only');
  r := public.finish_task_run_verified(run,'{"title":"Lunch demand"}','', 'rollback-fixture-only');
  if r->>'status'='succeeded' and (r->>'credits_charged')::int=6 then pass:=pass+1; else fail:=fail+1; failures:=failures||' finished '||coalesce(r->>'status','?'); end if;
  select status into st from public.tasks where id=t1; if st='review' then pass:=pass+1; else fail:=fail+1; failures:=failures||' task_review'; end if;
  begin perform public.finish_task_run_verified(run,'{"title":"again"}','','rollback-fixture-only'); fail:=fail+1; failures:=failures||' finished_twice'; exception when others then pass:=pass+1; end;
  select count(*) into c from public.activity_events where entity_type='tasks' and entity_id=t1 and action like 'run_%'; if c>=5 then pass:=pass+1; else fail:=fail+1; failures:=failures||' history '||c; end if;

  -- timed-out run before dispatch is settled as failed with nothing charged; a retry is then possible
  update public.tasks set status='done' where id=t1;
  r := public.queue_task_run(t2,k2,8); run := (r->>'id')::uuid;
  perform public.start_task_run_verified(run,'rollback-fixture-only');
  execute 'reset role';
  update public.task_runs set lease_until = now() - interval '1 minute' where id=run;
  perform set_config('request.jwt.claims', json_build_object('sub',um,'role','authenticated')::text, true); execute 'set local role authenticated';
  n := public.reconcile_task_runs(w);
  select status into st from public.task_runs where id=run;
  if n=1 and st='failed' then pass:=pass+1; else fail:=fail+1; failures:=failures||' reconciled '||st; end if;
  r := public.queue_task_run(t2,gen_random_uuid(),8);
  if (r->>'attempt')::int=2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' retry_attempt'; end if;
  run := (r->>'id')::uuid;
  perform public.start_task_run_verified(run,'rollback-fixture-only');
  execute 'reset role';
  -- a dispatched call with unknown outcome stays uncertain and blocks retries
  insert into public.agent_runs(org_id,workspace_id,user_id,agent_key,status) values(o,w,um,'content','running') returning id into ar;
  insert into public.single_ai_requests(org_id,workspace_id,user_id,request_key,kind,input,run_id,status)
    values(o,w,um,(select request_key from public.task_runs where id=run),'content','{"request":"x"}',ar,'running') returning id into sr;
  insert into public.ai_credit_reservations(run_id,org_id,user_id,reserved) values(ar,o,um,3);
  update public.task_runs set single_request_id=sr, agent_run_id=ar, lease_until=now()-interval '1 minute' where id=run;
  perform set_config('request.jwt.claims', json_build_object('sub',um,'role','authenticated')::text, true); execute 'set local role authenticated';
  perform public.reconcile_task_runs(w);
  select status into st from public.task_runs where id=run; if st='uncertain' then pass:=pass+1; else fail:=fail+1; failures:=failures||' uncertain '||st; end if;
  begin perform public.queue_task_run(t2,gen_random_uuid(),8); fail:=fail+1; failures:=failures||' retried_uncertain'; exception when others then pass:=pass+1; end;
  execute 'reset role';
  update public.single_ai_requests set status='failed' where id=sr;
  perform set_config('request.jwt.claims', json_build_object('sub',um,'role','authenticated')::text, true); execute 'set local role authenticated';
  perform public.reconcile_task_runs(w);
  select status into st from public.task_runs where id=run; if st='failed' then pass:=pass+1; else fail:=fail+1; failures:=failures||' uncertain_resolved '||st; end if;
  begin perform public.set_execution_settings(w,4,50,1000); fail:=fail+1; failures:=failures||' member_settings'; exception when others then pass:=pass+1; end;
  execute 'reset role';

  if public.task_run_ai_state(null) = 'none' then pass:=pass+1; else fail:=fail+1; failures:=failures||' state_none'; end if;
  -- mode 3: every run needs an admin decision; rejection needs a reason
  perform set_config('request.jwt.claims', json_build_object('sub',uo,'role','authenticated')::text, true); execute 'set local role authenticated';
  perform public.set_execution_settings(w,3,20,200);
  begin perform public.set_execution_settings(w,5,20,200); fail:=fail+1; failures:=failures||' bad_mode'; exception when others then pass:=pass+1; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',um,'role','authenticated')::text, true); execute 'set local role authenticated';
  r := public.queue_task_run(t2,gen_random_uuid(),8); run := (r->>'id')::uuid;
  if r->>'status'='awaiting_approval' then pass:=pass+1; else fail:=fail+1; failures:=failures||' awaiting'; end if;
  begin perform public.start_task_run_verified(run,'rollback-fixture-only'); fail:=fail+1; failures:=failures||' started_unapproved'; exception when others then pass:=pass+1; end;
  begin perform public.decide_task_run(run,'approved',''); fail:=fail+1; failures:=failures||' member_approved'; exception when others then pass:=pass+1; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',uo,'role','authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.decide_task_run(run,'rejected',' '); fail:=fail+1; failures:=failures||' reject_no_reason'; exception when others then pass:=pass+1; end;
  r := public.decide_task_run(run,'approved','Fine within budget');
  if r->>'status'='queued' then pass:=pass+1; else fail:=fail+1; failures:=failures||' approved'; end if;
  r := public.start_task_run_verified(run,'rollback-fixture-only'); if r->>'status'='running' then pass:=pass+1; else fail:=fail+1; failures:=failures||' approved_started'; end if;
  -- the third attempt is the last one
  update public.tasks set status='in_progress' where id=t2;
  execute 'reset role';
  update public.task_runs set lease_until=now()-interval '1 minute' where id=run;
  perform set_config('request.jwt.claims', json_build_object('sub',uo,'role','authenticated')::text, true); execute 'set local role authenticated';
  perform public.reconcile_task_runs(w);
  begin perform public.queue_task_run(t2,gen_random_uuid(),8); fail:=fail+1; failures:=failures||' fourth_attempt'; exception when others then pass:=pass+1; end;
  execute 'reset role';
  begin delete from public.task_runs where id=run; fail:=fail+1; failures:=failures||' deleted'; exception when others then pass:=pass+1; end;
  if not has_table_privilege('authenticated','public.task_runs','insert') and not has_table_privilege('authenticated','public.task_runs','update') then pass:=pass+1; else fail:=fail+1; failures:=failures||' grants'; end if;
  raise exception 'TASK_EXECUTION_RESULT pass=% fail=% failures=[%]', pass, fail, trim(failures);
end $$;
