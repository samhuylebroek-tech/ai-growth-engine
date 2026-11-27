-- PROPOSED migration 0079 (staging only until approved): experiment management 2.0.
--
-- Extends growth_experiments (proposal 0066) with a full design (primary and secondary KPIs, control description,
-- baseline rate and minimum effect, a database-computed sample size per group, success and stop criteria, an optional
-- guardrail, schedule and follow-up link) and a complete lifecycle:
--   draft -> in_review -> proposed (awaiting approval) -> approved -> scheduled -> running -> collecting -> evaluating
--   -> completed, with paused, rejected and cancelled.
-- Every transition is an insert-only experiment_events row. Test data arrives as insert-only, cumulative
-- experiment_observations (manual, simulated or imported, never mixed silently). The final outcome is checked by the
-- database: for a controlled test "successful" needs the planned sample in both groups and |z| >= 1.96 in the hoped
-- direction, "unsuccessful" needs the planned sample (or a significant negative result); otherwise only "inconclusive"
-- is accepted. Before/after and observational designs are always labelled correlational. Nothing here publishes,
-- pauses or changes a real campaign.

-- 1. Design columns and the wider lifecycle ----------------------------------------------------------------------------
ALTER TABLE public.growth_experiments DROP CONSTRAINT IF EXISTS growth_experiments_status_check;
ALTER TABLE public.growth_experiments ADD CONSTRAINT growth_experiments_status_check CHECK (status IN
  ('draft','in_review','proposed','approved','rejected','scheduled','running','collecting','evaluating','paused','completed','cancelled'));
ALTER TABLE public.growth_experiments
  ADD COLUMN IF NOT EXISTS primary_kpi text NOT NULL DEFAULT '' CHECK (length(primary_kpi) <= 200),
  ADD COLUMN IF NOT EXISTS secondary_kpis text[] NOT NULL DEFAULT '{}' CHECK (cardinality(secondary_kpis) <= 5),
  ADD COLUMN IF NOT EXISTS control_description text NOT NULL DEFAULT '' CHECK (length(control_description) <= 500),
  ADD COLUMN IF NOT EXISTS baseline_rate numeric CHECK (baseline_rate IS NULL OR (baseline_rate > 0 AND baseline_rate < 100)),
  ADD COLUMN IF NOT EXISTS min_effect numeric CHECK (min_effect IS NULL OR (min_effect > 0 AND min_effect < 100)),
  ADD COLUMN IF NOT EXISTS sample_per_group int CHECK (sample_per_group IS NULL OR sample_per_group > 0),
  ADD COLUMN IF NOT EXISTS success_criteria text NOT NULL DEFAULT '' CHECK (length(success_criteria) <= 600),
  ADD COLUMN IF NOT EXISTS stop_criteria text NOT NULL DEFAULT '' CHECK (length(stop_criteria) <= 600),
  ADD COLUMN IF NOT EXISTS guardrail_min_rate numeric CHECK (guardrail_min_rate IS NULL OR (guardrail_min_rate >= 0 AND guardrail_min_rate <= 100)),
  ADD COLUMN IF NOT EXISTS scheduled_start date,
  ADD COLUMN IF NOT EXISTS paused_from text CHECK (paused_from IS NULL OR paused_from IN ('running','collecting')),
  ADD COLUMN IF NOT EXISTS outcome text CHECK (outcome IS NULL OR outcome IN ('successful','unsuccessful','inconclusive')),
  ADD COLUMN IF NOT EXISTS follow_up_of uuid,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS design_version int NOT NULL DEFAULT 1;
ALTER TABLE public.growth_experiments DROP CONSTRAINT IF EXISTS growth_experiments_effect_range;
ALTER TABLE public.growth_experiments ADD CONSTRAINT growth_experiments_effect_range
  CHECK (baseline_rate IS NULL OR min_effect IS NULL OR baseline_rate + min_effect < 100);
ALTER TABLE public.growth_experiments DROP CONSTRAINT IF EXISTS growth_experiments_follow_up_scope;
ALTER TABLE public.growth_experiments ADD CONSTRAINT growth_experiments_follow_up_scope
  FOREIGN KEY (follow_up_of, org_id, workspace_id) REFERENCES public.growth_experiments(id, org_id, workspace_id);

