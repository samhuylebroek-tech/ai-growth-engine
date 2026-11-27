-- PROPOSED migration (not in the journal; not applied to the live database). Staging only via
-- scripts/staging/apply-proposal.ts. Idempotent. Depends on proposal 0063 (task execution engine).
--
-- Scheduling and governance on top of the existing task execution engine (no parallel system):
-- * execution_settings gains an emergency pause, a daily credit cap, a parallel-run limit, a retry
--   limit, allowed specialists, an execution window (hours in the workspace time zone) and a schedule.
-- * task_run_gate() is the single rule set deciding whether a task may get an AI run, and why not.
--   queue_task_run, start_task_run_verified and the scheduler all use it.
-- * Execution cycles are bounded, traceable scheduler passes: an admin (or a due schedule, started by
--   an admin) asks for one; the database ranks ready tasks by priority, deadline and goal importance,
--   records a decision and reason for every task it looked at, and queues at most max_parallel runs.
--   One open cycle per workspace at a time; the same request key returns the same cycle.
-- * Nothing here calls AI or runs unattended: runs queued by a cycle are started by the signed-in
--   admin's session through the existing metered, single-request accounting.

ALTER TABLE public.execution_settings ADD COLUMN IF NOT EXISTS paused boolean NOT NULL DEFAULT false;
ALTER TABLE public.execution_settings ADD COLUMN IF NOT EXISTS pause_reason text CHECK (pause_reason IS NULL OR length(pause_reason) <= 300);
ALTER TABLE public.execution_settings ADD COLUMN IF NOT EXISTS paused_by uuid;
ALTER TABLE public.execution_settings ADD COLUMN IF NOT EXISTS paused_at timestamptz;
ALTER TABLE public.execution_settings ADD COLUMN IF NOT EXISTS daily_credit_cap int CHECK (daily_credit_cap IS NULL OR daily_credit_cap BETWEEN 0 AND 100000);
ALTER TABLE public.execution_settings ADD COLUMN IF NOT EXISTS max_parallel smallint NOT NULL DEFAULT 3 CHECK (max_parallel BETWEEN 1 AND 3);
ALTER TABLE public.execution_settings ADD COLUMN IF NOT EXISTS max_attempts smallint NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 3);
ALTER TABLE public.execution_settings ADD COLUMN IF NOT EXISTS allowed_specialists text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.execution_settings ADD COLUMN IF NOT EXISTS window_start smallint CHECK (window_start IS NULL OR window_start BETWEEN 0 AND 23);
ALTER TABLE public.execution_settings ADD COLUMN IF NOT EXISTS window_end smallint CHECK (window_end IS NULL OR window_end BETWEEN 0 AND 23);
ALTER TABLE public.execution_settings ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Europe/Brussels';
ALTER TABLE public.execution_settings ADD COLUMN IF NOT EXISTS schedule text NOT NULL DEFAULT 'off' CHECK (schedule IN ('off','daily','weekdays'));
ALTER TABLE public.execution_settings ADD COLUMN IF NOT EXISTS schedule_hour smallint NOT NULL DEFAULT 9 CHECK (schedule_hour BETWEEN 0 AND 23);

ALTER TABLE public.task_runs ADD COLUMN IF NOT EXISTS cycle_id uuid;

-- Effective settings, with defaults for workspaces that never saved any.
CREATE OR REPLACE FUNCTION public.task_execution_settings(_workspace uuid) RETURNS public.execution_settings
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.execution_settings;
BEGIN
  SELECT * INTO s FROM public.execution_settings WHERE workspace_id = _workspace;
  IF FOUND THEN RETURN s; END IF;
  s.workspace_id := _workspace; s.org_id := (SELECT org_id FROM public.workspaces WHERE id = _workspace);
  s.mode := 2; s.max_credits_per_run := 20; s.monthly_credit_cap := 200; s.updated_at := now();
  s.paused := false; s.max_parallel := 3; s.max_attempts := 3; s.allowed_specialists := '{}';
  s.timezone := 'Europe/Brussels'; s.schedule := 'off'; s.schedule_hour := 9;
  RETURN s;
END $$;
REVOKE ALL ON FUNCTION public.task_execution_settings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.task_execution_settings(uuid) TO authenticated;

