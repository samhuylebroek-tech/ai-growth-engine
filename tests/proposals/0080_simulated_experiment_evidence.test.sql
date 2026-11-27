-- Assertions for docs/proposals/0080 (rolled back): a controlled test on simulated data keeps the outcome the data
-- supports but is never labelled controlled evidence, and cannot be recorded as a measured observation; the same
-- test on hand-entered data is controlled and can be.
do $$
declare
  uo uuid := gen_random_uuid(); o uuid; w1 uuid; es uuid; em uuid; j jsonb; s text; c text;
  pass int := 0; fail int := 0; failures text := '';
  design jsonb := jsonb_build_object('title','t','hypothesis','h','intervention','i','control_description','c','method','ab_test','primary_kpi','k',
    'baseline_rate',50,'min_effect',40,'duration_days',14,'success_criteria','s','stop_criteria','x');
begin
  execute $t$CREATE FUNCTION pg_temp.su(_u uuid) RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; PERFORM set_config('request.jwt.claims', json_build_object('sub',_u,'role','authenticated')::text, true); SET LOCAL ROLE authenticated; END $b$ $t$;
  insert into auth.users(id,email,aud,role,instance_id) values (uo,'sim-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  perform pg_temp.su(uo); o := public.create_organization('Simulation fixture','Bakery'); select id into w1 from public.workspaces where org_id=o;
  es := (public.design_experiment(w1, gen_random_uuid(), design)->>'experiment_id')::uuid;
  em := (public.design_experiment(w1, gen_random_uuid(), design || '{"title":"manual"}')->>'experiment_id')::uuid;
  perform public.move_experiment(es,'submit_review','{}'); perform public.move_experiment(es,'request_approval','{}'); perform public.move_experiment(es,'approve','{}'); perform public.move_experiment(es,'start','{}');
  perform public.move_experiment(em,'submit_review','{}'); perform public.move_experiment(em,'request_approval','{}'); perform public.move_experiment(em,'approve','{}'); perform public.move_experiment(em,'start','{}');
  perform public.record_experiment_observation(es, gen_random_uuid(), '{"variant_n":30,"variant_conversions":27,"control_n":30,"control_conversions":15,"data_class":"simulated"}');
  perform public.record_experiment_observation(em, gen_random_uuid(), '{"variant_n":30,"variant_conversions":27,"control_n":30,"control_conversions":15,"data_class":"manual"}');
  perform public.move_experiment(es,'evaluate','{}'); perform public.move_experiment(em,'evaluate','{}');
  j := public.move_experiment(es,'complete','{"outcome":"successful","actual_result":"90 vs 50","conclusion":"practice"}');
  select evidence_strength, result_data_class into s, c from public.growth_experiments where id=es;
  if s = 'inconclusive' and c = 'simulated' and j->>'evidence_strength' = 'inconclusive' then pass:=pass+1; else fail:=fail+1; failures:=failures||' sim:'||s||c; end if;
  j := public.move_experiment(em,'complete','{"outcome":"successful","actual_result":"90 vs 50","conclusion":"real"}');
  select evidence_strength, result_data_class into s, c from public.growth_experiments where id=em;
  if s = 'controlled' and c = 'manual' then pass:=pass+1; else fail:=fail+1; failures:=failures||' manual:'||s||c; end if;
  begin perform public.record_evidence(w1, gen_random_uuid(), jsonb_build_object('type','measured_observation','description','Banner result','source_kind','experiment','source_ref',es::text,'origin','user','period_start',current_date-14,'period_end',current_date));
    fail:=fail+1; failures:=failures||' sim_evidence'; exception when others then if sqlstate='23514' then pass:=pass+1; else fail:=fail+1; failures:=failures||' sim_evidence:'||sqlstate||sqlerrm; end if; end;
  j := public.record_evidence(w1, gen_random_uuid(), jsonb_build_object('type','measured_observation','description','Banner result','source_kind','experiment','source_ref',em::text,'origin','user','period_start',current_date-14,'period_end',current_date));
  if j ? 'id' or j ? 'evidence_id' then pass:=pass+1; else fail:=fail+1; failures:=failures||' manual_evidence:'||j::text; end if;
  RESET ROLE;
  raise exception 'SIMULATED_EVIDENCE_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
