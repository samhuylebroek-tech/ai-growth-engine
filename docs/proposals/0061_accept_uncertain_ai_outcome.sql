-- PROPOSED migration (not in the journal; not applied to the live database). Staging only via
-- scripts/staging/apply-proposal.ts. Idempotent. Depends on migrations 0028–0036.
--
-- An AI call whose provider outcome is unknown (for example a dropped connection) keeps its credit
-- reservation and, by design, blocks new AI dispatch for the whole organization until reconciled.
-- Until now there was no in-app way to reconcile it. This adds one conservative, auditable step:
-- the requesting user, or an organization admin/owner, accepts the reserved credits as used.
-- * Never refunds (the provider may have run and billed); never replays the call; no answer is invented.
-- * Only single requests; coordinated analyses keep their own recovery path.
-- * Requires the server-only accounting proof, so a browser cannot call it directly.

CREATE OR REPLACE FUNCTION public.accept_unknown_ai_outcome_verified(_run uuid, _proof text) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.ai_call_receipts; v public.ai_credit_reservations; oid uuid;
BEGIN
  PERFORM public.verify_ai_accounting(_proof);
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT org_id INTO oid FROM public.ai_call_receipts WHERE run_id = _run;
  IF oid IS NULL THEN RAISE EXCEPTION 'receipt not found'; END IF;
  PERFORM 1 FROM public.organizations WHERE id = oid FOR UPDATE;
  SELECT * INTO r FROM public.ai_call_receipts WHERE run_id = _run FOR UPDATE;
  IF NOT (
    (r.user_id = auth.uid() AND public.has_org_role(r.org_id, 'member') AND public.has_workspace_role(r.workspace_id, 'member'))
    OR public.has_org_role(r.org_id, 'admin')
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.single_ai_requests WHERE run_id = _run) THEN RAISE EXCEPTION 'only single requests can be accepted here'; END IF;
  IF NOT (r.state = 'unknown' OR (r.state = 'dispatching' AND r.lease_expires_at < now())) THEN
    RAISE EXCEPTION 'outcome is not uncertain';
  END IF;
  SELECT * INTO v FROM public.ai_credit_reservations WHERE run_id = _run FOR UPDATE;
  IF v.run_id IS NULL OR v.status <> 'reserved' THEN RAISE EXCEPTION 'credit reservation is closed'; END IF;
  -- The reservation was already deducted; accepting it as used records usage without moving the balance.
  INSERT INTO public.ai_usage_events(org_id, run_id, user_id, provider, model, input_tokens, output_tokens, cost_estimate_eur, credits_charged)
  VALUES (r.org_id, _run, v.user_id, coalesce(r.provider, 'unknown'), coalesce(r.model, 'unknown'), coalesce(r.input_tokens, 0), coalesce(r.output_tokens, 0), coalesce(r.cost_estimate_eur, 0), v.reserved);
  UPDATE public.ai_credit_reservations SET status = 'settled', charged = v.reserved, settled_at = now() WHERE run_id = _run;
  UPDATE public.ai_call_receipts SET state = 'settled', diagnostic_ids = diagnostic_ids || jsonb_build_object('resolution', 'accepted_as_used', 'resolved_by', auth.uid()) WHERE run_id = _run;
  UPDATE public.single_ai_requests SET status = 'failed', finished_at = now() WHERE run_id = _run AND status = 'running';
  UPDATE public.agent_runs SET status = 'failed', error = 'Outcome uncertain; reserved credits accepted as used', finished_at = coalesce(finished_at, now()) WHERE id = _run AND status <> 'succeeded';
  PERFORM public.log_audit(r.org_id, 'ai.outcome.accepted_as_used', 'agent_run', _run::text, jsonb_build_object('credits', v.reserved, 'requested_by', v.user_id));
  RETURN v.reserved;
END $$;
REVOKE ALL ON FUNCTION public.accept_unknown_ai_outcome_verified(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_unknown_ai_outcome_verified(uuid, text) TO authenticated;
