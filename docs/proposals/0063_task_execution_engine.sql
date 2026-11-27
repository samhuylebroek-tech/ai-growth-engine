-- PROPOSED migration (not in the journal; not applied to the live database). Staging only via
-- scripts/staging/apply-proposal.ts. Idempotent. Depends on migrations 0017 (tasks), 0031 (single AI
-- requests), 0061 proposal (uncertain outcomes) and 0062 proposal (none of its objects are required).
--
-- Task execution by AI specialists, with the database deciding every state change:
-- * execution_settings: per-workspace mode (1 analysis, 2 preparation, 3 every run approved, 4 bounded
--   autonomy), a hard credit cap per run and a monthly credit cap for task runs. Admins change it.
-- * task_execution_profiles: which specialist works on a task, its type (analysis, preparation,
--   external) and whether every run needs approval. External tasks are never run by AI here.
-- * task_runs: one row per execution attempt. Rows are written only by these functions; the AI call
--   itself goes through the existing single-request accounting (request key = run key), so a run is
--   charged once, never replayed, and an uncertain outcome is resolved by the existing step.
-- * A run never stays "running": its lease expires and reconcile_task_runs settles it from the
--   recorded AI request (succeeded, failed, or uncertain). Uncertain runs are never retried.
-- * History is written to activity_events against the task, so the task's existing timeline shows it.

CREATE TABLE IF NOT EXISTS public.execution_settings (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  mode smallint NOT NULL DEFAULT 2 CHECK (mode BETWEEN 1 AND 4),
  max_credits_per_run int NOT NULL DEFAULT 20 CHECK (max_credits_per_run BETWEEN 1 AND 50),
  monthly_credit_cap int NOT NULL DEFAULT 200 CHECK (monthly_credit_cap BETWEEN 0 AND 100000),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.execution_settings FROM anon, authenticated;
GRANT SELECT ON public.execution_settings TO authenticated;
GRANT ALL ON public.execution_settings TO service_role;
ALTER TABLE public.execution_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS execution_settings_read ON public.execution_settings;
CREATE POLICY execution_settings_read ON public.execution_settings FOR SELECT TO authenticated
  USING (public.has_workspace_role(workspace_id, 'viewer'));

CREATE TABLE IF NOT EXISTS public.task_execution_profiles (
  task_id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  specialist_key text NOT NULL CHECK (specialist_key IN ('business_analyst','market_research','growth_strategist','seo','content',
    'copywriter','marketing','advertising','linkedin','sales','crm','cro','partnership','event_marketing','revenue_analyst')),
  task_type text NOT NULL CHECK (task_type IN ('analysis','preparation','external')),
  requires_approval boolean NOT NULL DEFAULT false,
  assigned_by uuid NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (task_id, org_id, workspace_id) REFERENCES public.tasks(id, org_id, workspace_id)
);
REVOKE ALL ON public.task_execution_profiles FROM anon, authenticated;
GRANT SELECT ON public.task_execution_profiles TO authenticated;
GRANT ALL ON public.task_execution_profiles TO service_role;
ALTER TABLE public.task_execution_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS task_execution_profiles_read ON public.task_execution_profiles;
CREATE POLICY task_execution_profiles_read ON public.task_execution_profiles FOR SELECT TO authenticated
  USING (public.has_workspace_role(workspace_id, 'viewer'));

CREATE TABLE IF NOT EXISTS public.task_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  task_id uuid NOT NULL,
  request_key uuid NOT NULL,
  specialist_key text NOT NULL,
  task_type text NOT NULL CHECK (task_type IN ('analysis','preparation')),
  mode smallint NOT NULL,
  attempt int NOT NULL CHECK (attempt BETWEEN 1 AND 3),
  status text NOT NULL CHECK (status IN ('awaiting_approval','queued','paused','running','succeeded','failed','uncertain','cancelled','rejected')),
  estimated_credits int NOT NULL CHECK (estimated_credits BETWEEN 1 AND 50),
  credits_charged int,
  single_request_id uuid REFERENCES public.single_ai_requests(id),
  agent_run_id uuid REFERENCES public.agent_runs(id),
  output jsonb CHECK (output IS NULL OR length(output::text) <= 80000),
  error text CHECK (error IS NULL OR length(error) <= 500),
  decision_note text CHECK (decision_note IS NULL OR length(decision_note) <= 1000),
  decided_by uuid,
  lease_until timestamptz,
  requested_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, request_key),
  FOREIGN KEY (task_id, org_id, workspace_id) REFERENCES public.tasks(id, org_id, workspace_id)
);
-- At most one unfinished run per task, so the same work is never executed twice in parallel.
CREATE UNIQUE INDEX IF NOT EXISTS task_runs_one_active ON public.task_runs(task_id)
  WHERE status IN ('awaiting_approval','queued','paused','running','uncertain');
