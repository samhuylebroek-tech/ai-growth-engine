-- Assertions for docs/proposals/0090 (rolled back): limits per person, business and organization are enforced in the
-- database for AI runs and uploads (also on privileged paths), website checks/connections are counted only for
-- members, repeated failures pause a person, nobody can read or reset the counters, and refused attempts leave
-- nothing behind.
do $$
declare
  uo uuid := gen_random_uuid(); um uuid := gen_random_uuid(); ue uuid := gen_random_uuid(); uv uuid := gen_random_uuid(); ux uuid := gen_random_uuid();
  o uuid; w uuid; o2 uuid; w2 uuid; j jsonb; n int; i int; msg text; st text;
  pass int := 0; fail int := 0; failures text := '';
begin
  execute $t$CREATE FUNCTION pg_temp.su(_u uuid) RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; PERFORM set_config('request.jwt.claims', json_build_object('sub',_u,'role','authenticated')::text, true); SET LOCAL ROLE authenticated; END $b$ $t$;
  execute $t$CREATE FUNCTION pg_temp.root() RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; END $b$ $t$;
  insert into auth.users(id,email,aud,role,instance_id) values
    (uo,'rl-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (um,'rl-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ue,'rl-editor@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (uv,'rl-viewer@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ux,'rl-outsider@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  perform pg_temp.su(uo); o := public.create_organization('RL fixture','Bakery'); select id into w from public.workspaces where org_id=o;
  perform pg_temp.su(ux); o2 := public.create_organization('RL other','Shop'); select id into w2 from public.workspaces where org_id=o2;
  perform pg_temp.root();
  insert into public.organization_members(org_id,user_id,role) values(o,um,'member'),(o,ue,'editor'),(o,uv,'viewer');
  insert into public.workspace_members(workspace_id,user_id,role) values(w,um,'member'),(w,ue,'editor'),(w,uv,'viewer');

  -- 1. AI: a person gets 10 runs per minute; the 11th is refused with RL429 and leaves no run behind
  perform pg_temp.su(um);
  for i in 1..10 loop insert into public.agent_runs(org_id,workspace_id,agent_key,user_id) values(o,w,'growth_officer',um); end loop;
  begin insert into public.agent_runs(org_id,workspace_id,agent_key,user_id) values(o,w,'growth_officer',um);
    fail:=fail+1; failures:=failures||' ai_user_not_refused';
  exception when others then get stacked diagnostics msg = message_text, st = returned_sqlstate;
    if st='RL429' and msg like 'rate_limited:ai:user:%' then pass:=pass+1; else fail:=fail+1; failures:=failures||' ai_user_msg:'||st||':'||msg; end if; end;
  select count(*) into n from public.agent_runs where user_id=um;
  if n=10 then pass:=pass+1; else fail:=fail+1; failures:=failures||' ai_refused_left_row:'||n; end if;

  -- 2. privileged paths are limited too (a SECURITY DEFINER function inserting for that person)
  perform pg_temp.root();
  begin insert into public.agent_runs(org_id,workspace_id,agent_key,user_id) values(o,w,'growth_officer',um);
    fail:=fail+1; failures:=failures||' ai_definer_not_refused';
  exception when others then get stacked diagnostics st = returned_sqlstate; if st='RL429' then pass:=pass+1; else fail:=fail+1; failures:=failures||' ai_definer:'||st; end if; end;

  -- 3. another person is not affected by that person's limit, but a full business limit stops everyone in it
  perform pg_temp.su(ue);
  insert into public.agent_runs(org_id,workspace_id,agent_key,user_id) values(o,w,'growth_officer',ue);
  pass:=pass+1;
  perform pg_temp.root();
  insert into public.rate_limit_events(action,user_id,org_id,workspace_id) select 'ai', gen_random_uuid(), o, w from generate_series(1,200);
  perform pg_temp.su(ue);
  begin insert into public.agent_runs(org_id,workspace_id,agent_key,user_id) values(o,w,'growth_officer',ue);
    fail:=fail+1; failures:=failures||' ai_workspace_not_refused';
  exception when others then get stacked diagnostics msg = message_text;
    if msg like 'rate_limited:ai:workspace:%' then pass:=pass+1; else fail:=fail+1; failures:=failures||' ai_ws_msg:'||msg; end if; end;
  -- ...while the other organization is untouched
  perform pg_temp.su(ux);
  insert into public.agent_runs(org_id,workspace_id,agent_key,user_id) values(o2,w2,'growth_officer',ux);
  pass:=pass+1;

  -- 4. uploads: 20 per 10 minutes per person (document record refused, so the page removes the stored file)
  perform pg_temp.root();
  insert into public.rate_limit_events(action,user_id,org_id,workspace_id) select 'upload', um, o, w from generate_series(1,20);
  perform pg_temp.su(um);
  begin insert into public.documents(org_id,workspace_id,name,storage_path,mime,size_bytes,uploaded_by)
          values(o,w,'a.txt',o::text||'/'||w::text||'/x-a.txt','text/plain',10,um);
    fail:=fail+1; failures:=failures||' upload_not_refused';
  exception when others then get stacked diagnostics msg = message_text;
    if msg like 'rate_limited:upload:user:%' then pass:=pass+1; else fail:=fail+1; failures:=failures||' upload_msg:'||msg; end if; end;

  -- 5. website checks: members get 5 per 10 minutes; the 6th returns a wait time
  for i in 1..5 loop j := public.consume_rate_limit('seo', w);
    if (j->>'allowed')::boolean is not true then fail:=fail+1; failures:=failures||' seo_early_refusal:'||i; end if; end loop;
  j := public.consume_rate_limit('seo', w);
  if (j->>'allowed')::boolean = false and j->>'scope'='user' and (j->>'retry_after')::int between 1 and 600 then pass:=pass+1;
  else fail:=fail+1; failures:=failures||' seo_6th:'||j::text; end if;
  -- AI/upload counting cannot be spent or skipped through the API
  begin perform public.consume_rate_limit('ai', w); fail:=fail+1; failures:=failures||' consume_ai_allowed';
  exception when others then pass:=pass+1; end;

  -- 6. outsiders and viewers are refused without being counted for that business
  perform pg_temp.su(ux);
  j := public.consume_rate_limit('seo', w);
  if j->>'scope'='forbidden' then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_seo:'||j::text; end if;
  perform pg_temp.su(uv);
  j := public.consume_rate_limit('connect', w);
  if j->>'scope'='forbidden' then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer_connect:'||j::text; end if;
  perform pg_temp.root();
  select count(*) into n from public.rate_limit_events where user_id in (ux,uv) and action in ('seo','connect');
  if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' forbidden_counted:'||n; end if;

  -- 7. ten failed attempts in 15 minutes pause website checks and connections for that person
  perform pg_temp.su(ue);
  for i in 1..10 loop perform public.record_failed_attempt('connect', w); end loop;
  j := public.consume_rate_limit('connect', w);
  if (j->>'allowed')::boolean = false and j->>'scope'='failures' then pass:=pass+1; else fail:=fail+1; failures:=failures||' failure_pause:'||j::text; end if;
  j := public.consume_rate_limit('seo', w);
  if j->>'scope'='failures' then pass:=pass+1; else fail:=fail+1; failures:=failures||' failure_pause_seo:'||j::text; end if;
  -- failures are capped at 50 per hour, so the table cannot be flooded
  for i in 1..60 loop perform public.record_failed_attempt('seo', null); end loop;
  perform pg_temp.root();
  select count(*) into n from public.rate_limit_events where action='failure' and user_id=ue;
  if n=50 then pass:=pass+1; else fail:=fail+1; failures:=failures||' failure_cap:'||n; end if;
  -- a failure naming a business the caller does not belong to is stored without that business
  perform pg_temp.su(ux);
  perform public.record_failed_attempt('seo', w);
  perform pg_temp.root();
  select count(*) into n from public.rate_limit_events where user_id=ux and action='failure' and workspace_id is null and org_id is null;
  if n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' foreign_failure_scope:'||n; end if;

  -- 8. nobody can read, add or remove counters, or change the limits, through the API
  perform pg_temp.su(uo);
  begin select count(*) into n from public.rate_limit_events; fail:=fail+1; failures:=failures||' events_readable';
  exception when others then pass:=pass+1; end;
  begin insert into public.rate_limit_events(action,user_id) values('ai',uo); fail:=fail+1; failures:=failures||' events_insertable';
  exception when others then pass:=pass+1; end;
  begin delete from public.rate_limit_events; fail:=fail+1; failures:=failures||' events_deletable';
  exception when others then pass:=pass+1; end;
  select count(*) into n from public.rate_limit_policies;
  if n>=14 then pass:=pass+1; else fail:=fail+1; failures:=failures||' policies_unreadable:'||n; end if;
  begin update public.rate_limit_policies set max_count=100000; get diagnostics n = row_count;
    if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' policies_writable'; end if;
  exception when others then pass:=pass+1; end;
  begin perform public.rl_take('seo', uo, o, w); fail:=fail+1; failures:=failures||' rl_take_callable';
  exception when others then pass:=pass+1; end;

  -- 9. old counters are pruned as new ones arrive
  perform pg_temp.root();
  insert into public.rate_limit_events(action,user_id,created_at) values('seo',uo,now()-interval '3 days');
  perform pg_temp.su(uo); perform public.consume_rate_limit('seo', w); perform pg_temp.root();
  select count(*) into n from public.rate_limit_events where created_at < now()-interval '2 days';
  if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' not_pruned:'||n; end if;

  -- 10. the uploader removes a stored file that has no document record; recorded files and other people's files stay
  perform pg_temp.root();
  set local storage.allow_delete_query = 'true';
  insert into storage.objects(bucket_id,name,owner_id) values
    ('documents', o::text||'/'||w::text||'/orphan.txt', um::text),
    ('documents', o::text||'/'||w::text||'/recorded.txt', um::text),
    ('documents', o::text||'/'||w::text||'/other.txt', ue::text);
  insert into public.rate_limit_events(action,user_id,created_at) values('upload',um,now()-interval '3 days');
  delete from public.rate_limit_events where action='upload' and user_id=um;
  insert into public.documents(org_id,workspace_id,name,storage_path,mime,size_bytes,uploaded_by)
    values(o,w,'recorded.txt',o::text||'/'||w::text||'/recorded.txt','text/plain',10,um);
  perform pg_temp.su(um);
  delete from storage.objects where bucket_id='documents' and name like o::text||'/%';
  perform pg_temp.root();
  select count(*) into n from storage.objects where bucket_id='documents' and name=o::text||'/'||w::text||'/orphan.txt';
  if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' orphan_kept'; end if;
  select count(*) into n from storage.objects where bucket_id='documents' and name in (o::text||'/'||w::text||'/recorded.txt', o::text||'/'||w::text||'/other.txt');
  if n=2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' protected_files_removed:'||n; end if;

  raise exception 'RATE_LIMITS_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
