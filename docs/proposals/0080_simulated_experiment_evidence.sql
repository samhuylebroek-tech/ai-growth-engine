-- PROPOSED migration 0080 (staging only until approved): simulated experiment results are never evidence.
--
-- Proposal 0079 labelled a controlled test with enough simulated observations as "controlled" evidence. Simulated
-- data exercises the experiment process but says nothing about real customers, so:
--   * growth_experiments.result_data_class records the data class of the observations a result was based on;
--   * move_experiment keeps the outcome the data supports but sets the evidence strength to "inconclusive" when the
--     observations are simulated, so Home, reports, the Growth Officer and organization intelligence never treat it
--     as proof;
--   * evidence_reliability refuses a completed experiment based on simulated data as a measured observation.
-- Backfill: completed experiments get the data class of their latest observation; those based on simulated data are
-- relabelled "inconclusive" (staging QA records only). No history row is written for the backfill because a migration
-- has no acting user and history must not name someone who did not act; the relabel is recorded here and in
-- docs/STAGING_TEST_DATA.md.

ALTER TABLE public.growth_experiments
  ADD COLUMN IF NOT EXISTS result_data_class text CHECK (result_data_class IS NULL OR result_data_class IN ('manual','simulated','imported'));

CREATE TEMP TABLE IF NOT EXISTS _exp_relabel ON COMMIT DROP AS
  SELECT g.id, g.org_id, g.workspace_id, g.evidence_strength AS before, l.data_class
  FROM public.growth_experiments g
  JOIN LATERAL (SELECT data_class FROM public.experiment_observations o WHERE o.experiment_id = g.id ORDER BY created_at DESC, id DESC LIMIT 1) l ON true
  WHERE g.status = 'completed' AND g.result_data_class IS NULL;
UPDATE public.growth_experiments g SET result_data_class = r.data_class,
  evidence_strength = CASE WHEN r.data_class = 'simulated' THEN 'inconclusive' ELSE g.evidence_strength END
  FROM _exp_relabel r WHERE g.id = r.id;
