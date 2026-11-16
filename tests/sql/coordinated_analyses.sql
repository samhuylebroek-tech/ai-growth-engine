-- Always rolls back fixtures through the terminal result exception.
DO $$
DECLARE u uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid(); o uuid; w uuid; other_w uuid; a jsonb; again jsonb; input jsonb:='{"agents":["strategy","research"],"request":"Compare customer hypotheses","executionContext":[]}'; key uuid:=gen_random_uuid(); rid uuid; n int; p int:=0;
BEGIN
 INSERT INTO auth.users(id,email,aud,role,instance_id) VALUES(u,'coord-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),(outsider,'coord-out@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),(viewer,'coord-view@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
 PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true); EXECUTE 'set local role authenticated';
 o:=public.create_organization('Coordination rollback test','Team'); SELECT id INTO w FROM public.workspaces WHERE org_id=o;
 -- Trusted internal implementation is invoked as the database administrator, while retaining the test user's claims.
 EXECUTE 'reset role';
 a:=public.begin_coordinated_analysis(o,w,key,input);
 IF (a->>'claimed')::boolean AND jsonb_array_length(a->'runIds')=3 AND public.credit_balance(o)=50 THEN p:=p+1; ELSE RAISE EXCEPTION 'atomic budget'; END IF;
 again:=public.begin_coordinated_analysis(o,w,key,input);
 IF NOT (again->>'claimed')::boolean AND again->>'id'=a->>'id' AND public.credit_balance(o)=50 THEN p:=p+1; ELSE RAISE EXCEPTION 'duplicate request'; END IF;
 BEGIN PERFORM public.begin_coordinated_analysis(o,w,key,input||'{"request":"Different request"}'); RAISE EXCEPTION 'changed input accepted'; EXCEPTION WHEN OTHERS THEN IF sqlerrm='request key already used for different input' THEN p:=p+1; ELSE RAISE; END IF; END;
 BEGIN PERFORM public.begin_coordinated_analysis(o,w,gen_random_uuid(),input); RAISE EXCEPTION 'concurrent start accepted'; EXCEPTION WHEN OTHERS THEN IF sqlerrm LIKE 'Another coordinated analysis%' THEN p:=p+1; ELSE RAISE; END IF; END;
 BEGIN PERFORM public.finish_coordinated_analysis((a->>'id')::uuid,'Premature answer'); RAISE EXCEPTION 'incomplete usage accepted'; EXCEPTION WHEN OTHERS THEN IF sqlerrm='analysis usage incomplete' THEN p:=p+1; ELSE RAISE; END IF; END;
 EXECUTE 'reset role';
 INSERT INTO public.organization_members(org_id,user_id,role) VALUES(o,viewer,'viewer'); INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(w,viewer,'viewer');
 PERFORM set_config('request.jwt.claims',json_build_object('sub',viewer,'role','authenticated')::text,true); EXECUTE 'set local role authenticated';
 SELECT count(*) INTO n FROM public.coordinated_analyses; IF n=0 THEN p:=p+1; ELSE RAISE EXCEPTION 'viewer read'; END IF;
 BEGIN PERFORM public.begin_coordinated_analysis(o,w,gen_random_uuid(),input); RAISE EXCEPTION 'viewer started'; EXCEPTION WHEN insufficient_privilege THEN p:=p+1; END;
 EXECUTE 'reset role'; PERFORM set_config('request.jwt.claims',json_build_object('sub',outsider,'role','authenticated')::text,true); EXECUTE 'set local role authenticated';
 SELECT count(*) INTO n FROM public.coordinated_analyses; IF n=0 THEN p:=p+1; ELSE RAISE EXCEPTION 'outsider read'; END IF;
 BEGIN PERFORM public.fail_coordinated_analysis((a->>'id')::uuid,'impersonated'); RAISE EXCEPTION 'outsider closed'; EXCEPTION WHEN insufficient_privilege THEN p:=p+1; END;
 EXECUTE 'reset role'; PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
 FOR rid IN SELECT value::uuid FROM jsonb_array_elements_text(a->'runIds') LOOP PERFORM public.settle_ai_credits(rid,1,'test','test',1,1,0); END LOOP;
 again:=public.finish_coordinated_analysis((a->>'id')::uuid,'Source-backed test synthesis');
 IF public.credit_balance(o)=197 AND (again->>'credits')::int=3 THEN p:=p+1; ELSE RAISE EXCEPTION 'unused credits not returned'; END IF;
 SELECT count(*) INTO n FROM public.messages WHERE id=(again->>'messageId')::uuid AND content='Source-backed test synthesis'; IF n=1 THEN p:=p+1; ELSE RAISE EXCEPTION 'saved synthesis'; END IF;
 again:=public.finish_coordinated_analysis((a->>'id')::uuid,'Duplicate save'); SELECT count(*) INTO n FROM public.conversations WHERE id=(again->>'conversationId')::uuid; IF n=1 THEN p:=p+1; ELSE RAISE EXCEPTION 'duplicate finish'; END IF;
 a:=public.begin_coordinated_analysis(o,w,gen_random_uuid(),input); PERFORM public.fail_coordinated_analysis((a->>'id')::uuid,'test failure');
 IF public.credit_balance(o)=197 THEN p:=p+1; ELSE RAISE EXCEPTION 'failure refund'; END IF;
 PERFORM public.fail_coordinated_analysis((a->>'id')::uuid,'duplicate failure'); IF public.credit_balance(o)=197 THEN p:=p+1; ELSE RAISE EXCEPTION 'duplicate refund'; END IF;
 BEGIN PERFORM public.begin_coordinated_analysis(o,w,gen_random_uuid(),input||'{"agents":["strategy","strategy"]}'); RAISE EXCEPTION 'duplicate agents accepted'; EXCEPTION WHEN OTHERS THEN IF sqlerrm='invalid coordinated input' THEN p:=p+1; ELSE RAISE; END IF; END;
 EXECUTE 'set local role authenticated';
 BEGIN INSERT INTO public.coordinated_analyses(org_id,workspace_id,user_id,request_key,input,run_ids) VALUES(o,w,u,gen_random_uuid(),input,'{}'); RAISE EXCEPTION 'direct write accepted'; EXCEPTION WHEN insufficient_privilege THEN p:=p+1; END;
 BEGIN PERFORM public.settle_ai_credits(rid,0,'fake','fake',0,0,0); RAISE EXCEPTION 'direct accounting accepted'; EXCEPTION WHEN insufficient_privilege THEN p:=p+1; END;
 BEGIN PERFORM public.refund_ai_credits_verified(rid,'invalid-proof'); RAISE EXCEPTION 'forged proof accepted'; EXCEPTION WHEN OTHERS THEN IF sqlerrm='server accounting verification required' THEN p:=p+1; ELSE RAISE; END IF; END;
 EXECUTE 'reset role'; RAISE EXCEPTION 'COORDINATION_RESULT pass=% fail=0',p;
END $$;