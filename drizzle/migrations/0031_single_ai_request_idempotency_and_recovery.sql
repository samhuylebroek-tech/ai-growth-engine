CREATE TABLE public.single_ai_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES public.organizations(id), workspace_id uuid NOT NULL REFERENCES public.workspaces(id), user_id uuid NOT NULL, request_key uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('growth_officer','strategy','research','seo','content')), input jsonb NOT NULL, run_id uuid NOT NULL UNIQUE REFERENCES public.agent_runs(id), conversation_id uuid REFERENCES public.conversations(id), message_id uuid REFERENCES public.messages(id), reply text, credits int, status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','succeeded','failed')), created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 UNIQUE(org_id,workspace_id,user_id,request_key), CHECK(length(input::text)<=20000), CHECK(reply IS NULL OR length(reply)<=100000)
);
GRANT SELECT ON public.single_ai_requests TO authenticated;
GRANT ALL ON public.single_ai_requests TO service_role;
ALTER TABLE public.single_ai_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_single_ai_requests ON public.single_ai_requests FOR SELECT TO authenticated USING(user_id=auth.uid() AND public.has_org_role(org_id,'member') AND public.has_workspace_role(workspace_id,'member') AND public.ws_org(workspace_id)=org_id);
CREATE FUNCTION public.begin_single_ai_request_verified(_org uuid,_workspace uuid,_request uuid,_kind text,_input jsonb,_proof text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.single_ai_requests%ROWTYPE; rid uuid; cid uuid; agent text;
BEGIN
 PERFORM public.verify_ai_accounting(_proof);
 IF auth.uid() IS NULL OR NOT public.has_org_role(_org,'member') OR NOT public.has_workspace_role(_workspace,'member') OR public.ws_org(_workspace) IS DISTINCT FROM _org THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF _request IS NULL OR _kind NOT IN ('growth_officer','strategy','research','seo','content') OR _input IS NULL OR jsonb_typeof(_input)<>'object' OR length(_input::text)>20000 OR length(coalesce(_input->>'request','')) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'invalid request'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=_org FOR UPDATE;
 SELECT * INTO a FROM public.single_ai_requests WHERE org_id=_org AND workspace_id=_workspace AND user_id=auth.uid() AND request_key=_request FOR UPDATE;
 IF a.id IS NOT NULL THEN
  IF a.kind IS DISTINCT FROM _kind OR a.input IS DISTINCT FROM _input THEN RAISE EXCEPTION 'request key belongs to different input'; END IF;
  RETURN to_jsonb(a)||jsonb_build_object('claimed',false);
 END IF;
 IF EXISTS(SELECT 1 FROM public.ai_call_receipts r JOIN public.ai_credit_reservations c USING(run_id) WHERE r.org_id=_org AND c.status='reserved' AND r.state IN ('dispatching','unknown','delivered')) THEN RAISE EXCEPTION 'Recover pending AI work before a new request'; END IF;
 IF EXISTS(SELECT 1 FROM public.single_ai_requests WHERE org_id=_org AND user_id=auth.uid() AND status='running') THEN RAISE EXCEPTION 'Another request is running; recover saved work first'; END IF;
 IF (SELECT count(*) FROM public.single_ai_requests WHERE org_id=_org AND created_at>now()-interval '1 minute')>=6 THEN RAISE EXCEPTION 'Too many requests; wait before starting more work'; END IF;
 IF _kind='growth_officer' AND nullif(_input->>'conversationId','') IS NOT NULL THEN
  cid:=(_input->>'conversationId')::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.conversations WHERE id=cid AND org_id=_org AND workspace_id=_workspace AND user_id=auth.uid()) THEN RAISE EXCEPTION 'conversation unavailable'; END IF;
 END IF;
 agent:=CASE _kind WHEN 'strategy' THEN 'marketing_strategy' WHEN 'research' THEN 'market_research' ELSE _kind END;
 INSERT INTO public.agent_runs(org_id,workspace_id,user_id,agent_key,depth) VALUES(_org,_workspace,auth.uid(),agent,0) RETURNING id INTO rid;
 INSERT INTO public.single_ai_requests(org_id,workspace_id,user_id,request_key,kind,input,run_id,conversation_id) VALUES(_org,_workspace,auth.uid(),_request,_kind,_input,rid,cid) RETURNING * INTO a;
 RETURN to_jsonb(a)||jsonb_build_object('claimed',true);
