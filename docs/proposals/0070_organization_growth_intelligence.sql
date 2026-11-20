-- PROPOSED migration 0070 — organization growth intelligence. Staging only until separately approved; requires 0063–0069.
-- Adds the organization level above the businesses (workspaces) without a parallel business structure:
--   1. org_strategies: organization-wide strategy versions drafted by the Organization Growth Officer through the existing
--      single-request AI accounting (one paid, user-started request); approving one never changes a business strategy;
--   2. org_opportunities: cross-business opportunities from deterministic rules or the AI, always hypotheses until validated;
--   3. org_initiatives + org_initiative_commitments: shared initiatives where each participating business's own
--      administrator approves (or declines) its own commitment; approval creates that business's project and tasks inside
--      the business, so work keeps its business context and cost allocation;
--   4. org_allocation_proposals: budget shifts and specialist capacity (monthly AI credit caps) that change nothing until
--      someone holding the existing business-level right applies them (budget editor of both businesses; business admin);
--   5. decision history in the existing append-only audit log (no second history table).
-- Every record can only be read by someone who can open every business it covers (commitments: their own business).
-- Nothing here moves money, credits, permissions or autonomy settings on its own.

-- 0. Helper -------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_open_businesses(_org uuid, _ws uuid[], _min public.org_role) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND _org IS NOT NULL AND _ws IS NOT NULL AND cardinality(_ws) BETWEEN 1 AND 50
    AND public.is_org_member(_org)
    AND NOT EXISTS (SELECT 1 FROM unnest(_ws) w WHERE w IS NULL OR public.ws_org(w) IS DISTINCT FROM _org OR NOT public.has_workspace_role(w, _min))
$$;
REVOKE ALL ON FUNCTION public.can_open_businesses(uuid, uuid[], public.org_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_open_businesses(uuid, uuid[], public.org_role) TO authenticated;

-- 1. Organization strategies ------------------------------------------------------------------------------------------
ALTER TABLE public.single_ai_requests DROP CONSTRAINT IF EXISTS single_ai_requests_kind_check;
ALTER TABLE public.single_ai_requests ADD CONSTRAINT single_ai_requests_kind_check
  CHECK (kind = ANY (ARRAY['growth_officer','strategy','research','seo','content','organization']));

CREATE TABLE IF NOT EXISTS public.org_strategies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  request_id uuid NOT NULL UNIQUE REFERENCES public.single_ai_requests(id),
  version int NOT NULL CHECK (version >= 1),
  business_ids uuid[] NOT NULL CHECK (cardinality(business_ids) BETWEEN 2 AND 50),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  summary text NOT NULL CHECK (length(summary) BETWEEN 1 AND 4000),
  horizon_months int NOT NULL CHECK (horizon_months BETWEEN 1 AND 36),
  body jsonb NOT NULL CHECK (jsonb_typeof(body) = 'object' AND length(body::text) <= 60000),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','superseded','rejected')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text NOT NULL DEFAULT '' CHECK (length(decision_note) <= 1000),
  UNIQUE (org_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS org_strategies_one_approved ON public.org_strategies(org_id) WHERE status = 'approved';
REVOKE ALL ON public.org_strategies FROM anon, authenticated;
GRANT SELECT ON public.org_strategies TO authenticated;
GRANT ALL ON public.org_strategies TO service_role;
ALTER TABLE public.org_strategies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "readers open every covered business" ON public.org_strategies;
CREATE POLICY "readers open every covered business" ON public.org_strategies FOR SELECT TO authenticated
  USING (public.can_open_businesses(org_id, business_ids, 'viewer'));

-- 2. Cross-business opportunities ---------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.org_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  strategy_id uuid REFERENCES public.org_strategies(id) ON DELETE SET NULL,
  origin text NOT NULL CHECK (origin IN ('rule','ai')),
  rule_key text CHECK (rule_key IS NULL OR length(rule_key) BETWEEN 1 AND 300),
  kind text NOT NULL CHECK (kind IN ('shared_audience','cross_sell','upsell','bundle','partnership','joint_campaign','joint_event',
    'shared_content','shared_channel','operational_synergy','strategy_reuse','shared_resources','specialist_reuse')),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  business_ids uuid[] NOT NULL CHECK (cardinality(business_ids) BETWEEN 2 AND 20),
  evidence jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(evidence) = 'array' AND jsonb_array_length(evidence) <= 20 AND length(evidence::text) <= 8000),
  expected_impact text NOT NULL DEFAULT '' CHECK (length(expected_impact) <= 1000),
  estimated_cost text NOT NULL DEFAULT '' CHECK (length(estimated_cost) <= 500),
  dependencies text NOT NULL DEFAULT '' CHECK (length(dependencies) <= 1000),
  risks text NOT NULL DEFAULT '' CHECK (length(risks) <= 1000),
  confidence text NOT NULL CHECK (confidence IN ('low','medium','high')),
  next_action text NOT NULL DEFAULT '' CHECK (length(next_action) <= 500),
  status text NOT NULL DEFAULT 'hypothesis' CHECK (status IN ('hypothesis','validating','validated','dismissed','converted')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text NOT NULL DEFAULT '' CHECK (length(decision_note) <= 1000)
);
CREATE UNIQUE INDEX IF NOT EXISTS org_opportunities_rule_once ON public.org_opportunities(org_id, rule_key) WHERE rule_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS org_opportunities_org ON public.org_opportunities(org_id, status);
REVOKE ALL ON public.org_opportunities FROM anon, authenticated;
GRANT SELECT ON public.org_opportunities TO authenticated;
GRANT ALL ON public.org_opportunities TO service_role;
ALTER TABLE public.org_opportunities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "readers open every involved business" ON public.org_opportunities;
CREATE POLICY "readers open every involved business" ON public.org_opportunities FOR SELECT TO authenticated
  USING (public.can_open_businesses(org_id, business_ids, 'viewer'));

-- Validates evidence items: [{text, class}] where class says how much the statement can be trusted.
CREATE OR REPLACE FUNCTION public.org_valid_evidence(_e jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT jsonb_typeof(_e) = 'array' AND jsonb_array_length(_e) <= 20 AND length(_e::text) <= 8000
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_e) x WHERE jsonb_typeof(x) <> 'object'
      OR length(coalesce(x->>'text','')) NOT BETWEEN 1 AND 500
      OR coalesce(x->>'class','') NOT IN ('verified','recorded','estimate','assumption','missing'))
