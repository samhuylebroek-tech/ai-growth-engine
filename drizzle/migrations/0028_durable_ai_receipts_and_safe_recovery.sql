CREATE TABLE public.ai_call_receipts (
 run_id uuid PRIMARY KEY REFERENCES public.agent_runs(id), org_id uuid NOT NULL REFERENCES public.organizations(id), workspace_id uuid NOT NULL REFERENCES public.workspaces(id), user_id uuid NOT NULL,
 dispatch_key uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(), state text NOT NULL DEFAULT 'dispatching' CHECK(state IN ('dispatching','delivered','settled','not_started','unknown')),
 lease_expires_at timestamptz NOT NULL DEFAULT (now()+interval '15 minutes'), response_text text, provider text, model text, input_tokens int, output_tokens int, cost_estimate_eur numeric, actual_credits int, provider_request_id text, diagnostic_ids jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), delivered_at timestamptz,
 CHECK(response_text IS NULL OR length(response_text)<=100000), CHECK(input_tokens IS NULL OR input_tokens>=0), CHECK(output_tokens IS NULL OR output_tokens>=0), CHECK(actual_credits IS NULL OR actual_credits BETWEEN 0 AND 50)
);
GRANT SELECT ON public.ai_call_receipts TO authenticated;
GRANT ALL ON public.ai_call_receipts TO service_role;
ALTER TABLE public.ai_call_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_workspace_receipts ON public.ai_call_receipts FOR SELECT TO authenticated USING(user_id=auth.uid() AND public.has_org_role(org_id,'member') AND public.has_workspace_role(workspace_id,'member') AND public.ws_org(workspace_id)=org_id);
ALTER TABLE public.coordinated_analyses ADD COLUMN lease_expires_at timestamptz NOT NULL DEFAULT (now()+interval '15 minutes');
CREATE FUNCTION public.claim_ai_dispatch_verified(_run uuid,_proof text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.agent_runs%ROWTYPE; a public.coordinated_analyses%ROWTYPE; key uuid; idx int;
BEGIN
 PERFORM public.verify_ai_accounting(_proof);
 SELECT * INTO r FROM public.agent_runs WHERE id=_run;
 IF r.id IS NULL OR r.user_id IS DISTINCT FROM auth.uid() OR NOT public.has_org_role(r.org_id,'member') OR NOT public.has_workspace_role(r.workspace_id,'member') THEN RAISE EXCEPTION 'forbidden'; END IF;
 PERFORM 1 FROM public.organizations WHERE id=r.org_id FOR UPDATE;
 SELECT * INTO a FROM public.coordinated_analyses WHERE _run=ANY(run_ids) FOR UPDATE;
 IF a.id IS NOT NULL THEN
  IF a.status<>'running' OR a.lease_expires_at<=now() THEN RAISE EXCEPTION 'analysis lease expired; recover before any new request'; END IF;
  idx:=array_position(a.run_ids,_run);
  IF idx>1 AND NOT EXISTS(SELECT 1 FROM public.ai_call_receipts WHERE run_id=a.run_ids[idx-1] AND state='settled') THEN RAISE EXCEPTION 'previous step incomplete'; END IF;
  UPDATE public.coordinated_analyses SET lease_expires_at=now()+interval '15 minutes' WHERE id=a.id;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ai_credit_reservations WHERE run_id=_run AND status='reserved') THEN RAISE EXCEPTION 'open reservation required'; END IF;
 IF EXISTS(SELECT 1 FROM public.ai_call_receipts WHERE run_id=_run) THEN RAISE EXCEPTION 'AI dispatch already claimed; never replay'; END IF;
 INSERT INTO public.ai_call_receipts(run_id,org_id,workspace_id,user_id) VALUES(_run,r.org_id,r.workspace_id,r.user_id) RETURNING dispatch_key INTO key;
 RETURN key;
