-- PROPOSED migration (not in the journal; not applied to the live database). Staging only via
-- scripts/staging/apply-proposal.ts. Idempotent. Depends on migration 0039 (growth_goals).
--
-- Revenue Opportunity Engine: AI-discovered growth opportunities per workspace.
-- * Content is written once (insert-only); only the decision status changes, through role-checked functions.
-- * Every opportunity keeps its scores, budget range, evidence (fact / estimate / hypothesis) and confidence.
-- * Turning an opportunity into a goal is one atomic step that cannot create duplicate goals.

CREATE TABLE IF NOT EXISTS public.growth_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  request_key uuid NOT NULL,
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 8),
  domain text NOT NULL CHECK (domain IN ('marketing','lead_generation','sales','retention','partnerships','events_offline','monetization','product_growth','other')),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 200),
  summary text NOT NULL CHECK (length(trim(summary)) BETWEEN 1 AND 1500),
  analysis text NOT NULL DEFAULT '' CHECK (length(analysis) <= 3000),
  audience text NOT NULL DEFAULT '' CHECK (length(audience) <= 500),
  expected_impact text NOT NULL DEFAULT '' CHECK (length(expected_impact) <= 800),
  impact smallint NOT NULL CHECK (impact BETWEEN 1 AND 5),
  feasibility smallint NOT NULL CHECK (feasibility BETWEEN 1 AND 5),
  cost smallint NOT NULL CHECK (cost BETWEEN 1 AND 5),
  time_to_value smallint NOT NULL CHECK (time_to_value BETWEEN 1 AND 5),
  risk smallint NOT NULL CHECK (risk BETWEEN 1 AND 5),
  complexity text NOT NULL DEFAULT 'medium' CHECK (complexity IN ('low','medium','high')),
  budget_min numeric CHECK (budget_min IS NULL OR budget_min >= 0),
  budget_max numeric CHECK (budget_max IS NULL OR budget_max >= 0),
  currency text NOT NULL DEFAULT 'EUR' CHECK (currency ~ '^[A-Z]{3}$'),
  horizon_days int NOT NULL CHECK (horizon_days BETWEEN 7 AND 730),
  resources text[] NOT NULL DEFAULT '{}' CHECK (cardinality(resources) <= 8),
  integrations text[] NOT NULL DEFAULT '{}' CHECK (cardinality(integrations) <= 8),
  risks text[] NOT NULL DEFAULT '{}' CHECK (cardinality(risks) <= 8),
  kpis jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(kpis) = 'array' AND length(kpis::text) <= 4000),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence) = 'array' AND length(evidence::text) <= 8000),
  confidence text NOT NULL CHECK (confidence IN ('low','medium','high')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','shortlisted','dismissed','converted')),
  goal_id uuid,
  decided_by uuid,
  decided_at timestamptz,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (budget_min IS NULL OR budget_max IS NULL OR budget_min <= budget_max),
  CHECK ((status = 'converted') = (goal_id IS NOT NULL)),
  UNIQUE (workspace_id, request_key, position),
  UNIQUE (id, org_id, workspace_id),
  FOREIGN KEY (goal_id, org_id, workspace_id) REFERENCES public.growth_goals(id, org_id, workspace_id)
);
REVOKE ALL ON public.growth_opportunities FROM PUBLIC, anon;
REVOKE TRUNCATE, UPDATE, DELETE ON public.growth_opportunities FROM authenticated;
GRANT SELECT, INSERT ON public.growth_opportunities TO authenticated;
GRANT ALL ON public.growth_opportunities TO service_role;
ALTER TABLE public.growth_opportunities ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS growth_opportunities_ws_idx ON public.growth_opportunities (workspace_id, created_at DESC);

DROP POLICY IF EXISTS growth_opportunities_read ON public.growth_opportunities;
CREATE POLICY growth_opportunities_read ON public.growth_opportunities FOR SELECT TO authenticated
  USING (public.has_workspace_role(workspace_id, 'viewer'));
DROP POLICY IF EXISTS growth_opportunities_create ON public.growth_opportunities;
CREATE POLICY growth_opportunities_create ON public.growth_opportunities FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_role(workspace_id, 'member') AND created_by = auth.uid()
    AND status = 'open' AND goal_id IS NULL AND decided_by IS NULL AND decided_at IS NULL);

