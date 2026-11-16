-- Rollback-only receipt scope/grant/immutability boundary checks.
DO $$
DECLARE u uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid(); o uuid; w uuid; rid uuid:=gen_random_uuid(); n int; p int:=0;
BEGIN
 INSERT INTO auth.users(id,email,aud,role,instance_id) VALUES(u,'receipt-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),(outsider,'receipt-other@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),(viewer,'receipt-viewer@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
 PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true); EXECUTE 'set local role authenticated';
 o:=public.create_organization('Receipt rollback fixture','Receipt tests'); SELECT id INTO w FROM public.workspaces WHERE org_id=o;
 INSERT INTO public.agent_runs(id,org_id,workspace_id,user_id,agent_key) VALUES(rid,o,w,u,'growth_officer'); PERFORM public.reserve_ai_credits(rid,3);
 EXECUTE 'reset role';
 INSERT INTO public.ai_call_receipts(run_id,org_id,workspace_id,user_id) VALUES(rid,o,w,u);
 INSERT INTO public.organization_members(org_id,user_id,role) VALUES(o,viewer,'viewer'); INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(w,viewer,'viewer');
 EXECUTE 'set local role authenticated';
 SELECT count(*) INTO n FROM public.ai_call_receipts WHERE run_id=rid; IF n=1 THEN p:=p+1; ELSE RAISE EXCEPTION 'owner cannot read receipt'; END IF;
 BEGIN UPDATE public.ai_call_receipts SET state='settled' WHERE run_id=rid; RAISE EXCEPTION 'direct update accepted'; EXCEPTION WHEN insufficient_privilege THEN p:=p+1; END;
 BEGIN DELETE FROM public.ai_call_receipts WHERE run_id=rid; RAISE EXCEPTION 'direct delete accepted'; EXCEPTION WHEN insufficient_privilege THEN p:=p+1; END;
 BEGIN INSERT INTO public.ai_call_receipts(run_id,org_id,workspace_id,user_id) VALUES(gen_random_uuid(),o,w,u); RAISE EXCEPTION 'direct insert accepted'; EXCEPTION WHEN insufficient_privilege THEN p:=p+1; END;
 BEGIN PERFORM public.claim_ai_dispatch_verified(rid,'invalid-proof'); RAISE EXCEPTION 'forged dispatch accepted'; EXCEPTION WHEN OTHERS THEN IF sqlerrm='server accounting verification required' THEN p:=p+1; ELSE RAISE; END IF; END;
 BEGIN PERFORM public.reconcile_ai_receipt_verified(rid,'invalid-proof'); RAISE EXCEPTION 'forged settlement accepted'; EXCEPTION WHEN OTHERS THEN IF sqlerrm='server accounting verification required' THEN p:=p+1; ELSE RAISE; END IF; END;
 BEGIN PERFORM public.record_ai_outcome_verified(rid,gen_random_uuid(),true,'{}','invalid-proof'); RAISE EXCEPTION 'forged unstarted outcome accepted'; EXCEPTION WHEN OTHERS THEN IF sqlerrm='server accounting verification required' THEN p:=p+1; ELSE RAISE; END IF; END;
 BEGIN PERFORM public.recover_coordinated_analysis_verified(gen_random_uuid(),true,'invalid-proof'); RAISE EXCEPTION 'forged recovery accepted'; EXCEPTION WHEN OTHERS THEN IF sqlerrm='server accounting verification required' THEN p:=p+1; ELSE RAISE; END IF; END;
 EXECUTE 'reset role'; PERFORM set_config('request.jwt.claims',json_build_object('sub',outsider,'role','authenticated')::text,true); EXECUTE 'set local role authenticated';
 SELECT count(*) INTO n FROM public.ai_call_receipts WHERE run_id=rid; IF n=0 THEN p:=p+1; ELSE RAISE EXCEPTION 'cross-tenant receipt exposed'; END IF;
 EXECUTE 'reset role'; PERFORM set_config('request.jwt.claims',json_build_object('sub',viewer,'role','authenticated')::text,true); EXECUTE 'set local role authenticated';
 SELECT count(*) INTO n FROM public.ai_call_receipts WHERE run_id=rid; IF n=0 THEN p:=p+1; ELSE RAISE EXCEPTION 'viewer receipt exposed'; END IF;
 EXECUTE 'reset role';
 IF NOT has_function_privilege('anon','public.reconcile_ai_receipt_verified(uuid,text)','EXECUTE') THEN p:=p+1; ELSE RAISE EXCEPTION 'anonymous settlement'; END IF;
 IF NOT has_function_privilege('anon','public.recover_coordinated_analysis_verified(uuid,boolean,text)','EXECUTE') THEN p:=p+1; ELSE RAISE EXCEPTION 'anonymous recovery'; END IF;
 RAISE EXCEPTION 'AI_RECEIPT_SECURITY_RESULT pass=% fail=0',p;
END $$;