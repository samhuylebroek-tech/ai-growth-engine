-- PROPOSED migration 0068 — multi-business organization. Staging only until separately approved; requires 0067.
-- One organization runs several businesses; a business is a workspace (its own profile, goals, strategies, budgets,
-- integrations, members and Growth Officer context, all already isolated per workspace). Brands and business units are
-- the 0066 business_units inside a business. This proposal adds:
--   1. the business editor role's rights: only editors and above confirm business facts/profile and manage budgets;
--   2. each business's reporting currency;
--   3. brand/unit links on goals, campaigns and budget lines (composite keys keep them inside one business);
--   4. organization exchange rates (permanent, dated, sourced) for transparent consolidation — never implicit;
--   5. per-business specialist allocation (on/off, priority, monthly credit cap) enforced in the shared task-run gate.
-- Organization-level reporting reads each business under the caller's own access; nothing crosses businesses in SQL.

-- 1. Editor rights ---------------------------------------------------------------------------------------------------
-- Members may still add unverified suggestions (documents, notes); verified facts and the profile need an editor.
DROP POLICY IF EXISTS "editors write verified facts" ON public.business_facts;
CREATE POLICY "editors write verified facts" ON public.business_facts AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT verified OR public.has_workspace_role(workspace_id, 'editor'));
DROP POLICY IF EXISTS "editors change verified facts" ON public.business_facts;
CREATE POLICY "editors change verified facts" ON public.business_facts AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT verified OR public.has_workspace_role(workspace_id, 'editor'))
  WITH CHECK (NOT verified OR public.has_workspace_role(workspace_id, 'editor'));
DROP POLICY IF EXISTS "editors delete verified facts" ON public.business_facts;
CREATE POLICY "editors delete verified facts" ON public.business_facts AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT verified OR public.has_workspace_role(workspace_id, 'editor'));
DROP POLICY IF EXISTS "editors write profile" ON public.business_profiles;
CREATE POLICY "editors write profile" ON public.business_profiles AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_role(workspace_id, 'editor'));
DROP POLICY IF EXISTS "editors update profile" ON public.business_profiles;
CREATE POLICY "editors update profile" ON public.business_profiles AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.has_workspace_role(workspace_id, 'editor')) WITH CHECK (public.has_workspace_role(workspace_id, 'editor'));
DROP POLICY IF EXISTS "editors write budgets" ON public.budget_lines;
CREATE POLICY "editors write budgets" ON public.budget_lines AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_role(workspace_id, 'editor'));
DROP POLICY IF EXISTS "editors update budgets" ON public.budget_lines;
CREATE POLICY "editors update budgets" ON public.budget_lines AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.has_workspace_role(workspace_id, 'editor')) WITH CHECK (public.has_workspace_role(workspace_id, 'editor'));

