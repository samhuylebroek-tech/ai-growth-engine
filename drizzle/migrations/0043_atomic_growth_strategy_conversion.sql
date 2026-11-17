-- Convert one saved growth strategy into a project and its selected tasks atomically.
-- The unique strategy_id makes retries safe across page reloads and uncertain network responses.
CREATE TABLE public.growth_strategy_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  strategy_id uuid NOT NULL UNIQUE REFERENCES public.growth_strategies(id),
  project_id uuid NOT NULL UNIQUE REFERENCES public.projects(id),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (org_id = public.ws_org(workspace_id))
);
GRANT SELECT ON public.growth_strategy_conversions TO authenticated;
GRANT ALL ON public.growth_strategy_conversions TO service_role;
ALTER TABLE public.growth_strategy_conversions ENABLE ROW LEVEL SECURITY;
CREATE POLICY growth_strategy_conversions_read
  ON public.growth_strategy_conversions FOR SELECT TO authenticated
  USING (public.has_workspace_role(workspace_id, 'viewer'));

CREATE OR REPLACE FUNCTION public.create_growth_strategy_project(_strategy uuid, _selected jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  strategy_row public.growth_strategies%ROWTYPE;
  existing jsonb;
  project_uuid uuid;
  task_uuid uuid;
  task_ids jsonb := '[]'::jsonb;
  selected_index integer;
  action_row jsonb;
  action_count integer;
  project_title text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO strategy_row
    FROM public.growth_strategies
    WHERE id = _strategy
    FOR UPDATE;
  IF NOT FOUND OR NOT public.has_workspace_role(strategy_row.workspace_id, 'member') THEN
    RAISE EXCEPTION 'Strategy unavailable';
  END IF;

  SELECT result INTO existing
    FROM public.growth_strategy_conversions
    WHERE strategy_id = strategy_row.id;
  IF existing IS NOT NULL THEN RETURN existing; END IF;

  IF jsonb_typeof(_selected) IS DISTINCT FROM 'array'
     OR jsonb_array_length(_selected) NOT BETWEEN 1 AND 20
     OR jsonb_typeof(strategy_row.body->'actions') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Select between 1 and 20 strategy actions';
  END IF;

  action_count := jsonb_array_length(strategy_row.body->'actions');
  IF action_count < 1 OR action_count > 20 THEN
    RAISE EXCEPTION 'Saved strategy actions are invalid';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(_selected) v
    WHERE jsonb_typeof(v) <> 'number'
       OR (v #>> '{}') !~ '^[0-9]+$'
       OR (v #>> '{}')::integer < 0
       OR (v #>> '{}')::integer >= action_count
  ) OR (SELECT count(*) FROM jsonb_array_elements(_selected))
       <> (SELECT count(DISTINCT (v #>> '{}')::integer) FROM jsonb_array_elements(_selected) v) THEN
    RAISE EXCEPTION 'Selected strategy actions are invalid';
  END IF;

  project_title := left('Strategy: ' || strategy_row.summary, 200);
  INSERT INTO public.projects(org_id, workspace_id, title, objective, category, goal_id, created_by)
  VALUES (
    strategy_row.org_id, strategy_row.workspace_id, project_title,
    left(strategy_row.summary, 1000), 'growth', strategy_row.goal_id, auth.uid()
  ) RETURNING id INTO project_uuid;

  FOR selected_index IN
    SELECT (value #>> '{}')::integer
    FROM jsonb_array_elements(_selected)
    ORDER BY (value #>> '{}')::integer
  LOOP
    action_row := strategy_row.body->'actions'->selected_index;
    IF length(trim(coalesce(action_row->>'title', ''))) NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'Strategy action title is invalid';
    END IF;
    INSERT INTO public.tasks(
      org_id, workspace_id, project_id, title, description, due_date, priority, labels, created_by
    ) VALUES (
      strategy_row.org_id, strategy_row.workspace_id, project_uuid,
      trim(action_row->>'title'),
      left(coalesce(action_row->>'detail', ''), 800),
      current_date + (least(26, greatest(1, coalesce((action_row->>'week')::integer, 1))) * 7),
      CASE WHEN action_row->>'effort' = 'high' THEN 'high' ELSE 'medium' END,
      CASE WHEN length(trim(coalesce(action_row->>'channel', ''))) > 0
        THEN ARRAY['strategy', left(trim(action_row->>'channel'), 40)]
        ELSE ARRAY['strategy'] END,
      auth.uid()
    ) RETURNING id INTO task_uuid;
    task_ids := task_ids || jsonb_build_array(task_uuid);
  END LOOP;

  existing := jsonb_build_object(
    'kind', 'growth_strategy',
    'strategy_id', strategy_row.id,
    'project_id', project_uuid,
    'task_ids', task_ids
  );
  INSERT INTO public.growth_strategy_conversions(
    org_id, workspace_id, strategy_id, project_id, result, created_by
  ) VALUES (
    strategy_row.org_id, strategy_row.workspace_id, strategy_row.id,
    project_uuid, existing, auth.uid()
  );
  RETURN existing;
END;
$$;

REVOKE ALL ON FUNCTION public.create_growth_strategy_project(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_growth_strategy_project(uuid, jsonb) TO authenticated;
