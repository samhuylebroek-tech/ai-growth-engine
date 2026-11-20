-- PROPOSED migration (not in the journal; not applied to the live database). Staging only via
-- scripts/staging/apply-proposal.ts. Idempotent. Depends on migration 0047 (versioned growth plans).
--
-- Every decision on a Growth Plan version is recorded, insert-only: approved, rejected or changes requested,
-- with who decided, when and why. Plans themselves stay immutable; "edit" means saving a new strategy, which
-- becomes a new draft version.
-- * Only workspace admins/owners decide (same rule as approve_growth_plan); only draft versions can be decided.
-- * Rejecting or requesting changes requires a reason; rejected versions are final.
-- * Decisions cannot be changed or deleted by anyone, including the table owner via the app roles.

CREATE TABLE IF NOT EXISTS public.growth_plan_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  plan_version_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved','rejected','changes_requested')),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  decided_by uuid NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (plan_version_id, org_id, workspace_id) REFERENCES public.growth_plan_versions(id, org_id, workspace_id),
  CHECK (decision = 'approved' OR length(trim(note)) >= 3)
);
CREATE INDEX IF NOT EXISTS growth_plan_decisions_plan_idx ON public.growth_plan_decisions(plan_version_id, decided_at DESC);
REVOKE ALL ON public.growth_plan_decisions FROM anon, authenticated;
GRANT SELECT ON public.growth_plan_decisions TO authenticated;
GRANT ALL ON public.growth_plan_decisions TO service_role;
ALTER TABLE public.growth_plan_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS growth_plan_decisions_read ON public.growth_plan_decisions;
CREATE POLICY growth_plan_decisions_read ON public.growth_plan_decisions FOR SELECT TO authenticated
  USING (public.has_workspace_role(workspace_id, 'viewer'));

CREATE OR REPLACE FUNCTION public.guard_growth_plan_decision_history() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Growth plan decisions are permanent';
END $$;
DROP TRIGGER IF EXISTS growth_plan_decisions_immutable ON public.growth_plan_decisions;
CREATE TRIGGER growth_plan_decisions_immutable BEFORE UPDATE OR DELETE ON public.growth_plan_decisions
  FOR EACH ROW EXECUTE FUNCTION public.guard_growth_plan_decision_history();

CREATE OR REPLACE FUNCTION public.decide_growth_plan(_plan uuid, _decision text, _note text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.growth_plan_versions%ROWTYPE; n text := left(trim(coalesce(_note, '')), 2000); d uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _decision NOT IN ('approved','rejected','changes_requested') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
  SELECT * INTO p FROM public.growth_plan_versions WHERE id = _plan;
  IF NOT FOUND OR NOT public.has_workspace_role(p.workspace_id, 'admin') THEN
    RAISE EXCEPTION 'Plan decisions require workspace admin permission';
  END IF;
  -- Same serialization as approval: one decision at a time per goal.
  PERFORM 1 FROM public.growth_goals WHERE id = p.goal_id AND org_id = p.org_id AND workspace_id = p.workspace_id FOR UPDATE;
  SELECT * INTO p FROM public.growth_plan_versions WHERE id = _plan FOR UPDATE;
  IF p.status <> 'draft' THEN RAISE EXCEPTION 'Only draft plans can be decided'; END IF;
  IF _decision <> 'approved' AND length(n) < 3 THEN RAISE EXCEPTION 'A reason is required'; END IF;
  IF _decision = 'approved' THEN
    PERFORM public.approve_growth_plan(_plan);
  ELSIF _decision = 'rejected' THEN
    UPDATE public.growth_plan_versions SET status = 'rejected' WHERE id = _plan;
  END IF;
  INSERT INTO public.growth_plan_decisions(org_id, workspace_id, plan_version_id, decision, note, decided_by)
  VALUES (p.org_id, p.workspace_id, p.id, _decision, n, auth.uid()) RETURNING id INTO d;
  INSERT INTO public.activity_events(org_id, workspace_id, entity_type, entity_id, actor_id, action, metadata)
  VALUES (p.org_id, p.workspace_id, 'growth_plan', p.id, auth.uid(), 'plan_' || _decision, jsonb_build_object('title', p.title, 'version', p.version));
  PERFORM public.log_audit(p.org_id, 'growth_plan.' || _decision, 'growth_plan_version', p.id::text, jsonb_build_object('version', p.version, 'goal_id', p.goal_id));
  RETURN jsonb_build_object('decision_id', d, 'plan_id', p.id, 'decision', _decision,
    'status', CASE _decision WHEN 'approved' THEN 'approved' WHEN 'rejected' THEN 'rejected' ELSE 'draft' END);
END $$;
REVOKE ALL ON FUNCTION public.decide_growth_plan(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_growth_plan(uuid, text, text) TO authenticated;