CREATE OR REPLACE FUNCTION public.move_experiment(_experiment uuid, _action text, _data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE x public.growth_experiments%ROWTYPE; ob public.experiment_observations%ROWTYPE; prev text; nxt text; note text;
  controlled boolean; need int; z numeric; pool numeric; vr numeric; cr numeric; strength text; oc text; d date;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO x FROM public.growth_experiments WHERE id = _experiment FOR UPDATE;
  IF NOT FOUND OR NOT public.has_workspace_role(x.workspace_id, 'member') THEN RAISE EXCEPTION 'Experiment unavailable'; END IF;
  _data := coalesce(_data, '{}'::jsonb); note := left(trim(coalesce(_data->>'note','')), 600); prev := x.status;
  controlled := x.method IN ('ab_test','comparison_group');
  IF _action = 'submit_review' THEN
    IF prev <> 'draft' THEN RAISE EXCEPTION 'Only a draft can be sent for review' USING ERRCODE = '55000'; END IF;
    nxt := 'in_review';
  ELSIF _action = 'return_to_draft' THEN
    IF prev NOT IN ('in_review','proposed') THEN RAISE EXCEPTION 'Only a design under review or awaiting approval can go back to draft' USING ERRCODE = '55000'; END IF;
    nxt := 'draft';
  ELSIF _action = 'request_approval' THEN
    IF prev <> 'in_review' THEN RAISE EXCEPTION 'Review the design before requesting approval' USING ERRCODE = '55000'; END IF;
    IF length(trim(x.primary_kpi)) = 0 OR length(trim(x.success_criteria)) = 0 OR length(trim(x.stop_criteria)) = 0 THEN
      RAISE EXCEPTION 'A primary KPI, success criteria and stop criteria are required' USING ERRCODE = '22023';
    END IF;
    IF controlled AND (x.sample_per_group IS NULL OR length(trim(x.control_description)) = 0) THEN
      RAISE EXCEPTION 'A controlled test needs a described control group and a planned sample size' USING ERRCODE = '22023';
    END IF;
    nxt := 'proposed';
  ELSIF _action IN ('approve','reject') THEN
    IF NOT public.has_workspace_role(x.workspace_id, 'admin') THEN RAISE EXCEPTION 'Only an administrator can approve experiments' USING ERRCODE = '42501'; END IF;
    IF prev <> 'proposed' THEN RAISE EXCEPTION 'Only experiments awaiting approval can be decided' USING ERRCODE = '55000'; END IF;
    nxt := CASE WHEN _action = 'approve' THEN 'approved' ELSE 'rejected' END;
  ELSIF _action = 'schedule' THEN
    IF prev <> 'approved' THEN RAISE EXCEPTION 'Only an approved experiment can be scheduled' USING ERRCODE = '55000'; END IF;
    d := nullif(_data->>'start','')::date;
    IF d IS NULL OR d < current_date THEN RAISE EXCEPTION 'Choose a start date from today' USING ERRCODE = '22023'; END IF;
    nxt := 'scheduled';
  ELSIF _action = 'start' THEN
    IF prev NOT IN ('approved','scheduled') THEN RAISE EXCEPTION 'An experiment must be approved before it starts' USING ERRCODE = '55000'; END IF;
    nxt := 'running';
  ELSIF _action = 'pause' THEN
    IF prev NOT IN ('running','collecting') THEN RAISE EXCEPTION 'Only a running experiment can be paused' USING ERRCODE = '55000'; END IF;
    IF length(note) = 0 THEN RAISE EXCEPTION 'Give a reason for pausing' USING ERRCODE = '22023'; END IF;
    nxt := 'paused';
  ELSIF _action = 'resume' THEN
    IF prev <> 'paused' THEN RAISE EXCEPTION 'Only a paused experiment can be resumed' USING ERRCODE = '55000'; END IF;
    nxt := coalesce(x.paused_from, 'running');
  ELSIF _action = 'stop_intervention' THEN
    IF prev <> 'running' THEN RAISE EXCEPTION 'Only a running experiment can stop its intervention' USING ERRCODE = '55000'; END IF;
    nxt := 'collecting';
  ELSIF _action = 'evaluate' THEN
    IF prev NOT IN ('running','collecting') THEN RAISE EXCEPTION 'Only a running experiment can be evaluated' USING ERRCODE = '55000'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.experiment_observations WHERE experiment_id = x.id) THEN
      RAISE EXCEPTION 'Record results before evaluating' USING ERRCODE = '22023';
    END IF;
    nxt := 'evaluating';
  ELSIF _action = 'complete' THEN
    IF prev <> 'evaluating' THEN RAISE EXCEPTION 'Evaluate the experiment before completing it' USING ERRCODE = '55000'; END IF;
    oc := _data->>'outcome';
    IF oc IS NULL OR oc NOT IN ('successful','unsuccessful','inconclusive') THEN RAISE EXCEPTION 'Choose an outcome' USING ERRCODE = '22023'; END IF;
    IF length(trim(coalesce(_data->>'actual_result',''))) = 0 OR length(trim(coalesce(_data->>'conclusion',''))) = 0 THEN
      RAISE EXCEPTION 'Record the actual result and a conclusion' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO ob FROM public.experiment_observations WHERE experiment_id = x.id ORDER BY created_at DESC, id DESC LIMIT 1;
    vr := CASE WHEN ob.variant_n > 0 THEN 100.0 * ob.variant_conversions / ob.variant_n END;
    cr := CASE WHEN ob.control_n > 0 THEN 100.0 * ob.control_conversions / ob.control_n END;
    need := greatest(30, coalesce(x.sample_per_group, 30));
    z := NULL;
    IF ob.variant_n > 0 AND ob.control_n > 0 THEN
      pool := (ob.variant_conversions + ob.control_conversions)::numeric / (ob.variant_n + ob.control_n);
      IF pool > 0 AND pool < 1 THEN
        z := round(((ob.variant_conversions::numeric / ob.variant_n - ob.control_conversions::numeric / ob.control_n)
             / sqrt(pool * (1 - pool) * (1.0 / ob.variant_n + 1.0 / ob.control_n)))::numeric, 2);
      END IF;
    END IF;
    IF controlled THEN
      -- The planned sample must be reached before a result counts: looking early and stopping at a lucky moment is not evidence.
      IF oc = 'successful' AND NOT (ob.variant_n >= need AND ob.control_n >= need AND z IS NOT NULL AND z >= 1.96) THEN
        RAISE EXCEPTION 'The data does not support "successful": it needs the planned sample in both groups and a significant improvement' USING ERRCODE = '22023';
      END IF;
      IF oc = 'unsuccessful' AND NOT ((ob.variant_n >= need AND ob.control_n >= need) OR (z IS NOT NULL AND z <= -1.96 AND ob.variant_n >= 30 AND ob.control_n >= 30)) THEN
        RAISE EXCEPTION 'The data does not support "unsuccessful" yet; record it as inconclusive' USING ERRCODE = '22023';
      END IF;
      strength := CASE WHEN ob.variant_n >= need AND ob.control_n >= need AND z IS NOT NULL AND abs(z) >= 1.96 THEN 'controlled' ELSE 'inconclusive' END;
    ELSE
      strength := CASE WHEN ob.variant_n > 0 THEN 'correlational' ELSE 'inconclusive' END;
    END IF;
    -- Simulated test data exercises the process but is never evidence about the business.
    IF ob.data_class = 'simulated' THEN strength := 'inconclusive'; END IF;
    nxt := 'completed';
  ELSIF _action = 'cancel' THEN
    IF prev IN ('completed','rejected','cancelled') THEN RAISE EXCEPTION 'This experiment is already closed' USING ERRCODE = '55000'; END IF;
    IF length(note) = 0 THEN RAISE EXCEPTION 'Give a reason for cancelling' USING ERRCODE = '22023'; END IF;
    nxt := 'cancelled';
  ELSE
    RAISE EXCEPTION 'Unknown action' USING ERRCODE = '22023';
  END IF;

  UPDATE public.growth_experiments SET status = nxt, updated_at = now(),
    reviewed_by = CASE WHEN _action = 'request_approval' THEN auth.uid() ELSE reviewed_by END,
    decided_by = CASE WHEN _action IN ('approve','reject') THEN auth.uid() ELSE decided_by END,
    decided_at = CASE WHEN _action IN ('approve','reject') THEN now() ELSE decided_at END,
    decision_note = CASE WHEN _action IN ('approve','reject') THEN left(note, 500) ELSE decision_note END,
    scheduled_start = CASE WHEN _action = 'schedule' THEN d ELSE scheduled_start END,
    started_at = CASE WHEN _action = 'start' THEN now() ELSE started_at END,
    paused_from = CASE WHEN _action = 'pause' THEN prev WHEN _action = 'resume' THEN NULL ELSE paused_from END,
    ended_at = CASE WHEN _action IN ('complete','cancel') THEN now() ELSE ended_at END,
    outcome = CASE WHEN _action = 'complete' THEN oc ELSE outcome END,
    result_data_class = CASE WHEN _action = 'complete' THEN ob.data_class ELSE result_data_class END,
    evidence_strength = CASE WHEN _action = 'complete' THEN strength ELSE evidence_strength END,
    z_score = CASE WHEN _action = 'complete' THEN z ELSE z_score END,
    variant_value = CASE WHEN _action = 'complete' THEN round(vr, 2) ELSE variant_value END,
    control_value = CASE WHEN _action = 'complete' THEN round(cr, 2) ELSE control_value END,
    variant_n = CASE WHEN _action = 'complete' THEN ob.variant_n ELSE variant_n END,
    control_n = CASE WHEN _action = 'complete' THEN ob.control_n ELSE control_n END,
    actual_result = CASE WHEN _action = 'complete' THEN left(_data->>'actual_result', 1000) ELSE actual_result END,
    conclusion = CASE WHEN _action = 'complete' THEN left(_data->>'conclusion', 1000) ELSE conclusion END
  WHERE id = x.id RETURNING * INTO x;
  INSERT INTO public.experiment_events(org_id, workspace_id, experiment_id, action, from_status, to_status, note, data)
  VALUES (x.org_id, x.workspace_id, x.id, _action, prev, nxt, note,
    CASE WHEN _action = 'complete' THEN jsonb_build_object('outcome', oc, 'evidence_strength', strength, 'z', z, 'variant_n', ob.variant_n, 'control_n', ob.control_n, 'data_class', ob.data_class)
         WHEN _action = 'schedule' THEN jsonb_build_object('start', d) ELSE '{}'::jsonb END);
  INSERT INTO public.activity_events(org_id, workspace_id, entity_type, entity_id, actor_id, action, metadata)
  VALUES (x.org_id, x.workspace_id, 'experiment', x.id, auth.uid(), 'experiment.' || _action, jsonb_build_object('from', prev, 'to', nxt));
  RETURN jsonb_build_object('experiment_id', x.id, 'status', nxt, 'evidence_strength', x.evidence_strength, 'z', x.z_score);
