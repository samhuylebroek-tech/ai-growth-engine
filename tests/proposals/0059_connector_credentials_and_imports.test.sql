-- Assertions for docs/proposals/0059 (rolled back). Credentials stay unreadable to app roles, health
-- and import runs are role-checked, server-attested and kept as history.
do $$
declare
  ua uuid := gen_random_uuid(); um uuid := gen_random_uuid(); uv uuid := gen_random_uuid(); ub uuid := gen_random_uuid();
  oa uuid; wa uuid; ob uuid; r jsonb; run uuid; k uuid := gen_random_uuid(); sid uuid; n int; txt text;
  P constant text := 'rollback-fixture-only'; pass int := 0; fail int := 0; failures text := '';
begin
  execute $t$CREATE OR REPLACE FUNCTION public.verify_ai_accounting(_proof text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $b$ BEGIN IF _proof IS DISTINCT FROM 'rollback-fixture-only' THEN RAISE EXCEPTION 'server accounting verification required'; END IF; END $b$ $t$;
  insert into auth.users(id,email,aud,role,instance_id) values
    (ua,'cc-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (um,'cc-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (uv,'cc-viewer@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ub,'cc-outsider@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  perform set_config('request.jwt.claims', json_build_object('sub',ub,'role','authenticated')::text, true); execute 'set local role authenticated';
  ob := public.create_organization('Connector fixture B','B');
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',ua,'role','authenticated')::text, true); execute 'set local role authenticated';
  oa := public.create_organization('Connector fixture A','A'); select id into wa from public.workspaces where org_id = oa;
  execute 'reset role';
  insert into public.organization_members(org_id,user_id,role) values(oa,um,'member'),(oa,uv,'viewer');
  insert into public.workspace_members(workspace_id,user_id,role) values(wa,um,'member'),(wa,uv,'viewer');

  perform set_config('request.jwt.claims', json_build_object('sub',ua,'role','authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.store_connector_credential_verified(wa,'stripe','rk_test_fixture_value',array['read_only_restricted_key'],null,'Fixture',null,null); fail:=fail+1; failures:=failures||' store_no_proof'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.store_connector_credential_verified(wa,'mailchimp','rk_test_fixture_value','{}',null,null,null,P); fail:=fail+1; failures:=failures||' unknown_connector'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  r := public.store_connector_credential_verified(wa,'stripe','rk_test_fixture_value',array['read_only_restricted_key'],null,'Fixture account','{}',P);
  if r->>'status' = 'connected' then pass:=pass+1; else fail:=fail+1; failures:=failures||' stored_connected'; end if;
  r := public.store_connector_credential_verified(wa,'hubspot','pat-fixture-value-0000','{}',null,null,null,P);
  if r->>'status' = 'insufficient_scope' and r->'missing_scopes' ? 'crm.objects.deals.read' then pass:=pass+1; else fail:=fail+1; failures:=failures||' missing_scope'; end if;
  begin select count(*) into n from public.connector_credentials; fail:=fail+1; failures:=failures||' credentials_selectable'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin select count(*) into n from vault.decrypted_secrets; fail:=fail+1; failures:=failures||' vault_selectable'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin update public.connector_connections set status='connected' where workspace_id=wa and connector_key='hubspot'; get diagnostics n = row_count; if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' admin_fakes_status'; end if; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub',um,'role','authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.store_connector_credential_verified(wa,'stripe','rk_test_other_value',array['read_only_restricted_key'],null,null,null,P); fail:=fail+1; failures:=failures||' member_connects'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  r := public.read_connector_credential_verified(wa,'stripe',P);
  if r->>'secret' = 'rk_test_fixture_value' then pass:=pass+1; else fail:=fail+1; failures:=failures||' member_server_read'; end if;
  begin perform public.read_connector_credential_verified(wa,'stripe','wrong'); fail:=fail+1; failures:=failures||' read_wrong_proof'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.begin_connector_import_verified(wa,'hubspot',gen_random_uuid(),3,P); fail:=fail+1; failures:=failures||' import_without_scope'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  r := public.begin_connector_import_verified(wa,'stripe',k,3,P); run := (r->>'run_id')::uuid;
  if (r->>'existing')::boolean = false then pass:=pass+1; else fail:=fail+1; failures:=failures||' run_created'; end if;
  if (public.begin_connector_import_verified(wa,'stripe',k,3,P)->>'run_id')::uuid = run then pass:=pass+1; else fail:=fail+1; failures:=failures||' run_idempotent'; end if;
  begin perform public.begin_connector_import_verified(wa,'stripe',gen_random_uuid(),3,P); fail:=fail+1; failures:=failures||' parallel_run'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',ua,'role','authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.finish_connector_import_verified(run,'succeeded',1,0,0,0,null,P); fail:=fail+1; failures:=failures||' other_user_finishes'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',um,'role','authenticated')::text, true); execute 'set local role authenticated';
  perform public.finish_connector_import_verified(run,'partial',2,1,3,1,'1 value skipped',P);
  if exists (select 1 from public.connector_import_runs where id=run and status='partial' and created_count=2 and skipped_count=1 and finished_at is not null) then pass:=pass+1; else fail:=fail+1; failures:=failures||' run_finished'; end if;
  begin perform public.finish_connector_import_verified(run,'succeeded',0,0,0,0,null,P); fail:=fail+1; failures:=failures||' run_refinished'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  if exists (select 1 from public.connector_connections where workspace_id=wa and connector_key='stripe' and last_sync_at is not null) then pass:=pass+1; else fail:=fail+1; failures:=failures||' last_sync'; end if;
  perform public.report_connector_health_verified(wa,'stripe','expired','401 from provider',P);
  begin perform public.begin_connector_import_verified(wa,'stripe',gen_random_uuid(),3,P); fail:=fail+1; failures:=failures||' import_when_expired'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.disconnect_connector_verified(wa,'stripe',P); fail:=fail+1; failures:=failures||' member_disconnects'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';
  if exists (select 1 from public.audit_logs where org_id=oa and action='connector.health_changed' and metadata->>'to'='expired') then pass:=pass+1; else fail:=fail+1; failures:=failures||' health_audit'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub',uv,'role','authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.read_connector_credential_verified(wa,'stripe',P); fail:=fail+1; failures:=failures||' viewer_reads_secret'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  select count(*) into n from public.connector_import_runs where workspace_id=wa;
  if n = 1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer_sees_history'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',ub,'role','authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.read_connector_credential_verified(wa,'stripe',P); fail:=fail+1; failures:=failures||' outsider_reads_secret'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  select count(*) into n from public.connector_import_runs where workspace_id=wa;
  if n = 0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_sees_history'; end if;
  execute 'reset role';

  select k2.secret_id into sid from public.connector_credentials k2 join public.connector_connections c on c.id=k2.connection_id where c.workspace_id=wa and c.connector_key='stripe';
  perform set_config('request.jwt.claims', json_build_object('sub',ua,'role','authenticated')::text, true); execute 'set local role authenticated';
  perform public.disconnect_connector_verified(wa,'stripe',P);
  begin perform public.read_connector_credential_verified(wa,'stripe',P); fail:=fail+1; failures:=failures||' read_after_disconnect'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';
  if not exists (select 1 from vault.secrets where id=sid) and exists (select 1 from public.connector_connections where workspace_id=wa and connector_key='stripe' and status='not_configured')
     and exists (select 1 from public.connector_import_runs where id=run) then pass:=pass+1; else fail:=fail+1; failures:=failures||' disconnect_effects'; end if;
  if not has_table_privilege('authenticated','public.connector_credentials','select')
     and not has_table_privilege('authenticated','public.connector_import_runs','insert,update,delete')
     and not has_function_privilege('anon','public.read_connector_credential_verified(uuid,text,text)','execute')
  then pass:=pass+1; else fail:=fail+1; failures:=failures||' privileges'; end if;
  raise exception 'CONNECTORS_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
