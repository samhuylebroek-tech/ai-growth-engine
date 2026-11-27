-- Attach budget envelopes to approved Growth Plan initiatives without crossing tenant or goal scope.
ALTER TABLE public.budget_lines
  ADD COLUMN initiative_id uuid,
  ADD CONSTRAINT budget_lines_initiative_scope_fk
    FOREIGN KEY(initiative_id, org_id, workspace_id)
    REFERENCES public.growth_initiatives(id, org_id, workspace_id);
CREATE INDEX budget_lines_initiative_idx
  ON public.budget_lines(initiative_id, period_month) WHERE initiative_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_budget_initiative_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE initiative_goal uuid; plan_status text;
BEGIN
  IF NEW.initiative_id IS NULL THEN RETURN NEW; END IF;
  SELECT i.goal_id, p.status INTO initiative_goal, plan_status
    FROM public.growth_initiatives i
    JOIN public.growth_plan_versions p ON p.id = i.plan_version_id
    WHERE i.id = NEW.initiative_id
      AND i.org_id = NEW.org_id AND i.workspace_id = NEW.workspace_id;
  IF NOT FOUND OR initiative_goal IS DISTINCT FROM NEW.goal_id THEN
    RAISE EXCEPTION 'Budget initiative must belong to the selected goal and workspace';
  END IF;
  IF plan_status <> 'approved' THEN
    RAISE EXCEPTION 'Budget can only be assigned to an approved Growth Plan initiative';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER budget_initiative_link_guard
  BEFORE INSERT OR UPDATE OF initiative_id, goal_id, org_id, workspace_id
  ON public.budget_lines FOR EACH ROW
  EXECUTE FUNCTION public.guard_budget_initiative_link();
REVOKE ALL ON FUNCTION public.guard_budget_initiative_link() FROM PUBLIC;
