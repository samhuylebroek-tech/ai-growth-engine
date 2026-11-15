CREATE OR REPLACE FUNCTION public.settle_ai_credits(_run uuid, _actual int, _provider text, _model text, _input_tokens int, _output_tokens int, _cost_estimate_eur numeric) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE res public.ai_credit_reservations%ROWTYPE; oid uuid; bal int; extra int; final_charge int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _actual < 0 OR _actual > 1000 OR _input_tokens < 0 OR _output_tokens < 0 OR _cost_estimate_eur < 0 THEN RAISE EXCEPTION 'invalid usage'; END IF;
  IF length(_provider) NOT BETWEEN 1 AND 100 OR length(_model) NOT BETWEEN 1 AND 150 THEN RAISE EXCEPTION 'invalid provider usage'; END IF;
  SELECT org_id INTO oid FROM public.ai_credit_reservations WHERE run_id = _run;
  IF oid IS NULL THEN RAISE EXCEPTION 'credit reservation not found'; END IF;
  PERFORM 1 FROM public.organizations WHERE id = oid FOR UPDATE;
  SELECT * INTO res FROM public.ai_credit_reservations WHERE run_id = _run FOR UPDATE;
  IF res.user_id <> auth.uid() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF res.status = 'settled' THEN RETURN res.charged; END IF;
  IF res.status <> 'reserved' THEN RAISE EXCEPTION 'credit reservation is closed'; END IF;
  final_charge := _actual;
  IF final_charge >= res.reserved THEN
    extra := final_charge - res.reserved;
    bal := GREATEST(public.credit_balance(oid),0);
    IF bal < extra THEN extra := bal; final_charge := res.reserved + extra; END IF;
    IF extra > 0 THEN INSERT INTO public.credit_ledger(org_id,delta,reason,ref,created_by) VALUES(oid,-extra,'usage',left('run:'||_run::text||':settle',100),auth.uid()); END IF;
  ELSE
    INSERT INTO public.credit_ledger(org_id,delta,reason,ref,created_by) VALUES(oid,res.reserved-final_charge,'refund',left('run:'||_run::text||':settle',100),auth.uid());
  END IF;
  INSERT INTO public.ai_usage_events(org_id,run_id,user_id,provider,model,input_tokens,output_tokens,cost_estimate_eur,credits_charged) VALUES(oid,_run,auth.uid(),_provider,_model,_input_tokens,_output_tokens,_cost_estimate_eur,final_charge);
  UPDATE public.ai_credit_reservations SET status='settled',charged=final_charge,settled_at=now() WHERE run_id=_run;
  RETURN final_charge;
END $$;
REVOKE ALL ON FUNCTION public.settle_ai_credits(uuid,int,text,text,int,int,numeric) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.settle_ai_credits(uuid,int,text,text,int,int,numeric) TO authenticated;