-- Assertions for docs/proposals/0062 (rolled back). Growth Plan decisions are made by workspace admins only,
-- need a reason unless approving, apply to drafts only and are permanent.
do $$
declare
  uo uuid := gen_random_uuid(); um uuid := gen_random_uuid(); uv uuid := gen_random_uuid(); ux uuid := gen_random_uuid();
  o uuid; w uuid; g uuid; s1 uuid; s2 uuid; p1 uuid; p2 uuid; r jsonb; n int; st text;
  body jsonb := '{"summary":"Plan","actions":[{"title":"Step one","week":1,"effort":"low"}]}';
  pass int := 0; fail int := 0; failures text := '';
begin
  insert into auth.users(id,email,aud,role,instance_id) values
    (uo,'pd-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (um,'pd-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (uv,'pd-viewer@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ux,'pd-outsider@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  perform set_config('request.jwt.claims', json_build_object('sub',uo,'role','authenticated')::text, true); execute 'set local role authenticated';
  o := public.create_organization('Plan decision fixture','P'); select id into w from public.workspaces where org_id = o;
  execute 'reset role';
  insert into public.organization_members(org_id,user_id,role) values(o,um,'member'),(o,uv,'viewer');
  insert into public.workspace_members(workspace_id,user_id,role) values(w,um,'member'),(w,uv,'viewer');

  -- a member saves two strategies and turns them into two draft versions
  perform set_config('request.jwt.claims', json_build_object('sub',um,'role','authenticated')::text, true); execute 'set local role authenticated';
  insert into public.growth_goals(org_id,workspace_id,title) values(o,w,'Fixture goal') returning id into g;
  insert into public.growth_strategies(org_id,workspace_id,goal_id,request_key,summary,body,created_by) values(o,w,g,gen_random_uuid(),'S1',body,um) returning id into s1;
  insert into public.growth_strategies(org_id,workspace_id,goal_id,request_key,summary,body,created_by) values(o,w,g,gen_random_uuid(),'S2',body,um) returning id into s2;
  p1 := (public.create_growth_plan_draft(s1)->>'plan_id')::uuid; p2 := (public.create_growth_plan_draft(s2)->>'plan_id')::uuid;
  begin perform public.decide_growth_plan(p1,'approved',''); fail:=fail+1; failures:=failures||' member_decided'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin insert into public.growth_plan_decisions(org_id,workspace_id,plan_version_id,decision,note,decided_by) values(o,w,p1,'approved','',um); fail:=fail+1; failures:=failures||' direct_insert';
  exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',uv,'role','authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.decide_growth_plan(p1,'rejected','No thanks'); fail:=fail+1; failures:=failures||' viewer_decided'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',ux,'role','authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.decide_growth_plan(p1,'rejected','No thanks'); fail:=fail+1; failures:=failures||' outsider_decided'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';

  -- the owner (workspace admin) decides
  perform set_config('request.jwt.claims', json_build_object('sub',uo,'role','authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.decide_growth_plan(p1,'rejected','  '); fail:=fail+1; failures:=failures||' reject_without_reason'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.decide_growth_plan(p1,'archive','x'); fail:=fail+1; failures:=failures||' bad_decision'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  r := public.decide_growth_plan(p1,'changes_requested','Lower the ad budget in week 2');
  select status into st from public.growth_plan_versions where id=p1; if r->>'status'='draft' and st='draft' then pass:=pass+1; else fail:=fail+1; failures:=failures||' changes_kept_draft'; end if;
  r := public.decide_growth_plan(p1,'approved','');
  select status into st from public.growth_plan_versions where id=p1; if st='approved' then pass:=pass+1; else fail:=fail+1; failures:=failures||' approved'; end if;
  begin perform public.decide_growth_plan(p1,'rejected','Too late'); fail:=fail+1; failures:=failures||' decided_approved'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  r := public.decide_growth_plan(p2,'rejected','Duplicates the first version');
  select status into st from public.growth_plan_versions where id=p2; if st='rejected' then pass:=pass+1; else fail:=fail+1; failures:=failures||' rejected'; end if;
  begin perform public.decide_growth_plan(p2,'approved',''); fail:=fail+1; failures:=failures||' approved_rejected'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  select status into st from public.growth_plan_versions where id=p1; if st='approved' then pass:=pass+1; else fail:=fail+1; failures:=failures||' approved_kept'; end if;
  execute 'reset role';

  select count(*) into n from public.growth_plan_decisions where plan_version_id=p1 and decided_by=uo; if n=2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' p1_decisions='||n; end if;
  select count(*) into n from public.growth_plan_decisions where plan_version_id=p2 and decision='rejected' and note='Duplicates the first version'; if n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' p2_reason'; end if;
  select count(*) into n from public.activity_events where workspace_id=w and entity_type='growth_plan'; if n=3 then pass:=pass+1; else fail:=fail+1; failures:=failures||' activity='||n; end if;
  select count(*) into n from public.audit_logs where org_id=o and action like 'growth_plan.%'; if n=3 then pass:=pass+1; else fail:=fail+1; failures:=failures||' audit='||n; end if;
  begin update public.growth_plan_decisions set note='changed' where plan_version_id=p2; fail:=fail+1; failures:=failures||' updated'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin delete from public.growth_plan_decisions where plan_version_id=p2; fail:=fail+1; failures:=failures||' deleted'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;

  perform set_config('request.jwt.claims', json_build_object('sub',uv,'role','authenticated')::text, true); execute 'set local role authenticated';
  select count(*) into n from public.growth_plan_decisions where workspace_id=w; if n=3 then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer_reads='||n; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',ux,'role','authenticated')::text, true); execute 'set local role authenticated';
  select count(*) into n from public.growth_plan_decisions where workspace_id=w; if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_reads='||n; end if;
  execute 'reset role';

  if not has_function_privilege('anon','public.decide_growth_plan(uuid,text,text)','execute') then pass:=pass+1; else fail:=fail+1; failures:=failures||' anon_exec'; end if;
  if not has_table_privilege('authenticated','public.growth_plan_decisions','insert') then pass:=pass+1; else fail:=fail+1; failures:=failures||' insert_grant'; end if;
  raise exception 'PLAN_DECISIONS_RESULT pass=% fail=% failures=[%]', pass, fail, trim(failures);
end $$;
