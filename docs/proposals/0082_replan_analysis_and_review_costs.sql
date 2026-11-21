-- PROPOSED migration 0082 (staging only until approved): AI re-planning analysis and second-review costs.
--
-- 1. Second reviews (0081) are now bound to exactly the paid request that produced them (same request key, purpose and
--    run; one review per request) and keep that request's charged credits, so reports can include review costs
--    without reading anyone's private request history.
-- 2. AI re-planning analysis: one metered Growth Officer analysis attached to an open re-planning proposal (0077).
--    It explains cause, consequences, affected tasks, an assessment of each option and a recommendation, but never
--    changes a task: an editor still decides through decide_task_replan. Insert-only; the task's last change at
--    analysis time is kept so the screen can say when an analysis is out of date.

-- 1. Review costs and binding -------------------------------------------------------------------------------------
ALTER TABLE public.specialist_reviews ADD COLUMN IF NOT EXISTS credits int CHECK (credits IS NULL OR credits >= 0);
-- One-time backfill of the new column only; the insert-only guard is suspended for this statement and restored at once.
ALTER TABLE public.specialist_reviews DISABLE TRIGGER specialist_reviews_immutable;
UPDATE public.specialist_reviews r SET credits = q.credits
  FROM public.single_ai_requests q WHERE q.id = r.single_request_id AND r.credits IS NULL;
ALTER TABLE public.specialist_reviews ENABLE TRIGGER specialist_reviews_immutable;
CREATE UNIQUE INDEX IF NOT EXISTS specialist_reviews_one_per_request ON public.specialist_reviews (single_request_id);

CREATE OR REPLACE FUNCTION public.record_specialist_review_verified(_run uuid, _request uuid, _reviewer text, _single uuid, _review jsonb, _proof text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.task_runs%ROWTYPE; q public.single_ai_requests%ROWTYPE; x public.specialist_reviews%ROWTYPE;
  dims jsonb := '{}'::jsonb; k text; v jsonb; sc int; n int := 0; total int := 0; f jsonb; fs jsonb := '[]'::jsonb; crit int := 0; serious int := 0; s int; verdict text; indep boolean;
BEGIN
  PERFORM public.verify_ai_accounting(_proof);
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO r FROM public.task_runs WHERE id = _run;
  IF NOT FOUND OR NOT public.has_workspace_role(r.workspace_id, 'member') THEN RAISE EXCEPTION 'Run unavailable'; END IF;
  SELECT * INTO x FROM public.specialist_reviews WHERE workspace_id = r.workspace_id AND request_key = _request;
  IF FOUND THEN RETURN to_jsonb(x) || jsonb_build_object('status', 'existing'); END IF;
  IF r.status <> 'succeeded' THEN RAISE EXCEPTION 'Only a finished result can be reviewed' USING ERRCODE = '55000'; END IF;
  IF _reviewer = r.specialist_key THEN RAISE EXCEPTION 'A second review needs a different specialist' USING ERRCODE = '22023'; END IF;
  SELECT * INTO q FROM public.single_ai_requests WHERE id = _single;
  IF NOT FOUND OR q.workspace_id <> r.workspace_id OR q.user_id <> auth.uid() OR q.status <> 'succeeded'
     OR q.request_key <> _request OR q.input->>'purpose' IS DISTINCT FROM 'specialist_review' OR q.input->>'taskRunId' IS DISTINCT FROM r.id::text
     OR q.input->>'reviewer' IS DISTINCT FROM _reviewer THEN
    RAISE EXCEPTION 'The review must come from the finished, paid review request for this result' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(_review->'dimensions') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid review' USING ERRCODE = '22023'; END IF;
  FOR k, v IN SELECT * FROM jsonb_each(_review->'dimensions') LOOP
    IF k NOT IN ('completeness','relevance','evidence','calculations','consistency','feasibility','financial_assumptions','alignment','permissions','quality') THEN
      RAISE EXCEPTION 'Unknown review dimension %', k USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v->'score') = 'null' OR v->'score' IS NULL THEN CONTINUE; END IF;
    sc := (v->>'score')::int;
    IF sc NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Scores run from 1 to 5' USING ERRCODE = '22023'; END IF;
    dims := dims || jsonb_build_object(k, jsonb_build_object('score', sc, 'note', left(coalesce(v->>'note',''), 400)));
    n := n + 1; total := total + sc;
  END LOOP;
  IF n < 6 THEN RAISE EXCEPTION 'A review must assess at least six dimensions' USING ERRCODE = '22023'; END IF;
  FOR f IN SELECT * FROM jsonb_array_elements(coalesce(_review->'findings', '[]'::jsonb)) LOOP
    IF coalesce(f->>'severity','') NOT IN ('info','warning','critical') OR length(trim(coalesce(f->>'finding',''))) = 0 THEN
      RAISE EXCEPTION 'Invalid finding' USING ERRCODE = '22023';
    END IF;
    fs := fs || jsonb_build_array(jsonb_build_object('dimension', left(coalesce(f->>'dimension',''), 40), 'severity', f->>'severity',
      'finding', left(f->>'finding', 500), 'correction', left(coalesce(f->>'correction',''), 500)));
    IF f->>'severity' = 'critical' THEN crit := crit + 1; END IF;
    IF f->>'severity' IN ('warning','critical') THEN serious := serious + 1; END IF;
  END LOOP;
  IF jsonb_array_length(fs) > 20 THEN RAISE EXCEPTION 'At most 20 findings' USING ERRCODE = '22023'; END IF;
  s := round((total::numeric / n - 1) / 4 * 100);
  indep := total = 5 * n AND serious = 0;
  verdict := CASE WHEN s < 50 OR crit >= 2 THEN 'unreliable' WHEN crit >= 1 OR s < 70 OR indep THEN 'needs_changes' ELSE 'acceptable' END;
  INSERT INTO public.specialist_reviews(org_id, workspace_id, task_run_id, request_key, original_specialist, reviewer_specialist, single_request_id,
    dimensions, findings, summary, assessed, score, critical, verdict, independence_warning, credits)
  VALUES (r.org_id, r.workspace_id, r.id, _request, r.specialist_key, _reviewer, q.id, dims, fs, left(coalesce(_review->>'summary',''), 1500), n, s, crit, verdict, indep, q.credits)
  RETURNING * INTO x;
  INSERT INTO public.activity_events(org_id, workspace_id, entity_type, entity_id, actor_id, action, metadata)
  VALUES (r.org_id, r.workspace_id, 'task', r.task_id, auth.uid(), 'specialist.reviewed', jsonb_build_object('run', r.id, 'reviewer', _reviewer, 'score', s, 'verdict', verdict));
  RETURN to_jsonb(x) || jsonb_build_object('status', 'created');