CREATE INDEX IF NOT EXISTS task_runs_workspace_idx ON public.task_runs(workspace_id, created_at DESC);
REVOKE ALL ON public.task_runs FROM anon, authenticated;
GRANT SELECT ON public.task_runs TO authenticated;
GRANT ALL ON public.task_runs TO service_role;
ALTER TABLE public.task_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS task_runs_read ON public.task_runs;
CREATE POLICY task_runs_read ON public.task_runs FOR SELECT TO authenticated
  USING (public.has_workspace_role(workspace_id, 'viewer'));

CREATE OR REPLACE FUNCTION public.guard_task_run_identity() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Task runs are permanent'; END IF;
  IF NEW.id <> OLD.id OR NEW.org_id <> OLD.org_id OR NEW.workspace_id <> OLD.workspace_id OR NEW.task_id <> OLD.task_id
     OR NEW.request_key <> OLD.request_key OR NEW.attempt <> OLD.attempt OR NEW.requested_by <> OLD.requested_by
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Task run identity is immutable';
  END IF;
  IF OLD.status IN ('succeeded','failed','cancelled','rejected') THEN RAISE EXCEPTION 'Finished task runs are permanent'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS task_runs_guard ON public.task_runs;
CREATE TRIGGER task_runs_guard BEFORE UPDATE OR DELETE ON public.task_runs FOR EACH ROW EXECUTE FUNCTION public.guard_task_run_identity();

-- Effective settings (defaults when a workspace has not chosen yet).
CREATE OR REPLACE FUNCTION public.task_execution_settings(_workspace uuid) RETURNS public.execution_settings
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT s FROM public.execution_settings s WHERE s.workspace_id = _workspace),
    ROW(_workspace, (SELECT org_id FROM public.workspaces WHERE id = _workspace), 2, 20, 200, NULL, now())::public.execution_settings)
