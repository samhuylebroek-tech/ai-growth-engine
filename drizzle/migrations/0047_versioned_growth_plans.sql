-- Persist generated strategies as versioned, reviewable growth plans.
-- A saved AI strategy remains a suggestion until an authorized workspace admin approves it.
CREATE TABLE public.growth_plan_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  goal_id uuid NOT NULL,
  strategy_id uuid NOT NULL UNIQUE REFERENCES public.growth_strategies(id),
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','superseded','rejected')),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  strategic_thesis text NOT NULL DEFAULT '' CHECK (length(strategic_thesis) <= 4000),
  summary text NOT NULL CHECK (length(summary) BETWEEN 1 AND 4000),
  plan_snapshot jsonb NOT NULL CHECK (jsonb_typeof(plan_snapshot) = 'object' AND length(plan_snapshot::text) <= 60000),
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid,
  approved_at timestamptz,
  UNIQUE(goal_id, version),
  UNIQUE(id, org_id, workspace_id),
  FOREIGN KEY(goal_id, org_id, workspace_id) REFERENCES public.growth_goals(id, org_id, workspace_id),
  CHECK ((status = 'approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
      OR (status <> 'approved' AND approved_by IS NULL AND approved_at IS NULL))
);
CREATE INDEX growth_plan_versions_goal_idx
  ON public.growth_plan_versions(goal_id, version DESC);
GRANT SELECT ON public.growth_plan_versions TO authenticated;
GRANT ALL ON public.growth_plan_versions TO service_role;
ALTER TABLE public.growth_plan_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY growth_plan_versions_read
  ON public.growth_plan_versions FOR SELECT TO authenticated
  USING (public.has_workspace_role(workspace_id, 'viewer'));

CREATE TABLE public.growth_initiatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  plan_version_id uuid NOT NULL,
  goal_id uuid NOT NULL,
  sort_order integer NOT NULL CHECK (sort_order >= 0),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  detail text NOT NULL DEFAULT '' CHECK (length(detail) <= 2000),
  channel text NOT NULL DEFAULT '' CHECK (length(channel) <= 80),
  target_week integer NOT NULL DEFAULT 1 CHECK (target_week BETWEEN 1 AND 52),
  effort text NOT NULL DEFAULT 'medium' CHECK (effort IN ('low','medium','high')),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','completed','paused','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(plan_version_id, sort_order),
  FOREIGN KEY(plan_version_id, org_id, workspace_id)
    REFERENCES public.growth_plan_versions(id, org_id, workspace_id),
  FOREIGN KEY(goal_id, org_id, workspace_id)
    REFERENCES public.growth_goals(id, org_id, workspace_id)
);
CREATE INDEX growth_initiatives_goal_idx ON public.growth_initiatives(goal_id, status);
GRANT SELECT ON public.growth_initiatives TO authenticated;
GRANT ALL ON public.growth_initiatives TO service_role;
ALTER TABLE public.growth_initiatives ENABLE ROW LEVEL SECURITY;
CREATE POLICY growth_initiatives_read
  ON public.growth_initiatives FOR SELECT TO authenticated
  USING (public.has_workspace_role(workspace_id, 'viewer'));

