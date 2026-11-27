-- PENDING: requires proposal 0093 applied to the authorized staging database through an authorized migration tool.
-- Self-rolls back; no external email, provider call or credit use.
DO $$
DECLARE u uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); o uuid; w uuid;
 f uuid; session uuid; request uuid:=gen_random_uuid(); lead uuid; contact uuid; task uuid; n int; p int:=0;
 config jsonb; payload jsonb; visible jsonb;
BEGIN
 INSERT INTO auth.users(id,email,aud,role,instance_id) VALUES
 (u,'lead-owner@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 (viewer,'lead-viewer@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 (outsider,'lead-outsider@test.local','authenticated','authenticated','00000000-0000-0000-0000-000000000000');
 PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
 EXECUTE 'set local role authenticated';
 o:=public.create_organization('Lead rollback test','Lead rollback test');
 SELECT id INTO w FROM public.workspaces WHERE org_id=o;
 config:=jsonb_build_object('key','rollback-lead-form','workspaceId',w,'businessName','Test business','privacyUrl','https://example.test/privacy','active',true,'dailyLimit',1,'hourlyLimit',3,'copy',jsonb_build_object('en',jsonb_build_object('title','Enquiry','intro','','consent','I consent to contact about this enquiry only.'),'nl',jsonb_build_object('title','Aanvraag','intro','','consent','Ik stem in met contact over deze aanvraag.'),'fr',jsonb_build_object('title','Demande','intro','','consent','Je consens au contact pour cette demande.')));
 f:=public.configure_lead_form(config);
 EXECUTE 'reset role';
 INSERT INTO public.organization_members(org_id,user_id,role) VALUES(o,viewer,'viewer');
 INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(w,viewer,'viewer');
 PERFORM set_config('request.jwt.claims','{"role":"anon"}',true); EXECUTE 'set local role anon';
 visible:=public.public_lead_form('rollback-lead-form');
 IF visible ? 'org_id' OR visible ? 'workspace_id' OR visible ? 'id' OR visible ? 'created_by' THEN RAISE EXCEPTION 'public tenant leak'; END IF;p:=p+1;
 BEGIN PERFORM count(*) FROM public.lead_submissions;RAISE EXCEPTION 'anonymous read accepted';EXCEPTION WHEN insufficient_privilege THEN p:=p+1;END;
 session:=public.open_lead_session('rollback-lead-form');
 payload:=jsonb_build_object('formKey','rollback-lead-form','sessionId',session,'requestId',request,'name','Test person','email','TEST@example.test ','phone','','message','Test enquiry','locale','en','consent',true,'consentText','I consent to contact about this enquiry only.','privacyUrl','https://example.test/privacy','website','','attribution',jsonb_build_object('source','test','medium','test','campaign','test'));
 BEGIN PERFORM public.submit_public_lead(payload);RAISE EXCEPTION 'fast bot accepted';EXCEPTION WHEN OTHERS THEN IF SQLERRM='lead_expired' THEN p:=p+1;ELSE RAISE;END IF;END;
 EXECUTE 'reset role';UPDATE public.lead_sessions SET created_at=now()-interval '10 seconds' WHERE id=session;
 EXECUTE 'set local role anon';
 BEGIN PERFORM public.submit_public_lead(payload||'{"consent":false}');RAISE EXCEPTION 'missing consent accepted';EXCEPTION WHEN OTHERS THEN IF SQLERRM='lead_invalid' THEN p:=p+1;ELSE RAISE;END IF;END;
 BEGIN PERFORM public.submit_public_lead(payload||'{"website":"spam"}');RAISE EXCEPTION 'honeypot accepted';EXCEPTION WHEN OTHERS THEN IF SQLERRM='lead_invalid' THEN p:=p+1;ELSE RAISE;END IF;END;
 BEGIN PERFORM public.submit_public_lead(payload||'{"consentText":"changed"}');RAISE EXCEPTION 'stale consent accepted';EXCEPTION WHEN OTHERS THEN IF SQLERRM='lead_expired' THEN p:=p+1;ELSE RAISE;END IF;END;
 IF NOT public.submit_public_lead(payload) THEN RAISE EXCEPTION 'valid submission failed';END IF;p:=p+1;
 IF NOT public.submit_public_lead(payload) THEN RAISE EXCEPTION 'idempotent retry failed';END IF;p:=p+1;
 BEGIN PERFORM public.submit_public_lead(payload||'{"message":"changed"}');RAISE EXCEPTION 'reused key with changed payload accepted';EXCEPTION WHEN OTHERS THEN IF SQLERRM='lead_invalid' THEN p:=p+1;ELSE RAISE;END IF;END;
 EXECUTE 'reset role';
 SELECT id,contact_id INTO lead,contact FROM public.lead_submissions WHERE form_id=f;
 SELECT count(*) INTO n FROM public.crm_contacts WHERE workspace_id=w AND email='test@example.test';IF n<>1 THEN RAISE EXCEPTION 'CRM not created exactly once';END IF;p:=p+1;
 SELECT count(*) INTO n FROM public.lead_submissions WHERE form_id=f AND consent_text='I consent to contact about this enquiry only.' AND attribution->>'source'='test' AND contact_id=contact;IF n<>1 THEN RAISE EXCEPTION 'consent/source snapshot missing';END IF;p:=p+1;
 BEGIN UPDATE public.lead_submissions SET message='tampered' WHERE id=lead;RAISE EXCEPTION 'history mutable';EXCEPTION WHEN OTHERS THEN IF SQLERRM='lead_history_immutable' THEN p:=p+1;ELSE RAISE;END IF;END;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',viewer,'role','authenticated')::text,true);EXECUTE 'set local role authenticated';
 SELECT count(*) INTO n FROM public.lead_submissions WHERE id=lead;IF n<>1 THEN RAISE EXCEPTION 'viewer cannot read';END IF;p:=p+1;
 BEGIN PERFORM public.qualify_lead(lead,'qualified','Viewer attack');RAISE EXCEPTION 'viewer qualified';EXCEPTION WHEN insufficient_privilege THEN p:=p+1;END;
 BEGIN PERFORM public.configure_lead_form(config);RAISE EXCEPTION 'viewer configured';EXCEPTION WHEN insufficient_privilege THEN p:=p+1;END;
 EXECUTE 'reset role';PERFORM set_config('request.jwt.claims',json_build_object('sub',outsider,'role','authenticated')::text,true);EXECUTE 'set local role authenticated';
 SELECT count(*) INTO n FROM public.lead_submissions WHERE id=lead;IF n<>0 THEN RAISE EXCEPTION 'cross-tenant leak';END IF;p:=p+1;
 BEGIN PERFORM public.prepare_lead_followup(lead,'Attack',NULL);RAISE EXCEPTION 'outsider followup';EXCEPTION WHEN insufficient_privilege THEN p:=p+1;END;
 EXECUTE 'reset role';PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);EXECUTE 'set local role authenticated';
 BEGIN PERFORM public.prepare_lead_followup(lead,'Internal follow-up',NULL);RAISE EXCEPTION 'unqualified followup';EXCEPTION WHEN OTHERS THEN IF SQLERRM='lead_invalid' THEN p:=p+1;ELSE RAISE;END IF;END;
 PERFORM public.qualify_lead(lead,'qualified','Confirmed fit after reviewing the enquiry.');
 task:=public.prepare_lead_followup(lead,'Review requested next step',NULL);
 IF task IS DISTINCT FROM public.prepare_lead_followup(lead,'Review requested next step',NULL) THEN RAISE EXCEPTION 'duplicate follow-up';END IF;p:=p+1;
 SELECT count(*) INTO n FROM public.tasks WHERE id=task AND org_id=o AND workspace_id=w AND status='todo';IF n<>1 THEN RAISE EXCEPTION 'followup not safely scoped';END IF;p:=p+1;
 SELECT count(*) INTO n FROM public.task_runs WHERE task_id=task;IF n<>0 THEN RAISE EXCEPTION 'preparation ran AI';END IF;p:=p+1;
 EXECUTE 'reset role';
 RAISE EXCEPTION 'PUBLIC_LEAD_INTAKE_RESULT pass=% fail=0',p;
END $$;