END $$;
CREATE FUNCTION public.finish_single_ai_request_verified(_id uuid,_reply text,_proof text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.single_ai_requests%ROWTYPE; oid uuid; r public.ai_call_receipts%ROWTYPE; cid uuid; mid uuid; charged int;
BEGIN
 PERFORM public.verify_ai_accounting(_proof);
 SELECT org_id INTO oid FROM public.single_ai_requests WHERE id=_id;
 PERFORM 1 FROM public.organizations WHERE id=oid FOR UPDATE;
 SELECT * INTO a FROM public.single_ai_requests WHERE id=_id FOR UPDATE;
 IF a.id IS NULL OR a.user_id IS DISTINCT FROM auth.uid() OR NOT public.has_org_role(a.org_id,'member') OR NOT public.has_workspace_role(a.workspace_id,'member') THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF a.status='succeeded' THEN RETURN to_jsonb(a); END IF;
 IF _reply IS NULL OR length(_reply) NOT BETWEEN 1 AND 100000 THEN RAISE EXCEPTION 'invalid answer'; END IF;
 SELECT * INTO r FROM public.ai_call_receipts WHERE run_id=a.run_id;
 IF r.state NOT IN ('delivered','settled') OR r.run_id IS NULL THEN RAISE EXCEPTION 'saved paid output required'; END IF;
 charged:=public.reconcile_ai_receipt_verified(a.run_id,_proof);
 cid:=a.conversation_id;
 IF cid IS NULL THEN INSERT INTO public.conversations(org_id,workspace_id,user_id,title) VALUES(a.org_id,a.workspace_id,a.user_id,left(a.kind||': '||(a.input->>'request'),80)) RETURNING id INTO cid; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.conversations WHERE id=cid AND org_id=a.org_id AND workspace_id=a.workspace_id AND user_id=auth.uid()) THEN RAISE EXCEPTION 'conversation unavailable'; END IF;
 INSERT INTO public.messages(org_id,conversation_id,role,content) VALUES(a.org_id,cid,'user',a.input->>'request');
 INSERT INTO public.messages(org_id,conversation_id,role,content) VALUES(a.org_id,cid,'assistant',_reply) RETURNING id INTO mid;
 UPDATE public.agent_runs SET status='succeeded',summary=left(_reply,300),finished_at=now() WHERE id=a.run_id;
 UPDATE public.single_ai_requests SET status='succeeded',conversation_id=cid,message_id=mid,reply=_reply,credits=charged,finished_at=now() WHERE id=a.id RETURNING * INTO a;
 PERFORM public.log_audit(a.org_id,'analysis.single.completed','single_ai_request',a.id::text,jsonb_build_object('kind',a.kind));
 RETURN to_jsonb(a);
END $$;
CREATE FUNCTION public.close_single_ai_request_verified(_id uuid,_proof text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.single_ai_requests%ROWTYPE; oid uuid; r public.ai_call_receipts%ROWTYPE;
BEGIN
 PERFORM public.verify_ai_accounting(_proof);
 SELECT org_id INTO oid FROM public.single_ai_requests WHERE id=_id;
 PERFORM 1 FROM public.organizations WHERE id=oid FOR UPDATE;
 SELECT * INTO a FROM public.single_ai_requests WHERE id=_id FOR UPDATE;
 IF a.id IS NULL OR a.user_id IS DISTINCT FROM auth.uid() OR NOT public.has_org_role(a.org_id,'member') OR NOT public.has_workspace_role(a.workspace_id,'member') THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF a.status<>'running' THEN RETURN a.status; END IF;
 SELECT * INTO r FROM public.ai_call_receipts WHERE run_id=a.run_id;
 IF r.run_id IS NOT NULL AND r.state<>'not_started' THEN RAISE EXCEPTION 'Remote outcome pending; saved output must be recovered, never replayed or refunded'; END IF;
 IF r.run_id IS NULL AND a.created_at>now()-interval '15 minutes' THEN RAISE EXCEPTION 'Request is still active'; END IF;
 IF EXISTS(SELECT 1 FROM public.ai_credit_reservations WHERE run_id=a.run_id AND status='reserved') THEN PERFORM public.refund_ai_credits_verified(a.run_id,_proof); END IF;
 UPDATE public.single_ai_requests SET status='failed',finished_at=now() WHERE id=a.id;
 UPDATE public.agent_runs SET status='failed',error='Request did not dispatch; no replay',finished_at=now() WHERE id=a.run_id;
 RETURN 'failed';
END $$;
REVOKE ALL ON FUNCTION public.begin_single_ai_request_verified(uuid,uuid,uuid,text,jsonb,text), public.finish_single_ai_request_verified(uuid,text,text),public.close_single_ai_request_verified(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.begin_single_ai_request_verified(uuid,uuid,uuid,text,jsonb,text), public.finish_single_ai_request_verified(uuid,text,text),public.close_single_ai_request_verified(uuid,text) TO authenticated;