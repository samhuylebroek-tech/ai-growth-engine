-- Assertions for docs/proposals/0081 (rolled back): second reviews need server proof, a different specialist, a paid
-- request of the caller and at least six assessed dimensions; the database computes score and verdict and flags an
-- uncritical review; important results need a review before acceptance, unreliable ones cannot be plainly accepted;
-- only editors decide, once; history is insert-only and invisible outside the business.
do $$
declare
  uo uuid := gen_random_uuid(); ue uuid := gen_random_uuid(); um uuid := gen_random_uuid(); uv uuid := gen_random_uuid(); ux uuid := gen_random_uuid();
  o uuid; o2 uuid; w uuid; t1 uuid; t2 uuid; t3 uuid; r1 uuid; r2 uuid; r3 uuid; r4 uuid; ar uuid; sm uuid; se uuid; k uuid := gen_random_uuid(); j jsonb; n int; b boolean;
  pass int := 0; fail int := 0; failures text := '';
  good jsonb := '{"summary":"Solid plan","dimensions":{"completeness":{"score":4,"note":"ok"},"relevance":{"score":4},"evidence":{"score":3,"note":"two claims unsourced"},"calculations":{"score":5},"consistency":{"score":4},"feasibility":{"score":4},"permissions":{"score":null}},"findings":[{"dimension":"evidence","severity":"warning","finding":"Repeat rate is assumed","correction":"Mark it as an assumption"}]}';
  stamp jsonb := '{"dimensions":{"completeness":{"score":5},"relevance":{"score":5},"evidence":{"score":5},"calculations":{"score":5},"consistency":{"score":5},"feasibility":{"score":5}},"findings":[]}';
  bad jsonb := '{"dimensions":{"completeness":{"score":3},"relevance":{"score":3},"evidence":{"score":2},"calculations":{"score":1},"consistency":{"score":3},"feasibility":{"score":3}},"findings":[{"dimension":"calculations","severity":"critical","finding":"Margin uses revenue twice"},{"dimension":"evidence","severity":"critical","finding":"Invented customer count"}]}';
