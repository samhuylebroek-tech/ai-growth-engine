-- Assertions for docs/proposals/0070 (rolled back). Organization-level strategy, cross-business opportunities, shared
-- initiatives with per-business approval, allocation proposals that change nothing until applied by someone with the
-- existing business right, the paid organization AI request, cross-business isolation and single-business behaviour.
-- Refusals count only when they are a deliberate refusal (raised error, missing privilege, check or uniqueness rule);
-- any other error (missing function, bad input, broken reference) is reported as a failure with its code.
do $$
declare
  uo uuid := gen_random_uuid(); ua uuid := gen_random_uuid(); ue uuid := gen_random_uuid(); ub uuid := gen_random_uuid();
  um uuid := gen_random_uuid(); uv uuid := gen_random_uuid(); ux uuid := gen_random_uuid();
  o uuid; o2 uuid; w1 uuid; w2 uuid; w3 uuid; wx uuid; op uuid; ini uuid; ini2 uuid; c1 uuid; c2 uuid; bl uuid; bl2 uuid; pr uuid; pr2 uuid; pr3 uuid; sp uuid;
  a jsonb; r jsonb; rid uuid; k uuid; sid uuid; sid2 uuid; n int; m int; x numeric; st text; es_before text; es_after text; gs_before int; gs_after int;
  P constant text := 'rollback-fixture-only'; req uuid := gen_random_uuid(); req2 uuid := gen_random_uuid(); inp jsonb; strat jsonb;
  pass int := 0; fail int := 0; failures text := '';
