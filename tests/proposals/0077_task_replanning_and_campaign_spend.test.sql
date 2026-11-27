-- Assertions for docs/proposals/0077 (rolled back): re-planning proposals are created by members, decided only by
-- editors or higher, applied atomically (task + dependent shifts), refused when stale or already decided, and kept
-- as insert-only history; the campaign spend ledger refuses duplicates, negative balances, foreign campaigns and
-- direct writes, and is readable only inside the business.
do $$
declare
  uo uuid := gen_random_uuid(); ue uuid := gen_random_uuid(); um uuid := gen_random_uuid(); uv uuid := gen_random_uuid(); ux uuid := gen_random_uuid();
  o uuid; o2 uuid; w1 uuid; w2 uuid; wx uuid; ta uuid; tb uuid; tc uuid; tx_ uuid; c1 uuid; cx uuid; p1 uuid; p2 uuid; p3 uuid;
  s1 uuid; k1 uuid; r1 uuid := gen_random_uuid(); j jsonb; n int; d date; pr text;
  pass int := 0; fail int := 0; failures text := '';
  opts jsonb;
begin
  execute $t$CREATE FUNCTION pg_temp.su(_u uuid) RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; PERFORM set_config('request.jwt.claims', json_build_object('sub',_u,'role','authenticated')::text, true); SET LOCAL ROLE authenticated; END $b$ $t$;
  execute $t$CREATE FUNCTION pg_temp.root() RETURNS void LANGUAGE plpgsql AS $b$ BEGIN RESET ROLE; END $b$ $t$;
  insert into auth.users(id,email,aud,role,instance_id) values
    (uo,'rp-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ue,'rp-editor@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (um,'rp-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (uv,'rp-viewer@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ux,'rp-outsider@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  perform pg_temp.su(uo);
  o := public.create_organization('Replan fixture','Bakery'); select id into w1 from public.workspaces where org_id=o;
  perform pg_temp.root(); update public.subscriptions set plan_key='business' where org_id=o;
  perform pg_temp.su(uo); w2 := public.create_workspace(o,'Second');
  perform pg_temp.su(ux); o2 := public.create_organization('Other org','Shop'); select id into wx from public.workspaces where org_id=o2;
  perform pg_temp.root();
  insert into public.organization_members(org_id,user_id,role) values(o,ue,'editor'),(o,um,'member'),(o,uv,'viewer');
  insert into public.workspace_members(workspace_id,user_id,role) values(w1,ue,'editor'),(w1,um,'member'),(w1,uv,'viewer');
  perform pg_temp.su(uo);
  insert into public.tasks(org_id,workspace_id,title,due_date,priority,created_by) values(o,w1,'Price sheet',current_date-5,'medium',uo) returning id into ta;
  insert into public.tasks(org_id,workspace_id,title,due_date,created_by) values(o,w1,'Send offer',current_date-1,uo) returning id into tb;
  insert into public.tasks(org_id,workspace_id,title,due_date,created_by) values(o,w1,'Follow up',current_date+2,uo) returning id into tc;
  insert into public.campaigns(org_id,workspace_id,title,budget_eur,created_by) values(o,w1,'Autumn',500,uo) returning id into c1;
  perform pg_temp.su(ux);
  insert into public.tasks(org_id,workspace_id,title,created_by) values(o2,wx,'Theirs',ux) returning id into tx_;
  insert into public.campaigns(org_id,workspace_id,title,created_by) values(o2,wx,'Theirs',ux) returning id into cx;
  perform pg_temp.root();
  opts := jsonb_build_array(
    jsonb_build_object('key','a','kind','shift_chain','due_date',current_date+3,'shifts',jsonb_build_array(jsonb_build_object('task_id',tb,'due_date',current_date+4))),
    jsonb_build_object('key','b','kind','raise_priority','due_date',current_date+2,'priority','high'));

  -- 1. a member proposes; the same request returns the same proposal; a second open proposal is refused
  perform pg_temp.su(um);
  j := public.propose_task_replan(w1, r1, ta, jsonb_build_object('origin','rule','reasons',jsonb_build_array('overdue','dependency_late'),'options',opts,'risk','medium','impact',jsonb_build_object('affected',jsonb_build_array(tb))));
  p1 := (j->>'id')::uuid;
  j := public.propose_task_replan(w1, r1, ta, jsonb_build_object('reasons',jsonb_build_array('overdue'),'options',opts));
  if j->>'status' = 'existing' and (j->>'id')::uuid = p1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' idem:'||j::text; end if;
  begin perform public.propose_task_replan(w1, gen_random_uuid(), ta, jsonb_build_object('reasons',jsonb_build_array('overdue'),'options',opts)); fail:=fail+1; failures:=failures||' second_open_ok';
    exception when others then if sqlerrm='replan_already_open' then pass:=pass+1; else fail:=fail+1; failures:=failures||' second_open:'||sqlerrm; end if; end;
  perform pg_temp.root();
  if (select snapshot->>'priority' from public.task_replan_proposals where id=p1) = 'medium' then pass:=pass+1; else fail:=fail+1; failures:=failures||' snapshot'; end if;

  -- 2. validation
  perform pg_temp.su(um);
  begin perform public.propose_task_replan(w1, gen_random_uuid(), tc, jsonb_build_object('reasons',jsonb_build_array('feeling'),'options',opts)); fail:=fail+1; failures:=failures||' bad_reason_ok';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' bad_reason:'||sqlstate; end if; end;
  begin perform public.propose_task_replan(w1, gen_random_uuid(), tc, jsonb_build_object('reasons',jsonb_build_array('overdue'),'options',jsonb_build_array(jsonb_build_object('key','a','kind','new_deadline','due_date',current_date-1)))); fail:=fail+1; failures:=failures||' past_due_ok';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' past_due:'||sqlstate; end if; end;
  begin perform public.propose_task_replan(w1, gen_random_uuid(), tc, jsonb_build_object('reasons',jsonb_build_array('overdue'),'options',jsonb_build_array(jsonb_build_object('key','a','kind','shift_chain','due_date',current_date+3,'shifts',jsonb_build_array(jsonb_build_object('task_id',tx_,'due_date',current_date+4)))))); fail:=fail+1; failures:=failures||' foreign_shift_ok';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' foreign_shift:'||sqlstate; end if; end;
  begin perform public.propose_task_replan(w1, gen_random_uuid(), tx_, jsonb_build_object('reasons',jsonb_build_array('overdue'),'options',opts)); fail:=fail+1; failures:=failures||' foreign_task_ok';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' foreign_task:'||sqlstate; end if; end;
  begin perform public.propose_task_replan(w1, gen_random_uuid(), tc, jsonb_build_object('reasons',jsonb_build_array('overdue'),'options',jsonb_build_array(jsonb_build_object('key','a','kind','new_deadline','due_date','not-a-date')))); fail:=fail+1; failures:=failures||' bad_date_ok';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' bad_date:'||sqlstate; end if; end;

  -- 3. viewers and outsiders cannot propose; members cannot decide
  perform pg_temp.su(uv);
  begin perform public.propose_task_replan(w1, gen_random_uuid(), tc, jsonb_build_object('reasons',jsonb_build_array('overdue'),'options',opts)); fail:=fail+1; failures:=failures||' viewer_propose_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer_propose:'||sqlstate; end if; end;
  perform pg_temp.su(ux);
  begin perform public.propose_task_replan(w1, gen_random_uuid(), tc, jsonb_build_object('reasons',jsonb_build_array('overdue'),'options',opts)); fail:=fail+1; failures:=failures||' outsider_propose_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_propose:'||sqlstate; end if; end;
  begin perform public.decide_task_replan(p1, 'approved', 'a', null, ''); fail:=fail+1; failures:=failures||' outsider_decide_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_decide:'||sqlstate; end if; end;
  perform pg_temp.su(um);
  begin perform public.decide_task_replan(p1, 'approved', 'a', null, ''); fail:=fail+1; failures:=failures||' member_decide_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' member_decide:'||sqlstate; end if; end;

  -- 4. an editor postpones, then approves option a: task and its dependent move together, once
  perform pg_temp.su(ue);
  perform public.decide_task_replan(p1, 'postponed', null, null, 'wait for supplier');
  j := public.decide_task_replan(p1, 'approved', 'a', null, 'ok');
  perform pg_temp.root();
  select due_date into d from public.tasks where id=ta;
  if d = current_date+3 then pass:=pass+1; else fail:=fail+1; failures:=failures||' applied_due:'||coalesce(d::text,'null'); end if;
  select due_date into d from public.tasks where id=tb;
  if d = current_date+4 then pass:=pass+1; else fail:=fail+1; failures:=failures||' shifted:'||coalesce(d::text,'null'); end if;
  if (j->'applied'->'before'->>'due_date')::date = current_date-5 and jsonb_array_length(j->'applied'->'shifted') = 1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' applied_record:'||j::text; end if;
  perform pg_temp.su(ue);
  begin perform public.decide_task_replan(p1, 'rejected', null, null, ''); fail:=fail+1; failures:=failures||' redecide_ok';
    exception when others then if sqlerrm='replan_already_decided' then pass:=pass+1; else fail:=fail+1; failures:=failures||' redecide:'||sqlerrm; end if; end;

  -- 5. stale: the task changes after the proposal, approval is refused, rejection still works
  perform pg_temp.su(um);
  j := public.propose_task_replan(w1, gen_random_uuid(), tc, jsonb_build_object('reasons',jsonb_build_array('blocked'),'options',opts));
  p2 := (j->>'id')::uuid;
  -- touch_updated_at uses the transaction time, so simulate a later edit's timestamp explicitly
  perform pg_temp.root(); alter table public.tasks disable trigger tasks_touch;
  update public.tasks set title='Follow up (edited)', updated_at = updated_at + interval '1 second' where id=tc;
  alter table public.tasks enable trigger tasks_touch;
  perform pg_temp.su(ue);
  begin perform public.decide_task_replan(p2, 'approved', 'b', null, ''); fail:=fail+1; failures:=failures||' stale_ok';
    exception when others then if sqlerrm='replan_stale' then pass:=pass+1; else fail:=fail+1; failures:=failures||' stale:'||sqlerrm; end if; end;
  perform public.decide_task_replan(p2, 'rejected', null, null, 'outdated');
  perform pg_temp.root();
  select priority into pr from public.tasks where id=tc;
  if pr = 'medium' then pass:=pass+1; else fail:=fail+1; failures:=failures||' stale_untouched:'||pr; end if;

  -- 6. adjusted deadline ("aanpassen") and owner rights; past adjusted deadline refused
  perform pg_temp.su(um);
  j := public.propose_task_replan(w1, gen_random_uuid(), tc, jsonb_build_object('reasons',jsonb_build_array('no_owner'),'options',opts));
  p3 := (j->>'id')::uuid;
  perform pg_temp.su(uo);
  begin perform public.decide_task_replan(p3, 'approved', 'b', current_date-2, ''); fail:=fail+1; failures:=failures||' past_adjust_ok';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' past_adjust:'||sqlstate; end if; end;
  perform public.decide_task_replan(p3, 'approved', 'b', current_date+9, '');
  perform pg_temp.root();
  select due_date, priority into d, pr from public.tasks where id=tc;
  if d = current_date+9 and pr = 'high' then pass:=pass+1; else fail:=fail+1; failures:=failures||' adjusted:'||coalesce(d::text,'null')||pr; end if;

  -- 7. history is insert-only; reads stay inside the business; audit written
  begin update public.task_replan_proposals set risk='low' where id=p1; fail:=fail+1; failures:=failures||' prop_update_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' prop_update:'||sqlstate; end if; end;
  begin delete from public.task_replan_decisions where proposal_id=p1; fail:=fail+1; failures:=failures||' dec_delete_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' dec_delete:'||sqlstate; end if; end;
  perform pg_temp.su(um);
  begin insert into public.task_replan_decisions(org_id,workspace_id,proposal_id,decision) values(o,w1,p2,'rejected'); fail:=fail+1; failures:=failures||' direct_dec_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' direct_dec:'||sqlstate; end if; end;
  perform pg_temp.su(uv); select count(*) into n from public.task_replan_decisions where workspace_id=w1;
  if n = 4 then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer_read:'||n; end if;
  perform pg_temp.su(ux); select count(*) into n from public.task_replan_proposals;
  if n = 0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' outsider_read:'||n; end if;
  perform pg_temp.root();
  if (select count(*) from public.audit_logs where org_id=o and action like 'task.replan_%') = 7 then pass:=pass+1; else fail:=fail+1; failures:=failures||' audit:'||(select count(*) from public.audit_logs where org_id=o and action like 'task.replan_%'); end if;

  -- 8. campaign spend ledger
  perform pg_temp.su(um);
  r1 := gen_random_uuid();
  j := public.record_campaign_spend(w1, r1, c1, jsonb_build_object('kind','spend','amount',100,'currency','eur','occurred_on',current_date,'data_class','simulated','source_ref','INV-1'));
  s1 := (j->>'id')::uuid;
  j := public.record_campaign_spend(w1, r1, c1, jsonb_build_object('kind','spend','amount',100,'currency','EUR','occurred_on',current_date,'data_class','simulated','source_ref','INV-1'));
  if j->>'status' = 'existing' then pass:=pass+1; else fail:=fail+1; failures:=failures||' spend_idem'; end if;
  begin perform public.record_campaign_spend(w1, gen_random_uuid(), c1, jsonb_build_object('kind','spend','amount',100,'currency','EUR','occurred_on',current_date,'data_class','simulated','source_ref','INV-1')); fail:=fail+1; failures:=failures||' dup_ref_ok';
    exception when others then if sqlerrm='spend_duplicate_reference' then pass:=pass+1; else fail:=fail+1; failures:=failures||' dup_ref:'||sqlerrm; end if; end;
  j := public.record_campaign_spend(w1, gen_random_uuid(), c1, jsonb_build_object('kind','commitment','amount',50,'currency','EUR','occurred_on',current_date+10,'data_class','manual'));
  k1 := (j->>'id')::uuid;
  begin perform public.record_campaign_spend(w1, gen_random_uuid(), c1, jsonb_build_object('kind','release','amount',-60,'currency','EUR','occurred_on',current_date,'relates_to',k1)); fail:=fail+1; failures:=failures||' over_release_ok';
    exception when others then if sqlerrm='spend_below_zero' then pass:=pass+1; else fail:=fail+1; failures:=failures||' over_release:'||sqlerrm; end if; end;
  perform public.record_campaign_spend(w1, gen_random_uuid(), c1, jsonb_build_object('kind','release','amount',-50,'currency','EUR','occurred_on',current_date,'relates_to',k1));
  perform public.record_campaign_spend(w1, gen_random_uuid(), c1, jsonb_build_object('kind','correction','amount',-30,'currency','EUR','occurred_on',current_date,'relates_to',s1));
  begin perform public.record_campaign_spend(w1, gen_random_uuid(), c1, jsonb_build_object('kind','correction','amount',-80,'currency','EUR','occurred_on',current_date,'relates_to',s1)); fail:=fail+1; failures:=failures||' over_correct_ok';
    exception when others then if sqlerrm='spend_below_zero' then pass:=pass+1; else fail:=fail+1; failures:=failures||' over_correct:'||sqlerrm; end if; end;
  begin perform public.record_campaign_spend(w1, gen_random_uuid(), c1, jsonb_build_object('kind','correction','amount',-5,'currency','USD','occurred_on',current_date,'relates_to',s1)); fail:=fail+1; failures:=failures||' cur_mismatch_ok';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' cur_mismatch:'||sqlstate; end if; end;
  begin perform public.record_campaign_spend(w1, gen_random_uuid(), c1, jsonb_build_object('kind','spend','amount',10,'currency','EUR','occurred_on',current_date+1)); fail:=fail+1; failures:=failures||' future_ok';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' future:'||sqlstate; end if; end;
  begin perform public.record_campaign_spend(w1, gen_random_uuid(), c1, jsonb_build_object('kind','spend','amount',-10,'currency','EUR','occurred_on',current_date)); fail:=fail+1; failures:=failures||' negative_ok';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' negative:'||sqlstate; end if; end;
  begin perform public.record_campaign_spend(w1, gen_random_uuid(), cx, jsonb_build_object('kind','spend','amount',10,'currency','EUR','occurred_on',current_date)); fail:=fail+1; failures:=failures||' foreign_campaign_ok';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' foreign_campaign:'||sqlstate; end if; end;
  begin perform public.record_campaign_spend(w1, gen_random_uuid(), c1, jsonb_build_object('kind','spend','amount',10,'currency','EUR','occurred_on',current_date,'data_class','imported')); fail:=fail+1; failures:=failures||' imported_ok';
    exception when others then if sqlstate='22023' then pass:=pass+1; else fail:=fail+1; failures:=failures||' imported:'||sqlstate; end if; end;
  begin insert into public.campaign_spend_entries(org_id,workspace_id,campaign_id,kind,amount,currency,occurred_on,data_class,request_key) values(o,w1,c1,'spend',1,'EUR',current_date,'manual',gen_random_uuid()); fail:=fail+1; failures:=failures||' direct_spend_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' direct_spend:'||sqlstate; end if; end;
  perform pg_temp.su(uv);
  begin perform public.record_campaign_spend(w1, gen_random_uuid(), c1, jsonb_build_object('kind','spend','amount',10,'currency','EUR','occurred_on',current_date)); fail:=fail+1; failures:=failures||' viewer_spend_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' viewer_spend:'||sqlstate; end if; end;
  select count(*) into n from public.campaign_spend_entries where workspace_id=w1;
  if n = 4 then pass:=pass+1; else fail:=fail+1; failures:=failures||' spend_viewer_read:'||n; end if;
  perform pg_temp.su(um);
  begin perform public.record_campaign_spend(w2, gen_random_uuid(), c1, jsonb_build_object('kind','spend','amount',10,'currency','EUR','occurred_on',current_date)); fail:=fail+1; failures:=failures||' unassigned_spend_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' unassigned_spend:'||sqlstate; end if; end;
  perform pg_temp.su(ux); select count(*) into n from public.campaign_spend_entries;
  if n = 0 then pass:=pass+1; else fail:=fail+1; failures:=failures||' spend_outsider_read:'||n; end if;
  perform pg_temp.root();
  begin update public.campaign_spend_entries set amount=1 where id=s1; fail:=fail+1; failures:=failures||' spend_update_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' spend_update:'||sqlstate; end if; end;
  if (select coalesce(sum(amount),0) from public.campaign_spend_entries where campaign_id=c1 and kind in ('spend','correction')) = 70 then pass:=pass+1; else fail:=fail+1; failures:=failures||' net_spend'; end if;
  SET LOCAL ROLE anon;
  begin perform public.record_campaign_spend(w1, gen_random_uuid(), c1, '{}'); fail:=fail+1; failures:=failures||' anon_ok';
    exception when others then if sqlstate='42501' then pass:=pass+1; else fail:=fail+1; failures:=failures||' anon:'||sqlstate; end if; end;
  perform pg_temp.root();
  raise exception 'REPLAN_SPEND_RESULT pass=% fail=% failures=[%]', pass, fail, failures;
end $$;
