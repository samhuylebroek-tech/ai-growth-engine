-- Assertions for docs/proposals/0082 (rolled back): an AI re-planning analysis needs server proof and the caller's
-- paid analysis request for exactly that proposal; it may only recommend the proposal's own options, name tasks of
-- the same business and suggest known further ideas; it never changes the task, is insert-only, readable only in
-- the business, and refused once the proposal is decided. Second reviews are bound to their own paid request and
-- keep its credits.
do $$
declare
  uo uuid := gen_random_uuid(); ue uuid := gen_random_uuid(); um uuid := gen_random_uuid(); uv uuid := gen_random_uuid(); ux uuid := gen_random_uuid();
  o uuid; o2 uuid; w uuid; w2 uuid; t1 uuid; t2 uuid; tx uuid; p uuid; ar uuid; q1 uuid; q2 uuid; qb uuid; qr uuid; r1 uuid;
  k1 uuid := gen_random_uuid(); k2 uuid := gen_random_uuid(); kr uuid := gen_random_uuid(); j jsonb; n int; d date; upd timestamptz;
  pass int := 0; fail int := 0; failures text := '';
  ok jsonb;
  review jsonb := '{"summary":"ok","dimensions":{"completeness":{"score":4},"relevance":{"score":4},"evidence":{"score":3},"consistency":{"score":4},"feasibility":{"score":4},"quality":{"score":4}},"findings":[{"severity":"warning","finding":"One claim unsourced"}]}';
