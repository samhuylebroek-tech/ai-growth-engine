REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.ai_call_receipts FROM authenticated,anon;
ALTER TABLE public.coordinated_analyses ADD COLUMN receipt_protocol boolean NOT NULL DEFAULT false;
CREATE FUNCTION public.mark_coordination_receipt_protocol() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN NEW.receipt_protocol:=true; RETURN NEW; END $$;
CREATE TRIGGER coordination_receipt_protocol BEFORE INSERT ON public.coordinated_analyses FOR EACH ROW EXECUTE FUNCTION public.mark_coordination_receipt_protocol();
CREATE OR REPLACE FUNCTION public.recover_coordinated_analysis_verified(_id uuid,_close boolean,_proof text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
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
  ELSIF receipt.run_id IS NULL AND _close AND a.receipt_protocol THEN
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