-- Identity of a run (including the cycle that queued it) never changes.
CREATE OR REPLACE FUNCTION public.guard_task_run_identity() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Task runs are permanent'; END IF;
  IF NEW.id <> OLD.id OR NEW.org_id <> OLD.org_id OR NEW.workspace_id <> OLD.workspace_id OR NEW.task_id <> OLD.task_id
     OR NEW.request_key <> OLD.request_key OR NEW.attempt <> OLD.attempt OR NEW.requested_by <> OLD.requested_by
     OR NEW.created_at <> OLD.created_at OR NEW.cycle_id IS DISTINCT FROM OLD.cycle_id THEN
    RAISE EXCEPTION 'Task run identity is immutable';
  END IF;
  IF OLD.status IN ('succeeded','failed','cancelled','rejected') THEN RAISE EXCEPTION 'Finished task runs are permanent'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.execution_window_open(_s public.execution_settings, _at timestamptz DEFAULT now())
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE h int;
BEGIN
  IF _s.window_start IS NULL OR _s.window_end IS NULL OR _s.window_start = _s.window_end THEN RETURN true; END IF;
  h := extract(hour FROM _at AT TIME ZONE _s.timezone)::int;
  IF _s.window_start < _s.window_end THEN RETURN h >= _s.window_start AND h < _s.window_end; END IF;
  RETURN h >= _s.window_start OR h < _s.window_end;