END;
$$;
REVOKE ALL ON FUNCTION public.move_experiment(uuid,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_experiment(uuid,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.evidence_reliability(_ws uuid, _type text, _kind text, _ref text, _origin text)
RETURNS text LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE rid uuid; k text; ok boolean := false;
BEGIN
  IF _type IS NULL THEN RETURN NULL; END IF;
  IF _type IN ('verified_fact','measured_observation') THEN
    IF _origin = 'ai' THEN RAISE EXCEPTION 'AI output cannot be a fact or a measurement' USING ERRCODE = '23514'; END IF;
    BEGIN rid := _ref::uuid; EXCEPTION WHEN others THEN RAISE EXCEPTION 'This evidence type needs a record of this business' USING ERRCODE = '23514'; END;
    IF _kind = 'business_fact' THEN
      -- only a fact the business confirmed is a verified fact; an unconfirmed fact stays an assumption
      SELECT CASE WHEN verified THEN 'verified' ELSE 'unverified' END INTO k FROM public.business_facts WHERE id = rid AND workspace_id = _ws;
      ok := _type = 'verified_fact' AND k = 'verified';
    ELSIF _kind = 'measurement' THEN
      SELECT kind INTO k FROM public.performance_measurements WHERE id = rid AND workspace_id = _ws;
      ok := (_type = 'verified_fact' AND k IN ('verified_actual','imported_actual')) OR (_type = 'measured_observation' AND k IN ('verified_actual','imported_actual','manual_actual'));
    ELSIF _kind = 'revenue_event' THEN
      SELECT data_class INTO k FROM public.revenue_events WHERE id = rid AND workspace_id = _ws;
      ok := (_type = 'verified_fact' AND k = 'imported') OR (_type = 'measured_observation' AND k IN ('imported','manual'));
    ELSIF _kind = 'competitor_observation' THEN
      SELECT kind INTO k FROM public.competitor_observations WHERE id = rid AND workspace_id = _ws;
      ok := (_type = 'verified_fact' AND k = 'verified_fact') OR (_type = 'measured_observation' AND k IS NOT NULL);
    ELSIF _kind = 'crm_deal' AND _type = 'measured_observation' THEN
      ok := EXISTS (SELECT 1 FROM public.crm_deals WHERE id = rid AND workspace_id = _ws);
    ELSIF _kind = 'experiment' AND _type = 'measured_observation' THEN
      ok := EXISTS (SELECT 1 FROM public.growth_experiments WHERE id = rid AND workspace_id = _ws AND status = 'completed'
                    AND result_data_class IS DISTINCT FROM 'simulated');
    ELSIF _kind = 'budget_line' AND _type = 'measured_observation' THEN
      ok := EXISTS (SELECT 1 FROM public.budget_lines WHERE id = rid AND workspace_id = _ws);
    ELSIF _kind = 'seo_audit' AND _type = 'measured_observation' THEN
      ok := EXISTS (SELECT 1 FROM public.seo_audits WHERE id = rid AND workspace_id = _ws);
    END IF;
    IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'The referenced record does not qualify for this evidence type' USING ERRCODE = '23514'; END IF;
    IF _type = 'verified_fact' THEN RETURN 'high'; END IF;
    RETURN CASE WHEN k IN ('verified_actual','imported_actual','imported') THEN 'high' ELSE 'medium' END;
  END IF;
  RETURN CASE WHEN _type = 'missing_information' THEN 'none' ELSE 'low' END;
END $$;
REVOKE ALL ON FUNCTION public.evidence_reliability(uuid,text,text,text,text) FROM PUBLIC, anon, authenticated;
