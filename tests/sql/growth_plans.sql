-- Growth Plan lifecycle end to end: strategy -> draft plan -> admin approval -> initiative work ->
-- operations -> budget link -> new version supersedes. Covers roles and tenant isolation.
-- Always raises at the end, so every change rolls back. Output: 'GROWTH_PLAN_RESULT pass=N fail=M ...'.
do $$
declare
  ua uuid := gen_random_uuid(); um uuid := gen_random_uuid(); uv uuid := gen_random_uuid(); ub uuid := gen_random_uuid();
  oa uuid; ob uuid; wa uuid; wb uuid; ga uuid; ga2 uuid; s1 uuid; s2 uuid; p1 uuid; p2 uuid; i1 uuid; i2 uuid; i_other uuid; proj uuid;
  r jsonb; r2 jsonb; n int; txt text; pass int := 0; fail int := 0; failures text := '';
begin
  insert into auth.users(id,email,aud,role,instance_id) values
    (ua,'gp-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (um,'gp-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (uv,'gp-viewer@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ub,'gp-outsider@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');

  -- Owner sets up org A, a goal and a saved two-action strategy.
  perform set_config('request.jwt.claims', json_build_object('sub',ua,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  oa := public.create_organization('GP A','WS A'); select id into wa from public.workspaces where org_id=oa;
  insert into public.growth_goals(org_id,workspace_id,title) values(oa,wa,'Grow revenue') returning id into ga;
  insert into public.growth_goals(org_id,workspace_id,title) values(oa,wa,'Other goal') returning id into ga2;
  insert into public.growth_strategies(org_id,workspace_id,goal_id,request_key,summary,body) values(oa,wa,ga,gen_random_uuid(),'Plan one',
    '{"summary":"Thesis one","actions":[{"title":"Fix SEO basics","detail":"d","channel":"seo","week":2,"effort":"high"},{"title":"Partner outreach"}]}') returning id into s1;
  execute 'reset role';
  insert into public.organization_members(org_id,user_id,role) values(oa,um,'member'),(oa,uv,'viewer');
  insert into public.workspace_members(workspace_id,user_id,role) values(wa,um,'member'),(wa,uv,'viewer');

  -- Outsider owns org B.
  perform set_config('request.jwt.claims', json_build_object('sub',ub,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  ob := public.create_organization('GP B','WS B'); select id into wb from public.workspaces where org_id=ob;
  begin perform public.create_growth_plan_draft(s1); fail:=fail+1; failures:=failures||' outsider_drafts'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';

  -- Viewer cannot create a draft.
  perform set_config('request.jwt.claims', json_build_object('sub',uv,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.create_growth_plan_draft(s1); fail:=fail+1; failures:=failures||' viewer_drafts'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';

  -- Member creates the draft; retry is idempotent.
  perform set_config('request.jwt.claims', json_build_object('sub',um,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  r := public.create_growth_plan_draft(s1); p1 := (r->>'plan_id')::uuid;
  if r->>'status'='draft' and (r->>'version')::int=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' draft_v1'; end if;
  r2 := public.create_growth_plan_draft(s1);
  if (r2->>'plan_id')::uuid = p1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' draft_idempotent'; end if;
  select count(*) into n from public.growth_initiatives where plan_version_id=p1; if n=2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' initiatives_created'; end if;
  select id into i1 from public.growth_initiatives where plan_version_id=p1 and sort_order=0;
  select id into i2 from public.growth_initiatives where plan_version_id=p1 and sort_order=1;
  select effort||'/'||channel||'/'||target_week into txt from public.growth_initiatives where id=i1;
  if txt='high/seo/2' then pass:=pass+1; else fail:=fail+1; failures:=failures||' initiative_fields'; end if;
  -- Drafts are not executable.
  begin perform public.approve_growth_plan(p1); fail:=fail+1; failures:=failures||' member_approves'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.create_growth_initiative_work(i1); fail:=fail+1; failures:=failures||' draft_to_work'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.update_growth_initiative_operations(i1,'{"success_metric":"x"}'); fail:=fail+1; failures:=failures||' draft_operations'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin insert into public.budget_lines(org_id,workspace_id,channel,period_month,planned,goal_id,initiative_id) values(oa,wa,'seo','2026-12-01',100,ga,i1); fail:=fail+1; failures:=failures||' draft_budget_link'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  -- No direct writes to plans or initiatives.
  begin update public.growth_plan_versions set title='hacked' where id=p1; get diagnostics n=row_count; if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' direct_plan_update'; end if; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin insert into public.growth_initiatives(org_id,workspace_id,plan_version_id,goal_id,sort_order,title) values(oa,wa,p1,ga,9,'x'); fail:=fail+1; failures:=failures||' direct_initiative_insert'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';

  -- Owner (workspace admin) approves; repeat approval is idempotent.
  perform set_config('request.jwt.claims', json_build_object('sub',ua,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  r := public.approve_growth_plan(p1);
  if r->>'status'='approved' then pass:=pass+1; else fail:=fail+1; failures:=failures||' approve'; end if;
  r := public.approve_growth_plan(p1);
  if r->>'status'='approved' then pass:=pass+1; else fail:=fail+1; failures:=failures||' approve_repeat'; end if;
  execute 'reset role';

  -- Member turns an approved initiative into work exactly once.
  perform set_config('request.jwt.claims', json_build_object('sub',um,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  r := public.create_growth_initiative_work(i1); proj := (r->>'project_id')::uuid;
  if r->>'status'='created' and proj is not null then pass:=pass+1; else fail:=fail+1; failures:=failures||' work_created'; end if;
  r := public.create_growth_initiative_work(i1);
  if (r->>'project_id')::uuid = proj then pass:=pass+1; else fail:=fail+1; failures:=failures||' work_idempotent'; end if;
  select count(*) into n from public.projects where workspace_id=wa and goal_id=ga; if n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' one_project'; end if;
  select count(*) into n from public.tasks where project_id=proj; if n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' one_task'; end if;
  select status into txt from public.growth_initiatives where id=i1; if txt='in_progress' then pass:=pass+1; else fail:=fail+1; failures:=failures||' initiative_in_progress'; end if;
  -- Operations: allowed fields only, owners must have workspace access.
  r := public.update_growth_initiative_operations(i1,'{"success_metric":"Qualified leads","baseline_value":10,"target_value":30,"current_value":12}');
  if r->>'success_metric'='Qualified leads' then pass:=pass+1; else fail:=fail+1; failures:=failures||' operations_update'; end if;
  begin perform public.update_growth_initiative_operations(i1,'{"title":"renamed"}'); fail:=fail+1; failures:=failures||' operations_bad_key'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.update_growth_initiative_operations(i1,jsonb_build_object('owner_id',ub)); fail:=fail+1; failures:=failures||' operations_outsider_owner'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.update_growth_initiative_operations(i1,'{"status":"done"}'); fail:=fail+1; failures:=failures||' operations_bad_status'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  -- Budget can attach to the approved initiative of the same goal only.
  -- Since proposal 0068 budgets need a business editor or above; a member is refused.
  begin insert into public.budget_lines(org_id,workspace_id,channel,period_month,planned,goal_id,initiative_id) values(oa,wa,'seo','2026-12-01',100,ga,i1); fail:=fail+1; failures:=failures||' member_budget_since_0068'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub',ua,'role','authenticated')::text, true); execute 'set local role authenticated';
  insert into public.budget_lines(org_id,workspace_id,channel,period_month,planned,goal_id,initiative_id) values(oa,wa,'seo','2026-12-01',100,ga,i1); pass:=pass+1;
  begin insert into public.budget_lines(org_id,workspace_id,channel,period_month,planned,goal_id,initiative_id) values(oa,wa,'seo','2026-12-01',100,ga2,i1); fail:=fail+1; failures:=failures||' budget_wrong_goal'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub',um,'role','authenticated')::text, true); execute 'set local role authenticated';
  -- Second strategy -> version 2 draft.
  insert into public.growth_strategies(org_id,workspace_id,goal_id,request_key,summary,body) values(oa,wa,ga,gen_random_uuid(),'Plan two','{"actions":[{"title":"Webinar series"}]}') returning id into s2;
  r := public.create_growth_plan_draft(s2); p2 := (r->>'plan_id')::uuid;
  if (r->>'version')::int=2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' draft_v2'; end if;
  execute 'reset role';

  -- Viewer reads but cannot act.
  perform set_config('request.jwt.claims', json_build_object('sub',uv,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.growth_plan_versions where workspace_id=wa; if n=2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer_reads'; end if;
  begin perform public.create_growth_initiative_work(i2); fail:=fail+1; failures:=failures||' viewer_work'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.update_growth_initiative_operations(i1,'{"blocker_note":"x"}'); fail:=fail+1; failures:=failures||' viewer_operations'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';

  -- Outsider sees nothing and cannot act.
  perform set_config('request.jwt.claims', json_build_object('sub',ub,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.growth_plan_versions where workspace_id=wa; if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_reads_plans'; end if;
  select count(*) into n from public.growth_initiatives where workspace_id=wa; if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_reads_initiatives'; end if;
  select count(*) into n from public.growth_initiative_operations where workspace_id=wa; if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_reads_operations'; end if;
  begin perform public.approve_growth_plan(p2); fail:=fail+1; failures:=failures||' outsider_approves'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.create_growth_initiative_work(i2); fail:=fail+1; failures:=failures||' outsider_work'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.update_growth_initiative_operations(i1,'{"blocker_note":"x"}'); fail:=fail+1; failures:=failures||' outsider_operations'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin insert into public.budget_lines(org_id,workspace_id,channel,period_month,planned,goal_id,initiative_id) values(ob,wb,'seo','2026-12-01',1,null,i1); fail:=fail+1; failures:=failures||' outsider_budget_link'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';

  -- Approving v2 supersedes v1; v1 becomes frozen.
  perform set_config('request.jwt.claims', json_build_object('sub',ua,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.approve_growth_plan(p2);
  select status into txt from public.growth_plan_versions where id=p1; if txt='superseded' then pass:=pass+1; else fail:=fail+1; failures:=failures||' v1_superseded'; end if;
  select count(*) into n from public.growth_plan_versions where goal_id=ga and status='approved'; if n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' one_approved'; end if;
  begin perform public.approve_growth_plan(p1); fail:=fail+1; failures:=failures||' reapprove_superseded'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.create_growth_initiative_work(i2); fail:=fail+1; failures:=failures||' superseded_work'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.update_growth_initiative_operations(i1,'{"current_value":20}'); fail:=fail+1; failures:=failures||' superseded_operations'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';

  -- Anonymous callers have no access to plan RPCs.
  if not has_function_privilege('anon','public.create_growth_plan_draft(uuid)','execute')
     and not has_function_privilege('anon','public.approve_growth_plan(uuid)','execute')
     and not has_function_privilege('anon','public.create_growth_initiative_work(uuid)','execute')
     and not has_function_privilege('anon','public.update_growth_initiative_operations(uuid,jsonb)','execute')
  then pass:=pass+1; else fail:=fail+1; failures:=failures||' anon_rpc'; end if;

  raise exception 'GROWTH_PLAN_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