begin
  execute $t$CREATE FUNCTION pg_temp.su(_u uuid) RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; PERFORM set_config('request.jwt.claims', json_build_object('sub',_u,'role','authenticated')::text, true); SET LOCAL ROLE authenticated; END $b$ $t$;
  execute $t$CREATE FUNCTION pg_temp.root() RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; END $b$ $t$;
  execute $t$CREATE OR REPLACE FUNCTION public.verify_ai_accounting(_proof text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $b$ BEGIN IF _proof IS DISTINCT FROM 'rollback-fixture-only' THEN RAISE EXCEPTION 'server accounting verification required'; END IF; END $b$ $t$;
  insert into auth.users(id,email,aud,role,instance_id) values
    (uo,'ra-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ue,'ra-editor@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (um,'ra-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (uv,'ra-viewer@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ux,'ra-outsider@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  perform pg_temp.su(uo); o := public.create_organization('RA fixture','Bakery'); select id into w from public.workspaces where org_id=o;
  perform pg_temp.su(ux); o2 := public.create_organization('Other','Shop'); select id into w2 from public.workspaces where org_id=o2;
  insert into public.tasks(org_id,workspace_id,title,priority,created_by) values(o2,w2,'Foreign','medium',ux) returning id into tx;
  perform pg_temp.root();
  insert into public.organization_members(org_id,user_id,role) values(o,ue,'editor'),(o,um,'member'),(o,uv,'viewer');
  insert into public.workspace_members(workspace_id,user_id,role) values(w,ue,'editor'),(w,um,'member'),(w,uv,'viewer');
  perform pg_temp.su(uo);
  insert into public.tasks(org_id,workspace_id,title,priority,due_date,created_by) values(o,w,'Price list','medium',current_date-2,uo) returning id into t1;
  insert into public.tasks(org_id,workspace_id,title,priority,due_date,created_by) values(o,w,'Launch mail','medium',current_date+1,uo) returning id into t2;
  perform pg_temp.su(um);
  j := public.propose_task_replan(w, gen_random_uuid(), t1, jsonb_build_object('origin','rule','reasons',jsonb_build_array('overdue'),'risk','medium',
    'options', jsonb_build_array(jsonb_build_object('key','a','kind','new_deadline','due_date',current_date+3),
                                 jsonb_build_object('key','b','kind','raise_priority','due_date',current_date+3,'priority','high'))));
  p := (j->>'id')::uuid;
  perform pg_temp.root();
  select due_date, updated_at into d, upd from public.tasks where id=t1;
  insert into public.agent_runs(org_id,workspace_id,user_id,agent_key,status) values(o,w,um,'growth_officer','succeeded') returning id into ar;
  insert into public.single_ai_requests(org_id,workspace_id,user_id,request_key,kind,input,run_id,status,reply,credits)
    values(o,w,um,k1,'strategy',jsonb_build_object('purpose','replan_analysis','proposalId',p),ar,'succeeded','{}',6) returning id into q1;
  insert into public.agent_runs(org_id,workspace_id,user_id,agent_key,status) values(o,w,um,'growth_officer','succeeded') returning id into ar;
  insert into public.single_ai_requests(org_id,workspace_id,user_id,request_key,kind,input,run_id,status,reply,credits)
    values(o,w,um,k2,'strategy',jsonb_build_object('purpose','something_else'),ar,'succeeded','{}',2) returning id into qb;
  ok := jsonb_build_object('cause','The supplier price list never arrived','consequences','The launch mail cannot go out',
    'affected', jsonb_build_array(jsonb_build_object('task_id',t2,'effect','Needs the prices')),
    'options', jsonb_build_array(jsonb_build_object('key','a','assessment','Enough time','risk','low'),jsonb_build_object('key','b','assessment','Pushes others','risk','medium')),
    'recommended','a','why','Least disruption','extra', jsonb_build_array(jsonb_build_object('kind','split','suggestion','Publish known prices first')),
    'risks', jsonb_build_array('Supplier may be late again'),'cost','No extra credits','approval','An editor approves option a','verification','Price list attached by the new date','evidence_gaps', jsonb_build_array());

  perform pg_temp.su(um);
  begin perform public.record_replan_analysis_verified(p, k1, q1, ok, 'forged'); fail:=fail+1; failures:=failures||' forged'; exception when others then pass:=pass+1; end;
  begin perform public.record_replan_analysis_verified(p, k2, qb, ok, 'rollback-fixture-only'); fail:=fail+1; failures:=failures||' unbound';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' unbound:'||sqlstate; end if; end;
  begin perform public.record_replan_analysis_verified(p, k1, q1, ok || '{"recommended":"c"}', 'rollback-fixture-only'); fail:=fail+1; failures:=failures||' foreign_option';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' foreign_option:'||sqlstate; end if; end;
  begin perform public.record_replan_analysis_verified(p, k1, q1, ok || '{"extra":[{"kind":"fire_supplier","suggestion":"x"}]}', 'rollback-fixture-only'); fail:=fail+1; failures:=failures||' extra_kind';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' extra_kind:'||sqlstate; end if; end;
  begin perform public.record_replan_analysis_verified(p, k1, q1, ok || jsonb_build_object('affected', jsonb_build_array(jsonb_build_object('task_id',tx,'effect','x'))), 'rollback-fixture-only'); fail:=fail+1; failures:=failures||' foreign_task';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' foreign_task:'||sqlstate; end if; end;
  begin perform public.record_replan_analysis_verified(p, k1, q1, ok || '{"apply_now":true}', 'rollback-fixture-only'); fail:=fail+1; failures:=failures||' extra_key';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' extra_key:'||sqlstate; end if; end;
  j := public.record_replan_analysis_verified(p, k1, q1, ok, 'rollback-fixture-only');
  if j->>'status'='created' and j->>'recommended'='a' and (j->>'credits')::int=6 and (j->>'task_updated_at')::timestamptz = upd then pass:=pass+1; else fail:=fail+1; failures:=failures||' created:'||j::text; end if;
  j := public.record_replan_analysis_verified(p, k1, q1, ok || '{"recommended":"b"}', 'rollback-fixture-only');
  if j->>'status'='existing' and j->>'recommended'='a' then pass:=pass+1; else fail:=fail+1; failures:=failures||' replay'; end if;
  begin perform public.record_replan_analysis_verified(p, gen_random_uuid(), q1, ok, 'rollback-fixture-only'); fail:=fail+1; failures:=failures||' reuse_request';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' reuse:'||sqlstate; end if; end;
  -- the analysis changes nothing on the task
  select count(*) into n from public.tasks where id=t1 and due_date=d and priority='medium'; if n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' task_changed'; end if;
  -- insert-only and scoped
  begin update public.task_replan_analyses set recommended='b' where proposal_id=p; fail:=fail+1; failures:=failures||' update'; exception when others then pass:=pass+1; end;
  begin delete from public.task_replan_analyses where proposal_id=p; fail:=fail+1; failures:=failures||' delete'; exception when others then pass:=pass+1; end;
  begin insert into public.task_replan_analyses(org_id,workspace_id,proposal_id,task_id,request_key,single_request_id,analysis,recommended,task_updated_at) values(o,w,p,t1,gen_random_uuid(),qb,'{}','a',now()); fail:=fail+1; failures:=failures||' direct_insert'; exception when others then pass:=pass+1; end;
  perform pg_temp.su(uv);
  select count(*) into n from public.task_replan_analyses where proposal_id=p; if n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer_reads'; end if;
  perform pg_temp.su(ux);
  select count(*) into n from public.task_replan_analyses where workspace_id=w; if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_reads'; end if;
  begin perform public.record_replan_analysis_verified(p, gen_random_uuid(), q1, ok, 'rollback-fixture-only'); fail:=fail+1; failures:=failures||' outsider_records'; exception when others then pass:=pass+1; end;
  -- once decided, no new analysis
  perform pg_temp.su(ue);
  perform public.decide_task_replan(p, 'approved', 'a', null, 'Agreed');
  perform pg_temp.root();
  insert into public.agent_runs(org_id,workspace_id,user_id,agent_key,status) values(o,w,um,'growth_officer','succeeded') returning id into ar;
  insert into public.single_ai_requests(org_id,workspace_id,user_id,request_key,kind,input,run_id,status,reply,credits)
    values(o,w,um,kr,'strategy',jsonb_build_object('purpose','replan_analysis','proposalId',p),ar,'succeeded','{}',6) returning id into q2;
  perform pg_temp.su(um);
  begin perform public.record_replan_analysis_verified(p, kr, q2, ok, 'rollback-fixture-only'); fail:=fail+1; failures:=failures||' after_decision';
    exception when others then if sqlstate='55000' then pass:=pass+1; else fail:=fail+1; failures:=failures||' after_decision:'||sqlstate; end if; end;

  -- second reviews: bound to their own request, credits kept
  perform pg_temp.root();
  insert into public.task_runs(org_id,workspace_id,task_id,request_key,specialist_key,task_type,mode,attempt,status,estimated_credits,requested_by,output)
    values(o,w,t2,gen_random_uuid(),'content','preparation',2,1,'succeeded',3,um,'{"title":"x"}') returning id into r1;
  insert into public.agent_runs(org_id,workspace_id,user_id,agent_key,status) values(o,w,um,'business_analyst','succeeded') returning id into ar;
  kr := gen_random_uuid();
  insert into public.single_ai_requests(org_id,workspace_id,user_id,request_key,kind,input,run_id,status,reply,credits)
    values(o,w,um,kr,'research',jsonb_build_object('purpose','specialist_review','taskRunId',r1,'reviewer','business_analyst'),ar,'succeeded','{}',7) returning id into qr;
  perform pg_temp.su(um);
  begin perform public.record_specialist_review_verified(r1, k2, 'business_analyst', qb, review, 'rollback-fixture-only'); fail:=fail+1; failures:=failures||' review_unbound';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' review_unbound:'||sqlstate; end if; end;
  begin perform public.record_specialist_review_verified(r1, kr, 'copywriter', qr, review, 'rollback-fixture-only'); fail:=fail+1; failures:=failures||' review_other_reviewer';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' review_other:'||sqlstate; end if; end;
  j := public.record_specialist_review_verified(r1, kr, 'business_analyst', qr, review, 'rollback-fixture-only');
  if j->>'status'='created' and (j->>'credits')::int = 7 then pass:=pass+1; else fail:=fail+1; failures:=failures||' review_credits:'||j::text; end if;
  begin perform public.record_specialist_review_verified(r1, gen_random_uuid(), 'business_analyst', qr, review, 'rollback-fixture-only'); fail:=fail+1; failures:=failures||' review_reuse';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' review_reuse:'||sqlstate; end if; end;
  RESET ROLE;
  raise exception 'REPLAN_ANALYSIS_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
