-- Always rolled back by the staging test runner; no provider calls or credit grants.
DO $$
DECLARE u uuid := gen_random_uuid(); v uuid := gen_random_uuid(); o uuid; w uuid; c uuid;
  t1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid(); t3 uuid := gen_random_uuid();
  p integer := 0; n integer; before_runs integer;
BEGIN
  INSERT INTO auth.users(id,email,aud,role,instance_id) VALUES
    (u,'campaign-work-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
    (v,'campaign-work-viewer@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
  PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
  EXECUTE 'set local role authenticated';
  o := public.create_organization('Campaign work rollback test','Campaign work');
  SELECT id INTO w FROM public.workspaces WHERE org_id=o;
  INSERT INTO public.campaigns(org_id,workspace_id,title,category) VALUES(o,w,'Reviewed campaign','content') RETURNING id INTO c;
  SELECT count(*) INTO before_runs FROM public.task_runs WHERE workspace_id=w;
  INSERT INTO public.tasks(id,org_id,workspace_id,campaign_id,title,description,labels) VALUES
    (t1,o,w,c,'Landing page copy','Approved campaign snapshot',ARRAY['campaign-proposal','proposal:rollback','proposal-version:rollback']),
    (t2,o,w,c,'SEO page plan','Approved campaign snapshot',ARRAY['campaign-proposal','proposal:rollback','proposal-version:rollback']);
  SELECT count(*) INTO n FROM public.tasks WHERE id IN(t1,t2) AND status='todo' AND description='Approved campaign snapshot';
  IF n<>2 THEN RAISE EXCEPTION 'Created work incorrectly classified'; END IF; p:=p+1;
  PERFORM public.assign_task_specialist(t1,'copywriter','preparation',true);
  PERFORM public.assign_task_specialist(t2,'seo','preparation',true);
  SELECT count(*) INTO n FROM public.task_execution_profiles WHERE task_id IN(t1,t2) AND requires_approval;
  IF n<>2 THEN RAISE EXCEPTION 'Assignment or separate approval missing'; END IF; p:=p+1;
  SELECT count(*) INTO n FROM public.task_runs WHERE workspace_id=w;
  IF n<>before_runs THEN RAISE EXCEPTION 'Assignment executed AI'; END IF; p:=p+1;
  BEGIN
    INSERT INTO public.tasks(id,org_id,workspace_id,campaign_id,title) VALUES(t3,o,w,c,'Should roll back'),(t1,o,w,c,'Duplicate');
    RAISE EXCEPTION 'Duplicate primary key accepted';
  EXCEPTION WHEN unique_violation THEN p:=p+1; END;
  IF EXISTS(SELECT 1 FROM public.tasks WHERE id=t3) THEN RAISE EXCEPTION 'Partial batch persisted'; END IF; p:=p+1;
  SELECT count(*) INTO n FROM public.tasks WHERE campaign_id=c;
  IF n<>2 THEN RAISE EXCEPTION 'Repeat duplicated work'; END IF; p:=p+1;
  EXECUTE 'reset role';
  INSERT INTO public.organization_members(org_id,user_id,role) VALUES(o,v,'viewer');
  INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(w,v,'viewer');
  PERFORM set_config('request.jwt.claims',json_build_object('sub',v,'role','authenticated')::text,true);
  EXECUTE 'set local role authenticated';
  BEGIN
    INSERT INTO public.tasks(org_id,workspace_id,campaign_id,title) VALUES(o,w,c,'Viewer attack');
    RAISE EXCEPTION 'Viewer created work';
  EXCEPTION WHEN insufficient_privilege THEN p:=p+1; END;
  BEGIN
    PERFORM public.assign_task_specialist(t1,'content','preparation',false);
    RAISE EXCEPTION 'Viewer assigned specialist';
  EXCEPTION WHEN OTHERS THEN
    IF sqlerrm='Assigning work requires workspace member permission' THEN p:=p+1; ELSE RAISE; END IF;
  END;
  EXECUTE 'reset role';
  RAISE EXCEPTION 'CAMPAIGN_WORK_RESULT pass=% fail=0',p;
END $$;