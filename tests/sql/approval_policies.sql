-- Self-rolls back. The deliberate final exception carries the result.
DO $$
DECLARE owner uuid:=gen_random_uuid(); member uuid:=gen_random_uuid(); o uuid; w uuid; r uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); p int:=0;
BEGIN
 INSERT INTO auth.users(id,email,aud,role,instance_id) VALUES(owner,'policy-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),(member,'policy-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
 PERFORM set_config('request.jwt.claims',json_build_object('sub',owner,'role','authenticated')::text,true); EXECUTE 'set local role authenticated';
 o:=public.create_organization('Approval policy test','Policies'); SELECT id INTO w FROM public.workspaces WHERE org_id=o;
 INSERT INTO public.agent_runs(id,org_id,workspace_id,agent_key,user_id) VALUES(r,o,w,'growth_officer',owner);
 INSERT INTO public.approvals(id,org_id,workspace_id,run_id,capability_key,title,requested_by) VALUES(a,o,w,r,'strategy.recommend','Existing recommendation',owner);
 INSERT INTO public.policies(org_id,capability_key,mode) VALUES(o,'strategy.recommend','blocked');
 BEGIN INSERT INTO public.approvals(org_id,workspace_id,run_id,capability_key,title,requested_by) VALUES(o,w,r,'strategy.recommend','Blocked proposal',owner); RAISE EXCEPTION 'blocked proposal accepted'; EXCEPTION WHEN OTHERS THEN IF sqlerrm='This capability is blocked by organization policy' THEN p:=p+1; ELSE RAISE; END IF; END;
 BEGIN PERFORM public.decide_approval(a,true,''); RAISE EXCEPTION 'blocked approval accepted'; EXCEPTION WHEN OTHERS THEN IF sqlerrm='This capability is blocked by organization policy' THEN p:=p+1; ELSE RAISE; END IF; END;
 IF public.decide_approval(a,false,'Blocked by policy')='rejected' THEN p:=p+1; ELSE RAISE EXCEPTION 'blocked rejection'; END IF;
 UPDATE public.policies SET mode='approval' WHERE org_id=o AND capability_key='strategy.recommend';
 INSERT INTO public.approvals(org_id,workspace_id,run_id,capability_key,title,requested_by) VALUES(o,w,r,'strategy.recommend','Allowed proposal',owner); p:=p+1;
 EXECUTE 'reset role'; INSERT INTO public.organization_members(org_id,user_id,role) VALUES(o,member,'member'); INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(w,member,'member');
 PERFORM set_config('request.jwt.claims',json_build_object('sub',member,'role','authenticated')::text,true); EXECUTE 'set local role authenticated';
 BEGIN INSERT INTO public.policies(org_id,capability_key,mode) VALUES(o,'strategy.recommend','blocked'); RAISE EXCEPTION 'member changed policy'; EXCEPTION WHEN insufficient_privilege THEN p:=p+1; END;
 EXECUTE 'reset role'; RAISE EXCEPTION 'APPROVAL_POLICY_RESULT pass=% fail=0',p;
END $$;
