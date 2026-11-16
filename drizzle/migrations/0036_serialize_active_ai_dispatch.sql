CREATE OR REPLACE FUNCTION public.claim_ai_dispatch_verified(_run uuid,_proof text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.agent_runs%ROWTYPE; a public.coordinated_analyses%ROWTYPE; key uuid; idx int;
BEGIN
 PERFORM public.verify_ai_accounting(_proof);
 SELECT * INTO r FROM public.agent_runs WHERE id=_run;
 IF r.id IS NULL OR auth.uid() IS NULL OR r.user_id IS DISTINCT FROM auth.uid() OR NOT public.has_org_role(r.org_id,'member') OR NOT public.has_workspace_role(r.workspace_id,'member') OR public.ws_org(r.workspace_id) IS DISTINCT FROM r.org_id THEN RAISE EXCEPTION 'forbidden'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=r.org_id FOR UPDATE;
 -- Every entry point shares this organization lock. Recheck access after waiting.
 IF NOT public.has_org_role(r.org_id,'member') OR NOT public.has_workspace_role(r.workspace_id,'member') THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF EXISTS(SELECT 1 FROM public.ai_call_receipts WHERE run_id=_run) THEN RAISE EXCEPTION 'AI dispatch already claimed; never replay'; END IF;
 -- Begin-request checks alone leave a race between independently allocated runs.
 IF EXISTS(SELECT 1 FROM public.ai_call_receipts c JOIN public.ai_credit_reservations v USING(run_id) WHERE c.org_id=r.org_id AND v.status='reserved' AND c.state IN ('dispatching','unknown','delivered')) THEN RAISE EXCEPTION 'Another AI dispatch is unresolved; recover saved work before dispatch'; END IF;
 SELECT * INTO a FROM public.coordinated_analyses WHERE _run=ANY(run_ids) FOR UPDATE;
 IF a.id IS NOT NULL THEN
  IF a.status<>'running' OR a.lease_expires_at<=now() THEN RAISE EXCEPTION 'analysis lease expired; recover before any new request'; END IF;
  idx:=array_position(a.run_ids,_run);
  IF idx>1 AND NOT EXISTS(SELECT 1 FROM public.ai_call_receipts WHERE run_id=a.run_ids[idx-1] AND state='settled') THEN RAISE EXCEPTION 'previous step incomplete'; END IF;
  UPDATE public.coordinated_analyses SET lease_expires_at=now()+interval '15 minutes' WHERE id=a.id;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ai_credit_reservations WHERE run_id=_run AND org_id=r.org_id AND user_id=r.user_id AND status='reserved') THEN RAISE EXCEPTION 'open reservation required'; END IF;
 INSERT INTO public.ai_call_receipts(run_id,org_id,workspace_id,user_id) VALUES(_run,r.org_id,r.workspace_id,r.user_id) RETURNING dispatch_key INTO key;
 RETURN key;
END $$;
REVOKE ALL ON FUNCTION public.claim_ai_dispatch_verified(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.claim_ai_dispatch_verified(uuid,text) TO authenticated;
CREATE INDEX IF NOT EXISTS ai_call_receipts_unresolved_org_idx ON public.ai_call_receipts(org_id,run_id) WHERE state IN ('dispatching','unknown','delivered');