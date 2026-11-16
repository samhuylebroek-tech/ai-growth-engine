CREATE OR REPLACE FUNCTION public.record_ai_delivery_verified(_run uuid,_key uuid,_text text,_provider text,_model text,_input_tokens int,_output_tokens int,_cost numeric,_actual int,_provider_request_id text,_proof text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.ai_call_receipts%ROWTYPE; ar public.agent_runs%ROWTYPE; oid uuid;
BEGIN
 PERFORM public.verify_ai_accounting(_proof);
 SELECT org_id INTO oid FROM public.ai_call_receipts WHERE run_id=_run;
 PERFORM 1 FROM public.organizations WHERE id=oid FOR UPDATE;
 SELECT * INTO r FROM public.ai_call_receipts WHERE run_id=_run FOR UPDATE;
 SELECT * INTO ar FROM public.agent_runs WHERE id=_run;
 IF auth.uid() IS NULL OR r.run_id IS NULL OR r.user_id IS DISTINCT FROM auth.uid() OR r.dispatch_key IS DISTINCT FROM _key OR ar.id IS NULL OR ar.org_id IS DISTINCT FROM r.org_id OR ar.workspace_id IS DISTINCT FROM r.workspace_id OR ar.user_id IS DISTINCT FROM r.user_id OR public.ws_org(r.workspace_id) IS DISTINCT FROM r.org_id OR NOT EXISTS(SELECT 1 FROM public.ai_credit_reservations WHERE run_id=_run AND org_id=r.org_id AND user_id=r.user_id AND status IN ('reserved','settled')) THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF _text IS NULL OR length(_text)>100000 OR _provider IS NULL OR length(_provider) NOT BETWEEN 1 AND 100 OR _model IS NULL OR length(_model) NOT BETWEEN 1 AND 150 OR _input_tokens IS NULL OR _input_tokens<0 OR _output_tokens IS NULL OR _output_tokens<0 OR _cost IS NULL OR _cost<0 OR _actual IS NULL OR _actual NOT BETWEEN 0 AND 50 OR length(coalesce(_provider_request_id,''))>300 THEN RAISE EXCEPTION 'invalid delivery'; END IF;
 IF r.state IN ('delivered','settled') THEN
  IF r.response_text IS DISTINCT FROM _text OR r.provider IS DISTINCT FROM _provider OR r.model IS DISTINCT FROM _model OR r.input_tokens IS DISTINCT FROM _input_tokens OR r.output_tokens IS DISTINCT FROM _output_tokens OR r.actual_credits IS DISTINCT FROM _actual OR r.cost_estimate_eur IS DISTINCT FROM _cost OR r.provider_request_id IS DISTINCT FROM _provider_request_id THEN RAISE EXCEPTION 'receipt is immutable'; END IF;
  RETURN;
 END IF;
 IF r.state NOT IN ('dispatching','unknown') THEN RAISE EXCEPTION 'delivery outcome is closed'; END IF;
 UPDATE public.ai_call_receipts SET state='delivered',response_text=_text,provider=_provider,model=_model,input_tokens=_input_tokens,output_tokens=_output_tokens,cost_estimate_eur=_cost,actual_credits=_actual,provider_request_id=_provider_request_id,delivered_at=now() WHERE run_id=_run;
END $$;
CREATE OR REPLACE FUNCTION public.record_ai_outcome_verified(_run uuid,_key uuid,_not_started boolean,_ids jsonb,_proof text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.ai_call_receipts%ROWTYPE; ar public.agent_runs%ROWTYPE; oid uuid;
BEGIN
 PERFORM public.verify_ai_accounting(_proof);
 SELECT org_id INTO oid FROM public.ai_call_receipts WHERE run_id=_run;
 PERFORM 1 FROM public.organizations WHERE id=oid FOR UPDATE;
 SELECT * INTO r FROM public.ai_call_receipts WHERE run_id=_run FOR UPDATE;
 SELECT * INTO ar FROM public.agent_runs WHERE id=_run;
 IF auth.uid() IS NULL OR r.run_id IS NULL OR r.user_id IS DISTINCT FROM auth.uid() OR r.dispatch_key IS DISTINCT FROM _key OR ar.id IS NULL OR ar.org_id IS DISTINCT FROM r.org_id OR ar.workspace_id IS DISTINCT FROM r.workspace_id OR ar.user_id IS DISTINCT FROM r.user_id OR public.ws_org(r.workspace_id) IS DISTINCT FROM r.org_id OR NOT EXISTS(SELECT 1 FROM public.ai_credit_reservations WHERE run_id=_run AND org_id=r.org_id AND user_id=r.user_id AND status IN ('reserved','settled')) THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF _not_started IS NULL OR _ids IS NULL OR jsonb_typeof(_ids)<>'object' OR length(_ids::text)>2000 THEN RAISE EXCEPTION 'invalid outcome'; END IF;
 IF r.state IN ('delivered','settled','not_started') THEN RETURN; END IF;
 UPDATE public.ai_call_receipts SET state=CASE WHEN _not_started THEN 'not_started' ELSE 'unknown' END,diagnostic_ids=_ids WHERE run_id=_run;
END $$;
REVOKE ALL ON FUNCTION public.record_ai_delivery_verified(uuid,uuid,text,text,text,int,int,numeric,int,text,text),public.record_ai_outcome_verified(uuid,uuid,boolean,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_ai_delivery_verified(uuid,uuid,text,text,text,int,int,numeric,int,text,text),public.record_ai_outcome_verified(uuid,uuid,boolean,jsonb,text) TO authenticated;