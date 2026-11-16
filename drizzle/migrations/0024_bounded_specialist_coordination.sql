CREATE TABLE public.coordinated_analyses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES public.organizations(id), workspace_id uuid NOT NULL REFERENCES public.workspaces(id), user_id uuid NOT NULL REFERENCES public.profiles(user_id), request_key uuid NOT NULL, input jsonb NOT NULL, status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','succeeded','failed')), run_ids uuid[] NOT NULL, conversation_id uuid REFERENCES public.conversations(id), message_id uuid, error text, created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, UNIQUE(org_id,workspace_id,user_id,request_key)
);
GRANT SELECT ON public.coordinated_analyses TO authenticated;
GRANT ALL ON public.coordinated_analyses TO service_role;
ALTER TABLE public.coordinated_analyses ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_scoped_analysis ON public.coordinated_analyses FOR SELECT TO authenticated USING(user_id=auth.uid() AND public.has_workspace_role(workspace_id,'member') AND org_id=public.ws_org(workspace_id));
CREATE INDEX coordinated_analysis_history ON public.coordinated_analyses(org_id,workspace_id,user_id,created_at DESC);
CREATE FUNCTION public.begin_coordinated_analysis(_org uuid,_workspace uuid,_request uuid,_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.coordinated_analyses%ROWTYPE; keys text[]; k text; rid uuid; ids uuid[]:='{}'; recent int;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_org_role(_org,'member') OR NOT public.has_workspace_role(_workspace,'member') OR public.ws_org(_workspace) IS DISTINCT FROM _org THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF jsonb_typeof(_input->'agents') IS DISTINCT FROM 'array' OR jsonb_typeof(_input->'executionContext') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid coordinated input'; END IF;
 SELECT array_agg(value) INTO keys FROM jsonb_array_elements_text(_input->'agents');
 IF cardinality(keys) IS DISTINCT FROM 2 OR keys[1]=keys[2] OR NOT keys <@ ARRAY['strategy','research','seo','content']::text[] OR length(_input->>'request') NOT BETWEEN 3 AND 4000 OR jsonb_array_length(_input->'executionContext')>12 THEN RAISE EXCEPTION 'invalid coordinated input'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=_org FOR UPDATE;
 SELECT * INTO a FROM public.coordinated_analyses WHERE org_id=_org AND workspace_id=_workspace AND user_id=auth.uid() AND request_key=_request;
 IF a.id IS NOT NULL THEN
  IF a.input IS DISTINCT FROM _input THEN RAISE EXCEPTION 'request key already used for different input'; END IF;
  RETURN jsonb_build_object('claimed',false,'id',a.id,'status',a.status,'conversationId',a.conversation_id,'messageId',a.message_id,'error',a.error);
 END IF;
 IF EXISTS(SELECT 1 FROM public.coordinated_analyses WHERE org_id=_org AND status='running') THEN RAISE EXCEPTION 'Another coordinated analysis is still running in this organization.'; END IF;
 SELECT count(*) INTO recent FROM public.coordinated_analyses WHERE org_id=_org AND created_at>now()-interval '1 minute';
 IF recent>=3 THEN RAISE EXCEPTION 'Please wait a minute before starting another coordinated analysis.'; END IF;
 PERFORM public.ensure_monthly_credit_grant(_org);
 FOREACH k IN ARRAY (keys||ARRAY['growth_officer']) LOOP
  INSERT INTO public.agent_runs(org_id,workspace_id,user_id,agent_key,depth) VALUES(_org,_workspace,auth.uid(),CASE k WHEN 'strategy' THEN 'marketing_strategy' WHEN 'research' THEN 'market_research' ELSE k END,CASE WHEN k='growth_officer' THEN 0 ELSE 1 END) RETURNING id INTO rid;
  PERFORM public.reserve_ai_credits(rid,50); ids:=array_append(ids,rid);
 END LOOP;
 INSERT INTO public.coordinated_analyses(org_id,workspace_id,user_id,request_key,input,run_ids) VALUES(_org,_workspace,auth.uid(),_request,_input,ids) RETURNING * INTO a;
 PERFORM public.log_audit(_org,'analysis.coordination.started','coordinated_analysis',a.id::text,jsonb_build_object('agents',keys,'max_calls',3,'reserved_credits',150));
 RETURN jsonb_build_object('claimed',true,'id',a.id,'runIds',ids,'status',a.status);
END $$;
REVOKE ALL ON FUNCTION public.begin_coordinated_analysis(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.begin_coordinated_analysis(uuid,uuid,uuid,jsonb) TO authenticated;
CREATE FUNCTION public.finish_coordinated_analysis(_id uuid,_reply text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.coordinated_analyses%ROWTYPE; cid uuid; mid uuid; charged int;
BEGIN
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
REVOKE ALL ON FUNCTION public.finish_coordinated_analysis(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.finish_coordinated_analysis(uuid,text) TO authenticated;
CREATE FUNCTION public.fail_coordinated_analysis(_id uuid,_error text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.coordinated_analyses%ROWTYPE; rid uuid;
BEGIN
 SELECT org_id INTO a.org_id FROM public.coordinated_analyses WHERE id=_id;
 PERFORM 1 FROM public.organizations WHERE id=a.org_id FOR UPDATE;
 SELECT * INTO a FROM public.coordinated_analyses WHERE id=_id FOR UPDATE;
 IF a.id IS NULL OR a.user_id<>auth.uid() THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF a.status<>'running' THEN RETURN; END IF;
 FOREACH rid IN ARRAY a.run_ids LOOP
  IF EXISTS(SELECT 1 FROM public.ai_credit_reservations WHERE run_id=rid AND status='reserved') THEN PERFORM public.refund_ai_credits(rid); END IF;
 END LOOP;
 UPDATE public.agent_runs SET status='failed',error=left(_error,200),finished_at=now() WHERE id=ANY(a.run_ids) AND status='running';
 UPDATE public.coordinated_analyses SET status='failed',error=left(_error,200),finished_at=now() WHERE id=a.id;
 PERFORM public.log_audit(a.org_id,'analysis.coordination.failed','coordinated_analysis',a.id::text,jsonb_build_object('error',left(_error,200)));
END $$;
REVOKE ALL ON FUNCTION public.fail_coordinated_analysis(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fail_coordinated_analysis(uuid,text) TO authenticated;