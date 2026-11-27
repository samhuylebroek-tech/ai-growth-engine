-- Assertions for docs/proposals/0060 (rolled back). Opportunities are workspace-isolated,
-- insert-only, role-checked on decisions, and convert into exactly one goal.
do $$
declare
  ua uuid := gen_random_uuid(); um uuid := gen_random_uuid(); uv uuid := gen_random_uuid(); ub uuid := gen_random_uuid();
  oa uuid; wa uuid; ob uuid; wb uuid; op uuid; op2 uuid; r jsonb; r2 jsonb; n int; k uuid := gen_random_uuid();
  pass int := 0; fail int := 0; failures text := '';
begin
  insert into auth.users(id,email,aud,role,instance_id) values
    (ua,'op-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (um,'op-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (uv,'op-viewer@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ub,'op-outsider@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  perform set_config('request.jwt.claims', json_build_object('sub',ub,'role','authenticated')::text, true); execute 'set local role authenticated';
  ob := public.create_organization('Opportunity fixture B','B'); select id into wb from public.workspaces where org_id = ob;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',ua,'role','authenticated')::text, true); execute 'set local role authenticated';
  oa := public.create_organization('Opportunity fixture A','A'); select id into wa from public.workspaces where org_id = oa;
  execute 'reset role';
  insert into public.organization_members(org_id,user_id,role) values(oa,um,'member'),(oa,uv,'viewer');
  insert into public.workspace_members(workspace_id,user_id,role) values(wa,um,'member'),(wa,uv,'viewer');

  -- member inserts
  perform set_config('request.jwt.claims', json_build_object('sub',um,'role','authenticated')::text, true); execute 'set local role authenticated';
  insert into public.growth_opportunities(org_id,workspace_id,request_key,position,domain,title,summary,impact,feasibility,cost,time_to_value,risk,horizon_days,kpis,confidence,created_by)
    values(oa,wa,k,1,'retention','Referral programme for regulars','Existing customers refer friends',4,4,2,2,2,90,'[{"metric":"Referred customers","target":"20 in 90 days"}]','medium',um) returning id into op;
  pass:=pass+1;
  insert into public.growth_opportunities(org_id,workspace_id,request_key,position,domain,title,summary,impact,feasibility,cost,time_to_value,risk,horizon_days,confidence,created_by)
    values(oa,wa,k,2,'events_offline','Local tasting event','Event for nearby offices',3,3,3,3,3,60,'low',um) returning id into op2;
  begin insert into public.growth_opportunities(org_id,workspace_id,request_key,position,domain,title,summary,impact,feasibility,cost,time_to_value,risk,horizon_days,confidence,created_by)
    values(oa,wa,k,1,'sales','Duplicate position','x',3,3,3,3,3,60,'low',um); fail:=fail+1; failures:=failures||' duplicate_position'; exception when unique_violation then pass:=pass+1; end;
  begin insert into public.growth_opportunities(org_id,workspace_id,request_key,position,domain,title,summary,impact,feasibility,cost,time_to_value,risk,horizon_days,confidence,created_by,status)
    values(oa,wa,gen_random_uuid(),1,'sales','Pre-shortlisted','x',3,3,3,3,3,60,'low',um,'shortlisted'); fail:=fail+1; failures:=failures||' insert_with_status'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin insert into public.growth_opportunities(org_id,workspace_id,request_key,position,domain,title,summary,impact,feasibility,cost,time_to_value,risk,horizon_days,confidence,created_by)
    values(oa,wa,gen_random_uuid(),1,'sales','Bad score','x',9,3,3,3,3,60,'low',um); fail:=fail+1; failures:=failures||' score_range'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin insert into public.growth_opportunities(org_id,workspace_id,request_key,position,domain,title,summary,impact,feasibility,cost,time_to_value,risk,horizon_days,confidence,created_by)
    values(oa,wa,gen_random_uuid(),1,'sales','Other creator','x',3,3,3,3,3,60,'low',ua); fail:=fail+1; failures:=failures||' impersonated_creator'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin insert into public.growth_opportunities(org_id,workspace_id,request_key,position,domain,title,summary,impact,feasibility,cost,time_to_value,risk,horizon_days,confidence,created_by)
    values(oa,wb,gen_random_uuid(),1,'sales','Foreign workspace','x',3,3,3,3,3,60,'low',um); fail:=fail+1; failures:=failures||' foreign_workspace_insert'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin update public.growth_opportunities set title='Changed' where id=op; get diagnostics n = row_count; if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' direct_update'; end if; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin delete from public.growth_opportunities where id=op; get diagnostics n = row_count; if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' direct_delete'; end if; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  if public.set_growth_opportunity_status(op2,'shortlisted')='shortlisted' then pass:=pass+1; else fail:=fail+1; failures:=failures||' shortlist'; end if;
  begin perform public.set_growth_opportunity_status(op2,'converted'); fail:=fail+1; failures:=failures||' status_converted_direct'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';

  -- viewer reads, cannot decide or insert
  perform set_config('request.jwt.claims', json_build_object('sub',uv,'role','authenticated')::text, true); execute 'set local role authenticated';
  select count(*) into n from public.growth_opportunities where workspace_id=wa; if n=2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer_read'; end if;
  begin perform public.set_growth_opportunity_status(op,'dismissed'); fail:=fail+1; failures:=failures||' viewer_decide'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.convert_growth_opportunity(op); fail:=fail+1; failures:=failures||' viewer_convert'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin insert into public.growth_opportunities(org_id,workspace_id,request_key,position,domain,title,summary,impact,feasibility,cost,time_to_value,risk,horizon_days,confidence,created_by)
    values(oa,wa,gen_random_uuid(),1,'sales','Viewer insert','x',3,3,3,3,3,60,'low',uv); fail:=fail+1; failures:=failures||' viewer_insert'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';

  -- outsider sees nothing and cannot act
  perform set_config('request.jwt.claims', json_build_object('sub',ub,'role','authenticated')::text, true); execute 'set local role authenticated';
  select count(*) into n from public.growth_opportunities where workspace_id=wa; if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_read'; end if;
  begin perform public.convert_growth_opportunity(op); fail:=fail+1; failures:=failures||' outsider_convert'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  begin perform public.set_growth_opportunity_status(op,'dismissed'); fail:=fail+1; failures:=failures||' outsider_decide'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';

  -- member converts once; repeat returns the same goal
  perform set_config('request.jwt.claims', json_build_object('sub',um,'role','authenticated')::text, true); execute 'set local role authenticated';
  r := public.convert_growth_opportunity(op); r2 := public.convert_growth_opportunity(op);
  if (r->>'created')::boolean and not (r2->>'created')::boolean and r->>'goal_id' = r2->>'goal_id' then pass:=pass+1; else fail:=fail+1; failures:=failures||' convert_idempotent'; end if;
  select count(*) into n from public.growth_goals where id=(r->>'goal_id')::uuid and workspace_id=wa and objective='retention' and metric='Referred customers' and status='active'; if n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' goal_fields'; end if;
  begin perform public.set_growth_opportunity_status(op,'open'); fail:=fail+1; failures:=failures||' converted_reopen'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  perform public.set_growth_opportunity_status(op2,'dismissed');
  begin perform public.convert_growth_opportunity(op2); fail:=fail+1; failures:=failures||' convert_dismissed'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';

  -- privileges
  if not has_table_privilege('anon','public.growth_opportunities','select') and not has_table_privilege('authenticated','public.growth_opportunities','truncate')
     and not has_function_privilege('anon','public.convert_growth_opportunity(uuid)','execute') then pass:=pass+1; else fail:=fail+1; failures:=failures||' privileges'; end if;

  raise exception 'OPPORTUNITIES_RESULT pass=% fail=% failures=[%]', pass, fail, trim(failures);
end $$;