END;
$$;
REVOKE ALL ON FUNCTION public.record_specialist_review_verified(uuid,uuid,text,uuid,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_specialist_review_verified(uuid,uuid,text,uuid,jsonb,text) TO authenticated;

-- 2. AI re-planning analysis --------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.task_replan_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  proposal_id uuid NOT NULL,
  task_id uuid NOT NULL,
  request_key uuid NOT NULL,
  single_request_id uuid NOT NULL UNIQUE REFERENCES public.single_ai_requests(id),
  analysis jsonb NOT NULL CHECK (jsonb_typeof(analysis) = 'object' AND length(analysis::text) <= 16000),
  recommended text NOT NULL CHECK (recommended IN ('a','b','c','none')),
  task_updated_at timestamptz NOT NULL,
  credits int CHECK (credits IS NULL OR credits >= 0),
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, request_key),
  FOREIGN KEY (proposal_id, org_id, workspace_id) REFERENCES public.task_replan_proposals(id, org_id, workspace_id),
  FOREIGN KEY (task_id, org_id, workspace_id) REFERENCES public.tasks(id, org_id, workspace_id)
);
CREATE INDEX IF NOT EXISTS task_replan_analyses_by_proposal ON public.task_replan_analyses (workspace_id, proposal_id, created_at DESC);
REVOKE ALL ON public.task_replan_analyses FROM anon, authenticated;
GRANT SELECT ON public.task_replan_analyses TO authenticated;
GRANT ALL ON public.task_replan_analyses TO service_role;
ALTER TABLE public.task_replan_analyses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "replan analyses readable by business" ON public.task_replan_analyses;
CREATE POLICY "replan analyses readable by business" ON public.task_replan_analyses
  FOR SELECT TO authenticated USING (public.has_workspace_role(workspace_id, 'viewer'));
DROP TRIGGER IF EXISTS task_replan_analyses_immutable ON public.task_replan_analyses;
CREATE TRIGGER task_replan_analyses_immutable BEFORE UPDATE OR DELETE ON public.task_replan_analyses
  FOR EACH ROW EXECUTE FUNCTION public.decision_history_immutable();

