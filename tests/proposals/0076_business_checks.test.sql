-- Assertions for docs/proposals/0076 (rolled back): checks are recorded by members of that business only, findings
-- are validated, the change summary is computed from the previous check, checks are insert-only and readable only
-- inside the business, and only admins set the frequency.
do $$
declare
  uo uuid := gen_random_uuid(); um uuid := gen_random_uuid(); uv uuid := gen_random_uuid(); ux uuid := gen_random_uuid();
  o uuid; o2 uuid; w1 uuid; w2 uuid; wx uuid; c1 uuid; cx uuid; j jsonb; n int; s jsonb;
  pass int := 0; fail int := 0; failures text := '';
  f1 jsonb := '[{"id":"stale:abc","code":"goal_stale","kind":"stale","impact":"medium","vars":{"title":"Leads"}},{"id":"budget:x1","code":"budget_over_cap","kind":"risk","impact":"high","vars":{}}]';
  f2 jsonb := '[{"id":"budget:x1","code":"budget_over_cap","kind":"risk","impact":"high","vars":{}},{"id":"tasks_overdue","code":"tasks_overdue","kind":"risk","impact":"medium","vars":{"n":3}}]';
begin
  execute $t$CREATE FUNCTION pg_temp.su(_u uuid) RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; PERFORM set_config('request.jwt.claims', json_build_object('sub',_u,'role','authenticated')::text, true); SET LOCAL ROLE authenticated; END $b$ $t$;
  execute $t$CREATE FUNCTION pg_temp.root() RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; END $b$ $t$;
  insert into auth.users(id,email,aud,role,instance_id) values
    (uo,'bc-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (um,'bc-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (uv,'bc-viewer@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ux,'bc-outsider@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  perform pg_temp.su(uo);
  o := public.create_organization('Check fixture','Bakery'); select id into w1 from public.workspaces where org_id=o;
  perform pg_temp.root(); update public.subscriptions set plan_key='business' where org_id=o;
  perform pg_temp.su(uo); w2 := public.create_workspace(o,'Second');
  perform pg_temp.su(ux); o2 := public.create_organization('Other org','Shop'); select id into wx from public.workspaces where org_id=o2;
  perform pg_temp.root();
  insert into public.organization_members(org_id,user_id,role) values(o,um,'member'),(o,uv,'viewer');
  insert into public.workspace_members(workspace_id,user_id,role) values(w1,um,'member'),(w1,uv,'viewer');
  perform pg_temp.su(uo); insert into public.campaigns(org_id,workspace_id,title,created_by) values(o,w1,'Autumn',uo) returning id into c1;
  perform pg_temp.su(ux); insert into public.campaigns(org_id,workspace_id,title,created_by) values(o2,wx,'Theirs',ux) returning id into cx;
  perform pg_temp.root();

  -- a member records the first check; summary says first, all new
  perform pg_temp.su(um);
  j := public.record_business_check(w1, 'manual', null, '{"financial":{"revenue":0}}', f1);
  if (j->>'first')::boolean and (j->>'new')::int = 2 and (j->>'resolved')::int = 0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' first:'||j::text; end if;
  -- a second check within a minute is refused
  begin perform public.record_business_check(w1, 'manual', null, '{}', f2); fail:=fail+1; failures:=failures||' too_soon_ok';
    exception when others then if sqlstate='P0001' and sqlerrm='check_too_soon' then pass:=pass+1; else fail:=fail+1; failures:=failures||' too_soon:'||sqlstate; end if; end;
  -- after a minute: one new, one still open, one resolved (computed here, not by the caller)
  perform pg_temp.root(); alter table public.business_checks disable trigger business_checks_immutable;
  update public.business_checks set created_at = now() - interval '2 minutes' where workspace_id=w1;
  alter table public.business_checks enable trigger business_checks_immutable;
  perform pg_temp.su(um);
  j := public.record_business_check(w1, 'after_campaign', c1, '{}', f2);
  if (j->>'new')::int = 1 and (j->>'still_open')::int = 1 and (j->>'resolved')::int = 1 and not (j->>'first')::boolean then pass:=pass+1; else fail:=fail+1; failures:=failures||' diff:'||j::text; end if;
  perform pg_temp.root();
  select summary into s from public.business_checks where id=(j->>'id')::uuid and previous_id is not null and actor_id=um and subject_id=c1;
  if s->>'resolved' = '1' then pass:=pass+1; else fail:=fail+1; failures:=failures||' stored_summary'; end if;

  -- validation: bad finding, bad kind, subject from another business, subject missing
  perform pg_temp.root(); alter table public.business_checks disable trigger business_checks_immutable;
  update public.business_checks set created_at = now() - interval '5 minutes' where workspace_id=w1;
  alter table public.business_checks enable trigger business_checks_immutable;
  perform pg_temp.su(um);
  begin perform public.record_business_check(w1, 'manual', null, '{}', '[{"id":"x y","code":"a","kind":"risk","impact":"high"}]'); fail:=fail+1; failures:=failures||' bad_finding_ok';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' bad_finding:'||sqlstate; end if; end;
  begin perform public.record_business_check(w1, 'manual', null, '{}', '[{"id":"a","code":"a","kind":"proof","impact":"high"}]'); fail:=fail+1; failures:=failures||' bad_kind_ok';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' bad_kind:'||sqlstate; end if; end;
  begin perform public.record_business_check(w1, 'after_campaign', cx, '{}', '[]'); fail:=fail+1; failures:=failures||' foreign_subject_ok';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' foreign_subject:'||sqlstate; end if; end;
  begin perform public.record_business_check(w1, 'after_campaign', null, '{}', '[]'); fail:=fail+1; failures:=failures||' no_subject_ok';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' no_subject:'||sqlstate; end if; end;
  begin perform public.record_business_check(w1, 'yearly', null, '{}', '[]'); fail:=fail+1; failures:=failures||' bad_check_kind_ok';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' bad_check_kind:'||sqlstate; end if; end;

  -- access: viewer cannot record, member not assigned to w2 cannot, outsider cannot
  perform pg_temp.su(uv);
  begin perform public.record_business_check(w1, 'manual', null, '{}', '[]'); fail:=fail+1; failures:=failures||' viewer_record_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer_record:'||sqlstate; end if; end;
  perform pg_temp.su(um);
  begin perform public.record_business_check(w2, 'manual', null, '{}', '[]'); fail:=fail+1; failures:=failures||' unassigned_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' unassigned:'||sqlstate; end if; end;
  perform pg_temp.su(ux);
  begin perform public.record_business_check(w1, 'manual', null, '{}', '[]'); fail:=fail+1; failures:=failures||' outsider_record_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_record:'||sqlstate; end if; end;
  -- no direct writes for anyone signed in
  perform pg_temp.su(um);
  begin insert into public.business_checks(org_id,workspace_id,kind,inspected,findings) values(o,w1,'manual','{}','[]'); fail:=fail+1; failures:=failures||' direct_insert_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' direct_insert:'||sqlstate; end if; end;

  -- reading
  perform pg_temp.su(uv); select count(*) into n from public.business_checks where workspace_id=w1;
  if n = 2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer_read:'||n; end if;
  perform pg_temp.su(ux); select count(*) into n from public.business_checks;
  if n = 0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_read:'||n; end if;

  -- frequency: admin/owner only
  perform pg_temp.su(um);
  begin perform public.set_business_check_frequency(w1, 'weekly'); fail:=fail+1; failures:=failures||' member_freq_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' member_freq:'||sqlstate; end if; end;
  perform pg_temp.su(uo);
  perform public.set_business_check_frequency(w1, 'weekly');
  perform public.set_business_check_frequency(w1, 'daily');
  begin perform public.set_business_check_frequency(w1, 'hourly'); fail:=fail+1; failures:=failures||' bad_freq_ok';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' bad_freq:'||sqlstate; end if; end;
  perform pg_temp.su(uv); select count(*) into n from public.business_check_settings where workspace_id=w1 and frequency='daily';
  if n = 1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' freq_read:'||n; end if;

  -- insert-only even for a privileged session; audit written
  perform pg_temp.root();
  begin delete from public.business_checks where workspace_id=w1; fail:=fail+1; failures:=failures||' delete_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' delete:'||sqlstate; end if; end;
  begin update public.business_checks set findings='[]' where workspace_id=w1; fail:=fail+1; failures:=failures||' update_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' update:'||sqlstate; end if; end;
  if (select count(*) from public.audit_logs where org_id=o and action='monitoring.check_recorded') = 2
     and (select count(*) from public.audit_logs where org_id=o and action='monitoring.frequency_set') = 2
    then pass:=pass+1; else fail:=fail+1; failures:=failures||' audit'; end if;
  SET LOCAL ROLE anon;
  begin perform public.record_business_check(w1, 'manual', null, '{}', '[]'); fail:=fail+1; failures:=failures||' anon_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' anon:'||sqlstate; end if; end;
  perform pg_temp.root();
  raise exception 'BUSINESS_CHECKS_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