begin
  execute $t$CREATE FUNCTION pg_temp.su(_u uuid) RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; PERFORM set_config('request.jwt.claims', json_build_object('sub',_u,'role','authenticated')::text, true); SET LOCAL ROLE authenticated; END $b$ $t$;
  execute $t$CREATE FUNCTION pg_temp.root() RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; END $b$ $t$;
  execute $t$CREATE OR REPLACE FUNCTION public.verify_ai_accounting(_proof text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $b$ BEGIN IF _proof IS DISTINCT FROM 'rollback-fixture-only' THEN RAISE EXCEPTION 'server accounting verification required'; END IF; END $b$ $t$;
  insert into auth.users(id,email,aud,role,instance_id) values
    (uo,'qc-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ue,'qc-editor@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (um,'qc-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (uv,'qc-viewer@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ux,'qc-outsider@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  perform pg_temp.su(uo); o := public.create_organization('QC fixture','Bakery'); select id into w from public.workspaces where org_id=o;
  perform pg_temp.su(ux); o2 := public.create_organization('Other','Shop');
  perform pg_temp.root();
  insert into public.organization_members(org_id,user_id,role) values(o,ue,'editor'),(o,um,'member'),(o,uv,'viewer');
  insert into public.workspace_members(workspace_id,user_id,role) values(w,ue,'editor'),(w,um,'member'),(w,uv,'viewer');
  perform pg_temp.su(uo);
  insert into public.tasks(org_id,workspace_id,title,priority,created_by) values(o,w,'Blog draft','medium',uo) returning id into t1;
  insert into public.tasks(org_id,workspace_id,title,priority,created_by) values(o,w,'Launch plan','high',uo) returning id into t2;
  insert into public.tasks(org_id,workspace_id,title,priority,created_by) values(o,w,'Margin check','medium',uo) returning id into t3;
  perform pg_temp.root();
  insert into public.task_runs(org_id,workspace_id,task_id,request_key,specialist_key,task_type,mode,attempt,status,estimated_credits,requested_by,output)
    values(o,w,t1,gen_random_uuid(),'content','preparation',2,1,'succeeded',3,um,'{"title":"x","external_actions":[]}') returning id into r1;
  insert into public.task_runs(org_id,workspace_id,task_id,request_key,specialist_key,task_type,mode,attempt,status,estimated_credits,requested_by,output)
    values(o,w,t2,gen_random_uuid(),'marketing','analysis',2,1,'succeeded',3,um,'{"title":"x"}') returning id into r2;
  insert into public.task_runs(org_id,workspace_id,task_id,request_key,specialist_key,task_type,mode,attempt,status,estimated_credits,requested_by)
    values(o,w,t1,gen_random_uuid(),'content','preparation',2,2,'failed',3,um) returning id into r3;
  insert into public.task_runs(org_id,workspace_id,task_id,request_key,specialist_key,task_type,mode,attempt,status,estimated_credits,requested_by,output)
    values(o,w,t3,gen_random_uuid(),'revenue_analyst','analysis',2,1,'succeeded',3,um,'{"title":"x"}') returning id into r4;
  insert into public.agent_runs(org_id,workspace_id,user_id,agent_key,status) values(o,w,um,'business_analyst','succeeded') returning id into ar;
  insert into public.single_ai_requests(org_id,workspace_id,user_id,request_key,kind,input,run_id,status,reply,credits)
    values(o,w,um,gen_random_uuid(),'research','{"request":"review"}',ar,'succeeded','{}',4) returning id into sm;
  insert into public.agent_runs(org_id,workspace_id,user_id,agent_key,status) values(o,w,ue,'business_analyst','succeeded') returning id into ar;
  insert into public.single_ai_requests(org_id,workspace_id,user_id,request_key,kind,input,run_id,status,reply,credits)
    values(o,w,ue,gen_random_uuid(),'research','{"request":"review"}',ar,'succeeded','{}',4) returning id into se;

  perform pg_temp.su(um);
  begin perform public.record_specialist_review_verified(r1, gen_random_uuid(), 'business_analyst', sm, good, 'forged'); fail:=fail+1; failures:=failures||' forged'; exception when others then pass:=pass+1; end;
  begin perform public.record_specialist_review_verified(r1, gen_random_uuid(), 'content', sm, good, 'rollback-fixture-only'); fail:=fail+1; failures:=failures||' same_specialist';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' same:'||sqlstate; end if; end;
  begin perform public.record_specialist_review_verified(r3, gen_random_uuid(), 'business_analyst', sm, good, 'rollback-fixture-only'); fail:=fail+1; failures:=failures||' failed_run';
    exception when others then if sqlstate='55000' then pass:=pass+1; else fail:=fail+1; failures:=failures||' failed_run:'||sqlstate; end if; end;
  begin perform public.record_specialist_review_verified(r1, gen_random_uuid(), 'business_analyst', sm, '{"dimensions":{"completeness":{"score":4},"relevance":{"score":4}}}', 'rollback-fixture-only'); fail:=fail+1; failures:=failures||' too_few';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' too_few:'||sqlstate; end if; end;
  begin perform public.record_specialist_review_verified(r1, gen_random_uuid(), 'business_analyst', se, good, 'rollback-fixture-only'); fail:=fail+1; failures:=failures||' foreign_request';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' foreign_req:'||sqlstate; end if; end;
  j := public.record_specialist_review_verified(r1, k, 'business_analyst', sm, good, 'rollback-fixture-only');
  if (j->>'score')::int = 75 and j->>'verdict' = 'acceptable' and (j->>'assessed')::int = 6 and not (j->>'independence_warning')::boolean then pass:=pass+1; else fail:=fail+1; failures:=failures||' good:'||j::text; end if;
  j := public.record_specialist_review_verified(r1, k, 'business_analyst', sm, stamp, 'rollback-fixture-only');
  if j->>'status' = 'existing' and (j->>'score')::int = 75 then pass:=pass+1; else fail:=fail+1; failures:=failures||' idem'; end if;
  j := public.record_specialist_review_verified(r1, gen_random_uuid(), 'copywriter', sm, stamp, 'rollback-fixture-only');
  if (j->>'independence_warning')::boolean and j->>'verdict' = 'needs_changes' and (j->>'score')::int = 100 then pass:=pass+1; else fail:=fail+1; failures:=failures||' stamp:'||j::text; end if;
  j := public.record_specialist_review_verified(r4, gen_random_uuid(), 'business_analyst', sm, bad, 'rollback-fixture-only');
  if j->>'verdict' = 'unreliable' and (j->>'critical')::int = 2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' bad:'||j::text; end if;
  -- important results
  if not public.specialist_review_required(r1) and public.specialist_review_required(r2) and public.specialist_review_required(r4) then pass:=pass+1; else fail:=fail+1; failures:=failures||' required'; end if;
  -- decisions
  begin perform public.decide_specialist_result(r1,'accepted','',''); fail:=fail+1; failures:=failures||' member_decides';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' member_decides:'||sqlstate; end if; end;
  perform pg_temp.su(uv);
  begin perform public.decide_specialist_result(r1,'accepted','',''); fail:=fail+1; failures:=failures||' viewer_decides'; exception when others then pass:=pass+1; end;
  perform pg_temp.su(ue);
  begin perform public.decide_specialist_result(r2,'accepted','',''); fail:=fail+1; failures:=failures||' important_unreviewed';
    exception when others then if sqlstate='55000' then pass:=pass+1; else fail:=fail+1; failures:=failures||' important:'||sqlstate; end if; end;
  j := public.decide_specialist_result(r2,'needs_rework','Needs real launch dates','');
  if j->>'decision' = 'needs_rework' and (j->>'review_required')::boolean then pass:=pass+1; else fail:=fail+1; failures:=failures||' rework'; end if;
  begin perform public.decide_specialist_result(r4,'accepted','',''); fail:=fail+1; failures:=failures||' unreliable_accept';
    exception when others then if sqlstate='55000' then pass:=pass+1; else fail:=fail+1; failures:=failures||' unreliable:'||sqlstate; end if; end;
  begin perform public.decide_specialist_result(r4,'accepted_with_corrections','',''); fail:=fail+1; failures:=failures||' no_corrections';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' no_corr:'||sqlstate; end if; end;
  j := public.decide_specialist_result(r4,'accepted_with_corrections','','Recompute margin on net revenue; drop the customer count');
  if j->>'decision' = 'accepted_with_corrections' and j->>'review_id' is not null then pass:=pass+1; else fail:=fail+1; failures:=failures||' with_corr'; end if;
  begin perform public.decide_specialist_result(r4,'rejected','again',''); fail:=fail+1; failures:=failures||' second_decision';
    exception when others then if sqlstate='55000' then pass:=pass+1; else fail:=fail+1; failures:=failures||' second:'||sqlstate; end if; end;
  begin perform public.decide_specialist_result(r1,'rejected','',''); fail:=fail+1; failures:=failures||' reject_no_reason';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' reject_reason:'||sqlstate; end if; end;
  j := public.decide_specialist_result(r1,'accepted','Looks good','');
  if j->>'decision' = 'accepted' and not (j->>'review_required')::boolean then pass:=pass+1; else fail:=fail+1; failures:=failures||' accept_simple'; end if;
  -- insert-only, no direct writes
  begin update public.specialist_reviews set score=100 where task_run_id=r4; fail:=fail+1; failures:=failures||' review_update'; exception when others then pass:=pass+1; end;
  begin delete from public.specialist_result_decisions where task_run_id=r1; fail:=fail+1; failures:=failures||' decision_delete'; exception when others then pass:=pass+1; end;
  begin insert into public.specialist_result_decisions(org_id,workspace_id,task_run_id,decision,review_required) values(o,w,r3,'accepted',false); fail:=fail+1; failures:=failures||' direct_insert'; exception when others then pass:=pass+1; end;
  -- outsider sees nothing and cannot act
  perform pg_temp.su(ux);
  select count(*) into n from public.specialist_reviews where workspace_id=w; if n = 0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_reads'; end if;
  begin perform public.decide_specialist_result(r3,'rejected','x',''); fail:=fail+1; failures:=failures||' outsider_decides'; exception when others then pass:=pass+1; end;
  b := public.specialist_review_required(r2); if not b then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_required_leak'; end if;
  RESET ROLE;
  raise exception 'SPECIALIST_QC_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
