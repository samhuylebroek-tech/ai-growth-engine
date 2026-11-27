-- Assertions for docs/proposals/0065 (rolled back). Simulated connections, six permission levels, the external
-- action lifecycle, approval enforcement, execution gates, duplicate prevention, uncertain outcomes resolved only by
-- verification, retry limits, real execution refusal, audit history and isolation.
do $$
declare
  uo uuid := gen_random_uuid(); um uuid := gen_random_uuid(); uv uuid := gen_random_uuid(); ux uuid := gen_random_uuid();
  o uuid; w uuid; o2 uuid; w2 uuid; g uuid; pj uuid; t1 uuid; t2 uuid; tc uuid; hub uuid; wp uuid; real uuid; c jsonb; r jsonb;
  a1 uuid; a2 uuid; a3 uuid; a4 uuid; a5 uuid; a6 uuid; ar uuid; k1 uuid := gen_random_uuid(); k uuid; rq uuid := gen_random_uuid();
  st text; n int; ref text; pf text := 'rollback-fixture-only';
  pass int := 0; fail int := 0; failures text := '';
  procedure_ok boolean;
begin
  execute $t$CREATE OR REPLACE FUNCTION public.verify_ai_accounting(_proof text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $b$ BEGIN IF _proof IS DISTINCT FROM 'rollback-fixture-only' THEN RAISE EXCEPTION 'server accounting verification required'; END IF; END $b$ $t$;
  insert into auth.users(id,email,aud,role,instance_id) values
    (uo,'xa-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (um,'xa-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (uv,'xa-viewer@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ux,'xa-outsider@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  perform set_config('request.jwt.claims', json_build_object('sub',uo,'role','authenticated')::text, true); execute 'set local role authenticated';
  o := public.create_organization('Integration fixture','I'); select id into w from public.workspaces where org_id = o;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',ux,'role','authenticated')::text, true); execute 'set local role authenticated';
  o2 := public.create_organization('Other org','X'); select id into w2 from public.workspaces where org_id = o2;
  execute 'reset role';
  insert into public.organization_members(org_id,user_id,role) values(o,um,'member'),(o,uv,'viewer');
  insert into public.workspace_members(workspace_id,user_id,role) values(w,um,'member'),(w,uv,'viewer');

  -- connecting: admin only, simulated keys only, supported levels only
  perform set_config('request.jwt.claims', json_build_object('sub',um,'role','authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.connect_simulated_integration(w,'sim.hubspot',array['read'],'healthy'); fail:=fail+1; failures:=failures||' member_connect'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',uo,'role','authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.connect_simulated_integration(w,'hubspot',array['read'],'healthy'); fail:=fail+1; failures:=failures||' real_key_via_sim'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.connect_simulated_integration(w,'sim.hubspot',array['publish'],'healthy'); fail:=fail+1; failures:=failures||' unsupported_level'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.connect_simulated_integration(w,'sim.google_analytics',array['draft'],'healthy'); fail:=fail+1; failures:=failures||' analytics_write'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.connect_simulated_integration(w,'sim.unknown',array['read'],'healthy'); fail:=fail+1; failures:=failures||' unknown_provider'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  c := public.connect_simulated_integration(w,'sim.hubspot',array['draft','execute'],'healthy'); hub := (c->>'connection_id')::uuid;
  select status||':'||array_to_string(granted_levels,',')||':'||simulated::text into st from public.connector_connections where id=hub;
  if st='connected:draft,execute,read:true' then pass:=pass+1; else fail:=fail+1; failures:=failures||' hub_state '||coalesce(st,'?'); end if;
  c := public.connect_simulated_integration(w,'sim.wordpress',array['draft','publish'],'healthy'); wp := (c->>'connection_id')::uuid;
  -- browser sessions cannot write connections directly
  begin update public.connector_connections set granted_levels='{read,draft,modify,execute,publish,budget}' where id=hub; fail:=fail+1; failures:=failures||' direct_update'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  perform public.set_execution_settings(w,2,20,200);
  execute 'reset role';
  -- a real connection with write levels forced in by the database owner, to prove execution still refuses it
  insert into public.connector_connections(org_id,workspace_id,connector_key,status,granted_levels) values(o,w,'hubspot','connected','{read,execute}') returning id into real;

  -- member prepares work
  perform set_config('request.jwt.claims', json_build_object('sub',um,'role','authenticated')::text, true); execute 'set local role authenticated';
  insert into public.growth_goals(org_id,workspace_id,title) values(o,w,'Fixture goal') returning id into g;
  insert into public.projects(org_id,workspace_id,title,goal_id) values(o,w,'Fixture project',g) returning id into pj;
  insert into public.tasks(org_id,workspace_id,title,project_id) values(o,w,'Follow up leads',pj) returning id into t1;
  insert into public.tasks(org_id,workspace_id,title) values(o,w,'Blog draft') returning id into tc;
  perform public.assign_task_specialist(t1,'crm','external',false);
  perform public.assign_task_specialist(tc,'content','preparation',false);
  begin perform public.connect_simulated_integration(w,'sim.wordpress',array['read'],'healthy'); fail:=fail+1; failures:=failures||' member_reconnect'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.set_integration_levels(hub,array['read','draft','modify','execute']); fail:=fail+1; failures:=failures||' member_levels'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  -- preparation rules
  begin perform public.create_external_action(w,gen_random_uuid(),t1,hub,'sales','crm.create_task','x','', '{"subject":"Call"}',null,null); fail:=fail+1; failures:=failures||' wrong_assigned_specialist'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.create_external_action(w,gen_random_uuid(),tc,hub,'content','crm.create_task','x','', '{"subject":"Call"}',null,null); fail:=fail+1; failures:=failures||' specialist_not_allowed'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.create_external_action(w,gen_random_uuid(),tc,hub,'content','content.save_draft','x','', '{"title":"T","body":"B"}',null,null); fail:=fail+1; failures:=failures||' provider_mismatch'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.create_external_action(w,gen_random_uuid(),t1,hub,'crm','crm.create_task','x','', '{"subject":" "}',null,null); fail:=fail+1; failures:=failures||' missing_field'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.create_external_action(w,gen_random_uuid(),t1,hub,'crm','crm.create_task','x','', '{"subject":"Call"}',10,null); fail:=fail+1; failures:=failures||' cost_without_currency'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.create_external_action(w,gen_random_uuid(),t1,real,'crm','crm.create_task','x','', '{"subject":"Call"}',null,null); fail:=fail+1; failures:=failures||' real_provider_write'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  c := public.create_external_action(w,rq,t1,hub,'crm','crm.create_task','Create follow-up task','Call the three warm leads', '{"subject":"Call warm leads"}',0,'EUR');
  a1 := (c->>'action_id')::uuid;
  c := public.create_external_action(w,rq,t1,hub,'crm','crm.create_task','Create follow-up task','', '{"subject":"Call warm leads"}',0,'EUR');
  if (c->>'existing')::boolean and (c->>'action_id')::uuid=a1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' create_idempotent'; end if;
  select count(*) into n from public.external_actions where id=a1 and stage='draft' and goal_id=g and project_id=pj and simulated and required_level='execute';
  if n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' draft_links'; end if;
  -- direct writes are refused
  begin insert into public.external_actions(org_id,workspace_id,request_key,task_id,connection_id,provider,simulated,specialist_key,action_type,required_level,title,created_by)
    values(o,w,gen_random_uuid(),t1,hub,'sim.hubspot',true,'crm','crm.create_task','execute','x',um); fail:=fail+1; failures:=failures||' direct_insert'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin update public.external_actions set stage='approved' where id=a1; fail:=fail+1; failures:=failures||' direct_stage'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  -- no execution before approval, and none without server proof
  begin perform public.begin_external_action_verified(a1,k1,pf); fail:=fail+1; failures:=failures||' exec_draft'; exception when others then if sqlerrm='gate:not_approved' then pass:=pass+1; else fail:=fail+1; failures:=failures||' exec_draft_msg '||sqlerrm; end if; end;
  perform public.submit_external_action(a1);
  select stage into st from public.external_actions where id=a1;
  if st='in_review' then pass:=pass+1; else fail:=fail+1; failures:=failures||' submit '||st; end if;
  begin perform public.decide_external_action(a1,true,''); fail:=fail+1; failures:=failures||' member_approve'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.begin_external_action_verified(a1,k1,pf); fail:=fail+1; failures:=failures||' exec_in_review'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub',uv,'role','authenticated')::text, true); execute 'set local role authenticated';
  select count(*) into n from public.external_actions where workspace_id=w; if n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer_reads'; end if;
  begin perform public.create_external_action(w,gen_random_uuid(),t1,hub,'crm','crm.create_task','x','', '{"subject":"Call"}',null,null); fail:=fail+1; failures:=failures||' viewer_create'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.cancel_external_action(a1); fail:=fail+1; failures:=failures||' viewer_cancel'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',ux,'role','authenticated')::text, true); execute 'set local role authenticated';
  select count(*) into n from public.external_actions where workspace_id=w; if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_reads'; end if;
  select count(*) into n from public.connector_connections where workspace_id=w; if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_connections'; end if;
  begin perform public.decide_external_action(a1,true,''); fail:=fail+1; failures:=failures||' outsider_decide'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.begin_external_action_verified(a1,k1,pf); fail:=fail+1; failures:=failures||' outsider_exec'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub',uo,'role','authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.decide_external_action(a1,false,' '); fail:=fail+1; failures:=failures||' reject_without_reason'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  perform public.decide_external_action(a1,true,'Fine');
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub',um,'role','authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.begin_external_action_verified(a1,k1,'forged'); fail:=fail+1; failures:=failures||' forged_proof'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';
  -- gates: level withdrawn, token expired, workspace paused
  perform set_config('request.jwt.claims', json_build_object('sub',uo,'role','authenticated')::text, true); execute 'set local role authenticated';
  perform public.set_integration_levels(hub,array['read','draft']);
  begin perform public.begin_external_action_verified(a1,k1,pf); fail:=fail+1; failures:=failures||' level_gate'; exception when others then if sqlerrm='gate:level_not_granted' then pass:=pass+1; else fail:=fail+1; failures:=failures||' level_gate_msg '||sqlerrm; end if; end;
  perform public.set_integration_levels(hub,array['read','draft','modify','execute']);
  perform public.set_simulated_integration_health(hub,'expired');
  begin perform public.begin_external_action_verified(a1,k1,pf); fail:=fail+1; failures:=failures||' expired_gate'; exception when others then if sqlerrm='gate:expired' then pass:=pass+1; else fail:=fail+1; failures:=failures||' expired_msg '||sqlerrm; end if; end;
  perform public.set_simulated_integration_health(hub,'connected');
  perform public.set_execution_paused(w,true,'check');
  begin perform public.begin_external_action_verified(a1,k1,pf); fail:=fail+1; failures:=failures||' paused_gate'; exception when others then if sqlerrm='gate:paused' then pass:=pass+1; else fail:=fail+1; failures:=failures||' paused_msg '||sqlerrm; end if; end;
  perform public.set_execution_paused(w,false,'');
  execute 'reset role';

  -- success path: one execution, provider idempotency, executed needs a reference, verification by lookup
  perform set_config('request.jwt.claims', json_build_object('sub',um,'role','authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.sim_provider_write_verified(hub,gen_random_uuid(),'crm.create_task','open','{}',pf); fail:=fail+1; failures:=failures||' write_without_execution'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  r := public.begin_external_action_verified(a1,k1,pf);
  if r->>'stage'='executing' and (r->>'attempt')::int=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' begin '||r::text; end if;
  r := public.begin_external_action_verified(a1,k1,pf);
  if (r->>'existing')::boolean then pass:=pass+1; else fail:=fail+1; failures:=failures||' begin_idempotent'; end if;
  begin perform public.begin_external_action_verified(a1,gen_random_uuid(),pf); fail:=fail+1; failures:=failures||' second_execution'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  r := public.sim_provider_write_verified(hub,k1,'crm.create_task','open','{"subject":"Call warm leads"}',pf); ref := r->>'external_ref';
  r := public.sim_provider_write_verified(hub,k1,'crm.create_task','open','{}',pf);
  if (r->>'existing')::boolean and r->>'external_ref'=ref then pass:=pass+1; else fail:=fail+1; failures:=failures||' provider_idempotent'; end if;
  select count(*) into n from public.simulated_provider_records where connection_id=hub; if n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' one_record'; end if;
  begin perform public.finish_external_action_verified(a1,k1,'executed','',null,null,pf); fail:=fail+1; failures:=failures||' executed_without_ref'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  r := public.finish_external_action_verified(a1,k1,'executed',ref,null,null,pf);
  if r->>'stage'='executed' and r->>'verification'='pending' then pass:=pass+1; else fail:=fail+1; failures:=failures||' finish '||r::text; end if;
  begin perform public.finish_external_action_verified(a1,k1,'failed','',null,null,pf); fail:=fail+1; failures:=failures||' finish_twice'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.cancel_external_action(a1); fail:=fail+1; failures:=failures||' cancel_executed'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  r := public.sim_provider_lookup_verified(hub,k1,pf);
  r := public.record_external_verification_verified(a1,'verified',true,ref,jsonb_build_object('external_ref',r->>'external_ref','state',r->>'state'),pf);
  if r->>'verification'='verified' then pass:=pass+1; else fail:=fail+1; failures:=failures||' verify '||r::text; end if;

  -- timeout after the provider wrote: uncertain, no retry, verification finds it
  c := public.create_external_action(w,gen_random_uuid(),t1,hub,'crm','crm.update_deal','Move deal','', '{"deal":"D-1","change":"stage=proposal"}',null,null); a2 := (c->>'action_id')::uuid;
  perform public.submit_external_action(a2);
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',uo,'role','authenticated')::text, true); execute 'set local role authenticated';
  perform public.decide_external_action(a2,true,'');
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',um,'role','authenticated')::text, true); execute 'set local role authenticated';
  k := gen_random_uuid(); perform public.begin_external_action_verified(a2,k,pf);
  perform public.sim_provider_write_verified(hub,k,'crm.update_deal','updated','{}',pf);
  perform public.finish_external_action_verified(a2,k,'uncertain',null,'Timed out',null,pf);
  begin perform public.begin_external_action_verified(a2,gen_random_uuid(),pf); fail:=fail+1; failures:=failures||' retry_uncertain'; exception when others then if sqlerrm='gate:verify_first' then pass:=pass+1; else fail:=fail+1; failures:=failures||' retry_uncertain_msg '||sqlerrm; end if; end;
  begin perform public.record_external_verification_verified(a2,'unavailable',false,null,'{}',pf); fail:=fail+1; failures:=failures||' uncertain_unavailable'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  r := public.sim_provider_lookup_verified(hub,k,pf);
  r := public.record_external_verification_verified(a2,'verified',(r->>'found')::boolean,r->>'external_ref','{}',pf);
  if r->>'stage'='executed' and r->>'verification'='verified' then pass:=pass+1; else fail:=fail+1; failures:=failures||' uncertain_found '||r::text; end if;

  -- timeout before the provider wrote: verification proves absence, retries up to three attempts
  c := public.create_external_action(w,gen_random_uuid(),t1,hub,'crm','crm.create_task','Retry case','', '{"subject":"Retry"}',null,null); a3 := (c->>'action_id')::uuid;
  perform public.submit_external_action(a3);
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',uo,'role','authenticated')::text, true); execute 'set local role authenticated';
  perform public.decide_external_action(a3,true,'');
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',um,'role','authenticated')::text, true); execute 'set local role authenticated';
  k := gen_random_uuid(); perform public.begin_external_action_verified(a3,k,pf);
  perform public.finish_external_action_verified(a3,k,'uncertain',null,'Timed out',null,pf);
  r := public.sim_provider_lookup_verified(hub,k,pf);
  r := public.record_external_verification_verified(a3,'failed',(r->>'found')::boolean,null,'{}',pf);
  if r->>'stage'='failed' then pass:=pass+1; else fail:=fail+1; failures:=failures||' uncertain_absent '||r::text; end if;
  k := gen_random_uuid(); r := public.begin_external_action_verified(a3,k,pf);
  if (r->>'attempt')::int=2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' retry2'; end if;
  perform public.finish_external_action_verified(a3,k,'failed',null,'Rejected',null,pf);
  k := gen_random_uuid(); perform public.begin_external_action_verified(a3,k,pf);
  perform public.finish_external_action_verified(a3,k,'failed',null,'Permission denied','insufficient_scope',pf);
  begin perform public.begin_external_action_verified(a3,gen_random_uuid(),pf); fail:=fail+1; failures:=failures||' attempts'; exception when others then if sqlerrm='gate:attempts_exhausted' then pass:=pass+1; else fail:=fail+1; failures:=failures||' attempts_msg '||sqlerrm; end if; end;
  select status into st from public.connector_connections where id=hub;
  if st='insufficient_scope' then pass:=pass+1; else fail:=fail+1; failures:=failures||' denial_health '||st; end if;

  -- a stalled attempt becomes uncertain only after 10 minutes
  c := public.create_external_action(w,gen_random_uuid(),t1,hub,'crm','crm.create_task','Stall case','', '{"subject":"Stall"}',null,null); a2 := (c->>'action_id')::uuid;
  execute 'reset role';
  update public.connector_connections set status='connected' where id=hub;
  update public.external_actions set stage='approved', approval_mode='manual' where id=a2;
  perform set_config('request.jwt.claims', json_build_object('sub',um,'role','authenticated')::text, true); execute 'set local role authenticated';
  perform public.begin_external_action_verified(a2,gen_random_uuid(),pf);
  begin perform public.mark_stalled_external_action(a2); fail:=fail+1; failures:=failures||' stall_too_early'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';
  update public.external_actions set updated_at=now()-interval '11 minutes' where id=a2;
  perform set_config('request.jwt.claims', json_build_object('sub',um,'role','authenticated')::text, true); execute 'set local role authenticated';
  r := public.mark_stalled_external_action(a2);
  if r->>'stage'='uncertain' then pass:=pass+1; else fail:=fail+1; failures:=failures||' stall '||r::text; end if;
  -- approval is never skipped: draft level auto-approves only in mode 4; publish level always waits
  c := public.create_external_action(w,gen_random_uuid(),tc,wp,'content','content.save_draft','Save blog draft','', '{"title":"T","body":"B"}',null,null); a4 := (c->>'action_id')::uuid;
  r := public.submit_external_action(a4);
  if r->>'stage'='in_review' then pass:=pass+1; else fail:=fail+1; failures:=failures||' draft_mode2 '||r::text; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',uo,'role','authenticated')::text, true); execute 'set local role authenticated';
  perform public.set_execution_settings(w,4,20,200);
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',um,'role','authenticated')::text, true); execute 'set local role authenticated';
  c := public.create_external_action(w,gen_random_uuid(),tc,wp,'content','content.save_draft','Save draft 2','', '{"title":"T","body":"B"}',null,null); a5 := (c->>'action_id')::uuid;
  r := public.submit_external_action(a5);
  if r->>'stage'='approved' and r->>'approval_mode'='policy' then pass:=pass+1; else fail:=fail+1; failures:=failures||' draft_policy '||r::text; end if;
  c := public.create_external_action(w,gen_random_uuid(),tc,wp,'content','content.publish','Publish','', '{"title":"T","body":"B"}',null,null); a6 := (c->>'action_id')::uuid;
  r := public.submit_external_action(a6);
  if r->>'stage'='in_review' then pass:=pass+1; else fail:=fail+1; failures:=failures||' publish_waits '||r::text; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',uo,'role','authenticated')::text, true); execute 'set local role authenticated';
  perform public.decide_external_action(a6,true,'');
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',um,'role','authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.begin_external_action_verified(a6,gen_random_uuid(),pf); fail:=fail+1; failures:=failures||' member_publish'; exception when others then if sqlerrm='gate:admin_required' then pass:=pass+1; else fail:=fail+1; failures:=failures||' member_publish_msg '||sqlerrm; end if; end;
  execute 'reset role';

  -- real connections are refused at execution even with write levels and approval
  insert into public.external_actions(org_id,workspace_id,request_key,task_id,connection_id,provider,simulated,specialist_key,action_type,required_level,title,stage,approval_mode,created_by)
    values(o,w,gen_random_uuid(),t1,real,'hubspot',false,'crm','crm.create_task','execute','Real',  'approved','manual',um) returning id into ar;
  perform set_config('request.jwt.claims', json_build_object('sub',uo,'role','authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.begin_external_action_verified(ar,gen_random_uuid(),pf); fail:=fail+1; failures:=failures||' real_exec'; exception when others then if sqlerrm='gate:real_execution_disabled' then pass:=pass+1; else fail:=fail+1; failures:=failures||' real_exec_msg '||sqlerrm; end if; end;
  -- revoke removes all permissions; approved work cannot run
  perform public.revoke_simulated_integration(wp);
  select status||':'||cardinality(granted_levels) into st from public.connector_connections where id=wp;
  if st='disabled:0' then pass:=pass+1; else fail:=fail+1; failures:=failures||' revoke '||st; end if;
  begin perform public.begin_external_action_verified(a5,gen_random_uuid(),pf); fail:=fail+1; failures:=failures||' revoked_exec'; exception when others then if sqlerrm='gate:disconnected' then pass:=pass+1; else fail:=fail+1; failures:=failures||' revoked_msg '||sqlerrm; end if; end;
  begin perform public.set_integration_levels(wp,array['read']); fail:=fail+1; failures:=failures||' levels_on_revoked'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  perform public.cancel_external_action(a4);
  execute 'reset role';

  -- audit history
  select count(*) into n from public.activity_events where entity_type='external_actions' and entity_id=a1;
  if n>=6 then pass:=pass+1; else fail:=fail+1; failures:=failures||' history '||n; end if;
  select count(*) into n from public.audit_logs where org_id=o and action in ('integration.simulated_connected','integration.permissions_changed','connector.health_changed','connector.disconnected');
  if n>=6 then pass:=pass+1; else fail:=fail+1; failures:=failures||' audit '||n; end if;
  -- the real-data import path rejects simulated connections
  perform set_config('request.jwt.claims', json_build_object('sub',uo,'role','authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.store_connector_credential_verified(w,'sim.hubspot','abcdefghijklmnop','{}',null,null,'{}',pf); fail:=fail+1; failures:=failures||' sim_credential'; exception when others then if sqlerrm='Unknown read-only connector' then pass:=pass+1; else fail:=fail+1; failures:=failures||' sim_credential_msg '||sqlerrm; end if; end;
  execute 'reset role';

  raise exception 'INTEGRATION_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
