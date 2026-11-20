-- PROPOSED migration (not in the journal; staging only until the owner approves live migrations). Apply only with
-- scripts/staging/apply-proposal.ts. Idempotent. Depends on proposals 0057, 0059, 0063 and 0064.
--
-- Integration Hub and the universal external action workflow.
-- * Connections keep using connector_connections. Each connection now carries six separately granted permission
--   levels (read, draft, modify, execute, publish, budget); connecting grants only read.
-- * Simulated connections use connector keys prefixed "sim." so they can never be mistaken for, or collide with, a
--   real connection, and the existing real-data import functions already reject them.
-- * Every external action is one external_actions row moving through draft -> in_review -> approved -> executing ->
--   executed/failed/uncertain, with separate verification. Required approval is never skipped: only draft-level
--   actions in bounded autonomy (mode 4) are approved by the recorded workspace policy.
-- * In this phase execution is possible only against simulated connections; the database refuses real ones.
-- * Execution, outcomes and verification are written only by server-attested functions, so a browser session cannot
--   mark an action executed or verified.
-- * Simulated providers store their records in simulated_provider_records, so verification can actually look up
--   what the "provider" holds (including after a timeout) instead of trusting the execution response.

-- 1. Permission levels and connection metadata ------------------------------------------------------------------
ALTER TABLE public.connector_connections ADD COLUMN IF NOT EXISTS granted_levels text[] NOT NULL DEFAULT '{read}';
ALTER TABLE public.connector_connections ADD COLUMN IF NOT EXISTS connected_by uuid;
ALTER TABLE public.connector_connections ADD COLUMN IF NOT EXISTS connected_at timestamptz;
ALTER TABLE public.connector_connections ADD COLUMN IF NOT EXISTS simulated boolean GENERATED ALWAYS AS (connector_key LIKE 'sim.%') STORED;
ALTER TABLE public.connector_connections DROP CONSTRAINT IF EXISTS connector_connections_levels_check;
ALTER TABLE public.connector_connections ADD CONSTRAINT connector_connections_levels_check
  CHECK (granted_levels <@ ARRAY['read','draft','modify','execute','publish','budget']::text[]);

