-- Assertions for docs/proposals/0075 (rolled back): conflict decisions and recommendation decisions are recorded
-- with a snapshot, by editors of that business only, are readable only inside that business, and cannot be
-- edited or deleted afterwards, not even by a privileged session.
do $$
declare
  uo uuid := gen_random_uuid(); ue uuid := gen_random_uuid(); um uuid := gen_random_uuid(); uv uuid := gen_random_uuid(); ux uuid := gen_random_uuid();
  o uuid; o2 uuid; w1 uuid; w2 uuid; wx uuid; f1 uuid; f2 uuid; h1 uuid; j jsonb; ev uuid; n int; s jsonb;
  pass int := 0; fail int := 0; failures text := '';
begin
  execute $t$CREATE FUNCTION pg_temp.su(_u uuid) RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; PERFORM set_config('request.jwt.claims', json_build_object('sub',_u,'role','authenticated')::text, true); SET LOCAL ROLE authenticated; END $b$ $t$;
  execute $t$CREATE FUNCTION pg_temp.root() RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; END $b$ $t$;
  insert into auth.users(id,email,aud,role,instance_id) values
    (uo,'dm-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ue,'dm-editor@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (um,'dm-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (uv,'dm-viewer@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ux,'dm-outsider@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  perform pg_temp.su(uo);
  o := public.create_organization('Decision memory fixture','Bakery'); select id into w1 from public.workspaces where org_id=o;
  perform pg_temp.root(); update public.subscriptions set plan_key='business' where org_id=o;
  perform pg_temp.su(uo); w2 := public.create_workspace(o,'Bakery');  -- same name on purpose
  perform pg_temp.su(ux); o2 := public.create_organization('Other org','Bakery'); select id into wx from public.workspaces where org_id=o2;
  perform pg_temp.root();
  insert into public.organization_members(org_id,user_id,role) values(o,ue,'editor'),(o,um,'member'),(o,uv,'viewer');
  insert into public.workspace_members(workspace_id,user_id,role) values(w1,ue,'editor'),(w1,um,'member'),(w1,uv,'viewer');
  insert into public.business_facts(org_id,workspace_id,key,value,source_type,verified) values(o,w1,'Price','€25','user',true) returning id into f1;
  insert into public.business_facts(org_id,workspace_id,key,value,source_type,verified) values(o,w1,'price','€29','document',true) returning id into f2;
  insert into public.business_facts(org_id,workspace_id,key,value,source_type,verified) values(o,w2,'Price','€40','user',true) returning id into h1;

  -- resolving records an event with every value of the topic, the kept value, actor and note
  perform pg_temp.su(ue);
  j := public.resolve_fact_conflict(f2, array[f1], 'Price list of November');
  ev := (j->>'event')::uuid;
  perform pg_temp.root();
  select snapshot into s from public.fact_conflict_events where id=ev and kind='resolved' and kept_fact_id=f2 and kept_value='€29' and actor_id=ue and note='Price list of November' and topic='price';
  if jsonb_array_length(s) = 2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' snapshot:'||coalesce(s::text,'null'); end if;
  if not exists (select 1 from jsonb_array_elements(s) e where e->>'value'='€40') then pass:=pass+1; else fail:=fail+1; failures:=failures||' snapshot_leak'; end if;

  -- review / reopen: editor only, existing topic only, never another business
  perform pg_temp.su(ue);
  ev := public.mark_fact_conflict(w1, 'PRICE.', 'reopened', 'New supplier list');
  if ev is not null then pass:=pass+1; else fail:=fail+1; failures:=failures||' reopen'; end if;
  begin perform public.mark_fact_conflict(w1, 'Audience', 'review_started', ''); fail:=fail+1; failures:=failures||' unknown_topic_ok';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' unknown_topic:'||sqlstate; end if; end;
  begin perform public.mark_fact_conflict(w2, 'Price', 'review_started', ''); fail:=fail+1; failures:=failures||' unassigned_business_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' unassigned_business:'||sqlstate; end if; end;
  begin perform public.mark_fact_conflict(w1, 'Price', 'resolved', ''); fail:=fail+1; failures:=failures||' kind_ok';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' kind:'||sqlstate; end if; end;
  perform pg_temp.su(um);
  begin perform public.mark_fact_conflict(w1, 'Price', 'review_started', ''); fail:=fail+1; failures:=failures||' member_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' member:'||sqlstate; end if; end;
  perform pg_temp.su(ux);
  begin perform public.mark_fact_conflict(w1, 'Price', 'review_started', ''); fail:=fail+1; failures:=failures||' outsider_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider:'||sqlstate; end if; end;

  -- reading: viewer of the business sees the history; outsider and other business see nothing
  perform pg_temp.su(uv); select count(*) into n from public.fact_conflict_events where workspace_id=w1;
  if n = 2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer_read:'||n; end if;
  perform pg_temp.su(ux); select count(*) into n from public.fact_conflict_events;
  if n = 0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_read:'||n; end if;

  -- no direct writes, and history is immutable even for a privileged session
  perform pg_temp.su(ue);
  begin insert into public.fact_conflict_events(org_id,workspace_id,topic,kind,kept_fact_id) values(o,w1,'price','resolved',f1); fail:=fail+1; failures:=failures||' direct_insert_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' direct_insert:'||sqlstate; end if; end;
  perform pg_temp.root();
  begin update public.fact_conflict_events set note='rewritten' where workspace_id=w1; fail:=fail+1; failures:=failures||' update_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' update:'||sqlstate; end if; end;
  begin delete from public.fact_conflict_events where workspace_id=w1; fail:=fail+1; failures:=failures||' delete_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' delete:'||sqlstate; end if; end;

  -- recommendation decisions
  perform pg_temp.su(ue);
  ev := public.decide_recommendation(w1, 'opportunity:abc', 'postponed', current_date + 14, 'fp1', 'After the holidays');
  if exists (select 1 from public.recommendation_decisions where id=ev and until=current_date+14 and actor_id=ue) then pass:=pass+1; else fail:=fail+1; failures:=failures||' postpone'; end if;
  ev := public.decide_recommendation(w1, 'finding:metric_behind:x:2026-10', 'dismissed', null, 'fp2', '');
  if ev is not null then pass:=pass+1; else fail:=fail+1; failures:=failures||' dismiss'; end if;
  begin perform public.decide_recommendation(w1, 'opportunity:abc', 'postponed', current_date, 'fp1', ''); fail:=fail+1; failures:=failures||' past_ok';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' past:'||sqlstate; end if; end;
  begin perform public.decide_recommendation(w1, 'opportunity:abc', 'postponed', current_date + 400, 'fp1', ''); fail:=fail+1; failures:=failures||' far_ok';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' far:'||sqlstate; end if; end;
  begin perform public.decide_recommendation(w1, 'opportunity:abc', 'dismissed', current_date + 3, 'fp1', ''); fail:=fail+1; failures:=failures||' dismiss_until_ok';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' dismiss_until:'||sqlstate; end if; end;
  begin perform public.decide_recommendation(w1, 'bad key', 'dismissed', null, 'fp1', ''); fail:=fail+1; failures:=failures||' key_ok';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' key:'||sqlstate; end if; end;
  begin perform public.decide_recommendation(w2, 'opportunity:abc', 'dismissed', null, 'fp1', ''); fail:=fail+1; failures:=failures||' rec_unassigned_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' rec_unassigned:'||sqlstate; end if; end;
  perform pg_temp.su(uv);
  begin perform public.decide_recommendation(w1, 'opportunity:abc', 'dismissed', null, 'fp1', ''); fail:=fail+1; failures:=failures||' rec_viewer_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' rec_viewer:'||sqlstate; end if; end;
  select count(*) into n from public.recommendation_decisions where workspace_id=w1;
  if n = 2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' rec_viewer_read:'||n; end if;
  perform pg_temp.su(ux); select count(*) into n from public.recommendation_decisions;
  if n = 0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' rec_outsider_read:'||n; end if;
  perform pg_temp.root();
  begin delete from public.recommendation_decisions where workspace_id=w1; fail:=fail+1; failures:=failures||' rec_delete_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' rec_delete:'||sqlstate; end if; end;
  if (select count(*) from public.audit_logs where org_id=o and action in ('recommendation.postponed','recommendation.dismissed','facts.conflict_reopened','facts.conflict_resolved')) = 4
    then pass:=pass+1; else fail:=fail+1; failures:=failures||' audit'; end if;
  SET LOCAL ROLE anon;
  begin perform public.decide_recommendation(w1, 'opportunity:abc', 'dismissed', null, 'fp1', ''); fail:=fail+1; failures:=failures||' anon_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' anon:'||sqlstate; end if; end;
  perform pg_temp.root();
  raise exception 'DECISION_MEMORY_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
