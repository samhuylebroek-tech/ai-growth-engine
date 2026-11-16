-- Self-rolls back. The deliberate final exception carries the result.
DO $$
DECLARE u uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); o uuid; other uuid; w uuid; r1 uuid:=gen_random_uuid(); r2 uuid:=gen_random_uuid(); r3 uuid:=gen_random_uuid(); r4 uuid:=gen_random_uuid(); n int; charged int; p int:=0;
BEGIN
 INSERT INTO auth.users(id,email,aud,role,instance_id) VALUES(u,'credit-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),(outsider,'credit-outsider@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
 PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true); EXECUTE 'set local role authenticated';
 o:=public.create_organization('Credit lifecycle test','Credits'); SELECT id INTO w FROM public.workspaces WHERE org_id=o;
 INSERT INTO public.agent_runs(id,org_id,workspace_id,agent_key,user_id) VALUES(r1,o,w,'growth_officer',u),(r2,o,w,'growth_officer',u),(r3,o,w,'growth_officer',u),(r4,o,w,'growth_officer',u);
 charged:=public.reserve_ai_credits(r1,3); IF charged=3 AND public.credit_balance(o)=197 THEN p:=p+1; ELSE RAISE EXCEPTION 'reservation'; END IF;
 charged:=public.reserve_ai_credits(r1,3); IF charged=3 AND public.credit_balance(o)=197 THEN p:=p+1; ELSE RAISE EXCEPTION 'idempotent reservation'; END IF;
 EXECUTE 'reset role';
 charged:=public.settle_ai_credits(r1,1,'test','test-model',100,50,0.01);
 IF charged=1 AND public.credit_balance(o)=199 THEN p:=p+1; ELSE RAISE EXCEPTION 'unused reservation refund'; END IF;
 IF public.settle_ai_credits(r1,1,'test','test-model',100,50,0.01)=1 AND public.credit_balance(o)=199 THEN p:=p+1; ELSE RAISE EXCEPTION 'idempotent settlement'; END IF;
 SELECT count(*) INTO n FROM public.ai_usage_events WHERE run_id=r1 AND credits_charged=1; IF n=1 THEN p:=p+1; ELSE RAISE EXCEPTION 'usage event'; END IF;
 PERFORM public.reserve_ai_credits(r2,3); charged:=public.refund_ai_credits(r2); IF charged=0 AND public.credit_balance(o)=199 THEN p:=p+1; ELSE RAISE EXCEPTION 'failure refund'; END IF;
 charged:=public.refund_ai_credits(r2); IF charged=0 AND public.credit_balance(o)=199 THEN p:=p+1; ELSE RAISE EXCEPTION 'duplicate refund'; END IF;
 BEGIN PERFORM public.settle_ai_credits(r2,1,'test','test-model',1,1,0); RAISE EXCEPTION 'refunded reservation settled'; EXCEPTION WHEN OTHERS THEN IF sqlerrm='credit reservation is closed' THEN p:=p+1; ELSE RAISE; END IF; END;
 PERFORM public.reserve_ai_credits(r3,3); charged:=public.settle_ai_credits(r3,5,'test','test-model',4000,1000,0.02);
 IF charged=5 AND public.credit_balance(o)=194 THEN p:=p+1; ELSE RAISE EXCEPTION 'additional settlement'; END IF;
 EXECUTE 'set local role authenticated';
 BEGIN INSERT INTO public.ai_usage_events(org_id,run_id,user_id,provider,model,credits_charged) VALUES(o,r3,u,'fake','fake',999); RAISE EXCEPTION 'direct usage insert accepted'; EXCEPTION WHEN insufficient_privilege THEN p:=p+1; END;
 BEGIN INSERT INTO public.ai_credit_reservations(run_id,org_id,user_id,reserved) VALUES(r4,o,u,1); RAISE EXCEPTION 'direct reservation insert accepted'; EXCEPTION WHEN insufficient_privilege THEN p:=p+1; END;
 EXECUTE 'reset role'; PERFORM set_config('request.jwt.claims',json_build_object('sub',outsider,'role','authenticated')::text,true); EXECUTE 'set local role authenticated';
 BEGIN PERFORM public.reserve_ai_credits(r4,3); RAISE EXCEPTION 'outsider reserved'; EXCEPTION WHEN OTHERS THEN IF sqlerrm='forbidden' THEN p:=p+1; ELSE RAISE; END IF; END;
 BEGIN PERFORM public.refund_ai_credits(r3); RAISE EXCEPTION 'outsider refunded'; EXCEPTION WHEN insufficient_privilege THEN p:=p+1; END;
 other:=public.create_organization('Other credit org','Other');
 EXECUTE 'reset role'; PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true); EXECUTE 'set local role authenticated';
 PERFORM public.reserve_ai_credits(r4,3); PERFORM public.consume_credits(o,191,'leave-no-settlement-balance');
 EXECUTE 'reset role';
 charged:=public.settle_ai_credits(r4,5,'test','test-model',4000,1000,0.02);
 IF charged=3 AND public.credit_balance(o)=0 THEN p:=p+1; ELSE RAISE EXCEPTION 'settlement overdraft prevention: % %',charged,public.credit_balance(o); END IF;
 EXECUTE 'reset role'; RAISE EXCEPTION 'CREDIT_RESERVATION_RESULT pass=% fail=0',p;
END $$;
