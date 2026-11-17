-- Turn an approved Growth Plan initiative into durable internal work.
-- The initiative row is the idempotency anchor; no external action is performed.
ALTER TABLE public.growth_initiatives
  ADD COLUMN project_id uuid UNIQUE,
  ADD CONSTRAINT growth_initiatives_project_scope_fk
    FOREIGN KEY(project_id, org_id, workspace_id)
    REFERENCES public.projects(id, org_id, workspace_id);

CREATE OR REPLACE FUNCTION public.create_growth_initiative_work(_initiative uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  initiative_row public.growth_initiatives%ROWTYPE;
  plan_row public.growth_plan_versions%ROWTYPE;
  strategy_row public.growth_strategies%ROWTYPE;
  project_uuid uuid;
  task_uuid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO initiative_row FROM public.growth_initiatives WHERE id = _initiative FOR UPDATE;
  IF NOT FOUND OR NOT public.has_workspace_role(initiative_row.workspace_id, 'member') THEN
    RAISE EXCEPTION 'Initiative unavailable';
  END IF;
  IF initiative_row.project_id IS NOT NULL THEN
    RETURN jsonb_build_object('initiative_id', initiative_row.id, 'project_id', initiative_row.project_id, 'status', initiative_row.status);
  END IF;
  SELECT * INTO plan_row FROM public.growth_plan_versions WHERE id = initiative_row.plan_version_id FOR UPDATE;
  IF NOT FOUND OR plan_row.status <> 'approved' THEN
    RAISE EXCEPTION 'Only initiatives in an approved Growth Plan can become work';
  END IF;
  SELECT * INTO strategy_row FROM public.growth_strategies WHERE id = plan_row.strategy_id;
  IF NOT FOUND OR jsonb_typeof(strategy_row.body->'actions') IS DISTINCT FROM 'array'
     OR jsonb_array_length(strategy_row.body->'actions') <= initiative_row.sort_order THEN
    RAISE EXCEPTION 'Source strategy action is unavailable';
  END IF;
  INSERT INTO public.projects(org_id, workspace_id, title, description, objective, category, goal_id, created_by)
  VALUES (initiative_row.org_id, initiative_row.workspace_id, left(initiative_row.title,200),
    left(initiative_row.detail,4000), left(initiative_row.title,1000), 'growth', initiative_row.goal_id, auth.uid())
  RETURNING id INTO project_uuid;
  INSERT INTO public.tasks(org_id, workspace_id, project_id, title, description, due_date, priority, labels, created_by)
  VALUES (initiative_row.org_id, initiative_row.workspace_id, project_uuid, left(initiative_row.title,200),
    left(initiative_row.detail,800), current_date + (least(26,greatest(1,initiative_row.target_week))*7),
    CASE WHEN initiative_row.effort='high' THEN 'high' WHEN initiative_row.effort='low' THEN 'low' ELSE 'medium' END,
    CASE WHEN initiative_row.channel<>'' THEN ARRAY['growth-plan',left(initiative_row.channel,40)] ELSE ARRAY['growth-plan'] END,
    auth.uid()) RETURNING id INTO task_uuid;
  UPDATE public.growth_initiatives SET project_id=project_uuid,status='in_progress' WHERE id=initiative_row.id;
  RETURN jsonb_build_object('initiative_id',initiative_row.id,'project_id',project_uuid,'task_id',task_uuid,'status','created');
END;
$$;
REVOKE ALL ON FUNCTION public.create_growth_initiative_work(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_growth_initiative_work(uuid) TO authenticated;
