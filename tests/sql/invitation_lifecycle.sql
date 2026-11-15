-- Self-rolls back. The deliberate final exception carries the result.
DO $$
DECLARE owner uuid:=gen_random_uuid(); invited uuid:=gen_random_uuid(); wrong uuid:=gen_random_uuid(); unconfirmed uuid:=gen_random_uuid(); extra uuid:=gen_random_uuid(); o uuid; tok uuid; tok2 uuid; n int; p int:=0;
BEGIN
 INSERT INTO auth.users(id,email,email_confirmed_at,aud,role,instance_id) VALUES
 (owner,'invite-owner@test.local',now(),'authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 (invited,'invited@test.local',now(),'authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 (wrong,'wrong@test.local',now(),'authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 (unconfirmed,'unconfirmed@test.local',NULL,'authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 (extra,'extra@test.local',now(),'authenticated','authenticated','00000000-0000-0000-0000-000000000000');
 PERFORM set_config('request.jwt.claims',json_build_object('sub',owner,'role','authenticated')::text,true); EXECUTE 'set local role authenticated';
 o:=public.create_organization('Invitation lifecycle','Invitations');
 tok:=public.create_invitation(o,' INVITED@test.local ','member'); p:=p+1;
 BEGIN PERFORM public.create_invitation(o,'invited@test.local','viewer'); RAISE EXCEPTION 'duplicate invite accepted'; EXCEPTION WHEN OTHERS THEN IF sqlerrm='A pending invitation already exists' THEN p:=p+1; ELSE RAISE; END IF; END;
 BEGIN PERFORM public.create_invitation(o,'extra@test.local','owner'); RAISE EXCEPTION 'owner invite accepted'; EXCEPTION WHEN OTHERS THEN IF sqlerrm='invalid role' THEN p:=p+1; ELSE RAISE; END IF; END;
 BEGIN INSERT INTO public.invitations(org_id,email,role,invited_by) VALUES(o,'direct@test.local','member',owner); RAISE EXCEPTION 'direct invite accepted'; EXCEPTION WHEN insufficient_privilege THEN p:=p+1; END;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',wrong,'role','authenticated')::text,true);
 BEGIN PERFORM public.accept_invitation(tok); RAISE EXCEPTION 'wrong email accepted'; EXCEPTION WHEN OTHERS THEN IF sqlerrm='invitation is for a different email' THEN p:=p+1; ELSE RAISE; END IF; END;
 EXECUTE 'reset role'; UPDATE public.invitations SET email='unconfirmed@test.local' WHERE token=tok;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',unconfirmed,'role','authenticated')::text,true); EXECUTE 'set local role authenticated';
 BEGIN PERFORM public.accept_invitation(tok); RAISE EXCEPTION 'unconfirmed email accepted'; EXCEPTION WHEN OTHERS THEN IF sqlerrm='Confirm your email before accepting this invitation' THEN p:=p+1; ELSE RAISE; END IF; END;
 EXECUTE 'reset role'; UPDATE public.invitations SET email='invited@test.local' WHERE token=tok;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',invited,'role','authenticated')::text,true); EXECUTE 'set local role authenticated';
 IF public.accept_invitation(tok)=o THEN p:=p+1; ELSE RAISE EXCEPTION 'acceptance'; END IF;
 SELECT count(*) INTO n FROM public.organization_members WHERE org_id=o AND user_id=invited AND role='member'; IF n=1 THEN p:=p+1; ELSE RAISE EXCEPTION 'membership'; END IF;
 SELECT count(*) INTO n FROM public.workspace_members WHERE user_id=invited; IF n=0 THEN p:=p+1; ELSE RAISE EXCEPTION 'implicit workspace access'; END IF;
 BEGIN PERFORM public.accept_invitation(tok); RAISE EXCEPTION 'invite reused'; EXCEPTION WHEN OTHERS THEN IF sqlerrm='invitation invalid or expired' THEN p:=p+1; ELSE RAISE; END IF; END;
 EXECUTE 'reset role'; PERFORM set_config('request.jwt.claims',json_build_object('sub',owner,'role','authenticated')::text,true); EXECUTE 'set local role authenticated';
 BEGIN PERFORM public.create_invitation(o,'extra@test.local','member'); RAISE EXCEPTION 'seat limit bypassed'; EXCEPTION WHEN OTHERS THEN IF sqlerrm='Your team seat limit has been reached' THEN p:=p+1; ELSE RAISE; END IF; END;
 EXECUTE 'reset role'; DELETE FROM public.organization_members WHERE org_id=o AND user_id=invited;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',owner,'role','authenticated')::text,true); EXECUTE 'set local role authenticated';
 tok2:=public.create_invitation(o,'extra@test.local','viewer');
 EXECUTE 'reset role'; INSERT INTO public.organization_members(org_id,user_id,role) VALUES(o,invited,'member');
 PERFORM set_config('request.jwt.claims',json_build_object('sub',extra,'role','authenticated')::text,true); EXECUTE 'set local role authenticated';
 BEGIN PERFORM public.accept_invitation(tok2); RAISE EXCEPTION 'acceptance seat limit bypassed'; EXCEPTION WHEN OTHERS THEN IF sqlerrm='Your team seat limit has been reached' THEN p:=p+1; ELSE RAISE; END IF; END;
 EXECUTE 'reset role'; RAISE EXCEPTION 'INVITATION_RESULT pass=% fail=0',p;
END $$;
