REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.coordinated_analyses FROM authenticated,anon;
CREATE OR REPLACE FUNCTION public.finish_coordinated_analysis(_id uuid,_reply text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.coordinated_analyses%ROWTYPE; cid uuid; mid uuid; charged int; oid uuid;
BEGIN
 SELECT org_id INTO oid FROM public.coordinated_analyses WHERE id=_id;
 IF oid IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=oid FOR UPDATE;
 SELECT * INTO a FROM public.coordinated_analyses WHERE id=_id FOR UPDATE;
 IF a.id IS NULL OR a.user_id<>auth.uid() OR NOT public.has_workspace_role(a.workspace_id,'member') OR NOT public.has_org_role(a.org_id,'member') THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF a.status='succeeded' THEN RETURN jsonb_build_object('conversationId',a.conversation_id,'messageId',a.message_id); END IF;
 IF a.status<>'running' OR length(_reply) NOT BETWEEN 1 AND 80000 THEN RAISE EXCEPTION 'analysis cannot be completed'; END IF;
 IF (SELECT count(*) FROM public.ai_credit_reservations WHERE run_id=ANY(a.run_ids) AND status='settled')<>3 THEN RAISE EXCEPTION 'analysis usage incomplete'; END IF;
 INSERT INTO public.conversations(org_id,workspace_id,user_id,title) VALUES(a.org_id,a.workspace_id,a.user_id,left('Coordinated: '||(a.input->>'request'),80)) RETURNING id INTO cid;
 INSERT INTO public.messages(org_id,conversation_id,role,content) VALUES(a.org_id,cid,'user',a.input->>'request');
 INSERT INTO public.messages(org_id,conversation_id,role,content) VALUES(a.org_id,cid,'assistant',_reply) RETURNING id INTO mid;
 UPDATE public.agent_runs SET status='succeeded',summary=CASE WHEN id=a.run_ids[3] THEN left('Coordinated analysis: '||(a.input->>'request'),300) ELSE summary END,finished_at=now() WHERE id=ANY(a.run_ids);
 UPDATE public.coordinated_analyses SET status='succeeded',conversation_id=cid,message_id=mid,finished_at=now() WHERE id=a.id;
 SELECT sum(credits_charged) INTO charged FROM public.ai_usage_events WHERE run_id=ANY(a.run_ids);
 PERFORM public.log_audit(a.org_id,'analysis.coordination.completed','coordinated_analysis',a.id::text,jsonb_build_object('conversation_id',cid,'credits',charged));
 RETURN jsonb_build_object('conversationId',cid,'messageId',mid,'credits',charged);
END $$;