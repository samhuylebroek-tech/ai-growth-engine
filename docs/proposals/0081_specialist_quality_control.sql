-- PROPOSED migration 0081 (staging only until approved): quality control of specialist results.
--
-- A succeeded task run (proposal 0063) can get an independent second review by a DIFFERENT specialist. The review is
-- one metered AI call made by the server (accounting proof required); the database stores the reviewer, per-dimension
-- scores and notes, findings with severity and suggested corrections, and computes the quality score and verdict
-- itself from the dimension scores, so the score is explainable and never the model's own overall claim. A review
-- that finds nothing at all and gives every dimension the top score is flagged as possibly uncritical.
-- A person with editor rights (or higher) records the final decision. Important results (high/urgent tasks, results
-- that propose external actions, revenue and advertising specialists) need a second review before they can be
-- accepted, and an "unreliable" review blocks plain acceptance. Reviews and decisions are insert-only.
-- A quality score is a structured opinion about the result, not proof that its facts are correct.

CREATE TABLE IF NOT EXISTS public.specialist_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  task_run_id uuid NOT NULL REFERENCES public.task_runs(id),
  request_key uuid NOT NULL,
  original_specialist text NOT NULL,
  reviewer_specialist text NOT NULL CHECK (reviewer_specialist IN ('business_analyst','market_research','growth_strategist','seo','content','copywriter',
    'marketing','advertising','linkedin','sales','crm','cro','partnership','event_marketing','revenue_analyst')),
  single_request_id uuid NOT NULL REFERENCES public.single_ai_requests(id),
  dimensions jsonb NOT NULL CHECK (jsonb_typeof(dimensions) = 'object' AND length(dimensions::text) <= 8000),
  findings jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(findings) = 'array' AND jsonb_array_length(findings) <= 20 AND length(findings::text) <= 16000),
  summary text NOT NULL DEFAULT '' CHECK (length(summary) <= 1500),
  assessed int NOT NULL CHECK (assessed BETWEEN 6 AND 10),
  score int NOT NULL CHECK (score BETWEEN 0 AND 100),
  critical int NOT NULL DEFAULT 0,
  verdict text NOT NULL CHECK (verdict IN ('acceptable','needs_changes','unreliable')),
  independence_warning boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, request_key),
  CHECK (reviewer_specialist <> original_specialist)
);
CREATE INDEX IF NOT EXISTS specialist_reviews_by_run ON public.specialist_reviews (workspace_id, task_run_id, created_at DESC);
REVOKE ALL ON public.specialist_reviews FROM anon, authenticated;
GRANT SELECT ON public.specialist_reviews TO authenticated;
GRANT ALL ON public.specialist_reviews TO service_role;
ALTER TABLE public.specialist_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "specialist reviews readable by business" ON public.specialist_reviews;
CREATE POLICY "specialist reviews readable by business" ON public.specialist_reviews
  FOR SELECT TO authenticated USING (public.has_workspace_role(workspace_id, 'viewer'));
DROP TRIGGER IF EXISTS specialist_reviews_immutable ON public.specialist_reviews;
CREATE TRIGGER specialist_reviews_immutable BEFORE UPDATE OR DELETE ON public.specialist_reviews
  FOR EACH ROW EXECUTE FUNCTION public.decision_history_immutable();

CREATE TABLE IF NOT EXISTS public.specialist_result_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  task_run_id uuid NOT NULL UNIQUE REFERENCES public.task_runs(id),
  review_id uuid REFERENCES public.specialist_reviews(id),
  decision text NOT NULL CHECK (decision IN ('accepted','accepted_with_corrections','needs_rework','rejected')),
  corrections text NOT NULL DEFAULT '' CHECK (length(corrections) <= 2000),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 600),
  review_required boolean NOT NULL,
  actor_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (decision <> 'accepted_with_corrections' OR length(trim(corrections)) > 0)
);
REVOKE ALL ON public.specialist_result_decisions FROM anon, authenticated;
GRANT SELECT ON public.specialist_result_decisions TO authenticated;
GRANT ALL ON public.specialist_result_decisions TO service_role;
ALTER TABLE public.specialist_result_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "specialist decisions readable by business" ON public.specialist_result_decisions;
CREATE POLICY "specialist decisions readable by business" ON public.specialist_result_decisions
  FOR SELECT TO authenticated USING (public.has_workspace_role(workspace_id, 'viewer'));
DROP TRIGGER IF EXISTS specialist_result_decisions_immutable ON public.specialist_result_decisions;
CREATE TRIGGER specialist_result_decisions_immutable BEFORE UPDATE OR DELETE ON public.specialist_result_decisions
  FOR EACH ROW EXECUTE FUNCTION public.decision_history_immutable();

-- One rule for "important result", shared by the decision check and the screen (mirrored in src/lib/specialist-review.ts).
CREATE OR REPLACE FUNCTION public.specialist_review_required(_run uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.task_runs r JOIN public.tasks t ON t.id = r.task_id
    WHERE r.id = _run AND public.has_workspace_role(r.workspace_id, 'viewer')
      AND (t.priority IN ('high','urgent')
        OR r.specialist_key IN ('revenue_analyst','advertising')
        OR (jsonb_typeof(r.output->'external_actions') = 'array' AND jsonb_array_length(r.output->'external_actions') > 0)))
