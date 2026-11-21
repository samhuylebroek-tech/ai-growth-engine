-- Assertions for docs/proposals/0083 (rolled back): campaign lifecycle transitions are checked per role, need reasons
-- where required, completion needs a result (or an explicit explanation) and an outcome the KPI supports, history is
-- insert-only and business-scoped; strategy links must match the goal; spending limits are editor-set, enforced per
-- data class and currency at record time (blocked attempts audited), the emergency stop can be raised by a member but
-- lowered only by an editor.
do $$
declare
  uo uuid := gen_random_uuid(); ue uuid := gen_random_uuid(); um uuid := gen_random_uuid(); uv uuid := gen_random_uuid(); ux uuid := gen_random_uuid();
  o uuid; o2 uuid; w uuid; w2 uuid; g1 uuid; g2 uuid; s2 uuid; c uuid; c2 uuid; cm uuid; j jsonb; n int; k uuid;
  pass int := 0; fail int := 0; failures text := '';
begin
  execute $t$CREATE FUNCTION pg_temp.su(_u uuid) RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; PERFORM set_config('request.jwt.claims', json_build_object('sub',_u,'role','authenticated')::text, true); SET LOCAL ROLE authenticated; END $b$ $t$;
  execute $t$CREATE FUNCTION pg_temp.root() RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; END $b$ $t$;
  insert into auth.users(id,email,aud,role,instance_id) values
    (uo,'cos-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ue,'cos-editor@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (um,'cos-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (uv,'cos-viewer@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ux,'cos-outsider@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  perform pg_temp.su(uo); o := public.create_organization('COS fixture','Bakery'); select id into w from public.workspaces where org_id=o;
  perform pg_temp.su(ux); o2 := public.create_organization('Other','Shop'); select id into w2 from public.workspaces where org_id=o2;
  perform pg_temp.root();
  insert into public.organization_members(org_id,user_id,role) values(o,ue,'editor'),(o,um,'member'),(o,uv,'viewer');
  insert into public.workspace_members(workspace_id,user_id,role) values(w,ue,'editor'),(w,um,'member'),(w,uv,'viewer');
  insert into public.growth_goals(org_id,workspace_id,title,created_by) values(o,w,'Revenue +20%',uo) returning id into g1;
  insert into public.growth_goals(org_id,workspace_id,title,created_by) values(o,w,'Leads',uo) returning id into g2;
  insert into public.growth_strategies(org_id,workspace_id,goal_id,request_key,summary,body,created_by) values(o,w,g2,gen_random_uuid(),'Lead plan','{}',uo) returning id into s2;

  -- initial status and default
  perform pg_temp.su(um);
  insert into public.campaigns(org_id,workspace_id,title,created_by,goal_id,primary_kpi,kpi_baseline,kpi_target) values(o,w,'Spring',um,g1,'orders',100,120) returning id into c;
  if (select status from public.campaigns where id=c)='draft' then pass:=pass+1; else fail:=fail+1; failures:=failures||' default_draft'; end if;
  begin insert into public.campaigns(org_id,workspace_id,title,created_by,status) values(o,w,'Live',um,'active'); fail:=fail+1; failures:=failures||' insert_active';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' insert_active:'||sqlstate; end if; end;
  -- strategy of another goal is refused; matching goal accepted
  begin update public.campaigns set strategy_id=s2 where id=c; fail:=fail+1; failures:=failures||' strategy_mismatch';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' strategy_mismatch:'||sqlstate; end if; end;
  update public.campaigns set goal_id=g2, strategy_id=s2 where id=c;
  if (select strategy_id from public.campaigns where id=c)=s2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' strategy_link'; end if;
  update public.campaigns set goal_id=g1, strategy_id=null where id=c;
  -- direct status / approval changes are refused
  begin update public.campaigns set status='active' where id=c; fail:=fail+1; failures:=failures||' direct_status';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' direct_status:'||sqlstate; end if; end;
  begin update public.campaigns set approved_by=um where id=c; fail:=fail+1; failures:=failures||' direct_approval';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' direct_approval:'||sqlstate; end if; end;
  -- transitions
  begin perform public.transition_campaign(w,c,'active'); fail:=fail+1; failures:=failures||' invalid_transition';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' invalid_transition:'||sqlstate; end if; end;
  j := public.transition_campaign(w,c,'awaiting_approval');
  if j->>'to'='awaiting_approval' then pass:=pass+1; else fail:=fail+1; failures:=failures||' member_submit'; end if;
  begin perform public.transition_campaign(w,c,'approved'); fail:=fail+1; failures:=failures||' member_approve';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' member_approve:'||sqlstate; end if; end;
  perform pg_temp.su(ux);
  begin perform public.transition_campaign(w,c,'approved'); fail:=fail+1; failures:=failures||' outsider';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider:'||sqlstate; end if; end;
  perform pg_temp.su(ue);
  begin perform public.transition_campaign(w,c,'draft'); fail:=fail+1; failures:=failures||' reject_reason';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' reject_reason:'||sqlstate; end if; end;
  perform public.transition_campaign(w,c,'approved','{"reason":"Fits the plan"}');
  if (select approved_by from public.campaigns where id=c)=ue then pass:=pass+1; else fail:=fail+1; failures:=failures||' approved_by'; end if;
  begin perform public.transition_campaign(w,c,'scheduled'); fail:=fail+1; failures:=failures||' schedule_start';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' schedule_start:'||sqlstate; end if; end;
  perform public.transition_campaign(w,c,'active');
  perform pg_temp.su(um);
  begin perform public.transition_campaign(w,c,'paused'); fail:=fail+1; failures:=failures||' pause_reason';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' pause_reason:'||sqlstate; end if; end;
  perform public.transition_campaign(w,c,'paused','{"reason":"Supplier delay"}');
  perform pg_temp.su(ue);
  perform public.transition_campaign(w,c,'active');
  -- completion rules
  begin perform public.transition_campaign(w,c,'completed','{"outcome":"achieved"}'); fail:=fail+1; failures:=failures||' result_required';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' result_required:'||sqlstate; end if; end;
  begin perform public.transition_campaign(w,c,'completed','{"results_unavailable":"Shop export pending"}'); fail:=fail+1; failures:=failures||' outcome_required';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' outcome_required:'||sqlstate; end if; end;
  begin perform public.transition_campaign(w,c,'completed','{"results_unavailable":"Shop export pending","outcome":"achieved"}'); fail:=fail+1; failures:=failures||' achieved_no_kpi';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' achieved_no_kpi:'||sqlstate; end if; end;
  begin perform public.transition_campaign(w,c,'completed','{"results_unavailable":"x","outcome":"achieved","kpi_actual":110}'); fail:=fail+1; failures:=failures||' achieved_below_target';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' achieved_below:'||sqlstate; end if; end;
  perform public.transition_campaign(w,c,'completed','{"results_unavailable":"Shop export pending","outcome":"partially_achieved","kpi_actual":110}');
  if (select outcome='partially_achieved' and kpi_actual=110 and results_unavailable_reason='Shop export pending' from public.campaigns where id=c) then pass:=pass+1; else fail:=fail+1; failures:=failures||' completed_fields'; end if;
  -- history
  perform pg_temp.su(uv);
  select count(*) into n from public.campaign_status_events where campaign_id=c;
  if n=6 then pass:=pass+1; else fail:=fail+1; failures:=failures||' events:'||n; end if;
  if exists(select 1 from public.campaign_status_events where campaign_id=c and to_status='paused' and reason='Supplier delay' and actor_id=um and from_status='active') then pass:=pass+1; else fail:=fail+1; failures:=failures||' event_detail'; end if;
  perform pg_temp.su(ux);
  select count(*) into n from public.campaign_status_events where campaign_id=c;
  if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_reads_events'; end if;
  perform pg_temp.root();
  begin update public.campaign_status_events set reason='x' where campaign_id=c; fail:=fail+1; failures:=failures||' events_mutable';
    exception when others then pass:=pass+1; end;

  -- spending limits
  perform pg_temp.su(um);
  insert into public.campaigns(org_id,workspace_id,title,created_by) values(o,w,'Ads',um) returning id into c2;
  begin perform public.set_campaign_spend_limits(w,gen_random_uuid(),c2,'{"currency":"EUR","weekly_max":100,"reason":"cap"}'); fail:=fail+1; failures:=failures||' member_limits';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' member_limits:'||sqlstate; end if; end;
  perform pg_temp.su(ue);
  begin perform public.set_campaign_spend_limits(w,gen_random_uuid(),c2,'{"currency":"EUR","weekly_max":100}'); fail:=fail+1; failures:=failures||' limit_reason';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' limit_reason:'||sqlstate; end if; end;
  begin perform public.set_campaign_spend_limits(w,gen_random_uuid(),c2,'{"currency":"EUR","lifetime_max":100,"reserve_amount":150,"reason":"x"}'); fail:=fail+1; failures:=failures||' reserve_over';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' reserve_over:'||sqlstate; end if; end;
  k := gen_random_uuid();
  perform public.set_campaign_spend_limits(w,k,c2,'{"currency":"EUR","daily_max":80,"weekly_max":100,"lifetime_max":300,"reserve_amount":50,"reason":"Q2 cap"}');
  j := public.set_campaign_spend_limits(w,k,c2,'{"currency":"EUR","daily_max":80,"weekly_max":100,"lifetime_max":300,"reserve_amount":50,"reason":"Q2 cap"}');
  if j->>'status'='existing' then pass:=pass+1; else fail:=fail+1; failures:=failures||' limit_idem'; end if;
  perform pg_temp.su(um);
  j := public.record_campaign_spend(w,gen_random_uuid(),c2,jsonb_build_object('kind','spend','amount',60,'currency','EUR','occurred_on',current_date-1));
  if j->>'status'='created' then pass:=pass+1; else fail:=fail+1; failures:=failures||' spend_ok:'||j::text; end if;
  j := public.record_campaign_spend(w,gen_random_uuid(),c2,jsonb_build_object('kind','spend','amount',30,'currency','EUR','occurred_on',current_date-1));
  if j->>'status'='blocked' and j->>'limit'='daily' then pass:=pass+1; else fail:=fail+1; failures:=failures||' daily_block:'||j::text; end if;
  -- simulated entries use their own room
  j := public.record_campaign_spend(w,gen_random_uuid(),c2,jsonb_build_object('kind','spend','amount',70,'currency','EUR','occurred_on',current_date-1,'data_class','simulated'));
  if j->>'status'='created' then pass:=pass+1; else fail:=fail+1; failures:=failures||' sim_separate:'||j::text; end if;
  -- a reservation that would exceed the remaining lifetime room (300 - 50 reserve) is refused
  perform public.record_campaign_spend(w,gen_random_uuid(),c2,jsonb_build_object('kind','commitment','amount',75,'currency','EUR','occurred_on',current_date+40));
  perform public.record_campaign_spend(w,gen_random_uuid(),c2,jsonb_build_object('kind','commitment','amount',75,'currency','EUR','occurred_on',current_date+50));
  j := public.record_campaign_spend(w,gen_random_uuid(),c2,jsonb_build_object('kind','commitment','amount',75,'currency','EUR','occurred_on',current_date+60));
  if j->>'status'='blocked' and j->>'limit'='lifetime' then pass:=pass+1; else fail:=fail+1; failures:=failures||' lifetime_block:'||j::text; end if;
  j := public.record_campaign_spend(w,gen_random_uuid(),c2,jsonb_build_object('kind','spend','amount',5,'currency','USD','occurred_on',current_date-1));
  if j->>'status'='blocked' and j->>'limit'='currency' then pass:=pass+1; else fail:=fail+1; failures:=failures||' currency_block:'||j::text; end if;
  select count(*) into n from public.campaign_spend_entries where campaign_id=c2;
  if n=4 then pass:=pass+1; else fail:=fail+1; failures:=failures||' entries:'||n; end if;
  perform pg_temp.root();
  select count(*) into n from public.audit_logs where org_id=o and action='campaign.spend_blocked';
  if n=3 then pass:=pass+1; else fail:=fail+1; failures:=failures||' blocked_audit:'||n; end if;
  -- emergency stop: member raises, member cannot lower, editor lowers
  perform pg_temp.su(um);
  perform public.set_campaign_spend_limits(w,gen_random_uuid(),c2,'{"emergency_stop":true,"reason":"Unexpected invoice"}');
  j := public.record_campaign_spend(w,gen_random_uuid(),c2,jsonb_build_object('kind','spend','amount',1,'currency','EUR','occurred_on',current_date));
  if j->>'status'='blocked' and j->>'limit'='emergency_stop' then pass:=pass+1; else fail:=fail+1; failures:=failures||' stop_block:'||j::text; end if;
  begin perform public.set_campaign_spend_limits(w,gen_random_uuid(),c2,'{"emergency_stop":false,"reason":"ok"}'); fail:=fail+1; failures:=failures||' member_unstop';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' member_unstop:'||sqlstate; end if; end;
  perform pg_temp.su(ue);
  perform public.set_campaign_spend_limits(w,gen_random_uuid(),c2,'{"emergency_stop":false,"reason":"Invoice checked"}');
  perform pg_temp.su(um);
  j := public.record_campaign_spend(w,gen_random_uuid(),c2,jsonb_build_object('kind','spend','amount',20,'currency','EUR','occurred_on',current_date));
  if j->>'status'='created' or extract(isodow from current_date)=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' after_unstop:'||j::text; end if;
  -- limit history is complete and insert-only; outsider sees none of it
  perform pg_temp.su(uv);
  select count(*) into n from public.campaign_spend_limit_events where campaign_id=c2;
  if n=3 then pass:=pass+1; else fail:=fail+1; failures:=failures||' limit_events:'||n; end if;
  perform pg_temp.su(ux);
  select count(*) into n from public.campaign_spend_limits where campaign_id=c2;
  if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_limits'; end if;
  perform pg_temp.root();
  begin update public.campaign_spend_limit_events set reason='x' where campaign_id=c2; fail:=fail+1; failures:=failures||' limit_events_mutable';
    exception when others then pass:=pass+1; end;
  -- no direct writes for app roles
  perform pg_temp.su(ue);
  begin insert into public.campaign_spend_limits(org_id,workspace_id,campaign_id,currency,updated_by) values(o,w,c,'EUR',ue); fail:=fail+1; failures:=failures||' direct_limits';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' direct_limits:'||sqlstate; end if; end;
  RESET ROLE;
  raise exception 'CAMPAIGN_OS_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