$$;
REVOKE ALL ON FUNCTION public.task_execution_settings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.task_execution_settings(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.log_task_run_event(_r public.task_runs, _action text, _extra jsonb DEFAULT '{}')
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.activity_events(org_id, workspace_id, entity_type, entity_id, actor_id, action, metadata)
  VALUES (_r.org_id, _r.workspace_id, 'tasks', _r.task_id, auth.uid(), _action,
    jsonb_build_object('run_id', _r.id, 'specialist', _r.specialist_key, 'attempt', _r.attempt, 'status', _r.status) || coalesce(_extra, '{}'));
$$;
REVOKE ALL ON FUNCTION public.log_task_run_event(public.task_runs, text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_execution_settings(_workspace uuid, _mode int, _max_per_run int, _monthly_cap int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE oid uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_workspace_role(_workspace, 'admin') THEN RAISE EXCEPTION 'Execution settings require workspace admin permission'; END IF;
  SELECT org_id INTO oid FROM public.workspaces WHERE id = _workspace;
  INSERT INTO public.execution_settings(workspace_id, org_id, mode, max_credits_per_run, monthly_credit_cap, updated_by, updated_at)
  VALUES (_workspace, oid, _mode, _max_per_run, _monthly_cap, auth.uid(), now())
  ON CONFLICT (workspace_id) DO UPDATE SET mode = EXCLUDED.mode, max_credits_per_run = EXCLUDED.max_credits_per_run,
    monthly_credit_cap = EXCLUDED.monthly_credit_cap, updated_by = auth.uid(), updated_at = now();
  PERFORM public.log_audit(oid, 'execution.settings.updated', 'workspace', _workspace::text,
    jsonb_build_object('mode', _mode, 'max_credits_per_run', _max_per_run, 'monthly_credit_cap', _monthly_cap));
  RETURN to_jsonb(public.task_execution_settings(_workspace));
END $$;
REVOKE ALL ON FUNCTION public.set_execution_settings(uuid, int, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_execution_settings(uuid, int, int, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_task_specialist(_task uuid, _specialist text, _type text, _requires_approval boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.tasks%ROWTYPE; prev public.task_execution_profiles%ROWTYPE;
BEGIN
  SELECT * INTO t FROM public.tasks WHERE id = _task;
  IF auth.uid() IS NULL OR NOT FOUND OR NOT public.has_workspace_role(t.workspace_id, 'member') THEN RAISE EXCEPTION 'Assigning work requires workspace member permission'; END IF;
  PERFORM 1 FROM public.tasks WHERE id = _task FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.task_runs WHERE task_id = _task AND status IN ('queued','running','uncertain','awaiting_approval','paused')) THEN
    RAISE EXCEPTION 'This task has unfinished AI work; finish or cancel it before reassigning';
  END IF;
  SELECT * INTO prev FROM public.task_execution_profiles WHERE task_id = _task;
  -- Lowering an approval requirement set by someone else needs an admin.
  IF prev.task_id IS NOT NULL AND prev.requires_approval AND NOT coalesce(_requires_approval, false) AND NOT public.has_workspace_role(t.workspace_id, 'admin') THEN
    RAISE EXCEPTION 'Only an admin can remove an approval requirement';
  END IF;
  INSERT INTO public.task_execution_profiles(task_id, org_id, workspace_id, specialist_key, task_type, requires_approval, assigned_by)
  VALUES (_task, t.org_id, t.workspace_id, _specialist, _type, coalesce(_requires_approval, false), auth.uid())
  ON CONFLICT (task_id) DO UPDATE SET specialist_key = EXCLUDED.specialist_key, task_type = EXCLUDED.task_type,
    requires_approval = EXCLUDED.requires_approval, assigned_by = auth.uid(), assigned_at = now();
  INSERT INTO public.activity_events(org_id, workspace_id, entity_type, entity_id, actor_id, action, metadata)
  VALUES (t.org_id, t.workspace_id, 'tasks', t.id, auth.uid(), CASE WHEN prev.task_id IS NULL THEN 'specialist_assigned' ELSE 'specialist_reassigned' END,
    jsonb_build_object('specialist', _specialist, 'task_type', _type, 'requires_approval', coalesce(_requires_approval, false), 'previous', prev.specialist_key));
  RETURN jsonb_build_object('task_id', _task, 'specialist', _specialist, 'task_type', _type);
END $$;
REVOKE ALL ON FUNCTION public.assign_task_specialist(uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_task_specialist(uuid, text, text, boolean) TO authenticated;

-- Dependencies are the task's existing 'dependency' notes; each related task must be done.
CREATE OR REPLACE FUNCTION public.task_open_dependencies(_task uuid) RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int FROM public.execution_notes n JOIN public.tasks d ON d.id = n.related_id AND d.workspace_id = n.workspace_id
  WHERE n.entity_type = 'tasks' AND n.entity_id = _task AND n.kind = 'dependency' AND d.status NOT IN ('done','cancelled')
$$;
REVOKE ALL ON FUNCTION public.task_open_dependencies(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.task_open_dependencies(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.queue_task_run(_task uuid, _request uuid, _estimate int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.tasks%ROWTYPE; p public.task_execution_profiles%ROWTYPE; s public.execution_settings; r public.task_runs%ROWTYPE;
  used int; tries int; needs boolean;
BEGIN
  SELECT * INTO t FROM public.tasks WHERE id = _task;
  IF auth.uid() IS NULL OR NOT FOUND OR NOT public.has_workspace_role(t.workspace_id, 'member') THEN RAISE EXCEPTION 'Running work requires workspace member permission'; END IF;
  SELECT * INTO r FROM public.task_runs WHERE workspace_id = t.workspace_id AND request_key = _request;
  IF FOUND THEN
    IF r.task_id <> _task THEN RAISE EXCEPTION 'request key belongs to different work'; END IF;
    RETURN to_jsonb(r) - 'output';
  END IF;
  PERFORM 1 FROM public.tasks WHERE id = _task FOR UPDATE;
  IF t.status IN ('done','cancelled') THEN RAISE EXCEPTION 'This task is already closed'; END IF;
  SELECT * INTO p FROM public.task_execution_profiles WHERE task_id = _task;
  IF NOT FOUND THEN RAISE EXCEPTION 'Assign a specialist first'; END IF;
  IF p.task_type = 'external' THEN RAISE EXCEPTION 'External actions need a connected system and explicit approval; none is switched on'; END IF;
  s := public.task_execution_settings(t.workspace_id);
  IF p.task_type = 'preparation' AND s.mode < 2 THEN RAISE EXCEPTION 'This workspace allows analysis only'; END IF;
  IF _estimate IS NULL OR _estimate < 1 OR _estimate > s.max_credits_per_run THEN RAISE EXCEPTION 'Estimated cost is above the per-run limit'; END IF;
  IF public.task_open_dependencies(_task) > 0 THEN RAISE EXCEPTION 'Blocked: finish the tasks this one depends on first'; END IF;
  IF EXISTS (SELECT 1 FROM public.task_runs WHERE task_id = _task AND status IN ('awaiting_approval','queued','paused','running','uncertain')) THEN
    RAISE EXCEPTION 'This task already has unfinished AI work';
  END IF;
  IF EXISTS (SELECT 1 FROM public.task_runs WHERE task_id = _task AND status = 'uncertain') THEN RAISE EXCEPTION 'Resolve the uncertain run first'; END IF;
  SELECT count(*) INTO tries FROM public.task_runs WHERE task_id = _task AND status IN ('succeeded','failed','uncertain');
  IF tries >= 3 THEN RAISE EXCEPTION 'This task reached its limit of 3 AI runs'; END IF;
  SELECT coalesce(sum(coalesce(credits_charged, CASE WHEN status IN ('failed','cancelled','rejected') THEN 0 ELSE estimated_credits END)), 0) INTO used
    FROM public.task_runs WHERE workspace_id = t.workspace_id AND created_at >= date_trunc('month', now());
  IF used + _estimate > s.monthly_credit_cap THEN RAISE EXCEPTION 'This month''s credit limit for task runs would be exceeded'; END IF;
  needs := s.mode = 3 OR p.requires_approval;
  INSERT INTO public.task_runs(org_id, workspace_id, task_id, request_key, specialist_key, task_type, mode, attempt, status, estimated_credits, requested_by)
  VALUES (t.org_id, t.workspace_id, t.id, _request, p.specialist_key, p.task_type, s.mode, tries + 1,
    CASE WHEN needs THEN 'awaiting_approval' ELSE 'queued' END, _estimate, auth.uid()) RETURNING * INTO r;
  IF t.status = 'todo' THEN UPDATE public.tasks SET status = 'in_progress' WHERE id = t.id; END IF;
  PERFORM public.log_task_run_event(r, 'run_' || r.status, jsonb_build_object('estimated_credits', _estimate));
  RETURN to_jsonb(r) - 'output';
END $$;
REVOKE ALL ON FUNCTION public.queue_task_run(uuid, uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.queue_task_run(uuid, uuid, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.decide_task_run(_run uuid, _decision text, _note text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.task_runs%ROWTYPE; n text := left(trim(coalesce(_note, '')), 1000);
BEGIN
  SELECT * INTO r FROM public.task_runs WHERE id = _run FOR UPDATE;
  IF auth.uid() IS NULL OR NOT FOUND OR NOT public.has_workspace_role(r.workspace_id, 'admin') THEN RAISE EXCEPTION 'Approving AI work requires workspace admin permission'; END IF;
  IF r.status <> 'awaiting_approval' THEN RAISE EXCEPTION 'This run is not waiting for approval'; END IF;
  IF _decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Invalid decision'; END IF;
  IF _decision = 'rejected' AND length(n) < 3 THEN RAISE EXCEPTION 'A reason is required'; END IF;
  UPDATE public.task_runs SET status = CASE WHEN _decision = 'approved' THEN 'queued' ELSE 'rejected' END,
    decision_note = nullif(n, ''), decided_by = auth.uid(), finished_at = CASE WHEN _decision = 'rejected' THEN now() END
  WHERE id = _run RETURNING * INTO r;
  PERFORM public.log_task_run_event(r, 'run_' || _decision, jsonb_build_object('note', nullif(n, '')));
  RETURN to_jsonb(r) - 'output';
END $$;
REVOKE ALL ON FUNCTION public.decide_task_run(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_task_run(uuid, text, text) TO authenticated;

-- Pause, resume and cancel only before the AI call starts; a running call finishes or times out.
CREATE OR REPLACE FUNCTION public.control_task_run(_run uuid, _action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.task_runs%ROWTYPE; nxt text;
BEGIN
  SELECT * INTO r FROM public.task_runs WHERE id = _run FOR UPDATE;
  IF auth.uid() IS NULL OR NOT FOUND OR NOT public.has_workspace_role(r.workspace_id, 'member') THEN RAISE EXCEPTION 'Controlling AI work requires workspace member permission'; END IF;
  nxt := CASE
    WHEN _action = 'pause' AND r.status = 'queued' THEN 'paused'
    WHEN _action = 'resume' AND r.status = 'paused' THEN 'queued'
    WHEN _action = 'cancel' AND r.status IN ('queued','paused','awaiting_approval') THEN 'cancelled' END;
  IF nxt IS NULL THEN RAISE EXCEPTION 'This action is not possible in the run''s current state'; END IF;
  IF nxt = 'queued' AND public.task_open_dependencies(r.task_id) > 0 THEN RAISE EXCEPTION 'Blocked: finish the tasks this one depends on first'; END IF;
  UPDATE public.task_runs SET status = nxt, finished_at = CASE WHEN nxt = 'cancelled' THEN now() END WHERE id = _run RETURNING * INTO r;
  PERFORM public.log_task_run_event(r, 'run_' || nxt);
  RETURN to_jsonb(r) - 'output';
END $$;
REVOKE ALL ON FUNCTION public.control_task_run(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.control_task_run(uuid, text) TO authenticated;

-- Server-only steps (accounting proof): claim the run, link its AI request, record the outcome.
CREATE OR REPLACE FUNCTION public.start_task_run_verified(_run uuid, _proof text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.task_runs%ROWTYPE; s public.execution_settings;
BEGIN
  PERFORM public.verify_ai_accounting(_proof);
  SELECT * INTO r FROM public.task_runs WHERE id = _run FOR UPDATE;
  IF auth.uid() IS NULL OR NOT FOUND OR NOT public.has_workspace_role(r.workspace_id, 'member') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF r.status <> 'queued' THEN RAISE EXCEPTION 'This run is not ready to start'; END IF;
  IF public.task_open_dependencies(r.task_id) > 0 THEN RAISE EXCEPTION 'Blocked: finish the tasks this one depends on first'; END IF;
  s := public.task_execution_settings(r.workspace_id);
  IF r.task_type = 'preparation' AND s.mode < 2 THEN RAISE EXCEPTION 'This workspace allows analysis only'; END IF;
  IF (s.mode = 3 OR EXISTS (SELECT 1 FROM public.task_execution_profiles WHERE task_id = r.task_id AND requires_approval)) AND r.decided_by IS NULL THEN
    RAISE EXCEPTION 'This run needs approval';
  END IF;
  UPDATE public.task_runs SET status = 'running', started_at = now(), lease_until = now() + interval '4 minutes' WHERE id = _run RETURNING * INTO r;
  PERFORM public.log_task_run_event(r, 'run_started');
  RETURN to_jsonb(r) - 'output';
END $$;

CREATE OR REPLACE FUNCTION public.link_task_run_request_verified(_run uuid, _request uuid, _proof text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.task_runs%ROWTYPE; q public.single_ai_requests%ROWTYPE;
BEGIN
  PERFORM public.verify_ai_accounting(_proof);
  SELECT * INTO r FROM public.task_runs WHERE id = _run FOR UPDATE;
  SELECT * INTO q FROM public.single_ai_requests WHERE id = _request;
  IF auth.uid() IS NULL OR r.id IS NULL OR q.id IS NULL OR r.status <> 'running' OR q.user_id <> auth.uid()
     OR q.workspace_id <> r.workspace_id OR q.request_key <> r.request_key THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF r.single_request_id IS NOT NULL AND r.single_request_id <> q.id THEN RAISE EXCEPTION 'run already linked'; END IF;
  UPDATE public.task_runs SET single_request_id = q.id, agent_run_id = q.run_id WHERE id = _run;
END $$;

CREATE OR REPLACE FUNCTION public.task_run_charge(_r public.task_runs) RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT credits FROM public.single_ai_requests WHERE id = _r.single_request_id),
                  (SELECT CASE WHEN status = 'settled' THEN charged WHEN status = 'refunded' THEN 0 END FROM public.ai_credit_reservations WHERE run_id = _r.agent_run_id))
$$;
REVOKE ALL ON FUNCTION public.task_run_charge(public.task_runs) FROM PUBLIC, anon, authenticated;

-- What the accounting records say about a run's AI request: none, succeeded, failed (nothing or refunded), or unknown.
CREATE OR REPLACE FUNCTION public.task_run_ai_state(_request uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN q.id IS NULL THEN 'none'
    WHEN q.status = 'succeeded' THEN 'succeeded'
    WHEN q.status = 'failed' THEN 'failed'
    WHEN v.run_id IS NULL OR v.status = 'refunded' THEN 'failed'
    ELSE 'unknown' END
  FROM (SELECT 1) one
  LEFT JOIN public.single_ai_requests q ON q.id = _request
  LEFT JOIN public.ai_credit_reservations v ON v.run_id = q.run_id
$$;
REVOKE ALL ON FUNCTION public.task_run_ai_state(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.finish_task_run_verified(_run uuid, _output jsonb, _error text, _proof text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.task_runs%ROWTYPE; q public.single_ai_requests%ROWTYPE; nxt text;
BEGIN
  PERFORM public.verify_ai_accounting(_proof);
  SELECT * INTO r FROM public.task_runs WHERE id = _run FOR UPDATE;
  IF auth.uid() IS NULL OR NOT FOUND OR NOT public.has_workspace_role(r.workspace_id, 'member') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF r.status <> 'running' THEN RAISE EXCEPTION 'This run is not running'; END IF;
  SELECT * INTO q FROM public.single_ai_requests WHERE id = r.single_request_id;
  -- The outcome follows the recorded AI request, never the caller's claim.
  nxt := CASE public.task_run_ai_state(r.single_request_id)
    WHEN 'none' THEN 'failed'                                        -- never dispatched: nothing charged
    WHEN 'succeeded' THEN CASE WHEN _output IS NOT NULL AND jsonb_typeof(_output) = 'object' THEN 'succeeded' ELSE 'failed' END -- paid but unusable
    WHEN 'failed' THEN 'failed'
    ELSE 'uncertain' END;
  UPDATE public.task_runs SET status = nxt, output = CASE WHEN nxt = 'succeeded' THEN _output END,
    error = CASE WHEN nxt <> 'succeeded' THEN left(coalesce(nullif(_error, ''), 'The AI work did not complete'), 500) END,
    credits_charged = public.task_run_charge(r), finished_at = CASE WHEN nxt <> 'uncertain' THEN now() END, lease_until = NULL
  WHERE id = _run RETURNING * INTO r;
  IF nxt = 'succeeded' THEN UPDATE public.tasks SET status = 'review' WHERE id = r.task_id AND status IN ('todo','in_progress'); END IF;
  PERFORM public.log_task_run_event(r, 'run_' || nxt, jsonb_build_object('credits', r.credits_charged));
  RETURN to_jsonb(r);
END $$;
REVOKE ALL ON FUNCTION public.start_task_run_verified(uuid, text), public.link_task_run_request_verified(uuid, uuid, text),
  public.finish_task_run_verified(uuid, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_task_run_verified(uuid, text), public.link_task_run_request_verified(uuid, uuid, text),
  public.finish_task_run_verified(uuid, jsonb, text, text) TO authenticated;

-- Settles runs whose lease expired and uncertain runs whose AI request has since been resolved.
-- Safe for any workspace member to call: it only follows recorded AI request states.
CREATE OR REPLACE FUNCTION public.reconcile_task_runs(_workspace uuid) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.task_runs%ROWTYPE; q public.single_ai_requests%ROWTYPE; nxt text; n int := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_workspace_role(_workspace, 'member') THEN RAISE EXCEPTION 'forbidden'; END IF;
  FOR r IN SELECT * FROM public.task_runs WHERE workspace_id = _workspace
    AND ((status = 'running' AND lease_until < now()) OR status = 'uncertain') ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED LOOP
    q := NULL;
    SELECT * INTO q FROM public.single_ai_requests WHERE id = r.single_request_id;
    nxt := CASE public.task_run_ai_state(r.single_request_id)
      WHEN 'none' THEN 'failed' WHEN 'succeeded' THEN 'succeeded' WHEN 'failed' THEN 'failed' ELSE 'uncertain' END;
    IF nxt = r.status THEN CONTINUE; END IF;
    UPDATE public.task_runs SET status = nxt, lease_until = NULL,
      output = CASE WHEN nxt = 'succeeded' THEN jsonb_build_object('recovered', true, 'markdown', left(coalesce(q.reply, ''), 60000)) END,
      error = CASE WHEN nxt = 'failed' THEN CASE WHEN q.id IS NULL THEN 'Timed out before the AI call started; nothing was charged' ELSE 'The AI call did not complete' END
                   WHEN nxt = 'uncertain' THEN 'Timed out; the AI outcome is not known yet' END,
      credits_charged = public.task_run_charge(r), finished_at = CASE WHEN nxt <> 'uncertain' THEN now() END
    WHERE id = r.id RETURNING * INTO r;
    IF nxt = 'succeeded' THEN UPDATE public.tasks SET status = 'review' WHERE id = r.task_id AND status IN ('todo','in_progress'); END IF;
    PERFORM public.log_task_run_event(r, 'run_reconciled_' || nxt);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.reconcile_task_runs(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_task_runs(uuid) TO authenticated;