-- Create one immutable draft plan per saved strategy; retry returns the original plan.
CREATE OR REPLACE FUNCTION public.create_growth_plan_draft(_strategy uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.growth_strategies%ROWTYPE;
  p public.growth_plan_versions%ROWTYPE;
  a jsonb;
  i integer := 0;
  actions jsonb;
  new_id uuid;
  next_version integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO s FROM public.growth_strategies WHERE id = _strategy FOR UPDATE;
  IF NOT FOUND OR NOT public.has_workspace_role(s.workspace_id, 'member') THEN
    RAISE EXCEPTION 'Strategy unavailable';
  END IF;
  SELECT * INTO p FROM public.growth_plan_versions WHERE strategy_id = s.id;
  IF FOUND THEN
    RETURN jsonb_build_object('plan_id', p.id, 'version', p.version, 'status', p.status);
  END IF;
  actions := s.body->'actions';
  IF jsonb_typeof(actions) IS DISTINCT FROM 'array'
     OR jsonb_array_length(actions) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'Strategy actions are invalid';
  END IF;
  -- Serialize version allocation per goal, even when two strategies are converted concurrently.
  PERFORM 1 FROM public.growth_goals
    WHERE id = s.goal_id AND org_id = s.org_id AND workspace_id = s.workspace_id
    FOR UPDATE;
  SELECT coalesce(max(version), 0) + 1 INTO next_version
    FROM public.growth_plan_versions WHERE goal_id = s.goal_id;
  INSERT INTO public.growth_plan_versions(
    org_id, workspace_id, goal_id, strategy_id, version, title,
    strategic_thesis, summary, plan_snapshot, created_by
  ) VALUES (
    s.org_id, s.workspace_id, s.goal_id, s.id, next_version,
    left('Growth plan · ' || s.summary, 200),
    left(coalesce(s.body->>'summary', s.summary), 4000),
    s.summary, s.body, auth.uid()
  ) RETURNING id INTO new_id;

  FOR a IN SELECT value FROM jsonb_array_elements(actions)
  LOOP
    IF length(trim(coalesce(a->>'title',''))) NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'Strategy initiative title is invalid';
    END IF;
    INSERT INTO public.growth_initiatives(
      org_id, workspace_id, plan_version_id, goal_id, sort_order,
      title, detail, channel, target_week, effort
    ) VALUES (
      s.org_id, s.workspace_id, new_id, s.goal_id, i,
      trim(a->>'title'), left(coalesce(a->>'detail',''), 2000),
      left(coalesce(a->>'channel',''), 80),
      least(52, greatest(1, coalesce((a->>'week')::integer, 1))),
      CASE WHEN a->>'effort' IN ('low','high') THEN a->>'effort' ELSE 'medium' END
    );
    i := i + 1;
  END LOOP;
  RETURN jsonb_build_object('plan_id', new_id, 'version', next_version, 'status', 'draft');
END;
$$;
REVOKE ALL ON FUNCTION public.create_growth_plan_draft(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_growth_plan_draft(uuid) TO authenticated;

-- Only workspace admins/owners may approve. Approval supersedes the prior approved version.
CREATE OR REPLACE FUNCTION public.approve_growth_plan(_plan uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.growth_plan_versions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO p FROM public.growth_plan_versions WHERE id = _plan FOR UPDATE;
  IF NOT FOUND OR NOT public.has_workspace_role(p.workspace_id, 'admin') THEN
    RAISE EXCEPTION 'Plan approval requires workspace admin permission';
  END IF;
  IF p.status = 'approved' THEN
    RETURN jsonb_build_object('plan_id', p.id, 'status', p.status, 'approved_at', p.approved_at);
  END IF;
  IF p.status <> 'draft' THEN RAISE EXCEPTION 'Only draft plans can be approved'; END IF;
  UPDATE public.growth_plan_versions
    SET status = 'superseded'
    WHERE goal_id = p.goal_id AND status = 'approved';
  UPDATE public.growth_plan_versions
    SET status = 'approved', approved_by = auth.uid(), approved_at = now()
    WHERE id = p.id;
  RETURN jsonb_build_object('plan_id', p.id, 'status', 'approved', 'approved_at', now());
END;
$$;
REVOKE ALL ON FUNCTION public.approve_growth_plan(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_growth_plan(uuid) TO authenticated;

-- Approved/superseded plans are immutable. Draft metadata is not client-writable either:
-- changes must be made by creating a new strategy and a new plan version.
CREATE OR REPLACE FUNCTION public.guard_growth_plan_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- The sole permitted update to a previously approved version is superseding it
  -- when a newer version is approved. All plan content remains byte-for-byte stable.
  IF OLD.status = 'approved' AND NEW.status = 'superseded'
     AND (to_jsonb(NEW) - 'status') = (to_jsonb(OLD) - 'status') THEN
    RETURN NEW;
  END IF;
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'Non-draft growth plans are immutable';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'approved_by' - 'approved_at')
     IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'approved_by' - 'approved_at') THEN
    RAISE EXCEPTION 'Growth plan content is immutable; create a new version';
  END IF;
  IF NEW.status NOT IN ('draft','approved','superseded','rejected') THEN
    RAISE EXCEPTION 'Invalid growth plan status';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER growth_plan_immutable
  BEFORE UPDATE ON public.growth_plan_versions
  FOR EACH ROW EXECUTE FUNCTION public.guard_growth_plan_immutability();
