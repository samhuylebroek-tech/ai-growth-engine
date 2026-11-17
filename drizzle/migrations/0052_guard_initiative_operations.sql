-- Operational metadata and status changes are only valid while the plan is approved.
CREATE OR REPLACE FUNCTION public.guard_growth_initiative_operations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  plan_status text;
BEGIN
  SELECT p.status INTO plan_status
  FROM public.growth_initiatives i
  JOIN public.growth_plan_versions p ON p.id = i.plan_version_id
  WHERE i.id = NEW.initiative_id
    AND i.org_id = NEW.org_id
    AND i.workspace_id = NEW.workspace_id;
  IF plan_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'Initiative operations require an approved Growth Plan';
  END IF;
  IF NEW.owner_id IS NOT NULL
     AND NOT public.execution_user_allowed(NEW.workspace_id, NEW.owner_id) THEN
    RAISE EXCEPTION 'Owner needs workspace member access';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER growth_initiative_operations_guard
  BEFORE INSERT OR UPDATE ON public.growth_initiative_operations
  FOR EACH ROW EXECUTE FUNCTION public.guard_growth_initiative_operations();
