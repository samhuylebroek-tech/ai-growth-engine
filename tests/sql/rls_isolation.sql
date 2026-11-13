-- RLS tenant-isolation suite. Runs entirely inside one DO block and ALWAYS
-- raises at the end so every change is rolled back. Output: 'RLS_RESULT pass=N fail=M ...'.
do $$
declare
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid(); uv uuid := gen_random_uuid();
  oa uuid; ob uuid; wa uuid; wb uuid; ap uuid; n int; pass int := 0; fail int := 0; failures text := '';
begin
  insert into auth.users(id, email, aud, role, instance_id) values
    (ua,'rls-a@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ub,'rls-b@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (uv,'rls-v@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');

  -- user A creates org A
  perform set_config('request.jwt.claims', json_build_object('sub',ua,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  oa := public.create_organization('Org A','WS A');
  select id into wa from public.workspaces where org_id = oa;
  insert into public.approvals(org_id, workspace_id, capability_key, title, requested_by) values (oa, wa, 'test.cap', 'A proposal', ua) returning id into ap;
  insert into public.business_facts(org_id, workspace_id, key, value, source_type) values (oa, wa, 'k', 'secret-a', 'user');
  execute 'reset role';
  -- viewer joins org A
  insert into public.organization_members(org_id,user_id,role) values (oa, uv, 'viewer');

  -- user B creates org B
  perform set_config('request.jwt.claims', json_build_object('sub',ub,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  ob := public.create_organization('Org B','WS B');
  select id into wb from public.workspaces where org_id = ob;

  -- B cannot see A's data
  select count(*) into n from public.organizations where id = oa; if n = 0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' B_sees_orgA'; end if;
  select count(*) into n from public.workspaces where org_id = oa; if n = 0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' B_sees_wsA'; end if;
  select count(*) into n from public.business_facts where org_id = oa; if n = 0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' B_sees_factsA'; end if;
  select count(*) into n from public.approvals where org_id = oa; if n = 0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' B_sees_approvalsA'; end if;
  select count(*) into n from public.credit_ledger where org_id = oa; if n = 0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' B_sees_ledgerA'; end if;
  select count(*) into n from public.organization_members where org_id = oa; if n = 0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' B_sees_membersA'; end if;
  select count(*) into n from public.audit_logs where org_id = oa; if n = 0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' B_sees_auditA'; end if;
  select count(*) into n from public.business_profiles where org_id = oa; if n = 0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' B_sees_profileA'; end if;
  -- B cannot write into A
  begin insert into public.business_facts(org_id, workspace_id, key, value, source_type) values (oa, wa, 'x','y','user'); fail:=fail+1; failures:=failures||' B_inserts_factA';
  exception when others then pass:=pass+1; end;
  begin insert into public.business_facts(org_id, workspace_id, key, value, source_type) values (ob, wa, 'x','y','user'); fail:=fail+1; failures:=failures||' B_cross_ws_insert';
  exception when others then pass:=pass+1; end;
  update public.organizations set name = 'hacked' where id = oa; get diagnostics n = row_count; if n = 0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' B_updates_orgA'; end if;
  delete from public.workspaces where id = wa; get diagnostics n = row_count; if n = 0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' B_deletes_wsA'; end if;
  begin perform public.decide_approval(ap, true, 'x'); fail:=fail+1; failures:=failures||' B_approves_A'; exception when others then pass:=pass+1; end;
  begin perform public.consume_credits(oa, 1, 'x'); fail:=fail+1; failures:=failures||' B_spends_A'; exception when others then pass:=pass+1; end;
  begin perform public.credit_balance(oa); fail:=fail+1; failures:=failures||' B_reads_balanceA'; exception when others then pass:=pass+1; end;
  begin insert into public.organization_members(org_id,user_id,role) values (oa, ub, 'owner'); fail:=fail+1; failures:=failures||' B_joins_A'; exception when others then pass:=pass+1; end;
  begin perform public.admin_grant_credits(ob, 99999, 'x'); fail:=fail+1; failures:=failures||' B_grants_self'; exception when others then pass:=pass+1; end;
  begin insert into public.credit_ledger(org_id, delta, reason) values (ob, 99999, 'adjustment'); fail:=fail+1; failures:=failures||' B_ledger_insert'; exception when others then pass:=pass+1; end;
  begin insert into public.platform_roles(user_id, role) values (ub, 'platform_owner'); fail:=fail+1; failures:=failures||' B_self_platform_owner'; exception when others then pass:=pass+1; end;
  update public.subscriptions set plan_key = 'enterprise' where org_id = ob; get diagnostics n = row_count; if n = 0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' B_upgrades_self'; end if;
  execute 'reset role';

  -- viewer in A: can read, cannot write, cannot approve
  perform set_config('request.jwt.claims', json_build_object('sub',uv,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.business_facts where org_id = oa; if n = 1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer_cannot_read'; end if;
  begin insert into public.business_facts(org_id, workspace_id, key, value, source_type) values (oa, wa, 'x','y','user'); fail:=fail+1; failures:=failures||' viewer_writes';
  exception when others then pass:=pass+1; end;
  begin perform public.decide_approval(ap, true, 'x'); fail:=fail+1; failures:=failures||' viewer_approves'; exception when others then pass:=pass+1; end;
  begin perform public.consume_credits(oa, 1, 'x'); fail:=fail+1; failures:=failures||' viewer_spends'; exception when others then pass:=pass+1; end;
  update public.organization_members set role = 'admin' where org_id = oa and user_id = uv; get diagnostics n = row_count; if n = 0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer_self_promote'; end if;
  execute 'reset role';

  -- owner A: positive paths
  perform set_config('request.jwt.claims', json_build_object('sub',ua,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  if public.credit_balance(oa) = 200 then pass:=pass+1; else fail:=fail+1; failures:=failures||' trial_grant'; end if;
  if public.consume_credits(oa, 5, 'test') = 195 then pass:=pass+1; else fail:=fail+1; failures:=failures||' consume'; end if;
  begin perform public.consume_credits(oa, 1000, 'x'); fail:=fail+1; failures:=failures||' overspend'; exception when others then pass:=pass+1; end;
  if public.decide_approval(ap, true, 'ok') = 'approved' then pass:=pass+1; else fail:=fail+1; failures:=failures||' approve'; end if;
  begin perform public.decide_approval(ap, false, 'again'); fail:=fail+1; failures:=failures||' double_decide'; exception when others then pass:=pass+1; end;
  select count(*) into n from public.audit_logs where org_id = oa; if n >= 2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' audit_written'; end if;
  execute 'reset role';

  -- anon sees plans only
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  select count(*) into n from public.plans; if n >= 6 then pass:=pass+1; else fail:=fail+1; failures:=failures||' anon_plans'; end if;
  begin select count(*) into n from public.organizations; if n = 0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' anon_orgs'; end if; exception when others then pass:=pass+1; end;
  execute 'reset role';

  raise exception 'RLS_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