END $$;
REVOKE ALL ON FUNCTION public.execution_window_open(public.execution_settings, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execution_window_open(public.execution_settings, timestamptz) TO authenticated;

-- Credits a workspace has committed to task runs since _since: charged amounts, or the estimate while open.
CREATE OR REPLACE FUNCTION public.task_run_credits_since(_workspace uuid, _since timestamptz) RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(sum(coalesce(credits_charged, CASE WHEN status IN ('failed','cancelled','rejected') THEN 0 ELSE estimated_credits END)), 0)::int
  FROM public.task_runs WHERE workspace_id = _workspace AND created_at >= _since
$$;
REVOKE ALL ON FUNCTION public.task_run_credits_since(uuid, timestamptz) FROM PUBLIC, anon, authenticated;

-- The one rule set: returns NULL when the task may get a new AI run, otherwise a reason code.
-- _autonomous adds the checks that apply to scheduler cycles (window and organization credit balance).
CREATE OR REPLACE FUNCTION public.task_run_gate(_task uuid, _estimate int, _autonomous boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.tasks%ROWTYPE; p public.task_execution_profiles%ROWTYPE; s public.execution_settings; tries int;
BEGIN
  SELECT * INTO t FROM public.tasks WHERE id = _task;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  s := public.task_execution_settings(t.workspace_id);
  IF s.paused THEN RETURN 'paused'; END IF;
  IF t.status IN ('done','cancelled') THEN RETURN 'closed'; END IF;
  SELECT * INTO p FROM public.task_execution_profiles WHERE task_id = _task;
  IF NOT FOUND THEN RETURN 'no_specialist'; END IF;
  IF p.task_type = 'external' THEN RETURN 'external'; END IF;
  IF p.task_type = 'preparation' AND s.mode < 2 THEN RETURN 'analysis_only'; END IF;
  IF cardinality(s.allowed_specialists) > 0 AND NOT (p.specialist_key = ANY (s.allowed_specialists)) THEN RETURN 'specialist_not_allowed'; END IF;
  IF _estimate IS NULL OR _estimate < 1 OR _estimate > s.max_credits_per_run THEN RETURN 'over_run_cap'; END IF;
  IF public.task_open_dependencies(_task) > 0 THEN RETURN 'blocked_dependency'; END IF;
  IF EXISTS (SELECT 1 FROM public.task_runs WHERE task_id = _task AND status IN ('awaiting_approval','queued','paused','running','uncertain')) THEN RETURN 'unfinished_run'; END IF;
  SELECT count(*) INTO tries FROM public.task_runs WHERE task_id = _task AND status IN ('succeeded','failed','uncertain');
  IF tries >= s.max_attempts THEN RETURN 'retry_limit'; END IF;
  IF public.task_run_credits_since(t.workspace_id, date_trunc('month', now())) + _estimate > s.monthly_credit_cap THEN RETURN 'monthly_cap'; END IF;
  IF s.daily_credit_cap IS NOT NULL AND public.task_run_credits_since(t.workspace_id,
       (date_trunc('day', now() AT TIME ZONE s.timezone)) AT TIME ZONE s.timezone) + _estimate > s.daily_credit_cap THEN RETURN 'daily_cap'; END IF;
  -- Cycles never redo work that already has a result waiting for review; people may still rerun it by hand.
  IF _autonomous AND EXISTS (SELECT 1 FROM public.task_runs WHERE task_id = _task AND status = 'succeeded') THEN RETURN 'has_result'; END IF;
  IF _autonomous AND NOT public.execution_window_open(s) THEN RETURN 'outside_window'; END IF;
  IF _autonomous AND (SELECT coalesce(sum(delta), 0) FROM public.credit_ledger WHERE org_id = t.org_id) < _estimate THEN RETURN 'no_credits'; END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.task_run_gate(uuid, int, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.task_run_gate_message(_code text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _code
    WHEN 'paused' THEN 'AI work is paused in this workspace'
    WHEN 'closed' THEN 'This task is already closed'
    WHEN 'no_specialist' THEN 'Assign a specialist first'
    WHEN 'external' THEN 'External actions need a connected system and explicit approval; none is switched on'
    WHEN 'analysis_only' THEN 'This workspace allows analysis only'
    WHEN 'specialist_not_allowed' THEN 'This specialist is not allowed in this workspace'
    WHEN 'over_run_cap' THEN 'Estimated cost is above the per-run limit'
    WHEN 'blocked_dependency' THEN 'Blocked: finish the tasks this one depends on first'
    WHEN 'unfinished_run' THEN 'This task already has unfinished AI work'
    WHEN 'retry_limit' THEN 'This task reached its limit of AI runs'
    WHEN 'monthly_cap' THEN 'This month''s credit limit for task runs would be exceeded'
    WHEN 'daily_cap' THEN 'Today''s credit limit for task runs would be exceeded'
    WHEN 'outside_window' THEN 'Outside the permitted execution hours'
    WHEN 'no_credits' THEN 'Not enough AI credits'
    WHEN 'has_result' THEN 'This task already has an AI result'
    WHEN 'parallel_limit' THEN 'The limit of runs at the same time is reached'
    ELSE 'This task cannot run now' END
$$;

CREATE OR REPLACE FUNCTION public.queue_task_run(_task uuid, _request uuid, _estimate int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.tasks%ROWTYPE; p public.task_execution_profiles%ROWTYPE; s public.execution_settings; r public.task_runs%ROWTYPE;
  tries int; needs boolean; why text; cyc uuid := nullif(current_setting('app.execution_cycle', true), '')::uuid;
BEGIN
  SELECT * INTO t FROM public.tasks WHERE id = _task;
  IF auth.uid() IS NULL OR NOT FOUND OR NOT public.has_workspace_role(t.workspace_id, 'member') THEN RAISE EXCEPTION 'Running work requires workspace member permission'; END IF;
  SELECT * INTO r FROM public.task_runs WHERE workspace_id = t.workspace_id AND request_key = _request;
  IF FOUND THEN
    IF r.task_id <> _task THEN RAISE EXCEPTION 'request key belongs to different work'; END IF;
    RETURN to_jsonb(r) - 'output';
  END IF;
  PERFORM 1 FROM public.tasks WHERE id = _task FOR UPDATE;
  why := public.task_run_gate(_task, _estimate, cyc IS NOT NULL);
  IF why IS NOT NULL THEN RAISE EXCEPTION USING MESSAGE = public.task_run_gate_message(why), DETAIL = 'gate:' || why; END IF;
  SELECT * INTO p FROM public.task_execution_profiles WHERE task_id = _task;
  s := public.task_execution_settings(t.workspace_id);
  SELECT count(*) INTO tries FROM public.task_runs WHERE task_id = _task AND status IN ('succeeded','failed','uncertain');
  needs := s.mode = 3 OR p.requires_approval;
  INSERT INTO public.task_runs(org_id, workspace_id, task_id, request_key, specialist_key, task_type, mode, attempt, status, estimated_credits, requested_by, cycle_id)
  VALUES (t.org_id, t.workspace_id, t.id, _request, p.specialist_key, p.task_type, s.mode, tries + 1,
    CASE WHEN needs THEN 'awaiting_approval' ELSE 'queued' END, _estimate, auth.uid(), cyc) RETURNING * INTO r;
  IF t.status = 'todo' THEN UPDATE public.tasks SET status = 'in_progress' WHERE id = t.id; END IF;
  PERFORM public.log_task_run_event(r, 'run_' || r.status, jsonb_build_object('estimated_credits', _estimate, 'cycle_id', cyc));
  RETURN to_jsonb(r) - 'output';
END $$;
REVOKE ALL ON FUNCTION public.queue_task_run(uuid, uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.queue_task_run(uuid, uuid, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.start_task_run_verified(_run uuid, _proof text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.task_runs%ROWTYPE; s public.execution_settings; running int;
BEGIN
  PERFORM public.verify_ai_accounting(_proof);
  SELECT * INTO r FROM public.task_runs WHERE id = _run FOR UPDATE;
  IF auth.uid() IS NULL OR NOT FOUND OR NOT public.has_workspace_role(r.workspace_id, 'member') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF r.status <> 'queued' THEN RAISE EXCEPTION 'This run is not ready to start'; END IF;
  -- Serialize starts per workspace so the parallel limit holds under concurrency.
  PERFORM pg_advisory_xact_lock(hashtextextended('task_run_start:' || r.workspace_id::text, 0));
  s := public.task_execution_settings(r.workspace_id);
  IF s.paused THEN RAISE EXCEPTION USING MESSAGE = public.task_run_gate_message('paused'), DETAIL = 'gate:paused'; END IF;
  IF public.task_open_dependencies(r.task_id) > 0 THEN RAISE EXCEPTION USING MESSAGE = public.task_run_gate_message('blocked_dependency'), DETAIL = 'gate:blocked_dependency'; END IF;
  IF r.task_type = 'preparation' AND s.mode < 2 THEN RAISE EXCEPTION 'This workspace allows analysis only'; END IF;
  IF (s.mode = 3 OR EXISTS (SELECT 1 FROM public.task_execution_profiles WHERE task_id = r.task_id AND requires_approval)) AND r.decided_by IS NULL THEN
    RAISE EXCEPTION 'This run needs approval';
  END IF;
  IF r.cycle_id IS NOT NULL AND NOT public.execution_window_open(s) THEN
    RAISE EXCEPTION USING MESSAGE = public.task_run_gate_message('outside_window'), DETAIL = 'gate:outside_window';
  END IF;
  SELECT count(*) INTO running FROM public.task_runs WHERE workspace_id = r.workspace_id AND status = 'running' AND lease_until > now();
  IF running >= s.max_parallel THEN RAISE EXCEPTION USING MESSAGE = public.task_run_gate_message('parallel_limit'), DETAIL = 'gate:parallel_limit'; END IF;
  UPDATE public.task_runs SET status = 'running', started_at = now(), lease_until = now() + interval '4 minutes' WHERE id = _run RETURNING * INTO r;
  PERFORM public.log_task_run_event(r, 'run_started');
  RETURN to_jsonb(r) - 'output';
END $$;
REVOKE ALL ON FUNCTION public.start_task_run_verified(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_task_run_verified(uuid, text) TO authenticated;

-- Governance settings (admins). Mode and caps keep using set_execution_settings.
CREATE OR REPLACE FUNCTION public.set_execution_governance(_workspace uuid, _g jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.execution_settings; spec text[]; tz text := coalesce(_g->>'timezone', 'Europe/Brussels');
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_workspace_role(_workspace, 'admin') THEN RAISE EXCEPTION 'Execution settings require workspace admin permission'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = tz) THEN RAISE EXCEPTION 'Unknown time zone'; END IF;
  spec := coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(_g->'allowed_specialists', '[]'))), '{}');
  IF EXISTS (SELECT 1 FROM unnest(spec) k WHERE k NOT IN ('business_analyst','market_research','growth_strategist','seo','content','copywriter','marketing',
      'advertising','linkedin','sales','crm','cro','partnership','event_marketing','revenue_analyst')) THEN RAISE EXCEPTION 'Unknown specialist'; END IF;
  IF (_g->>'window_start') IS NULL <> ((_g->>'window_end') IS NULL) THEN RAISE EXCEPTION 'Give both window hours or neither'; END IF;
  s := public.task_execution_settings(_workspace);
  INSERT INTO public.execution_settings(workspace_id, org_id, mode, max_credits_per_run, monthly_credit_cap, updated_by, updated_at,
    daily_credit_cap, max_parallel, max_attempts, allowed_specialists, window_start, window_end, timezone, schedule, schedule_hour)
  VALUES (_workspace, s.org_id, s.mode, s.max_credits_per_run, s.monthly_credit_cap, auth.uid(), now(),
    (_g->>'daily_credit_cap')::int, coalesce((_g->>'max_parallel')::smallint, 3), coalesce((_g->>'max_attempts')::smallint, 3), spec,
    (_g->>'window_start')::smallint, (_g->>'window_end')::smallint, tz, coalesce(_g->>'schedule', 'off'), coalesce((_g->>'schedule_hour')::smallint, 9))
  ON CONFLICT (workspace_id) DO UPDATE SET daily_credit_cap = EXCLUDED.daily_credit_cap, max_parallel = EXCLUDED.max_parallel,
    max_attempts = EXCLUDED.max_attempts, allowed_specialists = EXCLUDED.allowed_specialists, window_start = EXCLUDED.window_start,
    window_end = EXCLUDED.window_end, timezone = EXCLUDED.timezone, schedule = EXCLUDED.schedule, schedule_hour = EXCLUDED.schedule_hour,
    updated_by = auth.uid(), updated_at = now();
  PERFORM public.log_audit(s.org_id, 'execution.governance.updated', 'workspace', _workspace::text, _g);
  RETURN to_jsonb(public.task_execution_settings(_workspace));
END $$;
REVOKE ALL ON FUNCTION public.set_execution_governance(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_execution_governance(uuid, jsonb) TO authenticated;

-- Emergency stop / resume (admins). While paused, no AI task run is queued or started in the workspace.
CREATE OR REPLACE FUNCTION public.set_execution_paused(_workspace uuid, _paused boolean, _reason text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.execution_settings; n text := nullif(left(trim(coalesce(_reason, '')), 300), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_workspace_role(_workspace, 'admin') THEN RAISE EXCEPTION 'Pausing AI work requires workspace admin permission'; END IF;
  s := public.task_execution_settings(_workspace);
  INSERT INTO public.execution_settings(workspace_id, org_id, mode, max_credits_per_run, monthly_credit_cap, updated_by, updated_at, paused, pause_reason, paused_by, paused_at)
  VALUES (_workspace, s.org_id, s.mode, s.max_credits_per_run, s.monthly_credit_cap, auth.uid(), now(), _paused,
    CASE WHEN _paused THEN n END, CASE WHEN _paused THEN auth.uid() END, CASE WHEN _paused THEN now() END)
  ON CONFLICT (workspace_id) DO UPDATE SET paused = EXCLUDED.paused, pause_reason = EXCLUDED.pause_reason, paused_by = EXCLUDED.paused_by,
    paused_at = EXCLUDED.paused_at, updated_by = auth.uid(), updated_at = now();
  -- Close any open cycle so nothing continues from it.
  IF _paused THEN
    UPDATE public.execution_cycles SET status = 'stopped', finished_at = now(), stop_reason = 'paused' WHERE workspace_id = _workspace AND status = 'open';
  END IF;
  PERFORM public.log_audit(s.org_id, CASE WHEN _paused THEN 'execution.paused' ELSE 'execution.resumed' END, 'workspace', _workspace::text, jsonb_build_object('reason', n));
  RETURN to_jsonb(public.task_execution_settings(_workspace));
END $$;

CREATE TABLE IF NOT EXISTS public.execution_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  request_key uuid NOT NULL,
  trigger text NOT NULL CHECK (trigger IN ('manual','scheduled')),
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 300),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed','stopped')),
  stop_reason text CHECK (stop_reason IS NULL OR stop_reason IN ('paused','expired','finished_early')),
  limits jsonb NOT NULL,
  queued int NOT NULL DEFAULT 0,
  awaiting int NOT NULL DEFAULT 0,
  skipped int NOT NULL DEFAULT 0,
  summary jsonb,
  started_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (workspace_id, request_key),
  UNIQUE (id, org_id, workspace_id)
);
CREATE INDEX IF NOT EXISTS execution_cycles_ws_created ON public.execution_cycles(workspace_id, created_at DESC);
REVOKE ALL ON public.execution_cycles FROM anon, authenticated;
GRANT SELECT ON public.execution_cycles TO authenticated;
GRANT ALL ON public.execution_cycles TO service_role;
ALTER TABLE public.execution_cycles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS execution_cycles_read ON public.execution_cycles;
CREATE POLICY execution_cycles_read ON public.execution_cycles FOR SELECT TO authenticated USING (public.has_workspace_role(workspace_id, 'viewer'));

CREATE TABLE IF NOT EXISTS public.execution_cycle_items (
  cycle_id uuid NOT NULL,
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  task_id uuid NOT NULL,
  rank int NOT NULL,
  score int NOT NULL,
  decision text NOT NULL CHECK (decision IN ('queued','awaiting_approval','skipped')),
  reason text NOT NULL,
  run_id uuid REFERENCES public.task_runs(id),
  PRIMARY KEY (cycle_id, task_id),
  FOREIGN KEY (cycle_id, org_id, workspace_id) REFERENCES public.execution_cycles(id, org_id, workspace_id),
  FOREIGN KEY (task_id, org_id, workspace_id) REFERENCES public.tasks(id, org_id, workspace_id)
);
REVOKE ALL ON public.execution_cycle_items FROM anon, authenticated;
GRANT SELECT ON public.execution_cycle_items TO authenticated;
GRANT ALL ON public.execution_cycle_items TO service_role;
ALTER TABLE public.execution_cycle_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS execution_cycle_items_read ON public.execution_cycle_items;
CREATE POLICY execution_cycle_items_read ON public.execution_cycle_items FOR SELECT TO authenticated USING (public.has_workspace_role(workspace_id, 'viewer'));

CREATE OR REPLACE FUNCTION public.guard_execution_cycle() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Execution cycles are permanent'; END IF;
  IF TG_TABLE_NAME = 'execution_cycle_items' THEN RAISE EXCEPTION 'Cycle decisions are permanent'; END IF;
  IF NEW.id <> OLD.id OR NEW.org_id <> OLD.org_id OR NEW.workspace_id <> OLD.workspace_id OR NEW.request_key <> OLD.request_key
     OR NEW.trigger <> OLD.trigger OR NEW.reason <> OLD.reason OR NEW.limits <> OLD.limits OR NEW.started_by <> OLD.started_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Execution cycle identity is immutable';
  END IF;
  IF OLD.status <> 'open' THEN RAISE EXCEPTION 'Closed execution cycles are permanent'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS execution_cycles_guard ON public.execution_cycles;
CREATE TRIGGER execution_cycles_guard BEFORE UPDATE OR DELETE ON public.execution_cycles FOR EACH ROW EXECUTE FUNCTION public.guard_execution_cycle();
DROP TRIGGER IF EXISTS execution_cycle_items_guard ON public.execution_cycle_items;
CREATE TRIGGER execution_cycle_items_guard BEFORE UPDATE OR DELETE ON public.execution_cycle_items FOR EACH ROW EXECUTE FUNCTION public.guard_execution_cycle();

-- Deterministic priority score: task priority, deadline, goal importance, approved-plan link, past failures.
CREATE OR REPLACE FUNCTION public.task_priority_score(_task uuid) RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (CASE t.priority WHEN 'urgent' THEN 40 WHEN 'high' THEN 30 WHEN 'medium' THEN 20 ELSE 10 END)
    + (CASE WHEN t.due_date IS NULL THEN 0 WHEN t.due_date < current_date THEN 25 WHEN t.due_date <= current_date + 7 THEN 15 ELSE 0 END)
    + coalesce((SELECT max(CASE g.priority WHEN 'primary' THEN 15 ELSE 8 END) FROM public.growth_goals g
        WHERE g.status = 'active' AND g.id IN (SELECT goal_id FROM public.projects WHERE id = t.project_id
                                               UNION SELECT goal_id FROM public.campaigns WHERE id = t.campaign_id)), 0)
    + (CASE WHEN to_regclass('public.growth_initiatives') IS NOT NULL AND t.project_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.growth_initiatives i WHERE i.project_id = t.project_id) THEN 10 ELSE 0 END)
    - 5 * (SELECT count(*)::int FROM public.task_runs r WHERE r.task_id = t.id AND r.status = 'failed')
  FROM public.tasks t WHERE t.id = _task
$$;
REVOKE ALL ON FUNCTION public.task_priority_score(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.task_priority_score(uuid) TO authenticated;

-- When the next scheduled cycle is due (NULL when no schedule). Due = schedule time today has passed in the
-- workspace time zone (weekdays only for 'weekdays') and no scheduled cycle ran since then.
CREATE OR REPLACE FUNCTION public.execution_cycle_due(_workspace uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.execution_settings; local_now timestamp; slot timestamptz; last timestamptz;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_workspace_role(_workspace, 'viewer') THEN RAISE EXCEPTION 'forbidden'; END IF;
  s := public.task_execution_settings(_workspace);
  IF s.schedule = 'off' THEN RETURN jsonb_build_object('schedule', 'off', 'due', false); END IF;
  local_now := now() AT TIME ZONE s.timezone;
  slot := (date_trunc('day', local_now) + make_interval(hours => s.schedule_hour)) AT TIME ZONE s.timezone;
  IF slot > now() THEN slot := slot - interval '1 day'; END IF;
  WHILE s.schedule = 'weekdays' AND extract(isodow FROM slot AT TIME ZONE s.timezone) > 5 LOOP slot := slot - interval '1 day'; END LOOP;
  SELECT max(created_at) INTO last FROM public.execution_cycles WHERE workspace_id = _workspace AND trigger = 'scheduled';
  RETURN jsonb_build_object('schedule', s.schedule, 'slot', slot, 'last_scheduled', last, 'due', (last IS NULL OR last < slot) AND NOT s.paused AND s.mode >= 3);
END $$;
REVOKE ALL ON FUNCTION public.execution_cycle_due(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execution_cycle_due(uuid) TO authenticated;

-- One bounded scheduler pass. Admins only, modes 3 and 4. Looks at up to 25 open assigned tasks,
-- records a decision for each, queues at most max_parallel runs (mode 4) or approval requests (mode 3).
CREATE OR REPLACE FUNCTION public.plan_execution_cycle(_workspace uuid, _request uuid, _trigger text, _estimate int DEFAULT 8)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.execution_settings; c public.execution_cycles%ROWTYPE; due jsonb; slots int; rk int := 0; why text; r jsonb;
  rec record; nq int := 0; na int := 0; ns int := 0; dec text; needs boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_workspace_role(_workspace, 'admin') THEN RAISE EXCEPTION 'Execution cycles require workspace admin permission'; END IF;
  IF _trigger NOT IN ('manual','scheduled') THEN RAISE EXCEPTION 'Invalid trigger'; END IF;
  SELECT * INTO c FROM public.execution_cycles WHERE workspace_id = _workspace AND request_key = _request;
  IF FOUND THEN RETURN to_jsonb(c); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('execution_cycle:' || _workspace::text, 0));
  s := public.task_execution_settings(_workspace);
  IF s.paused THEN RAISE EXCEPTION USING MESSAGE = public.task_run_gate_message('paused'), DETAIL = 'gate:paused'; END IF;
  IF s.mode < 3 THEN RAISE EXCEPTION USING MESSAGE = 'Execution cycles need mode 3 or 4', DETAIL = 'gate:mode'; END IF;
  IF NOT public.execution_window_open(s) THEN RAISE EXCEPTION USING MESSAGE = public.task_run_gate_message('outside_window'), DETAIL = 'gate:outside_window'; END IF;
  IF _trigger = 'scheduled' THEN
    due := public.execution_cycle_due(_workspace);
    IF NOT coalesce((due->>'due')::boolean, false) THEN RAISE EXCEPTION USING MESSAGE = 'No scheduled cycle is due', DETAIL = 'gate:not_due'; END IF;
  END IF;
  -- Expire stale open cycles; refuse while another one is genuinely open.
  UPDATE public.execution_cycles SET status = 'stopped', stop_reason = 'expired', finished_at = now()
    WHERE workspace_id = _workspace AND status = 'open' AND created_at < now() - interval '15 minutes';
  IF EXISTS (SELECT 1 FROM public.execution_cycles WHERE workspace_id = _workspace AND status = 'open') THEN
    RAISE EXCEPTION USING MESSAGE = 'Another execution cycle is still open', DETAIL = 'gate:cycle_open';
  END IF;
  SELECT s.max_parallel - count(*) INTO slots FROM public.task_runs WHERE workspace_id = _workspace AND status IN ('queued','running') ;
  INSERT INTO public.execution_cycles(org_id, workspace_id, request_key, trigger, reason, limits, started_by)
  VALUES (s.org_id, _workspace, _request, _trigger,
    CASE WHEN _trigger = 'scheduled' THEN 'Scheduled ' || s.schedule || ' cycle due at ' || to_char((due->>'slot')::timestamptz AT TIME ZONE s.timezone, 'YYYY-MM-DD HH24:MI') || ' ' || s.timezone
         ELSE 'Started by a workspace admin' END,
    jsonb_build_object('mode', s.mode, 'max_parallel', s.max_parallel, 'open_slots', greatest(slots, 0), 'estimate', _estimate,
      'max_credits_per_run', s.max_credits_per_run, 'monthly_credit_cap', s.monthly_credit_cap, 'daily_credit_cap', s.daily_credit_cap, 'scan_limit', 25),
    auth.uid()) RETURNING * INTO c;
  PERFORM set_config('app.execution_cycle', c.id::text, true);
  FOR rec IN
    SELECT t.id, public.task_priority_score(t.id) AS score, p.requires_approval
    FROM public.tasks t JOIN public.task_execution_profiles p ON p.task_id = t.id
    WHERE t.workspace_id = _workspace AND t.status NOT IN ('done','cancelled')
    ORDER BY public.task_priority_score(t.id) DESC, t.due_date ASC NULLS LAST, t.created_at ASC, t.id
    LIMIT 25
  LOOP
    rk := rk + 1; r := NULL; dec := 'skipped';
    needs := s.mode = 3 OR rec.requires_approval;
    why := public.task_run_gate(rec.id, _estimate, true);
    IF why IS NULL AND NOT needs AND slots <= 0 THEN why := 'parallel_limit'; END IF;
    IF why IS NULL AND needs AND na >= 5 THEN why := 'approval_batch_full'; END IF;
    IF why IS NULL THEN
      r := public.queue_task_run(rec.id, md5(c.id::text || rec.id::text)::uuid, _estimate);
      dec := r->>'status';
      IF dec = 'queued' THEN nq := nq + 1; slots := slots - 1; why := 'ready';
      ELSE na := na + 1; why := 'needs_approval'; END IF;
    ELSE ns := ns + 1; END IF;
    INSERT INTO public.execution_cycle_items(cycle_id, org_id, workspace_id, task_id, rank, score, decision, reason, run_id)
    VALUES (c.id, c.org_id, c.workspace_id, rec.id, rk, rec.score, dec, why, (r->>'id')::uuid);
  END LOOP;
  PERFORM set_config('app.execution_cycle', '', true);
  UPDATE public.execution_cycles SET queued = nq, awaiting = na, skipped = ns,
    status = CASE WHEN nq = 0 THEN 'completed' ELSE 'open' END, finished_at = CASE WHEN nq = 0 THEN now() END,
    summary = CASE WHEN nq = 0 THEN jsonb_build_object('note', 'nothing to run') END
  WHERE id = c.id RETURNING * INTO c;
  PERFORM public.log_audit(c.org_id, 'execution.cycle.planned', 'workspace', _workspace::text,
    jsonb_build_object('cycle_id', c.id, 'trigger', _trigger, 'queued', nq, 'awaiting', na, 'skipped', ns));
  RETURN to_jsonb(c);
END $$;
REVOKE ALL ON FUNCTION public.plan_execution_cycle(uuid, uuid, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_execution_cycle(uuid, uuid, text, int) TO authenticated;

-- Closes a cycle with a summary computed from its runs (never from the caller).
CREATE OR REPLACE FUNCTION public.finish_execution_cycle(_cycle uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.execution_cycles%ROWTYPE; sm jsonb;
BEGIN
  SELECT * INTO c FROM public.execution_cycles WHERE id = _cycle FOR UPDATE;
  IF auth.uid() IS NULL OR NOT FOUND OR NOT public.has_workspace_role(c.workspace_id, 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF c.status <> 'open' THEN RETURN to_jsonb(c); END IF;
  SELECT jsonb_build_object('succeeded', count(*) FILTER (WHERE status = 'succeeded'), 'failed', count(*) FILTER (WHERE status = 'failed'),
    'uncertain', count(*) FILTER (WHERE status = 'uncertain'), 'not_started', count(*) FILTER (WHERE status IN ('queued','paused')),
    'running', count(*) FILTER (WHERE status = 'running'), 'credits', coalesce(sum(credits_charged), 0))
  INTO sm FROM public.task_runs WHERE cycle_id = _cycle;
  UPDATE public.execution_cycles SET status = 'completed', finished_at = now(), summary = sm,
    stop_reason = CASE WHEN (sm->>'not_started')::int > 0 THEN 'finished_early' END WHERE id = _cycle RETURNING * INTO c;
  PERFORM public.log_audit(c.org_id, 'execution.cycle.finished', 'workspace', c.workspace_id::text, jsonb_build_object('cycle_id', c.id) || sm);
  RETURN to_jsonb(c);
END $$;
REVOKE ALL ON FUNCTION public.finish_execution_cycle(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finish_execution_cycle(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.set_execution_paused(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_execution_paused(uuid, boolean, text) TO authenticated;
