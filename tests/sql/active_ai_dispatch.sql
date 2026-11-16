-- Rollback-only interleaving regression: two users allocate runs before either dispatches.
-- Synthetic delivery only; no provider calls. Result sentinel rolls back all fixtures.
DO $suite$
DECLARE u uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); o uuid; w uuid; a jsonb; b jsonb; ar uuid; br uuid; k uuid; n int; p int:=0; fixture_state text;
BEGIN
 EXECUTE $test$CREATE OR REPLACE FUNCTION public.verify_ai_accounting(_proof text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $body$ BEGIN IF _proof IS DISTINCT FROM 'rollback-fixture-only' THEN RAISE EXCEPTION 'server accounting verification required'; END IF; END $body$ $test$;
 INSERT INTO auth.users(id,email,aud,role,instance_id) VALUES(u,'active-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),(m,'active-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
 PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true); EXECUTE 'set local role authenticated';
 o:=public.create_organization('Active dispatch rollback fixture','Concurrency'); SELECT id INTO w FROM public.workspaces WHERE org_id=o;
 a:=public.begin_single_ai_request_verified(o,w,gen_random_uuid(),'content','{"request":"first"}','rollback-fixture-only'); ar:=(a->>'run_id')::uuid;
 EXECUTE 'reset role'; INSERT INTO public.organization_members(org_id,user_id,role) VALUES(o,m,'member'); INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(w,m,'member');
 PERFORM set_config('request.jwt.claims',json_build_object('sub',m,'role','authenticated')::text,true); EXECUTE 'set local role authenticated';
 b:=public.begin_single_ai_request_verified(o,w,gen_random_uuid(),'content','{"request":"second"}','rollback-fixture-only'); br:=(b->>'run_id')::uuid; PERFORM public.reserve_ai_credits(br,50);
 EXECUTE 'reset role'; PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true); EXECUTE 'set local role authenticated';
 PERFORM public.reserve_ai_credits(ar,50); k:=public.claim_ai_dispatch_verified(ar,'rollback-fixture-only'); p:=p+1;
 BEGIN PERFORM public.claim_ai_dispatch_verified(ar,'rollback-fixture-only'); RAISE EXCEPTION 'replay accepted'; EXCEPTION WHEN OTHERS THEN IF sqlerrm='AI dispatch already claimed; never replay' THEN p:=p+1; ELSE RAISE; END IF; END;
 FOREACH fixture_state IN ARRAY ARRAY['dispatching','unknown','delivered'] LOOP
  EXECUTE 'reset role'; UPDATE public.ai_call_receipts SET state=fixture_state WHERE run_id=ar;
  PERFORM set_config('request.jwt.claims',json_build_object('sub',m,'role','authenticated')::text,true); EXECUTE 'set local role authenticated';
  BEGIN PERFORM public.claim_ai_dispatch_verified(br,'rollback-fixture-only'); RAISE EXCEPTION 'parallel dispatch accepted'; EXCEPTION WHEN OTHERS THEN IF sqlerrm='Another AI dispatch is unresolved; recover saved work before dispatch' THEN p:=p+1; ELSE RAISE; END IF; END;
 END LOOP;
 SELECT count(*) INTO n FROM public.ai_call_receipts WHERE run_id=br; IF n=0 THEN p:=p+1; ELSE RAISE EXCEPTION 'blocked run received a claim'; END IF;
 EXECUTE 'reset role'; UPDATE public.ai_call_receipts SET state='dispatching' WHERE run_id=ar;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true); EXECUTE 'set local role authenticated';
 PERFORM public.record_ai_delivery_verified(ar,k,'Synthetic active answer','qa-simulation','qa-simulation',10,20,0,1,'qa-only','rollback-fixture-only');
 PERFORM public.reconcile_ai_receipt_verified(ar,'rollback-fixture-only');
 EXECUTE 'reset role'; PERFORM set_config('request.jwt.claims',json_build_object('sub',m,'role','authenticated')::text,true); EXECUTE 'set local role authenticated';
 k:=public.claim_ai_dispatch_verified(br,'rollback-fixture-only'); p:=p+1;
 BEGIN PERFORM public.refund_ai_credits_verified(br,'rollback-fixture-only'); RAISE EXCEPTION 'active refund accepted'; EXCEPTION WHEN OTHERS THEN IF sqlerrm='remote outcome requires reconciliation; no refund' THEN p:=p+1; ELSE RAISE; END IF; END;
 EXECUTE 'reset role'; UPDATE public.workspace_members SET role='viewer' WHERE workspace_id=w AND user_id=m; EXECUTE 'set local role authenticated';
 PERFORM public.record_ai_delivery_verified(br,k,'Synthetic revoked active answer','qa-simulation','qa-simulation',10,20,0,1,'qa-only','rollback-fixture-only'); p:=p+1;
 BEGIN PERFORM public.reconcile_ai_receipt_verified(br,'rollback-fixture-only'); RAISE EXCEPTION 'revoked settlement accepted'; EXCEPTION WHEN OTHERS THEN IF sqlerrm='forbidden' THEN p:=p+1; ELSE RAISE; END IF; END;
 EXECUTE 'reset role';
 IF NOT has_function_privilege('anon','public.claim_ai_dispatch_verified(uuid,text)','EXECUTE') THEN p:=p+1; ELSE RAISE EXCEPTION 'anonymous dispatch granted'; END IF;
 RAISE EXCEPTION 'ACTIVE_AI_DISPATCH_RESULT pass=% fail=0',p;
END $suite$;