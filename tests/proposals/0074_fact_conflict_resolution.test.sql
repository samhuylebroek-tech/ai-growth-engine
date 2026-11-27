-- Assertions for docs/proposals/0074 (rolled back): resolving a fact conflict confirms one value and sets the others
-- on the same topic back to review in one step, only for editors of that business, never across businesses or
-- topics, never deleting a fact, and always leaving an audit entry.
do $$
declare
  uo uuid := gen_random_uuid(); ue uuid := gen_random_uuid(); um uuid := gen_random_uuid(); uv uuid := gen_random_uuid(); ux uuid := gen_random_uuid();
  o uuid; o2 uuid; w1 uuid; w2 uuid; wx uuid; f1 uuid; f2 uuid; f3 uuid; g1 uuid; h1 uuid; x1 uuid; j jsonb; n int;
  pass int := 0; fail int := 0; failures text := '';
begin
  execute $t$CREATE FUNCTION pg_temp.su(_u uuid) RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; PERFORM set_config('request.jwt.claims', json_build_object('sub',_u,'role','authenticated')::text, true); SET LOCAL ROLE authenticated; END $b$ $t$;
  execute $t$CREATE FUNCTION pg_temp.root() RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; END $b$ $t$;
  insert into auth.users(id,email,aud,role,instance_id) values
    (uo,'fc-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ue,'fc-editor@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (um,'fc-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (uv,'fc-viewer@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ux,'fc-outsider@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  perform pg_temp.su(uo);
  o := public.create_organization('Fact conflict fixture','Bakery'); select id into w1 from public.workspaces where org_id=o;
  perform pg_temp.root(); update public.subscriptions set plan_key='business' where org_id=o;
  perform pg_temp.su(uo); w2 := public.create_workspace(o,'Catering');
  perform pg_temp.su(ux); o2 := public.create_organization('Other org','Shop'); select id into wx from public.workspaces where org_id=o2;
  perform pg_temp.root();
  insert into public.organization_members(org_id,user_id,role) values(o,ue,'editor'),(o,um,'member'),(o,uv,'viewer');
  insert into public.workspace_members(workspace_id,user_id,role) values(w1,ue,'editor'),(w1,um,'member'),(w1,uv,'viewer');
  insert into public.business_facts(org_id,workspace_id,key,value,source_type,verified) values(o,w1,'Price','€25','user',true) returning id into f1;
  insert into public.business_facts(org_id,workspace_id,key,value,source_type,verified) values(o,w1,'price.','€29','document',true) returning id into f2;
  insert into public.business_facts(org_id,workspace_id,key,value,source_type,verified) values(o,w1,'PRICE','€30','ai_assumption',false) returning id into f3;
  insert into public.business_facts(org_id,workspace_id,key,value,source_type,verified) values(o,w1,'Audience','Families','user',true) returning id into g1;
  insert into public.business_facts(org_id,workspace_id,key,value,source_type,verified) values(o,w2,'Price','€40','user',true) returning id into h1;
  insert into public.business_facts(org_id,workspace_id,key,value,source_type,verified) values(o2,wx,'Price','€1','user',true) returning id into x1;

  if public.fact_topic('  Price. ') = public.fact_topic('price') and public.fact_topic('Price') <> public.fact_topic('Audience') then pass:=pass+1; else fail:=fail+1; failures:=failures||' topic'; end if;

  -- refusals with the exact reason
  perform pg_temp.su(um);
  begin perform public.resolve_fact_conflict(f1, array[f2], ''); fail:=fail+1; failures:=failures||' member_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' member:'||sqlstate; end if; end;
  perform pg_temp.su(uv);
  begin perform public.resolve_fact_conflict(f1, array[f2], ''); fail:=fail+1; failures:=failures||' viewer_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer:'||sqlstate; end if; end;
  perform pg_temp.su(ux);
  begin perform public.resolve_fact_conflict(f1, array[f2], ''); fail:=fail+1; failures:=failures||' outsider_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider:'||sqlstate; end if; end;
  begin perform public.resolve_fact_conflict(x1, array[f1], ''); fail:=fail+1; failures:=failures||' cross_org_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' cross_org:'||sqlstate; end if; end;
  perform pg_temp.su(ue);
  begin perform public.resolve_fact_conflict(f1, array[h1], ''); fail:=fail+1; failures:=failures||' cross_business_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' cross_business:'||sqlstate; end if; end;
  begin perform public.resolve_fact_conflict(f1, array[g1], ''); fail:=fail+1; failures:=failures||' topic_ok';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' other_topic:'||sqlstate; end if; end;
  begin perform public.resolve_fact_conflict(f1, array[f1], ''); fail:=fail+1; failures:=failures||' self_ok';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' self:'||sqlstate; end if; end;
  begin perform public.resolve_fact_conflict(f1, array[]::uuid[], ''); fail:=fail+1; failures:=failures||' empty_ok';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' empty:'||sqlstate; end if; end;
  begin perform public.resolve_fact_conflict(f1, array[gen_random_uuid()], ''); fail:=fail+1; failures:=failures||' unknown_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' unknown:'||sqlstate; end if; end;
  perform pg_temp.root();
  if (select count(*) from public.business_facts where id in (f1,f2) and verified) = 2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' refusal_changed'; end if;
  -- a cross-business refusal leaves the other business untouched
  if (select verified from public.business_facts where id=h1) then pass:=pass+1; else fail:=fail+1; failures:=failures||' h1_changed'; end if;

  -- editor keeps the document price; the user price and the AI guess go back to review
  perform pg_temp.su(ue);
  j := public.resolve_fact_conflict(f2, array[f1, f3], 'Price list of November');
  if (j->>'set_to_review')::int = 1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' count:'||j::text; end if;
  perform pg_temp.root();
  if (select verified from public.business_facts where id=f2) and not (select verified from public.business_facts where id=f1)
     and not (select verified from public.business_facts where id=f3) then pass:=pass+1; else fail:=fail+1; failures:=failures||' state'; end if;
  if (select count(*) from public.business_facts where id in (f1,f2,f3)) = 3 then pass:=pass+1; else fail:=fail+1; failures:=failures||' deleted'; end if;
  if exists (select 1 from public.audit_logs where org_id=o and action='facts.conflict_resolved' and target_id=f2::text
             and actor_id=ue and metadata->>'note'='Price list of November') then pass:=pass+1; else fail:=fail+1; failures:=failures||' audit'; end if;
  -- repeating the same decision changes nothing more but is still recorded
  perform pg_temp.su(ue);
  j := public.resolve_fact_conflict(f2, array[f1, f3], '');
  if (j->>'set_to_review')::int = 0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' repeat:'||j::text; end if;
  -- an owner can reverse the decision; an unverified fact can be the one kept
  perform pg_temp.su(uo);
  j := public.resolve_fact_conflict(f1, array[f2], '');
  perform pg_temp.root();
  if (select verified from public.business_facts where id=f1) and not (select verified from public.business_facts where id=f2) then pass:=pass+1; else fail:=fail+1; failures:=failures||' owner_reverse'; end if;
  -- anonymous callers cannot run it at all
  perform pg_temp.root(); SET LOCAL ROLE anon;
  begin perform public.resolve_fact_conflict(f1, array[f2], ''); fail:=fail+1; failures:=failures||' anon_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' anon:'||sqlstate; end if; end;
  perform pg_temp.root();
  raise exception 'FACT_CONFLICT_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