-- Two-sided alpha 0.05, power 0.80, two-proportion test; rates and effect in percentage points.
CREATE OR REPLACE FUNCTION public.experiment_sample_size(_baseline numeric, _effect numeric)
RETURNS int LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN _baseline IS NULL OR _effect IS NULL OR _baseline <= 0 OR _effect <= 0 OR _baseline + _effect >= 100 THEN NULL
  ELSE ceil(power(1.959964 * sqrt(2 * ((_baseline + _effect / 2) / 100) * (1 - (_baseline + _effect / 2) / 100))
           + 0.841621 * sqrt((_baseline / 100) * (1 - _baseline / 100) + ((_baseline + _effect) / 100) * (1 - (_baseline + _effect) / 100)), 2)
         / power(_effect / 100, 2))::int END
$$;

-- 2. Lifecycle history and observations (insert-only) -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.experiment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  experiment_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('created','revised','submit_review','return_to_draft','request_approval','approve','reject','schedule',
    'start','pause','resume','stop_intervention','evaluate','complete','cancel','observation')),
  from_status text, to_status text NOT NULL,
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 600),
  data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object' AND length(data::text) <= 4000),
  actor_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (experiment_id, org_id, workspace_id) REFERENCES public.growth_experiments(id, org_id, workspace_id)
);
CREATE INDEX IF NOT EXISTS experiment_events_by_experiment ON public.experiment_events (workspace_id, experiment_id, created_at);
REVOKE ALL ON public.experiment_events FROM anon, authenticated;
GRANT SELECT ON public.experiment_events TO authenticated;
GRANT ALL ON public.experiment_events TO service_role;
ALTER TABLE public.experiment_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "experiment events readable by business" ON public.experiment_events;
CREATE POLICY "experiment events readable by business" ON public.experiment_events
  FOR SELECT TO authenticated USING (public.has_workspace_role(workspace_id, 'viewer'));
DROP TRIGGER IF EXISTS experiment_events_immutable ON public.experiment_events;
CREATE TRIGGER experiment_events_immutable BEFORE UPDATE OR DELETE ON public.experiment_events
  FOR EACH ROW EXECUTE FUNCTION public.decision_history_immutable();

CREATE TABLE IF NOT EXISTS public.experiment_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  experiment_id uuid NOT NULL,
  request_key uuid NOT NULL,
  observed_on date NOT NULL DEFAULT current_date,
  variant_n int NOT NULL CHECK (variant_n BETWEEN 0 AND 100000000),
  variant_conversions int NOT NULL CHECK (variant_conversions >= 0 AND variant_conversions <= variant_n),
  control_n int NOT NULL CHECK (control_n BETWEEN 0 AND 100000000),
  control_conversions int NOT NULL CHECK (control_conversions >= 0 AND control_conversions <= control_n),
  data_class text NOT NULL CHECK (data_class IN ('manual','simulated','imported')),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  recorded_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, request_key),
  FOREIGN KEY (experiment_id, org_id, workspace_id) REFERENCES public.growth_experiments(id, org_id, workspace_id)
);
CREATE INDEX IF NOT EXISTS experiment_observations_by_experiment ON public.experiment_observations (workspace_id, experiment_id, created_at DESC);
REVOKE ALL ON public.experiment_observations FROM anon, authenticated;
GRANT SELECT ON public.experiment_observations TO authenticated;
GRANT ALL ON public.experiment_observations TO service_role;
ALTER TABLE public.experiment_observations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "experiment observations readable by business" ON public.experiment_observations;
CREATE POLICY "experiment observations readable by business" ON public.experiment_observations
  FOR SELECT TO authenticated USING (public.has_workspace_role(workspace_id, 'viewer'));
DROP TRIGGER IF EXISTS experiment_observations_immutable ON public.experiment_observations;
CREATE TRIGGER experiment_observations_immutable BEFORE UPDATE OR DELETE ON public.experiment_observations
  FOR EACH ROW EXECUTE FUNCTION public.decision_history_immutable();

