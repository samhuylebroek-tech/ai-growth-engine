-- Assertions for docs/proposals/0072 (rolled back): a budget move changes both lines together or not at all, only
-- within one business, month and currency, only for budget editors, only from the amounts the caller saw, and
-- within the receiving line's hard cap. The total planned budget never changes.
do $$
declare
  uo uuid := gen_random_uuid(); ue uuid := gen_random_uuid(); um uuid := gen_random_uuid(); ux uuid := gen_random_uuid();
  o uuid; w1 uuid; w2 uuid; a uuid; b uuid; c uuid; d uuid; e uuid; mon date := date_trunc('month', now())::date; j jsonb; tot numeric;
  pass int := 0; fail int := 0; failures text := '';
begin
  execute $t$CREATE FUNCTION pg_temp.su(_u uuid) RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; PERFORM set_config('request.jwt.claims', json_build_object('sub',_u,'role','authenticated')::text, true); SET LOCAL ROLE authenticated; END $b$ $t$;
  execute $t$CREATE FUNCTION pg_temp.root() RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; END $b$ $t$;
  insert into auth.users(id,email,aud,role,instance_id) values
    (uo,'bm-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ue,'bm-editor@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (um,'bm-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ux,'bm-outsider@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  perform pg_temp.su(uo);
  o := public.create_organization('Budget move fixture','Bakery'); select id into w1 from public.workspaces where org_id=o;
  perform pg_temp.root(); update public.subscriptions set plan_key='business' where org_id=o;
  perform pg_temp.su(uo); w2 := public.create_workspace(o,'Catering');
  perform pg_temp.root();
  insert into public.organization_members(org_id,user_id,role) values(o,ue,'editor'),(o,um,'member');
  insert into public.workspace_members(workspace_id,user_id,role) values(w1,ue,'editor'),(w1,um,'member');
  perform pg_temp.su(uo);
  insert into public.budget_lines(org_id,workspace_id,channel,period_month,planned,currency) values(o,w1,'Search',mon,500,'EUR') returning id into a;
  insert into public.budget_lines(org_id,workspace_id,channel,period_month,planned,hard_cap,currency) values(o,w1,'Social',mon,200,300,'EUR') returning id into b;
  insert into public.budget_lines(org_id,workspace_id,channel,period_month,planned,currency) values(o,w1,'Print',mon,100,'USD') returning id into c;
  insert into public.budget_lines(org_id,workspace_id,channel,period_month,planned,currency) values(o,w2,'Search',mon,100,'EUR') returning id into d;
  insert into public.budget_lines(org_id,workspace_id,channel,period_month,planned,currency) values(o,w1,'Radio',(mon - interval '1 month')::date,100,'EUR') returning id into e;

  perform pg_temp.su(ue);
  j := public.move_budget(a, b, 80, 500, 200);
  if (select planned from public.budget_lines where id=a) = 420 and (select planned from public.budget_lines where id=b) = 280 then pass:=pass+1; else fail:=fail+1; failures:=failures||' moved'; end if;
  if (select sum(planned) from public.budget_lines where id in (a,b)) = 700 then pass:=pass+1; else fail:=fail+1; failures:=failures||' total_changed'; end if;
  -- the same click again with the old amounts does nothing
  begin perform public.move_budget(a, b, 80, 500, 200); fail:=fail+1; failures:=failures||' stale_applied'; exception when others then if sqlstate = '40001' then pass:=pass+1; else fail:=fail+1; failures:=failures||' stale:'||sqlstate; end if; end;
  begin perform public.move_budget(a, b, 30, 420, 280); fail:=fail+1; failures:=failures||' cap_exceeded'; exception when others then if sqlstate = '22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' cap:'||sqlstate; end if; end;
  begin perform public.move_budget(a, c, 10, 420, 100); fail:=fail+1; failures:=failures||' cross_currency'; exception when others then if sqlstate = '22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' currency:'||sqlstate; end if; end;
  begin perform public.move_budget(a, e, 10, 420, 100); fail:=fail+1; failures:=failures||' cross_month'; exception when others then if sqlstate = '22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' month:'||sqlstate; end if; end;
  begin perform public.move_budget(a, d, 10, 420, 100); fail:=fail+1; failures:=failures||' cross_business'; exception when others then if sqlstate = '42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' business:'||sqlstate; end if; end;
  begin perform public.move_budget(a, b, 0, 420, 280); fail:=fail+1; failures:=failures||' zero'; exception when others then if sqlstate = '22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' zero:'||sqlstate; end if; end;
  begin perform public.move_budget(b, a, 999, 280, 420); fail:=fail+1; failures:=failures||' overdraw'; exception when others then if sqlstate = '22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' overdraw:'||sqlstate; end if; end;
  perform pg_temp.su(um);
  begin perform public.move_budget(a, b, 10, 420, 280); fail:=fail+1; failures:=failures||' member_moved'; exception when others then if sqlstate = '42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' member:'||sqlstate; end if; end;
  perform pg_temp.su(ux);
  begin perform public.move_budget(a, b, 10, 420, 280); fail:=fail+1; failures:=failures||' outsider_moved'; exception when others then if sqlstate = '42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider:'||sqlstate; end if; end;
  perform pg_temp.root();
  if (select planned from public.budget_lines where id=a) = 420 and (select planned from public.budget_lines where id=b) = 280 then pass:=pass+1; else fail:=fail+1; failures:=failures||' refused_changed'; end if;
  if exists (select 1 from public.audit_logs where org_id=o and action='budget.moved' and actor_id=ue) then pass:=pass+1; else fail:=fail+1; failures:=failures||' audit'; end if;
  if not has_function_privilege('anon','public.move_budget(uuid,uuid,numeric,numeric,numeric)','execute') then pass:=pass+1; else fail:=fail+1; failures:=failures||' anon'; end if;
  raise exception 'BUDGET_MOVE_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
