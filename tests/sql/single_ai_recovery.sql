-- Test-only verifier replacement exists solely inside this rollback-only block.
-- No provider is invoked. Synthetic paid delivery is an accounting fault fixture.
DO $suite$
DECLARE u uuid:=gen_random_uuid(); other_user uuid:=gen_random_uuid(); member_user uuid:=gen_random_uuid(); o uuid; w uuid; a jsonb; again jsonb; rid uuid; aid uuid; key uuid; n int; p int:=0; input jsonb:='{"request":"Test-only synthetic answer","executionContext":[]}';
BEGIN
 EXECUTE $test$CREATE OR REPLACE FUNCTION public.verify_ai_accounting(_proof text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $body$ BEGIN IF _proof IS DISTINCT FROM 'rollback-fixture-only' THEN RAISE EXCEPTION 'server accounting verification required'; END IF; END $body$ $test$;
 INSERT INTO auth.users(id,email,aud,role,instance_id) VALUES(u,'single-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),(other_user,'single-other@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),(member_user,'single-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
 PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true); EXECUTE 'set local role authenticated';
 o:=public.create_organization('Single AI rollback fixture','Recovery'); SELECT id INTO w FROM public.workspaces WHERE org_id=o;
 key:=gen_random_uuid();
 a:=public.begin_single_ai_request_verified(o,w,key,'growth_officer',input,'rollback-fixture-only'); aid:=(a->>'id')::uuid; rid:=(a->>'run_id')::uuid;
 IF (a->>'claimed')::boolean THEN p:=p+1; ELSE RAISE EXCEPTION 'initial claim missing'; END IF;
 again:=public.begin_single_ai_request_verified(o,w,key,'growth_officer',input,'rollback-fixture-only');
 IF NOT (again->>'claimed')::boolean AND again->>'run_id'=a->>'run_id' THEN p:=p+1; ELSE RAISE EXCEPTION 'duplicate created a run'; END IF;
 BEGIN PERFORM public.begin_single_ai_request_verified(o,w,key,'growth_officer','{"request":"changed"}','rollback-fixture-only'); RAISE EXCEPTION 'changed input accepted'; EXCEPTION WHEN OTHERS THEN IF sqlerrm='request key belongs to different input' THEN p:=p+1; ELSE RAISE; END IF; END;
 PERFORM public.reserve_ai_credits(rid,50);
 key:=public.claim_ai_dispatch_verified(rid,'rollback-fixture-only');
 BEGIN PERFORM public.claim_ai_dispatch_verified(rid,'rollback-fixture-only'); RAISE EXCEPTION 'duplicate dispatch accepted'; EXCEPTION WHEN OTHERS THEN IF sqlerrm='AI dispatch already claimed; never replay' THEN p:=p+1; ELSE RAISE; END IF; END;
 PERFORM public.record_ai_delivery_verified(rid,key,'Synthetic preserved answer','qa-simulation','qa-simulation',10,20,0,1,'qa-only','rollback-fixture-only');
 BEGIN PERFORM public.refund_ai_credits_verified(rid,'rollback-fixture-only'); RAISE EXCEPTION 'paid refund accepted'; EXCEPTION WHEN OTHERS THEN IF sqlerrm='remote outcome requires reconciliation; no refund' THEN p:=p+1; ELSE RAISE; END IF; END;
 BEGIN PERFORM public.finish_growth_request_verified(aid,'Synthetic preserved answer','[{"title":"Invalid capability","capability":"unregistered"}]','rollback-fixture-only'); RAISE EXCEPTION 'invalid proposal accepted'; EXCEPTION WHEN OTHERS THEN IF sqlerrm='invalid capability proposal' THEN p:=p+1; ELSE RAISE; END IF; END;
 SELECT count(*) INTO n FROM public.messages WHERE conversation_id=(SELECT conversation_id FROM public.single_ai_requests WHERE id=aid); IF n=0 THEN p:=p+1; ELSE RAISE EXCEPTION 'partial answer transaction leaked'; END IF;
 SELECT count(*) INTO n FROM public.ai_call_receipts WHERE run_id=rid AND state='delivered'; IF n=1 THEN p:=p+1; ELSE RAISE EXCEPTION 'receipt lost on transaction failure'; END IF;
 a:=public.finish_growth_request_verified(aid,'Synthetic preserved answer','[{"title":"Review strategy","capability":"strategy.recommend","risk":"low"}]','rollback-fixture-only');
 again:=public.finish_growth_request_verified(aid,'ignored duplicate','[]','rollback-fixture-only');
 IF a->>'message_id'=again->>'message_id' AND again->>'reply'='Synthetic preserved answer' THEN p:=p+1; ELSE RAISE EXCEPTION 'duplicate finish changed answer'; END IF;
 SELECT count(*) INTO n FROM public.messages WHERE conversation_id=(a->>'conversation_id')::uuid; IF n=2 THEN p:=p+1; ELSE RAISE EXCEPTION 'duplicate messages'; END IF;
 SELECT count(*) INTO n FROM public.approvals WHERE run_id=rid; IF n=1 THEN p:=p+1; ELSE RAISE EXCEPTION 'duplicate proposals'; END IF;
 SELECT count(*) INTO n FROM public.ai_usage_events WHERE run_id=rid; IF n=1 THEN p:=p+1; ELSE RAISE EXCEPTION 'duplicate usage'; END IF;
 BEGIN UPDATE public.single_ai_requests SET reply='forged' WHERE id=aid; RAISE EXCEPTION 'direct write accepted'; EXCEPTION WHEN insufficient_privilege THEN p:=p+1; END;
 BEGIN PERFORM public.finish_single_ai_request_verified(aid,'forged','invalid'); RAISE EXCEPTION 'forged proof accepted'; EXCEPTION WHEN OTHERS THEN IF sqlerrm='server accounting verification required' THEN p:=p+1; ELSE RAISE; END IF; END;
 EXECUTE 'reset role';
 INSERT INTO public.organization_members(org_id,user_id,role) VALUES(o,member_user,'member'); INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(w,member_user,'member');
 PERFORM set_config('request.jwt.claims',json_build_object('sub',member_user,'role','authenticated')::text,true); EXECUTE 'set local role authenticated';
 SELECT count(*) INTO n FROM public.single_ai_requests WHERE id=aid; IF n=0 THEN p:=p+1; ELSE RAISE EXCEPTION 'another member sees private answer'; END IF;
 BEGIN PERFORM public.finish_single_ai_request_verified(aid,'forged','rollback-fixture-only'); RAISE EXCEPTION 'impersonation accepted'; EXCEPTION WHEN OTHERS THEN IF sqlerrm='forbidden' THEN p:=p+1; ELSE RAISE; END IF; END;
 EXECUTE 'reset role'; PERFORM set_config('request.jwt.claims',json_build_object('sub',other_user,'role','authenticated')::text,true); EXECUTE 'set local role authenticated';
 SELECT count(*) INTO n FROM public.single_ai_requests WHERE id=aid; IF n=0 THEN p:=p+1; ELSE RAISE EXCEPTION 'cross tenant answer exposed'; END IF;
 EXECUTE 'reset role'; UPDATE public.organization_members SET role='viewer' WHERE org_id=o AND user_id=member_user; UPDATE public.workspace_members SET role='viewer' WHERE workspace_id=w AND user_id=member_user;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',member_user,'role','authenticated')::text,true); EXECUTE 'set local role authenticated';
 BEGIN PERFORM public.begin_single_ai_request_verified(o,w,gen_random_uuid(),'content',input,'rollback-fixture-only'); RAISE EXCEPTION 'revoked member started AI'; EXCEPTION WHEN OTHERS THEN IF sqlerrm='forbidden' THEN p:=p+1; ELSE RAISE; END IF; END;
 EXECUTE 'reset role';
 IF NOT has_function_privilege('anon','public.finish_single_ai_request_verified(uuid,text,text)','EXECUTE') THEN p:=p+1; ELSE RAISE EXCEPTION 'anonymous recovery'; END IF;
 RAISE EXCEPTION 'SINGLE_AI_RECOVERY_RESULT pass=% fail=0',p;
END $suite$;