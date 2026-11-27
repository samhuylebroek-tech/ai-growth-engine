-- Performance measurement layer: workspace metric definitions and insert-only measurements.
-- Each value carries its kind (planned / forecast / manual actual / imported actual / verified actual),
-- its source and an idempotency key. Corrections are new rows that replace exactly one earlier row,
-- so history is never rewritten and nothing is counted twice. Users can record planned, forecast and
-- manual actual values only; imported and verified values are reserved for future attested integrations.

CREATE TABLE public.metric_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,59}$'),
  label text NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 120),
  unit text NOT NULL CHECK (unit IN ('count','currency','percent','ratio','days')),
  currency text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  direction text NOT NULL DEFAULT 'increase' CHECK (direction IN ('increase','decrease')),
  goal_id uuid,
  initiative_id uuid,
  archived boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, key),
  CONSTRAINT metric_definitions_scope_unique UNIQUE (id, org_id, workspace_id),
  CHECK ((unit = 'currency') = (currency IS NOT NULL)),
  FOREIGN KEY (goal_id, org_id, workspace_id) REFERENCES public.growth_goals(id, org_id, workspace_id),
  FOREIGN KEY (initiative_id, org_id, workspace_id) REFERENCES public.growth_initiatives(id, org_id, workspace_id)
);
CREATE INDEX metric_definitions_goal_idx ON public.metric_definitions(goal_id) WHERE goal_id IS NOT NULL;
REVOKE ALL ON public.metric_definitions FROM anon, authenticated;
GRANT SELECT ON public.metric_definitions TO authenticated;
GRANT ALL ON public.metric_definitions TO service_role;
ALTER TABLE public.metric_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY metric_definitions_read ON public.metric_definitions FOR SELECT TO authenticated
  USING (public.has_workspace_role(workspace_id, 'viewer'));

CREATE TABLE public.performance_measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  metric_id uuid NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('planned','forecast','manual_actual','imported_actual','verified_actual')),
  value numeric NOT NULL CHECK (value > -1e15 AND value < 1e15),
  source text NOT NULL CHECK (length(trim(source)) BETWEEN 1 AND 80),
  source_ref text NOT NULL DEFAULT '' CHECK (length(source_ref) <= 300),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  request_key uuid NOT NULL,
  corrects_id uuid UNIQUE,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, request_key),
  CONSTRAINT performance_measurements_scope_unique UNIQUE (id, org_id, workspace_id),
  CHECK (period_end >= period_start AND period_end - period_start <= 366),
  CHECK (corrects_id IS NULL OR corrects_id <> id),
  FOREIGN KEY (metric_id, org_id, workspace_id) REFERENCES public.metric_definitions(id, org_id, workspace_id),
  FOREIGN KEY (corrects_id, org_id, workspace_id) REFERENCES public.performance_measurements(id, org_id, workspace_id)
);
CREATE INDEX performance_measurements_metric_idx
  ON public.performance_measurements(metric_id, kind, period_start DESC);
REVOKE ALL ON public.performance_measurements FROM anon, authenticated;
GRANT SELECT ON public.performance_measurements TO authenticated;
GRANT ALL ON public.performance_measurements TO service_role;
ALTER TABLE public.performance_measurements ENABLE ROW LEVEL SECURITY;
CREATE POLICY performance_measurements_read ON public.performance_measurements FOR SELECT TO authenticated
  USING (public.has_workspace_role(workspace_id, 'viewer'));

-- Measurement rows are permanent history.
CREATE OR REPLACE FUNCTION public.guard_performance_measurement_history()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Measurements are permanent; record a correction instead';
END;
$$;
REVOKE ALL ON FUNCTION public.guard_performance_measurement_history() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER performance_measurements_permanent
  BEFORE UPDATE OR DELETE ON public.performance_measurements
  FOR EACH ROW EXECUTE FUNCTION public.guard_performance_measurement_history();

