-- PROPOSED migration 0089 (staging only until approved): real starting points (baselines) and targets per KPI.
-- * A baseline is the value improvement is measured from. It is either typed in by an editor with its period and
--   source ("manual"), or taken from a recorded actual result of the same metric ("measured": value, period and
--   reliability are copied from that measurement by the database, so nothing is invented).
-- * A target is a value to reach by a date, for a measurement period length, with an optional owner who must be a
--   member of the business.
-- * Both are insert-only: a new row supersedes the current one (supersedes_id, unique), so the full history of who
--   set what and when is kept and nothing is overwritten. A target can be withdrawn by a superseding row.
-- * Only editors and above set them, through role-checked SECURITY DEFINER functions; viewers read them.

CREATE TABLE IF NOT EXISTS public.metric_baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  metric_id uuid NOT NULL,
  basis text NOT NULL CHECK (basis IN ('manual','measured')),
  measurement_id uuid,
  measurement_kind text CHECK (measurement_kind IN ('manual_actual','imported_actual','verified_actual')),
  value numeric NOT NULL CHECK (value > -1e15 AND value < 1e15),
  period_start date NOT NULL,
  period_end date NOT NULL,
  source text NOT NULL CHECK (length(trim(source)) BETWEEN 1 AND 120),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  supersedes_id uuid UNIQUE,
  request_key uuid NOT NULL,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, request_key),
  CONSTRAINT metric_baselines_scope_unique UNIQUE (id, org_id, workspace_id),
  CHECK (period_end >= period_start AND period_end - period_start <= 366),
  CHECK ((basis = 'measured') = (measurement_id IS NOT NULL AND measurement_kind IS NOT NULL)),
  CHECK (supersedes_id IS NULL OR supersedes_id <> id),
  FOREIGN KEY (metric_id, org_id, workspace_id) REFERENCES public.metric_definitions(id, org_id, workspace_id),
  FOREIGN KEY (measurement_id, org_id, workspace_id) REFERENCES public.performance_measurements(id, org_id, workspace_id),
  FOREIGN KEY (supersedes_id, org_id, workspace_id) REFERENCES public.metric_baselines(id, org_id, workspace_id)
);
CREATE INDEX IF NOT EXISTS metric_baselines_metric_idx ON public.metric_baselines(metric_id, created_at DESC);
REVOKE ALL ON public.metric_baselines FROM anon, authenticated;
GRANT SELECT ON public.metric_baselines TO authenticated;
GRANT ALL ON public.metric_baselines TO service_role;
ALTER TABLE public.metric_baselines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS metric_baselines_read ON public.metric_baselines;
CREATE POLICY metric_baselines_read ON public.metric_baselines FOR SELECT TO authenticated
  USING (public.has_workspace_role(workspace_id, 'viewer'));

CREATE TABLE IF NOT EXISTS public.metric_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  metric_id uuid NOT NULL,
  withdrawn boolean NOT NULL DEFAULT false,
  value numeric CHECK (value > -1e15 AND value < 1e15),
  target_date date,
  period_kind text CHECK (period_kind IN ('month','quarter','year')),
  owner_id uuid,
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  supersedes_id uuid UNIQUE,
  request_key uuid NOT NULL,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, request_key),
  CONSTRAINT metric_targets_scope_unique UNIQUE (id, org_id, workspace_id),
  CHECK (withdrawn OR (value IS NOT NULL AND target_date IS NOT NULL AND period_kind IS NOT NULL)),
  CHECK (NOT withdrawn OR (value IS NULL AND supersedes_id IS NOT NULL)),
  CHECK (supersedes_id IS NULL OR supersedes_id <> id),
  FOREIGN KEY (metric_id, org_id, workspace_id) REFERENCES public.metric_definitions(id, org_id, workspace_id),
  FOREIGN KEY (supersedes_id, org_id, workspace_id) REFERENCES public.metric_targets(id, org_id, workspace_id)
);
CREATE INDEX IF NOT EXISTS metric_targets_metric_idx ON public.metric_targets(metric_id, created_at DESC);
REVOKE ALL ON public.metric_targets FROM anon, authenticated;
GRANT SELECT ON public.metric_targets TO authenticated;
GRANT ALL ON public.metric_targets TO service_role;
ALTER TABLE public.metric_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS metric_targets_read ON public.metric_targets;
CREATE POLICY metric_targets_read ON public.metric_targets FOR SELECT TO authenticated
  USING (public.has_workspace_role(workspace_id, 'viewer'));