$$;
REVOKE ALL ON FUNCTION public.org_valid_evidence(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_valid_evidence(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_org_opportunity(_org uuid, _p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ws uuid[]; r public.org_opportunities%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_role(_org, 'editor') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF jsonb_typeof(_p) IS DISTINCT FROM 'object' OR jsonb_typeof(_p->'business_ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid opportunity'; END IF;
  SELECT array_agg(DISTINCT x::uuid ORDER BY x::uuid) INTO ws FROM jsonb_array_elements_text(_p->'business_ids') x;
  IF ws IS NULL OR cardinality(ws) < 2 OR NOT public.can_open_businesses(_org, ws, 'member') THEN RAISE EXCEPTION 'You need access to every business involved'; END IF;
  IF NOT public.org_valid_evidence(coalesce(_p->'evidence','[]')) THEN RAISE EXCEPTION 'invalid evidence'; END IF;
  IF nullif(_p->>'rule_key','') IS NOT NULL THEN
    SELECT * INTO r FROM public.org_opportunities WHERE org_id = _org AND rule_key = _p->>'rule_key';
    IF FOUND THEN RETURN to_jsonb(r) || jsonb_build_object('created', false); END IF;
  END IF;
  INSERT INTO public.org_opportunities(org_id, origin, rule_key, kind, title, business_ids, evidence, expected_impact, estimated_cost, dependencies, risks, confidence, next_action, created_by)
  VALUES (_org, 'rule', nullif(_p->>'rule_key',''), _p->>'kind', trim(coalesce(_p->>'title','')), ws, coalesce(_p->'evidence','[]'),
    coalesce(_p->>'expected_impact',''), coalesce(_p->>'estimated_cost',''), coalesce(_p->>'dependencies',''), coalesce(_p->>'risks',''),
    coalesce(_p->>'confidence','low'), coalesce(_p->>'next_action',''), auth.uid())
  RETURNING * INTO r;
  PERFORM public.log_audit(_org, 'org.opportunity.recorded', 'org_opportunity', r.id::text, jsonb_build_object('kind', r.kind, 'businesses', cardinality(ws), 'origin', 'rule'));
  RETURN to_jsonb(r) || jsonb_build_object('created', true);
END $$;
REVOKE ALL ON FUNCTION public.record_org_opportunity(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_org_opportunity(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_org_opportunity_status(_id uuid, _status text, _note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.org_opportunities%ROWTYPE; ok boolean;
BEGIN
  SELECT * INTO r FROM public.org_opportunities WHERE id = _id FOR UPDATE;
  IF r.id IS NULL OR auth.uid() IS NULL OR NOT public.has_org_role(r.org_id, 'editor') OR NOT public.can_open_businesses(r.org_id, r.business_ids, 'member') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF length(coalesce(_note,'')) > 1000 THEN RAISE EXCEPTION 'note too long'; END IF;
  ok := (r.status = 'hypothesis' AND _status IN ('validating','validated','dismissed'))
     OR (r.status = 'validating' AND _status IN ('validated','dismissed','hypothesis'))
     OR (r.status = 'validated' AND _status IN ('dismissed'))
     OR (r.status = 'dismissed' AND _status = 'hypothesis');
  IF NOT ok THEN RAISE EXCEPTION 'This change is not possible from the current status'; END IF;
  UPDATE public.org_opportunities SET status = _status, decided_by = auth.uid(), decided_at = now(), decision_note = coalesce(_note,''), updated_at = now()
    WHERE id = _id RETURNING * INTO r;
  PERFORM public.log_audit(r.org_id, 'org.opportunity.' || _status, 'org_opportunity', r.id::text, jsonb_build_object('note', left(coalesce(_note,''), 200)));
  RETURN to_jsonb(r);
END $$;
REVOKE ALL ON FUNCTION public.set_org_opportunity_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_org_opportunity_status(uuid, text, text) TO authenticated;

-- 3. Shared initiatives with per-business commitments -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.org_initiatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  request_key uuid NOT NULL,
  opportunity_id uuid REFERENCES public.org_opportunities(id) ON DELETE SET NULL,
  strategy_id uuid REFERENCES public.org_strategies(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  shared_objective text NOT NULL CHECK (length(trim(shared_objective)) BETWEEN 1 AND 2000),
  success_metrics jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(success_metrics) = 'array' AND jsonb_array_length(success_metrics) <= 10 AND length(success_metrics::text) <= 4000),
  required_specialists text[] NOT NULL DEFAULT '{}' CHECK (cardinality(required_specialists) <= 10),
  owner_id uuid,
  business_ids uuid[] NOT NULL CHECK (cardinality(business_ids) BETWEEN 2 AND 20),
  status text NOT NULL DEFAULT 'awaiting_commitments' CHECK (status IN ('awaiting_commitments','committed','declined','active','completed','cancelled')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, request_key)
);
CREATE TABLE IF NOT EXISTS public.org_initiative_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  initiative_id uuid NOT NULL REFERENCES public.org_initiatives(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  business_objective text NOT NULL CHECK (length(trim(business_objective)) BETWEEN 1 AND 1000),
  budget_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (budget_amount >= 0 AND budget_amount <= 1000000000),
  currency text NOT NULL DEFAULT 'EUR' CHECK (currency ~ '^[A-Z]{3}$'),
  tasks jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(tasks) = 'array' AND jsonb_array_length(tasks) <= 10 AND length(tasks::text) <= 6000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
  project_id uuid,
  decided_by uuid,
  decided_at timestamptz,
  decision_note text NOT NULL DEFAULT '' CHECK (length(decision_note) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (initiative_id, workspace_id),
  FOREIGN KEY (project_id, org_id, workspace_id) REFERENCES public.projects(id, org_id, workspace_id)
);
CREATE INDEX IF NOT EXISTS org_commitments_ws ON public.org_initiative_commitments(workspace_id, status);
REVOKE ALL ON public.org_initiatives FROM anon, authenticated;
REVOKE ALL ON public.org_initiative_commitments FROM anon, authenticated;
GRANT SELECT ON public.org_initiatives, public.org_initiative_commitments TO authenticated;
GRANT ALL ON public.org_initiatives, public.org_initiative_commitments TO service_role;
ALTER TABLE public.org_initiatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_initiative_commitments ENABLE ROW LEVEL SECURITY;
-- A participating business's people see the initiative (title, shared objective) so they can decide on their part;
-- each business's commitment (objective, budget, tasks) stays visible only inside that business.
DROP POLICY IF EXISTS "participants read initiatives" ON public.org_initiatives;
CREATE POLICY "participants read initiatives" ON public.org_initiatives FOR SELECT TO authenticated
  USING (public.is_org_member(org_id) AND EXISTS (SELECT 1 FROM unnest(business_ids) w WHERE public.has_workspace_role(w, 'viewer')));
DROP POLICY IF EXISTS "business reads own commitment" ON public.org_initiative_commitments;
CREATE POLICY "business reads own commitment" ON public.org_initiative_commitments FOR SELECT TO authenticated
  USING (public.has_workspace_role(workspace_id, 'viewer'));

CREATE OR REPLACE FUNCTION public.propose_org_initiative(_org uuid, _request uuid, _p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i public.org_initiatives%ROWTYPE; c jsonb; t jsonb; ws uuid[]; sp text; opp public.org_opportunities%ROWTYPE; sid uuid;
BEGIN
  IF auth.uid() IS NULL OR _request IS NULL OR NOT public.has_org_role(_org, 'editor') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO i FROM public.org_initiatives WHERE org_id = _org AND request_key = _request;
  IF FOUND THEN RETURN to_jsonb(i) || jsonb_build_object('created', false); END IF;
  IF jsonb_typeof(_p) IS DISTINCT FROM 'object' OR jsonb_typeof(_p->'commitments') IS DISTINCT FROM 'array' OR jsonb_array_length(_p->'commitments') NOT BETWEEN 2 AND 20 THEN
    RAISE EXCEPTION 'A shared initiative needs at least two businesses'; END IF;
  SELECT array_agg(DISTINCT (x->>'workspace_id')::uuid ORDER BY (x->>'workspace_id')::uuid) INTO ws FROM jsonb_array_elements(_p->'commitments') x;
  IF ws IS NULL OR cardinality(ws) <> jsonb_array_length(_p->'commitments') THEN RAISE EXCEPTION 'Each business can commit once'; END IF;
  IF NOT public.can_open_businesses(_org, ws, 'member') THEN RAISE EXCEPTION 'You need access to every participating business'; END IF;
  IF length(trim(coalesce(_p->>'title',''))) NOT BETWEEN 1 AND 200 OR length(trim(coalesce(_p->>'shared_objective',''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'invalid initiative'; END IF;
  IF jsonb_typeof(coalesce(_p->'success_metrics','[]')) <> 'array' OR jsonb_array_length(coalesce(_p->'success_metrics','[]')) > 10 THEN RAISE EXCEPTION 'invalid success metrics'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(_p->'success_metrics','[]')) m WHERE length(coalesce(m->>'metric','')) NOT BETWEEN 1 AND 200 OR length(coalesce(m->>'target','')) > 200) THEN RAISE EXCEPTION 'invalid success metrics'; END IF;
  IF jsonb_typeof(coalesce(_p->'required_specialists','[]')) <> 'array' OR jsonb_array_length(coalesce(_p->'required_specialists','[]')) > 10 THEN RAISE EXCEPTION 'invalid specialists'; END IF;
  FOR sp IN SELECT jsonb_array_elements_text(coalesce(_p->'required_specialists','[]')) LOOP
    IF sp !~ '^[a-z_]{2,40}$' THEN RAISE EXCEPTION 'invalid specialist'; END IF;
  END LOOP;
  IF nullif(_p->>'owner_id','') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.organization_members WHERE org_id = _org AND user_id = (_p->>'owner_id')::uuid) THEN
    RAISE EXCEPTION 'The owner must be a member of the organization'; END IF;
  IF nullif(_p->>'opportunity_id','') IS NOT NULL THEN
    SELECT * INTO opp FROM public.org_opportunities WHERE id = (_p->>'opportunity_id')::uuid AND org_id = _org;
    IF opp.id IS NULL OR opp.status IN ('dismissed','converted') OR NOT public.can_open_businesses(_org, opp.business_ids, 'member') THEN RAISE EXCEPTION 'Opportunity unavailable'; END IF;
  END IF;
  IF nullif(_p->>'strategy_id','') IS NOT NULL THEN
    SELECT id INTO sid FROM public.org_strategies WHERE id = (_p->>'strategy_id')::uuid AND org_id = _org AND status IN ('draft','approved');
    IF sid IS NULL THEN RAISE EXCEPTION 'Strategy unavailable'; END IF;
  END IF;
  FOR c IN SELECT value FROM jsonb_array_elements(_p->'commitments') LOOP
    IF length(trim(coalesce(c->>'business_objective',''))) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Each business needs its own objective'; END IF;
    IF coalesce((c->>'budget_amount')::numeric, 0) < 0 OR coalesce((c->>'budget_amount')::numeric, 0) > 1000000000 OR coalesce(c->>'currency','EUR') !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'invalid budget'; END IF;
    IF jsonb_typeof(coalesce(c->'tasks','[]')) <> 'array' OR jsonb_array_length(coalesce(c->'tasks','[]')) > 10 THEN RAISE EXCEPTION 'At most ten tasks per business'; END IF;
    FOR t IN SELECT value FROM jsonb_array_elements(coalesce(c->'tasks','[]')) LOOP
      IF length(trim(coalesce(t->>'title',''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid task'; END IF;
      IF nullif(t->>'due_date','') IS NOT NULL AND (t->>'due_date')::date IS NULL THEN RAISE EXCEPTION 'invalid task date'; END IF;
    END LOOP;
  END LOOP;
  INSERT INTO public.org_initiatives(org_id, request_key, opportunity_id, strategy_id, title, shared_objective, success_metrics, required_specialists, owner_id, business_ids, created_by)
  VALUES (_org, _request, opp.id, sid, trim(_p->>'title'), trim(_p->>'shared_objective'), coalesce(_p->'success_metrics','[]'),
    ARRAY(SELECT jsonb_array_elements_text(coalesce(_p->'required_specialists','[]'))), nullif(_p->>'owner_id','')::uuid, ws, auth.uid())
  RETURNING * INTO i;
  INSERT INTO public.org_initiative_commitments(initiative_id, org_id, workspace_id, business_objective, budget_amount, currency, tasks)
  SELECT i.id, _org, (x->>'workspace_id')::uuid, trim(x->>'business_objective'), coalesce((x->>'budget_amount')::numeric, 0), coalesce(x->>'currency','EUR'), coalesce(x->'tasks','[]')
  FROM jsonb_array_elements(_p->'commitments') x;
  PERFORM public.log_audit(_org, 'org.initiative.proposed', 'org_initiative', i.id::text, jsonb_build_object('businesses', cardinality(ws), 'opportunity', opp.id));
  RETURN to_jsonb(i) || jsonb_build_object('created', true);
END $$;
REVOKE ALL ON FUNCTION public.propose_org_initiative(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propose_org_initiative(uuid, uuid, jsonb) TO authenticated;

-- Each business's administrator decides its own commitment. Approval creates the business's project and tasks.
CREATE OR REPLACE FUNCTION public.decide_org_commitment(_id uuid, _approve boolean, _note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.org_initiative_commitments%ROWTYPE; i public.org_initiatives%ROWTYPE; pid uuid; t jsonb; pending int; declined int; st text;
BEGIN
  SELECT * INTO c FROM public.org_initiative_commitments WHERE id = _id;
  IF c.id IS NULL OR auth.uid() IS NULL OR _approve IS NULL OR NOT public.has_workspace_role(c.workspace_id, 'admin') THEN
    RAISE EXCEPTION 'Only an administrator of this business can decide its commitment'; END IF;
  IF length(coalesce(_note,'')) > 1000 THEN RAISE EXCEPTION 'note too long'; END IF;
  SELECT * INTO i FROM public.org_initiatives WHERE id = c.initiative_id FOR UPDATE;
  SELECT * INTO c FROM public.org_initiative_commitments WHERE id = _id FOR UPDATE;
  IF c.status <> 'pending' THEN RAISE EXCEPTION 'This commitment was already decided'; END IF;
  IF i.status <> 'awaiting_commitments' THEN RAISE EXCEPTION 'This initiative no longer accepts decisions'; END IF;
  IF _approve THEN
    INSERT INTO public.projects(org_id, workspace_id, title, description, objective, status, priority, category, created_by)
    VALUES (c.org_id, c.workspace_id, left(i.title, 200), left(c.business_objective || E'\n\nShared organization objective: ' || i.shared_objective, 4000),
      left(c.business_objective, 500), 'planned', 'medium', 'organization_initiative', auth.uid())
    RETURNING id INTO pid;
    FOR t IN SELECT value FROM jsonb_array_elements(c.tasks) LOOP
      INSERT INTO public.tasks(org_id, workspace_id, title, description, project_id, due_date, status, priority, created_by)
      VALUES (c.org_id, c.workspace_id, left(trim(t->>'title'), 200), left('Organization initiative: ' || i.title, 1000), pid, nullif(t->>'due_date','')::date, 'todo', 'medium', auth.uid());
    END LOOP;
    UPDATE public.org_initiative_commitments SET status = 'approved', project_id = pid, decided_by = auth.uid(), decided_at = now(), decision_note = coalesce(_note,'') WHERE id = c.id;
  ELSE
    UPDATE public.org_initiative_commitments SET status = 'declined', decided_by = auth.uid(), decided_at = now(), decision_note = coalesce(_note,'') WHERE id = c.id;
  END IF;
  SELECT count(*) FILTER (WHERE status = 'pending'), count(*) FILTER (WHERE status = 'declined') INTO pending, declined
    FROM public.org_initiative_commitments WHERE initiative_id = i.id;
  st := CASE WHEN declined > 0 THEN 'declined' WHEN pending = 0 THEN 'committed' ELSE 'awaiting_commitments' END;
  UPDATE public.org_initiatives SET status = st, updated_at = now() WHERE id = i.id;
  IF st = 'committed' AND i.opportunity_id IS NOT NULL THEN
    UPDATE public.org_opportunities SET status = 'converted', updated_at = now() WHERE id = i.opportunity_id AND status IN ('hypothesis','validating','validated');
  END IF;
  PERFORM public.log_audit(c.org_id, CASE WHEN _approve THEN 'org.commitment.approved' ELSE 'org.commitment.declined' END, 'org_initiative', i.id::text,
    jsonb_build_object('workspace', c.workspace_id, 'budget', c.budget_amount, 'currency', c.currency, 'tasks', jsonb_array_length(c.tasks), 'project', pid, 'initiative_status', st));
  RETURN jsonb_build_object('status', CASE WHEN _approve THEN 'approved' ELSE 'declined' END, 'project_id', pid, 'initiative_status', st);
END $$;
REVOKE ALL ON FUNCTION public.decide_org_commitment(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_org_commitment(uuid, boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_org_initiative_status(_id uuid, _status text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i public.org_initiatives%ROWTYPE; ok boolean;
BEGIN
  SELECT * INTO i FROM public.org_initiatives WHERE id = _id FOR UPDATE;
  IF i.id IS NULL OR auth.uid() IS NULL OR NOT public.has_org_role(i.org_id, 'editor') OR NOT public.can_open_businesses(i.org_id, i.business_ids, 'member') THEN RAISE EXCEPTION 'forbidden'; END IF;
  ok := (i.status = 'committed' AND _status IN ('active','cancelled')) OR (i.status = 'active' AND _status IN ('completed','cancelled'))
     OR (i.status = 'awaiting_commitments' AND _status = 'cancelled');
  IF NOT ok THEN RAISE EXCEPTION 'This change is not possible from the current status'; END IF;
  UPDATE public.org_initiatives SET status = _status, updated_at = now() WHERE id = _id RETURNING * INTO i;
  PERFORM public.log_audit(i.org_id, 'org.initiative.' || _status, 'org_initiative', i.id::text, '{}'::jsonb);
  RETURN to_jsonb(i);
END $$;
REVOKE ALL ON FUNCTION public.set_org_initiative_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_org_initiative_status(uuid, text) TO authenticated;

-- 4. Resource allocation proposals ------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.org_allocation_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  request_key uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('budget_shift','specialist_capacity')),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  reasoning text NOT NULL CHECK (length(trim(reasoning)) BETWEEN 1 AND 2000),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND length(payload::text) <= 4000),
  business_ids uuid[] NOT NULL CHECK (cardinality(business_ids) BETWEEN 1 AND 2),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','rejected','withdrawn')),
  result jsonb,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text NOT NULL DEFAULT '' CHECK (length(decision_note) <= 1000),
  UNIQUE (org_id, request_key)
);
REVOKE ALL ON public.org_allocation_proposals FROM anon, authenticated;
GRANT SELECT ON public.org_allocation_proposals TO authenticated;
GRANT ALL ON public.org_allocation_proposals TO service_role;
ALTER TABLE public.org_allocation_proposals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "readers open every affected business" ON public.org_allocation_proposals;
CREATE POLICY "readers open every affected business" ON public.org_allocation_proposals FOR SELECT TO authenticated
  USING (public.can_open_businesses(org_id, business_ids, 'viewer'));

CREATE OR REPLACE FUNCTION public.propose_org_allocation(_org uuid, _request uuid, _kind text, _title text, _reasoning text, _payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.org_allocation_proposals%ROWTYPE; l public.budget_lines%ROWTYPE; ws2 uuid; amt numeric; norm jsonb; ws uuid[]; cap int;
BEGIN
  IF auth.uid() IS NULL OR _request IS NULL OR NOT public.has_org_role(_org, 'editor') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO p FROM public.org_allocation_proposals WHERE org_id = _org AND request_key = _request;
  IF FOUND THEN RETURN to_jsonb(p) || jsonb_build_object('created', false); END IF;
  IF jsonb_typeof(_payload) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid proposal'; END IF;
  IF _kind = 'budget_shift' THEN
    SELECT * INTO l FROM public.budget_lines WHERE id = (_payload->>'from_line')::uuid AND org_id = _org;
    ws2 := (_payload->>'to_workspace')::uuid; amt := round((_payload->>'amount')::numeric, 2);
    IF l.id IS NULL OR ws2 IS NULL OR ws2 = l.workspace_id OR public.ws_org(ws2) IS DISTINCT FROM _org THEN RAISE EXCEPTION 'Budget line or receiving business unavailable'; END IF;
    IF amt IS NULL OR amt <= 0 OR amt > l.planned - l.actual THEN RAISE EXCEPTION 'The amount must be positive and at most the unspent part of the line'; END IF;
    ws := ARRAY[l.workspace_id, ws2];
    norm := jsonb_build_object('from_line', l.id, 'from_workspace', l.workspace_id, 'to_workspace', ws2, 'channel', l.channel, 'period_month', l.period_month, 'currency', l.currency, 'amount', amt);
  ELSIF _kind = 'specialist_capacity' THEN
    ws := ARRAY[(_payload->>'workspace')::uuid];
    IF public.ws_org(ws[1]) IS DISTINCT FROM _org OR coalesce(_payload->>'specialist','') !~ '^[a-z_]{2,40}$' OR jsonb_typeof(_payload->'enabled') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'invalid specialist proposal'; END IF;
    cap := nullif(_payload->>'cap','')::int;
    IF cap IS NOT NULL AND cap NOT BETWEEN 1 AND 1000000 THEN RAISE EXCEPTION 'The monthly credit limit must be a positive whole number'; END IF;
    norm := jsonb_build_object('workspace', ws[1], 'specialist', _payload->>'specialist', 'enabled', (_payload->>'enabled')::boolean, 'cap', cap);
  ELSE RAISE EXCEPTION 'invalid proposal kind'; END IF;
  IF NOT public.can_open_businesses(_org, ws, 'member') THEN RAISE EXCEPTION 'You need access to every affected business'; END IF;
  INSERT INTO public.org_allocation_proposals(org_id, request_key, kind, title, reasoning, payload, business_ids, created_by)
  VALUES (_org, _request, _kind, trim(coalesce(_title,'')), trim(coalesce(_reasoning,'')), norm, ws, auth.uid()) RETURNING * INTO p;
  PERFORM public.log_audit(_org, 'org.allocation.proposed', 'org_allocation_proposal', p.id::text, jsonb_build_object('kind', _kind) || norm);
  RETURN to_jsonb(p) || jsonb_build_object('created', true);
END $$;
REVOKE ALL ON FUNCTION public.propose_org_allocation(uuid, uuid, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propose_org_allocation(uuid, uuid, text, text, text, jsonb) TO authenticated;

-- apply / reject need the existing business-level right; withdraw is for the proposer. Nothing changes before 'apply'.
CREATE OR REPLACE FUNCTION public.decide_org_allocation(_id uuid, _decision text, _note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.org_allocation_proposals%ROWTYPE; l public.budget_lines%ROWTYPE; amt numeric; nid uuid; prio int; res jsonb; src text;
BEGIN
  SELECT * INTO p FROM public.org_allocation_proposals WHERE id = _id FOR UPDATE;
  IF p.id IS NULL OR auth.uid() IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p.status <> 'pending' THEN RAISE EXCEPTION 'This proposal was already decided'; END IF;
  IF length(coalesce(_note,'')) > 1000 THEN RAISE EXCEPTION 'note too long'; END IF;
  IF _decision = 'withdraw' THEN
    IF p.created_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Only the person who proposed this can withdraw it'; END IF;
  ELSIF _decision IN ('apply','reject') THEN
    IF p.kind = 'budget_shift' AND NOT (public.has_workspace_role((p.payload->>'from_workspace')::uuid, 'editor') AND public.has_workspace_role((p.payload->>'to_workspace')::uuid, 'editor')) THEN
      RAISE EXCEPTION 'You need budget rights in both businesses'; END IF;
    IF p.kind = 'specialist_capacity' AND NOT public.has_workspace_role((p.payload->>'workspace')::uuid, 'admin') THEN
      RAISE EXCEPTION 'Only business administrators can allocate specialists'; END IF;
  ELSE RAISE EXCEPTION 'invalid decision'; END IF;
  IF _decision = 'apply' AND p.kind = 'budget_shift' THEN
    SELECT * INTO l FROM public.budget_lines WHERE id = (p.payload->>'from_line')::uuid FOR UPDATE;
    amt := (p.payload->>'amount')::numeric;
    IF l.id IS NULL OR l.workspace_id IS DISTINCT FROM (p.payload->>'from_workspace')::uuid OR l.currency IS DISTINCT FROM p.payload->>'currency'
       OR l.period_month IS DISTINCT FROM (p.payload->>'period_month')::date OR amt > l.planned - l.actual THEN
      RAISE EXCEPTION 'The budget line changed since this was proposed; propose again'; END IF;
    SELECT name INTO src FROM public.workspaces WHERE id = l.workspace_id;
    UPDATE public.budget_lines SET planned = planned - amt WHERE id = l.id;
    INSERT INTO public.budget_lines(org_id, workspace_id, channel, period_month, planned, actual, currency, note, created_by)
    VALUES (p.org_id, (p.payload->>'to_workspace')::uuid, l.channel, l.period_month, amt, 0, l.currency, left('Moved from ' || coalesce(src,'another business') || ' by an approved organization proposal', 500), auth.uid())
    RETURNING id INTO nid;
    res := jsonb_build_object('source_line', l.id, 'target_line', nid, 'amount', amt, 'currency', l.currency);
  ELSIF _decision = 'apply' AND p.kind = 'specialist_capacity' THEN
    SELECT priority INTO prio FROM public.specialist_allocations WHERE workspace_id = (p.payload->>'workspace')::uuid AND specialist_key = p.payload->>'specialist';
    res := public.set_specialist_allocation((p.payload->>'workspace')::uuid, p.payload->>'specialist', (p.payload->>'enabled')::boolean, coalesce(prio, 3), nullif(p.payload->>'cap','')::int);
  END IF;
  UPDATE public.org_allocation_proposals SET status = CASE _decision WHEN 'apply' THEN 'applied' WHEN 'reject' THEN 'rejected' ELSE 'withdrawn' END,
    result = res, decided_by = auth.uid(), decided_at = now(), decision_note = coalesce(_note,'') WHERE id = p.id RETURNING * INTO p;
  PERFORM public.log_audit(p.org_id, 'org.allocation.' || p.status, 'org_allocation_proposal', p.id::text, jsonb_build_object('kind', p.kind, 'note', left(coalesce(_note,''),200)) || coalesce(res, '{}'::jsonb));
  RETURN to_jsonb(p);
END $$;
REVOKE ALL ON FUNCTION public.decide_org_allocation(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_org_allocation(uuid, text, text) TO authenticated;

-- 5. Organization Growth Officer: paid request through the existing single-request accounting -------------------------
-- The request is anchored to one of the analysed businesses only because AI receipts are per business; the run's visible
-- summary never contains the answer, and the answer itself stays private to the requester until saved as a strategy.
CREATE OR REPLACE FUNCTION public.begin_org_ai_request_verified(_org uuid, _workspace uuid, _request uuid, _input jsonb, _proof text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.single_ai_requests%ROWTYPE; rid uuid; ws uuid[];
BEGIN
  PERFORM public.verify_ai_accounting(_proof);
  IF auth.uid() IS NULL OR NOT public.has_org_role(_org, 'admin') OR public.ws_org(_workspace) IS DISTINCT FROM _org OR NOT public.has_workspace_role(_workspace, 'member') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _request IS NULL OR _input IS NULL OR jsonb_typeof(_input) <> 'object' OR length(_input::text) > 20000 OR length(coalesce(_input->>'request','')) NOT BETWEEN 1 AND 4000
     OR jsonb_typeof(_input->'businesses') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid request'; END IF;
  SELECT array_agg(DISTINCT x::uuid) INTO ws FROM jsonb_array_elements_text(_input->'businesses') x;
  IF ws IS NULL OR cardinality(ws) <> jsonb_array_length(_input->'businesses') OR cardinality(ws) NOT BETWEEN 2 AND 12 OR NOT (_workspace = ANY (ws))
     OR NOT public.can_open_businesses(_org, ws, 'member') THEN RAISE EXCEPTION 'You need access to every business in this analysis'; END IF;
  PERFORM 1 FROM public.organizations WHERE id = _org FOR UPDATE;
  SELECT * INTO a FROM public.single_ai_requests WHERE org_id = _org AND workspace_id = _workspace AND user_id = auth.uid() AND request_key = _request FOR UPDATE;
  IF a.id IS NOT NULL THEN
    IF a.kind IS DISTINCT FROM 'organization' OR a.input IS DISTINCT FROM _input THEN RAISE EXCEPTION 'request key belongs to different input'; END IF;
    RETURN to_jsonb(a) || jsonb_build_object('claimed', false);
  END IF;
  IF EXISTS (SELECT 1 FROM public.ai_call_receipts r JOIN public.ai_credit_reservations c USING (run_id) WHERE r.org_id = _org AND c.status = 'reserved' AND r.state IN ('dispatching','unknown','delivered')) THEN
    RAISE EXCEPTION 'Recover pending AI work before a new request'; END IF;
  IF EXISTS (SELECT 1 FROM public.single_ai_requests WHERE org_id = _org AND user_id = auth.uid() AND status = 'running') THEN RAISE EXCEPTION 'Another request is running; recover saved work first'; END IF;
  IF (SELECT count(*) FROM public.single_ai_requests WHERE org_id = _org AND created_at > now() - interval '1 minute') >= 6 THEN RAISE EXCEPTION 'Too many requests; wait before starting more work'; END IF;
  INSERT INTO public.agent_runs(org_id, workspace_id, user_id, agent_key, depth) VALUES (_org, _workspace, auth.uid(), 'organization_growth_officer', 0) RETURNING id INTO rid;
  INSERT INTO public.single_ai_requests(org_id, workspace_id, user_id, request_key, kind, input, run_id) VALUES (_org, _workspace, auth.uid(), _request, 'organization', _input, rid) RETURNING * INTO a;
  RETURN to_jsonb(a) || jsonb_build_object('claimed', true);
END $$;
REVOKE ALL ON FUNCTION public.begin_org_ai_request_verified(uuid, uuid, uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.begin_org_ai_request_verified(uuid, uuid, uuid, jsonb, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.finish_org_strategy_verified(_id uuid, _reply text, _strategy jsonb, _proof text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.single_ai_requests%ROWTYPE; oid uuid; r public.ai_call_receipts%ROWTYPE; charged int; ws uuid[]; ows uuid[]; s public.org_strategies%ROWTYPE; v int; o jsonb; n int := 0;
BEGIN
  PERFORM public.verify_ai_accounting(_proof);
  SELECT org_id INTO oid FROM public.single_ai_requests WHERE id = _id;
  PERFORM 1 FROM public.organizations WHERE id = oid FOR UPDATE;
  SELECT * INTO a FROM public.single_ai_requests WHERE id = _id FOR UPDATE;
  IF a.id IS NULL OR a.kind <> 'organization' OR a.user_id IS DISTINCT FROM auth.uid() OR NOT public.has_org_role(a.org_id, 'admin') OR NOT public.has_workspace_role(a.workspace_id, 'member') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT array_agg(x::uuid ORDER BY x::uuid) INTO ws FROM jsonb_array_elements_text(a.input->'businesses') x;
  IF NOT public.can_open_businesses(a.org_id, ws, 'member') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF a.status = 'succeeded' THEN
    SELECT * INTO s FROM public.org_strategies WHERE request_id = a.id;
    RETURN jsonb_build_object('strategy_id', s.id, 'version', s.version, 'credits', coalesce(a.credits, 0), 'opportunities', 0, 'replayed', true);
  END IF;
  IF _reply IS NULL OR length(_reply) NOT BETWEEN 1 AND 100000 THEN RAISE EXCEPTION 'invalid answer'; END IF;
  IF _strategy IS NULL OR jsonb_typeof(_strategy) <> 'object' OR length(_strategy::text) > 60000 OR length(coalesce(_strategy->>'summary','')) NOT BETWEEN 1 AND 4000
     OR length(trim(coalesce(_strategy->>'title',''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid strategy'; END IF;
  SELECT * INTO r FROM public.ai_call_receipts WHERE run_id = a.run_id;
  IF r.run_id IS NULL OR r.state NOT IN ('delivered','settled') THEN RAISE EXCEPTION 'saved paid output required'; END IF;
  charged := public.reconcile_ai_receipt_verified(a.run_id, _proof);
  SELECT coalesce(max(version), 0) + 1 INTO v FROM public.org_strategies WHERE org_id = a.org_id;
  INSERT INTO public.org_strategies(org_id, request_id, version, business_ids, title, summary, horizon_months, body, created_by)
  VALUES (a.org_id, a.id, v, ws, left(trim(_strategy->>'title'), 200), _strategy->>'summary', greatest(1, least(36, coalesce((a.input->>'horizonMonths')::int, 6))), _strategy - 'opportunities', auth.uid())
  RETURNING * INTO s;
  IF jsonb_typeof(_strategy->'opportunities') = 'array' THEN
    FOR o IN SELECT value FROM jsonb_array_elements(_strategy->'opportunities') LIMIT 8 LOOP
      BEGIN
        SELECT array_agg(DISTINCT x::uuid ORDER BY x::uuid) INTO ows FROM jsonb_array_elements_text(o->'business_ids') x;
        IF ows IS NOT NULL AND cardinality(ows) >= 2 AND ows <@ ws AND public.org_valid_evidence(coalesce(o->'evidence','[]')) THEN
          INSERT INTO public.org_opportunities(org_id, strategy_id, origin, kind, title, business_ids, evidence, expected_impact, estimated_cost, dependencies, risks, confidence, next_action, created_by)
          VALUES (a.org_id, s.id, 'ai', o->>'kind', left(trim(o->>'title'), 200), ows, coalesce(o->'evidence','[]'), left(coalesce(o->>'expected_impact',''), 1000),
            left(coalesce(o->>'estimated_cost',''), 500), left(coalesce(o->>'dependencies',''), 1000), left(coalesce(o->>'risks',''), 1000), coalesce(o->>'confidence','low'),
            left(coalesce(o->>'next_action',''), 500), auth.uid());
          n := n + 1;
        END IF;
      EXCEPTION WHEN others THEN NULL; -- an invalid AI opportunity is skipped, never fatal for the paid strategy
      END;
    END LOOP;
  END IF;
  UPDATE public.agent_runs SET status = 'succeeded', summary = 'Organization strategy draft v' || v, finished_at = now() WHERE id = a.run_id;
  UPDATE public.single_ai_requests SET status = 'succeeded', reply = _reply, credits = charged, finished_at = now() WHERE id = a.id;
  PERFORM public.log_audit(a.org_id, 'org.strategy.drafted', 'org_strategy', s.id::text, jsonb_build_object('version', v, 'businesses', cardinality(ws), 'opportunities', n, 'credits', charged));
  RETURN jsonb_build_object('strategy_id', s.id, 'version', v, 'credits', charged, 'opportunities', n, 'replayed', false);
END $$;
REVOKE ALL ON FUNCTION public.finish_org_strategy_verified(uuid, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finish_org_strategy_verified(uuid, text, jsonb, text) TO authenticated;

-- Approving makes it the organization's reference strategy (the previous one is superseded). Business strategies,
-- plans, budgets and autonomy settings are not touched: the organization strategy only informs them.
CREATE OR REPLACE FUNCTION public.decide_org_strategy(_id uuid, _decision text, _note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.org_strategies%ROWTYPE; st text;
BEGIN
  SELECT * INTO s FROM public.org_strategies WHERE id = _id;
  IF s.id IS NULL OR auth.uid() IS NULL OR NOT public.has_org_role(s.org_id, 'admin') OR NOT public.can_open_businesses(s.org_id, s.business_ids, 'member') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF length(coalesce(_note,'')) > 1000 THEN RAISE EXCEPTION 'note too long'; END IF;
  PERFORM 1 FROM public.organizations WHERE id = s.org_id FOR UPDATE;
  SELECT * INTO s FROM public.org_strategies WHERE id = _id FOR UPDATE;
  st := CASE WHEN s.status = 'draft' AND _decision = 'approve' THEN 'approved' WHEN s.status = 'draft' AND _decision = 'reject' THEN 'rejected'
             WHEN s.status = 'approved' AND _decision = 'retire' THEN 'superseded' END;
  IF st IS NULL THEN RAISE EXCEPTION 'This change is not possible from the current status'; END IF;
  IF st = 'approved' THEN
    UPDATE public.org_strategies SET status = 'superseded' WHERE org_id = s.org_id AND status = 'approved';
  END IF;
  UPDATE public.org_strategies SET status = st, decided_by = auth.uid(), decided_at = now(), decision_note = coalesce(_note,'') WHERE id = _id RETURNING * INTO s;
  PERFORM public.log_audit(s.org_id, 'org.strategy.' || st, 'org_strategy', s.id::text, jsonb_build_object('version', s.version, 'note', left(coalesce(_note,''),200)));
  RETURN to_jsonb(s);
END $$;
REVOKE ALL ON FUNCTION public.decide_org_strategy(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_org_strategy(uuid, text, text) TO authenticated;
