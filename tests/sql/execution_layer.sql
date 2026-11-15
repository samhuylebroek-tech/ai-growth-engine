-- Self-rollback: EXECUTION_RESULT is the deliberate successful terminal exception.
DO $$
DECLARE u uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); v uuid:=gen_random_uuid(); x uuid:=gen_random_uuid(); o uuid; w uuid; w2 uuid; pr uuid; ca uuid; t uuid; t2 uuid; conv uuid; msg uuid; res jsonb; res2 jsonb; req uuid:=gen_random_uuid(); n int; p int:=0; plan jsonb:='{"title":"Reviewed SEO plan","description":"Source plan","objective":"Improve discovery","category":"seo","tasks":[{"title":"Audit pages","description":"Review metadata","priority":"high","due_date":"2026-11-20","owner_id":""}]}';
BEGIN
INSERT INTO auth.users(id,email,aud,role,instance_id) VALUES(u,'execution-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),(m,'execution-admin@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),(v,'execution-viewer@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),(x,'execution-other@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true); EXECUTE 'set local role authenticated';o:=public.create_organization('Execution test','Execution'); SELECT id INTO w FROM public.workspaces WHERE org_id=o;
INSERT INTO public.projects(org_id,workspace_id,title,owner_id) VALUES(o,w,'Launch',u) RETURNING id INTO pr;p:=p+1;
INSERT INTO public.campaigns(org_id,workspace_id,title,category,budget_eur) VALUES(o,w,'SEO launch','seo',120) RETURNING id INTO ca;p:=p+1;
INSERT INTO public.tasks(org_id,workspace_id,title,project_id,campaign_id,due_date,owner_id,recurrence) VALUES(o,w,'Research',pr,ca,'2026-11-15',u,'weekly') RETURNING id INTO t;p:=p+1;
INSERT INTO public.tasks(org_id,workspace_id,title,parent_task_id) VALUES(o,w,'Subtask',t) RETURNING id INTO t2;p:=p+1;
INSERT INTO public.execution_notes(org_id,workspace_id,entity_type,entity_id,kind,related_id) VALUES(o,w,'tasks',t,'dependency',t2);p:=p+1;
BEGIN UPDATE public.tasks SET status='done' WHERE id=t; RAISE EXCEPTION 'dependency bypass';EXCEPTION WHEN OTHERS THEN IF sqlerrm='Complete dependencies first' THEN p:=p+1; ELSE RAISE; END IF;END;
BEGIN INSERT INTO public.execution_notes(org_id,workspace_id,entity_type,entity_id,kind,related_id) VALUES(o,w,'tasks',t2,'dependency',t); RAISE EXCEPTION 'cycle allowed';EXCEPTION WHEN OTHERS THEN IF sqlerrm='Dependency cycle' THEN p:=p+1; ELSE RAISE; END IF;END;
UPDATE public.tasks SET status='done' WHERE id=t2;UPDATE public.tasks SET status='done' WHERE id=t;
res:=to_jsonb(public.repeat_execution_task(t));res2:=to_jsonb(public.repeat_execution_task(t));IF res=res2 THEN p:=p+1;ELSE RAISE EXCEPTION 'recurrence duplicated';END IF;
IF EXISTS(SELECT 1 FROM public.tasks WHERE recurrence_source_id=t AND due_date='2026-11-22') THEN p:=p+1;ELSE RAISE EXCEPTION 'recurrence date';END IF;
BEGIN UPDATE public.projects SET start_date='2026-12-01',end_date='2026-11-01' WHERE id=pr; RAISE EXCEPTION 'invalid date order';EXCEPTION WHEN OTHERS THEN IF sqlerrm='End date precedes start date' THEN p:=p+1;ELSE RAISE;END IF;END;
INSERT INTO public.conversations(org_id,workspace_id,user_id,title) VALUES(o,w,u,'Recommendation') RETURNING id INTO conv;
INSERT INTO public.messages(org_id,conversation_id,role,content) VALUES(o,conv,'assistant','1. Audit pages') RETURNING id INTO msg;
res:=public.convert_execution_plan(w,msg,'project',req,plan);res2:=public.convert_execution_plan(w,msg,'project',gen_random_uuid(),plan);IF res=res2 THEN p:=p+1;ELSE RAISE EXCEPTION 'conversion duplicate';END IF;
IF EXISTS(SELECT 1 FROM public.tasks WHERE source_message_id=msg AND project_id=(res->>'parent_id')::uuid) THEN p:=p+1;ELSE RAISE EXCEPTION 'source relationship';END IF;
res2:=public.convert_execution_plan(w,msg,'tasks',gen_random_uuid(),plan);IF res2->>'parent_id' IS NULL AND jsonb_array_length(res2->'task_ids')=1 THEN p:=p+1;ELSE RAISE EXCEPTION 'task conversion';END IF;
res2:=public.convert_execution_plan(w,msg,'campaign',gen_random_uuid(),plan);IF EXISTS(SELECT 1 FROM public.campaigns WHERE id=(res2->>'parent_id')::uuid AND category='seo') THEN p:=p+1;ELSE RAISE EXCEPTION 'campaign conversion';END IF;
BEGIN PERFORM public.convert_execution_plan(w,msg,'tasks',gen_random_uuid(),jsonb_set(plan,'{tasks}','[]')); -- existing conversion reuses existing result
p:=p+1;END;
SELECT count(*) INTO n FROM public.activity_events WHERE workspace_id=w;IF n>=8 THEN p:=p+1;ELSE RAISE EXCEPTION 'history missing';END IF;
BEGIN INSERT INTO public.activity_events(org_id,workspace_id,entity_type,entity_id,action) VALUES(o,w,'tasks',t,'forged');RAISE EXCEPTION 'history forgery';EXCEPTION WHEN insufficient_privilege THEN p:=p+1;END;
BEGIN UPDATE public.activity_events SET action='forged';GET DIAGNOSTICS n=ROW_COUNT;IF n=0 THEN p:=p+1;ELSE RAISE EXCEPTION 'history modified';END IF;EXCEPTION WHEN insufficient_privilege THEN p:=p+1;WHEN OTHERS THEN IF sqlerrm='Execution history is immutable' THEN p:=p+1;ELSE RAISE;END IF;END;
EXECUTE 'reset role';INSERT INTO public.workspaces(org_id,name) VALUES(o,'Restricted') RETURNING id INTO w2;INSERT INTO public.organization_members(org_id,user_id,role) VALUES(o,m,'admin'),(o,v,'viewer');INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(w,m,'member'),(w,v,'viewer');
PERFORM set_config('request.jwt.claims',json_build_object('sub',m,'role','authenticated')::text,true);EXECUTE 'set local role authenticated';
UPDATE public.projects SET description='Teammate edit' WHERE id=pr;GET DIAGNOSTICS n=ROW_COUNT;IF n=1 THEN p:=p+1;ELSE RAISE EXCEPTION 'member edit';END IF;
BEGIN INSERT INTO public.tasks(org_id,workspace_id,title,owner_id) VALUES(o,w,'Bad assignee',x);RAISE EXCEPTION 'outsider assignment';EXCEPTION WHEN OTHERS THEN IF sqlerrm='Assignee needs workspace member access' THEN p:=p+1;ELSE RAISE;END IF;END;
BEGIN INSERT INTO public.tasks(org_id,workspace_id,title) VALUES(o,w2,'unauthorized');RAISE EXCEPTION 'restricted admin write';EXCEPTION WHEN insufficient_privilege THEN p:=p+1;END;
SELECT count(*) INTO n FROM public.tasks WHERE workspace_id=w2;IF n=0 THEN p:=p+1;ELSE RAISE EXCEPTION 'restricted read';END IF;
BEGIN PERFORM public.convert_execution_plan(w,msg,'project',gen_random_uuid(),plan);RAISE EXCEPTION 'private source stolen';EXCEPTION WHEN OTHERS THEN IF sqlerrm='Source recommendation unavailable' THEN p:=p+1;ELSE RAISE;END IF;END;
EXECUTE 'reset role';PERFORM set_config('request.jwt.claims',json_build_object('sub',v,'role','authenticated')::text,true);EXECUTE 'set local role authenticated';
SELECT count(*) INTO n FROM public.projects WHERE id=pr;IF n=1 THEN p:=p+1;ELSE RAISE EXCEPTION 'viewer read';END IF;
UPDATE public.projects SET title='attack' WHERE id=pr;GET DIAGNOSTICS n=ROW_COUNT;IF n=0 THEN p:=p+1;ELSE RAISE EXCEPTION 'viewer edit';END IF;
BEGIN INSERT INTO public.tasks(org_id,workspace_id,title) VALUES(o,w,'viewer attack');RAISE EXCEPTION 'viewer create';EXCEPTION WHEN insufficient_privilege THEN p:=p+1;END;
BEGIN PERFORM public.convert_execution_plan(w,msg,'project',gen_random_uuid(),plan);RAISE EXCEPTION 'viewer convert';EXCEPTION WHEN OTHERS THEN IF sqlerrm='forbidden' THEN p:=p+1;ELSE RAISE;END IF;END;
EXECUTE 'reset role';PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);EXECUTE 'set local role authenticated';
BEGIN UPDATE public.projects SET workspace_id=w2 WHERE id=pr;RAISE EXCEPTION 'scope moved';EXCEPTION WHEN OTHERS THEN IF sqlerrm='Execution identity is immutable' THEN p:=p+1;ELSE RAISE;END IF;END;
BEGIN INSERT INTO public.tasks(org_id,workspace_id,title,project_id) VALUES(o,w2,'Cross workspace',pr);RAISE EXCEPTION 'cross parent';EXCEPTION WHEN foreign_key_violation THEN p:=p+1;END;
BEGIN INSERT INTO public.execution_notes(org_id,workspace_id,entity_type,entity_id,kind,title) VALUES(o,w2,'projects',pr,'comment','cross comment');RAISE EXCEPTION 'cross note';EXCEPTION WHEN OTHERS THEN IF sqlerrm='Parent scope mismatch' THEN p:=p+1;ELSE RAISE;END IF;END;
EXECUTE 'reset role';RAISE EXCEPTION 'EXECUTION_RESULT pass=% fail=0',p;
END $$;
