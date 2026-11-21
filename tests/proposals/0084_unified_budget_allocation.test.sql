-- Assertions for docs/proposals/0084 (rolled back): one budget line is shared by all campaigns and can never be
-- allocated twice; refusals state their reason and are recorded; repeats are no-ops and stale screens are refused;
-- members request, editors apply or decide; moves keep the line total; spending paid from a line must fit the
-- campaign's allocation (actual and simulated separately); lines cannot drop below what they fund; earmarks hold.
do $$
declare
  uo uuid := gen_random_uuid(); ue uuid := gen_random_uuid(); um uuid := gen_random_uuid(); uv uuid := gen_random_uuid(); ux uuid := gen_random_uuid();
  o uuid; o2 uuid; w uuid; w2 uuid; g1 uuid; g2 uuid; l1 uuid; l2 uuid; lnext uuid; ca uuid; cb uuid; cc uuid; ce uuid; j jsonb; n int; k uuid; rq uuid; x numeric;
  m date := date_trunc('month', current_date)::date;
  pass int := 0; fail int := 0; failures text := '';
begin
  execute $t$CREATE FUNCTION pg_temp.su(_u uuid) RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; PERFORM set_config('request.jwt.claims', json_build_object('sub',_u,'role','authenticated')::text, true); SET LOCAL ROLE authenticated; END $b$ $t$;
  execute $t$CREATE FUNCTION pg_temp.root() RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; END $b$ $t$;
  execute $t$CREATE FUNCTION pg_temp.alloc(_w uuid, _l uuid, _c uuid, _a numeric, _seen numeric, _k uuid DEFAULT gen_random_uuid()) RETURNS jsonb LANGUAGE sql AS $b$
    SELECT public.change_campaign_allocation(_w, _k, jsonb_build_object('kind','set','budget_line_id',_l,'campaign_id',_c,'amount',_a,'seen_amount',_seen,'reason','Plan for this month')) $b$ $t$;
  execute $t$CREATE FUNCTION pg_temp.unalloc(_l uuid) RETURNS numeric LANGUAGE sql AS $b$
    SELECT l.planned - coalesce((SELECT sum(amount) FROM public.campaign_budget_allocations WHERE budget_line_id = _l AND status = 'active'), 0) FROM public.budget_lines l WHERE l.id = _l $b$ $t$;
  insert into auth.users(id,email,aud,role,instance_id) values
    (uo,'uba-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ue,'uba-editor@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (um,'uba-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (uv,'uba-viewer@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ux,'uba-outsider@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  perform pg_temp.su(uo); o := public.create_organization('UBA fixture','Bakery'); select id into w from public.workspaces where org_id=o;
  perform pg_temp.su(ux); o2 := public.create_organization('Other','Shop'); select id into w2 from public.workspaces where org_id=o2;
  perform pg_temp.root();
  insert into public.organization_members(org_id,user_id,role) values(o,ue,'editor'),(o,um,'member'),(o,uv,'viewer');
  insert into public.workspace_members(workspace_id,user_id,role) values(w,ue,'editor'),(w,um,'member'),(w,uv,'viewer');
  insert into public.growth_goals(org_id,workspace_id,title,created_by) values(o,w,'Revenue',uo) returning id into g1;
  insert into public.growth_goals(org_id,workspace_id,title,created_by) values(o,w,'Leads',uo) returning id into g2;
  insert into public.budget_lines(org_id,workspace_id,channel,period_month,planned,currency,created_by) values(o,w,'paid_social',m,10000,'EUR',uo) returning id into l1;
  insert into public.budget_lines(org_id,workspace_id,channel,period_month,planned,currency,goal_id,created_by) values(o,w,'email',m,500,'EUR',g2,uo) returning id into l2;
  insert into public.budget_lines(org_id,workspace_id,channel,period_month,planned,currency,created_by) values(o,w,'paid_social',(m + interval '1 month')::date,1000,'EUR',uo) returning id into lnext;
  perform pg_temp.su(um);
  insert into public.campaigns(org_id,workspace_id,title,created_by,goal_id) values(o,w,'A',um,g1) returning id into ca;
  insert into public.campaigns(org_id,workspace_id,title,created_by,goal_id) values(o,w,'B',um,g1) returning id into cb;
  insert into public.campaigns(org_id,workspace_id,title,created_by) values(o,w,'C',um) returning id into cc;
  insert into public.campaigns(org_id,workspace_id,title,created_by,goal_id) values(o,w,'E',um,g2) returning id into ce;

  -- the €10,000 example: 4,000 + 3,000 + 2,000 leaves exactly 1,000 unallocated
  perform pg_temp.su(ue);
  perform pg_temp.alloc(w,l1,ca,4000,0); perform pg_temp.alloc(w,l1,cb,3000,0); j := pg_temp.alloc(w,l1,cc,2000,0);
  if j->>'status'='applied' and pg_temp.unalloc(l1)=1000 then pass:=pass+1; else fail:=fail+1; failures:=failures||' example:'||j::text; end if;
  -- C cannot take 1,500 more when only 1,000 is free; the refusal names the reason and is recorded
  j := pg_temp.alloc(w,l1,cc,3500,2000);
  if j->>'status'='rejected' and j->>'code'='exceeds_unallocated' and (j->>'unallocated')::numeric=1000 then pass:=pass+1; else fail:=fail+1; failures:=failures||' over:'||j::text; end if;
  select count(*) into n from public.budget_allocation_events where campaign_id=cc and outcome='rejected' and rejection='exceeds_unallocated';
  if n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' rejected_event:'||n; end if;
  if (select amount from public.campaign_budget_allocations where campaign_id=cc)=2000 then pass:=pass+1; else fail:=fail+1; failures:=failures||' unchanged_after_reject'; end if;
  -- the full remainder is allowed, then nothing is left for anyone
  j := pg_temp.alloc(w,l1,cc,3000,2000);
  if j->>'status'='applied' and pg_temp.unalloc(l1)=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' remainder:'||j::text; end if;
  j := pg_temp.alloc(w,l1,ca,4001,4000);
  if j->>'code'='exceeds_unallocated' then pass:=pass+1; else fail:=fail+1; failures:=failures||' none_left:'||j::text; end if;
  perform pg_temp.alloc(w,l1,cc,2000,3000);
  -- a repeated request changes nothing; a stale screen is refused
  k := gen_random_uuid(); perform pg_temp.alloc(w,l1,cb,2500,3000,k); j := pg_temp.alloc(w,l1,cb,2500,3000,k);
  if j->>'status'='existing' and (select amount from public.campaign_budget_allocations where campaign_id=cb)=2500 then pass:=pass+1; else fail:=fail+1; failures:=failures||' idem:'||j::text; end if;
  begin perform pg_temp.alloc(w,l1,cb,2600,3000); fail:=fail+1; failures:=failures||' stale';
    exception when others then if sqlstate='40001' then pass:=pass+1; else fail:=fail+1; failures:=failures||' stale:'||sqlstate; end if; end;
  perform pg_temp.alloc(w,l1,cb,3000,2500);
  -- members and outsiders cannot change allocations directly
  perform pg_temp.su(um);
  begin perform pg_temp.alloc(w,l1,cb,3100,3000); fail:=fail+1; failures:=failures||' member_direct';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' member_direct:'||sqlstate; end if; end;
  perform pg_temp.su(ux);
  begin perform pg_temp.alloc(w,l1,cb,3100,3000); fail:=fail+1; failures:=failures||' outsider_direct';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_direct:'||sqlstate; end if; end;
  select count(*) into n from public.campaign_budget_allocations where workspace_id=w;
  if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_reads'; end if;
  -- member request -> viewer sees it -> member cannot decide -> editor approves
  perform pg_temp.su(um);
  j := public.request_budget_change(w, gen_random_uuid(), jsonb_build_object('kind','set','budget_line_id',l1,'campaign_id',cb,'amount',3500,'seen_amount',3000,'reason','B converts best'));
  rq := (j->>'id')::uuid;
  if j->>'status'='pending' and (select amount from public.campaign_budget_allocations where campaign_id=cb)=3000 then pass:=pass+1; else fail:=fail+1; failures:=failures||' request:'||j::text; end if;
  begin perform public.decide_budget_change(rq, true, null); fail:=fail+1; failures:=failures||' member_decide';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' member_decide:'||sqlstate; end if; end;
  perform pg_temp.su(uv);
  if exists(select 1 from public.budget_change_requests where id=rq and status='pending') then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer_sees_request'; end if;
  perform pg_temp.su(ue);
  j := public.decide_budget_change(rq, true, 'ok');
  if j->>'status'='applied' and (select status from public.budget_change_requests where id=rq)='applied' and pg_temp.unalloc(l1)=500 then pass:=pass+1; else fail:=fail+1; failures:=failures||' approve:'||j::text; end if;
  if exists(select 1 from public.budget_allocation_events where change_request_id=rq and outcome='applied' and previous_amount=3000 and new_amount=3500 and difference=500 and actor_id=ue) then pass:=pass+1; else fail:=fail+1; failures:=failures||' approve_event'; end if;
  -- an approved request that no longer fits fails with its reason instead of overspending
  perform pg_temp.su(um);
  j := public.request_budget_change(w, gen_random_uuid(), jsonb_build_object('kind','set','budget_line_id',l1,'campaign_id',cc,'amount',3000,'seen_amount',2000,'reason','More reach'));
  perform pg_temp.su(ue);
  j := public.decide_budget_change((j->>'id')::uuid, true, null);
  if j->>'code'='exceeds_unallocated' then pass:=pass+1; else fail:=fail+1; failures:=failures||' approve_over:'||j::text; end if;
  perform pg_temp.su(um);
  j := public.request_budget_change(w, gen_random_uuid(), jsonb_build_object('kind','cancel','budget_line_id',l1,'campaign_id',cc,'seen_amount',2000,'reason','Stop C'));
  perform pg_temp.su(ue);
  begin perform public.decide_budget_change((j->>'id')::uuid, false, ''); fail:=fail+1; failures:=failures||' reject_reason';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' reject_reason:'||sqlstate; end if; end;
  perform public.decide_budget_change((j->>'id')::uuid, false, 'Keep C running');
  -- move keeps the line total
  j := public.change_campaign_allocation(w, gen_random_uuid(), jsonb_build_object('kind','move','budget_line_id',l1,'campaign_id',ca,'to_campaign_id',cb,'amount',500,'seen_amount',4000,'reason','Shift to B'));
  if j->>'status'='applied' and (select amount from public.campaign_budget_allocations where campaign_id=ca)=3500
     and (select amount from public.campaign_budget_allocations where campaign_id=cb)=4000 and pg_temp.unalloc(l1)=500 then pass:=pass+1; else fail:=fail+1; failures:=failures||' move:'||j::text; end if;
  j := public.change_campaign_allocation(w, gen_random_uuid(), jsonb_build_object('kind','move','budget_line_id',l1,'campaign_id',ca,'to_campaign_id',cb,'amount',9000,'seen_amount',3500,'reason','Too much'));
  if j->>'code'='move_more_than_allocated' then pass:=pass+1; else fail:=fail+1; failures:=failures||' move_over:'||j::text; end if;
  -- earmarked line funds only campaigns of its goal
  j := pg_temp.alloc(w,l2,ca,100,0);
  if j->>'code'='earmark_mismatch' then pass:=pass+1; else fail:=fail+1; failures:=failures||' earmark:'||j::text; end if;
  j := pg_temp.alloc(w,l2,ce,100,0);
  if j->>'status'='applied' then pass:=pass+1; else fail:=fail+1; failures:=failures||' earmark_ok:'||j::text; end if;
  perform pg_temp.su(um);
  begin update public.campaigns set goal_id=g1 where id=ce; fail:=fail+1; failures:=failures||' leave_earmark';
    exception when others then if sqlstate='P0001' then pass:=pass+1; else fail:=fail+1; failures:=failures||' leave_earmark:'||sqlstate; end if; end;
  -- spending paid from the line must fit the allocation (A has 3,500)
  j := public.record_campaign_spend(w,gen_random_uuid(),ca,jsonb_build_object('kind','spend','amount',1000,'currency','EUR','occurred_on',current_date,'budget_line_id',l1));
  if j->>'status'='created' then pass:=pass+1; else fail:=fail+1; failures:=failures||' line_spend:'||j::text; end if;
  j := public.record_campaign_spend(w,gen_random_uuid(),ca,jsonb_build_object('kind','commitment','amount',2000,'currency','EUR','occurred_on',current_date,'budget_line_id',l1));
  j := public.record_campaign_spend(w,gen_random_uuid(),ca,jsonb_build_object('kind','spend','amount',600,'currency','EUR','occurred_on',current_date,'budget_line_id',l1));
  if j->>'status'='blocked' and j->>'limit'='allocation' and (j->>'limit_amount')::numeric=3500 and (j->>'used')::numeric=3000 then pass:=pass+1; else fail:=fail+1; failures:=failures||' line_block:'||j::text; end if;
  j := public.record_campaign_spend(w,gen_random_uuid(),ca,jsonb_build_object('kind','spend','amount',3500,'currency','EUR','occurred_on',current_date,'budget_line_id',l1,'data_class','simulated'));
  if j->>'status'='created' then pass:=pass+1; else fail:=fail+1; failures:=failures||' sim_room:'||j::text; end if;
  begin perform public.record_campaign_spend(w,gen_random_uuid(),ca,jsonb_build_object('kind','spend','amount',10,'currency','EUR','occurred_on',current_date,'budget_line_id',lnext)); fail:=fail+1; failures:=failures||' wrong_month';
    exception when others then if sqlstate='P0001' then pass:=pass+1; else fail:=fail+1; failures:=failures||' wrong_month:'||sqlstate; end if; end;
  begin perform public.record_campaign_spend(w,gen_random_uuid(),ca,jsonb_build_object('kind','spend','amount',10,'currency','USD','occurred_on',current_date,'budget_line_id',l1)); fail:=fail+1; failures:=failures||' wrong_currency';
    exception when others then if sqlstate='P0001' then pass:=pass+1; else fail:=fail+1; failures:=failures||' wrong_currency:'||sqlstate; end if; end;
  -- a release stays on the line and frees room again
  select id into k from public.campaign_spend_entries where campaign_id=ca and kind='commitment';
  j := public.record_campaign_spend(w,gen_random_uuid(),ca,jsonb_build_object('kind','release','amount',-500,'currency','EUR','occurred_on',current_date,'relates_to',k));
  if (select budget_line_id from public.campaign_spend_entries where id=(j->>'id')::uuid)=l1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' release_line:'||j::text; end if;
  -- allocations cannot drop below what is spent or reserved on the line (A: 1,000 spent + 1,500 open reservation)
  perform pg_temp.su(ue);
  j := pg_temp.alloc(w,l1,ca,2000,3500);
  if j->>'code'='below_committed' and (j->>'committed')::numeric=2500 then pass:=pass+1; else fail:=fail+1; failures:=failures||' below_committed:'||j::text; end if;
  j := pg_temp.alloc(w,l1,ca,2500,3500);
  if j->>'status'='applied' and pg_temp.unalloc(l1)=1500 then pass:=pass+1; else fail:=fail+1; failures:=failures||' release_to_committed:'||j::text; end if;
  j := public.change_campaign_allocation(w, gen_random_uuid(), jsonb_build_object('kind','release_unused','budget_line_id',l1,'campaign_id',cb,'seen_amount',4000,'reason','Done'));
  if j->>'code'='campaign_running' then pass:=pass+1; else fail:=fail+1; failures:=failures||' release_running:'||j::text; end if;
  -- cancel frees the whole allocation
  j := public.change_campaign_allocation(w, gen_random_uuid(), jsonb_build_object('kind','cancel','budget_line_id',l1,'campaign_id',cc,'seen_amount',2000,'reason','Stopped'));
  if j->>'status'='applied' and (select status from public.campaign_budget_allocations where campaign_id=cc)='cancelled' and pg_temp.unalloc(l1)=3500 then pass:=pass+1; else fail:=fail+1; failures:=failures||' cancel:'||j::text; end if;
  -- the budget line cannot drop below what it funds or change identity while funding
  begin update public.budget_lines set planned=6000 where id=l1; fail:=fail+1; failures:=failures||' line_below';
    exception when others then if sqlstate='P0001' then pass:=pass+1; else fail:=fail+1; failures:=failures||' line_below:'||sqlstate; end if; end;
  update public.budget_lines set planned=6500 where id=l1;
  if pg_temp.unalloc(l1)=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' line_exact'; end if;
  begin update public.budget_lines set currency='USD' where id=l1; fail:=fail+1; failures:=failures||' line_currency';
    exception when others then if sqlstate='P0001' then pass:=pass+1; else fail:=fail+1; failures:=failures||' line_currency:'||sqlstate; end if; end;
  -- the existing atomic move between lines respects allocations too
  begin perform public.move_budget(l1, lnext, 100, 6500, 1000); fail:=fail+1; failures:=failures||' move_budget_below';
    exception when others then if sqlstate in ('P0001','22023') then pass:=pass+1; else fail:=fail+1; failures:=failures||' move_budget_below:'||sqlstate; end if; end;
  -- history is insert-only and there are no direct writes
  begin insert into public.campaign_budget_allocations(org_id,workspace_id,budget_line_id,campaign_id,currency,amount,updated_by) values(o,w,lnext,ca,'EUR',1,ue); fail:=fail+1; failures:=failures||' direct_insert';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' direct_insert:'||sqlstate; end if; end;
  perform pg_temp.root();
  begin update public.budget_allocation_events set reason='x' where workspace_id=w; fail:=fail+1; failures:=failures||' events_mutable';
    exception when others then pass:=pass+1; end;
  select count(*) into n from public.audit_logs where org_id=o and action='budget.allocation_refused';
  if n>=6 then pass:=pass+1; else fail:=fail+1; failures:=failures||' refused_audit:'||n; end if;
  RESET ROLE;
  raise exception 'BUDGET_ALLOCATION_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
