do $$
declare
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid(); uv uuid := gen_random_uuid();
  oa uuid; ob uuid; wa uuid; wb uuid; ca uuid; obs uuid; ga uuid; gb uuid; n int; pass int := 0; fail int := 0; failures text := '';
begin
  insert into auth.users(id,email,aud,role,instance_id) values
    (ua,'ci-a@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ub,'ci-b@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (uv,'ci-v@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  perform set_config('request.jwt.claims', json_build_object('sub',ua,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  oa := public.create_organization('CI A','WS A'); select id into wa from public.workspaces where org_id=oa;
  insert into public.competitors(org_id,workspace_id,name,website) values(oa,wa,'Rival','https://rival.test') returning id into ca;
  insert into public.competitor_observations(org_id,workspace_id,competitor_id,kind,category,statement,source_url) values(oa,wa,ca,'verified_fact','positioning','Title x','https://rival.test/') returning id into obs;
  insert into public.growth_goals(org_id,workspace_id,title) values(oa,wa,'Goal A') returning id into ga;
  update public.competitor_observations set review_status='relevant', goal_id=ga where id=obs; pass:=pass+1;
  begin update public.competitor_observations set statement='rewritten' where id=obs; fail:=fail+1; failures:=failures||' statement_mutable'; exception when others then pass:=pass+1; end;
  begin delete from public.competitor_observations where id=obs; get diagnostics n=row_count; if n>0 then fail:=fail+1; failures:=failures||' obs_deletable'; else pass:=pass+1; end if; exception when others then pass:=pass+1; end;
  begin insert into public.competitor_observations(org_id,workspace_id,competitor_id,kind,category,statement) values(oa,wa,ca,'verified_fact','seo','no source'); fail:=fail+1; failures:=failures||' fact_without_source'; exception when others then pass:=pass+1; end;
  execute 'reset role';
  insert into public.organization_members(org_id,user_id,role) values(oa,uv,'viewer'); insert into public.workspace_members(workspace_id,user_id,role) values(wa,uv,'viewer');
  perform set_config('request.jwt.claims', json_build_object('sub',uv,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.competitor_observations where id=obs; if n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer_cannot_read'; end if;
  begin insert into public.competitors(org_id,workspace_id,name) values(oa,wa,'Viewer add'); fail:=fail+1; failures:=failures||' viewer_insert'; exception when others then pass:=pass+1; end;
  update public.competitor_observations set review_status='irrelevant' where id=obs; get diagnostics n=row_count; if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer_update'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',ub,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  ob := public.create_organization('CI B','WS B'); select id into wb from public.workspaces where org_id=ob;
  insert into public.growth_goals(org_id,workspace_id,title) values(ob,wb,'Goal B') returning id into gb;
  select count(*) into n from public.competitors where id=ca; if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' cross_read_competitor'; end if;
  select count(*) into n from public.competitor_observations where id=obs; if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' cross_read_obs'; end if;
  update public.competitors set name='hijack' where id=ca; get diagnostics n=row_count; if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' cross_update'; end if;
  begin insert into public.competitor_observations(org_id,workspace_id,competitor_id,kind,category,statement) values(ob,wb,ca,'interpretation','other','x'); fail:=fail+1; failures:=failures||' cross_competitor_link'; exception when others then pass:=pass+1; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',ua,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  begin update public.competitor_observations set goal_id=gb where id=obs; fail:=fail+1; failures:=failures||' foreign_goal_link'; exception when others then pass:=pass+1; end;
  begin update public.competitors set workspace_id=wb where id=ca; fail:=fail+1; failures:=failures||' scope_move'; exception when others then pass:=pass+1; end;
  execute 'reset role';
  raise exception 'CI_RESULT pass=% fail=% %', pass, fail, failures;
end $$;
