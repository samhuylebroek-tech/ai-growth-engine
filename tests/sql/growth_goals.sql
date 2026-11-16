-- Goals, linked work and saved strategies: isolation and immutability. Always raises, so it rolls back.
do $$
declare
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid(); uv uuid := gen_random_uuid();
  oa uuid; ob uuid; wa uuid; wb uuid; ga uuid; gb uuid; pa uuid; n int; pass int := 0; fail int := 0; failures text := '';
begin
  insert into auth.users(id,email,aud,role,instance_id) values
    (ua,'gg-a@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ub,'gg-b@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (uv,'gg-v@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  perform set_config('request.jwt.claims', json_build_object('sub',ua,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  oa := public.create_organization('GG A','WS A'); select id into wa from public.workspaces where org_id=oa;
  insert into public.growth_goals(org_id,workspace_id,title) values(oa,wa,'Goal A') returning id into ga;
  insert into public.projects(org_id,workspace_id,title,goal_id) values(oa,wa,'P',ga) returning id into pa;
  if pa is not null then pass:=pass+1; else fail:=fail+1; failures:=failures||' link_project'; end if;
  insert into public.growth_strategies(org_id,workspace_id,goal_id,request_key,summary,body) values(oa,wa,ga,'00000000-0000-0000-0000-000000000001','s','{}'); pass:=pass+1;
  begin insert into public.growth_strategies(org_id,workspace_id,goal_id,request_key,summary,body) values(oa,wa,ga,'00000000-0000-0000-0000-000000000001','s','{}'); fail:=fail+1; failures:=failures||' dup_strategy'; exception when others then pass:=pass+1; end;
  begin update public.growth_strategies set summary='x' where workspace_id=wa; get diagnostics n=row_count; if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' strategy_update'; end if; exception when others then pass:=pass+1; end;
  begin delete from public.growth_strategies where workspace_id=wa; get diagnostics n=row_count; if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' strategy_delete'; end if; exception when others then pass:=pass+1; end;
  execute 'reset role';
  insert into public.organization_members(org_id,user_id,role) values(oa,uv,'viewer');
  insert into public.workspace_members(workspace_id,user_id,role) values(wa,uv,'viewer');

  perform set_config('request.jwt.claims', json_build_object('sub',ub,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  ob := public.create_organization('GG B','WS B'); select id into wb from public.workspaces where org_id=ob;
  insert into public.growth_goals(org_id,workspace_id,title) values(ob,wb,'Goal B') returning id into gb;
  select count(*) into n from public.growth_strategies where workspace_id=wa; if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' B_reads_strategyA'; end if;
  select count(*) into n from public.growth_goals where workspace_id=wa; if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' B_reads_goalA'; end if;
  begin insert into public.growth_strategies(org_id,workspace_id,goal_id,request_key,summary,body) values(oa,wa,ga,gen_random_uuid(),'s','{}'); fail:=fail+1; failures:=failures||' B_writes_strategyA'; exception when others then pass:=pass+1; end;
  begin insert into public.projects(org_id,workspace_id,title,goal_id) values(ob,wb,'X',ga); fail:=fail+1; failures:=failures||' cross_ws_goal_link'; exception when others then pass:=pass+1; end;
  begin insert into public.growth_strategies(org_id,workspace_id,goal_id,request_key,summary,body) values(ob,wb,ga,gen_random_uuid(),'s','{}'); fail:=fail+1; failures:=failures||' cross_ws_strategy_goal'; exception when others then pass:=pass+1; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub',uv,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.growth_strategies where workspace_id=wa; if n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer_cannot_read'; end if;
  begin insert into public.growth_strategies(org_id,workspace_id,goal_id,request_key,summary,body) values(oa,wa,ga,gen_random_uuid(),'s','{}'); fail:=fail+1; failures:=failures||' viewer_writes'; exception when others then pass:=pass+1; end;
  update public.projects set goal_id=null where id=pa; get diagnostics n=row_count; if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer_unlinks'; end if;
  execute 'reset role';
  raise exception 'GROWTH_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
