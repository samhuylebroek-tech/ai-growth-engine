-- Assertions for docs/proposals/0057 (run after the proposal in the same rolled-back transaction).
do $$
declare
  ua uuid := gen_random_uuid(); um uuid := gen_random_uuid(); uv uuid := gen_random_uuid(); ub uuid := gen_random_uuid();
  oa uuid; wa uuid; ob uuid; wb uuid; mid uuid; r jsonb; k uuid := gen_random_uuid(); n int; v numeric;
  pass int := 0; fail int := 0; failures text := '';
begin
  execute $t$CREATE OR REPLACE FUNCTION public.verify_ai_accounting(_proof text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $b$ BEGIN IF _proof IS DISTINCT FROM 'rollback-fixture-only' THEN RAISE EXCEPTION 'server accounting verification required'; END IF; END $b$ $t$;
  insert into auth.users(id,email,aud,role,instance_id) values
    (ua,'imp-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (um,'imp-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (uv,'imp-viewer@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ub,'imp-outsider@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  perform set_config('request.jwt.claims', json_build_object('sub',ua,'role','authenticated')::text, true); execute 'set local role authenticated';
  oa := public.create_organization('Import fixture A','A'); select id into wa from public.workspaces where org_id = oa;
  r := public.define_metric(wa,'monthly_revenue','Revenue','currency','EUR','increase',null,null); mid := (r->>'metric_id')::uuid;
  -- Browser sessions can no longer mark a connector as connected.
  begin insert into public.connector_connections(org_id,workspace_id,connector_key,status) values(oa,wa,'stripe','connected'); fail:=fail+1; failures:=failures||' admin_fakes_connection'; exception when others then pass:=pass+1; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',ub,'role','authenticated')::text, true); execute 'set local role authenticated';
  ob := public.create_organization('Import fixture B','B'); select id into wb from public.workspaces where org_id = ob;
  execute 'reset role';
  insert into public.organization_members(org_id,user_id,role) values(oa,um,'member'),(oa,uv,'viewer');
  insert into public.workspace_members(workspace_id,user_id,role) values(wa,um,'member'),(wa,uv,'viewer');
  -- Stands in for a future server-attested connection flow.
  insert into public.connector_connections(org_id,workspace_id,connector_key,status) values(oa,wa,'stripe','connected'),(ob,wb,'google_analytics','connected');

  perform set_config('request.jwt.claims', json_build_object('sub',um,'role','authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.import_measurement_verified(mid,'stripe','2026-10-01','2026-10-31',100,'',gen_random_uuid(),null); fail:=fail+1; failures:=failures||' no_proof'; exception when others then pass:=pass+1; end;
  begin perform public.import_measurement_verified(mid,'stripe','2026-10-01','2026-10-31',100,'',gen_random_uuid(),'wrong'); fail:=fail+1; failures:=failures||' wrong_proof'; exception when others then pass:=pass+1; end;
  begin perform public.import_measurement_verified(mid,'google_analytics','2026-10-01','2026-10-31',100,'',gen_random_uuid(),'rollback-fixture-only'); fail:=fail+1; failures:=failures||' not_connected'; exception when others then pass:=pass+1; end;
  begin perform public.import_measurement_verified(mid,'mailchimp','2026-10-01','2026-10-31',100,'',gen_random_uuid(),'rollback-fixture-only'); fail:=fail+1; failures:=failures||' unknown_connector'; exception when others then pass:=pass+1; end;
  begin perform public.import_measurement_verified(mid,'stripe','2026-10-01','2026-10-31',-5,'',gen_random_uuid(),'rollback-fixture-only'); fail:=fail+1; failures:=failures||' negative_money'; exception when others then pass:=pass+1; end;
  r := public.import_measurement_verified(mid,'stripe','2026-10-01','2026-10-31',12500.5,'balance_transactions:2026-10',k,'rollback-fixture-only');
  if r->>'status' = 'created' then pass:=pass+1; else fail:=fail+1; failures:=failures||' created'; end if;
  select count(*) into n from public.performance_measurements where metric_id=mid and kind='imported_actual' and source='stripe';
  if n = 1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' stored_as_imported'; end if;
  r := public.import_measurement_verified(mid,'stripe','2026-10-01','2026-10-31',12500.5,'balance_transactions:2026-10',k,'rollback-fixture-only');
  if r->>'status' = 'existing' then pass:=pass+1; else fail:=fail+1; failures:=failures||' replay_existing'; end if;
  r := public.import_measurement_verified(mid,'stripe','2026-10-01','2026-10-31',12500.5,'',gen_random_uuid(),'rollback-fixture-only');
  if r->>'status' = 'unchanged' then pass:=pass+1; else fail:=fail+1; failures:=failures||' resync_unchanged'; end if;
  r := public.import_measurement_verified(mid,'stripe','2026-10-01','2026-10-31',12600,'',gen_random_uuid(),'rollback-fixture-only');
  if r->>'status' = 'corrected' then pass:=pass+1; else fail:=fail+1; failures:=failures||' resync_corrects'; end if;
  select count(*) into n from public.performance_measurements p where p.metric_id=mid and p.kind='imported_actual' and not exists(select 1 from public.performance_measurements c where c.corrects_id=p.id);
  if n = 1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' one_live_import'; end if;
  -- A manual entry for the same month coexists; users cannot write imported values themselves.
  perform public.record_measurement(mid,'manual_actual','2026-10-01','2026-10-31',12000,'','',gen_random_uuid(),null); pass:=pass+1;
  begin perform public.record_measurement(mid,'imported_actual','2026-11-01','2026-11-30',1,'','',gen_random_uuid(),null); fail:=fail+1; failures:=failures||' user_imports'; exception when others then pass:=pass+1; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',uv,'role','authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.import_measurement_verified(mid,'stripe','2026-11-01','2026-11-30',1,'',gen_random_uuid(),'rollback-fixture-only'); fail:=fail+1; failures:=failures||' viewer_imports'; exception when others then pass:=pass+1; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',ub,'role','authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.import_measurement_verified(mid,'stripe','2026-11-01','2026-11-30',1,'',gen_random_uuid(),'rollback-fixture-only'); fail:=fail+1; failures:=failures||' outsider_imports'; exception when others then pass:=pass+1; end;
  execute 'reset role';
  if not has_function_privilege('anon','public.import_measurement_verified(uuid,text,date,date,numeric,text,uuid,text)','execute')
     and not has_table_privilege('authenticated','public.connector_connections','insert,update,delete')
  then pass:=pass+1; else fail:=fail+1; failures:=failures||' privileges'; end if;
  raise exception 'IMPORTS_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
