-- Assertions for docs/proposals/0085 (rolled back): invalid budget requests fail instead of staying pending; campaign
-- spending carries one cost category that corrections keep; business costs are an insert-only ledger without campaign
-- links, AI or imported entries, with capped linked corrections and per-sale cost-of-goods; cost models and credit
-- prices are versioned, insert-only and role-checked (credit prices: Platform Owner only, never back-dated);
-- learnings need a recorded measurement for positive/negative claims and the database fills in the real credits.
do $$
declare
  uo uuid := gen_random_uuid(); ue uuid := gen_random_uuid(); um uuid := gen_random_uuid(); uv uuid := gen_random_uuid(); ux uuid := gen_random_uuid(); up uuid;
  o uuid; o2 uuid; w uuid; w2 uuid; l1 uuid; ca uuid; cb uuid; t1 uuid; t2 uuid; pr1 uuid; pr2 uuid; sale uuid; cost1 uuid; sp uuid; j jsonb; n int; k uuid; rq uuid;
  m date := date_trunc('month', current_date)::date;
  pass int := 0; fail int := 0; failures text := '';
begin
  execute $t$CREATE FUNCTION pg_temp.su(_u uuid) RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; PERFORM set_config('request.jwt.claims', json_build_object('sub',_u,'role','authenticated')::text, true); SET LOCAL ROLE authenticated; END $b$ $t$;
  execute $t$CREATE FUNCTION pg_temp.root() RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; END $b$ $t$;
  execute $t$CREATE FUNCTION pg_temp.cost(_w uuid, _p jsonb, _k uuid DEFAULT gen_random_uuid()) RETURNS jsonb LANGUAGE sql AS $b$
    SELECT public.record_business_cost(_w, _k, jsonb_build_object('category','cogs','amount',100,'currency','EUR','period_start',date_trunc('month', current_date)::date,
      'period_end',(date_trunc('month', current_date) + interval '1 month - 1 day')::date) || _p) $b$ $t$;
  insert into auth.users(id,email,aud,role,instance_id) values
    (uo,'uge-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ue,'uge-editor@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (um,'uge-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (uv,'uge-viewer@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ux,'uge-outsider@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  perform pg_temp.su(uo); o := public.create_organization('UGE fixture','Bakery'); select id into w from public.workspaces where org_id=o;
  perform pg_temp.su(ux); o2 := public.create_organization('Other','Shop'); select id into w2 from public.workspaces where org_id=o2;
  perform pg_temp.root();
  -- the existing Platform Owner of this environment (assigned once by the controlled initialization)
  select user_id into up from public.platform_roles where role = 'platform_owner' limit 1;
  if up is null then raise exception 'no Platform Owner in this environment'; end if;
  insert into public.organization_members(org_id,user_id,role) values(o,ue,'editor'),(o,um,'member'),(o,uv,'viewer');
  insert into public.workspace_members(workspace_id,user_id,role) values(w,ue,'editor'),(w,um,'member'),(w,uv,'viewer');
  insert into public.budget_lines(org_id,workspace_id,channel,period_month,planned,currency,created_by) values(o,w,'paid_social',m,1000,'EUR',uo) returning id into l1;
  perform pg_temp.su(um);
  insert into public.campaigns(org_id,workspace_id,title,created_by) values(o,w,'A',um) returning id into ca;
  insert into public.campaigns(org_id,workspace_id,title,created_by) values(o,w,'B',um) returning id into cb;

  -- 1. a stored request that cannot be applied is marked failed, not left pending
  j := public.request_budget_change(w, gen_random_uuid(), jsonb_build_object('kind','move','budget_line_id',l1,'campaign_id',ca,'to_campaign_id',ca,'amount',10,'seen_amount',0,'reason','Same campaign'));
  rq := (j->>'id')::uuid;
  perform pg_temp.su(ue); j := public.decide_budget_change(rq, true, null);
  if j->>'code'='invalid_request' and (select status from public.budget_change_requests where id=rq)='failed' then pass:=pass+1; else fail:=fail+1; failures:=failures||' invalid_request:'||j::text; end if;

  -- 2. campaign spending carries a cost category; corrections keep it
  perform pg_temp.su(um);
  j := public.record_campaign_spend(w, gen_random_uuid(), ca, jsonb_build_object('kind','spend','amount',200,'currency','EUR','occurred_on',current_date,'category','production'));
  sp := (j->>'id')::uuid;
  if (select category from public.campaign_spend_entries where id=sp)='production' then pass:=pass+1; else fail:=fail+1; failures:=failures||' category:'||j::text; end if;
  j := public.record_campaign_spend(w, gen_random_uuid(), ca, jsonb_build_object('kind','spend','amount',50,'currency','EUR','occurred_on',current_date));
  if (select category from public.campaign_spend_entries where id=(j->>'id')::uuid)='marketing' then pass:=pass+1; else fail:=fail+1; failures:=failures||' default_category'; end if;
  j := public.record_campaign_spend(w, gen_random_uuid(), ca, jsonb_build_object('kind','correction','amount',-20,'currency','EUR','occurred_on',current_date,'relates_to',sp));
  if (select category from public.campaign_spend_entries where id=(j->>'id')::uuid)='production' then pass:=pass+1; else fail:=fail+1; failures:=failures||' correction_category'; end if;
  begin perform public.record_campaign_spend(w, gen_random_uuid(), ca, jsonb_build_object('kind','correction','amount',-5,'currency','EUR','occurred_on',current_date,'relates_to',sp,'category','agency')); fail:=fail+1; failures:=failures||' recategorise';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' recategorise:'||sqlstate; end if; end;
  begin perform public.record_campaign_spend(w, gen_random_uuid(), ca, jsonb_build_object('kind','spend','amount',5,'currency','EUR','occurred_on',current_date,'category','ai')); fail:=fail+1; failures:=failures||' bad_category';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' bad_category:'||sqlstate; end if; end;

  -- 3. business cost ledger
  k := gen_random_uuid(); j := pg_temp.cost(w, '{}'::jsonb, k); cost1 := (j->>'id')::uuid;
  if j->>'status'='created' then pass:=pass+1; else fail:=fail+1; failures:=failures||' cost:'||j::text; end if;
  j := pg_temp.cost(w, '{}'::jsonb, k);
  if j->>'status'='existing' and (select count(*) from public.business_cost_entries where workspace_id=w)=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' cost_idem'; end if;
  foreach j in array array['{"category":"ai_execution"}'::jsonb, '{"data_class":"imported"}', '{"campaign_id":"00000000-0000-0000-0000-000000000000"}', '{"amount":-5}'] loop
    begin perform pg_temp.cost(w, j); fail:=fail+1; failures:=failures||' cost_invalid:'||j::text;
      exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' cost_invalid:'||j::text||sqlstate; end if; end;
  end loop;
  j := pg_temp.cost(w, jsonb_build_object('kind','correction','amount',-30,'relates_to',cost1,'category','software'));
  if (select category from public.business_cost_entries where id=(j->>'id')::uuid)='cogs' then pass:=pass+1; else fail:=fail+1; failures:=failures||' cost_correction:'||j::text; end if;
  begin perform pg_temp.cost(w, jsonb_build_object('kind','correction','amount',-71,'relates_to',cost1)); fail:=fail+1; failures:=failures||' cost_below_zero';
    exception when others then if sqlstate='P0001' then pass:=pass+1; else fail:=fail+1; failures:=failures||' cost_below_zero:'||sqlstate; end if; end;
  perform pg_temp.cost(w, '{"source_ref":"INV-1"}'::jsonb);
  begin perform pg_temp.cost(w, '{"source_ref":"INV-1"}'::jsonb); fail:=fail+1; failures:=failures||' cost_dup_ref';
    exception when others then if sqlstate='P0001' then pass:=pass+1; else fail:=fail+1; failures:=failures||' cost_dup_ref:'||sqlstate; end if; end;
  perform pg_temp.root();
  insert into public.revenue_events(org_id,workspace_id,kind,amount,currency,occurred_at,data_class,source,request_key,created_by)
    values(o,w,'sale',500,'EUR',now(),'manual','manual',gen_random_uuid(),um) returning id into sale;
  perform pg_temp.su(um);
  j := pg_temp.cost(w, jsonb_build_object('revenue_event_id',sale,'amount',200));
  if j->>'status'='created' then pass:=pass+1; else fail:=fail+1; failures:=failures||' per_sale:'||j::text; end if;
  begin perform pg_temp.cost(w, jsonb_build_object('revenue_event_id',sale,'category','software')); fail:=fail+1; failures:=failures||' per_sale_category';
    exception when others then if sqlstate='P0001' then pass:=pass+1; else fail:=fail+1; failures:=failures||' per_sale_category:'||sqlstate; end if; end;
  begin perform pg_temp.cost(w, jsonb_build_object('revenue_event_id',sale,'currency','USD')); fail:=fail+1; failures:=failures||' per_sale_currency';
    exception when others then if sqlstate='P0001' then pass:=pass+1; else fail:=fail+1; failures:=failures||' per_sale_currency:'||sqlstate; end if; end;
  perform pg_temp.su(uv);
  begin perform pg_temp.cost(w, '{}'::jsonb); fail:=fail+1; failures:=failures||' viewer_cost';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer_cost:'||sqlstate; end if; end;
  select count(*) into n from public.business_cost_entries where workspace_id=w;
  if n=4 then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer_reads:'||n; end if;
  perform pg_temp.su(ux);
  begin perform pg_temp.cost(w, '{}'::jsonb); fail:=fail+1; failures:=failures||' outsider_cost';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_cost:'||sqlstate; end if; end;
  select count(*) into n from public.business_cost_entries where workspace_id=w;
  if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_reads:'||n; end if;
  perform pg_temp.su(um);
  begin insert into public.business_cost_entries(org_id,workspace_id,category,kind,amount,currency,period_start,period_end,data_class,request_key,created_by)
    values(o,w,'cogs','cost',1,'EUR',m,m,'manual',gen_random_uuid(),um); fail:=fail+1; failures:=failures||' direct_cost';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' direct_cost:'||sqlstate; end if; end;
  perform pg_temp.root();
  begin update public.business_cost_entries set amount=1 where id=cost1; fail:=fail+1; failures:=failures||' cost_mutable';
    exception when others then pass:=pass+1; end;

  -- 4. cost models: editors only, versioned, insert-only
  perform pg_temp.su(um);
  begin perform public.set_cost_model(w, gen_random_uuid(), 'per_sale', null, m, ''); fail:=fail+1; failures:=failures||' member_model';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' member_model:'||sqlstate; end if; end;
  perform pg_temp.su(ue);
  begin perform public.set_cost_model(w, gen_random_uuid(), 'margin_estimate', null, m, ''); fail:=fail+1; failures:=failures||' model_no_rate';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' model_no_rate:'||sqlstate; end if; end;
  j := public.set_cost_model(w, gen_random_uuid(), 'margin_estimate', 0.4, m, 'Supplier price list');
  if j->>'status'='created' then pass:=pass+1; else fail:=fail+1; failures:=failures||' model:'||j::text; end if;

  -- 5. credit prices: Platform Owner only, never back-dated, insert-only, readable when signed in
  perform pg_temp.su(uo);
  begin perform public.set_credit_price('platform', null, 'EUR', 0.05, now() + interval '1 day', 'Test price'); fail:=fail+1; failures:=failures||' org_owner_price';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' org_owner_price:'||sqlstate; end if; end;
  perform pg_temp.su(up);
  perform public.set_credit_price('platform', null, 'EUR', 0.05, now() + interval '1 day', 'Test price');
  begin perform public.set_credit_price('platform', null, 'EUR', 0.04, now() - interval '1 day', 'Back-dated'); fail:=fail+1; failures:=failures||' backdated';
    exception when others then if sqlstate='P0001' then pass:=pass+1; else fail:=fail+1; failures:=failures||' backdated:'||sqlstate; end if; end;
  begin perform public.set_credit_price('plan', null, 'EUR', 0.04, now() + interval '1 day', 'No plan'); fail:=fail+1; failures:=failures||' plan_missing';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' plan_missing:'||sqlstate; end if; end;
  perform pg_temp.su(uv);
  select count(*) into n from public.credit_price_versions where methodology='Test price';
  if n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' price_read:'||n; end if;
  perform pg_temp.root();
  begin update public.credit_price_versions set price_per_credit=1 where methodology='Test price'; fail:=fail+1; failures:=failures||' price_mutable';
    exception when others then pass:=pass+1; end;

  -- 6. learnings
  perform pg_temp.su(um);
  insert into public.tasks(org_id,workspace_id,title,created_by,campaign_id,status) values(o,w,'Do it',um,ca,'done') returning id into t1;
  insert into public.tasks(org_id,workspace_id,title,created_by,status) values(o,w,'Other',um,'todo') returning id into t2;
  perform pg_temp.root();
  insert into public.task_runs(org_id,workspace_id,task_id,request_key,specialist_key,task_type,mode,attempt,status,estimated_credits,credits_charged,requested_by)
    values(o,w,t1,gen_random_uuid(),'seo','analysis',2,1,'succeeded',5,6,ue),(o,w,t1,gen_random_uuid(),'seo','analysis',2,2,'uncertain',5,null,ue);
  insert into public.optimization_proposals(org_id,workspace_id,campaign_id,task_id,request_key,origin,category,title,change,reason,uncertainty,expected_impact,success_measure,status,outcome,decided_at,measured_at,est_cost,currency,est_credits,level,created_by)
    values(o,w,ca,t1,gen_random_uuid(),'team','immediate','Improve','Change','Reason','Unsure','More leads','Leads','measured','improved',now() - interval '20 days',now(),100,'EUR',8,'formal',ue) returning id into pr1;
  insert into public.optimization_proposals(org_id,workspace_id,task_id,request_key,origin,category,title,change,reason,uncertainty,expected_impact,success_measure,status,level,created_by)
    values(o,w,t2,gen_random_uuid(),'team','immediate','Not done','Change','Reason','Unsure','More leads','Leads','converted','formal',ue) returning id into pr2;
  perform pg_temp.su(um);
  begin perform public.record_recommendation_learning(pr1, gen_random_uuid(), '{"outcome_class":"positive","execution_quality":"good","lesson":"Worked"}'); fail:=fail+1; failures:=failures||' member_learning';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' member_learning:'||sqlstate; end if; end;
  perform pg_temp.su(ue);
  begin perform public.record_recommendation_learning(pr1, gen_random_uuid(), '{"outcome_class":"negative","execution_quality":"good","lesson":"Contradicts"}'); fail:=fail+1; failures:=failures||' contradicting';
    exception when others then if sqlstate='P0001' then pass:=pass+1; else fail:=fail+1; failures:=failures||' contradicting:'||sqlstate; end if; end;
  begin perform public.record_recommendation_learning(pr2, gen_random_uuid(), '{"outcome_class":"positive","execution_quality":"good","lesson":"Unmeasured"}'); fail:=fail+1; failures:=failures||' unmeasured_positive';
    exception when others then if sqlstate='P0001' then pass:=pass+1; else fail:=fail+1; failures:=failures||' unmeasured_positive:'||sqlstate; end if; end;
  j := public.record_recommendation_learning(pr1, gen_random_uuid(), '{"outcome_class":"positive","execution_quality":"good","lesson":"Worked in this campaign","lever":"lead_generation","measured_change_pct":20,"actual_cost":120}');
  if j->>'status'='created' and (j->>'actual_credits')::int=6 and (j->>'days_to_result')::int=20 then pass:=pass+1; else fail:=fail+1; failures:=failures||' learning:'||j::text; end if;
  if (select uncertain_runs=1 and expected_credits=8 and task_status='done' and expected_cost=100 from public.recommendation_learnings where id=(j->>'id')::uuid) then pass:=pass+1; else fail:=fail+1; failures:=failures||' learning_facts'; end if;
  j := public.record_recommendation_learning(pr2, gen_random_uuid(), '{"outcome_class":"not_executed","execution_quality":"unknown","lesson":"Task never done","measured_change_pct":50}');
  if (select measured_change_pct is null from public.recommendation_learnings where id=(j->>'id')::uuid) then pass:=pass+1; else fail:=fail+1; failures:=failures||' unmeasured_change'; end if;
  perform pg_temp.su(ux);
  select count(*) into n from public.recommendation_learnings where workspace_id=w;
  if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_learnings:'||n; end if;
  perform pg_temp.root();
  begin update public.recommendation_learnings set lesson='x' where workspace_id=w; fail:=fail+1; failures:=failures||' learning_mutable';
    exception when others then pass:=pass+1; end;
  RESET ROLE;
  raise exception 'GROWTH_ECONOMICS_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
