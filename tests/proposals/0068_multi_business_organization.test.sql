-- Assertions for docs/proposals/0067 + 0068 (rolled back). Editor rights, reporting currency, brand/unit links,
-- exchange rates, per-business specialist allocation in the task-run gate, priority, and cross-business isolation.
do $$
declare
  uo uuid := gen_random_uuid(); ua uuid := gen_random_uuid(); ue uuid := gen_random_uuid(); um uuid := gen_random_uuid(); uv uuid := gen_random_uuid(); ux uuid := gen_random_uuid();
  o uuid; w1 uuid; w2 uuid; o2 uuid; un uuid; un2 uuid; g uuid; tk uuid; tk2 uuid; f1 uuid; rid uuid; r jsonb; st text; n int; s1 int; s2 int; cur text;
  pass int := 0; fail int := 0; failures text := '';
begin
  insert into auth.users(id,email,aud,role,instance_id) values
    (uo,'mb-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ua,'mb-admin@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ue,'mb-editor@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (um,'mb-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (uv,'mb-viewer@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ux,'mb-outsider@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  -- role order
  if public.role_rank('owner')=5 and public.role_rank('admin')=4 and public.role_rank('editor')=3 and public.role_rank('member')=2 and public.role_rank('viewer')=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' role_rank'; end if;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub',uo,'role','authenticated')::text, true); execute 'set local role authenticated';
  o := public.create_organization('Multi fixture','Bakery'); select id into w1 from public.workspaces where org_id = o;
  execute 'reset role';
  update public.subscriptions set plan_key='business' where org_id=o;
  perform set_config('request.jwt.claims', json_build_object('sub',uo,'role','authenticated')::text, true); execute 'set local role authenticated';
  w2 := public.create_workspace(o,'Catering');
  if w2 is not null and w2<>w1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' second_business'; end if;
  r := jsonb_build_object('ok',1);
  perform public.create_invitation(o,'mb-new-editor@test.local','editor');
  select role::text into st from public.invitations where org_id=o and email='mb-new-editor@test.local';
  if st='editor' then pass:=pass+1; else fail:=fail+1; failures:=failures||' invite_editor:'||coalesce(st,'?'); end if;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub',ux,'role','authenticated')::text, true); execute 'set local role authenticated';
  o2 := public.create_organization('Other org','X');
  execute 'reset role';
  insert into public.organization_members(org_id,user_id,role) values(o,ua,'admin'),(o,ue,'editor'),(o,um,'member'),(o,uv,'viewer');
  insert into public.workspace_members(workspace_id,user_id,role) values(w1,ua,'admin'),(w1,ue,'editor'),(w1,um,'member'),(w1,uv,'viewer'),(w2,ue,'viewer');
  -- editor rights: profile confirmation
  perform set_config('request.jwt.claims', json_build_object('sub',um,'role','authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.confirm_business_profile(w1,'{"description":"x"}','[{"key":"business_model","value":"B2B catering","source_type":"user","verified":true}]'); fail:=fail+1; failures:=failures||' member_confirm'; exception when others then pass:=pass+1; end;
  -- members may suggest (unverified) but not verify
  insert into public.business_facts(org_id,workspace_id,key,value,source_type,verified) values(o,w1,'pricing','Fixed menu price','user',false) returning id into f1;
  if f1 is not null then pass:=pass+1; else fail:=fail+1; failures:=failures||' member_suggest'; end if;
  begin insert into public.business_facts(org_id,workspace_id,key,value,source_type,verified) values(o,w1,'segments','Offices','user',true); fail:=fail+1; failures:=failures||' member_verified_insert'; exception when others then pass:=pass+1; end;
  begin update public.business_facts set verified=true where id=f1; get diagnostics n = row_count; if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' member_verify'; end if; exception when others then pass:=pass+1; end;
  begin insert into public.budget_lines(org_id,workspace_id,channel,period_month,planned,currency,created_by) values(o,w1,'search',date_trunc('month',now())::date,100,'EUR',um); fail:=fail+1; failures:=failures||' member_budget'; exception when others then pass:=pass+1; end;
  begin perform public.set_business_currency(w1,'USD'); fail:=fail+1; failures:=failures||' member_currency'; exception when others then if sqlerrm ilike '%editors and administrators%' then pass:=pass+1; else fail:=fail+1; failures:=failures||' member_currency_msg '||sqlerrm; end if; end;
  -- editor can
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub',ue,'role','authenticated')::text, true); execute 'set local role authenticated';
  perform public.confirm_business_profile(w1,'{"description":"Catering bakery"}','[{"key":"business_model","value":"B2B catering","source_type":"user","verified":true}]');
  select count(*) into n from public.business_facts where workspace_id=w1 and key='business_model' and verified;
  if n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' editor_confirm:'||n; end if;
  update public.business_facts set verified=true where id=f1; get diagnostics n = row_count;
  if n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' editor_verify'; end if;
  insert into public.budget_lines(org_id,workspace_id,channel,period_month,planned,currency,created_by) values(o,w1,'search',date_trunc('month',now())::date,100,'EUR',ue);
  pass:=pass+1;
  cur := public.set_business_currency(w1,'usd');
  if cur='USD' then pass:=pass+1; else fail:=fail+1; failures:=failures||' editor_currency'; end if;
  begin perform public.set_business_currency(w1,'dollars'); fail:=fail+1; failures:=failures||' bad_currency'; exception when others then pass:=pass+1; end;
  -- editor is only a viewer in business 2
  begin perform public.set_business_currency(w2,'EUR'); fail:=fail+1; failures:=failures||' editor_other_business'; exception when others then pass:=pass+1; end;
  begin insert into public.budget_lines(org_id,workspace_id,channel,period_month,planned,currency,created_by) values(o,w2,'search',date_trunc('month',now())::date,100,'EUR',ue); fail:=fail+1; failures:=failures||' editor_budget_other'; exception when others then pass:=pass+1; end;
  -- viewer cannot even suggest
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub',uv,'role','authenticated')::text, true); execute 'set local role authenticated';
  begin insert into public.business_facts(org_id,workspace_id,key,value,source_type,verified) values(o,w1,'x','y','user',false); fail:=fail+1; failures:=failures||' viewer_fact'; exception when others then pass:=pass+1; end;
  -- brand/unit links stay inside one business
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub',uo,'role','authenticated')::text, true); execute 'set local role authenticated';
  r := public.create_business_unit(w1,'brand','North',null); un := (r->>'unit_id')::uuid;
  r := public.create_business_unit(w2,'brand','South',null); un2 := (r->>'unit_id')::uuid;
  insert into public.growth_goals(org_id,workspace_id,title,metric,created_by,unit_id) values(o,w1,'North revenue','revenue',uo,un) returning id into g;
  if g is not null then pass:=pass+1; else fail:=fail+1; failures:=failures||' goal_unit'; end if;
  begin insert into public.growth_goals(org_id,workspace_id,title,metric,created_by,unit_id) values(o,w2,'Cross','revenue',uo,un); fail:=fail+1; failures:=failures||' goal_cross_unit'; exception when others then if sqlerrm ilike '%foreign key%' then pass:=pass+1; else fail:=fail+1; failures:=failures||' goal_cross_unit_msg '||sqlerrm; end if; end;
  begin insert into public.campaigns(org_id,workspace_id,title,created_by,unit_id) values(o,w1,'Cross campaign',uo,un2); fail:=fail+1; failures:=failures||' campaign_cross_unit'; exception when others then pass:=pass+1; end;
  begin update public.growth_goals set unit_id=un2 where id=g; fail:=fail+1; failures:=failures||' goal_move_unit'; exception when others then pass:=pass+1; end;
  -- exchange rates: org admins only, dated, permanent, invisible to other organizations
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub',ue,'role','authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.record_exchange_rate(o,'USD','EUR',0.92,current_date,'ECB'); fail:=fail+1; failures:=failures||' editor_rate'; exception when others then pass:=pass+1; end;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub',ua,'role','authenticated')::text, true); execute 'set local role authenticated';
  rid := public.record_exchange_rate(o,'usd','eur',0.92,current_date - 1,'ECB reference rate');
  if rid is not null then pass:=pass+1; else fail:=fail+1; failures:=failures||' admin_rate'; end if;
  begin perform public.record_exchange_rate(o,'USD','EUR',0.92,current_date + 1,'ECB'); fail:=fail+1; failures:=failures||' future_rate'; exception when others then pass:=pass+1; end;
  begin perform public.record_exchange_rate(o,'EUR','EUR',1,current_date,'x'); fail:=fail+1; failures:=failures||' same_currency_rate'; exception when others then pass:=pass+1; end;
  begin perform public.record_exchange_rate(o,'USD','EUR',-1,current_date,'x'); fail:=fail+1; failures:=failures||' negative_rate'; exception when others then pass:=pass+1; end;
  execute 'reset role';
  begin update public.exchange_rates set rate=1 where id=rid; fail:=fail+1; failures:=failures||' rate_permanent'; exception when others then pass:=pass+1; end;
  perform set_config('request.jwt.claims', json_build_object('sub',ux,'role','authenticated')::text, true); execute 'set local role authenticated';
  select count(*) into n from public.exchange_rates where org_id=o;
  if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_rates'; end if;
  begin perform public.record_exchange_rate(o,'GBP','EUR',1.1,current_date,'x'); fail:=fail+1; failures:=failures||' outsider_rate'; exception when others then pass:=pass+1; end;
  -- specialist allocation per business
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub',um,'role','authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.set_specialist_allocation(w1,'seo',false,3,null); fail:=fail+1; failures:=failures||' member_allocation'; exception when others then if sqlerrm ilike '%business administrators%' then pass:=pass+1; else fail:=fail+1; failures:=failures||' member_allocation_msg '||sqlerrm; end if; end;
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub',ua,'role','authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.set_specialist_allocation(w1,'astrologer',true,3,null); fail:=fail+1; failures:=failures||' unknown_specialist'; exception when others then pass:=pass+1; end;
  begin perform public.set_specialist_allocation(w2,'seo',false,3,null); fail:=fail+1; failures:=failures||' admin_other_business'; exception when others then pass:=pass+1; end;
  insert into public.tasks(org_id,workspace_id,title,created_by) values(o,w1,'SEO check North',ua) returning id into tk;
  perform public.assign_task_specialist(tk,'seo','analysis',false);
  execute 'reset role';
  s1 := public.task_priority_score(tk);
  if public.task_run_gate(tk,5,false) is null then pass:=pass+1; else fail:=fail+1; failures:=failures||' gate_before:'||coalesce(public.task_run_gate(tk,5,false),'?'); end if;
  perform set_config('request.jwt.claims', json_build_object('sub',ua,'role','authenticated')::text, true); execute 'set local role authenticated';
  r := public.set_specialist_allocation(w1,'seo',false,3,null);
  execute 'reset role';
  if public.task_run_gate(tk,5,false)='specialist_disabled' then pass:=pass+1; else fail:=fail+1; failures:=failures||' gate_disabled:'||coalesce(public.task_run_gate(tk,5,false),'null'); end if;
  if public.task_run_gate_message('specialist_disabled') ilike '%switched off for this business%' then pass:=pass+1; else fail:=fail+1; failures:=failures||' gate_message'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub',ua,'role','authenticated')::text, true); execute 'set local role authenticated';
  r := public.set_specialist_allocation(w1,'seo',true,5,4);
  execute 'reset role';
  if public.task_run_gate(tk,5,false)='specialist_cap' then pass:=pass+1; else fail:=fail+1; failures:=failures||' gate_cap:'||coalesce(public.task_run_gate(tk,5,false),'null'); end if;
  if public.task_run_gate(tk,3,false) is null then pass:=pass+1; else fail:=fail+1; failures:=failures||' gate_under_cap:'||coalesce(public.task_run_gate(tk,3,false),'?'); end if;
  s2 := public.task_priority_score(tk);
  if s2 = s1 + 10 then pass:=pass+1; else fail:=fail+1; failures:=failures||' priority:'||s1||'->'||s2; end if;
  -- the same specialist in business 2 is unaffected
  perform set_config('request.jwt.claims', json_build_object('sub',uo,'role','authenticated')::text, true); execute 'set local role authenticated';
  insert into public.tasks(org_id,workspace_id,title,created_by) values(o,w2,'SEO check South',uo) returning id into tk2;
  perform public.assign_task_specialist(tk2,'seo','analysis',false);
  execute 'reset role';
  if public.task_run_gate(tk2,5,false) is null then pass:=pass+1; else fail:=fail+1; failures:=failures||' gate_other_business:'||coalesce(public.task_run_gate(tk2,5,false),'?'); end if;
  -- cross-business isolation for a member of business 1 only
  perform set_config('request.jwt.claims', json_build_object('sub',um,'role','authenticated')::text, true); execute 'set local role authenticated';
  select count(*) into n from public.workspaces where org_id=o; if n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' member_sees_businesses:'||n; end if;
  select count(*) into n from public.business_units where workspace_id=w2; if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' member_units_w2'; end if;
  select count(*) into n from public.tasks where workspace_id=w2; if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' member_tasks_w2'; end if;
  select count(*) into n from public.specialist_allocations where workspace_id=w1; if n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' member_reads_own_allocation'; end if;
  select count(*) into n from public.business_profiles where workspace_id=w2; if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' member_profile_w2'; end if;
  -- the organization owner sees both businesses
  execute 'reset role'; perform set_config('request.jwt.claims', json_build_object('sub',uo,'role','authenticated')::text, true); execute 'set local role authenticated';
  select count(*) into n from public.workspaces where org_id=o; if n=2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' owner_businesses:'||n; end if;
  execute 'reset role';
  raise exception 'MULTI_BUSINESS_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