DROP TRIGGER IF EXISTS growth_opportunities_scope ON public.growth_opportunities;
CREATE TRIGGER growth_opportunities_scope BEFORE INSERT ON public.growth_opportunities
  FOR EACH ROW EXECUTE FUNCTION public.guard_content_scope();

-- Content is immutable once written; only the decision fields may change (and only via the functions below).
CREATE OR REPLACE FUNCTION public.guard_growth_opportunity_content() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status','goal_id','decided_by','decided_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','goal_id','decided_by','decided_at']) THEN
    RAISE EXCEPTION 'opportunity content is immutable';
  END IF;
  IF OLD.status = 'converted' THEN RAISE EXCEPTION 'converted opportunities are final'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS growth_opportunities_immutable ON public.growth_opportunities;
CREATE TRIGGER growth_opportunities_immutable BEFORE UPDATE ON public.growth_opportunities
  FOR EACH ROW EXECUTE FUNCTION public.guard_growth_opportunity_content();
REVOKE ALL ON FUNCTION public.guard_growth_opportunity_content() FROM PUBLIC, anon, authenticated;

-- Shortlist, dismiss or reopen. Workspace members only; converted opportunities stay final.
CREATE OR REPLACE FUNCTION public.set_growth_opportunity_status(_opportunity uuid, _status text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.growth_opportunities;
BEGIN
  IF _status NOT IN ('open','shortlisted','dismissed') THEN RAISE EXCEPTION 'invalid status'; END IF;
  SELECT * INTO o FROM public.growth_opportunities WHERE id = _opportunity FOR UPDATE;
  IF NOT FOUND OR NOT public.has_workspace_role(o.workspace_id, 'member') THEN RAISE EXCEPTION 'opportunity not found'; END IF;
  IF o.status = 'converted' THEN RAISE EXCEPTION 'converted opportunities are final'; END IF;
  UPDATE public.growth_opportunities SET status = _status,
    decided_by = CASE WHEN _status = 'open' THEN NULL ELSE auth.uid() END,
    decided_at = CASE WHEN _status = 'open' THEN NULL ELSE now() END
  WHERE id = o.id;
  RETURN _status;
END $$;
REVOKE ALL ON FUNCTION public.set_growth_opportunity_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_growth_opportunity_status(uuid, text) TO authenticated;

-- Turns one opportunity into an active goal in the same workspace. Repeating it returns the same goal.
CREATE OR REPLACE FUNCTION public.convert_growth_opportunity(_opportunity uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.growth_opportunities; g uuid; obj text; metric text;
BEGIN
  SELECT * INTO o FROM public.growth_opportunities WHERE id = _opportunity FOR UPDATE;
  IF NOT FOUND OR NOT public.has_workspace_role(o.workspace_id, 'member') THEN RAISE EXCEPTION 'opportunity not found'; END IF;
  IF o.status = 'converted' THEN RETURN jsonb_build_object('goal_id', o.goal_id, 'created', false); END IF;
  IF o.status = 'dismissed' THEN RAISE EXCEPTION 'reopen the opportunity first'; END IF;
  obj := CASE o.domain WHEN 'marketing' THEN 'leads' WHEN 'lead_generation' THEN 'leads' WHEN 'sales' THEN 'revenue'
    WHEN 'retention' THEN 'retention' WHEN 'partnerships' THEN 'revenue' WHEN 'events_offline' THEN 'customers'
    WHEN 'monetization' THEN 'revenue' WHEN 'product_growth' THEN 'launch' ELSE 'other' END;
  metric := left(coalesce(o.kpis->0->>'metric', ''), 120);
  INSERT INTO public.growth_goals (org_id, workspace_id, title, objective, metric, due_date, rationale, created_by)
  VALUES (o.org_id, o.workspace_id, left(o.title, 200), obj, metric, (current_date + o.horizon_days),
    left('From growth opportunity: ' || o.summary, 2000), auth.uid())
  RETURNING id INTO g;
  UPDATE public.growth_opportunities SET status = 'converted', goal_id = g, decided_by = auth.uid(), decided_at = now() WHERE id = o.id;
  RETURN jsonb_build_object('goal_id', g, 'created', true);
END $$;
REVOKE ALL ON FUNCTION public.convert_growth_opportunity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_growth_opportunity(uuid) TO authenticated;