-- Provider catalogue: category and the most each provider adapter supports. Real providers are read-only in this
-- phase; write levels exist only for simulated providers.
CREATE OR REPLACE FUNCTION public.integration_provider(_key text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _key
    WHEN 'google_analytics' THEN '{"category":"analytics","levels":["read"]}'
    WHEN 'search_console' THEN '{"category":"analytics","levels":["read"]}'
    WHEN 'hubspot' THEN '{"category":"crm","levels":["read"]}'
    WHEN 'stripe' THEN '{"category":"payments","levels":["read"]}'
    WHEN 'sim.google_ads' THEN '{"category":"advertising","levels":["read","draft","modify","publish","budget"]}'
    WHEN 'sim.meta_ads' THEN '{"category":"advertising","levels":["read","draft","modify","publish","budget"]}'
    WHEN 'sim.linkedin_ads' THEN '{"category":"advertising","levels":["read","draft","modify","publish","budget"]}'
    WHEN 'sim.google_analytics' THEN '{"category":"analytics","levels":["read"]}'
    WHEN 'sim.search_console' THEN '{"category":"analytics","levels":["read"]}'
    WHEN 'sim.hubspot' THEN '{"category":"crm","levels":["read","draft","modify","execute"]}'
    WHEN 'sim.salesforce' THEN '{"category":"crm","levels":["read","draft","modify","execute"]}'
    WHEN 'sim.mailchimp' THEN '{"category":"email","levels":["read","draft","publish"]}'
    WHEN 'sim.automation' THEN '{"category":"automation","levels":["read","draft","execute"]}'
    WHEN 'sim.stripe' THEN '{"category":"payments","levels":["read"]}'
    WHEN 'sim.wordpress' THEN '{"category":"website","levels":["read","draft","modify","publish"]}'
    ELSE NULL END::jsonb
$$;

-- Action catalogue: required permission level, providers that support it (base keys), the state verification expects,
-- and the payload fields that must be present.
CREATE OR REPLACE FUNCTION public.external_action_spec(_type text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _type
    WHEN 'ads.create_campaign_draft' THEN '{"level":"draft","providers":["google_ads","meta_ads","linkedin_ads"],"state":"paused_draft","required":["name"]}'
    WHEN 'ads.launch_campaign' THEN '{"level":"publish","providers":["google_ads","meta_ads","linkedin_ads"],"state":"active","required":["name"]}'
    WHEN 'ads.change_budget' THEN '{"level":"budget","providers":["google_ads","meta_ads","linkedin_ads"],"state":"budget_updated","required":["name","daily_budget"]}'
    WHEN 'crm.create_task' THEN '{"level":"execute","providers":["hubspot","salesforce"],"state":"open","required":["subject"]}'
    WHEN 'crm.update_deal' THEN '{"level":"modify","providers":["hubspot","salesforce"],"state":"updated","required":["deal","change"]}'
    WHEN 'email.prepare_draft' THEN '{"level":"draft","providers":["mailchimp","automation"],"state":"draft","required":["subject","body"]}'
    WHEN 'email.send_campaign' THEN '{"level":"publish","providers":["mailchimp"],"state":"sent","required":["subject","body"]}'
    WHEN 'automation.create_workflow_draft' THEN '{"level":"draft","providers":["automation"],"state":"draft","required":["name"]}'
    WHEN 'content.save_draft' THEN '{"level":"draft","providers":["wordpress"],"state":"draft","required":["title","body"]}'
    WHEN 'content.publish' THEN '{"level":"publish","providers":["wordpress"],"state":"published","required":["title","body"]}'
    WHEN 'seo.update_metadata' THEN '{"level":"modify","providers":["wordpress"],"state":"saved","required":["url","meta_title"]}'
    ELSE NULL END::jsonb
$$;

-- Which action types each AI specialist may prepare. Analysis-only specialists prepare none.
CREATE OR REPLACE FUNCTION public.specialist_external_actions(_specialist text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _specialist
    WHEN 'advertising' THEN ARRAY['ads.create_campaign_draft','ads.launch_campaign','ads.change_budget']
    WHEN 'marketing' THEN ARRAY['ads.create_campaign_draft','email.prepare_draft','automation.create_workflow_draft']
    WHEN 'linkedin' THEN ARRAY['ads.create_campaign_draft']
    WHEN 'seo' THEN ARRAY['seo.update_metadata','content.save_draft']
    WHEN 'content' THEN ARRAY['content.save_draft','content.publish']
    WHEN 'copywriter' THEN ARRAY['content.save_draft','email.prepare_draft']
    WHEN 'cro' THEN ARRAY['seo.update_metadata','content.save_draft']
    WHEN 'sales' THEN ARRAY['crm.create_task']
    WHEN 'crm' THEN ARRAY['crm.create_task','crm.update_deal']
    WHEN 'partnership' THEN ARRAY['crm.create_task']
    WHEN 'event_marketing' THEN ARRAY['email.prepare_draft','email.send_campaign']
    ELSE ARRAY[]::text[] END
$$;
DO $f$ BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION public.integration_provider(text) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.integration_provider(text) TO authenticated';
  EXECUTE 'REVOKE ALL ON FUNCTION public.external_action_spec(text) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.external_action_spec(text) TO authenticated';
  EXECUTE 'REVOKE ALL ON FUNCTION public.specialist_external_actions(text) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.specialist_external_actions(text) TO authenticated';
END $f$;

CREATE OR REPLACE FUNCTION public.log_integration_audit(_org uuid, _action text, _target text, _meta jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.audit_logs(org_id, actor_id, action, target_type, target_id, metadata) VALUES (_org, auth.uid(), _action, 'connector', _target, coalesce(_meta, '{}'));
$$;
REVOKE ALL ON FUNCTION public.log_integration_audit(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- 2. Simulated connections and permission management --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.connect_simulated_integration(_workspace uuid, _provider text, _levels text[], _scenario text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w public.workspaces%ROWTYPE; p jsonb; st text; lv text[]; conn uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _provider IS NULL OR _provider NOT LIKE 'sim.%' THEN RAISE EXCEPTION 'Only simulated integrations can be created here'; END IF;
  p := public.integration_provider(_provider);
  IF p IS NULL THEN RAISE EXCEPTION 'Unknown integration'; END IF;
  SELECT * INTO w FROM public.workspaces WHERE id = _workspace;
  IF NOT FOUND OR NOT public.has_workspace_role(_workspace, 'admin') THEN RAISE EXCEPTION 'Only workspace administrators can manage integrations'; END IF;
  lv := (SELECT coalesce(array_agg(DISTINCT l ORDER BY l), '{}') FROM unnest(coalesce(_levels, ARRAY['read'])) l);
  IF NOT ('read' = ANY (lv)) THEN lv := array_append(lv, 'read'); END IF;
  IF NOT lv <@ ARRAY(SELECT jsonb_array_elements_text(p->'levels')) THEN RAISE EXCEPTION 'This integration does not support the requested permissions'; END IF;
  st := CASE coalesce(_scenario, 'healthy') WHEN 'healthy' THEN 'connected' WHEN 'expired' THEN 'expired'
    WHEN 'insufficient_scope' THEN 'insufficient_scope' WHEN 'error' THEN 'error' ELSE NULL END;
  IF st IS NULL THEN RAISE EXCEPTION 'Unknown simulation scenario'; END IF;
  INSERT INTO public.connector_connections(org_id, workspace_id, connector_key, status, config, scopes, expires_at, account_label,
    last_checked_at, last_error, granted_levels, connected_by, connected_at)
  VALUES (w.org_id, w.id, _provider, st, jsonb_build_object('simulated', true), ARRAY(SELECT 'sim:' || l FROM unnest(lv) l),
    CASE WHEN st = 'expired' THEN now() - interval '1 minute' ELSE now() + interval '30 days' END,
    'Simulated ' || replace(_provider, 'sim.', '') || ' account', now(),
    CASE st WHEN 'connected' THEN NULL WHEN 'expired' THEN 'Simulated: token expired' WHEN 'insufficient_scope' THEN 'Simulated: permission missing' ELSE 'Simulated: provider error' END,
    lv, auth.uid(), now())
  ON CONFLICT (org_id, workspace_id, connector_key) DO UPDATE SET status = EXCLUDED.status, scopes = EXCLUDED.scopes,
    expires_at = EXCLUDED.expires_at, account_label = EXCLUDED.account_label, last_checked_at = now(), last_error = EXCLUDED.last_error,
    granted_levels = EXCLUDED.granted_levels, connected_by = auth.uid(), connected_at = now(), config = EXCLUDED.config
  RETURNING id INTO conn;
  PERFORM public.log_integration_audit(w.org_id, 'integration.simulated_connected', _provider, jsonb_build_object('workspace_id', w.id, 'connection_id', conn, 'levels', lv, 'status', st));
  RETURN jsonb_build_object('connection_id', conn, 'status', st, 'levels', lv);
END $$;

CREATE OR REPLACE FUNCTION public.set_integration_levels(_connection uuid, _levels text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.connector_connections%ROWTYPE; p jsonb; lv text[];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO c FROM public.connector_connections WHERE id = _connection FOR UPDATE;
  IF NOT FOUND OR c.workspace_id IS NULL OR NOT public.has_workspace_role(c.workspace_id, 'admin') THEN RAISE EXCEPTION 'Only workspace administrators can manage integrations'; END IF;
  p := public.integration_provider(c.connector_key);
  IF p IS NULL THEN RAISE EXCEPTION 'Unknown integration'; END IF;
  IF c.status IN ('not_configured','disabled') THEN RAISE EXCEPTION 'Connect the integration before granting permissions'; END IF;
  lv := (SELECT coalesce(array_agg(DISTINCT l ORDER BY l), '{}') FROM unnest(coalesce(_levels, '{}')) l);
  IF NOT lv <@ ARRAY(SELECT jsonb_array_elements_text(p->'levels')) THEN RAISE EXCEPTION 'This integration does not support the requested permissions'; END IF;
  UPDATE public.connector_connections SET granted_levels = lv WHERE id = c.id;
  PERFORM public.log_integration_audit(c.org_id, 'integration.permissions_changed', c.connector_key, jsonb_build_object('workspace_id', c.workspace_id, 'connection_id', c.id, 'from', c.granted_levels, 'to', lv));
  RETURN jsonb_build_object('levels', lv);
END $$;

CREATE OR REPLACE FUNCTION public.set_simulated_integration_health(_connection uuid, _status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.connector_connections%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _status NOT IN ('connected','expired','insufficient_scope','error') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  SELECT * INTO c FROM public.connector_connections WHERE id = _connection FOR UPDATE;
  IF NOT FOUND OR NOT c.simulated OR NOT public.has_workspace_role(c.workspace_id, 'admin') THEN RAISE EXCEPTION 'Simulated integration unavailable'; END IF;
  IF c.status = 'disabled' THEN RAISE EXCEPTION 'This integration was revoked; connect it again'; END IF;
  UPDATE public.connector_connections SET status = _status, last_checked_at = now(),
    expires_at = CASE WHEN _status = 'expired' THEN now() - interval '1 minute' WHEN _status = 'connected' THEN now() + interval '30 days' ELSE expires_at END,
    last_error = CASE _status WHEN 'connected' THEN NULL WHEN 'expired' THEN 'Simulated: token expired' WHEN 'insufficient_scope' THEN 'Simulated: permission missing' ELSE 'Simulated: provider error' END
  WHERE id = c.id;
  PERFORM public.log_integration_audit(c.org_id, 'connector.health_changed', c.connector_key, jsonb_build_object('workspace_id', c.workspace_id, 'from', c.status, 'to', _status, 'simulated', true));
END $$;

-- Revoke: removes every granted permission at once; open actions on it can no longer execute.
CREATE OR REPLACE FUNCTION public.revoke_simulated_integration(_connection uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.connector_connections%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO c FROM public.connector_connections WHERE id = _connection FOR UPDATE;
  IF NOT FOUND OR NOT c.simulated OR NOT public.has_workspace_role(c.workspace_id, 'admin') THEN RAISE EXCEPTION 'Simulated integration unavailable'; END IF;
  UPDATE public.connector_connections SET status = 'disabled', granted_levels = '{}', scopes = '{}', expires_at = NULL, last_error = NULL, last_checked_at = now() WHERE id = c.id;
  PERFORM public.log_integration_audit(c.org_id, 'connector.disconnected', c.connector_key, jsonb_build_object('workspace_id', c.workspace_id, 'connection_id', c.id, 'simulated', true));
END $$;

-- 3. External actions ------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.external_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  request_key uuid NOT NULL,
  task_id uuid NOT NULL,
  project_id uuid, campaign_id uuid, goal_id uuid, initiative_id uuid, plan_version_id uuid, strategy_id uuid,
  connection_id uuid NOT NULL REFERENCES public.connector_connections(id),
  provider text NOT NULL,
  simulated boolean NOT NULL,
  specialist_key text NOT NULL,
  action_type text NOT NULL,
  required_level text NOT NULL CHECK (required_level IN ('read','draft','modify','execute','publish','budget')),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  payload jsonb NOT NULL DEFAULT '{}',
  estimated_cost numeric(12,2) CHECK (estimated_cost IS NULL OR estimated_cost BETWEEN 0 AND 10000000),
  currency text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  stage text NOT NULL DEFAULT 'draft' CHECK (stage IN ('draft','in_review','approved','rejected','executing','executed','failed','uncertain','cancelled')),
  approval_mode text CHECK (approval_mode IN ('manual','policy')),
  decided_by uuid, decided_at timestamptz, decision_note text NOT NULL DEFAULT '',
  attempts int NOT NULL DEFAULT 0,
  exec_key uuid,
  external_ref text,
  executed_at timestamptz,
  error text,
  verification text NOT NULL DEFAULT 'not_verified' CHECK (verification IN ('not_verified','pending','verified','failed','unavailable')),
  verified_at timestamptz,
  evidence jsonb NOT NULL DEFAULT '{}',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, request_key),
  FOREIGN KEY (task_id, org_id, workspace_id) REFERENCES public.tasks(id, org_id, workspace_id),
  CHECK ((estimated_cost IS NULL) = (currency IS NULL))
);
CREATE INDEX IF NOT EXISTS external_actions_ws_stage ON public.external_actions(workspace_id, stage, created_at DESC);
CREATE INDEX IF NOT EXISTS external_actions_task ON public.external_actions(task_id);
REVOKE ALL ON public.external_actions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.external_actions TO authenticated;
GRANT ALL ON public.external_actions TO service_role;
ALTER TABLE public.external_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS external_actions_read ON public.external_actions;
CREATE POLICY external_actions_read ON public.external_actions FOR SELECT TO authenticated USING (public.has_workspace_role(workspace_id, 'viewer'));

-- The sandbox's own storage: what a simulated provider "holds". One record per execution key (provider idempotency).
CREATE TABLE IF NOT EXISTS public.simulated_provider_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  connection_id uuid NOT NULL REFERENCES public.connector_connections(id),
  request_key uuid NOT NULL,
  action_type text NOT NULL,
  external_ref text NOT NULL,
  state text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, request_key),
  UNIQUE (external_ref)
);
REVOKE ALL ON public.simulated_provider_records FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.simulated_provider_records TO authenticated;
GRANT ALL ON public.simulated_provider_records TO service_role;
ALTER TABLE public.simulated_provider_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS simulated_provider_records_read ON public.simulated_provider_records;
CREATE POLICY simulated_provider_records_read ON public.simulated_provider_records FOR SELECT TO authenticated USING (public.has_workspace_role(workspace_id, 'viewer'));

CREATE OR REPLACE FUNCTION public.log_external_action(_a public.external_actions, _action text, _extra jsonb DEFAULT '{}')
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.activity_events(org_id, workspace_id, entity_type, entity_id, actor_id, action, metadata)
  VALUES (_a.org_id, _a.workspace_id, 'external_actions', _a.id, auth.uid(), _action,
    jsonb_build_object('task_id', _a.task_id, 'stage', _a.stage, 'verification', _a.verification, 'type', _a.action_type,
      'provider', _a.provider, 'simulated', _a.simulated, 'attempt', _a.attempts) || coalesce(_extra, '{}'));
$$;
REVOKE ALL ON FUNCTION public.log_external_action(public.external_actions, text, jsonb) FROM PUBLIC, anon, authenticated;

-- Why an action can or cannot use its connection right now (NULL = usable). Checked again at execution.
CREATE OR REPLACE FUNCTION public.external_action_gate(_a public.external_actions)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.connector_connections%ROWTYPE; paused boolean;
BEGIN
  SELECT * INTO c FROM public.connector_connections WHERE id = _a.connection_id;
  IF NOT FOUND OR c.status IN ('disabled','not_configured') THEN RETURN 'disconnected'; END IF;
  IF c.status = 'expired' OR (c.expires_at IS NOT NULL AND c.expires_at <= now()) THEN RETURN 'expired'; END IF;
  IF c.status = 'insufficient_scope' THEN RETURN 'permission_missing'; END IF;
  IF c.status <> 'connected' THEN RETURN 'connection_error'; END IF;
  IF NOT (_a.required_level = ANY (c.granted_levels)) THEN RETURN 'level_not_granted'; END IF;
  IF NOT (_a.action_type = ANY (public.specialist_external_actions(_a.specialist_key))) THEN RETURN 'specialist_not_allowed'; END IF;
  IF NOT c.simulated THEN RETURN 'real_execution_disabled'; END IF;
  SELECT s.paused INTO paused FROM public.execution_settings s WHERE s.workspace_id = _a.workspace_id;
  IF coalesce(paused, false) THEN RETURN 'paused'; END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.external_action_gate(public.external_actions) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.external_action_blocker(_action uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.external_actions%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public.external_actions WHERE id = _action;
  IF NOT FOUND OR NOT public.has_workspace_role(a.workspace_id, 'viewer') THEN RETURN 'unavailable'; END IF;
  RETURN public.external_action_gate(a);
END $$;
REVOKE ALL ON FUNCTION public.external_action_blocker(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.external_action_blocker(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_external_action(_workspace uuid, _request uuid, _task uuid, _connection uuid, _specialist text,
  _type text, _title text, _description text, _payload jsonb, _cost numeric, _currency text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w public.workspaces%ROWTYPE; t public.tasks%ROWTYPE; c public.connector_connections%ROWTYPE; spec jsonb; prov jsonb;
  a public.external_actions%ROWTYPE; assigned text; g uuid; ini uuid; pv uuid; st uuid; k text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _request IS NULL THEN RAISE EXCEPTION 'Request key required'; END IF;
  SELECT * INTO w FROM public.workspaces WHERE id = _workspace;
  IF NOT FOUND OR NOT public.has_workspace_role(_workspace, 'member') THEN RAISE EXCEPTION 'Only members can prepare external actions'; END IF;
  SELECT * INTO a FROM public.external_actions WHERE workspace_id = _workspace AND request_key = _request;
  IF FOUND THEN
    IF a.task_id <> _task OR a.action_type <> _type OR a.connection_id <> _connection THEN RAISE EXCEPTION 'This request key was already used'; END IF;
    RETURN jsonb_build_object('action_id', a.id, 'stage', a.stage, 'existing', true);
  END IF;
  spec := public.external_action_spec(_type);
  IF spec IS NULL THEN RAISE EXCEPTION 'Unknown action type'; END IF;
  SELECT * INTO t FROM public.tasks WHERE id = _task AND workspace_id = _workspace;
  IF NOT FOUND THEN RAISE EXCEPTION 'Task unavailable'; END IF;
  SELECT specialist_key INTO assigned FROM public.task_execution_profiles WHERE task_id = t.id;
  IF assigned IS NOT NULL AND assigned <> _specialist THEN RAISE EXCEPTION 'Use the specialist assigned to this task'; END IF;
  IF NOT (_type = ANY (public.specialist_external_actions(_specialist))) THEN RAISE EXCEPTION 'This specialist cannot prepare this action'; END IF;
  SELECT * INTO c FROM public.connector_connections WHERE id = _connection AND workspace_id = _workspace AND org_id = w.org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Integration unavailable'; END IF;
  prov := public.integration_provider(c.connector_key);
  IF prov IS NULL OR NOT (replace(c.connector_key, 'sim.', '') = ANY (ARRAY(SELECT jsonb_array_elements_text(spec->'providers'))))
     OR NOT ((spec->>'level') = ANY (ARRAY(SELECT jsonb_array_elements_text(prov->'levels')))) THEN
    RAISE EXCEPTION 'This integration does not support this action';
  END IF;
  IF _payload IS NULL OR jsonb_typeof(_payload) <> 'object' OR length(_payload::text) > 8000 THEN RAISE EXCEPTION 'Action details are not valid'; END IF;
  FOR k IN SELECT jsonb_array_elements_text(spec->'required') LOOP
    IF NOT (_payload ? k) OR length(trim(_payload->>k)) = 0 THEN RAISE EXCEPTION 'Missing action detail: %', k; END IF;
  END LOOP;
  IF _type = 'ads.change_budget' AND ((_payload->>'daily_budget') !~ '^[0-9]+(\.[0-9]{1,2})?$' OR (_payload->>'daily_budget')::numeric <= 0 OR (_payload->>'daily_budget')::numeric > 100000) THEN
    RAISE EXCEPTION 'Daily budget is not valid';
  END IF;
  IF (_cost IS NULL) <> (_currency IS NULL) THEN RAISE EXCEPTION 'Give both an estimated cost and its currency, or neither'; END IF;
  -- Links to the growth hierarchy are copied from the task at creation so the action stays traceable.
  SELECT coalesce(p.goal_id, cm.goal_id) INTO g FROM (SELECT 1) x
    LEFT JOIN public.projects p ON p.id = t.project_id LEFT JOIN public.campaigns cm ON cm.id = t.campaign_id;
  IF t.project_id IS NOT NULL THEN
    SELECT i.id, i.plan_version_id, v.strategy_id INTO ini, pv, st FROM public.growth_initiatives i
      JOIN public.growth_plan_versions v ON v.id = i.plan_version_id
     WHERE i.project_id = t.project_id AND i.workspace_id = _workspace ORDER BY i.created_at LIMIT 1;
  END IF;
  INSERT INTO public.external_actions(org_id, workspace_id, request_key, task_id, project_id, campaign_id, goal_id, initiative_id, plan_version_id, strategy_id,
    connection_id, provider, simulated, specialist_key, action_type, required_level, title, description, payload, estimated_cost, currency, created_by)
  VALUES (w.org_id, w.id, _request, t.id, t.project_id, t.campaign_id, g, ini, pv, st,
    c.id, c.connector_key, c.simulated, _specialist, _type, spec->>'level', left(trim(_title), 160), left(coalesce(_description, ''), 2000), _payload, _cost, _currency, auth.uid())
  RETURNING * INTO a;
  PERFORM public.log_external_action(a, 'created');
  RETURN jsonb_build_object('action_id', a.id, 'stage', a.stage, 'existing', false);
END $$;

-- Submit for review. Draft-level actions in bounded autonomy are approved by the recorded workspace policy; every
-- other level waits for an administrator.
CREATE OR REPLACE FUNCTION public.submit_external_action(_action uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.external_actions%ROWTYPE; m smallint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO a FROM public.external_actions WHERE id = _action FOR UPDATE;
  IF NOT FOUND OR NOT public.has_workspace_role(a.workspace_id, 'member') THEN RAISE EXCEPTION 'Action unavailable'; END IF;
  IF a.created_by <> auth.uid() AND NOT public.has_workspace_role(a.workspace_id, 'admin') THEN RAISE EXCEPTION 'Only the author or an administrator can submit this action'; END IF;
  IF a.stage <> 'draft' THEN RAISE EXCEPTION 'Only drafts can be submitted'; END IF;
  SELECT s.mode INTO m FROM public.execution_settings s WHERE s.workspace_id = a.workspace_id;
  IF a.required_level = 'draft' AND coalesce(m, 2) = 4 THEN
    UPDATE public.external_actions SET stage = 'approved', approval_mode = 'policy', decided_at = now(), decided_by = NULL,
      decision_note = 'Approved by the workspace bounded-autonomy policy (draft level)', updated_at = now() WHERE id = a.id RETURNING * INTO a;
    PERFORM public.log_external_action(a, 'approved_by_policy');
  ELSE
    UPDATE public.external_actions SET stage = 'in_review', updated_at = now() WHERE id = a.id RETURNING * INTO a;
    PERFORM public.log_external_action(a, 'submitted');
  END IF;
  RETURN jsonb_build_object('stage', a.stage, 'approval_mode', a.approval_mode);
END $$;

CREATE OR REPLACE FUNCTION public.decide_external_action(_action uuid, _approve boolean, _note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.external_actions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO a FROM public.external_actions WHERE id = _action FOR UPDATE;
  IF NOT FOUND OR NOT public.has_workspace_role(a.workspace_id, 'admin') THEN RAISE EXCEPTION 'Only workspace administrators can approve external actions'; END IF;
  IF a.stage <> 'in_review' THEN RAISE EXCEPTION 'This action is not waiting for approval'; END IF;
  IF NOT _approve AND length(trim(coalesce(_note, ''))) = 0 THEN RAISE EXCEPTION 'Give a reason for rejecting'; END IF;
  UPDATE public.external_actions SET stage = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END, approval_mode = 'manual',
    decided_by = auth.uid(), decided_at = now(), decision_note = left(coalesce(_note, ''), 500), updated_at = now() WHERE id = a.id RETURNING * INTO a;
  PERFORM public.log_external_action(a, CASE WHEN _approve THEN 'approved' ELSE 'rejected' END, jsonb_build_object('note', a.decision_note));
  RETURN jsonb_build_object('stage', a.stage);
END $$;

CREATE OR REPLACE FUNCTION public.cancel_external_action(_action uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.external_actions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO a FROM public.external_actions WHERE id = _action FOR UPDATE;
  IF NOT FOUND OR NOT public.has_workspace_role(a.workspace_id, 'member') THEN RAISE EXCEPTION 'Action unavailable'; END IF;
  IF a.created_by <> auth.uid() AND NOT public.has_workspace_role(a.workspace_id, 'admin') THEN RAISE EXCEPTION 'Only the author or an administrator can cancel this action'; END IF;
  IF a.stage NOT IN ('draft','in_review','approved','failed') THEN RAISE EXCEPTION 'This action can no longer be cancelled'; END IF;
  UPDATE public.external_actions SET stage = 'cancelled', updated_at = now() WHERE id = a.id RETURNING * INTO a;
  PERFORM public.log_external_action(a, 'cancelled');
  RETURN jsonb_build_object('stage', a.stage);
END $$;

-- Server-attested: claim one execution attempt under a fresh key. Retries only after a definite failure, at most 3.
CREATE OR REPLACE FUNCTION public.begin_external_action_verified(_action uuid, _key uuid, _proof text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.external_actions%ROWTYPE; gate text;
BEGIN
  PERFORM public.verify_ai_accounting(_proof);
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _key IS NULL THEN RAISE EXCEPTION 'Execution key required'; END IF;
  SELECT * INTO a FROM public.external_actions WHERE id = _action FOR UPDATE;
  IF NOT FOUND OR NOT public.has_workspace_role(a.workspace_id, 'member') THEN RAISE EXCEPTION 'Action unavailable'; END IF;
  IF a.required_level IN ('publish','budget') AND NOT public.has_workspace_role(a.workspace_id, 'admin') THEN
    RAISE EXCEPTION 'gate:admin_required';
  END IF;
  IF a.stage = 'executing' AND a.exec_key = _key THEN
    RETURN jsonb_build_object('stage', a.stage, 'existing', true, 'provider', a.provider, 'connection_id', a.connection_id, 'type', a.action_type, 'payload', a.payload, 'attempt', a.attempts);
  END IF;
  IF a.stage = 'uncertain' THEN RAISE EXCEPTION 'gate:verify_first'; END IF;
  IF a.stage = 'failed' AND a.attempts >= 3 THEN RAISE EXCEPTION 'gate:attempts_exhausted'; END IF;
  IF a.stage NOT IN ('approved','failed') OR a.approval_mode IS NULL THEN RAISE EXCEPTION 'gate:not_approved'; END IF;
  gate := public.external_action_gate(a);
  IF gate IS NOT NULL THEN RAISE EXCEPTION 'gate:%', gate; END IF;
  UPDATE public.external_actions SET stage = 'executing', exec_key = _key, attempts = attempts + 1, error = NULL, updated_at = now()
   WHERE id = a.id RETURNING * INTO a;
  PERFORM public.log_external_action(a, 'execution_started');
  RETURN jsonb_build_object('stage', a.stage, 'existing', false, 'provider', a.provider, 'connection_id', a.connection_id, 'type', a.action_type, 'payload', a.payload, 'attempt', a.attempts);
END $$;

-- Server-attested outcome. "uncertain" = no definite answer (timeout); it can only be resolved by verification.
-- A provider permission/expiry answer is also written to the connection's health.
CREATE OR REPLACE FUNCTION public.finish_external_action_verified(_action uuid, _key uuid, _outcome text, _ref text, _error text, _health text, _proof text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.external_actions%ROWTYPE;
BEGIN
  PERFORM public.verify_ai_accounting(_proof);
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _outcome NOT IN ('executed','failed','uncertain') THEN RAISE EXCEPTION 'Invalid outcome'; END IF;
  IF _health IS NOT NULL AND _health NOT IN ('expired','insufficient_scope','error') THEN RAISE EXCEPTION 'Invalid health'; END IF;
  SELECT * INTO a FROM public.external_actions WHERE id = _action FOR UPDATE;
  IF NOT FOUND OR NOT public.has_workspace_role(a.workspace_id, 'member') THEN RAISE EXCEPTION 'Action unavailable'; END IF;
  IF a.stage <> 'executing' OR a.exec_key IS DISTINCT FROM _key THEN RAISE EXCEPTION 'This execution attempt is not open'; END IF;
  IF _outcome = 'executed' AND length(coalesce(_ref, '')) = 0 THEN RAISE EXCEPTION 'An executed action needs the provider reference'; END IF;
  UPDATE public.external_actions SET stage = _outcome, external_ref = CASE WHEN _outcome = 'executed' THEN left(_ref, 200) ELSE external_ref END,
    executed_at = CASE WHEN _outcome = 'executed' THEN now() ELSE executed_at END,
    error = CASE WHEN _outcome = 'executed' THEN NULL ELSE left(coalesce(_error, ''), 300) END,
    verification = CASE WHEN _outcome = 'failed' THEN 'not_verified' ELSE 'pending' END, updated_at = now()
   WHERE id = a.id RETURNING * INTO a;
  IF _health IS NOT NULL THEN
    UPDATE public.connector_connections SET status = _health, last_checked_at = now(), last_error = left(coalesce(_error, ''), 300) WHERE id = a.connection_id;
  END IF;
  PERFORM public.log_external_action(a, 'execution_' || _outcome, jsonb_build_object('error', a.error, 'external_ref', a.external_ref));
  RETURN jsonb_build_object('stage', a.stage, 'verification', a.verification);
END $$;

-- Server-attested verification from a provider lookup. found=false on an uncertain attempt proves it never ran, so
-- it becomes a retryable failure; on an executed action it is a verification failure.
CREATE OR REPLACE FUNCTION public.record_external_verification_verified(_action uuid, _status text, _found boolean, _ref text, _evidence jsonb, _proof text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.external_actions%ROWTYPE;
BEGIN
  PERFORM public.verify_ai_accounting(_proof);
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _status NOT IN ('verified','failed','unavailable') THEN RAISE EXCEPTION 'Invalid verification status'; END IF;
  IF _evidence IS NOT NULL AND (jsonb_typeof(_evidence) <> 'object' OR length(_evidence::text) > 4000) THEN RAISE EXCEPTION 'Evidence is not valid'; END IF;
  SELECT * INTO a FROM public.external_actions WHERE id = _action FOR UPDATE;
  IF NOT FOUND OR NOT public.has_workspace_role(a.workspace_id, 'member') THEN RAISE EXCEPTION 'Action unavailable'; END IF;
  IF a.stage NOT IN ('executed','uncertain') THEN RAISE EXCEPTION 'Only executed or uncertain actions can be verified'; END IF;
  IF a.stage = 'uncertain' THEN
    IF _status = 'unavailable' THEN RAISE EXCEPTION 'An uncertain action needs a provider lookup'; END IF;
    IF _found THEN
      UPDATE public.external_actions SET stage = 'executed', external_ref = left(_ref, 200), executed_at = coalesce(executed_at, now()), error = NULL,
        verification = _status, verified_at = now(), evidence = coalesce(_evidence, '{}'), updated_at = now() WHERE id = a.id RETURNING * INTO a;
    ELSE
      UPDATE public.external_actions SET stage = 'failed', error = 'Not executed: the provider has no record of this attempt',
        verification = 'not_verified', verified_at = now(), evidence = coalesce(_evidence, '{}'), updated_at = now() WHERE id = a.id RETURNING * INTO a;
    END IF;
  ELSE
    UPDATE public.external_actions SET verification = _status, verified_at = now(), evidence = coalesce(_evidence, '{}'), updated_at = now() WHERE id = a.id RETURNING * INTO a;
  END IF;
  PERFORM public.log_external_action(a, 'verification_' || _status, jsonb_build_object('found', _found));
  RETURN jsonb_build_object('stage', a.stage, 'verification', a.verification);
END $$;

-- An attempt whose outcome was never recorded (the server stopped mid-way) becomes uncertain after 10 minutes, so it
-- can only be resolved by verification and is never run twice.
CREATE OR REPLACE FUNCTION public.mark_stalled_external_action(_action uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.external_actions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO a FROM public.external_actions WHERE id = _action FOR UPDATE;
  IF NOT FOUND OR NOT public.has_workspace_role(a.workspace_id, 'member') THEN RAISE EXCEPTION 'Action unavailable'; END IF;
  IF a.stage <> 'executing' OR a.updated_at > now() - interval '10 minutes' THEN RAISE EXCEPTION 'This action is not stalled'; END IF;
  UPDATE public.external_actions SET stage = 'uncertain', verification = 'pending', error = 'No outcome was recorded for this attempt', updated_at = now()
   WHERE id = a.id RETURNING * INTO a;
  PERFORM public.log_external_action(a, 'execution_uncertain', jsonb_build_object('reason', 'stalled'));
  RETURN jsonb_build_object('stage', a.stage);
END $$;

-- 4. Simulated provider storage (server-attested) ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sim_provider_write_verified(_connection uuid, _key uuid, _type text, _state text, _payload jsonb, _proof text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.connector_connections%ROWTYPE; r public.simulated_provider_records%ROWTYPE;
BEGIN
  PERFORM public.verify_ai_accounting(_proof);
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO c FROM public.connector_connections WHERE id = _connection;
  IF NOT FOUND OR NOT c.simulated OR NOT public.has_workspace_role(c.workspace_id, 'member') THEN RAISE EXCEPTION 'Simulated integration unavailable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.external_actions WHERE connection_id = c.id AND exec_key = _key AND stage = 'executing') THEN
    RAISE EXCEPTION 'No open execution for this key';
  END IF;
  SELECT * INTO r FROM public.simulated_provider_records WHERE connection_id = c.id AND request_key = _key;
  IF FOUND THEN RETURN jsonb_build_object('external_ref', r.external_ref, 'state', r.state, 'existing', true); END IF;
  INSERT INTO public.simulated_provider_records(org_id, workspace_id, connection_id, request_key, action_type, external_ref, state, payload)
  VALUES (c.org_id, c.workspace_id, c.id, _key, _type, 'sim_' || replace(c.connector_key, 'sim.', '') || '_' || substr(md5(_key::text), 1, 12), left(_state, 40), coalesce(_payload, '{}'))
  RETURNING * INTO r;
  RETURN jsonb_build_object('external_ref', r.external_ref, 'state', r.state, 'existing', false);
END $$;

CREATE OR REPLACE FUNCTION public.sim_provider_lookup_verified(_connection uuid, _key uuid, _proof text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.connector_connections%ROWTYPE; r public.simulated_provider_records%ROWTYPE;
BEGIN
  PERFORM public.verify_ai_accounting(_proof);
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO c FROM public.connector_connections WHERE id = _connection;
  IF NOT FOUND OR NOT c.simulated OR NOT public.has_workspace_role(c.workspace_id, 'member') THEN RAISE EXCEPTION 'Simulated integration unavailable'; END IF;
  SELECT * INTO r FROM public.simulated_provider_records WHERE connection_id = c.id AND request_key = _key;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;
  RETURN jsonb_build_object('found', true, 'external_ref', r.external_ref, 'state', r.state, 'created_at', r.created_at, 'type', r.action_type);
END $$;

DO $grants$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.connect_simulated_integration(uuid,text,text[],text)',
    'public.set_integration_levels(uuid,text[])',
    'public.set_simulated_integration_health(uuid,text)',
    'public.revoke_simulated_integration(uuid)',
    'public.create_external_action(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,numeric,text)',
    'public.submit_external_action(uuid)',
    'public.decide_external_action(uuid,boolean,text)',
    'public.cancel_external_action(uuid)',
    'public.mark_stalled_external_action(uuid)',
    'public.begin_external_action_verified(uuid,uuid,text)',
    'public.finish_external_action_verified(uuid,uuid,text,text,text,text,text)',
    'public.record_external_verification_verified(uuid,text,boolean,text,jsonb,text)',
    'public.sim_provider_write_verified(uuid,uuid,text,text,jsonb,text)',
    'public.sim_provider_lookup_verified(uuid,uuid,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $grants$;
