-- Assertions for docs/proposals/0079 (rolled back): the experiment lifecycle follows its order, only administrators
-- approve, observations are cumulative and never mix simulated with real data, outcomes are checked against the data
-- (planned sample and significance), history is insert-only, and nothing is visible or writable outside the business.
do $$
declare
  uo uuid := gen_random_uuid(); um uuid := gen_random_uuid(); uv uuid := gen_random_uuid(); ux uuid := gen_random_uuid();
  o uuid; o2 uuid; w1 uuid; wx uuid; e1 uuid; e2 uuid; e3 uuid; k uuid := gen_random_uuid(); j jsonb; n int; s text;
  pass int := 0; fail int := 0; failures text := '';
  design jsonb;
begin
  execute $t$CREATE FUNCTION pg_temp.su(_u uuid) RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; PERFORM set_config('request.jwt.claims', json_build_object('sub',_u,'role','authenticated')::text, true); SET LOCAL ROLE authenticated; END $b$ $t$;
  execute $t$CREATE FUNCTION pg_temp.root() RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; END $b$ $t$;
  insert into auth.users(id,email,aud,role,instance_id) values
    (uo,'ex-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (um,'ex-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (uv,'ex-viewer@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ux,'ex-outsider@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  perform pg_temp.su(uo); o := public.create_organization('Experiment fixture','Bakery'); select id into w1 from public.workspaces where org_id=o;
  perform pg_temp.su(ux); o2 := public.create_organization('Other org','Shop'); select id into wx from public.workspaces where org_id=o2;
  perform pg_temp.root();
  insert into public.organization_members(org_id,user_id,role) values(o,um,'member'),(o,uv,'viewer');
  insert into public.workspace_members(workspace_id,user_id,role) values(w1,um,'member'),(w1,uv,'viewer');

  -- sample size reference values (alpha 0.05 two-sided, power 0.8)
  if public.experiment_sample_size(10,2) = 3841 and public.experiment_sample_size(50,40) = 20 and public.experiment_sample_size(10,null) is null then pass:=pass+1; else fail:=fail+1; failures:=failures||' sample'; end if;

  design := jsonb_build_object('title','Free delivery banner','hypothesis','A banner raises orders','intervention','Show banner','control_description','No banner',
    'method','ab_test','primary_kpi','Order conversion','secondary_kpis',jsonb_build_array('Average order value',' '),'baseline_rate',10,'min_effect',2,'duration_days',14);

  -- viewer and outsider cannot design
  perform pg_temp.su(uv);
  begin perform public.design_experiment(w1, gen_random_uuid(), design); fail:=fail+1; failures:=failures||' viewer_design'; exception when others then pass:=pass+1; end;
  perform pg_temp.su(ux);
  begin perform public.design_experiment(w1, gen_random_uuid(), design); fail:=fail+1; failures:=failures||' outsider_design'; exception when others then pass:=pass+1; end;

  perform pg_temp.su(um);
  j := public.design_experiment(w1, k, design); e1 := (j->>'experiment_id')::uuid;
  if j->>'status' = 'created' and (j->>'sample_per_group')::int = 3841 then pass:=pass+1; else fail:=fail+1; failures:=failures||' design:'||j::text; end if;
  j := public.design_experiment(w1, k, design);
  if j->>'status' = 'existing' and (j->>'experiment_id')::uuid = e1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' idem'; end if;
  select status, cardinality(secondary_kpis) into s, n from public.growth_experiments where id=e1;
  if s = 'draft' and n = 1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' draft:'||s||n; end if;
  -- half a rate pair is refused
  begin perform public.design_experiment(w1, gen_random_uuid(), design - 'min_effect'); fail:=fail+1; failures:=failures||' half_rate';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' half_rate:'||sqlstate; end if; end;
  -- lifecycle order
  begin perform public.move_experiment(e1,'request_approval','{}'); fail:=fail+1; failures:=failures||' skip_review';
    exception when others then if sqlstate='55000' then pass:=pass+1; else fail:=fail+1; failures:=failures||' skip_review:'||sqlstate; end if; end;
  perform public.move_experiment(e1,'submit_review','{}');
  begin perform public.move_experiment(e1,'request_approval','{}'); fail:=fail+1; failures:=failures||' no_criteria';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' no_criteria:'||sqlstate; end if; end;
  begin perform public.revise_experiment_design(e1, 7, design); fail:=fail+1; failures:=failures||' stale_version';
    exception when others then if sqlstate='40001' then pass:=pass+1; else fail:=fail+1; failures:=failures||' stale:'||sqlstate; end if; end;
  j := public.revise_experiment_design(e1, 1, design || jsonb_build_object('success_criteria','+2 points at planned sample','stop_criteria','Stop if variant falls under 6%','guardrail_min_rate',6));
  select status into s from public.growth_experiments where id=e1;
  if (j->>'design_version')::int = 2 and s = 'draft' then pass:=pass+1; else fail:=fail+1; failures:=failures||' revise:'||s; end if;
  perform public.move_experiment(e1,'submit_review','{}');
  perform public.move_experiment(e1,'request_approval','{}');
  -- only an administrator approves
  begin perform public.move_experiment(e1,'approve','{}'); fail:=fail+1; failures:=failures||' member_approve';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' member_approve:'||sqlstate; end if; end;
  begin perform public.record_experiment_observation(e1, gen_random_uuid(), '{"variant_n":1,"variant_conversions":0,"control_n":1,"control_conversions":0,"data_class":"simulated"}'); fail:=fail+1; failures:=failures||' obs_before_run';
    exception when others then if sqlstate='55000' then pass:=pass+1; else fail:=fail+1; failures:=failures||' obs_before:'||sqlstate; end if; end;
  perform pg_temp.su(uo); perform public.move_experiment(e1,'approve','{"note":"go"}');
  perform pg_temp.su(um);
  begin perform public.move_experiment(e1,'schedule',jsonb_build_object('start',current_date-1)); fail:=fail+1; failures:=failures||' past_schedule';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' past:'||sqlstate; end if; end;
  perform public.move_experiment(e1,'schedule',jsonb_build_object('start',current_date+1));
  perform public.move_experiment(e1,'start','{}');
  begin perform public.move_experiment(e1,'complete','{"outcome":"successful","actual_result":"x","conclusion":"y"}'); fail:=fail+1; failures:=failures||' complete_running';
    exception when others then if sqlstate='55000' then pass:=pass+1; else fail:=fail+1; failures:=failures||' complete_running:'||sqlstate; end if; end;
  begin perform public.move_experiment(e1,'evaluate','{}'); fail:=fail+1; failures:=failures||' eval_no_data';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' eval_no_data:'||sqlstate; end if; end;
  perform public.record_experiment_observation(e1, gen_random_uuid(), '{"variant_n":400,"variant_conversions":60,"control_n":400,"control_conversions":40,"data_class":"simulated"}');
  begin perform public.record_experiment_observation(e1, gen_random_uuid(), '{"variant_n":300,"variant_conversions":60,"control_n":400,"control_conversions":40,"data_class":"simulated"}'); fail:=fail+1; failures:=failures||' decreasing';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' decreasing:'||sqlstate; end if; end;
  begin perform public.record_experiment_observation(e1, gen_random_uuid(), '{"variant_n":500,"variant_conversions":70,"control_n":500,"control_conversions":50,"data_class":"manual"}'); fail:=fail+1; failures:=failures||' mixed';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' mixed:'||sqlstate; end if; end;
  begin perform public.move_experiment(e1,'pause','{}'); fail:=fail+1; failures:=failures||' pause_no_reason';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' pause_reason:'||sqlstate; end if; end;
  perform public.move_experiment(e1,'pause','{"note":"supplier issue"}');
  j := public.move_experiment(e1,'resume','{}');
  if j->>'status' = 'running' then pass:=pass+1; else fail:=fail+1; failures:=failures||' resume:'||j::text; end if;
  perform public.move_experiment(e1,'stop_intervention','{}');
  perform public.move_experiment(e1,'evaluate','{}');
  -- 15% vs 10% looks significant (z ~ 2.15) but the planned sample is 3841 per group: peeking is not evidence
  begin perform public.move_experiment(e1,'complete','{"outcome":"successful","actual_result":"15% vs 10%","conclusion":"works"}'); fail:=fail+1; failures:=failures||' early_success';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' early_success:'||sqlstate; end if; end;
  begin perform public.move_experiment(e1,'complete','{"outcome":"unsuccessful","actual_result":"15% vs 10%","conclusion":"no"}'); fail:=fail+1; failures:=failures||' early_fail';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' early_fail:'||sqlstate; end if; end;
  j := public.move_experiment(e1,'complete','{"outcome":"inconclusive","actual_result":"15% vs 10% on 400 per group","conclusion":"Too early to tell"}');
  if j->>'evidence_strength' = 'inconclusive' and (j->>'z')::numeric between 2.0 and 2.3 then pass:=pass+1; else fail:=fail+1; failures:=failures||' inconclusive:'||j::text; end if;

  -- a small planned sample reached with a clear improvement is "successful" and "controlled"
  j := public.design_experiment(w1, gen_random_uuid(), design || jsonb_build_object('title','Big effect','baseline_rate',50,'min_effect',40,'success_criteria','s','stop_criteria','t'));
  e2 := (j->>'experiment_id')::uuid;
  perform public.move_experiment(e2,'submit_review','{}'); perform public.move_experiment(e2,'request_approval','{}');
  perform pg_temp.su(uo); perform public.move_experiment(e2,'approve','{}');
  perform pg_temp.su(um); perform public.move_experiment(e2,'start','{}');
  perform public.record_experiment_observation(e2, gen_random_uuid(), '{"variant_n":30,"variant_conversions":27,"control_n":30,"control_conversions":15,"data_class":"manual"}');
  perform public.move_experiment(e2,'evaluate','{}');
  j := public.move_experiment(e2,'complete','{"outcome":"successful","actual_result":"90% vs 50%","conclusion":"Roll out"}');
  if j->>'evidence_strength' = 'controlled' then pass:=pass+1; else fail:=fail+1; failures:=failures||' controlled:'||j::text; end if;

  -- a before/after design is never controlled evidence
  j := public.design_experiment(w1, gen_random_uuid(), (design - 'control_description' - 'baseline_rate' - 'min_effect') || jsonb_build_object('title','Before after','method','before_after','success_criteria','s','stop_criteria','t'));
  e3 := (j->>'experiment_id')::uuid;
  perform public.move_experiment(e3,'submit_review','{}'); perform public.move_experiment(e3,'request_approval','{}');
  perform pg_temp.su(uo); perform public.move_experiment(e3,'approve','{}');
  perform pg_temp.su(um); perform public.move_experiment(e3,'start','{}');
  perform public.record_experiment_observation(e3, gen_random_uuid(), '{"variant_n":1000,"variant_conversions":300,"control_n":1000,"control_conversions":100,"data_class":"manual"}');
  perform public.move_experiment(e3,'evaluate','{}');
  j := public.move_experiment(e3,'complete','{"outcome":"successful","actual_result":"30% vs 10%","conclusion":"Better after"}');
  if j->>'evidence_strength' = 'correlational' then pass:=pass+1; else fail:=fail+1; failures:=failures||' before_after:'||j::text; end if;

  -- follow-ups only build on completed experiments of this business
  begin perform public.design_experiment(wx, gen_random_uuid(), design || jsonb_build_object('follow_up_of', e2)); fail:=fail+1; failures:=failures||' cross_follow';
    exception when others then pass:=pass+1; end;
  j := public.design_experiment(w1, gen_random_uuid(), design || jsonb_build_object('title','Follow-up','follow_up_of', e2));
  if j->>'status' = 'created' then pass:=pass+1; else fail:=fail+1; failures:=failures||' follow'; end if;
  -- cancel needs a reason; closed experiments stay closed
  begin perform public.move_experiment(e2,'cancel','{"note":"x"}'); fail:=fail+1; failures:=failures||' cancel_closed';
    exception when others then if sqlstate='55000' then pass:=pass+1; else fail:=fail+1; failures:=failures||' cancel_closed:'||sqlstate; end if; end;
  -- the 0066 shortcut can no longer complete with typed-in percentages
  begin perform public.advance_experiment(e1,'complete','{"variant_value":"20","control_value":"10","variant_n":"100","control_n":"100","actual_result":"x","conclusion":"y"}'); fail:=fail+1; failures:=failures||' old_complete';
    exception when others then if sqlstate='55000' then pass:=pass+1; else fail:=fail+1; failures:=failures||' old_complete:'||sqlstate; end if; end;

  -- history is complete and insert-only; tables are not directly writable
  select count(*) into n from public.experiment_events where experiment_id=e1;
  if n >= 12 then pass:=pass+1; else fail:=fail+1; failures:=failures||' events:'||n; end if;
  begin update public.experiment_events set note='x' where experiment_id=e1; fail:=fail+1; failures:=failures||' event_update'; exception when others then pass:=pass+1; end;
  begin delete from public.experiment_observations where experiment_id=e1; fail:=fail+1; failures:=failures||' obs_delete'; exception when others then pass:=pass+1; end;
  begin update public.growth_experiments set outcome='successful' where id=e1; fail:=fail+1; failures:=failures||' direct_update'; exception when others then pass:=pass+1; end;
  begin insert into public.experiment_observations(org_id,workspace_id,experiment_id,request_key,variant_n,variant_conversions,control_n,control_conversions,data_class)
    values(o,w1,e1,gen_random_uuid(),1,1,1,1,'manual'); fail:=fail+1; failures:=failures||' direct_insert'; exception when others then pass:=pass+1; end;
  -- RLS: viewer reads, outsider sees nothing and cannot act
  perform pg_temp.su(uv);
  select count(*) into n from public.experiment_observations where workspace_id=w1; if n = 3 then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer_read:'||n; end if;
  begin perform public.move_experiment(e3,'cancel','{"note":"x"}'); fail:=fail+1; failures:=failures||' viewer_cancel'; exception when others then pass:=pass+1; end;
  perform pg_temp.su(ux);
  select count(*) into n from public.experiment_events where workspace_id=w1; if n = 0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_events:'||n; end if;
  select count(*) into n from public.growth_experiments where workspace_id=w1; if n = 0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_exp:'||n; end if;
  begin perform public.record_experiment_observation(e1, gen_random_uuid(), '{"variant_n":1,"variant_conversions":0,"control_n":1,"control_conversions":0,"data_class":"simulated"}'); fail:=fail+1; failures:=failures||' outsider_obs'; exception when others then pass:=pass+1; end;
  RESET ROLE;
  raise exception 'EXPERIMENT_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
