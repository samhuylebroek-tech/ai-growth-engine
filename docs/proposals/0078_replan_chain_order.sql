-- PROPOSED migration 0078 (staging only until approved): re-planning keeps the dependency order along a chain.
-- A shift may name the task it waits on ("after": the re-planned task or an earlier shift in the same option). When
-- an option is approved, the re-planned task is updated first and every shift lands after the task it waits on as it
-- is now, so an adjusted (later) deadline also pushes the chain and no dependent ends on or before its prerequisite.
-- Replaces propose_task_replan and decide_task_replan from 0077; tables and grants are unchanged.

CREATE OR REPLACE FUNCTION public.propose_task_replan(_workspace uuid, _request uuid, _task uuid, _p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w public.workspaces; t public.tasks; prior public.task_replan_proposals; opt jsonb; sh jsonb; keys text[] := '{}';
  shift_ids uuid[] := '{}'; id_ uuid; reasons text[];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  SELECT * INTO w FROM public.workspaces WHERE id = _workspace;
  IF w.id IS NULL OR NOT public.has_workspace_role(w.id, 'member') THEN RAISE EXCEPTION 'business not found' USING ERRCODE = '42501'; END IF;
  IF _request IS NULL OR jsonb_typeof(_p) IS DISTINCT FROM 'object'
     OR (_p - ARRAY['origin','reasons','options','impact','risk','credit_impact','rationale']) <> '{}'::jsonb
     OR jsonb_typeof(_p->'reasons') IS DISTINCT FROM 'array' OR jsonb_typeof(_p->'options') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid replan proposal' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO prior FROM public.task_replan_proposals WHERE workspace_id = w.id AND request_key = _request;
  IF prior.id IS NOT NULL THEN RETURN jsonb_build_object('id', prior.id, 'status', 'existing'); END IF;
  SELECT * INTO t FROM public.tasks WHERE id = _task AND workspace_id = w.id FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'task not found' USING ERRCODE = '22023'; END IF;
  IF t.status IN ('done','cancelled') THEN RAISE EXCEPTION 'replan_task_closed' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (SELECT 1 FROM public.task_replan_proposals p WHERE p.task_id = t.id
             AND NOT EXISTS (SELECT 1 FROM public.task_replan_decisions d WHERE d.proposal_id = p.id AND d.decision <> 'postponed')) THEN
    RAISE EXCEPTION 'replan_already_open' USING ERRCODE = 'P0001';
  END IF;
  SELECT array_agg(DISTINCT x) INTO reasons FROM jsonb_array_elements_text(_p->'reasons') x;
  IF reasons IS NULL OR cardinality(reasons) > 8
     OR NOT reasons <@ ARRAY['overdue','blocked','failed','dependency_late','awaiting_approval','no_owner','less_relevant','over_budget']::text[]
     OR coalesce(_p->>'origin','team') NOT IN ('rule','team') OR coalesce(_p->>'risk','medium') NOT IN ('low','medium','high')
     OR coalesce((_p->>'credit_impact')::int, 0) NOT BETWEEN 0 AND 1000
     OR jsonb_typeof(coalesce(_p->'impact','{}'::jsonb)) <> 'object' OR length(coalesce(_p->'impact','{}'::jsonb)::text) > 4000 THEN
    RAISE EXCEPTION 'invalid replan proposal' USING ERRCODE = '22023';
  END IF;
  FOR opt IN SELECT * FROM jsonb_array_elements(_p->'options') LOOP
    IF jsonb_typeof(opt) <> 'object' OR (opt - ARRAY['key','kind','due_date','priority','shifts']) <> '{}'::jsonb
       OR coalesce(opt->>'key','') NOT IN ('a','b','c') OR (opt->>'key') = ANY(keys)
       OR coalesce(opt->>'kind','') NOT IN ('new_deadline','shift_chain','raise_priority','lower_priority')
       OR (opt->>'due_date' IS NOT NULL AND (opt->>'due_date')::date < current_date)
       OR (opt->>'priority' IS NOT NULL AND opt->>'priority' NOT IN ('low','medium','high','urgent'))
       OR (opt->>'due_date' IS NULL AND opt->>'priority' IS NULL)
       OR jsonb_typeof(coalesce(opt->'shifts','[]'::jsonb)) <> 'array' OR jsonb_array_length(coalesce(opt->'shifts','[]'::jsonb)) > 20 THEN
      RAISE EXCEPTION 'invalid replan option' USING ERRCODE = '22023';
    END IF;
    keys := keys || (opt->>'key');
    shift_ids := '{}';
    FOR sh IN SELECT * FROM jsonb_array_elements(coalesce(opt->'shifts','[]'::jsonb)) LOOP
      IF jsonb_typeof(sh) <> 'object' OR (sh - ARRAY['task_id','due_date','after']) <> '{}'::jsonb
         OR (sh->>'after' IS NOT NULL AND (sh->>'after')::uuid <> t.id AND NOT (sh->>'after')::uuid = ANY(shift_ids))
         OR (sh->>'due_date') IS NULL OR (sh->>'due_date')::date < current_date
         OR (sh->>'task_id')::uuid = t.id OR (sh->>'task_id')::uuid = ANY(shift_ids)
         OR NOT EXISTS (SELECT 1 FROM public.tasks x WHERE x.id = (sh->>'task_id')::uuid AND x.workspace_id = w.id AND x.status NOT IN ('done','cancelled')) THEN
        RAISE EXCEPTION 'invalid replan shift' USING ERRCODE = '22023';
      END IF;
      shift_ids := shift_ids || (sh->>'task_id')::uuid;
    END LOOP;
  END LOOP;
  INSERT INTO public.task_replan_proposals(org_id, workspace_id, task_id, request_key, origin, reasons, options, snapshot, impact, risk, credit_impact, rationale)
  VALUES (w.org_id, w.id, t.id, _request, coalesce(_p->>'origin','team'), reasons, _p->'options',
    jsonb_build_object('due_date', t.due_date, 'priority', t.priority, 'status', t.status, 'updated_at', t.updated_at),
    coalesce(_p->'impact','{}'::jsonb), coalesce(_p->>'risk','medium'), coalesce((_p->>'credit_impact')::int, 0), left(coalesce(_p->>'rationale',''), 1000))
  RETURNING id INTO id_;
  PERFORM public.log_audit(w.org_id, 'task.replan_proposed', 'task', t.id::text, jsonb_build_object('proposal', id_, 'reasons', reasons));
  RETURN jsonb_build_object('id', id_, 'status', 'created');
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
  RAISE EXCEPTION 'invalid replan proposal' USING ERRCODE = '22023';
END $$;
REVOKE ALL ON FUNCTION public.propose_task_replan(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propose_task_replan(uuid, uuid, uuid, jsonb) TO authenticated;

-- Decide. Approve applies option _option (deadline optionally adjusted by _due) to the task and the listed shifts.
CREATE OR REPLACE FUNCTION public.decide_task_replan(_proposal uuid, _decision text, _option text, _due date, _note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.task_replan_proposals; t public.tasks; x public.tasks; opt jsonb; sh jsonb; new_due date; new_pri text;
  moved jsonb := '[]'::jsonb; applied jsonb := '{}'::jsonb; id_ uuid; target date; prev_due date;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM public.task_replan_proposals WHERE id = _proposal;
  IF p.id IS NULL OR NOT public.has_workspace_role(p.workspace_id, 'editor') THEN RAISE EXCEPTION 'proposal not found' USING ERRCODE = '42501'; END IF;
  IF _decision NOT IN ('approved','rejected','postponed') OR length(coalesce(_note,'')) > 500 THEN RAISE EXCEPTION 'invalid decision' USING ERRCODE = '22023'; END IF;
  SELECT * INTO t FROM public.tasks WHERE id = p.task_id FOR UPDATE;  -- serialises decisions on this task
  IF EXISTS (SELECT 1 FROM public.task_replan_decisions WHERE proposal_id = p.id AND decision <> 'postponed') THEN
    RAISE EXCEPTION 'replan_already_decided' USING ERRCODE = 'P0001';
  END IF;
  IF _decision = 'approved' THEN
    SELECT o INTO opt FROM jsonb_array_elements(p.options) o WHERE o->>'key' = _option;
    IF opt IS NULL THEN RAISE EXCEPTION 'invalid option' USING ERRCODE = '22023'; END IF;
    IF t.status IN ('done','cancelled') THEN RAISE EXCEPTION 'replan_task_closed' USING ERRCODE = 'P0001'; END IF;
    IF t.updated_at IS DISTINCT FROM (p.snapshot->>'updated_at')::timestamptz THEN RAISE EXCEPTION 'replan_stale' USING ERRCODE = 'P0001'; END IF;
    IF _due IS NOT NULL AND _due < current_date THEN RAISE EXCEPTION 'invalid deadline' USING ERRCODE = '22023'; END IF;
    new_due := coalesce(_due, (opt->>'due_date')::date, t.due_date);
    new_pri := coalesce(opt->>'priority', t.priority);
    UPDATE public.tasks SET due_date = new_due, priority = new_pri WHERE id = t.id;
    FOR sh IN SELECT * FROM jsonb_array_elements(coalesce(opt->'shifts','[]'::jsonb)) LOOP
      SELECT * INTO x FROM public.tasks WHERE id = (sh->>'task_id')::uuid AND workspace_id = p.workspace_id FOR UPDATE;
      IF x.id IS NULL OR x.status IN ('done','cancelled') THEN CONTINUE; END IF;  -- closed meanwhile: leave it alone
      -- never move a dependent earlier than it already is, nor onto or before the task it waits on
      -- after the (possibly just moved) task it waits on; shifts are listed in dependency order
      SELECT due_date INTO prev_due FROM public.tasks WHERE id = coalesce((sh->>'after')::uuid, t.id);
      target := greatest((sh->>'due_date')::date, coalesce(prev_due, new_due) + 1);
      IF x.due_date IS NULL OR x.due_date < target THEN
        moved := moved || jsonb_build_object('task_id', x.id, 'from', x.due_date, 'to', target);
        UPDATE public.tasks SET due_date = target WHERE id = x.id;
      END IF;
    END LOOP;
    applied := jsonb_build_object('before', jsonb_build_object('due_date', t.due_date, 'priority', t.priority),
                                  'after', jsonb_build_object('due_date', new_due, 'priority', new_pri),
                                  'adjusted', _due IS NOT NULL, 'shifted', moved);
  END IF;
  INSERT INTO public.task_replan_decisions(org_id, workspace_id, proposal_id, decision, option_key, applied, note)
  VALUES (p.org_id, p.workspace_id, p.id, _decision, CASE WHEN _decision = 'approved' THEN _option END, applied, coalesce(_note,''))
  RETURNING id INTO id_;
  PERFORM public.log_audit(p.org_id, 'task.replan_' || _decision, 'task', p.task_id::text,
    jsonb_build_object('proposal', p.id, 'option', _option) || applied);
  RETURN jsonb_build_object('id', id_, 'decision', _decision, 'applied', applied);
END $$;
REVOKE ALL ON FUNCTION public.decide_task_replan(uuid, text, text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_task_replan(uuid, text, text, date, text) TO authenticated;