END $$;
CREATE FUNCTION public.record_ai_delivery_verified(_run uuid,_key uuid,_text text,_provider text,_model text,_input_tokens int,_output_tokens int,_cost numeric,_actual int,_provider_request_id text,_proof text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.ai_call_receipts%ROWTYPE;
BEGIN
 PERFORM public.verify_ai_accounting(_proof);
 SELECT * INTO r FROM public.ai_call_receipts WHERE run_id=_run FOR UPDATE;
 IF r.run_id IS NULL OR r.user_id IS DISTINCT FROM auth.uid() OR r.dispatch_key IS DISTINCT FROM _key OR NOT public.has_workspace_role(r.workspace_id,'member') OR NOT public.has_org_role(r.org_id,'member') THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF _text IS NULL OR length(_text)>100000 OR _provider IS NULL OR length(_provider) NOT BETWEEN 1 AND 100 OR _model IS NULL OR length(_model) NOT BETWEEN 1 AND 150 OR _input_tokens IS NULL OR _input_tokens<0 OR _output_tokens IS NULL OR _output_tokens<0 OR _cost IS NULL OR _cost<0 OR _actual IS NULL OR _actual NOT BETWEEN 0 AND 50 OR length(coalesce(_provider_request_id,''))>300 THEN RAISE EXCEPTION 'invalid delivery'; END IF;
 IF r.state IN ('delivered','settled') THEN
  IF r.response_text IS DISTINCT FROM _text OR r.provider IS DISTINCT FROM _provider OR r.model IS DISTINCT FROM _model OR r.input_tokens IS DISTINCT FROM _input_tokens OR r.output_tokens IS DISTINCT FROM _output_tokens OR r.actual_credits IS DISTINCT FROM _actual OR r.cost_estimate_eur IS DISTINCT FROM _cost OR r.provider_request_id IS DISTINCT FROM _provider_request_id THEN RAISE EXCEPTION 'receipt is immutable'; END IF;
  RETURN;
 END IF;
 IF r.state NOT IN ('dispatching','unknown') THEN RAISE EXCEPTION 'delivery outcome is closed'; END IF;
 UPDATE public.ai_call_receipts SET state='delivered',response_text=_text,provider=_provider,model=_model,input_tokens=_input_tokens,output_tokens=_output_tokens,cost_estimate_eur=_cost,actual_credits=_actual,provider_request_id=_provider_request_id,delivered_at=now() WHERE run_id=_run;
END $$;
CREATE FUNCTION public.record_ai_outcome_verified(_run uuid,_key uuid,_not_started boolean,_ids jsonb,_proof text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.ai_call_receipts%ROWTYPE;
BEGIN
 PERFORM public.verify_ai_accounting(_proof);
 SELECT * INTO r FROM public.ai_call_receipts WHERE run_id=_run FOR UPDATE;
 IF r.run_id IS NULL OR r.user_id IS DISTINCT FROM auth.uid() OR r.dispatch_key IS DISTINCT FROM _key OR NOT public.has_workspace_role(r.workspace_id,'member') OR NOT public.has_org_role(r.org_id,'member') THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF _not_started IS NULL OR _ids IS NULL OR jsonb_typeof(_ids)<>'object' OR length(_ids::text)>2000 THEN RAISE EXCEPTION 'invalid outcome'; END IF;
 IF r.state IN ('delivered','settled','not_started') THEN RETURN; END IF;
 UPDATE public.ai_call_receipts SET state=CASE WHEN _not_started THEN 'not_started' ELSE 'unknown' END,diagnostic_ids=_ids WHERE run_id=_run;
END $$;
CREATE FUNCTION public.reconcile_ai_receipt_verified(_run uuid,_proof text) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.ai_call_receipts%ROWTYPE; oid uuid; charged int; a public.coordinated_analyses%ROWTYPE; idx int;
BEGIN
 PERFORM public.verify_ai_accounting(_proof);
 SELECT org_id INTO oid FROM public.ai_call_receipts WHERE run_id=_run;
 PERFORM 1 FROM public.organizations WHERE id=oid FOR UPDATE;
 SELECT * INTO a FROM public.coordinated_analyses WHERE _run=ANY(run_ids) FOR UPDATE;
 SELECT * INTO r FROM public.ai_call_receipts WHERE run_id=_run FOR UPDATE;
 IF r.run_id IS NULL OR r.user_id IS DISTINCT FROM auth.uid() OR NOT public.has_workspace_role(r.workspace_id,'member') OR NOT public.has_org_role(r.org_id,'member') THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF r.state='not_started' THEN PERFORM public.refund_ai_credits(_run); RETURN 0; END IF;
 IF r.state NOT IN ('delivered','settled') THEN RAISE EXCEPTION 'remote outcome unknown; reservation retained'; END IF;
 charged:=public.settle_ai_credits(_run,r.actual_credits,r.provider,r.model,r.input_tokens,r.output_tokens,r.cost_estimate_eur);
 UPDATE public.ai_call_receipts SET state='settled' WHERE run_id=_run;
 IF a.id IS NOT NULL THEN
  idx:=array_position(a.run_ids,_run)-1;
  IF a.partial_results ? idx::text AND a.partial_results->>idx::text IS DISTINCT FROM r.response_text THEN RAISE EXCEPTION 'analysis checkpoint is immutable'; END IF;
  UPDATE public.coordinated_analyses SET partial_results=jsonb_set(partial_results,ARRAY[idx::text],to_jsonb(r.response_text),true) WHERE id=a.id;
 END IF;
 RETURN charged;
END $$;
CREATE FUNCTION public.recover_coordinated_analysis_verified(_id uuid,_close boolean,_proof text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.coordinated_analyses%ROWTYPE; oid uuid; rid uuid; receipt public.ai_call_receipts%ROWTYPE; pending int:=0;
BEGIN
 PERFORM public.verify_ai_accounting(_proof);
 SELECT org_id INTO oid FROM public.coordinated_analyses WHERE id=_id;
 PERFORM 1 FROM public.organizations WHERE id=oid FOR UPDATE;
 SELECT * INTO a FROM public.coordinated_analyses WHERE id=_id FOR UPDATE;
 IF a.id IS NULL OR a.user_id IS DISTINCT FROM auth.uid() OR NOT public.has_workspace_role(a.workspace_id,'member') OR NOT public.has_org_role(a.org_id,'member') THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF a.status='succeeded' THEN RETURN jsonb_build_object('status',a.status,'pending',0); END IF;
 IF _close AND a.status='running' AND a.lease_expires_at>now() THEN RAISE EXCEPTION 'analysis is still leased; try recovery after fifteen minutes without activity'; END IF;
 FOREACH rid IN ARRAY a.run_ids LOOP
  SELECT * INTO receipt FROM public.ai_call_receipts WHERE run_id=rid FOR UPDATE;
  IF receipt.state IN ('delivered','settled','not_started') THEN PERFORM public.reconcile_ai_receipt_verified(rid,_proof);
  ELSIF receipt.run_id IS NULL AND _close THEN
   IF EXISTS(SELECT 1 FROM public.ai_credit_reservations WHERE run_id=rid AND status='reserved') THEN PERFORM public.refund_ai_credits(rid); END IF;
  ELSE
   IF receipt.run_id IS NOT NULL AND _close THEN UPDATE public.ai_call_receipts SET state='unknown' WHERE run_id=rid AND state='dispatching'; END IF;
   IF EXISTS(SELECT 1 FROM public.ai_credit_reservations WHERE run_id=rid AND status='reserved') THEN pending:=pending+1; END IF;
  END IF;
 END LOOP;
 SELECT * INTO a FROM public.coordinated_analyses WHERE id=_id;
 IF a.status='running' AND a.partial_results ?& ARRAY['0','1','2'] AND (SELECT count(*) FROM public.ai_credit_reservations WHERE run_id=ANY(a.run_ids) AND status='settled')=3 THEN RETURN jsonb_build_object('status','ready','pending',pending); END IF;
 IF _close AND a.status='running' THEN
  UPDATE public.coordinated_analyses SET status='failed',error=CASE WHEN pending>0 THEN 'Interrupted; remote outcome requires investigation. Reserved credits retained.' ELSE 'Interrupted; completed work retained and unused credits returned.' END,finished_at=now() WHERE id=_id;
  UPDATE public.agent_runs SET status='failed',error='Interrupted; check saved receipts',finished_at=now() WHERE id=ANY(a.run_ids) AND status='running';
  PERFORM public.log_audit(a.org_id,'analysis.coordination.recovered','coordinated_analysis',a.id::text,jsonb_build_object('pending_outcomes',pending));
 END IF;
 RETURN jsonb_build_object('status',CASE WHEN _close THEN 'failed' ELSE a.status END,'pending',pending);
END $$;
CREATE OR REPLACE FUNCTION public.refund_ai_credits_verified(_run uuid,_proof text) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM public.verify_ai_accounting(_proof);
 IF EXISTS(SELECT 1 FROM public.ai_call_receipts WHERE run_id=_run AND state<>'not_started') THEN RAISE EXCEPTION 'remote outcome requires reconciliation; no refund'; END IF;
 RETURN public.refund_ai_credits(_run);
END $$;
CREATE OR REPLACE FUNCTION public.fail_coordinated_analysis_verified(_id uuid,_error text,_proof text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.coordinated_analyses%ROWTYPE; rid uuid; oid uuid;
BEGIN
 PERFORM public.verify_ai_accounting(_proof);
 SELECT org_id INTO oid FROM public.coordinated_analyses WHERE id=_id;
 PERFORM 1 FROM public.organizations WHERE id=oid FOR UPDATE;
 SELECT * INTO a FROM public.coordinated_analyses WHERE id=_id FOR UPDATE;
 IF a.id IS NULL OR a.user_id IS DISTINCT FROM auth.uid() OR NOT public.has_workspace_role(a.workspace_id,'member') OR NOT public.has_org_role(a.org_id,'member') THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF a.status<>'running' THEN RETURN; END IF;
 FOREACH rid IN ARRAY a.run_ids LOOP
  IF EXISTS(SELECT 1 FROM public.ai_call_receipts WHERE run_id=rid AND state IN ('dispatching','unknown','delivered')) THEN RETURN; END IF;
 END LOOP;
 FOREACH rid IN ARRAY a.run_ids LOOP
  IF EXISTS(SELECT 1 FROM public.ai_credit_reservations WHERE run_id=rid AND status='reserved') THEN PERFORM public.refund_ai_credits_verified(rid,_proof); END IF;
 END LOOP;
 UPDATE public.agent_runs SET status='failed',error=left(_error,200),finished_at=now() WHERE id=ANY(a.run_ids) AND status='running';
 UPDATE public.coordinated_analyses SET status='failed',error=left(_error,200),finished_at=now() WHERE id=_id;
 PERFORM public.log_audit(a.org_id,'analysis.coordination.failed','coordinated_analysis',a.id::text,jsonb_build_object('error',left(_error,200)));
END $$;
REVOKE ALL ON FUNCTION public.claim_ai_dispatch_verified(uuid,text),public.record_ai_delivery_verified(uuid,uuid,text,text,text,int,int,numeric,int,text,text),public.record_ai_outcome_verified(uuid,uuid,boolean,jsonb,text),public.reconcile_ai_receipt_verified(uuid,text),public.recover_coordinated_analysis_verified(uuid,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.claim_ai_dispatch_verified(uuid,text),public.record_ai_delivery_verified(uuid,uuid,text,text,text,int,int,numeric,int,text,text),public.record_ai_outcome_verified(uuid,uuid,boolean,jsonb,text),public.reconcile_ai_receipt_verified(uuid,text),public.recover_coordinated_analysis_verified(uuid,boolean,text) TO authenticated;