begin
  execute $t$CREATE OR REPLACE FUNCTION public.verify_ai_accounting(_proof text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $b$ BEGIN IF _proof IS DISTINCT FROM 'rollback-fixture-only' THEN RAISE EXCEPTION 'server accounting verification required'; END IF; END $b$ $t$;
  execute $t$CREATE FUNCTION pg_temp.su(_u uuid) RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; PERFORM set_config('request.jwt.claims', json_build_object('sub',_u,'role','authenticated')::text, true); SET LOCAL ROLE authenticated; END $b$ $t$;
  execute $t$CREATE FUNCTION pg_temp.root() RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; END $b$ $t$;
  insert into auth.users(id,email,aud,role,instance_id) values
    (uo,'oi-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ua,'oi-admin@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ue,'oi-editor@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ub,'oi-bizadmin@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (um,'oi-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (uv,'oi-viewer@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ux,'oi-outsider@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  perform pg_temp.su(uo);
  o := public.create_organization('Org intelligence fixture','Bakery'); select id into w1 from public.workspaces where org_id=o;
  perform pg_temp.root(); update public.subscriptions set plan_key='business' where org_id=o;
  perform pg_temp.su(uo); w2 := public.create_workspace(o,'Catering'); w3 := public.create_workspace(o,'Florist');
  perform pg_temp.su(ux); o2 := public.create_organization('Single business org','Solo'); select id into wx from public.workspaces where org_id=o2;
  perform pg_temp.root();
  insert into public.organization_members(org_id,user_id,role) values(o,ua,'admin'),(o,ue,'editor'),(o,ub,'admin'),(o,um,'member'),(o,uv,'viewer');
  insert into public.workspace_members(workspace_id,user_id,role) values
    (w1,ua,'admin'),(w2,ua,'admin'),(w1,ue,'editor'),(w2,ue,'editor'),(w1,ub,'admin'),(w1,um,'member'),(w1,uv,'viewer'),(w2,uv,'viewer');
  select md5(coalesce(string_agg(to_jsonb(s)::text, ',' order by workspace_id),'')) into es_before from public.execution_settings s where org_id=o;
  select count(*) into gs_before from public.growth_strategies where org_id=o;

  -- helper: access to every business
  perform pg_temp.su(ub);
  if public.can_open_businesses(o, array[w1], 'member') and not public.can_open_businesses(o, array[w1,w2], 'viewer') then pass:=pass+1; else fail:=fail+1; failures:=failures||' can_open'; end if;
  if not public.can_open_businesses(o, array[w1,wx], 'viewer') then pass:=pass+1; else fail:=fail+1; failures:=failures||' can_open_foreign'; end if;

  -- opportunities --------------------------------------------------------------------------------------------------
  perform pg_temp.su(um);
  begin perform public.record_org_opportunity(o, jsonb_build_object('kind','cross_sell','title','x','business_ids',jsonb_build_array(w1,w2),'confidence','low')); fail:=fail+1; failures:=failures||' member_records_opp'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;
  perform pg_temp.su(ue);
  r := public.record_org_opportunity(o, jsonb_build_object('rule_key','sa:test','kind','shared_audience','title','Offices in both businesses','business_ids',jsonb_build_array(w2,w1),
    'evidence',jsonb_build_array(jsonb_build_object('text','Both profiles list office managers','class','recorded')),'confidence','medium','next_action','Check overlap'));
  op := (r->>'id')::uuid;
  if (r->>'created')::boolean and r->>'status'='hypothesis' then pass:=pass+1; else fail:=fail+1; failures:=failures||' opp_created'; end if;
  r := public.record_org_opportunity(o, jsonb_build_object('rule_key','sa:test','kind','shared_audience','title','again','business_ids',jsonb_build_array(w1,w2),'confidence','low'));
  select count(*) into n from public.org_opportunities where org_id=o;
  if not (r->>'created')::boolean and n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' opp_dedupe:'||n; end if;
  begin perform public.record_org_opportunity(o, jsonb_build_object('kind','cross_sell','title','one','business_ids',jsonb_build_array(w1),'confidence','low')); fail:=fail+1; failures:=failures||' opp_single'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;
  begin perform public.record_org_opportunity(o, jsonb_build_object('kind','cross_sell','title','bad','business_ids',jsonb_build_array(w1,w2),'confidence','low','evidence',jsonb_build_array(jsonb_build_object('text','x','class','fact')))); fail:=fail+1; failures:=failures||' opp_bad_evidence'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;
  begin perform public.record_org_opportunity(o, jsonb_build_object('kind','cross_sell','title','foreign','business_ids',jsonb_build_array(w1,wx),'confidence','low')); fail:=fail+1; failures:=failures||' opp_foreign'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;
  begin insert into public.org_opportunities(org_id,origin,kind,title,business_ids,confidence,created_by) values(o,'rule','cross_sell','direct',array[w1,w2],'low',ue); fail:=fail+1; failures:=failures||' opp_direct_insert'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;
  perform pg_temp.su(ub); select count(*) into n from public.org_opportunities where org_id=o;
  if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' opp_hidden_partial'; end if;
  perform pg_temp.su(uv); select count(*) into n from public.org_opportunities where org_id=o;
  if n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' opp_viewer_reads'; end if;
  perform pg_temp.su(ux); select count(*) into n from public.org_opportunities where org_id=o;
  if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' opp_outsider'; end if;
  perform pg_temp.su(um);
  begin perform public.set_org_opportunity_status(op,'validated',''); fail:=fail+1; failures:=failures||' member_validates'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;
  perform pg_temp.su(ue);
  r := public.set_org_opportunity_status(op,'validating','Checking customer overlap');
  if r->>'status'='validating' then pass:=pass+1; else fail:=fail+1; failures:=failures||' opp_validating'; end if;
  begin perform public.set_org_opportunity_status(op,'converted',''); fail:=fail+1; failures:=failures||' opp_manual_convert'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;

  -- shared initiatives -----------------------------------------------------------------------------------------------
  a := jsonb_build_object('title','Office lunch bundle','shared_objective','Sell catering to bakery office customers','opportunity_id',op,
    'success_metrics',jsonb_build_array(jsonb_build_object('metric','Bundle orders','target','20 per month')),'required_specialists',jsonb_build_array('marketing','sales'),
    'commitments',jsonb_build_array(
      jsonb_build_object('workspace_id',w1,'business_objective','Promote the bundle in store','budget_amount',300,'currency','EUR','tasks',jsonb_build_array(jsonb_build_object('title','Design flyer'),jsonb_build_object('title','Train staff','due_date','2026-12-15'))),
      jsonb_build_object('workspace_id',w2,'business_objective','Deliver the bundle','budget_amount',500,'currency','GBP','tasks',jsonb_build_array(jsonb_build_object('title','Set delivery slots')))));
  perform pg_temp.su(um);
  begin perform public.propose_org_initiative(o,gen_random_uuid(),a); fail:=fail+1; failures:=failures||' member_proposes'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;
  perform pg_temp.su(ub);
  begin perform public.propose_org_initiative(o,gen_random_uuid(),a); fail:=fail+1; failures:=failures||' partial_access_proposes'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;
  perform pg_temp.su(ue);
  r := public.propose_org_initiative(o,req,a); ini := (r->>'id')::uuid;
  if (r->>'created')::boolean and r->>'status'='awaiting_commitments' then pass:=pass+1; else fail:=fail+1; failures:=failures||' initiative_created'; end if;
  r := public.propose_org_initiative(o,req,a);
  select count(*) into n from public.org_initiatives where org_id=o;
  if not (r->>'created')::boolean and n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' initiative_idempotent'; end if;
  begin perform public.propose_org_initiative(o,gen_random_uuid(),jsonb_set(a,'{commitments}',jsonb_build_array(a->'commitments'->0))); fail:=fail+1; failures:=failures||' initiative_single'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;
  begin perform public.propose_org_initiative(o,gen_random_uuid(),jsonb_set(a,'{commitments}',jsonb_build_array(a->'commitments'->0,a->'commitments'->0))); fail:=fail+1; failures:=failures||' initiative_duplicate_business'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;
  select id into c1 from public.org_initiative_commitments where initiative_id=ini and workspace_id=w1;
  select id into c2 from public.org_initiative_commitments where initiative_id=ini and workspace_id=w2;
  -- a business admin of w1 only sees the initiative and its own commitment, not the other business's budget and tasks
  perform pg_temp.su(ub);
  select count(*) into n from public.org_initiatives where id=ini; select count(*) into m from public.org_initiative_commitments where initiative_id=ini;
  if n=1 and m=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' commitment_isolation:'||n||'/'||m; end if;
  perform pg_temp.su(ux); select count(*) into n from public.org_initiatives where org_id=o;
  if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' initiative_outsider'; end if;
  -- only that business's administrator decides its commitment
  perform pg_temp.su(ue);
  begin perform public.decide_org_commitment(c1,true,''); fail:=fail+1; failures:=failures||' editor_decides'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;
  perform pg_temp.su(ub);
  begin perform public.decide_org_commitment(c2,true,''); fail:=fail+1; failures:=failures||' other_business_decides'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;
  r := public.decide_org_commitment(c1,true,'Yes for the bakery');
  select count(*) into n from public.tasks where project_id=(r->>'project_id')::uuid and workspace_id=w1;
  if r->>'initiative_status'='awaiting_commitments' and n=2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' approve_w1:'||coalesce(r->>'initiative_status','?')||'/'||n; end if;
  select count(*) into n from public.projects where workspace_id=w2 and category='organization_initiative';
  if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' no_project_before_w2'; end if;
  begin perform public.decide_org_commitment(c1,false,''); fail:=fail+1; failures:=failures||' decide_twice'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;
  perform pg_temp.su(ua);
  r := public.decide_org_commitment(c2,true,'');
  select status into st from public.org_opportunities where id=op;
  if r->>'initiative_status'='committed' and st='converted' then pass:=pass+1; else fail:=fail+1; failures:=failures||' committed:'||coalesce(r->>'initiative_status','?')||'/'||st; end if;
  perform pg_temp.root();
  select count(*) into n from public.tasks t join public.projects p on p.id=t.project_id where p.category='organization_initiative' and p.org_id=o and t.workspace_id=p.workspace_id;
  select count(*) into m from public.tasks t join public.projects p on p.id=t.project_id where p.category='organization_initiative' and p.org_id=o;
  if n=3 and m=3 then pass:=pass+1; else fail:=fail+1; failures:=failures||' tasks_keep_business:'||n||'/'||m; end if;
  perform pg_temp.su(ue);
  r := public.set_org_initiative_status(ini,'active');
  if r->>'status'='active' then pass:=pass+1; else fail:=fail+1; failures:=failures||' initiative_active'; end if;
  begin perform public.set_org_initiative_status(ini,'awaiting_commitments'); fail:=fail+1; failures:=failures||' initiative_back'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;
  -- one business declines: the initiative is declined and the other cannot commit any more
  r := public.propose_org_initiative(o,gen_random_uuid(),a - 'opportunity_id'); ini2 := (r->>'id')::uuid;
  select id into c1 from public.org_initiative_commitments where initiative_id=ini2 and workspace_id=w1;
  select id into c2 from public.org_initiative_commitments where initiative_id=ini2 and workspace_id=w2;
  perform pg_temp.su(ub); r := public.decide_org_commitment(c1,false,'Not this quarter');
  if r->>'initiative_status'='declined' then pass:=pass+1; else fail:=fail+1; failures:=failures||' declined'; end if;
  perform pg_temp.su(ua);
  begin perform public.decide_org_commitment(c2,true,''); fail:=fail+1; failures:=failures||' commit_after_decline'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;

  -- allocation proposals: budget shift -------------------------------------------------------------------------------
  perform pg_temp.root();
  insert into public.budget_lines(org_id,workspace_id,channel,period_month,planned,actual,currency,created_by) values(o,w1,'Google Ads',date_trunc('month',current_date)::date,1000,200,'EUR',uo) returning id into bl;
  perform pg_temp.su(um);
  begin perform public.propose_org_allocation(o,gen_random_uuid(),'budget_shift','Move','Reason',jsonb_build_object('from_line',bl,'to_workspace',w2,'amount',100)); fail:=fail+1; failures:=failures||' member_allocates'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;
  perform pg_temp.su(ue);
  begin perform public.propose_org_allocation(o,gen_random_uuid(),'budget_shift','Move','Reason',jsonb_build_object('from_line',bl,'to_workspace',w2,'amount',900)); fail:=fail+1; failures:=failures||' more_than_unspent'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;
  begin perform public.propose_org_allocation(o,gen_random_uuid(),'budget_shift','Move','Reason',jsonb_build_object('from_line',bl,'to_workspace',wx,'amount',100)); fail:=fail+1; failures:=failures||' to_foreign'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;
  r := public.propose_org_allocation(o,gen_random_uuid(),'budget_shift','Move 300 EUR to catering','Bakery under-spends; catering is over plan',jsonb_build_object('from_line',bl,'to_workspace',w2,'amount',300)); pr := (r->>'id')::uuid;
  select planned into x from public.budget_lines where id=bl;
  if r->>'status'='pending' and x=1000 then pass:=pass+1; else fail:=fail+1; failures:=failures||' proposal_changes_nothing'; end if;
  perform pg_temp.su(ub); select count(*) into n from public.org_allocation_proposals where id=pr;
  if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' proposal_hidden_partial'; end if;
  begin perform public.decide_org_allocation(pr,'apply',''); fail:=fail+1; failures:=failures||' partial_applies'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;
  perform pg_temp.su(uv);
  begin perform public.decide_org_allocation(pr,'apply',''); fail:=fail+1; failures:=failures||' viewer_applies'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;
  perform pg_temp.su(ua);
  begin perform public.decide_org_allocation(pr,'withdraw',''); fail:=fail+1; failures:=failures||' other_withdraws'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;
  perform pg_temp.su(ue);
  r := public.decide_org_allocation(pr,'apply','Agreed in monthly review');
  perform pg_temp.root();
  select planned into x from public.budget_lines where id=bl;
  select count(*), sum(planned) into n, m from public.budget_lines where workspace_id=w2 and org_id=o and currency='EUR' and channel='Google Ads';
  if r->>'status'='applied' and x=700 and n=1 and m=300 then pass:=pass+1; else fail:=fail+1; failures:=failures||' shift_applied:'||x||'/'||n||'/'||coalesce(m,0); end if;
  select sum(planned) into x from public.budget_lines where org_id=o and channel='Google Ads';
  if x=1000 then pass:=pass+1; else fail:=fail+1; failures:=failures||' shift_preserves_total'; end if;
  perform pg_temp.su(ue);
  begin perform public.decide_org_allocation(pr,'apply',''); fail:=fail+1; failures:=failures||' apply_twice'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;
  r := public.propose_org_allocation(o,gen_random_uuid(),'budget_shift','Move more','Reason',jsonb_build_object('from_line',bl,'to_workspace',w2,'amount',400)); pr2 := (r->>'id')::uuid;
  perform pg_temp.root(); update public.budget_lines set actual=600 where id=bl;
  perform pg_temp.su(ue);
  begin perform public.decide_org_allocation(pr2,'apply',''); fail:=fail+1; failures:=failures||' stale_line'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;
  r := public.decide_org_allocation(pr2,'reject','Spent in the meantime');
  select planned into x from public.budget_lines where id=bl;
  if r->>'status'='rejected' and x=700 then pass:=pass+1; else fail:=fail+1; failures:=failures||' reject_changes_nothing'; end if;
  -- specialist capacity (monthly credit cap): needs the business administrator
  r := public.propose_org_allocation(o,gen_random_uuid(),'specialist_capacity','Cap SEO in bakery','Low use this month',jsonb_build_object('workspace',w1,'specialist','seo','enabled',true,'cap',50)); pr3 := (r->>'id')::uuid;
  begin perform public.decide_org_allocation(pr3,'apply',''); fail:=fail+1; failures:=failures||' editor_sets_cap'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;
  perform pg_temp.su(ub);
  r := public.decide_org_allocation(pr3,'apply','');
  perform pg_temp.root(); select monthly_credit_cap into n from public.specialist_allocations where workspace_id=w1 and specialist_key='seo';
  if r->>'status'='applied' and n=50 then pass:=pass+1; else fail:=fail+1; failures:=failures||' cap_applied:'||coalesce(n,-1); end if;

  -- Organization Growth Officer request --------------------------------------------------------------------------------
  inp := jsonb_build_object('request','Organization growth strategy','businesses',jsonb_build_array(w1,w2),'horizonMonths',6);
  perform pg_temp.su(ue);
  begin perform public.begin_org_ai_request_verified(o,w1,gen_random_uuid(),inp,P); fail:=fail+1; failures:=failures||' editor_starts_org_ai'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;
  perform pg_temp.su(ub);
  begin perform public.begin_org_ai_request_verified(o,w1,gen_random_uuid(),inp,P); fail:=fail+1; failures:=failures||' partial_admin_org_ai'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;
  perform pg_temp.su(ua);
  begin perform public.begin_org_ai_request_verified(o,w1,gen_random_uuid(),inp,'forged'); fail:=fail+1; failures:=failures||' org_ai_forged'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;
  begin perform public.begin_org_ai_request_verified(o,w1,gen_random_uuid(),jsonb_set(inp,'{businesses}',jsonb_build_array(w1)),P); fail:=fail+1; failures:=failures||' org_ai_single'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;
  begin perform public.begin_org_ai_request_verified(o,w3,gen_random_uuid(),inp,P); fail:=fail+1; failures:=failures||' org_ai_anchor_outside'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;
  a := public.begin_org_ai_request_verified(o,w1,req,inp,P); rid := (a->>'run_id')::uuid;
  if (a->>'claimed')::boolean and a->>'kind'='organization' then pass:=pass+1; else fail:=fail+1; failures:=failures||' org_ai_claimed'; end if;
  a := public.begin_org_ai_request_verified(o,w1,req,inp,P);
  if not (a->>'claimed')::boolean then pass:=pass+1; else fail:=fail+1; failures:=failures||' org_ai_idempotent'; end if;
  perform public.reserve_ai_credits(rid,20);
  k := public.claim_ai_dispatch_verified(rid,P);
  perform public.record_ai_delivery_verified(rid,k,'{"title":"Org plan"}','qa-simulation','qa-simulation',100,200,0,2,'qa-only',P);
  strat := jsonb_build_object('title','Grow together in 2027','summary','Bakery and catering share office customers.','objectives',jsonb_build_array('Grow office revenue'),
    'opportunities',jsonb_build_array(
      jsonb_build_object('kind','cross_sell','title','Catering for bakery office clients','business_ids',jsonb_build_array(w1,w2),'evidence',jsonb_build_array(jsonb_build_object('text','Shared audience in profiles','class','recorded')),'confidence','medium','expected_impact','Estimate only','next_action','Validate with 5 customers'),
      jsonb_build_object('kind','cross_sell','title','Includes a business outside the analysis','business_ids',jsonb_build_array(w1,w3),'confidence','low'),
      jsonb_build_object('kind','not_a_kind','title','Invalid kind','business_ids',jsonb_build_array(w1,w2),'confidence','low')));
  perform pg_temp.su(ue);
  begin perform public.finish_org_strategy_verified((a->>'id')::uuid,'reply',strat,P); fail:=fail+1; failures:=failures||' other_finishes'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;
  perform pg_temp.su(ua);
  r := public.finish_org_strategy_verified((a->>'id')::uuid,'reply',strat,P); sid := (r->>'strategy_id')::uuid;
  if (r->>'version')::int=1 and (r->>'opportunities')::int=1 and not (r->>'replayed')::boolean then pass:=pass+1; else fail:=fail+1; failures:=failures||' finish:'||r::text; end if;
  r := public.finish_org_strategy_verified((a->>'id')::uuid,'reply',strat,P);
  select count(*) into n from public.org_strategies where org_id=o;
  if (r->>'replayed')::boolean and n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' finish_replay'; end if;
  perform pg_temp.root();
  select summary into st from public.agent_runs where id=rid;
  if st='Organization strategy draft v1' then pass:=pass+1; else fail:=fail+1; failures:=failures||' run_summary_private'; end if;
  select count(*) into n from public.org_opportunities where strategy_id=sid and origin='ai' and status='hypothesis';
  if n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' ai_opps_hypotheses:'||n; end if;
  select count(*) into n from public.org_strategies where id=sid and body ? 'opportunities';
  if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' body_without_opps'; end if;
  -- visibility of the strategy
  perform pg_temp.su(ub); select count(*) into n from public.org_strategies where org_id=o;
  if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' strategy_hidden_partial'; end if;
  perform pg_temp.su(uv); select count(*) into n from public.org_strategies where org_id=o;
  if n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' strategy_viewer'; end if;
  perform pg_temp.su(ux); select count(*) into n from public.org_strategies where org_id=o;
  if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' strategy_outsider'; end if;
  -- approval: organization admins with access to every covered business only
  perform pg_temp.su(ue);
  begin perform public.decide_org_strategy(sid,'approve',''); fail:=fail+1; failures:=failures||' editor_approves'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;
  perform pg_temp.su(ub);
  begin perform public.decide_org_strategy(sid,'approve',''); fail:=fail+1; failures:=failures||' partial_admin_approves'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;
  perform pg_temp.su(ua);
  r := public.decide_org_strategy(sid,'approve','Reference for 2027');
  if r->>'status'='approved' then pass:=pass+1; else fail:=fail+1; failures:=failures||' approved'; end if;
  -- a second paid draft, approved, supersedes the first
  a := public.begin_org_ai_request_verified(o,w2,req2,inp,P); rid := (a->>'run_id')::uuid;
  perform public.reserve_ai_credits(rid,20); k := public.claim_ai_dispatch_verified(rid,P);
  perform public.record_ai_delivery_verified(rid,k,'{"title":"Org plan 2"}','qa-simulation','qa-simulation',100,200,0,2,'qa-only',P);
  r := public.finish_org_strategy_verified((a->>'id')::uuid,'reply',strat - 'opportunities',P); sid2 := (r->>'strategy_id')::uuid;
  perform public.decide_org_strategy(sid2,'approve','');
  select status into st from public.org_strategies where id=sid;
  select count(*) into n from public.org_strategies where org_id=o and status='approved';
  if st='superseded' and n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' supersede:'||st||'/'||n; end if;
  begin perform public.decide_org_strategy(sid,'approve',''); fail:=fail+1; failures:=failures||' reapprove_superseded'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;

  -- business-level autonomy and strategies untouched; decision history in the append-only audit log
  perform pg_temp.root();
  select md5(coalesce(string_agg(to_jsonb(s)::text, ',' order by workspace_id),'')) into es_after from public.execution_settings s where org_id=o;
  select count(*) into gs_after from public.growth_strategies where org_id=o;
  if es_before=es_after and gs_before=gs_after then pass:=pass+1; else fail:=fail+1; failures:=failures||' business_level_untouched'; end if;
  select count(*) into n from public.audit_logs where org_id=o and action like 'org.%';
  if n>=15 then pass:=pass+1; else fail:=fail+1; failures:=failures||' audit_trail:'||n; end if;
  perform pg_temp.su(ua);
  begin update public.audit_logs set action='x' where org_id=o and action like 'org.%'; get diagnostics n = row_count; if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' audit_mutable'; end if; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;

  -- single-business organization: no organization-level AI or cross-business records
  perform pg_temp.su(ux);
  begin perform public.begin_org_ai_request_verified(o2,wx,gen_random_uuid(),jsonb_build_object('request','x','businesses',jsonb_build_array(wx)),P); fail:=fail+1; failures:=failures||' single_org_ai'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;
  begin perform public.record_org_opportunity(o2, jsonb_build_object('kind','cross_sell','title','x','business_ids',jsonb_build_array(wx),'confidence','low')); fail:=fail+1; failures:=failures||' single_org_opp'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;
  -- outsiders cannot act on another organization's records
  begin perform public.set_org_opportunity_status(op,'dismissed',''); fail:=fail+1; failures:=failures||' outsider_status'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;
  begin perform public.decide_org_allocation(pr3,'reject',''); fail:=fail+1; failures:=failures||' outsider_decides'; exception when others then if sqlstate in ('P0001','42501','23514','23505') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,80); end if; end;

  -- privileges: no anonymous access, no direct writes
  perform pg_temp.root();
  if not has_table_privilege('anon','public.org_strategies','select') and not has_table_privilege('anon','public.org_initiative_commitments','select')
     and not has_table_privilege('authenticated','public.org_allocation_proposals','insert') and not has_table_privilege('authenticated','public.org_initiatives','update')
     and not has_function_privilege('anon','public.begin_org_ai_request_verified(uuid,uuid,uuid,jsonb,text)','execute') then pass:=pass+1; else fail:=fail+1; failures:=failures||' privileges'; end if;
  raise exception 'ORG_INTELLIGENCE_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
