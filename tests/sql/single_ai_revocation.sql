-- Rollback-only in-flight revocation/unknown outcome/expired-dispatch checks.
DO $suite$
DECLARE u uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); o uuid; w uuid; a jsonb; rid uuid; k uuid; n int; p int:=0;
BEGIN
 EXECUTE $test$CREATE OR REPLACE FUNCTION public.verify_ai_accounting(_proof text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $body$ BEGIN IF _proof IS DISTINCT FROM 'rollback-fixture-only' THEN RAISE EXCEPTION 'server accounting verification required'; END IF; END $body$ $test$;
 INSERT INTO auth.users(id,email,aud,role,instance_id) VALUES(u,'revoke-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),(m,'revoke-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
 PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true); EXECUTE 'set local role authenticated';
 o:=public.create_organization('Revocation rollback fixture','Recovery'); SELECT id INTO w FROM public.workspaces WHERE org_id=o;
 EXECUTE 'reset role'; INSERT INTO public.organization_members(org_id,user_id,role) VALUES(o,m,'member'); INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(w,m,'member');
 PERFORM set_config('request.jwt.claims',json_build_object('sub',m,'role','authenticated')::text,true); EXECUTE 'set local role authenticated';
 a:=public.begin_single_ai_request_verified(o,w,gen_random_uuid(),'content','{"request":"revocation fixture"}','rollback-fixture-only'); rid:=(a->>'run_id')::uuid;
 PERFORM public.reserve_ai_credits(rid,50); k:=public.claim_ai_dispatch_verified(rid,'rollback-fixture-only');
 EXECUTE 'reset role'; UPDATE public.workspace_members SET role='viewer' WHERE workspace_id=w AND user_id=m; EXECUTE 'set local role authenticated';
 BEGIN PERFORM public.record_ai_delivery_verified(rid,k,'Synthetic revoked answer','qa-simulation','qa-simulation',10,20,0,1,'qa-only','rollback-fixture-only'); RAISE EXCEPTION 'revoked delivery accepted'; EXCEPTION WHEN OTHERS THEN IF sqlerrm='forbidden' THEN p:=p+1; ELSE RAISE; END IF; END;
 BEGIN PERFORM public.finish_single_ai_request_verified((a->>'id')::uuid,'forged','rollback-fixture-only'); RAISE EXCEPTION 'revoked persistence accepted'; EXCEPTION WHEN OTHERS THEN IF sqlerrm='forbidden' THEN p:=p+1; ELSE RAISE; END IF; END;
 SELECT count(*) INTO n FROM public.single_ai_requests WHERE id=(a->>'id')::uuid; IF n=0 THEN p:=p+1; ELSE RAISE EXCEPTION 'revoked read accepted'; END IF;
 EXECUTE 'reset role'; SELECT count(*) INTO n FROM public.ai_credit_reservations WHERE run_id=rid AND status='reserved'; IF n=1 THEN p:=p+1; ELSE RAISE EXCEPTION 'revocation refunded unknown execution'; END IF;
 UPDATE public.workspace_members SET role='member' WHERE workspace_id=w AND user_id=m; EXECUTE 'set local role authenticated';
 PERFORM public.record_ai_outcome_verified(rid,k,false,'{"requestId":"qa-only"}','rollback-fixture-only');
 BEGIN PERFORM public.close_single_ai_request_verified((a->>'id')::uuid,'rollback-fixture-only'); RAISE EXCEPTION 'unknown closed'; EXCEPTION WHEN OTHERS THEN IF sqlerrm LIKE 'Remote outcome pending%' THEN p:=p+1; ELSE RAISE; END IF; END;
 BEGIN PERFORM public.begin_single_ai_request_verified(o,w,gen_random_uuid(),'content','{"request":"another request"}','rollback-fixture-only'); RAISE EXCEPTION 'unknown allowed new dispatch'; EXCEPTION WHEN OTHERS THEN IF sqlerrm='Recover pending AI work before a new request' THEN p:=p+1; ELSE RAISE; END IF; END;
 EXECUTE 'reset role'; UPDATE public.ai_call_receipts SET state='not_started' WHERE run_id=rid; EXECUTE 'set local role authenticated';
 PERFORM public.close_single_ai_request_verified((a->>'id')::uuid,'rollback-fixture-only');
 a:=public.begin_single_ai_request_verified(o,w,gen_random_uuid(),'content','{"request":"expiry fixture"}','rollback-fixture-only'); rid:=(a->>'run_id')::uuid; PERFORM public.reserve_ai_credits(rid,50);
 EXECUTE 'reset role'; UPDATE public.single_ai_requests SET created_at=now()-interval '16 minutes' WHERE id=(a->>'id')::uuid; EXECUTE 'set local role authenticated';
 BEGIN PERFORM public.claim_ai_dispatch_verified(rid,'rollback-fixture-only'); RAISE EXCEPTION 'expired dispatch accepted'; EXCEPTION WHEN OTHERS THEN IF sqlerrm='Request is closed or expired; recover before dispatch' THEN p:=p+1; ELSE RAISE; END IF; END;
 PERFORM public.close_single_ai_request_verified((a->>'id')::uuid,'rollback-fixture-only');
 SELECT count(*) INTO n FROM public.ai_credit_reservations WHERE run_id=rid AND status='refunded'; IF n=1 THEN p:=p+1; ELSE RAISE EXCEPTION 'unstarted expiry not refunded'; END IF;
 EXECUTE 'reset role'; RAISE EXCEPTION 'SINGLE_AI_REVOCATION_RESULT pass=% fail=0',p;
END $suite$;