CREATE OR REPLACE FUNCTION public.record_replan_analysis_verified(_proposal uuid, _request uuid, _single uuid, _analysis jsonb, _proof text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.task_replan_proposals%ROWTYPE; t public.tasks%ROWTYPE; q public.single_ai_requests%ROWTYPE; x public.task_replan_analyses%ROWTYPE;
  rec text; o jsonb; e jsonb; keys text[];
BEGIN
  PERFORM public.verify_ai_accounting(_proof);
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO p FROM public.task_replan_proposals WHERE id = _proposal;
  IF NOT FOUND OR NOT public.has_workspace_role(p.workspace_id, 'member') THEN RAISE EXCEPTION 'Proposal unavailable'; END IF;
  SELECT * INTO x FROM public.task_replan_analyses WHERE workspace_id = p.workspace_id AND request_key = _request;
  IF FOUND THEN RETURN to_jsonb(x) || jsonb_build_object('status', 'existing'); END IF;
  IF EXISTS (SELECT 1 FROM public.task_replan_decisions d WHERE d.proposal_id = p.id AND d.decision <> 'postponed') THEN
    RAISE EXCEPTION 'This re-planning proposal has already been decided' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO q FROM public.single_ai_requests WHERE id = _single;
  IF NOT FOUND OR q.workspace_id <> p.workspace_id OR q.user_id <> auth.uid() OR q.status <> 'succeeded'
     OR q.request_key <> _request OR q.input->>'purpose' IS DISTINCT FROM 'replan_analysis' OR q.input->>'proposalId' IS DISTINCT FROM p.id::text THEN
    RAISE EXCEPTION 'The analysis must come from the finished, paid analysis request for this proposal' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO t FROM public.tasks WHERE id = p.task_id;
  IF jsonb_typeof(_analysis) IS DISTINCT FROM 'object'
     OR (_analysis - ARRAY['cause','consequences','affected','options','recommended','why','extra','risks','cost','approval','verification','evidence_gaps']) <> '{}'::jsonb
     OR length(trim(coalesce(_analysis->>'cause',''))) = 0 OR length(_analysis::text) > 16000
     OR jsonb_typeof(coalesce(_analysis->'options','[]'::jsonb)) <> 'array' OR jsonb_typeof(coalesce(_analysis->'extra','[]'::jsonb)) <> 'array'
     OR jsonb_typeof(coalesce(_analysis->'affected','[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Invalid re-planning analysis' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(x2->>'key') INTO keys FROM jsonb_array_elements(p.options) x2;
  rec := coalesce(_analysis->>'recommended', 'none');
  IF rec <> 'none' AND NOT rec = ANY(keys) THEN RAISE EXCEPTION 'The recommendation must be one of the proposal''s options' USING ERRCODE = '22023'; END IF;
  FOR o IN SELECT * FROM jsonb_array_elements(coalesce(_analysis->'options','[]'::jsonb)) LOOP
    IF NOT coalesce(o->>'key','') = ANY(keys) OR coalesce(o->>'risk','medium') NOT IN ('low','medium','high') THEN
      RAISE EXCEPTION 'Invalid option assessment' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  -- Further ideas (split, merge, another specialist …) stay advice: they are not options an editor can apply here.
  FOR e IN SELECT * FROM jsonb_array_elements(coalesce(_analysis->'extra','[]'::jsonb)) LOOP
    IF coalesce(e->>'kind','') NOT IN ('split','merge','other_specialist','reorder','pause','revisit_initiative','revisit_strategy') THEN
      RAISE EXCEPTION 'Unknown further idea' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  FOR e IN SELECT * FROM jsonb_array_elements(coalesce(_analysis->'affected','[]'::jsonb)) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.tasks y WHERE y.id::text = e->>'task_id' AND y.workspace_id = p.workspace_id) THEN
      RAISE EXCEPTION 'An affected task is not part of this business' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  INSERT INTO public.task_replan_analyses(org_id, workspace_id, proposal_id, task_id, request_key, single_request_id, analysis, recommended, task_updated_at, credits)
  VALUES (p.org_id, p.workspace_id, p.id, p.task_id, _request, q.id, _analysis, rec, t.updated_at, q.credits)
  RETURNING * INTO x;
  PERFORM public.log_audit(p.org_id, 'task.replan_analyzed', 'task', p.task_id::text, jsonb_build_object('proposal', p.id, 'analysis', x.id, 'recommended', rec));
  RETURN to_jsonb(x) || jsonb_build_object('status', 'created');
EXCEPTION WHEN invalid_text_representation THEN
  RAISE EXCEPTION 'Invalid re-planning analysis' USING ERRCODE = '22023';
END;
$$;
REVOKE ALL ON FUNCTION public.record_replan_analysis_verified(uuid,uuid,uuid,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_replan_analysis_verified(uuid,uuid,uuid,jsonb,text) TO authenticated;