-- 3. Design: create and revise (drafts only) --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.experiment_design_values(_p jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE sec text[]; b numeric; e numeric; g numeric;
BEGIN
  IF jsonb_typeof(_p) IS DISTINCT FROM 'object' OR (_p - ARRAY['title','hypothesis','objective','audience','intervention','control_description','method',
      'primary_kpi','secondary_kpis','baseline_rate','min_effect','duration_days','success_criteria','stop_criteria','guardrail_min_rate','budget','currency',
      'expected_result','risks','goal_id','campaign_id','metric_id','unit_id','origin','follow_up_of']) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'Invalid experiment design' USING ERRCODE = '22023';
  END IF;
  IF _p ? 'secondary_kpis' AND jsonb_typeof(_p->'secondary_kpis') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid secondary KPIs' USING ERRCODE = '22023'; END IF;
  SELECT coalesce(array_agg(left(trim(v), 200)) FILTER (WHERE length(trim(v)) > 0), '{}') INTO sec FROM jsonb_array_elements_text(coalesce(_p->'secondary_kpis','[]'::jsonb)) v;
  IF cardinality(sec) > 5 THEN RAISE EXCEPTION 'At most five secondary KPIs' USING ERRCODE = '22023'; END IF;
  b := nullif(_p->>'baseline_rate','')::numeric; e := nullif(_p->>'min_effect','')::numeric; g := nullif(_p->>'guardrail_min_rate','')::numeric;
  IF (b IS NULL) <> (e IS NULL) THEN RAISE EXCEPTION 'Give both the current rate and the smallest effect worth detecting' USING ERRCODE = '22023'; END IF;
  IF b IS NOT NULL AND (b <= 0 OR b >= 100 OR e <= 0 OR b + e >= 100) THEN RAISE EXCEPTION 'Rates must lie between 0 and 100%%' USING ERRCODE = '22023'; END IF;
  RETURN _p || jsonb_build_object('secondary_kpis', to_jsonb(sec), 'sample_per_group', public.experiment_sample_size(b, e));
END;
$$;

CREATE OR REPLACE FUNCTION public.design_experiment(_workspace uuid, _request uuid, _p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w public.workspaces%ROWTYPE; x public.growth_experiments%ROWTYPE; v jsonb; bud numeric; cur text; fu uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO w FROM public.workspaces WHERE id = _workspace;
  IF NOT FOUND OR NOT public.has_workspace_role(_workspace, 'member') THEN RAISE EXCEPTION 'Workspace unavailable'; END IF;
  SELECT * INTO x FROM public.growth_experiments WHERE workspace_id = w.id AND request_key = _request;
  IF FOUND THEN RETURN jsonb_build_object('experiment_id', x.id, 'status', 'existing'); END IF;
  v := public.experiment_design_values(_p);
  bud := nullif(v->>'budget','')::numeric; cur := nullif(upper(trim(coalesce(v->>'currency',''))),'');
  IF bud IS NULL THEN cur := NULL; ELSIF cur IS NULL THEN RAISE EXCEPTION 'A budget needs a currency' USING ERRCODE = '22023'; END IF;
  fu := nullif(v->>'follow_up_of','')::uuid;
  IF fu IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.growth_experiments WHERE id = fu AND workspace_id = w.id AND status = 'completed') THEN
    RAISE EXCEPTION 'A follow-up must build on a completed experiment of this business' USING ERRCODE = '22023';
  END IF;
  IF coalesce(v->>'origin','team') NOT IN ('team','growth_officer') THEN RAISE EXCEPTION 'Invalid origin' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.growth_experiments(org_id, workspace_id, unit_id, goal_id, campaign_id, metric_id, request_key, origin, title, hypothesis, objective, audience,
    intervention, control_description, budget, currency, expected_result, success_metric, primary_kpi, secondary_kpis, baseline_rate, min_effect, sample_per_group,
    success_criteria, stop_criteria, guardrail_min_rate, duration_days, risks, method, follow_up_of, status, created_by)
  VALUES (w.org_id, w.id, nullif(v->>'unit_id','')::uuid, nullif(v->>'goal_id','')::uuid, nullif(v->>'campaign_id','')::uuid, nullif(v->>'metric_id','')::uuid, _request,
    coalesce(nullif(v->>'origin',''), 'team'), trim(v->>'title'), trim(v->>'hypothesis'), coalesce(v->>'objective',''), coalesce(v->>'audience',''),
    trim(v->>'intervention'), coalesce(v->>'control_description',''), bud, cur, coalesce(v->>'expected_result',''), trim(v->>'primary_kpi'), trim(v->>'primary_kpi'),
    ARRAY(SELECT jsonb_array_elements_text(v->'secondary_kpis')), nullif(v->>'baseline_rate','')::numeric, nullif(v->>'min_effect','')::numeric,
    nullif(v->>'sample_per_group','')::int, coalesce(v->>'success_criteria',''), coalesce(v->>'stop_criteria',''), nullif(v->>'guardrail_min_rate','')::numeric,
    (v->>'duration_days')::int, coalesce(v->>'risks',''), v->>'method', fu, 'draft', auth.uid())
  RETURNING * INTO x;
  INSERT INTO public.experiment_events(org_id, workspace_id, experiment_id, action, from_status, to_status, data)
  VALUES (x.org_id, x.workspace_id, x.id, 'created', NULL, 'draft', jsonb_build_object('origin', x.origin, 'sample_per_group', x.sample_per_group));
  INSERT INTO public.activity_events(org_id, workspace_id, entity_type, entity_id, actor_id, action, metadata)
  VALUES (x.org_id, x.workspace_id, 'experiment', x.id, auth.uid(), 'experiment.designed', jsonb_build_object('method', x.method));
  RETURN jsonb_build_object('experiment_id', x.id, 'status', 'created', 'sample_per_group', x.sample_per_group);
END;
$$;
REVOKE ALL ON FUNCTION public.design_experiment(uuid,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.design_experiment(uuid,uuid,jsonb) TO authenticated;

-- A revision is allowed while the design is a draft or under review; revising a design under review returns it to draft.
CREATE OR REPLACE FUNCTION public.revise_experiment_design(_experiment uuid, _version int, _p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE x public.growth_experiments%ROWTYPE; v jsonb; bud numeric; cur text; prev text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO x FROM public.growth_experiments WHERE id = _experiment FOR UPDATE;
  IF NOT FOUND OR NOT public.has_workspace_role(x.workspace_id, 'member') THEN RAISE EXCEPTION 'Experiment unavailable'; END IF;
  IF x.status NOT IN ('draft','in_review') THEN RAISE EXCEPTION 'Only a draft or a design under review can be changed' USING ERRCODE = '55000'; END IF;
  IF x.design_version <> _version THEN RAISE EXCEPTION 'Someone changed this design in the meantime; reload it first' USING ERRCODE = '40001'; END IF;
  IF _p ? 'origin' OR _p ? 'follow_up_of' THEN RAISE EXCEPTION 'Origin and follow-up link cannot change' USING ERRCODE = '22023'; END IF;
  v := public.experiment_design_values(_p);
  bud := nullif(v->>'budget','')::numeric; cur := nullif(upper(trim(coalesce(v->>'currency',''))),'');
  IF bud IS NULL THEN cur := NULL; ELSIF cur IS NULL THEN RAISE EXCEPTION 'A budget needs a currency' USING ERRCODE = '22023'; END IF;
  prev := x.status;
  UPDATE public.growth_experiments SET
    title = trim(v->>'title'), hypothesis = trim(v->>'hypothesis'), objective = coalesce(v->>'objective',''), audience = coalesce(v->>'audience',''),
    intervention = trim(v->>'intervention'), control_description = coalesce(v->>'control_description',''), method = v->>'method',
    primary_kpi = trim(v->>'primary_kpi'), success_metric = trim(v->>'primary_kpi'), secondary_kpis = ARRAY(SELECT jsonb_array_elements_text(v->'secondary_kpis')),
    baseline_rate = nullif(v->>'baseline_rate','')::numeric, min_effect = nullif(v->>'min_effect','')::numeric, sample_per_group = nullif(v->>'sample_per_group','')::int,
    success_criteria = coalesce(v->>'success_criteria',''), stop_criteria = coalesce(v->>'stop_criteria',''), guardrail_min_rate = nullif(v->>'guardrail_min_rate','')::numeric,
    duration_days = (v->>'duration_days')::int, risks = coalesce(v->>'risks',''), expected_result = coalesce(v->>'expected_result',''), budget = bud, currency = cur,
    goal_id = nullif(v->>'goal_id','')::uuid, campaign_id = nullif(v->>'campaign_id','')::uuid, metric_id = nullif(v->>'metric_id','')::uuid,
    status = 'draft', design_version = design_version + 1, updated_at = now()
  WHERE id = x.id RETURNING * INTO x;
  INSERT INTO public.experiment_events(org_id, workspace_id, experiment_id, action, from_status, to_status, data)
  VALUES (x.org_id, x.workspace_id, x.id, 'revised', prev, 'draft', jsonb_build_object('design_version', x.design_version, 'sample_per_group', x.sample_per_group));
  RETURN jsonb_build_object('experiment_id', x.id, 'design_version', x.design_version, 'sample_per_group', x.sample_per_group);
END;
$$;
REVOKE ALL ON FUNCTION public.revise_experiment_design(uuid,int,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revise_experiment_design(uuid,int,jsonb) TO authenticated;

-- 4. Observations -----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_experiment_observation(_experiment uuid, _request uuid, _p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE x public.growth_experiments%ROWTYPE; prev public.experiment_observations%ROWTYPE; o public.experiment_observations%ROWTYPE;
  vn int; vc int; cn int; cc int; cls text; dt date;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO x FROM public.growth_experiments WHERE id = _experiment FOR UPDATE;
  IF NOT FOUND OR NOT public.has_workspace_role(x.workspace_id, 'member') THEN RAISE EXCEPTION 'Experiment unavailable'; END IF;
  SELECT * INTO o FROM public.experiment_observations WHERE workspace_id = x.workspace_id AND request_key = _request;
  IF FOUND THEN RETURN jsonb_build_object('observation_id', o.id, 'status', 'existing'); END IF;
  IF x.status NOT IN ('running','collecting','evaluating','paused') THEN RAISE EXCEPTION 'Results can only be recorded while an experiment runs or is evaluated' USING ERRCODE = '55000'; END IF;
  IF jsonb_typeof(_p) IS DISTINCT FROM 'object' OR (_p - ARRAY['variant_n','variant_conversions','control_n','control_conversions','data_class','note','observed_on']) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'Invalid observation' USING ERRCODE = '22023';
  END IF;
  vn := (_p->>'variant_n')::int; vc := (_p->>'variant_conversions')::int; cn := (_p->>'control_n')::int; cc := (_p->>'control_conversions')::int;
  cls := _p->>'data_class'; dt := coalesce(nullif(_p->>'observed_on','')::date, current_date);
  IF vn IS NULL OR vc IS NULL OR cn IS NULL OR cc IS NULL OR cls IS NULL THEN RAISE EXCEPTION 'Give both groups and the data source' USING ERRCODE = '22023'; END IF;
  IF dt > current_date THEN RAISE EXCEPTION 'An observation cannot lie in the future' USING ERRCODE = '22023'; END IF;
  SELECT * INTO prev FROM public.experiment_observations WHERE experiment_id = x.id ORDER BY created_at DESC, id DESC LIMIT 1;
  IF FOUND THEN
    -- Totals are cumulative: a later count can never be lower, and one experiment never mixes simulated with real data.
    IF vn < prev.variant_n OR cn < prev.control_n OR vc < prev.variant_conversions OR cc < prev.control_conversions THEN
      RAISE EXCEPTION 'Totals are cumulative and cannot go down' USING ERRCODE = '22023';
    END IF;
    IF (prev.data_class = 'simulated') <> (cls = 'simulated') THEN RAISE EXCEPTION 'Simulated and real results cannot be mixed in one experiment' USING ERRCODE = '22023'; END IF;
  END IF;
  INSERT INTO public.experiment_observations(org_id, workspace_id, experiment_id, request_key, observed_on, variant_n, variant_conversions, control_n, control_conversions, data_class, note)
  VALUES (x.org_id, x.workspace_id, x.id, _request, dt, vn, vc, cn, cc, cls, left(coalesce(_p->>'note',''), 500)) RETURNING * INTO o;
  INSERT INTO public.experiment_events(org_id, workspace_id, experiment_id, action, from_status, to_status, data)
  VALUES (x.org_id, x.workspace_id, x.id, 'observation', x.status, x.status, jsonb_build_object('variant_n', vn, 'control_n', cn, 'data_class', cls));
  RETURN jsonb_build_object('observation_id', o.id, 'status', 'created');
END;
$$;
REVOKE ALL ON FUNCTION public.record_experiment_observation(uuid,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_experiment_observation(uuid,uuid,jsonb) TO authenticated;

-- 5. Lifecycle --------------------------------------------------------------------------------------------------------
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

-- 6. The 0066 entry points keep working: propose_experiment still files a direct proposal awaiting administrator approval;
--    completion with typed-in percentages is no longer possible (results come from recorded observations).
CREATE OR REPLACE FUNCTION public.advance_experiment(_experiment uuid, _action text, _data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _action = 'complete' THEN RAISE EXCEPTION 'Record results and evaluate the experiment before completing it' USING ERRCODE = '55000'; END IF;
  IF _action NOT IN ('approve','reject','start','cancel') THEN RAISE EXCEPTION 'Unknown action' USING ERRCODE = '22023'; END IF;
  RETURN public.move_experiment(_experiment, _action, coalesce(_data, '{}'::jsonb) || jsonb_build_object('note', coalesce(_data->>'note', CASE WHEN _action = 'cancel' THEN 'Cancelled' ELSE '' END)));
END;
$$;
REVOKE ALL ON FUNCTION public.advance_experiment(uuid,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advance_experiment(uuid,text,jsonb) TO authenticated;