$$;
REVOKE ALL ON FUNCTION public.specialist_review_required(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.specialist_review_required(uuid) TO authenticated;

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
  IF NOT FOUND OR q.workspace_id <> r.workspace_id OR q.user_id <> auth.uid() OR q.status <> 'succeeded' THEN
    RAISE EXCEPTION 'The review must come from a finished, paid request of this business' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(_review->'dimensions') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid review' USING ERRCODE = '22023'; END IF;
  FOR k, v IN SELECT * FROM jsonb_each(_review->'dimensions') LOOP
    IF k NOT IN ('completeness','relevance','evidence','calculations','consistency','feasibility','financial_assumptions','alignment','permissions','quality') THEN
      RAISE EXCEPTION 'Unknown review dimension %', k USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v->'score') = 'null' OR v->'score' IS NULL THEN CONTINUE; END IF;  -- not assessable for this result
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
  -- Score: the average dimension score mapped from 1..5 to 0..100. Verdict follows the score and the critical findings.
  s := round((total::numeric / n - 1) / 4 * 100);
  indep := total = 5 * n AND serious = 0;
  verdict := CASE WHEN s < 50 OR crit >= 2 THEN 'unreliable' WHEN crit >= 1 OR s < 70 OR indep THEN 'needs_changes' ELSE 'acceptable' END;
  INSERT INTO public.specialist_reviews(org_id, workspace_id, task_run_id, request_key, original_specialist, reviewer_specialist, single_request_id,
    dimensions, findings, summary, assessed, score, critical, verdict, independence_warning)
  VALUES (r.org_id, r.workspace_id, r.id, _request, r.specialist_key, _reviewer, q.id, dims, fs, left(coalesce(_review->>'summary',''), 1500), n, s, crit, verdict, indep)
  RETURNING * INTO x;
  INSERT INTO public.activity_events(org_id, workspace_id, entity_type, entity_id, actor_id, action, metadata)
  VALUES (r.org_id, r.workspace_id, 'task', r.task_id, auth.uid(), 'specialist.reviewed', jsonb_build_object('run', r.id, 'reviewer', _reviewer, 'score', s, 'verdict', verdict));
  RETURN to_jsonb(x) || jsonb_build_object('status', 'created');
END;
$$;
REVOKE ALL ON FUNCTION public.record_specialist_review_verified(uuid,uuid,text,uuid,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_specialist_review_verified(uuid,uuid,text,uuid,jsonb,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.decide_specialist_result(_run uuid, _decision text, _note text, _corrections text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.task_runs%ROWTYPE; rv public.specialist_reviews%ROWTYPE; d public.specialist_result_decisions%ROWTYPE; req boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO r FROM public.task_runs WHERE id = _run FOR UPDATE;
  IF NOT FOUND OR NOT public.has_workspace_role(r.workspace_id, 'viewer') THEN RAISE EXCEPTION 'Run unavailable'; END IF;
  IF NOT public.has_workspace_role(r.workspace_id, 'editor') THEN RAISE EXCEPTION 'Only an editor or higher can decide on a result' USING ERRCODE = '42501'; END IF;
  IF r.status <> 'succeeded' THEN RAISE EXCEPTION 'Only a finished result can be decided' USING ERRCODE = '55000'; END IF;
  IF EXISTS (SELECT 1 FROM public.specialist_result_decisions WHERE task_run_id = r.id) THEN RAISE EXCEPTION 'This result has already been decided' USING ERRCODE = '55000'; END IF;
  IF _decision NOT IN ('accepted','accepted_with_corrections','needs_rework','rejected') THEN RAISE EXCEPTION 'Unknown decision' USING ERRCODE = '22023'; END IF;
  IF _decision IN ('needs_rework','rejected') AND length(trim(coalesce(_note,''))) = 0 THEN RAISE EXCEPTION 'Give a reason' USING ERRCODE = '22023'; END IF;
  IF _decision = 'accepted_with_corrections' AND length(trim(coalesce(_corrections,''))) = 0 THEN RAISE EXCEPTION 'Describe the corrections' USING ERRCODE = '22023'; END IF;
  req := public.specialist_review_required(r.id);
  SELECT * INTO rv FROM public.specialist_reviews WHERE task_run_id = r.id ORDER BY created_at DESC, id DESC LIMIT 1;
  IF _decision IN ('accepted','accepted_with_corrections') AND req AND rv.id IS NULL THEN
    RAISE EXCEPTION 'This result is important: request an independent second review before accepting it' USING ERRCODE = '55000';
  END IF;
  IF _decision = 'accepted' AND rv.verdict = 'unreliable' THEN
    RAISE EXCEPTION 'The second review found this result unreliable: accept it only with corrections, or ask for rework' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.specialist_result_decisions(org_id, workspace_id, task_run_id, review_id, decision, corrections, note, review_required)
  VALUES (r.org_id, r.workspace_id, r.id, rv.id, _decision, left(coalesce(_corrections,''), 2000), left(coalesce(_note,''), 600), req)
  RETURNING * INTO d;
  INSERT INTO public.activity_events(org_id, workspace_id, entity_type, entity_id, actor_id, action, metadata)
  VALUES (r.org_id, r.workspace_id, 'task', r.task_id, auth.uid(), 'specialist.decided', jsonb_build_object('run', r.id, 'decision', _decision, 'review', rv.id));
  RETURN to_jsonb(d);
END;
$$;
REVOKE ALL ON FUNCTION public.decide_specialist_result(uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_specialist_result(uuid,text,text,text) TO authenticated;
