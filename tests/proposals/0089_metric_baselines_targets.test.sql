-- Assertions for docs/proposals/0089 (rolled back): baselines and targets are set by editors only, never invented
-- (a measured baseline copies the recorded result; a manual one needs value, past period and source), insert-only
-- with full history, business-scoped (no other business's measurement or owner), readable by viewers only of
-- their own business.
do $$
declare
  uo uuid := gen_random_uuid(); ue uuid := gen_random_uuid(); um uuid := gen_random_uuid(); uv uuid := gen_random_uuid(); ux uuid := gen_random_uuid();
  o uuid; o2 uuid; w uuid; w2 uuid; m uuid; m2 uuid; pm uuid; pm2 uuid; j jsonb; n int; b1 uuid; b2 uuid; t1 uuid; v numeric;
  pass int := 0; fail int := 0; failures text := '';
begin
  execute $t$CREATE FUNCTION pg_temp.su(_u uuid) RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; PERFORM set_config('request.jwt.claims', json_build_object('sub',_u,'role','authenticated')::text, true); SET LOCAL ROLE authenticated; END $b$ $t$;
  execute $t$CREATE FUNCTION pg_temp.root() RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; END $b$ $t$;
  insert into auth.users(id,email,aud,role,instance_id) values
    (uo,'mbt-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ue,'mbt-editor@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (um,'mbt-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (uv,'mbt-viewer@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ux,'mbt-outsider@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  perform pg_temp.su(uo); o := public.create_organization('MBT fixture','Bakery'); select id into w from public.workspaces where org_id=o;
  perform pg_temp.su(ux); o2 := public.create_organization('MBT other','Shop'); select id into w2 from public.workspaces where org_id=o2;
  perform pg_temp.root();
  insert into public.organization_members(org_id,user_id,role) values(o,ue,'editor'),(o,um,'member'),(o,uv,'viewer');
  insert into public.workspace_members(workspace_id,user_id,role) values(w,ue,'editor'),(w,um,'member'),(w,uv,'viewer');
  perform pg_temp.su(um);
  m := (public.define_metric(w,'leads','Leads','count',null,'increase',null,null)->>'metric_id')::uuid;
  pm := (public.record_measurement(m,'manual_actual','2026-01-01','2026-01-31',40,'','',gen_random_uuid(),null)->>'measurement_id')::uuid;
  perform public.record_measurement(m,'planned','2026-02-01','2026-02-28',60,'','',gen_random_uuid(),null);
  perform pg_temp.su(ux);
  m2 := (public.define_metric(w2,'leads','Leads','count',null,'increase',null,null)->>'metric_id')::uuid;
  pm2 := (public.record_measurement(m2,'manual_actual','2026-01-01','2026-01-31',999,'','',gen_random_uuid(),null)->>'measurement_id')::uuid;

  -- 1. members and viewers cannot set a baseline or target
  perform pg_temp.su(um);
  begin perform public.set_metric_baseline(m, gen_random_uuid(), pm, null, null, null, null, ''); fail:=fail+1; failures:=failures||' member_baseline';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' member_baseline:'||sqlstate; end if; end;
  perform pg_temp.su(uv);
  begin perform public.set_metric_target(m, gen_random_uuid(), 80, current_date + 30, 'month', null, ''); fail:=fail+1; failures:=failures||' viewer_target';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer_target:'||sqlstate; end if; end;

  -- 2. a measured baseline copies the recorded result (value, period, reliability)
  perform pg_temp.su(ue);
  j := public.set_metric_baseline(m, gen_random_uuid(), pm, 12345, '2020-01-01', '2020-01-31', 'ignored', 'from January');
  b1 := (j->>'baseline_id')::uuid;
  select count(*) into n from public.metric_baselines where id=b1 and basis='measured' and value=40 and period_start='2026-01-01' and measurement_kind='manual_actual';
  if n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' measured_copy'; end if;

  -- 3. planned values and another business's result cannot become a baseline
  begin perform public.set_metric_baseline(m, gen_random_uuid(), (select id from public.performance_measurements where metric_id=m and kind='planned'), null,null,null,null,''); fail:=fail+1; failures:=failures||' planned_baseline';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' planned_baseline:'||sqlstate; end if; end;
  begin perform public.set_metric_baseline(m, gen_random_uuid(), pm2, null,null,null,null,''); fail:=fail+1; failures:=failures||' foreign_measurement';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' foreign_measurement:'||sqlstate; end if; end;
  begin perform public.set_metric_baseline(m2, gen_random_uuid(), pm2, null,null,null,null,''); fail:=fail+1; failures:=failures||' foreign_metric';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' foreign_metric:'||sqlstate; end if; end;

  -- 4. a manual baseline needs value, past period and source; a valid one supersedes the earlier baseline
  begin perform public.set_metric_baseline(m, gen_random_uuid(), null, 30, '2025-12-01', '2025-12-31', '  ', ''); fail:=fail+1; failures:=failures||' no_source';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' no_source:'||sqlstate; end if; end;
  begin perform public.set_metric_baseline(m, gen_random_uuid(), null, 30, current_date, current_date + 10, 'Sheet', ''); fail:=fail+1; failures:=failures||' future_period';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' future_period:'||sqlstate; end if; end;
  j := public.set_metric_baseline(m, gen_random_uuid(), null, 30, '2025-12-01', '2025-12-31', 'December sales sheet', '');
  b2 := (j->>'baseline_id')::uuid;
  if (j->>'replaced')::uuid = b1 and (select supersedes_id from public.metric_baselines where id=b2) = b1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' supersede'; end if;

  -- 5. idempotent per request key
  t1 := gen_random_uuid();
  j := public.set_metric_target(m, t1, 80, current_date + 60, 'month', um, 'Q target');
  j := public.set_metric_target(m, t1, 80, current_date + 60, 'month', um, 'Q target');
  select count(*) into n from public.metric_targets where metric_id=m;
  if n=1 and j->>'status'='existing' then pass:=pass+1; else fail:=fail+1; failures:=failures||' idempotent:'||n; end if;

  -- 6. target validation: past date, missing period, outsider owner
  begin perform public.set_metric_target(m, gen_random_uuid(), 80, current_date - 1, 'month', null, ''); fail:=fail+1; failures:=failures||' past_target';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' past_target:'||sqlstate; end if; end;
  begin perform public.set_metric_target(m, gen_random_uuid(), 80, current_date + 5, null, null, ''); fail:=fail+1; failures:=failures||' no_period';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' no_period:'||sqlstate; end if; end;
  begin perform public.set_metric_target(m, gen_random_uuid(), 80, current_date + 5, 'month', ux, ''); fail:=fail+1; failures:=failures||' outsider_owner';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_owner:'||sqlstate; end if; end;
  begin perform public.set_metric_target(m, gen_random_uuid(), -5, current_date + 5, 'month', null, ''); fail:=fail+1; failures:=failures||' negative_count';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' negative_count:'||sqlstate; end if; end;

  -- 7. withdraw keeps history; withdrawing twice is refused
  j := public.set_metric_target(m, gen_random_uuid(), null, null, null, null, 'no longer relevant', true);
  select count(*) into n from public.metric_targets where metric_id=m;
  if n=2 and j->>'status'='withdrawn' then pass:=pass+1; else fail:=fail+1; failures:=failures||' withdraw:'||n; end if;
  begin perform public.set_metric_target(m, gen_random_uuid(), null, null, null, null, '', true); fail:=fail+1; failures:=failures||' withdraw_twice';
    exception when others then if sqlstate='P0001' then pass:=pass+1; else fail:=fail+1; failures:=failures||' withdraw_twice:'||sqlstate; end if; end;

  -- 8. history is permanent and cannot be written directly, even by the owner
  perform pg_temp.su(uo);
  begin update public.metric_baselines set value=1 where id=b2; get diagnostics n = row_count;
    if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' update_baseline'; end if;
    exception when others then pass:=pass+1; end;
  begin insert into public.metric_targets(org_id,workspace_id,metric_id,value,target_date,period_kind,request_key) values(o,w,m,1,current_date+1,'month',gen_random_uuid());
    fail:=fail+1; failures:=failures||' direct_insert'; exception when others then pass:=pass+1; end;
  perform pg_temp.root();
  begin delete from public.metric_baselines where id=b2; fail:=fail+1; failures:=failures||' delete_baseline';
    exception when others then pass:=pass+1; end;

  -- 9. viewers of the business read it; an outsider reads nothing
  perform pg_temp.su(uv);
  select count(*) into n from public.metric_baselines where metric_id=m;
  if n=2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer_reads:'||n; end if;
  perform pg_temp.su(ux);
  select count(*) into n from public.metric_baselines where metric_id=m;
  select count(*) + n into n from public.metric_targets where metric_id=m;
  if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_reads:'||n; end if;
  perform pg_temp.root();
  raise exception 'METRIC_BASELINES_TARGETS_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