CREATE OR REPLACE FUNCTION public.confirm_business_profile(_workspace uuid,_profile jsonb,_facts jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE oid uuid; f jsonb; fid uuid; BEGIN SELECT org_id INTO oid FROM public.workspaces WHERE id=_workspace; IF oid IS NULL OR NOT public.has_workspace_role(_workspace,'editor') THEN RAISE EXCEPTION 'forbidden'; END IF; IF jsonb_typeof(_facts) IS DISTINCT FROM 'array' OR jsonb_array_length(_facts) NOT BETWEEN 1 AND 24 OR jsonb_typeof(_profile) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid profile'; END IF; IF length(coalesce(_profile->>'website',''))>500 OR length(coalesce(_profile->>'description',''))>3000 THEN RAISE EXCEPTION 'profile too long'; END IF; IF coalesce((_profile->>'monthly_budget_eur')::numeric,0)<0 OR coalesce((_profile->>'monthly_budget_eur')::numeric,0)>100000000 THEN RAISE EXCEPTION 'invalid budget'; END IF; FOR f IN SELECT value FROM jsonb_array_elements(_facts) LOOP IF length(coalesce(f->>'key','')) NOT BETWEEN 1 AND 120 OR length(coalesce(f->>'value','')) NOT BETWEEN 1 AND 3000 OR coalesce(f->>'source_type','') NOT IN ('user','website','ai_assumption') OR coalesce((f->>'confidence')::numeric,0) NOT BETWEEN 0 AND 1 THEN RAISE EXCEPTION 'invalid fact'; END IF; END LOOP; FOR f IN SELECT value FROM jsonb_array_elements(_facts) LOOP SELECT id INTO fid FROM public.business_facts WHERE workspace_id=_workspace AND key=f->>'key' AND source_ref IS NOT DISTINCT FROM f->>'source_ref' ORDER BY created_at DESC LIMIT 1; IF fid IS NULL THEN INSERT INTO public.business_facts(org_id,workspace_id,key,value,source_type,source_ref,confidence,verified) VALUES(oid,_workspace,f->>'key',f->>'value',(f->>'source_type')::public.fact_source,f->>'source_ref',(f->>'confidence')::numeric,coalesce((f->>'verified')::boolean,false)); ELSE UPDATE public.business_facts SET value=f->>'value',confidence=(f->>'confidence')::numeric,verified=coalesce((f->>'verified')::boolean,false) WHERE id=fid; END IF; END LOOP; INSERT INTO public.business_profiles(org_id,workspace_id,website,description,industry,business_model,offerings,audiences,markets,competitors,objectives,monthly_budget_eur,onboarding_completed_at) VALUES(oid,_workspace,nullif(_profile->>'website',''),nullif(_profile->>'description',''),nullif(_profile->>'industry',''),nullif(_profile->>'business_model',''),coalesce(_profile->'offerings','[]'),coalesce(_profile->'audiences','[]'),coalesce(_profile->'markets','[]'),coalesce(_profile->'competitors','[]'),coalesce(_profile->'objectives','[]'),(_profile->>'monthly_budget_eur')::numeric,now()) ON CONFLICT(workspace_id) DO UPDATE SET website=excluded.website,description=excluded.description,industry=excluded.industry,business_model=excluded.business_model,offerings=excluded.offerings,audiences=excluded.audiences,markets=excluded.markets,competitors=excluded.competitors,objectives=excluded.objectives,monthly_budget_eur=excluded.monthly_budget_eur,onboarding_completed_at=now(); INSERT INTO public.audit_logs(org_id,actor_id,action,target_type,target_id,metadata) VALUES(oid,auth.uid(),'business_profile.confirmed','workspace',_workspace::text,jsonb_build_object('fact_count',jsonb_array_length(_facts))); END $$;

CREATE OR REPLACE FUNCTION public.create_invitation(_org uuid, _email text, _role public.org_role) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE normalized text := lower(trim(_email)); lim int; seats int; pending int; tok uuid; iid uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_role(_org,'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _role IS NULL OR _role::text NOT IN ('admin','editor','member','viewer') THEN RAISE EXCEPTION 'invalid role'; END IF;
  IF length(normalized) > 254 OR normalized !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN RAISE EXCEPTION 'invalid email'; END IF;
  PERFORM 1 FROM public.organizations WHERE id = _org FOR UPDATE;
  IF EXISTS(SELECT 1 FROM auth.users u JOIN public.organization_members m ON m.user_id=u.id AND m.org_id=_org WHERE lower(u.email)=normalized) THEN RAISE EXCEPTION 'This person is already a member'; END IF;
  IF EXISTS(SELECT 1 FROM public.invitations WHERE org_id=_org AND lower(email)=normalized AND accepted_at IS NULL AND expires_at>now()) THEN RAISE EXCEPTION 'A pending invitation already exists'; END IF;
  SELECT e.limit_value INTO lim FROM public.subscriptions s JOIN public.plan_entitlements e ON e.plan_key=s.plan_key WHERE s.org_id=_org AND s.status IN ('active','trialing') AND e.feature_key='seats';
  IF NOT FOUND THEN RAISE EXCEPTION 'Seat entitlement not configured'; END IF;
  SELECT count(*) INTO seats FROM public.organization_members WHERE org_id=_org;
  SELECT count(*) INTO pending FROM public.invitations WHERE org_id=_org AND accepted_at IS NULL AND expires_at>now();
  IF lim IS NOT NULL AND seats+pending >= lim THEN RAISE EXCEPTION 'Your team seat limit has been reached'; END IF;
  INSERT INTO public.invitations(org_id,email,role,invited_by) VALUES(_org,normalized,_role,auth.uid()) RETURNING token,id INTO tok,iid;
  INSERT INTO public.audit_logs(org_id,actor_id,action,target_type,target_id,metadata) VALUES(_org,auth.uid(),'member.invited','invitation',iid::text,jsonb_build_object('role',_role));
  RETURN tok;
END $$;

-- 2. Reporting currency per business ---------------------------------------------------------------------------------
ALTER TABLE public.business_profiles ADD COLUMN IF NOT EXISTS reporting_currency text NOT NULL DEFAULT 'EUR';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'business_profiles_reporting_currency_check') THEN
    ALTER TABLE public.business_profiles ADD CONSTRAINT business_profiles_reporting_currency_check CHECK (reporting_currency ~ '^[A-Z]{3}$');
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.set_business_currency(_workspace uuid, _currency text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cur text := upper(trim(coalesce(_currency, ''))); oid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.has_workspace_role(_workspace, 'editor') THEN RAISE EXCEPTION 'Only business editors and administrators can change the reporting currency'; END IF;
  IF cur !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'Use a three-letter currency code'; END IF;
  SELECT org_id INTO oid FROM public.workspaces WHERE id = _workspace;
  INSERT INTO public.business_profiles(workspace_id, org_id, reporting_currency) VALUES (_workspace, oid, cur)
  ON CONFLICT (workspace_id) DO UPDATE SET reporting_currency = EXCLUDED.reporting_currency, updated_at = now();
  PERFORM public.log_audit(oid, 'business.currency_changed', 'workspace', _workspace::text, jsonb_build_object('currency', cur));
  RETURN cur;
END $$;
REVOKE ALL ON FUNCTION public.set_business_currency(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_business_currency(uuid, text) TO authenticated;

-- 3. Brand / unit links ----------------------------------------------------------------------------------------------
ALTER TABLE public.growth_goals ADD COLUMN IF NOT EXISTS unit_id uuid;
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS unit_id uuid;
ALTER TABLE public.budget_lines ADD COLUMN IF NOT EXISTS unit_id uuid;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['growth_goals','campaigns','budget_lines'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_unit_scope_fk') THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (unit_id, org_id, workspace_id) REFERENCES public.business_units(id, org_id, workspace_id)', t, t || '_unit_scope_fk');
    END IF;
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I(workspace_id, unit_id) WHERE unit_id IS NOT NULL', t || '_unit_idx', t);
  END LOOP;
END $$;

-- 4. Exchange rates --------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.exchange_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  base_currency text NOT NULL CHECK (base_currency ~ '^[A-Z]{3}$'),
  quote_currency text NOT NULL CHECK (quote_currency ~ '^[A-Z]{3}$'),
  rate numeric(18,8) NOT NULL CHECK (rate > 0 AND rate < 1000000),
  rate_date date NOT NULL,
  source text NOT NULL CHECK (length(trim(source)) BETWEEN 1 AND 120),
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (base_currency <> quote_currency)
);
CREATE INDEX IF NOT EXISTS exchange_rates_lookup ON public.exchange_rates(org_id, base_currency, quote_currency, rate_date DESC, created_at DESC);
REVOKE ALL ON public.exchange_rates FROM anon, authenticated;
GRANT SELECT ON public.exchange_rates TO authenticated;
GRANT ALL ON public.exchange_rates TO service_role;
ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org members read rates" ON public.exchange_rates;
CREATE POLICY "org members read rates" ON public.exchange_rates FOR SELECT TO authenticated USING (public.is_org_member(org_id));
DROP TRIGGER IF EXISTS exchange_rates_permanent ON public.exchange_rates;
CREATE TRIGGER exchange_rates_permanent BEFORE UPDATE OR DELETE ON public.exchange_rates FOR EACH ROW EXECUTE FUNCTION public.guard_permanent_row();

-- A correction is a newer row for the same date; readers take the latest entry on the latest date not after the period end.
CREATE OR REPLACE FUNCTION public.record_exchange_rate(_org uuid, _base text, _quote text, _rate numeric, _date date, _source text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b text := upper(trim(coalesce(_base, ''))); q text := upper(trim(coalesce(_quote, ''))); rid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.has_org_role(_org, 'admin') THEN RAISE EXCEPTION 'Only organization administrators can record exchange rates'; END IF;
  IF b !~ '^[A-Z]{3}$' OR q !~ '^[A-Z]{3}$' OR b = q THEN RAISE EXCEPTION 'Use two different three-letter currency codes'; END IF;
  IF _rate IS NULL OR _rate <= 0 OR _rate >= 1000000 THEN RAISE EXCEPTION 'The rate must be a positive number'; END IF;
  IF _date IS NULL OR _date > current_date THEN RAISE EXCEPTION 'The rate date cannot be in the future'; END IF;
  IF length(trim(coalesce(_source, ''))) = 0 THEN RAISE EXCEPTION 'Name the source of the rate'; END IF;
  INSERT INTO public.exchange_rates(org_id, base_currency, quote_currency, rate, rate_date, source)
  VALUES (_org, b, q, round(_rate, 8), _date, left(trim(_source), 120)) RETURNING id INTO rid;
  PERFORM public.log_audit(_org, 'finance.exchange_rate_recorded', 'exchange_rate', rid::text, jsonb_build_object('base', b, 'quote', q, 'rate', _rate, 'date', _date));
  RETURN rid;
END $$;
REVOKE ALL ON FUNCTION public.record_exchange_rate(uuid, text, text, numeric, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_exchange_rate(uuid, text, text, numeric, date, text) TO authenticated;

-- 5. Specialist allocation per business ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.specialist_allocations (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  specialist_key text NOT NULL CHECK (specialist_key IN ('business_analyst','market_research','growth_strategist','seo','content','copywriter','marketing','advertising','linkedin','sales','crm','cro','partnership','event_marketing','revenue_analyst')),
  enabled boolean NOT NULL DEFAULT true,
  priority int NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  monthly_credit_cap int CHECK (monthly_credit_cap IS NULL OR monthly_credit_cap BETWEEN 1 AND 1000000),
  updated_by uuid NOT NULL DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, specialist_key)
);
REVOKE ALL ON public.specialist_allocations FROM anon, authenticated;
GRANT SELECT ON public.specialist_allocations TO authenticated;
GRANT ALL ON public.specialist_allocations TO service_role;
ALTER TABLE public.specialist_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "business members read allocations" ON public.specialist_allocations;
CREATE POLICY "business members read allocations" ON public.specialist_allocations FOR SELECT TO authenticated USING (public.has_workspace_role(workspace_id, 'viewer'));

CREATE OR REPLACE FUNCTION public.set_specialist_allocation(_workspace uuid, _specialist text, _enabled boolean, _priority int, _cap int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE oid uuid; a public.specialist_allocations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.has_workspace_role(_workspace, 'admin') THEN RAISE EXCEPTION 'Only business administrators can allocate specialists'; END IF;
  IF _priority IS NULL OR _priority NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Priority must be 1 to 5'; END IF;
  IF _cap IS NOT NULL AND _cap NOT BETWEEN 1 AND 1000000 THEN RAISE EXCEPTION 'The monthly credit limit must be a positive whole number'; END IF;
  SELECT org_id INTO oid FROM public.workspaces WHERE id = _workspace;
  INSERT INTO public.specialist_allocations(workspace_id, org_id, specialist_key, enabled, priority, monthly_credit_cap, updated_by, updated_at)
  VALUES (_workspace, oid, _specialist, coalesce(_enabled, true), _priority, _cap, auth.uid(), now())
  ON CONFLICT (workspace_id, specialist_key) DO UPDATE SET enabled = EXCLUDED.enabled, priority = EXCLUDED.priority,
    monthly_credit_cap = EXCLUDED.monthly_credit_cap, updated_by = auth.uid(), updated_at = now()
  RETURNING * INTO a;
  PERFORM public.log_audit(oid, 'specialist.allocation_changed', 'workspace', _workspace::text,
    jsonb_build_object('specialist', a.specialist_key, 'enabled', a.enabled, 'priority', a.priority, 'cap', a.monthly_credit_cap));
  RETURN to_jsonb(a) - 'updated_by';
END $$;
REVOKE ALL ON FUNCTION public.set_specialist_allocation(uuid, text, boolean, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_specialist_allocation(uuid, text, boolean, int, int) TO authenticated;

-- Reserved (estimated) plus charged credits of one specialist in one business since a moment; same rule as task_run_credits_since.
CREATE OR REPLACE FUNCTION public.specialist_credits_since(_workspace uuid, _specialist text, _since timestamptz) RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(sum(coalesce(credits_charged, CASE WHEN status IN ('failed','cancelled','rejected') THEN 0 ELSE estimated_credits END)), 0)::int
  FROM public.task_runs WHERE workspace_id = _workspace AND specialist_key = _specialist AND created_at >= _since
$$;
REVOKE ALL ON FUNCTION public.specialist_credits_since(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.task_run_gate(_task uuid, _estimate int, _autonomous boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.tasks%ROWTYPE; p public.task_execution_profiles%ROWTYPE; s public.execution_settings; tries int; al public.specialist_allocations%ROWTYPE;
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
  -- Per-business specialist allocation (0068): a switched-off specialist never runs; its own monthly cap counts reserved and charged credits.
  SELECT * INTO al FROM public.specialist_allocations WHERE workspace_id = t.workspace_id AND specialist_key = p.specialist_key;
  IF al.workspace_id IS NOT NULL AND NOT al.enabled THEN RETURN 'specialist_disabled'; END IF;
  IF _estimate IS NULL OR _estimate < 1 OR _estimate > s.max_credits_per_run THEN RETURN 'over_run_cap'; END IF;
  IF al.workspace_id IS NOT NULL AND al.monthly_credit_cap IS NOT NULL AND public.specialist_credits_since(t.workspace_id, p.specialist_key, date_trunc('month', now())) + _estimate > al.monthly_credit_cap THEN RETURN 'specialist_cap'; END IF;
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
    WHEN 'specialist_disabled' THEN 'This specialist is switched off for this business'
    WHEN 'specialist_cap' THEN 'This specialist''s monthly credit limit for this business would be exceeded'
    ELSE 'This task cannot run now' END
$$;

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
    -- Business priority for the assigned specialist (0068): 1..5 adds -10..+10.
    + coalesce((SELECT (a.priority - 3) * 5 FROM public.task_execution_profiles ep JOIN public.specialist_allocations a
        ON a.workspace_id = ep.workspace_id AND a.specialist_key = ep.specialist_key WHERE ep.task_id = t.id), 0)
  FROM public.tasks t WHERE t.id = _task
$$;
REVOKE ALL ON FUNCTION public.task_priority_score(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.task_priority_score(uuid) TO authenticated;