-- Metric identity (scope, key, unit, currency) never changes once values may refer to it.
CREATE OR REPLACE FUNCTION public.guard_metric_definition_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Metrics are archived, not deleted'; END IF;
  IF NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.key IS DISTINCT FROM OLD.key OR NEW.unit IS DISTINCT FROM OLD.unit
     OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Metric key, unit and currency cannot change; define a new metric';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_metric_definition_identity() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER metric_definitions_identity
  BEFORE UPDATE OR DELETE ON public.metric_definitions
  FOR EACH ROW EXECUTE FUNCTION public.guard_metric_definition_identity();

-- Define (or idempotently re-confirm) a metric. Members and above.
CREATE OR REPLACE FUNCTION public.define_metric(
  _workspace uuid, _key text, _label text, _unit text, _currency text,
  _direction text, _goal uuid, _initiative uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  w public.workspaces%ROWTYPE;
  m public.metric_definitions%ROWTYPE;
  cur text := nullif(upper(trim(coalesce(_currency,''))),'');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO w FROM public.workspaces WHERE id = _workspace;
  IF NOT FOUND OR NOT public.has_workspace_role(_workspace, 'member') THEN
    RAISE EXCEPTION 'Workspace unavailable';
  END IF;
  IF _unit <> 'currency' THEN cur := NULL; END IF;
  SELECT * INTO m FROM public.metric_definitions WHERE workspace_id = _workspace AND key = _key FOR UPDATE;
  IF FOUND THEN
    IF m.unit IS DISTINCT FROM _unit OR m.currency IS DISTINCT FROM cur THEN
      RAISE EXCEPTION 'A metric with this key already exists with a different unit or currency';
    END IF;
    RETURN jsonb_build_object('metric_id', m.id, 'status', 'existing');
  END IF;
  INSERT INTO public.metric_definitions(org_id, workspace_id, key, label, unit, currency, direction, goal_id, initiative_id, created_by)
  VALUES (w.org_id, w.id, _key, trim(_label), _unit, cur, coalesce(_direction,'increase'), _goal, _initiative, auth.uid())
  RETURNING * INTO m;
  RETURN jsonb_build_object('metric_id', m.id, 'status', 'created');
END;
$$;
REVOKE ALL ON FUNCTION public.define_metric(uuid,text,text,text,text,text,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.define_metric(uuid,text,text,text,text,text,uuid,uuid) TO authenticated;

-- Edit presentation and links, or archive. Identity stays fixed (trigger above).
CREATE OR REPLACE FUNCTION public.update_metric_definition(_metric uuid, _patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.metric_definitions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF jsonb_typeof(_patch) IS DISTINCT FROM 'object'
     OR (_patch - ARRAY['label','direction','goal_id','initiative_id','archived']) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'Invalid metric update';
  END IF;
  SELECT * INTO m FROM public.metric_definitions WHERE id = _metric FOR UPDATE;
  IF NOT FOUND OR NOT public.has_workspace_role(m.workspace_id, 'member') THEN
    RAISE EXCEPTION 'Metric unavailable';
  END IF;
  UPDATE public.metric_definitions SET
    label = CASE WHEN _patch ? 'label' THEN trim(_patch->>'label') ELSE label END,
    direction = CASE WHEN _patch ? 'direction' THEN _patch->>'direction' ELSE direction END,
    goal_id = CASE WHEN _patch ? 'goal_id' THEN nullif(_patch->>'goal_id','')::uuid ELSE goal_id END,
    initiative_id = CASE WHEN _patch ? 'initiative_id' THEN nullif(_patch->>'initiative_id','')::uuid ELSE initiative_id END,
    archived = CASE WHEN _patch ? 'archived' THEN (_patch->>'archived')::boolean ELSE archived END,
    updated_at = now()
  WHERE id = m.id RETURNING * INTO m;
  RETURN jsonb_build_object('metric_id', m.id, 'archived', m.archived);
END;
$$;
REVOKE ALL ON FUNCTION public.update_metric_definition(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_metric_definition(uuid,jsonb) TO authenticated;

-- Record a planned/forecast/manual value, or correct an earlier one. Idempotent per request key.
CREATE OR REPLACE FUNCTION public.record_measurement(
  _metric uuid, _kind text, _period_start date, _period_end date, _value numeric,
  _note text, _source_ref text, _request uuid, _corrects uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m public.metric_definitions%ROWTYPE;
  prior public.performance_measurements%ROWTYPE;
  old public.performance_measurements%ROWTYPE;
  new_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _request IS NULL THEN RAISE EXCEPTION 'Request key required'; END IF;
  -- Lock the metric: serializes duplicate and correction checks for all of its values.
  SELECT * INTO m FROM public.metric_definitions WHERE id = _metric FOR UPDATE;
  IF NOT FOUND OR NOT public.has_workspace_role(m.workspace_id, 'member') THEN
    RAISE EXCEPTION 'Metric unavailable';
  END IF;
  SELECT * INTO prior FROM public.performance_measurements WHERE workspace_id = m.workspace_id AND request_key = _request;
  IF FOUND THEN
    IF prior.metric_id = m.id AND prior.kind = _kind AND prior.period_start = _period_start
       AND prior.period_end = _period_end AND prior.value = _value
       AND prior.corrects_id IS NOT DISTINCT FROM _corrects THEN
      RETURN jsonb_build_object('measurement_id', prior.id, 'status', 'existing');
    END IF;
    RAISE EXCEPTION 'This request key was already used for a different value';
  END IF;
  IF m.archived THEN RAISE EXCEPTION 'Archived metrics do not accept new values'; END IF;
  IF _kind NOT IN ('planned','forecast','manual_actual') THEN
    RAISE EXCEPTION 'Imported and verified values come only from connected sources';
  END IF;
  IF _period_start IS NULL OR _period_end IS NULL OR _period_end < _period_start
     OR _period_end - _period_start > 366 THEN
    RAISE EXCEPTION 'Invalid measurement period';
  END IF;
  IF _value IS NULL
     OR (m.unit IN ('count','currency','days','ratio') AND _value < 0)
     OR (m.unit = 'percent' AND (_value < -1000 OR _value > 1000)) THEN
    RAISE EXCEPTION 'Value is not valid for this metric';
  END IF;
  IF _corrects IS NOT NULL THEN
    SELECT * INTO old FROM public.performance_measurements WHERE id = _corrects FOR UPDATE;
    IF NOT FOUND OR old.metric_id <> m.id OR old.kind <> _kind
       OR old.period_start <> _period_start OR old.period_end <> _period_end THEN
      RAISE EXCEPTION 'A correction must keep the same metric, kind and period';
    END IF;
    IF EXISTS (SELECT 1 FROM public.performance_measurements WHERE corrects_id = old.id) THEN
      RAISE EXCEPTION 'This value was already corrected; correct the latest value';
    END IF;
  ELSIF EXISTS (
    SELECT 1 FROM public.performance_measurements p
    WHERE p.metric_id = m.id AND p.kind = _kind AND p.period_start = _period_start AND p.period_end = _period_end
      AND NOT EXISTS (SELECT 1 FROM public.performance_measurements c WHERE c.corrects_id = p.id)
  ) THEN
    RAISE EXCEPTION 'A value already exists for this period; record a correction instead';
  END IF;
  INSERT INTO public.performance_measurements(org_id, workspace_id, metric_id, period_start, period_end, kind, value,
    source, source_ref, note, request_key, corrects_id, created_by)
  VALUES (m.org_id, m.workspace_id, m.id, _period_start, _period_end, _kind, _value,
    'manual', left(coalesce(_source_ref,''),300), left(coalesce(_note,''),500), _request, _corrects, auth.uid())
  RETURNING id INTO new_id;
  RETURN jsonb_build_object('measurement_id', new_id, 'status', 'created');
END;
$$;
REVOKE ALL ON FUNCTION public.record_measurement(uuid,text,date,date,numeric,text,text,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_measurement(uuid,text,date,date,numeric,text,text,uuid,uuid) TO authenticated;