CREATE OR REPLACE FUNCTION public.guard_metric_goal_history()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Baselines and targets are permanent history; set a new one instead';
END;
$$;
REVOKE ALL ON FUNCTION public.guard_metric_goal_history() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS metric_baselines_permanent ON public.metric_baselines;
CREATE TRIGGER metric_baselines_permanent BEFORE UPDATE OR DELETE ON public.metric_baselines
  FOR EACH ROW EXECUTE FUNCTION public.guard_metric_goal_history();
DROP TRIGGER IF EXISTS metric_targets_permanent ON public.metric_targets;
CREATE TRIGGER metric_targets_permanent BEFORE UPDATE OR DELETE ON public.metric_targets
  FOR EACH ROW EXECUTE FUNCTION public.guard_metric_goal_history();

-- Set (or replace) a metric's baseline. _measurement given => basis 'measured' and the database copies value and
-- period from that recorded actual result; otherwise value, period and source are required.
CREATE OR REPLACE FUNCTION public.set_metric_baseline(
  _metric uuid, _request uuid, _measurement uuid, _value numeric, _period_start date, _period_end date,
  _source text, _note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m public.metric_definitions%ROWTYPE;
  pm public.performance_measurements%ROWTYPE;
  prior public.metric_baselines%ROWTYPE;
  cur public.metric_baselines%ROWTYPE;
  new_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF _request IS NULL THEN RAISE EXCEPTION 'Request key required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO m FROM public.metric_definitions WHERE id = _metric FOR UPDATE;
  IF NOT FOUND OR NOT public.has_workspace_role(m.workspace_id, 'editor') THEN
    RAISE EXCEPTION 'Metric unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO prior FROM public.metric_baselines WHERE workspace_id = m.workspace_id AND request_key = _request;
  IF FOUND THEN
    IF prior.metric_id = m.id THEN RETURN jsonb_build_object('baseline_id', prior.id, 'status', 'existing'); END IF;
    RAISE EXCEPTION 'This request key was already used' USING ERRCODE = '22023';
  END IF;
  IF m.archived THEN RAISE EXCEPTION 'Archived metrics do not accept a new baseline' USING ERRCODE = 'P0001'; END IF;
  IF length(coalesce(_note,'')) > 500 THEN RAISE EXCEPTION 'Note too long' USING ERRCODE = '22023'; END IF;
  SELECT * INTO cur FROM public.metric_baselines b WHERE b.metric_id = m.id
    AND NOT EXISTS (SELECT 1 FROM public.metric_baselines x WHERE x.supersedes_id = b.id);
  IF _measurement IS NOT NULL THEN
    SELECT * INTO pm FROM public.performance_measurements WHERE id = _measurement;
    IF NOT FOUND OR pm.metric_id <> m.id OR pm.kind NOT IN ('manual_actual','imported_actual','verified_actual')
       OR EXISTS (SELECT 1 FROM public.performance_measurements c WHERE c.corrects_id = pm.id) THEN
      RAISE EXCEPTION 'A baseline can only use a current recorded result of this metric' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.metric_baselines(org_id, workspace_id, metric_id, basis, measurement_id, measurement_kind, value,
      period_start, period_end, source, note, supersedes_id, request_key, created_by)
    VALUES (m.org_id, m.workspace_id, m.id, 'measured', pm.id, pm.kind, pm.value, pm.period_start, pm.period_end,
      left(pm.source, 120), coalesce(trim(_note),''), cur.id, _request, auth.uid())
    RETURNING id INTO new_id;
  ELSE
    IF _value IS NULL OR _period_start IS NULL OR _period_end IS NULL OR _period_end < _period_start
       OR _period_end - _period_start > 366 OR _period_end > current_date
       OR length(trim(coalesce(_source,''))) NOT BETWEEN 1 AND 120
       OR (m.unit IN ('count','currency','days','ratio') AND _value < 0)
       OR (m.unit = 'percent' AND (_value < -1000 OR _value > 1000)) THEN
      RAISE EXCEPTION 'A baseline needs a valid value, a past period and its source' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.metric_baselines(org_id, workspace_id, metric_id, basis, value, period_start, period_end,
      source, note, supersedes_id, request_key, created_by)
    VALUES (m.org_id, m.workspace_id, m.id, 'manual', _value, _period_start, _period_end, trim(_source),
      coalesce(trim(_note),''), cur.id, _request, auth.uid())
    RETURNING id INTO new_id;
  END IF;
  RETURN jsonb_build_object('baseline_id', new_id, 'status', 'created', 'replaced', cur.id);
END;
$$;
REVOKE ALL ON FUNCTION public.set_metric_baseline(uuid,uuid,uuid,numeric,date,date,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_metric_baseline(uuid,uuid,uuid,numeric,date,date,text,text) TO authenticated;

-- Set, replace or withdraw (_withdraw) a metric's target. The owner, when named, must belong to the business.
CREATE OR REPLACE FUNCTION public.set_metric_target(
  _metric uuid, _request uuid, _value numeric, _target_date date, _period_kind text, _owner uuid, _note text,
  _withdraw boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m public.metric_definitions%ROWTYPE;
  prior public.metric_targets%ROWTYPE;
  cur public.metric_targets%ROWTYPE;
  new_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF _request IS NULL THEN RAISE EXCEPTION 'Request key required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO m FROM public.metric_definitions WHERE id = _metric FOR UPDATE;
  IF NOT FOUND OR NOT public.has_workspace_role(m.workspace_id, 'editor') THEN
    RAISE EXCEPTION 'Metric unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO prior FROM public.metric_targets WHERE workspace_id = m.workspace_id AND request_key = _request;
  IF FOUND THEN
    IF prior.metric_id = m.id THEN RETURN jsonb_build_object('target_id', prior.id, 'status', 'existing'); END IF;
    RAISE EXCEPTION 'This request key was already used' USING ERRCODE = '22023';
  END IF;
  IF length(coalesce(_note,'')) > 500 THEN RAISE EXCEPTION 'Note too long' USING ERRCODE = '22023'; END IF;
  SELECT * INTO cur FROM public.metric_targets t WHERE t.metric_id = m.id
    AND NOT EXISTS (SELECT 1 FROM public.metric_targets x WHERE x.supersedes_id = t.id);
  IF coalesce(_withdraw, false) THEN
    IF cur.id IS NULL OR cur.withdrawn THEN RAISE EXCEPTION 'There is no target to withdraw' USING ERRCODE = 'P0001'; END IF;
    INSERT INTO public.metric_targets(org_id, workspace_id, metric_id, withdrawn, note, supersedes_id, request_key, created_by)
    VALUES (m.org_id, m.workspace_id, m.id, true, coalesce(trim(_note),''), cur.id, _request, auth.uid())
    RETURNING id INTO new_id;
    RETURN jsonb_build_object('target_id', new_id, 'status', 'withdrawn');
  END IF;
  IF m.archived THEN RAISE EXCEPTION 'Archived metrics do not accept a new target' USING ERRCODE = 'P0001'; END IF;
  IF _value IS NULL OR _target_date IS NULL OR _target_date < current_date
     OR coalesce(_period_kind,'') NOT IN ('month','quarter','year')
     OR (m.unit IN ('count','currency','days','ratio') AND _value < 0)
     OR (m.unit = 'percent' AND (_value < -1000 OR _value > 1000)) THEN
    RAISE EXCEPTION 'A target needs a valid value, a future date and a measurement period' USING ERRCODE = '22023';
  END IF;
  IF _owner IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.organization_members om WHERE om.org_id = m.org_id AND om.user_id = _owner
         AND (om.role = 'owner' OR EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = m.workspace_id AND wm.user_id = _owner))) THEN
    RAISE EXCEPTION 'The owner must be a member of this business' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.metric_targets(org_id, workspace_id, metric_id, value, target_date, period_kind, owner_id, note,
    supersedes_id, request_key, created_by)
  VALUES (m.org_id, m.workspace_id, m.id, _value, _target_date, _period_kind, _owner, coalesce(trim(_note),''),
    cur.id, _request, auth.uid())
  RETURNING id INTO new_id;
  RETURN jsonb_build_object('target_id', new_id, 'status', 'created', 'replaced', cur.id);
END;
$$;
REVOKE ALL ON FUNCTION public.set_metric_target(uuid,uuid,numeric,date,text,uuid,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_metric_target(uuid,uuid,numeric,date,text,uuid,text,boolean) TO authenticated;
