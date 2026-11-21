-- Assertions for docs/proposals/0088 (rolled back). Negative tests attempt each refused action and expect the exact refusal.
do $$
declare
  uo uuid := gen_random_uuid(); ua uuid := gen_random_uuid(); um uuid := gen_random_uuid(); ux uuid := gen_random_uuid(); up uuid;
  o uuid; w uuid; w2 uuid; j jsonb; n int; b boolean; s text; hid bigint;
  pass int := 0; fail int := 0; failures text := '';
begin
  execute $t$CREATE FUNCTION pg_temp.su(_u uuid, _aal text DEFAULT 'aal1') RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; PERFORM set_config('request.jwt.claims', json_build_object('sub',_u,'role','authenticated','aal',_aal)::text, true); SET LOCAL ROLE authenticated; END $b$ $t$;
  execute $t$CREATE FUNCTION pg_temp.root() RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; END $b$ $t$;
  insert into auth.users(id,email,aud,role,instance_id) values
    (uo,'sec-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ua,'sec-admin@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (um,'sec-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ux,'sec-outsider@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  perform pg_temp.su(uo); o := public.create_organization('SEC fixture','Main'); select id into w from public.workspaces where org_id=o;
  perform pg_temp.root();
  insert into public.organization_members(org_id,user_id,role) values (o,ua,'admin'),(o,um,'member');
  insert into public.workspace_members(workspace_id,user_id,role) values (w,ua,'admin'),(w,um,'member');
  select user_id into up from public.platform_roles where role='platform_owner' limit 1;
  if up is null then raise exception 'no Platform Owner in this environment'; end if;

  -- 1-4. internal helpers are not callable through the API
  if not has_function_privilege('authenticated','public.task_execution_settings(uuid)','execute') then pass:=pass+1; else fail:=fail+1; failures:=failures||' helper_settings'; end if;
  if not has_function_privilege('authenticated','public.task_open_dependencies(uuid)','execute') then pass:=pass+1; else fail:=fail+1; failures:=failures||' helper_deps'; end if;
  if not has_function_privilege('authenticated','public.task_priority_score(uuid)','execute') then pass:=pass+1; else fail:=fail+1; failures:=failures||' helper_score'; end if;
  if not has_function_privilege('authenticated','public.execution_user_allowed(uuid,uuid)','execute') then pass:=pass+1; else fail:=fail+1; failures:=failures||' helper_allowed'; end if;
  -- 5. no API role can TRUNCATE, add triggers or reference any public table
  select count(*) into n from pg_class c join pg_namespace ns on ns.oid=c.relnamespace, unnest(array['anon','authenticated']) r
    where ns.nspname='public' and c.relkind='r' and (has_table_privilege(r,c.oid,'truncate') or has_table_privilege(r,c.oid,'trigger') or has_table_privilege(r,c.oid,'references'));
  if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' table_privs:'||n; end if;

  -- 6. a member cannot write audit entries directly
  perform pg_temp.su(um);
  begin perform public.log_audit(o,'platform.credit_price_set','credit_price','x','{}'); fail:=fail+1; failures:=failures||' forged_audit';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' forged_audit:'||sqlstate; end if; end;
  -- 7. a role change is audited by the database with the real actor
  perform pg_temp.su(uo);
  update public.organization_members set role='viewer' where org_id=o and user_id=um;
  select count(*) into n from public.audit_logs where org_id=o and action='member.role_changed' and actor_id=uo and target_id=um::text and metadata->>'recorded_by'='database';
  if n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' role_audit:'||n; end if;
  update public.organization_members set role='member' where org_id=o and user_id=um;
  -- 8. a policy change is audited
  insert into public.policies(org_id, capability_key, mode) values (o, 'content.publish', 'approval') on conflict (org_id, capability_key) do update set mode='approval';
  select count(*) into n from public.audit_logs where org_id=o and action='policy.changed';
  if n>=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' policy_audit:'||n; end if;

  -- 9. new entries are hash-chained
  perform pg_temp.root();
  select count(*) into n from public.audit_logs where org_id=o and (chain_seq is null or row_hash is null or prev_hash is null);
  if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' unchained:'||n; end if;
  -- 10. the Platform Owner verifies the chain; 11. an organization owner cannot
  perform pg_temp.su(up);
  j := public.verify_audit_chain();
  if (j->>'ok')::boolean and (j->>'checked')::int >= 3 then pass:=pass+1; else fail:=fail+1; failures:=failures||' verify:'||j::text; end if;
  perform pg_temp.su(uo);
  begin j := public.verify_audit_chain(); fail:=fail+1; failures:=failures||' org_owner_verifies';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' org_owner_verifies:'||sqlstate; end if; end;

  -- 12-15. two-step verification for the Platform Owner's pricing and credit adjustments
  perform pg_temp.su(up, 'aal1');
  begin perform public.set_credit_price('platform', null, 'EUR', 0.05, now() + interval '1 day', 'SEC price'); fail:=fail+1; failures:=failures||' price_aal1';
    exception when others then if sqlstate='42501' and sqlerrm='mfa_required' then pass:=pass+1; else fail:=fail+1; failures:=failures||' price_aal1:'||sqlstate||sqlerrm; end if; end;
  begin perform public.admin_grant_credits(o, 50, 'SEC'); fail:=fail+1; failures:=failures||' grant_aal1';
    exception when others then if sqlstate='42501' and sqlerrm='mfa_required' then pass:=pass+1; else fail:=fail+1; failures:=failures||' grant_aal1:'||sqlstate; end if; end;
  perform pg_temp.su(up, 'aal2');
  perform public.set_credit_price('platform', null, 'EUR', 0.05, now() + interval '1 day', 'SEC price');
  select count(*) into n from public.credit_price_versions where methodology='SEC price';
  if n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' price_aal2:'||n; end if;
  begin perform public.admin_grant_credits(o, 0, 'SEC'); fail:=fail+1; failures:=failures||' grant_zero';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' grant_zero:'||sqlstate; end if; end;
  -- 16. an organization admin with a verified second factor still cannot set prices
  perform pg_temp.su(ua, 'aal2');
  begin perform public.set_credit_price('platform', null, 'EUR', 0.01, now() + interval '1 day', 'SEC admin'); fail:=fail+1; failures:=failures||' admin_price';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' admin_price:'||sqlstate; end if; end;
  -- 17. subscription changes need the owner's verified session; 18. and are audited
  perform pg_temp.su(up, 'aal1');
  update public.subscriptions set plan_key = plan_key, status = 'active' where org_id = o and status <> 'active';
  get diagnostics n = row_count;
  if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' sub_aal1:'||n; end if;
  perform pg_temp.su(up, 'aal2');
  update public.subscriptions set status = case when status='active' then 'trialing' else 'active' end where org_id = o;
  get diagnostics n = row_count;
  if n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' sub_aal2:'||n; end if;
  perform pg_temp.root();
  select count(*) into n from public.audit_logs where org_id=o and action='subscription.changed' and actor_id=up;
  if n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' sub_audit:'||n; end if;

  -- 19-21. security events: attributed to the caller, unknown kinds refused, bounded per hour
  perform pg_temp.su(ux);
  b := public.record_security_event('owner_access_denied', '{"area":"owner_center"}');
  perform pg_temp.root();
  select count(*) into n from public.audit_logs where actor_id=ux and action='security.owner_access_denied' and org_id is null;
  if b and n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' event:'||n; end if;
  perform pg_temp.su(ux);
  begin perform public.record_security_event('anything', '{}'); fail:=fail+1; failures:=failures||' event_kind';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' event_kind:'||sqlstate; end if; end;
  for i in 1..40 loop b := public.record_security_event('owner_access_denied', '{}'); end loop;
  perform pg_temp.root();
  select count(*) into n from public.audit_logs where actor_id=ux and action like 'security.%';
  if n=30 then pass:=pass+1; else fail:=fail+1; failures:=failures||' event_cap:'||n; end if;
  -- 22. the owner sees repeated refusals; 23. an organization owner cannot read the overview
  perform pg_temp.su(up);
  j := public.security_overview(7);
  if exists (select 1 from jsonb_array_elements(j->'repeated') e where e->>'actor' = ux::text) then pass:=pass+1; else fail:=fail+1; failures:=failures||' overview'; end if;
  perform pg_temp.su(uo);
  begin j := public.security_overview(7); fail:=fail+1; failures:=failures||' org_overview';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' org_overview:'||sqlstate; end if; end;

  -- 24-30. emergency stop: business pause, organization stop, platform stop
  perform pg_temp.su(ua);
  j := public.set_execution_paused(w, true, 'SEC business pause');
  perform pg_temp.root(); w2 := gen_random_uuid();
  insert into public.workspaces(id, org_id, name, kind) values (w2, o, 'SEC second', 'brand');
  perform pg_temp.su(um);
  begin j := public.set_org_execution_stop(o, true, 'member tries'); fail:=fail+1; failures:=failures||' member_org_stop';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' member_org_stop:'||sqlstate; end if; end;
  perform pg_temp.su(ua);
  j := public.set_org_execution_stop(o, true, 'SEC incident');
  perform pg_temp.root();
  select count(*) into n from public.execution_settings where org_id=o and paused and org_paused;
  if n=2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' org_stop:'||n; end if;
  -- a business admin lifting the business pause does not lift the organization stop
  perform pg_temp.su(ua);
  j := public.set_execution_paused(w, false, '');
  if (j->>'paused')::boolean then pass:=pass+1; else fail:=fail+1; failures:=failures||' ws_lifts_org:'||j::text; end if;
  perform public.set_execution_paused(w, true, 'SEC business pause again');
  -- the platform stop needs the Platform Owner with a verified second factor
  perform pg_temp.su(uo, 'aal2');
  begin j := public.set_platform_execution_stop(true, 'org owner tries'); fail:=fail+1; failures:=failures||' org_owner_platform_stop';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' org_owner_platform_stop:'||sqlstate; end if; end;
  perform pg_temp.su(up, 'aal1');
  begin j := public.set_platform_execution_stop(true, 'SEC platform'); fail:=fail+1; failures:=failures||' platform_aal1';
    exception when others then if sqlerrm='mfa_required' then pass:=pass+1; else fail:=fail+1; failures:=failures||' platform_aal1:'||sqlstate; end if; end;
  perform pg_temp.su(up, 'aal2');
  j := public.set_platform_execution_stop(true, 'SEC platform');
  -- resuming the organization leaves the platform stop and the business pause in force
  perform pg_temp.su(ua);
  j := public.set_org_execution_stop(o, false, '');
  perform pg_temp.root();
  select count(*) into n from public.execution_settings where org_id=o and paused and not org_paused and platform_paused;
  if n=2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' org_resume_keeps_platform:'||n; end if;
  perform pg_temp.su(up, 'aal2');
  j := public.set_platform_execution_stop(false, '');
  perform pg_temp.root();
  select count(*) into n from public.execution_settings where org_id=o and paused;
  if n=1 and exists (select 1 from public.execution_settings where workspace_id=w and paused and workspace_paused) then pass:=pass+1; else fail:=fail+1; failures:=failures||' platform_resume:'||n; end if;
  -- a business created during a stop starts stopped
  perform pg_temp.su(ua); j := public.set_org_execution_stop(o, true, 'SEC again');
  perform pg_temp.root(); insert into public.workspaces(org_id, name, kind) values (o, 'SEC third', 'brand') returning id into w2;
  if exists (select 1 from public.execution_settings where workspace_id=w2 and paused and org_paused) then pass:=pass+1; else fail:=fail+1; failures:=failures||' new_ws_stopped'; end if;
  -- stops and resumes are audited
  select count(*) into n from public.audit_logs where action in ('execution.org_stopped','execution.org_resumed','execution.platform_stopped','execution.platform_resumed') and created_at >= now() - interval '1 minute'
    and (org_id=o or org_id is null);
  if n>=4 then pass:=pass+1; else fail:=fail+1; failures:=failures||' stop_audit:'||n; end if;

  -- 31-34. document plan limits are enforced by the database
  perform pg_temp.root();
  select plan_key into s from public.subscriptions where org_id=o;
  select limit_value into n from public.plan_entitlements where plan_key=s and feature_key='documents';
  perform pg_temp.su(uo);
  for i in 1..coalesce(n, 3) loop
    insert into public.documents(org_id, workspace_id, name, storage_path, mime, size_bytes, uploaded_by)
    values (o, w, 'SEC '||i, o||'/'||w||'/sec-'||i||'.txt', 'text/plain', 10, uo);
  end loop;
  if n is not null then
    begin insert into public.documents(org_id, workspace_id, name, storage_path, mime, size_bytes, uploaded_by) values (o, w, 'SEC over', o||'/'||w||'/sec-over.txt', 'text/plain', 10, uo);
      fail:=fail+1; failures:=failures||' doc_over_limit';
      exception when others then if sqlerrm='document_limit_reached' then pass:=pass+1; else fail:=fail+1; failures:=failures||' doc_over_limit:'||sqlstate||sqlerrm; end if; end;
  else pass:=pass+1; end if;
  if public.document_upload_allowed(o||'/'||w||'/next.txt') = (n is null or n > 0) then pass:=pass+1; else fail:=fail+1; failures:=failures||' upload_allowed'; end if;
  perform pg_temp.root();
  insert into public.plans(key, name, tier, monthly_credits, is_public, active) values ('sec_nodocs', 'SEC no documents', 99, 0, false, true);
  update public.subscriptions set plan_key='sec_nodocs' where org_id=o;
  perform pg_temp.su(uo);
  begin insert into public.documents(org_id, workspace_id, name, storage_path, mime, size_bytes, uploaded_by) values (o, w, 'SEC none', o||'/'||w||'/sec-none.txt', 'text/plain', 10, uo);
    fail:=fail+1; failures:=failures||' doc_not_included';
    exception when others then if sqlerrm='documents_not_included' then pass:=pass+1; else fail:=fail+1; failures:=failures||' doc_not_included:'||sqlstate||sqlerrm; end if; end;
  if not public.document_upload_allowed(o||'/'||w||'/x.txt') then pass:=pass+1; else fail:=fail+1; failures:=failures||' upload_not_included'; end if;
  j := public.document_capacity(o);
  if not (j->>'included')::boolean then pass:=pass+1; else fail:=fail+1; failures:=failures||' capacity:'||j::text; end if;
  perform pg_temp.su(ux);
  begin j := public.document_capacity(o); fail:=fail+1; failures:=failures||' outsider_capacity';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_capacity:'||sqlstate; end if; end;

  -- 35. tampering with a chained entry is detected (simulated as the database owner inside this rolled-back test)
  perform pg_temp.root();
  select id into hid from public.audit_logs where org_id=o and chain_seq is not null order by chain_seq limit 1;
  alter table public.audit_logs disable trigger audit_logs_append_only;
  update public.audit_logs set metadata = metadata || '{"tampered":true}' where id=hid;
  alter table public.audit_logs enable trigger audit_logs_append_only;
  perform pg_temp.su(up);
  j := public.verify_audit_chain();
  if not (j->>'ok')::boolean and j->'problem'->>'kind'='altered_entry' and (j->'problem'->>'id')::bigint=hid then pass:=pass+1; else fail:=fail+1; failures:=failures||' tamper:'||j::text; end if;
  perform pg_temp.root();
  raise exception 'SECURITY_HARDENING_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
