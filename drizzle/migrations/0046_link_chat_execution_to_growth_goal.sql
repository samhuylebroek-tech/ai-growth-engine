-- Link chat-created execution work to a verified growth goal in the same workspace.
-- Replaces the prior RPC signature; the new argument is optional for backwards-compatible UX.
DROP FUNCTION IF EXISTS public.convert_execution_plan(uuid, uuid, text, uuid, jsonb);

CREATE OR REPLACE FUNCTION public.convert_execution_plan(
  _workspace uuid,
  _source uuid,
  _kind text,
  _request uuid,
  _plan jsonb,
  _goal uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  oid uuid;
  existing jsonb;
  parent uuid;
  taskid uuid;
  ids jsonb := '[]'::jsonb;
  item jsonb;
  resultj jsonb;
  titlev text;
BEGIN
  SELECT org_id INTO oid
  FROM public.workspaces
  WHERE id = _workspace
  FOR UPDATE;

  IF oid IS NULL OR NOT public.has_workspace_role(_workspace, 'member') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _kind NOT IN ('project', 'tasks', 'campaign') OR _request IS NULL THEN
    RAISE EXCEPTION 'Invalid conversion';
  END IF;
  IF _goal IS NOT NULL AND (
    _kind = 'tasks'
    OR NOT EXISTS (
      SELECT 1 FROM public.growth_goals g
      WHERE g.id = _goal AND g.org_id = oid AND g.workspace_id = _workspace
    )
  ) THEN
    RAISE EXCEPTION 'Growth goal unavailable in this workspace';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.id = _source AND m.role = 'assistant'
      AND c.workspace_id = _workspace AND c.org_id = oid AND c.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Source recommendation unavailable';
  END IF;

  SELECT result INTO existing
  FROM public.execution_conversions
  WHERE workspace_id = _workspace
    AND (request_key = _request OR (source_message_id = _source AND kind = _kind));
  IF existing IS NOT NULL THEN
    RETURN existing;
  END IF;

  IF jsonb_typeof(_plan->'tasks') IS DISTINCT FROM 'array'
     OR jsonb_array_length(_plan->'tasks') NOT BETWEEN 1 AND 40 THEN
    RAISE EXCEPTION 'Plan needs 1 to 40 tasks';
  END IF;
  titlev := trim(_plan->>'title');
  IF titlev IS NULL OR length(titlev) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Plan title is invalid';
  END IF;

  IF _kind = 'project' THEN
    INSERT INTO public.projects(org_id, workspace_id, title, description, objective, source_message_id, goal_id)
    VALUES (oid, _workspace, titlev, coalesce(_plan->>'description',''), coalesce(_plan->>'objective',''), _source, _goal)
    RETURNING id INTO parent;
  ELSIF _kind = 'campaign' THEN
    INSERT INTO public.campaigns(org_id, workspace_id, title, description, objective, category, source_message_id, goal_id)
    VALUES (oid, _workspace, titlev, coalesce(_plan->>'description',''), coalesce(_plan->>'objective',''), coalesce(_plan->>'category','marketing'), _source, _goal)
    RETURNING id INTO parent;
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(_plan->'tasks')
  LOOP
    IF length(trim(coalesce(item->>'title',''))) NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'Task title is invalid';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(_plan->'tasks') t
      WHERE lower(trim(t->>'title')) = lower(trim(item->>'title'))
      GROUP BY lower(trim(t->>'title'))
      HAVING count(*) > 1
    ) THEN
      RAISE EXCEPTION 'Duplicate task titles';
    END IF;
    INSERT INTO public.tasks(org_id, workspace_id, title, description, priority, due_date, owner_id, project_id, campaign_id, source_message_id)
    VALUES (
      oid, _workspace, trim(item->>'title'), coalesce(item->>'description',''),
      coalesce(item->>'priority','medium'), nullif(item->>'due_date','')::date,
      nullif(item->>'owner_id','')::uuid,
      CASE WHEN _kind = 'project' THEN parent END,
      CASE WHEN _kind = 'campaign' THEN parent END,
      _source
    )
    RETURNING id INTO taskid;
    ids := ids || jsonb_build_array(taskid);
  END LOOP;

  resultj := jsonb_build_object('kind', _kind, 'parent_id', parent, 'goal_id', _goal, 'task_ids', ids);
  INSERT INTO public.execution_conversions(org_id, workspace_id, source_message_id, kind, request_key, result)
  VALUES (oid, _workspace, _source, _kind, _request, resultj);
  RETURN resultj;
END;
$$;

REVOKE ALL ON FUNCTION public.convert_execution_plan(uuid, uuid, text, uuid, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.convert_execution_plan(uuid, uuid, text, uuid, jsonb, uuid) TO authenticated;
