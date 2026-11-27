-- Assertions for docs/proposals/0091 (rolled back): onboarding answers are confirmed business facts saved only by
-- editors for known questions, repeated answers do not duplicate, changes and removals are audited with the previous
-- value, stale edits are refused as a whole, other sources are never overwritten and unconfirmed look-alikes are ignored.
do $$
declare
  uo uuid := gen_random_uuid(); um uuid := gen_random_uuid(); ue uuid := gen_random_uuid(); uv uuid := gen_random_uuid(); ux uuid := gen_random_uuid();
  o uuid; w uuid; o2 uuid; w2 uuid; j jsonb; n int; msg text; st text; val text;
  pass int := 0; fail int := 0; failures text := '';
begin
  execute $t$CREATE FUNCTION pg_temp.su(_u uuid) RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; PERFORM set_config('request.jwt.claims', json_build_object('sub',_u,'role','authenticated')::text, true); SET LOCAL ROLE authenticated; END $b$ $t$;
  execute $t$CREATE FUNCTION pg_temp.root() RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; END $b$ $t$;
  insert into auth.users(id,email,aud,role,instance_id) values
    (uo,'ba-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (um,'ba-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ue,'ba-editor@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (uv,'ba-viewer@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ux,'ba-outsider@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  perform pg_temp.su(uo); o := public.create_organization('BA fixture','Bakery'); select id into w from public.workspaces where org_id=o;
  perform pg_temp.su(ux); o2 := public.create_organization('BA other','Shop'); select id into w2 from public.workspaces where org_id=o2;
  perform pg_temp.root();
  insert into public.organization_members(org_id,user_id,role) values(o,um,'member'),(o,ue,'editor'),(o,uv,'viewer');
  insert into public.workspace_members(workspace_id,user_id,role) values(w,um,'member'),(w,ue,'editor'),(w,uv,'viewer');
  -- A website finding on the same topic that must never be overwritten.
  insert into public.business_facts(org_id,workspace_id,key,value,source_type,source_ref,confidence,verified)
    values(o,w,'Ideal customer','Families nearby','website','https://example.test',0.6,false);

  -- 1. an editor saves two answers: confirmed user facts
  perform pg_temp.su(ue);
  j := public.save_business_answers(w, '[{"key":"Customer type","value":"Consumers","expected":null},{"key":"Ideal customer","value":"Office lunch buyers","expected":null}]');
  if (j->>'saved')::int = 2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' save2:'||j::text; end if;
  select count(*) into n from public.business_facts where workspace_id=w and source_ref='Onboarding answer' and verified and source_type='user';
  if n=2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' rows2:'||n; end if;

  -- 2. the same answers again do not duplicate
  j := public.save_business_answers(w, '[{"key":"Customer type","value":"Consumers","expected":"Consumers"},{"key":"Ideal customer","value":"Office lunch buyers","expected":"Office lunch buyers"}]');
  select count(*) into n from public.business_facts where workspace_id=w and source_ref='Onboarding answer';
  if (j->>'unchanged')::int = 2 and n=2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' dup:'||n||':'||j::text; end if;

  -- 3. a change is audited with the previous value
  j := public.save_business_answers(w, '[{"key":"Customer type","value":"Businesses","expected":"Consumers"}]');
  select value into val from public.business_facts where workspace_id=w and key='Customer type' and source_ref='Onboarding answer';
  perform pg_temp.root();
  select count(*) into n from public.audit_logs where org_id=o and action='business_answer.changed' and metadata->>'previous'='Consumers' and actor_id=ue;
  if val='Businesses' and n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' change:'||coalesce(val,'null')||':'||n; end if;

  -- 4. a stale edit is refused and nothing in the same save is written
  perform pg_temp.su(ue);
  begin
    perform public.save_business_answers(w, '[{"key":"Repeat purchases","value":"Often","expected":null},{"key":"Customer type","value":"Both","expected":"Consumers"}]');
    fail:=fail+1; failures:=failures||' stale_not_refused';
  exception when others then get stacked diagnostics st = returned_sqlstate;
    if st='AN409' then pass:=pass+1; else fail:=fail+1; failures:=failures||' stale:'||st; end if; end;
  select count(*) into n from public.business_facts where workspace_id=w and key='Repeat purchases';
  if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' stale_partial:'||n; end if;

  -- 5. members, viewers and outsiders cannot save
  perform pg_temp.su(um);
  begin perform public.save_business_answers(w, '[{"key":"Customer type","value":"X"}]'); fail:=fail+1; failures:=failures||' member_saved';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' member:'||st; end if; end;
  perform pg_temp.su(uv);
  begin perform public.save_business_answers(w, '[{"key":"Customer type","value":"X"}]'); fail:=fail+1; failures:=failures||' viewer_saved';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer:'||st; end if; end;
  perform pg_temp.su(ux);
  begin perform public.save_business_answers(w, '[{"key":"Customer type","value":"X"}]'); fail:=fail+1; failures:=failures||' outsider_saved';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider:'||st; end if; end;
  -- an editor of this business cannot write into another organization's business
  perform pg_temp.su(ue);
  begin perform public.save_business_answers(w2, '[{"key":"Customer type","value":"X"}]'); fail:=fail+1; failures:=failures||' cross_saved';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' cross:'||st; end if; end;

  -- 6. unknown keys, too many answers, duplicate keys and long values are refused
  begin perform public.save_business_answers(w, '[{"key":"Password","value":"x"}]'); fail:=fail+1; failures:=failures||' unknown_key';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' unknown:'||st; end if; end;
  begin perform public.save_business_answers(w, (select jsonb_agg(jsonb_build_object('key','Customer type','value','x')) from generate_series(1,13))); fail:=fail+1; failures:=failures||' too_many';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' many:'||st; end if; end;
  begin perform public.save_business_answers(w, '[{"key":"Customer type","value":"a"},{"key":"Customer type","value":"b"}]'); fail:=fail+1; failures:=failures||' dup_keys';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' dupk:'||st; end if; end;
  begin perform public.save_business_answers(w, jsonb_build_array(jsonb_build_object('key','Customer type','value',repeat('x',1001)))); fail:=fail+1; failures:=failures||' long';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' long:'||st; end if; end;

  -- 7. the website finding on the same topic is untouched
  perform pg_temp.root();
  select count(*) into n from public.business_facts where workspace_id=w and key='Ideal customer' and source_type='website' and value='Families nearby' and not verified;
  if n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' website_changed:'||n; end if;

  -- 8. an unconfirmed look-alike added by a member is ignored; the editor's answer becomes its own confirmed row
  perform pg_temp.su(um);
  insert into public.business_facts(org_id,workspace_id,key,value,source_type,source_ref,confidence,verified)
    values(o,w,'Typical sales cycle','Spoofed','user','Onboarding answer',1,false);
  perform pg_temp.su(ue);
  j := public.save_business_answers(w, '[{"key":"Typical sales cycle","value":"Weeks","expected":null}]');
  perform pg_temp.root();
  select count(*) into n from public.business_facts where workspace_id=w and key='Typical sales cycle' and verified and value='Weeks';
  select count(*) + n * 10 into n from public.business_facts where workspace_id=w and key='Typical sales cycle' and not verified and value='Spoofed';
  if n=11 then pass:=pass+1; else fail:=fail+1; failures:=failures||' spoof:'||n; end if;

  -- 9. emptying an answer removes it, audited with the previous value
  perform pg_temp.su(ue);
  j := public.save_business_answers(w, '[{"key":"Ideal customer","value":"  ","expected":"Office lunch buyers"}]');
  perform pg_temp.root();
  select count(*) into n from public.business_facts where workspace_id=w and key='Ideal customer' and source_ref='Onboarding answer';
  select count(*) + n * 10 into n from public.audit_logs where org_id=o and action='business_answer.cleared' and metadata->>'previous'='Office lunch buyers';
  if (j->>'cleared')::int = 1 and n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' clear:'||n||':'||j::text; end if;

  -- 10. signed-out callers cannot run it; viewers can read the answers like other facts, outsiders cannot
  if not has_function_privilege('anon', 'public.save_business_answers(uuid,jsonb)', 'execute') then pass:=pass+1; else fail:=fail+1; failures:=failures||' anon_exec'; end if;
  perform pg_temp.su(uv);
  select count(*) into n from public.business_facts where workspace_id=w and source_ref='Onboarding answer' and verified;
  if n=2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer_reads:'||n; end if;
  perform pg_temp.su(ux);
  select count(*) into n from public.business_facts where workspace_id=w;
  if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_reads:'||n; end if;
  perform pg_temp.root();
  raise exception 'BUSINESS_ANSWERS_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
