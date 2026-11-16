-- Rollback-only Content Studio authorization: versions immutable, exact-version approval by admins only, tenant isolation.
DO $suite$
DECLARE u uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); x uuid:=gen_random_uuid(); o uuid; o2 uuid; w uuid; w2 uuid; a uuid; v1 uuid; v2 uuid; n int; p int:=0;
BEGIN
 INSERT INTO auth.users(id,email,aud,role,instance_id) VALUES(u,'cs-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),(m,'cs-member@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),(x,'cs-outsider@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
 PERFORM set_config('request.jwt.claims',json_build_object('sub',x,'role','authenticated')::text,true); EXECUTE 'set local role authenticated';
 o2:=public.create_organization('Content outsider fixture','Other'); SELECT id INTO w2 FROM public.workspaces WHERE org_id=o2;
 EXECUTE 'reset role'; PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true); EXECUTE 'set local role authenticated';
 o:=public.create_organization('Content studio fixture','Content'); SELECT id INTO w FROM public.workspaces WHERE org_id=o;
 INSERT INTO public.content_assets(org_id,workspace_id,title,draft_body) VALUES(o,w,'Post','first') RETURNING id INTO a;
 v1:=public.save_content_version(a,'one'); UPDATE public.content_assets SET draft_body='second' WHERE id=a; v2:=public.save_content_version(a);
 SELECT max(version_no) INTO n FROM public.content_versions WHERE asset_id=a; IF n=2 THEN p:=p+1; ELSE RAISE EXCEPTION 'numbering'; END IF;
 BEGIN UPDATE public.content_versions SET body='tampered' WHERE id=v1; RAISE EXCEPTION 'version update allowed'; EXCEPTION WHEN insufficient_privilege THEN p:=p+1; END;
 BEGIN DELETE FROM public.content_versions WHERE id=v1; RAISE EXCEPTION 'version delete allowed'; EXCEPTION WHEN insufficient_privilege THEN p:=p+1; END;
 BEGIN INSERT INTO public.content_version_decisions(org_id,workspace_id,version_id,body_hash,decision,decided_by) VALUES(o,w,v1,'x','approved',u); RAISE EXCEPTION 'direct decision allowed'; EXCEPTION WHEN insufficient_privilege THEN p:=p+1; END;
 BEGIN UPDATE public.content_assets SET workspace_id=w2 WHERE id=a; RAISE EXCEPTION 'scope move allowed'; EXCEPTION WHEN OTHERS THEN IF sqlerrm LIKE '%immutable%' OR sqlstate IN ('42501','23503') THEN p:=p+1; ELSE RAISE; END IF; END;
 PERFORM public.decide_content_version(v1,'approved');
 SELECT count(*) INTO n FROM public.content_version_decisions WHERE version_id=v2; IF n=0 THEN p:=p+1; ELSE RAISE EXCEPTION 'approval leaked to v2'; END IF;
 BEGIN PERFORM public.decide_content_version(v1,'rejected'); RAISE EXCEPTION 'second decision allowed'; EXCEPTION WHEN unique_violation THEN p:=p+1; END;
 PERFORM public.save_content_version(a,'',v1); IF (SELECT draft_body FROM public.content_assets WHERE id=a)='first' THEN p:=p+1; ELSE RAISE EXCEPTION 'restore'; END IF;
 EXECUTE 'reset role'; INSERT INTO public.organization_members(org_id,user_id,role) VALUES(o,m,'member'); INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(w,m,'member');
 PERFORM set_config('request.jwt.claims',json_build_object('sub',m,'role','authenticated')::text,true); EXECUTE 'set local role authenticated';
 BEGIN PERFORM public.decide_content_version(v2,'approved'); RAISE EXCEPTION 'member approved'; EXCEPTION WHEN insufficient_privilege THEN p:=p+1; END;
 PERFORM public.save_content_version(a,'member edit'); p:=p+1;
 EXECUTE 'reset role'; PERFORM set_config('request.jwt.claims',json_build_object('sub',x,'role','authenticated')::text,true); EXECUTE 'set local role authenticated';
 SELECT count(*) INTO n FROM public.content_versions WHERE asset_id=a; IF n=0 THEN p:=p+1; ELSE RAISE EXCEPTION 'outsider read versions'; END IF;
 SELECT count(*) INTO n FROM public.content_assets WHERE id=a; IF n=0 THEN p:=p+1; ELSE RAISE EXCEPTION 'outsider read asset'; END IF;
 BEGIN PERFORM public.save_content_version(a); RAISE EXCEPTION 'outsider saved'; EXCEPTION WHEN insufficient_privilege THEN p:=p+1; END;
 BEGIN INSERT INTO public.content_assets(org_id,workspace_id,title) VALUES(o,w,'x'); RAISE EXCEPTION 'outsider insert'; EXCEPTION WHEN insufficient_privilege THEN p:=p+1; END;
 EXECUTE 'reset role'; RAISE EXCEPTION 'CONTENT_STUDIO_OK %', p;
END $suite$;
