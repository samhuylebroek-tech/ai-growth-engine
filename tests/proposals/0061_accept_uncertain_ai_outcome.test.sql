-- Assertions for docs/proposals/0061 (rolled back). An uncertain AI outcome blocks new AI work until
-- the requester or an org admin accepts the reserved credits as used; never refunds, never replays.
do $$
declare
  uo uuid := gen_random_uuid(); um uuid := gen_random_uuid(); uv uuid := gen_random_uuid(); ux uuid := gen_random_uuid();
  o uuid; w uuid; a jsonb; rid uuid; rid2 uuid; k uuid; n int; bal_before int; bal_after int; ch int;
  P constant text := 'rollback-fixture-only'; inp jsonb := '{"request":"Fixture uncertain call","executionContext":[]}';
  pass int := 0; fail int := 0; failures text := '';
begin
  execute $t$CREATE OR REPLACE FUNCTION public.verify_ai_accounting(_proof text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $b$ BEGIN IF _proof IS DISTINCT FROM 'rollback-fixture-only' THEN RAISE EXCEPTION 'server accounting verification required'; END IF; END $b$ $t$;
  insert into auth.users(id,email,aud,role,instance_id) values
    (uo,'un-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (um,'un-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (uv,'un-viewer@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (ux,'un-outsider@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  perform set_config('request.jwt.claims', json_build_object('sub',uo,'role','authenticated')::text, true); execute 'set local role authenticated';
  o := public.create_organization('Uncertain outcome fixture','U'); select id into w from public.workspaces where org_id = o;
  execute 'reset role';
  insert into public.organization_members(org_id,user_id,role) values(o,um,'member'),(o,uv,'viewer');
  insert into public.workspace_members(workspace_id,user_id,role) values(w,um,'member'),(w,uv,'viewer');

  -- member's call ends with an unknown provider outcome
  perform set_config('request.jwt.claims', json_build_object('sub',um,'role','authenticated')::text, true); execute 'set local role authenticated';
  a := public.begin_single_ai_request_verified(o,w,gen_random_uuid(),'strategy',inp,P); rid := (a->>'run_id')::uuid;
  perform public.reserve_ai_credits(rid,50);
  k := public.claim_ai_dispatch_verified(rid,P);
  perform public.record_ai_outcome_verified(rid,k,false,'{}'::jsonb,P);
  begin perform public.begin_single_ai_request_verified(o,w,gen_random_uuid(),'strategy',inp,P); fail:=fail+1; failures:=failures||' not_blocked';
  exception when others then if sqlerrm like 'Recover pending AI work%' then pass:=pass+1; else fail:=fail+1; failures:=failures||' block_msg:'||left(sqlerrm,40); end if; end;
  begin perform public.accept_unknown_ai_outcome_verified(rid,'forged'); fail:=fail+1; failures:=failures||' no_proof'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';

  perform set_config('request.jwt.claims', json_build_object('sub',ux,'role','authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.accept_unknown_ai_outcome_verified(rid,P); fail:=fail+1; failures:=failures||' outsider'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',uv,'role','authenticated')::text, true); execute 'set local role authenticated';
  begin perform public.accept_unknown_ai_outcome_verified(rid,P); fail:=fail+1; failures:=failures||' viewer'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';

  -- org owner accepts on the member's behalf; balance does not move (already reserved)
  perform set_config('request.jwt.claims', json_build_object('sub',uo,'role','authenticated')::text, true); execute 'set local role authenticated';
  bal_before := public.credit_balance(o);
  ch := public.accept_unknown_ai_outcome_verified(rid,P);
  bal_after := public.credit_balance(o);
  if ch = 50 and bal_before = bal_after then pass:=pass+1; else fail:=fail+1; failures:=failures||' charge_or_balance('||ch||','||bal_before||','||bal_after||')'; end if;
  begin perform public.accept_unknown_ai_outcome_verified(rid,P); fail:=fail+1; failures:=failures||' accepted_twice'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';

  select count(*) into n from public.ai_usage_events where run_id=rid and credits_charged=50 and user_id=um; if n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' usage_event'; end if;
  select count(*) into n from public.ai_credit_reservations where run_id=rid and status='settled' and charged=50; if n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' reservation'; end if;
  select count(*) into n from public.ai_call_receipts where run_id=rid and state='settled' and diagnostic_ids->>'resolution'='accepted_as_used'; if n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' receipt'; end if;
  select count(*) into n from public.single_ai_requests where run_id=rid and status='failed' and reply is null; if n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' request_closed'; end if;
  select count(*) into n from public.audit_logs where org_id=o and action='ai.outcome.accepted_as_used'; if n=1 then pass:=pass+1; else fail:=fail+1; failures:=failures||' audit'; end if;

  -- unblocked; an in-flight (leased) call cannot be accepted
  perform set_config('request.jwt.claims', json_build_object('sub',um,'role','authenticated')::text, true); execute 'set local role authenticated';
  a := public.begin_single_ai_request_verified(o,w,gen_random_uuid(),'strategy',inp,P); rid2 := (a->>'run_id')::uuid;
  if (a->>'claimed')::boolean then pass:=pass+1; else fail:=fail+1; failures:=failures||' still_blocked'; end if;
  perform public.reserve_ai_credits(rid2,50);
  k := public.claim_ai_dispatch_verified(rid2,P);
  begin perform public.accept_unknown_ai_outcome_verified(rid2,P); fail:=fail+1; failures:=failures||' inflight_accepted'; exception when others then if sqlstate in ('P0001','42501','23514','23505','23503') then pass:=pass+1; else fail:=fail+1; failures:=failures||' unexpected:'||sqlstate||':'||left(sqlerrm,60); end if; end;
  execute 'reset role';

  if not has_function_privilege('anon','public.accept_unknown_ai_outcome_verified(uuid,text)','execute') then pass:=pass+1; else fail:=fail+1; failures:=failures||' anon_exec'; end if;
  raise exception 'UNCERTAIN_RESULT pass=% fail=% failures=[%]', pass, fail, trim(failures);
end $$;
