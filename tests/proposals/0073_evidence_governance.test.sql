-- Assertions for docs/proposals/0073 (rolled back): evidence types are enforced against real records, AI output can
-- never be a fact or count as independent evidence, content is immutable and versioned, history is append-only, and
-- improvement proposals obey their level (observation / formal / execution) with review and inspected evidence.
do $$
declare
  uo uuid := gen_random_uuid(); ue uuid := gen_random_uuid(); um uuid := gen_random_uuid(); uv uuid := gen_random_uuid();
  ux uuid := gen_random_uuid(); u2 uuid := gen_random_uuid();
  o uuid; w1 uuid; w2 uuid; fv uuid; fu uuid; f2 uuid; sale uuid; bl uuid; bl2 uuid;
  e1 uuid; e2 uuid; e3 uuid; e4 uuid; e5 uuid; e6 uuid; ex uuid; p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid; p6 uuid; j jsonb; n int;
  pass int := 0; fail int := 0; failures text := '';
  procedure_ok boolean;
begin
  execute $t$CREATE FUNCTION pg_temp.su(_u uuid) RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; PERFORM set_config('request.jwt.claims', json_build_object('sub',_u,'role','authenticated')::text, true); SET LOCAL ROLE authenticated; END $b$ $t$;
  execute $t$CREATE FUNCTION pg_temp.root() RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; END $b$ $t$;
  insert into auth.users(id,email,aud,role,instance_id) values
    (uo,'ev-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ue,'ev-editor@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (um,'ev-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (uv,'ev-viewer@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ux,'ev-outsider@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (u2,'ev-other-business@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  perform pg_temp.su(uo);
  o := public.create_organization('Evidence fixture','Bakery'); select id into w1 from public.workspaces where org_id=o;
  perform pg_temp.root(); update public.subscriptions set plan_key='business' where org_id=o;
  perform pg_temp.su(uo); w2 := public.create_workspace(o,'Catering');
  perform pg_temp.root();
  insert into public.organization_members(org_id,user_id,role) values(o,ue,'editor'),(o,um,'member'),(o,uv,'viewer'),(o,u2,'member');
  insert into public.workspace_members(workspace_id,user_id,role) values(w1,ue,'editor'),(w1,um,'member'),(w1,uv,'viewer'),(w2,u2,'member');
  insert into public.business_facts(org_id,workspace_id,key,value,source_type,verified) values(o,w1,'avg_order','42 EUR','user',true) returning id into fv;
  insert into public.business_facts(org_id,workspace_id,key,value,source_type,verified) values(o,w1,'repeat_rate','30%','ai_assumption',false) returning id into fu;
  insert into public.business_facts(org_id,workspace_id,key,value,source_type,verified) values(o,w2,'avg_order','80 EUR','user',true) returning id into f2;
  insert into public.revenue_events(org_id,workspace_id,kind,amount,currency,occurred_at,data_class,source,source_ref,request_key,created_by)
    values(o,w1,'sale',120,'EUR',now() - interval '10 days','imported','stripe','inv-ev-1',gen_random_uuid(),uo) returning id into sale;
  insert into public.budget_lines(org_id,workspace_id,channel,period_month,planned,actual,currency,created_by) values(o,w1,'Search',date_trunc('month',now())::date,100,130,'EUR',uo) returning id into bl;
  insert into public.budget_lines(org_id,workspace_id,channel,period_month,planned,actual,currency,created_by) values(o,w2,'Search',date_trunc('month',now())::date,100,130,'EUR',uo) returning id into bl2;

  -- 1 types are checked against real records of the same business
  perform pg_temp.su(um);
  j := public.record_evidence(w1, gen_random_uuid(), jsonb_build_object('type','verified_fact','description','Average order is 42 EUR','source_kind','business_fact','source_ref',fv::text,'origin','user'));
  e1 := (j->>'evidence_id')::uuid;
  if j->>'status' = 'classified' and j->>'reliability' = 'high' then pass:=pass+1; else fail:=fail+1; failures:=failures||' fact_recorded'; end if;
  begin perform public.record_evidence(w1, gen_random_uuid(), jsonb_build_object('type','verified_fact','description','Repeat rate 30%','source_kind','business_fact','source_ref',fu::text,'origin','user'));
    fail:=fail+1; failures:=failures||' unverified_fact_accepted'; exception when others then if sqlstate='23514' then pass:=pass+1; else fail:=fail+1; failures:=failures||' unverified:'||sqlstate; end if; end;
  begin perform public.record_evidence(w1, gen_random_uuid(), jsonb_build_object('type','verified_fact','description','AI says 42','source_kind','business_fact','source_ref',fv::text,'origin','ai'));
    fail:=fail+1; failures:=failures||' ai_fact_accepted'; exception when others then if sqlstate='23514' then pass:=pass+1; else fail:=fail+1; failures:=failures||' ai_fact:'||sqlstate; end if; end;
  begin perform public.record_evidence(w1, gen_random_uuid(), jsonb_build_object('type','verified_fact','description','Other business fact','source_kind','business_fact','source_ref',f2::text,'origin','user'));
    fail:=fail+1; failures:=failures||' cross_business_fact'; exception when others then if sqlstate='23514' then pass:=pass+1; else fail:=fail+1; failures:=failures||' cross_fact:'||sqlstate; end if; end;
  begin perform public.record_evidence(w1, gen_random_uuid(), jsonb_build_object('type','verified_fact','description','No record','source_kind','user_statement','source_ref','','origin','user'));
    fail:=fail+1; failures:=failures||' fact_without_record'; exception when others then if sqlstate='23514' then pass:=pass+1; else fail:=fail+1; failures:=failures||' no_record:'||sqlstate; end if; end;
  begin perform public.record_evidence(w1, gen_random_uuid(), jsonb_build_object('type','measured_observation','description','Sale without period','source_kind','revenue_event','source_ref',sale::text,'origin','rule'));
    fail:=fail+1; failures:=failures||' measurement_without_period'; exception when others then if sqlstate='23514' then pass:=pass+1; else fail:=fail+1; failures:=failures||' period:'||sqlstate; end if; end;
  j := public.record_evidence(w1, gen_random_uuid(), jsonb_build_object('type','measured_observation','description','Imported sale of 120 EUR','source_kind','revenue_event','source_ref',sale::text,'origin','rule','period_start',(current_date-30)::text,'period_end',current_date::text));
  e2 := (j->>'evidence_id')::uuid;
  if j->>'reliability' = 'high' then pass:=pass+1; else fail:=fail+1; failures:=failures||' imported_measurement_reliability'; end if;
  j := public.record_evidence(w1, gen_random_uuid(), jsonb_build_object('type','estimate','description','AI estimates 15% more orders','source_kind','ai_analysis','origin','ai'));
  e3 := (j->>'evidence_id')::uuid;
  if j->>'reliability' = 'low' then pass:=pass+1; else fail:=fail+1; failures:=failures||' ai_estimate'; end if;
  j := public.record_evidence(w1, gen_random_uuid(), jsonb_build_object('description','Competitor launched delivery','source_kind','website','source_ref','https://example.com','origin','user'));
  e4 := (j->>'evidence_id')::uuid;
  if j->>'status' = 'discovered' then pass:=pass+1; else fail:=fail+1; failures:=failures||' discovered'; end if;
  j := public.advance_evidence(e4, 'classify', '{"type":"hypothesis"}');
  if j->>'status' = 'classified' and (select count(*) from public.evidence_events where evidence_id=e4) = 2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' classified'; end if;
  -- a budget line is a measured observation of entered spend (medium), never a verified fact
  j := public.record_evidence(w1, gen_random_uuid(), jsonb_build_object('type','measured_observation','description','Search spend 130 of 100 planned','source_kind','budget_line','source_ref',bl::text,'origin','rule','period_start',date_trunc('month',now())::date::text,'period_end',current_date::text));
  if j->>'reliability' = 'medium' then pass:=pass+1; else fail:=fail+1; failures:=failures||' budget_observation'; end if;
  begin perform public.record_evidence(w1, gen_random_uuid(), jsonb_build_object('type','verified_fact','description','Budget as fact','source_kind','budget_line','source_ref',bl::text,'origin','user'));
    fail:=fail+1; failures:=failures||' budget_fact'; exception when others then if sqlstate='23514' then pass:=pass+1; else fail:=fail+1; failures:=failures||' budget_fact:'||sqlstate; end if; end;
  begin perform public.record_evidence(w1, gen_random_uuid(), jsonb_build_object('type','measured_observation','description','Other business budget','source_kind','budget_line','source_ref',bl2::text,'origin','rule','period_start',current_date::text,'period_end',current_date::text));
    fail:=fail+1; failures:=failures||' cross_business_budget'; exception when others then if sqlstate='23514' then pass:=pass+1; else fail:=fail+1; failures:=failures||' cross_budget:'||sqlstate; end if; end;
  -- the same request key twice is one item
  j := public.record_evidence(w1, (select request_key from public.evidence_items where id=e1), jsonb_build_object('type','estimate','description','dup','source_kind','other','origin','user'));
  if j->>'status' = 'existing' and (j->>'evidence_id')::uuid = e1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' idempotent'; end if;

  -- 2 roles and isolation
  perform pg_temp.su(uv);
  begin perform public.record_evidence(w1, gen_random_uuid(), '{"type":"assumption","description":"x","source_kind":"other","origin":"user"}');
    fail:=fail+1; failures:=failures||' viewer_recorded'; exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer:'||sqlstate; end if; end;
  if (select count(*) from public.evidence_items where workspace_id=w1) = 5 then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer_reads'; end if;
  perform pg_temp.su(ux);
  if (select count(*) from public.evidence_items) = 0 and (select count(*) from public.evidence_events) = 0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_reads'; end if;
  perform pg_temp.su(u2);
  if (select count(*) from public.evidence_items where workspace_id=w1) = 0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' other_business_reads'; end if;
  begin perform public.advance_evidence(e1, 'review', '{}'); fail:=fail+1; failures:=failures||' other_business_advanced';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' other_adv:'||sqlstate; end if; end;
  perform pg_temp.su(um);
  begin perform public.advance_evidence(e1, 'accept', '{}'); fail:=fail+1; failures:=failures||' member_accepted';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' member_acc:'||sqlstate; end if; end;
  perform public.advance_evidence(e1, 'review', '{"note":"checked the fact"}');
  perform pg_temp.su(ue);
  perform public.advance_evidence(e1, 'accept', '{}'); perform public.advance_evidence(e2, 'accept', '{}'); perform public.advance_evidence(e3, 'accept', '{}');
  if (select status from public.evidence_items where id=e1) = 'accepted' then pass:=pass+1; else fail:=fail+1; failures:=failures||' accepted'; end if;
  begin perform public.advance_evidence(e1, 'reject', '{}'); fail:=fail+1; failures:=failures||' redecided';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' redecide:'||sqlstate; end if; end;
  begin update public.evidence_items set description='rewritten' where id=e1; fail:=fail+1; failures:=failures||' client_update';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' client_upd:'||sqlstate; end if; end;

  -- 3 immutability, versions, append-only history (even for the database owner)
  perform pg_temp.root();
  begin update public.evidence_items set description='rewritten' where id=e1; fail:=fail+1; failures:=failures||' owner_rewrite';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' owner_rw:'||sqlstate; end if; end;
  begin delete from public.evidence_items where id=e4; fail:=fail+1; failures:=failures||' deleted';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' delete:'||sqlstate; end if; end;
  begin update public.evidence_events set note='x' where evidence_id=e1; fail:=fail+1; failures:=failures||' history_edited';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' history:'||sqlstate; end if; end;
  begin update public.evidence_items set status='classified' where id=e1; fail:=fail+1; failures:=failures||' status_backwards';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' backwards:'||sqlstate; end if; end;
  perform pg_temp.su(um);
  j := public.revise_evidence(e4, gen_random_uuid(), '{"type":"hypothesis","description":"Competitor launched delivery in two cities","source_kind":"website","source_ref":"https://example.com","origin":"user"}', 'scope corrected');
  e5 := (j->>'evidence_id')::uuid;
  if (j->>'version')::int = 2 and (select status from public.evidence_items where id=e4) = 'reevaluated' and (select superseded_by from public.evidence_items where id=e4) = e5
     and (select description from public.evidence_items where id=e4) = 'Competitor launched delivery' then pass:=pass+1; else fail:=fail+1; failures:=failures||' versioned'; end if;
  begin perform public.revise_evidence(e4, gen_random_uuid(), '{"type":"hypothesis","description":"again","source_kind":"other","origin":"user"}', 'again');
    fail:=fail+1; failures:=failures||' revised_old'; exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' revise_old:'||sqlstate; end if; end;
  begin perform public.revise_evidence(e5, gen_random_uuid(), '{"type":"hypothesis","description":"x","source_kind":"other","origin":"user"}', '');
    fail:=fail+1; failures:=failures||' revised_without_reason'; exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' reason:'||sqlstate; end if; end;

  -- 4 observation level: no evidence needed, never work
  j := public.create_optimization_proposal(w1, gen_random_uuid(), '{"level":"observation","origin":"team","category":"opportunity","title":"Delivery demand","change":"Look into delivery","reason":"Customers asked","uncertainty":"Anecdotal","expected_impact":"Unknown","success_measure":"Orders"}');
  p1 := (j->>'proposal_id')::uuid;
  perform pg_temp.su(uo);
  begin perform public.advance_optimization_proposal(p1, 'approve', '{"seen_evidence":[]}'); fail:=fail+1; failures:=failures||' observation_approved';
    exception when others then if sqlstate='23514' then pass:=pass+1; else fail:=fail+1; failures:=failures||' obs_approve:'||sqlstate; end if; end;
  begin perform public.advance_optimization_proposal(p1, 'convert', '{}'); fail:=fail+1; failures:=failures||' observation_converted';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' obs_convert:'||sqlstate; end if; end;
  begin perform public.advance_optimization_proposal(p1, 'review', '{}'); fail:=fail+1; failures:=failures||' observation_reviewed';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' obs_review:'||sqlstate; end if; end;
  perform pg_temp.su(um);
  j := public.advance_optimization_proposal(p1, 'promote', '{}');
  if j->>'level' = 'formal' then pass:=pass+1; else fail:=fail+1; failures:=failures||' promoted'; end if;

  -- 5 formal level: needs review + accepted independent evidence or an explicit gap reason
  perform pg_temp.su(ue); perform public.advance_optimization_proposal(p1, 'review', '{}');
  perform pg_temp.su(uo);
  begin perform public.advance_optimization_proposal(p1, 'approve', '{"seen_evidence":[]}'); fail:=fail+1; failures:=failures||' formal_without_evidence';
    exception when others then if sqlstate='23514' then pass:=pass+1; else fail:=fail+1; failures:=failures||' formal_none:'||sqlstate; end if; end;
  perform pg_temp.su(um);
  j := public.create_optimization_proposal(w1, gen_random_uuid(), jsonb_build_object('origin','growth_officer','category','strategic','title','AI only','change','c','reason','r','uncertainty','u','expected_impact','i','success_measure','m','evidence_ids',jsonb_build_array(e3)));
  p2 := (j->>'proposal_id')::uuid;
  if (select level from public.optimization_proposals where id=p2) = 'formal' then pass:=pass+1; else fail:=fail+1; failures:=failures||' default_formal'; end if;
  perform pg_temp.su(ue); perform public.advance_optimization_proposal(p2, 'review', '{}');
  perform pg_temp.su(uo);
  begin perform public.advance_optimization_proposal(p2, 'approve', jsonb_build_object('seen_evidence', jsonb_build_array(e3))); fail:=fail+1; failures:=failures||' ai_evidence_counted';
    exception when others then if sqlstate='23514' then pass:=pass+1; else fail:=fail+1; failures:=failures||' ai_counted:'||sqlstate; end if; end;
  perform pg_temp.su(um);
  j := public.create_optimization_proposal(w1, gen_random_uuid(), '{"origin":"team","category":"experiment","title":"Gap explained","change":"c","reason":"r","uncertainty":"u","expected_impact":"i","success_measure":"m","evidence_gap_reason":"No tracking connected yet"}');
  p3 := (j->>'proposal_id')::uuid;
  perform pg_temp.su(uo);
  begin perform public.advance_optimization_proposal(p3, 'approve', '{"seen_evidence":[]}'); fail:=fail+1; failures:=failures||' approved_without_review';
    exception when others then if sqlstate='23514' then pass:=pass+1; else fail:=fail+1; failures:=failures||' no_review:'||sqlstate; end if; end;
  perform public.advance_optimization_proposal(p3, 'review', '{}');
  j := public.advance_optimization_proposal(p3, 'approve', '{"seen_evidence":[]}');
  if j->>'status' = 'approved' then pass:=pass+1; else fail:=fail+1; failures:=failures||' gap_approved'; end if;
  -- supported by an accepted fact: review, then approval must name exactly what was inspected
  perform pg_temp.su(um);
  j := public.create_optimization_proposal(w1, gen_random_uuid(), jsonb_build_object('origin','rule','category','problem','title','Supported','change','c','reason','r','uncertainty','u','expected_impact','i','success_measure','m','evidence_ids',jsonb_build_array(e1)));
  p4 := (j->>'proposal_id')::uuid;
  perform pg_temp.su(um);
  begin perform public.advance_optimization_proposal(p4, 'review', '{}'); fail:=fail+1; failures:=failures||' member_reviewed';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' member_review:'||sqlstate; end if; end;
  perform pg_temp.su(ue); perform public.advance_optimization_proposal(p4, 'review', '{}');
  begin perform public.advance_optimization_proposal(p4, 'approve', jsonb_build_object('seen_evidence', jsonb_build_array(e1))); fail:=fail+1; failures:=failures||' editor_approved';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' editor_approve:'||sqlstate; end if; end;
  perform pg_temp.su(um);
  perform public.link_proposal_evidence(p4, e2, 'supports');
  if (select reviewed_at from public.optimization_proposals where id=p4) is null then pass:=pass+1; else fail:=fail+1; failures:=failures||' review_kept_after_new_evidence'; end if;
  begin perform public.link_proposal_evidence(p4, e4, 'supports'); fail:=fail+1; failures:=failures||' linked_old_version';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' old_version:'||sqlstate; end if; end;
  perform pg_temp.su(u2);
  j := public.record_evidence(w2, gen_random_uuid(), '{"type":"assumption","description":"other business","source_kind":"other","origin":"user"}');
  ex := (j->>'evidence_id')::uuid;
  perform pg_temp.su(um);
  begin perform public.link_proposal_evidence(p4, ex, 'supports'); fail:=fail+1; failures:=failures||' cross_business_link';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' cross_link:'||sqlstate; end if; end;
  perform pg_temp.su(ue); perform public.advance_optimization_proposal(p4, 'review', '{}');
  perform pg_temp.su(uo);
  begin perform public.advance_optimization_proposal(p4, 'approve', jsonb_build_object('seen_evidence', jsonb_build_array(e1))); fail:=fail+1; failures:=failures||' stale_evidence_approved';
    exception when others then if sqlstate='40001' then pass:=pass+1; else fail:=fail+1; failures:=failures||' stale:'||sqlstate; end if; end;
  begin perform public.advance_optimization_proposal(p4, 'approve', '{}'); fail:=fail+1; failures:=failures||' approved_without_inspection';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' inspect:'||sqlstate; end if; end;
  j := public.advance_optimization_proposal(p4, 'approve', jsonb_build_object('seen_evidence', jsonb_build_array(e2, e1)));
  if j->>'status' = 'approved' and (select status from public.evidence_items where id=e1) = 'used_in_decision'
     and exists (select 1 from public.evidence_events where evidence_id=e1 and action='used_in_decision' and proposal_id=p4) then pass:=pass+1; else fail:=fail+1; failures:=failures||' used_in_decision'; end if;
  begin perform public.link_proposal_evidence(p4, e5, 'supports'); fail:=fail+1; failures:=failures||' linked_after_decision';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' after_decision:'||sqlstate; end if; end;

  -- 6 execution level: every decision field and a record-backed fact or measurement
  perform pg_temp.su(um);
  begin perform public.create_optimization_proposal(w1, gen_random_uuid(), '{"level":"execution","origin":"team","category":"immediate","title":"Incomplete","change":"c","reason":"r","uncertainty":"u","expected_impact":"i","success_measure":"m"}');
    fail:=fail+1; failures:=failures||' incomplete_execution'; exception when others then if sqlstate='23514' then pass:=pass+1; else fail:=fail+1; failures:=failures||' incomplete:'||sqlstate; end if; end;
  j := public.record_evidence(w1, gen_random_uuid(), '{"type":"estimate","description":"Team estimate 20 extra orders","source_kind":"user_statement","source_ref":"sales meeting 2026-11-12","origin":"user"}');
  e6 := (j->>'evidence_id')::uuid;
  perform pg_temp.su(ue); perform public.advance_evidence(e6, 'accept', '{}');
  perform pg_temp.su(um);
  j := public.create_optimization_proposal(w1, gen_random_uuid(), jsonb_build_object('level','execution','origin','team','category','immediate','title','Execution','change','c','reason','r','uncertainty','u','expected_impact','+20 orders','success_measure','orders',
    'objective','More repeat orders','risk','Low','measurement_method','Compare monthly orders','approval_requirement','Business admin','business_context','Bakery, one shop','est_credits',4,'evidence_ids',jsonb_build_array(e6)));
  p5 := (j->>'proposal_id')::uuid;
  perform pg_temp.su(ue); perform public.advance_optimization_proposal(p5, 'review', '{}');
  perform pg_temp.su(uo);
  begin perform public.advance_optimization_proposal(p5, 'approve', jsonb_build_object('seen_evidence', jsonb_build_array(e6))); fail:=fail+1; failures:=failures||' execution_on_estimate';
    exception when others then if sqlstate='23514' then pass:=pass+1; else fail:=fail+1; failures:=failures||' exec_estimate:'||sqlstate; end if; end;
  perform pg_temp.su(um);
  j := public.create_optimization_proposal(w1, gen_random_uuid(), jsonb_build_object('level','execution','origin','team','category','immediate','title','Execution backed','change','c','reason','r','uncertainty','u','expected_impact','+20 orders','success_measure','orders',
    'objective','More repeat orders','risk','Low','measurement_method','Compare monthly orders','approval_requirement','Business admin','business_context','Bakery, one shop','est_cost','50','currency','EUR','evidence_ids',jsonb_build_array(e2)));
  p6 := (j->>'proposal_id')::uuid;
  perform pg_temp.su(ue); perform public.advance_optimization_proposal(p6, 'review', '{}');
  perform pg_temp.su(uo);
  j := public.advance_optimization_proposal(p6, 'approve', jsonb_build_object('seen_evidence', jsonb_build_array(e2)));
  j := public.advance_optimization_proposal(p6, 'convert', '{}');
  if j->>'status' = 'converted' and exists (select 1 from public.tasks where id = (j->>'task_id')::uuid and workspace_id = w1) then pass:=pass+1; else fail:=fail+1; failures:=failures||' execution_converted'; end if;
  if exists (select 1 from public.activity_events where entity_id=p6 and action='proposal.approved' and metadata->'evidence' = jsonb_build_array(e2)) then pass:=pass+1; else fail:=fail+1; failures:=failures||' decision_records_evidence'; end if;

  -- 7 privileges
  perform pg_temp.root();
  if not has_function_privilege('anon','public.record_evidence(uuid,uuid,jsonb)','execute') and not has_table_privilege('anon','public.evidence_items','select')
     and not has_table_privilege('authenticated','public.evidence_items','insert') and not has_table_privilege('authenticated','public.proposal_evidence','insert')
     and not has_function_privilege('authenticated','public.evidence_reliability(uuid,text,text,text,text)','execute') then pass:=pass+1; else fail:=fail+1; failures:=failures||' privileges'; end if;
  raise exception 'EVIDENCE_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
