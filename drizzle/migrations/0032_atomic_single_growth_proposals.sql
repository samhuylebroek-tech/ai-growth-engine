ALTER TABLE public.single_ai_requests ADD COLUMN proposals_saved boolean NOT NULL DEFAULT false;
CREATE FUNCTION public.finish_growth_request_verified(_id uuid,_reply text,_proposals jsonb,_proof text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.single_ai_requests%ROWTYPE; result jsonb; p jsonb; n int:=0;
BEGIN
 PERFORM public.verify_ai_accounting(_proof);
 IF _proposals IS NULL OR jsonb_typeof(_proposals)<>'array' OR jsonb_array_length(_proposals)>3 THEN RAISE EXCEPTION 'invalid proposals'; END IF;
 result:=public.finish_single_ai_request_verified(_id,_reply,_proof);
 SELECT * INTO a FROM public.single_ai_requests WHERE id=_id FOR UPDATE;
 IF a.kind<>'growth_officer' THEN RAISE EXCEPTION 'wrong request kind'; END IF;
 IF NOT a.proposals_saved THEN
  FOR p IN SELECT value FROM jsonb_array_elements(_proposals) LOOP
   IF p->>'capability' NOT IN ('content.publish','ads.adjust_budget','email.send_campaign','crm.create_lead','strategy.recommend') OR length(coalesce(p->>'title','')) NOT BETWEEN 3 AND 200 OR coalesce(p->>'risk','medium') NOT IN ('low','medium','high') THEN RAISE EXCEPTION 'invalid capability proposal'; END IF;
   IF NOT EXISTS(SELECT 1 FROM public.policies WHERE org_id=a.org_id AND capability_key=p->>'capability' AND mode='blocked') THEN
    INSERT INTO public.approvals(org_id,workspace_id,run_id,capability_key,title,reasoning,expected_impact,risk,requested_by,payload) VALUES(a.org_id,a.workspace_id,a.run_id,p->>'capability',p->>'title',left(p->>'reasoning',2000),left(p->>'expected_impact',1000),coalesce(p->>'risk','medium'),a.user_id,jsonb_build_object('source','growth_officer','capability_status',CASE WHEN p->>'capability'='strategy.recommend' THEN 'implemented' ELSE 'planned' END));
   END IF;
  END LOOP;
  UPDATE public.single_ai_requests SET proposals_saved=true WHERE id=a.id;
 END IF;
 SELECT count(*) INTO n FROM public.approvals WHERE run_id=a.run_id;
 RETURN result||jsonb_build_object('proposals',n);
END $$;
REVOKE ALL ON FUNCTION public.finish_growth_request_verified(uuid,text,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.finish_growth_request_verified(uuid,text,jsonb,text) TO authenticated;