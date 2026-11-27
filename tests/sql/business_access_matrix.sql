-- Business access matrix (self-rolling-back). Belonging to the same organization never opens another business:
-- for every table with a workspace_id, users assigned only to business 1 (admin, editor, member, viewer) see no row
-- of business 2, and role boundaries hold for writes (viewer read-only, budgets need an editor, specialist limits and
-- integrations need a business admin, records cannot be moved to another business).
do $$
declare
  uo uuid := gen_random_uuid(); ua uuid := gen_random_uuid(); ue uuid := gen_random_uuid(); um uuid := gen_random_uuid(); uv uuid := gen_random_uuid();
  o uuid; w1 uuid; w2 uuid; g1 uuid; tbl text; n int; seeded int := 0; leaks text := ''; who uuid; lbl text;
  pass int := 0; fail int := 0; failures text := '';
begin
  execute $t$CREATE FUNCTION pg_temp.su(_u uuid) RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; PERFORM set_config('request.jwt.claims', json_build_object('sub',_u,'role','authenticated')::text, true); SET LOCAL ROLE authenticated; END $b$ $t$;
  execute $t$CREATE FUNCTION pg_temp.root() RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; END $b$ $t$;
  insert into auth.users(id,email,aud,role,instance_id) values
    (uo,'am-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ua,'am-admin@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ue,'am-editor@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (um,'am-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (uv,'am-viewer@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  perform pg_temp.su(uo);
  o := public.create_organization('Access matrix fixture','Bakery'); select id into w1 from public.workspaces where org_id=o;
  perform pg_temp.root(); update public.subscriptions set plan_key='business' where org_id=o;
  perform pg_temp.su(uo); w2 := public.create_workspace(o,'Catering');
  perform pg_temp.root();
  insert into public.organization_members(org_id,user_id,role) values(o,ua,'admin'),(o,ue,'editor'),(o,um,'member'),(o,uv,'viewer');
  insert into public.workspace_members(workspace_id,user_id,role) values(w1,ua,'admin'),(w1,ue,'editor'),(w1,um,'member'),(w1,uv,'viewer');

  -- business 2 gets records in the main modules, created by the owner through normal access
  perform pg_temp.su(uo);
  insert into public.growth_goals(org_id,workspace_id,title) values(o,w2,'Catering goal');
  insert into public.campaigns(org_id,workspace_id,title) values(o,w2,'Catering campaign');
  insert into public.projects(org_id,workspace_id,title) values(o,w2,'Catering project');
  insert into public.tasks(org_id,workspace_id,title) values(o,w2,'Catering task');
  insert into public.budget_lines(org_id,workspace_id,channel,period_month,planned,currency) values(o,w2,'Google Ads',date_trunc('month',now())::date,100,'EUR');
  perform public.create_business_unit(w2,'brand','Catering Express',null);
  insert into public.crm_contacts(org_id,workspace_id,name) values(o,w2,'Catering client');
  insert into public.growth_goals(org_id,workspace_id,title) values(o,w1,'Bakery goal') returning id into g1;

  perform pg_temp.root();
  for tbl in select distinct c.table_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
             where c.table_schema='public' and c.column_name='workspace_id' and t.table_type='BASE TABLE' order by 1 loop
    execute format('select count(*) from public.%I where workspace_id = $1', tbl) into n using w2;
    if n > 0 then seeded := seeded + 1; end if;
  end loop;
  if seeded >= 7 then pass:=pass+1; else fail:=fail+1; failures:=failures||' seed:'||seeded; end if;

  -- read isolation for every role assigned only to business 1
  foreach who in array array[ua,ue,um,uv] loop
    lbl := case who when ua then 'admin' when ue then 'editor' when um then 'member' else 'viewer' end; leaks := '';
    perform pg_temp.su(who);
    for tbl in select distinct c.table_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name)
               where c.table_schema='public' and c.column_name='workspace_id' and t.table_type='BASE TABLE' order by 1 loop
      begin
        execute format('select count(*) from public.%I where workspace_id = $1', tbl) into n using w2;
        if n > 0 then leaks := leaks || tbl || ','; end if;
      exception when insufficient_privilege then null; -- no read grant at all is also isolation
      end;
    end loop;
    if leaks = '' then pass:=pass+1; else fail:=fail+1; failures:=failures||' '||lbl||'_sees_b2:'||leaks; end if;
    if (select count(*) from public.growth_goals where workspace_id = w1) = 1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' '||lbl||'_own_business'; end if;
  end loop;

  -- writes into another business
  perform pg_temp.su(ua);
  begin insert into public.growth_goals(org_id,workspace_id,title) values(o,w2,'x'); fail:=fail+1; failures:=failures||' admin_writes_b2'; exception when others then if sqlstate in ('P0001','42501') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate; end if; end;
  begin perform public.create_business_unit(w2,'brand','x',null); fail:=fail+1; failures:=failures||' admin_unit_b2'; exception when others then if sqlstate in ('P0001','42501') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate; end if; end;
  begin perform public.set_specialist_allocation(w2,'seo',false,3,null); fail:=fail+1; failures:=failures||' admin_alloc_b2'; exception when others then if sqlstate in ('P0001','42501') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate; end if; end;
  perform public.set_specialist_allocation(w1,'seo',true,2,50); pass:=pass+1;
  -- moving a record to another business
  perform pg_temp.su(ue);
  begin update public.growth_goals set workspace_id=w2 where id=g1; get diagnostics n = row_count; if n = 0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' move_goal'; end if; exception when others then if sqlstate in ('P0001','42501','23503','23514') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate; end if; end;
  -- editor: budgets yes, specialist limits no
  insert into public.budget_lines(org_id,workspace_id,channel,period_month,planned,currency) values(o,w1,'Meta Ads',date_trunc('month',now())::date,50,'EUR'); pass:=pass+1;
  begin perform public.set_specialist_allocation(w1,'seo',false,3,null); fail:=fail+1; failures:=failures||' editor_alloc'; exception when others then if sqlstate in ('P0001','42501') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate; end if; end;
  -- member: no budgets, no integrations
  perform pg_temp.su(um);
  begin insert into public.budget_lines(org_id,workspace_id,channel,period_month,planned,currency) values(o,w1,'x',date_trunc('month',now())::date,1,'EUR'); fail:=fail+1; failures:=failures||' member_budget'; exception when others then if sqlstate in ('P0001','42501') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate; end if; end;
  begin insert into public.connector_connections(org_id,workspace_id,connector_key,status) values(o,w1,'google_analytics','connected'); fail:=fail+1; failures:=failures||' member_connects'; exception when others then if sqlstate in ('P0001','42501','23514') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate; end if; end;
  -- viewer: read-only
  perform pg_temp.su(uv);
  begin insert into public.growth_goals(org_id,workspace_id,title) values(o,w1,'x'); fail:=fail+1; failures:=failures||' viewer_writes'; exception when others then if sqlstate in ('P0001','42501') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate; end if; end;
  begin update public.growth_goals set title='changed' where id=g1; get diagnostics n = row_count; if n = 0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer_updates'; end if; exception when others then if sqlstate in ('P0001','42501') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate; end if; end;
  -- organization intelligence: nothing about business 2 reaches someone who cannot open it
  if not exists (select 1 from public.org_initiative_commitments where workspace_id = w2) then pass:=pass+1; else fail:=fail+1; failures:=failures||' commitments'; end if;
  perform pg_temp.root();
  raise exception 'ACCESS_MATRIX_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
