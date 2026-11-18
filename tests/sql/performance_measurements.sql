-- Performance measurements: roles, isolation, idempotency, corrections, permanence and unit rules.
-- Always raises, so it rolls back. Output: 'PERFORMANCE_RESULT pass=N fail=M ...'.
do $$
declare
  ua uuid := gen_random_uuid(); um uuid := gen_random_uuid(); uv uuid := gen_random_uuid(); ub uuid := gen_random_uuid();
  oa uuid; ob uuid; wa uuid; wb uuid; ga uuid; gb uuid; mrev uuid; mleads uuid; mp uuid; m1 uuid; m2 uuid; k1 uuid := gen_random_uuid(); k2 uuid := gen_random_uuid();
  r jsonb; n int; v numeric; pass int := 0; fail int := 0; failures text := '';
begin
  insert into auth.users(id,email,aud,role,instance_id) values
    (ua,'pm-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (um,'pm-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (uv,'pm-viewer@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ub,'pm-outsider@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  perform set_config('request.jwt.claims', json_build_object('sub',ua,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  oa := public.create_organization('PM A','WS A'); select id into wa from public.workspaces where org_id=oa;
  insert into public.growth_goals(org_id,workspace_id,title) values(oa,wa,'Revenue') returning id into ga;
  execute 'reset role';
  insert into public.organization_members(org_id,user_id,role) values(oa,um,'member'),(oa,uv,'viewer');
  insert into public.workspace_members(workspace_id,user_id,role) values(wa,um,'member'),(wa,uv,'viewer');
  perform set_config('request.jwt.claims', json_build_object('sub',ub,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  ob := public.create_organization('PM B','WS B'); select id into wb from public.workspaces where org_id=ob;
  insert into public.growth_goals(org_id,workspace_id,title) values(ob,wb,'B goal') returning id into gb;
  execute 'reset role';

  -- Member defines metrics; re-definition is idempotent; unit/currency conflicts are refused.
  perform set_config('request.jwt.claims', json_build_object('sub',um,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  r := public.define_metric(wa,'monthly_revenue','Monthly revenue','currency','eur','increase',ga,null); mrev := (r->>'metric_id')::uuid;
  if r->>'status'='created' and (select currency from public.metric_definitions where id=mrev)='EUR' then pass:=pass+1; else fail:=fail+1; failures:=failures||' define_currency'; end if;
  r := public.define_metric(wa,'monthly_revenue','Monthly revenue','currency','EUR','increase',ga,null);
  if (r->>'metric_id')::uuid=mrev and r->>'status'='existing' then pass:=pass+1; else fail:=fail+1; failures:=failures||' define_idempotent'; end if;
  begin perform public.define_metric(wa,'monthly_revenue','Monthly revenue','currency','USD','increase',ga,null); fail:=fail+1; failures:=failures||' define_currency_conflict'; exception when others then pass:=pass+1; end;
  begin perform public.define_metric(wa,'Bad Key','x','count',null,'increase',null,null); fail:=fail+1; failures:=failures||' define_bad_key'; exception when others then pass:=pass+1; end;
  begin perform public.define_metric(wa,'cross_goal','x','count',null,'increase',gb,null); fail:=fail+1; failures:=failures||' define_cross_goal'; exception when others then pass:=pass+1; end;
  r := public.define_metric(wa,'qualified_leads','Qualified leads','count','EUR','increase',ga,null); mleads := (r->>'metric_id')::uuid;
  if (select currency from public.metric_definitions where id=mleads) is null then pass:=pass+1; else fail:=fail+1; failures:=failures||' count_has_no_currency'; end if;
  r := public.define_metric(wa,'conversion_rate','Conversion rate','percent',null,'increase',null,null); mp := (r->>'metric_id')::uuid;

  -- Record values: idempotent per request key; one effective value per metric/kind/period.
  r := public.record_measurement(mrev,'manual_actual','2026-10-01','2026-10-31',12000,'October close','',k1,null); m1 := (r->>'measurement_id')::uuid;
  if r->>'status'='created' then pass:=pass+1; else fail:=fail+1; failures:=failures||' record'; end if;
  r := public.record_measurement(mrev,'manual_actual','2026-10-01','2026-10-31',12000,'October close','',k1,null);
  if (r->>'measurement_id')::uuid=m1 and r->>'status'='existing' then pass:=pass+1; else fail:=fail+1; failures:=failures||' record_idempotent'; end if;
  begin perform public.record_measurement(mrev,'manual_actual','2026-10-01','2026-10-31',99999,'','',k1,null); fail:=fail+1; failures:=failures||' key_reuse'; exception when others then pass:=pass+1; end;
  begin perform public.record_measurement(mrev,'manual_actual','2026-10-01','2026-10-31',13000,'','',gen_random_uuid(),null); fail:=fail+1; failures:=failures||' double_count'; exception when others then pass:=pass+1; end;
  perform public.record_measurement(mrev,'planned','2026-10-01','2026-10-31',15000,'','',gen_random_uuid(),null); pass:=pass+1;
  -- Correction replaces exactly one row; the original stays as history.
  r := public.record_measurement(mrev,'manual_actual','2026-10-01','2026-10-31',12500,'Late invoice','',k2,m1); m2 := (r->>'measurement_id')::uuid;
  if m2 is not null then pass:=pass+1; else fail:=fail+1; failures:=failures||' correction'; end if;
  begin perform public.record_measurement(mrev,'manual_actual','2026-10-01','2026-10-31',12600,'','',gen_random_uuid(),m1); fail:=fail+1; failures:=failures||' double_correction'; exception when others then pass:=pass+1; end;
  begin perform public.record_measurement(mrev,'manual_actual','2026-11-01','2026-11-30',1,'','',gen_random_uuid(),m2); fail:=fail+1; failures:=failures||' correction_other_period'; exception when others then pass:=pass+1; end;
  select count(*) into n from public.performance_measurements where metric_id=mrev and kind='manual_actual'; if n=2 then pass:=pass+1; else fail:=fail+1; failures:=failures||' history_kept'; end if;
  select p.value into v from public.performance_measurements p where p.metric_id=mrev and p.kind='manual_actual' and not exists(select 1 from public.performance_measurements c where c.corrects_id=p.id);
  if v=12500 then pass:=pass+1; else fail:=fail+1; failures:=failures||' effective_value'; end if;
  -- Kinds and units.
  begin perform public.record_measurement(mrev,'verified_actual','2026-09-01','2026-09-30',1,'','',gen_random_uuid(),null); fail:=fail+1; failures:=failures||' user_verified'; exception when others then pass:=pass+1; end;
  begin perform public.record_measurement(mrev,'imported_actual','2026-09-01','2026-09-30',1,'','',gen_random_uuid(),null); fail:=fail+1; failures:=failures||' user_imported'; exception when others then pass:=pass+1; end;
  begin perform public.record_measurement(mleads,'manual_actual','2026-10-01','2026-10-31',-3,'','',gen_random_uuid(),null); fail:=fail+1; failures:=failures||' negative_count'; exception when others then pass:=pass+1; end;
  perform public.record_measurement(mp,'manual_actual','2026-10-01','2026-10-31',-12.5,'','',gen_random_uuid(),null); pass:=pass+1;
  begin perform public.record_measurement(mleads,'manual_actual','2026-10-31','2026-10-01',3,'','',gen_random_uuid(),null); fail:=fail+1; failures:=failures||' reversed_period'; exception when others then pass:=pass+1; end;
  begin perform public.record_measurement(mleads,'manual_actual','2025-01-01','2026-06-30',3,'','',gen_random_uuid(),null); fail:=fail+1; failures:=failures||' period_too_long'; exception when others then pass:=pass+1; end;
  -- Permanence and fixed identity.
  begin update public.performance_measurements set value=1 where id=m1; get diagnostics n=row_count; if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' direct_update'; end if; exception when others then pass:=pass+1; end;
  begin insert into public.performance_measurements(org_id,workspace_id,metric_id,period_start,period_end,kind,value,source,request_key) values(oa,wa,mrev,'2026-08-01','2026-08-31','verified_actual',1,'forged',gen_random_uuid()); fail:=fail+1; failures:=failures||' direct_insert'; exception when others then pass:=pass+1; end;
  begin perform public.update_metric_definition(mrev,'{"unit":"count"}'); fail:=fail+1; failures:=failures||' change_unit'; exception when others then pass:=pass+1; end;
  r := public.update_metric_definition(mleads,'{"label":"SQLs","archived":true}');
  if (r->>'archived')::boolean then pass:=pass+1; else fail:=fail+1; failures:=failures||' archive'; end if;
  begin perform public.record_measurement(mleads,'manual_actual','2026-11-01','2026-11-30',3,'','',gen_random_uuid(),null); fail:=fail+1; failures:=failures||' archived_accepts'; exception when others then pass:=pass+1; end;
  execute 'reset role';
  begin update public.performance_measurements set value=1 where id=m1; fail:=fail+1; failures:=failures||' owner_db_update'; exception when others then pass:=pass+1; end;
  begin delete from public.metric_definitions where id=mrev; fail:=fail+1; failures:=failures||' metric_delete'; exception when others then pass:=pass+1; end;

  -- Viewer reads, cannot write.
  perform set_config('request.jwt.claims', json_build_object('sub',uv,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.performance_measurements where workspace_id=wa; if n>=4 then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer_reads'; end if;
  begin perform public.define_metric(wa,'viewer_metric','x','count',null,'increase',null,null); fail:=fail+1; failures:=failures||' viewer_defines'; exception when others then pass:=pass+1; end;
  begin perform public.record_measurement(mrev,'manual_actual','2026-12-01','2026-12-31',1,'','',gen_random_uuid(),null); fail:=fail+1; failures:=failures||' viewer_records'; exception when others then pass:=pass+1; end;
  execute 'reset role';

  -- Outsider sees and changes nothing.
  perform set_config('request.jwt.claims', json_build_object('sub',ub,'role','authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.metric_definitions where workspace_id=wa; if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_reads_metrics'; end if;
  select count(*) into n from public.performance_measurements where workspace_id=wa; if n=0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_reads_values'; end if;
  begin perform public.define_metric(wa,'evil','x','count',null,'increase',null,null); fail:=fail+1; failures:=failures||' outsider_defines'; exception when others then pass:=pass+1; end;
  begin perform public.record_measurement(mrev,'manual_actual','2026-12-01','2026-12-31',1,'','',gen_random_uuid(),null); fail:=fail+1; failures:=failures||' outsider_records'; exception when others then pass:=pass+1; end;
  begin perform public.update_metric_definition(mrev,'{"archived":true}'); fail:=fail+1; failures:=failures||' outsider_archives'; exception when others then pass:=pass+1; end;
  -- The same request key in another workspace is independent.
  r := public.define_metric(wb,'monthly_revenue','Revenue','currency','USD','increase',gb,null);
  perform public.record_measurement((r->>'metric_id')::uuid,'manual_actual','2026-10-01','2026-10-31',5,'','',k1,null); pass:=pass+1;
  execute 'reset role';

  if not has_function_privilege('anon','public.record_measurement(uuid,text,date,date,numeric,text,text,uuid,uuid)','execute')
     and not has_function_privilege('anon','public.define_metric(uuid,text,text,text,text,text,uuid,uuid)','execute')
     and not has_table_privilege('anon','public.performance_measurements','select')
     and not has_table_privilege('authenticated','public.performance_measurements','insert,update,delete,truncate')
  then pass:=pass+1; else fail:=fail+1; failures:=failures||' privileges'; end if;
  raise exception 'PERFORMANCE_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
