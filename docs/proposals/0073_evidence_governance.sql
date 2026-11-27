-- PROPOSED migration 0073 (staging only until approved): evidence governance.
-- Before: evidence lived as free JSON inside opportunities, organization opportunities and improvement proposals, each
-- with its own vocabulary, and an administrator could approve an improvement proposal without any evidence, so an
-- AI explanation could read as proof of its own recommendation.
-- Now:
-- * evidence_items: one workspace-scoped record per piece of evidence with one of six types (verified fact, measured
--   observation, estimate, assumption, hypothesis, missing information), source, source reference, goal/strategy,
--   collection date, reporting period, lifecycle status and a reliability set by the database from the type and
--   source (never chosen by the caller or the AI). Verified facts and measured observations must point at a real
--   record of the same business that qualifies (a verified business fact, an imported/verified measurement, an
--   imported sale, a sourced competitor fact, ...); AI-originated items can only be estimates, assumptions,
--   hypotheses or missing information.
-- * Lifecycle discovered -> classified -> reviewed -> accepted/rejected -> used_in_decision -> reevaluated. Content is
--   immutable once classified; a change is a new version that supersedes the old one, which keeps its history.
--   evidence_events is the append-only history of every transition.
-- * proposal_evidence links evidence to improvement proposals (supports / contradicts). Proposals get a level:
--   observation (no evidence needed, can never become work), formal (needs one independent accepted supporting item
--   or an explicit reason why evidence is unavailable, plus a review step) and execution (every decision field plus
--   at least one accepted record-backed fact or measurement). Approval states the exact evidence the approver saw;
--   if the linked set changed meanwhile the approval is refused. AI-originated evidence never counts as independent.
-- Idempotent: IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS only.
-- Rollback (if never approved for live): drop the three new tables, the new functions and the added proposal columns;
-- restore create_optimization_proposal / advance_optimization_proposal from 0066. No existing rows are changed.

CREATE TABLE IF NOT EXISTS public.evidence_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  request_key uuid NOT NULL,
  evidence_type text CHECK (evidence_type IS NULL OR evidence_type IN
    ('verified_fact','measured_observation','estimate','assumption','hypothesis','missing_information')),
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 1000),
  source_kind text NOT NULL,
  source_ref text NOT NULL DEFAULT '' CHECK (length(source_ref) <= 500),
  origin text NOT NULL CHECK (origin IN ('user','rule','ai')),
  goal_id uuid,
  strategy_id uuid REFERENCES public.growth_strategies(id),
  collected_at timestamptz NOT NULL DEFAULT now(),
  period_start date,
  period_end date,
  status text NOT NULL CHECK (status IN ('discovered','classified','reviewed','accepted','rejected','used_in_decision','reevaluated')),
  reliability text CHECK (reliability IS NULL OR reliability IN ('high','medium','low','none')),
  version_no int NOT NULL DEFAULT 1 CHECK (version_no BETWEEN 1 AND 1000),
  supersedes_id uuid REFERENCES public.evidence_items(id),
  superseded_by uuid UNIQUE REFERENCES public.evidence_items(id),
  reviewed_by uuid, reviewed_at timestamptz,
  review_note text NOT NULL DEFAULT '' CHECK (length(review_note) <= 500),
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, request_key),
  UNIQUE (id, org_id, workspace_id),
  CHECK ((evidence_type IS NULL) = (status = 'discovered')),
  CHECK ((evidence_type IS NULL) = (reliability IS NULL)),
  CHECK (period_start IS NULL OR period_end IS NULL OR (period_end >= period_start AND period_end - period_start <= 366)),
  -- an AI can never produce facts or measurements; those need a qualifying record (checked by record_evidence)
  CHECK (origin <> 'ai' OR evidence_type IS NULL OR evidence_type NOT IN ('verified_fact','measured_observation')),
  CHECK (evidence_type IS DISTINCT FROM 'verified_fact' OR source_kind IN ('business_fact','measurement','revenue_event','competitor_observation')),
  FOREIGN KEY (goal_id, org_id, workspace_id) REFERENCES public.growth_goals(id, org_id, workspace_id)
);
-- Named source checks (replaced idempotently so the list can grow without touching rows).
ALTER TABLE public.evidence_items DROP CONSTRAINT IF EXISTS evidence_items_source_kind_check;
ALTER TABLE public.evidence_items ADD CONSTRAINT evidence_items_source_kind_check CHECK (source_kind IN ('business_fact','measurement','revenue_event',
  'crm_deal','experiment','seo_audit','competitor_observation','budget_line','document','user_statement','website','ai_analysis','other'));
DO $$ DECLARE c text; BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'public.evidence_items'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%measured_observation%' AND pg_get_constraintdef(oid) LIKE '%period_start IS NOT NULL%' AND conname <> 'evidence_items_measured_source'
  LOOP EXECUTE format('ALTER TABLE public.evidence_items DROP CONSTRAINT %I', c); END LOOP;
END $$;
ALTER TABLE public.evidence_items DROP CONSTRAINT IF EXISTS evidence_items_measured_source;
ALTER TABLE public.evidence_items ADD CONSTRAINT evidence_items_measured_source CHECK (evidence_type IS DISTINCT FROM 'measured_observation'
  OR (period_start IS NOT NULL AND period_end IS NOT NULL
      AND source_kind IN ('measurement','revenue_event','crm_deal','experiment','seo_audit','competitor_observation','budget_line')));
CREATE INDEX IF NOT EXISTS evidence_items_ws_idx ON public.evidence_items(workspace_id, created_at DESC);
REVOKE ALL ON public.evidence_items FROM anon, authenticated;
GRANT SELECT ON public.evidence_items TO authenticated;
GRANT ALL ON public.evidence_items TO service_role;
ALTER TABLE public.evidence_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS evidence_items_read ON public.evidence_items;
CREATE POLICY evidence_items_read ON public.evidence_items FOR SELECT TO authenticated USING (public.has_workspace_role(workspace_id, 'viewer'));

CREATE TABLE IF NOT EXISTS public.evidence_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  evidence_id uuid NOT NULL,
  action text NOT NULL CHECK (action ~ '^[a-z_]{3,40}$'),
  from_status text,
  to_status text,
  proposal_id uuid,
  actor_id uuid,
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  snapshot jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(snapshot) = 'object' AND length(snapshot::text) <= 6000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (evidence_id, org_id, workspace_id) REFERENCES public.evidence_items(id, org_id, workspace_id)
);
CREATE INDEX IF NOT EXISTS evidence_events_item_idx ON public.evidence_events(evidence_id, id);
REVOKE ALL ON public.evidence_events FROM anon, authenticated;
GRANT SELECT ON public.evidence_events TO authenticated;
GRANT ALL ON public.evidence_events TO service_role;
ALTER TABLE public.evidence_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS evidence_events_read ON public.evidence_events;
CREATE POLICY evidence_events_read ON public.evidence_events FOR SELECT TO authenticated USING (public.has_workspace_role(workspace_id, 'viewer'));

CREATE TABLE IF NOT EXISTS public.proposal_evidence (
  proposal_id uuid NOT NULL REFERENCES public.optimization_proposals(id),
  evidence_id uuid NOT NULL,
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'supports' CHECK (role IN ('supports','contradicts')),
  linked_by uuid NOT NULL DEFAULT auth.uid(),
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (proposal_id, evidence_id),
  FOREIGN KEY (evidence_id, org_id, workspace_id) REFERENCES public.evidence_items(id, org_id, workspace_id)
);
REVOKE ALL ON public.proposal_evidence FROM anon, authenticated;
GRANT SELECT ON public.proposal_evidence TO authenticated;
GRANT ALL ON public.proposal_evidence TO service_role;
ALTER TABLE public.proposal_evidence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS proposal_evidence_read ON public.proposal_evidence;
CREATE POLICY proposal_evidence_read ON public.proposal_evidence FOR SELECT TO authenticated USING (public.has_workspace_role(workspace_id, 'viewer'));

ALTER TABLE public.optimization_proposals ADD COLUMN IF NOT EXISTS level text NOT NULL DEFAULT 'formal';
ALTER TABLE public.optimization_proposals ADD COLUMN IF NOT EXISTS objective text NOT NULL DEFAULT '';
ALTER TABLE public.optimization_proposals ADD COLUMN IF NOT EXISTS risk text NOT NULL DEFAULT '';
ALTER TABLE public.optimization_proposals ADD COLUMN IF NOT EXISTS measurement_method text NOT NULL DEFAULT '';
ALTER TABLE public.optimization_proposals ADD COLUMN IF NOT EXISTS approval_requirement text NOT NULL DEFAULT '';
ALTER TABLE public.optimization_proposals ADD COLUMN IF NOT EXISTS business_context text NOT NULL DEFAULT '';
ALTER TABLE public.optimization_proposals ADD COLUMN IF NOT EXISTS evidence_gap_reason text NOT NULL DEFAULT '';
ALTER TABLE public.optimization_proposals ADD COLUMN IF NOT EXISTS reviewed_by uuid;
ALTER TABLE public.optimization_proposals ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE public.optimization_proposals ADD COLUMN IF NOT EXISTS review_note text NOT NULL DEFAULT '';
ALTER TABLE public.optimization_proposals DROP CONSTRAINT IF EXISTS optimization_proposals_level_check;
ALTER TABLE public.optimization_proposals ADD CONSTRAINT optimization_proposals_level_check CHECK (level IN ('observation','formal','execution'));
ALTER TABLE public.optimization_proposals DROP CONSTRAINT IF EXISTS optimization_proposals_governance_len;
ALTER TABLE public.optimization_proposals ADD CONSTRAINT optimization_proposals_governance_len CHECK (length(objective) <= 500 AND length(risk) <= 600
  AND length(measurement_method) <= 400 AND length(approval_requirement) <= 300 AND length(business_context) <= 600
  AND length(evidence_gap_reason) <= 500 AND length(review_note) <= 500);
ALTER TABLE public.optimization_proposals DROP CONSTRAINT IF EXISTS optimization_proposals_observation_no_work;
ALTER TABLE public.optimization_proposals ADD CONSTRAINT optimization_proposals_observation_no_work CHECK (level <> 'observation' OR status IN ('proposed','rejected','withdrawn'));

-- Content is immutable after classification; scope never changes; nothing is deleted; status moves only forward.
CREATE OR REPLACE FUNCTION public.guard_evidence_item() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Evidence is never deleted; reject or revise it' USING ERRCODE = '42501'; END IF;
  IF NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.request_key IS DISTINCT FROM OLD.request_key
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.description IS DISTINCT FROM OLD.description OR NEW.source_kind IS DISTINCT FROM OLD.source_kind OR NEW.source_ref IS DISTINCT FROM OLD.source_ref
     OR NEW.origin IS DISTINCT FROM OLD.origin OR NEW.goal_id IS DISTINCT FROM OLD.goal_id OR NEW.strategy_id IS DISTINCT FROM OLD.strategy_id
     OR NEW.collected_at IS DISTINCT FROM OLD.collected_at OR NEW.period_start IS DISTINCT FROM OLD.period_start OR NEW.period_end IS DISTINCT FROM OLD.period_end
     OR NEW.version_no IS DISTINCT FROM OLD.version_no OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id
     OR (OLD.status <> 'discovered' AND (NEW.evidence_type IS DISTINCT FROM OLD.evidence_type OR NEW.reliability IS DISTINCT FROM OLD.reliability))
     OR (OLD.superseded_by IS NOT NULL AND NEW.superseded_by IS DISTINCT FROM OLD.superseded_by) THEN
    RAISE EXCEPTION 'Evidence content cannot be rewritten; create a new version' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'discovered' AND NEW.status = 'classified')
    OR (OLD.status = 'classified' AND NEW.status IN ('reviewed','accepted','rejected','reevaluated'))
    OR (OLD.status = 'reviewed' AND NEW.status IN ('accepted','rejected','reevaluated'))
    OR (OLD.status = 'accepted' AND NEW.status IN ('used_in_decision','reevaluated'))
    OR (OLD.status = 'used_in_decision' AND NEW.status = 'reevaluated')
    OR (OLD.status = 'rejected' AND NEW.status = 'reevaluated')) THEN
    RAISE EXCEPTION 'Evidence cannot move from % to %', OLD.status, NEW.status USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_evidence_item() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS evidence_items_guard ON public.evidence_items;
CREATE TRIGGER evidence_items_guard BEFORE UPDATE OR DELETE ON public.evidence_items FOR EACH ROW EXECUTE FUNCTION public.guard_evidence_item();

CREATE OR REPLACE FUNCTION public.guard_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'This history is append-only' USING ERRCODE = '42501'; END $$;
REVOKE ALL ON FUNCTION public.guard_append_only() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS evidence_events_append_only ON public.evidence_events;
CREATE TRIGGER evidence_events_append_only BEFORE UPDATE OR DELETE ON public.evidence_events FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();
DROP TRIGGER IF EXISTS proposal_evidence_append_only ON public.proposal_evidence;
CREATE TRIGGER proposal_evidence_append_only BEFORE UPDATE OR DELETE ON public.proposal_evidence FOR EACH ROW EXECUTE FUNCTION public.guard_append_only();

-- Checks the source record for a typed item and returns the reliability the database assigns. Internal only.
CREATE OR REPLACE FUNCTION public.evidence_reliability(_ws uuid, _type text, _kind text, _ref text, _origin text)
RETURNS text LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE rid uuid; k text; ok boolean := false;
BEGIN
  IF _type IS NULL THEN RETURN NULL; END IF;
  IF _type IN ('verified_fact','measured_observation') THEN
    IF _origin = 'ai' THEN RAISE EXCEPTION 'AI output cannot be a fact or a measurement' USING ERRCODE = '23514'; END IF;
    BEGIN rid := _ref::uuid; EXCEPTION WHEN others THEN RAISE EXCEPTION 'This evidence type needs a record of this business' USING ERRCODE = '23514'; END;
    IF _kind = 'business_fact' THEN
      -- only a fact the business confirmed is a verified fact; an unconfirmed fact stays an assumption
      SELECT CASE WHEN verified THEN 'verified' ELSE 'unverified' END INTO k FROM public.business_facts WHERE id = rid AND workspace_id = _ws;
      ok := _type = 'verified_fact' AND k = 'verified';
    ELSIF _kind = 'measurement' THEN
      SELECT kind INTO k FROM public.performance_measurements WHERE id = rid AND workspace_id = _ws;
      ok := (_type = 'verified_fact' AND k IN ('verified_actual','imported_actual')) OR (_type = 'measured_observation' AND k IN ('verified_actual','imported_actual','manual_actual'));
    ELSIF _kind = 'revenue_event' THEN
      SELECT data_class INTO k FROM public.revenue_events WHERE id = rid AND workspace_id = _ws;
      ok := (_type = 'verified_fact' AND k = 'imported') OR (_type = 'measured_observation' AND k IN ('imported','manual'));
    ELSIF _kind = 'competitor_observation' THEN
      SELECT kind INTO k FROM public.competitor_observations WHERE id = rid AND workspace_id = _ws;
      ok := (_type = 'verified_fact' AND k = 'verified_fact') OR (_type = 'measured_observation' AND k IS NOT NULL);
    ELSIF _kind = 'crm_deal' AND _type = 'measured_observation' THEN
      ok := EXISTS (SELECT 1 FROM public.crm_deals WHERE id = rid AND workspace_id = _ws);
    ELSIF _kind = 'experiment' AND _type = 'measured_observation' THEN
      ok := EXISTS (SELECT 1 FROM public.growth_experiments WHERE id = rid AND workspace_id = _ws AND status = 'completed');
    ELSIF _kind = 'budget_line' AND _type = 'measured_observation' THEN
      ok := EXISTS (SELECT 1 FROM public.budget_lines WHERE id = rid AND workspace_id = _ws);
    ELSIF _kind = 'seo_audit' AND _type = 'measured_observation' THEN
      ok := EXISTS (SELECT 1 FROM public.seo_audits WHERE id = rid AND workspace_id = _ws);
    END IF;
    IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'The referenced record does not qualify for this evidence type' USING ERRCODE = '23514'; END IF;
    IF _type = 'verified_fact' THEN RETURN 'high'; END IF;
    RETURN CASE WHEN k IN ('verified_actual','imported_actual','imported') THEN 'high' ELSE 'medium' END;
  END IF;
  RETURN CASE WHEN _type = 'missing_information' THEN 'none' ELSE 'low' END;
END $$;
REVOKE ALL ON FUNCTION public.evidence_reliability(uuid,text,text,text,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.evidence_snapshot(e public.evidence_items) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT jsonb_build_object('type', e.evidence_type, 'description', e.description, 'source_kind', e.source_kind, 'source_ref', e.source_ref,
    'origin', e.origin, 'period_start', e.period_start, 'period_end', e.period_end, 'reliability', e.reliability, 'version', e.version_no)
$$;
REVOKE ALL ON FUNCTION public.evidence_snapshot(public.evidence_items) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.evidence_insert(_ws uuid, _request uuid, _p jsonb, _version int, _supersedes uuid)
RETURNS public.evidence_items LANGUAGE plpgsql SET search_path = public AS $$
DECLARE w public.workspaces%ROWTYPE; e public.evidence_items%ROWTYPE; typ text := nullif(_p->>'type','');
  kind text := coalesce(nullif(_p->>'source_kind',''), 'other'); ref text := left(trim(coalesce(_p->>'source_ref','')), 500);
  org text := coalesce(nullif(_p->>'origin',''), 'user'); g uuid := nullif(_p->>'goal_id','')::uuid; s uuid := nullif(_p->>'strategy_id','')::uuid;
BEGIN
  SELECT * INTO w FROM public.workspaces WHERE id = _ws;
  IF jsonb_typeof(_p) IS DISTINCT FROM 'object' OR (_p - ARRAY['type','description','source_kind','source_ref','origin','goal_id','strategy_id','period_start','period_end','collected_at']) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'Invalid evidence' USING ERRCODE = '22023';
  END IF;
  IF s IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.growth_strategies WHERE id = s AND workspace_id = _ws) THEN
    RAISE EXCEPTION 'Strategy belongs to another business' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.evidence_items(org_id, workspace_id, request_key, evidence_type, description, source_kind, source_ref, origin, goal_id, strategy_id,
    collected_at, period_start, period_end, status, reliability, version_no, supersedes_id, created_by)
  VALUES (w.org_id, w.id, _request, typ, trim(coalesce(_p->>'description','')), kind, ref, org, g, s,
    coalesce(nullif(_p->>'collected_at','')::timestamptz, now()), nullif(_p->>'period_start','')::date, nullif(_p->>'period_end','')::date,
    CASE WHEN typ IS NULL THEN 'discovered' ELSE 'classified' END, public.evidence_reliability(w.id, typ, kind, ref, org), _version, _supersedes, auth.uid())
  RETURNING * INTO e;
  INSERT INTO public.evidence_events(org_id, workspace_id, evidence_id, action, from_status, to_status, actor_id, snapshot)
  VALUES (e.org_id, e.workspace_id, e.id, CASE WHEN _supersedes IS NULL THEN 'discovered' ELSE 'new_version' END, NULL, e.status, auth.uid(), public.evidence_snapshot(e));
  RETURN e;
END $$;
REVOKE ALL ON FUNCTION public.evidence_insert(uuid,uuid,jsonb,int,uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_evidence(_workspace uuid, _request uuid, _p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.evidence_items%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = _workspace) OR NOT public.has_workspace_role(_workspace, 'member') THEN
    RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO e FROM public.evidence_items WHERE workspace_id = _workspace AND request_key = _request;
  IF FOUND THEN RETURN jsonb_build_object('evidence_id', e.id, 'status', 'existing'); END IF;
  e := public.evidence_insert(_workspace, _request, _p, 1, NULL);
  RETURN jsonb_build_object('evidence_id', e.id, 'status', e.status, 'reliability', e.reliability);
END $$;
REVOKE ALL ON FUNCTION public.record_evidence(uuid,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_evidence(uuid,uuid,jsonb) TO authenticated;

-- classify (member, discovered only) · review (member) · accept / reject (business editor or higher).
CREATE OR REPLACE FUNCTION public.advance_evidence(_evidence uuid, _action text, _data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.evidence_items%ROWTYPE; prev text; typ text; note text := left(coalesce(_data->>'note',''), 500);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO e FROM public.evidence_items WHERE id = _evidence FOR UPDATE;
  IF NOT FOUND OR NOT public.has_workspace_role(e.workspace_id, 'member') THEN RAISE EXCEPTION 'Evidence unavailable' USING ERRCODE = '42501'; END IF;
  prev := e.status;
  IF _action = 'classify' THEN
    IF e.status <> 'discovered' THEN RAISE EXCEPTION 'Only discovered evidence can be classified' USING ERRCODE = '22023'; END IF;
    typ := nullif(_data->>'type','');
    IF typ IS NULL THEN RAISE EXCEPTION 'Choose an evidence type' USING ERRCODE = '22023'; END IF;
    UPDATE public.evidence_items SET evidence_type = typ, reliability = public.evidence_reliability(e.workspace_id, typ, e.source_kind, e.source_ref, e.origin),
      status = 'classified', updated_at = now() WHERE id = e.id RETURNING * INTO e;
  ELSIF _action = 'review' THEN
    IF e.status <> 'classified' THEN RAISE EXCEPTION 'Only classified evidence can be marked reviewed' USING ERRCODE = '22023'; END IF;
    UPDATE public.evidence_items SET status = 'reviewed', reviewed_by = auth.uid(), reviewed_at = now(), review_note = note, updated_at = now() WHERE id = e.id RETURNING * INTO e;
  ELSIF _action IN ('accept','reject') THEN
    IF NOT public.has_workspace_role(e.workspace_id, 'editor') THEN RAISE EXCEPTION 'Only a business editor or administrator can accept or reject evidence' USING ERRCODE = '42501'; END IF;
    IF e.status NOT IN ('classified','reviewed') THEN RAISE EXCEPTION 'This evidence has already been decided' USING ERRCODE = '22023'; END IF;
    UPDATE public.evidence_items SET status = CASE WHEN _action = 'accept' THEN 'accepted' ELSE 'rejected' END, reviewed_by = auth.uid(), reviewed_at = now(),
      review_note = note, updated_at = now() WHERE id = e.id RETURNING * INTO e;
  ELSE RAISE EXCEPTION 'Unknown evidence action' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.evidence_events(org_id, workspace_id, evidence_id, action, from_status, to_status, actor_id, note, snapshot)
  VALUES (e.org_id, e.workspace_id, e.id, CASE _action WHEN 'classify' THEN 'classified' WHEN 'review' THEN 'reviewed' WHEN 'accept' THEN 'accepted' ELSE 'rejected' END,
    prev, e.status, auth.uid(), note, public.evidence_snapshot(e));
  RETURN jsonb_build_object('evidence_id', e.id, 'status', e.status, 'reliability', e.reliability);
END $$;
REVOKE ALL ON FUNCTION public.advance_evidence(uuid,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advance_evidence(uuid,text,jsonb) TO authenticated;

-- A change is a new version; the old one is marked reevaluated and keeps its links and history.
CREATE OR REPLACE FUNCTION public.revise_evidence(_evidence uuid, _request uuid, _p jsonb, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.evidence_items%ROWTYPE; n public.evidence_items%ROWTYPE; prev text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO e FROM public.evidence_items WHERE id = _evidence FOR UPDATE;
  IF NOT FOUND OR NOT public.has_workspace_role(e.workspace_id, 'member') THEN RAISE EXCEPTION 'Evidence unavailable' USING ERRCODE = '42501'; END IF;
  SELECT * INTO n FROM public.evidence_items WHERE workspace_id = e.workspace_id AND request_key = _request;
  IF FOUND THEN
    IF n.supersedes_id IS DISTINCT FROM e.id THEN RAISE EXCEPTION 'Request key already used' USING ERRCODE = '23505'; END IF;
    RETURN jsonb_build_object('evidence_id', n.id, 'status', 'existing');
  END IF;
  IF e.status IN ('discovered','reevaluated') THEN RAISE EXCEPTION 'Only current classified evidence can be revised' USING ERRCODE = '22023'; END IF;
  IF length(trim(coalesce(_reason,''))) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Explain why a new version is needed' USING ERRCODE = '22023'; END IF;
  n := public.evidence_insert(e.workspace_id, _request, _p || jsonb_build_object('goal_id', coalesce(_p->>'goal_id', e.goal_id::text), 'strategy_id', coalesce(_p->>'strategy_id', e.strategy_id::text)), e.version_no + 1, e.id);
  prev := e.status;
  UPDATE public.evidence_items SET status = 'reevaluated', superseded_by = n.id, updated_at = now() WHERE id = e.id RETURNING * INTO e;
  INSERT INTO public.evidence_events(org_id, workspace_id, evidence_id, action, from_status, to_status, actor_id, note, snapshot)
  VALUES (e.org_id, e.workspace_id, e.id, 'reevaluated', prev, 'reevaluated', auth.uid(), left(trim(_reason), 500), jsonb_build_object('new_version', n.id));
  RETURN jsonb_build_object('evidence_id', n.id, 'status', n.status, 'version', n.version_no);
END $$;
REVOKE ALL ON FUNCTION public.revise_evidence(uuid,uuid,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revise_evidence(uuid,uuid,jsonb,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.proposal_link_evidence_internal(x public.optimization_proposals, _evidence uuid, _role text)
RETURNS boolean LANGUAGE plpgsql SET search_path = public AS $$
DECLARE e public.evidence_items%ROWTYPE; n int;
BEGIN
  SELECT * INTO e FROM public.evidence_items WHERE id = _evidence;
  IF NOT FOUND OR e.workspace_id <> x.workspace_id THEN RAISE EXCEPTION 'Evidence belongs to another business' USING ERRCODE = '42501'; END IF;
  IF e.status IN ('discovered','reevaluated') THEN RAISE EXCEPTION 'Link the current, classified version of this evidence' USING ERRCODE = '22023'; END IF;
  IF coalesce(_role,'supports') NOT IN ('supports','contradicts') THEN RAISE EXCEPTION 'Invalid evidence role' USING ERRCODE = '22023'; END IF;
  SELECT count(*) INTO n FROM public.proposal_evidence WHERE proposal_id = x.id;
  IF n >= 20 THEN RAISE EXCEPTION 'Too much evidence on one proposal' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.proposal_evidence(proposal_id, evidence_id, org_id, workspace_id, role, linked_by)
  VALUES (x.id, e.id, e.org_id, e.workspace_id, coalesce(_role,'supports'), auth.uid()) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.evidence_events(org_id, workspace_id, evidence_id, action, from_status, to_status, proposal_id, actor_id)
  VALUES (e.org_id, e.workspace_id, e.id, 'linked_' || coalesce(_role,'supports'), e.status, e.status, x.id, auth.uid());
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.proposal_link_evidence_internal(public.optimization_proposals,uuid,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.link_proposal_evidence(_proposal uuid, _evidence uuid, _role text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE x public.optimization_proposals%ROWTYPE; added boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO x FROM public.optimization_proposals WHERE id = _proposal FOR UPDATE;
  IF NOT FOUND OR NOT public.has_workspace_role(x.workspace_id, 'member') THEN RAISE EXCEPTION 'Proposal unavailable' USING ERRCODE = '42501'; END IF;
  IF x.status <> 'proposed' THEN RAISE EXCEPTION 'Evidence can only be added before the decision' USING ERRCODE = '22023'; END IF;
  added := public.proposal_link_evidence_internal(x, _evidence, _role);
  -- new evidence means the earlier review no longer covers what will be decided
  IF added THEN UPDATE public.optimization_proposals SET reviewed_by = NULL, reviewed_at = NULL, review_note = '', updated_at = now() WHERE id = x.id; END IF;
  RETURN jsonb_build_object('proposal_id', x.id, 'linked', added);
END $$;
REVOKE ALL ON FUNCTION public.link_proposal_evidence(uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_proposal_evidence(uuid,uuid,text) TO authenticated;

-- Counts what a decision may rely on. Independent = accepted, supporting, not AI-originated, record- or source-backed.
CREATE OR REPLACE FUNCTION public.proposal_evidence_counts(_proposal uuid)
RETURNS TABLE(independent int, record_backed int, contradicting int, open_items int, linked uuid[])
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT
    count(*) FILTER (WHERE pe.role = 'supports' AND e.status IN ('accepted','used_in_decision') AND e.origin <> 'ai'
      AND (e.evidence_type IN ('verified_fact','measured_observation') OR (e.evidence_type = 'estimate' AND e.source_ref <> '')))::int,
    count(*) FILTER (WHERE pe.role = 'supports' AND e.status IN ('accepted','used_in_decision') AND e.evidence_type IN ('verified_fact','measured_observation'))::int,
    count(*) FILTER (WHERE pe.role = 'contradicts' AND e.status IN ('accepted','used_in_decision'))::int,
    count(*) FILTER (WHERE e.status IN ('classified','reviewed'))::int,
    coalesce(array_agg(pe.evidence_id ORDER BY pe.evidence_id) FILTER (WHERE pe.evidence_id IS NOT NULL), '{}')
  FROM public.proposal_evidence pe JOIN public.evidence_items e ON e.id = pe.evidence_id WHERE pe.proposal_id = _proposal
$$;
REVOKE ALL ON FUNCTION public.proposal_evidence_counts(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_optimization_proposal(_workspace uuid, _request uuid, _p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w public.workspaces%ROWTYPE; x public.optimization_proposals%ROWTYPE; sk text := left(coalesce(_p->>'source_key',''), 120);
  cost numeric := nullif(_p->>'est_cost','')::numeric; cur text := nullif(upper(trim(coalesce(_p->>'currency',''))),'');
  lvl text := coalesce(nullif(_p->>'level',''), 'formal'); ev jsonb := coalesce(_p->'evidence_ids', '[]'); eid text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO w FROM public.workspaces WHERE id = _workspace;
  IF NOT FOUND OR NOT public.has_workspace_role(_workspace, 'member') THEN RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(_p) IS DISTINCT FROM 'object' OR (_p - ARRAY['source_key','origin','category','title','change','reason','evidence','uncertainty','expected_impact','est_cost','currency','est_credits','required_level','success_measure','measure_after','goal_id','campaign_id','initiative_id','metric_id','unit_id',
      'level','objective','risk','measurement_method','approval_requirement','business_context','evidence_gap_reason','evidence_ids']) <> '{}'::jsonb
     OR jsonb_typeof(ev) <> 'array' OR jsonb_array_length(ev) > 20 THEN
    RAISE EXCEPTION 'Invalid proposal' USING ERRCODE = '22023';
  END IF;
  IF lvl NOT IN ('observation','formal','execution') THEN RAISE EXCEPTION 'Invalid proposal level' USING ERRCODE = '22023'; END IF;
  SELECT * INTO x FROM public.optimization_proposals WHERE workspace_id = w.id AND request_key = _request;
  IF FOUND THEN RETURN jsonb_build_object('proposal_id', x.id, 'status', 'existing'); END IF;
  IF sk <> '' THEN
    SELECT * INTO x FROM public.optimization_proposals WHERE workspace_id = w.id AND source_key = sk AND status IN ('proposed','approved','converted');
    IF FOUND THEN RETURN jsonb_build_object('proposal_id', x.id, 'status', 'already_open'); END IF;
  END IF;
  IF cost IS NULL THEN cur := NULL; ELSIF cur IS NULL THEN RAISE EXCEPTION 'A cost needs a currency' USING ERRCODE = '22023'; END IF;
  -- an execution proposal states everything an approver needs up front
  IF lvl = 'execution' AND (length(trim(coalesce(_p->>'objective',''))) = 0 AND nullif(_p->>'goal_id','') IS NULL
      OR length(trim(coalesce(_p->>'risk',''))) = 0 OR length(trim(coalesce(_p->>'measurement_method',''))) = 0
      OR length(trim(coalesce(_p->>'approval_requirement',''))) = 0 OR length(trim(coalesce(_p->>'business_context',''))) = 0
      OR (cost IS NULL AND nullif(_p->>'est_credits','') IS NULL)) THEN
    RAISE EXCEPTION 'An execution proposal needs objective, cost, risk, measurement method, approval requirement and business context' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.optimization_proposals(org_id, workspace_id, unit_id, goal_id, campaign_id, initiative_id, metric_id, request_key, source_key, origin, category,
    title, change, reason, evidence, uncertainty, expected_impact, est_cost, currency, est_credits, required_level, success_measure, measure_after, created_by,
    level, objective, risk, measurement_method, approval_requirement, business_context, evidence_gap_reason)
  VALUES (w.org_id, w.id, nullif(_p->>'unit_id','')::uuid, nullif(_p->>'goal_id','')::uuid, nullif(_p->>'campaign_id','')::uuid, nullif(_p->>'initiative_id','')::uuid,
    nullif(_p->>'metric_id','')::uuid, _request, sk, coalesce(nullif(_p->>'origin',''), 'team'), _p->>'category', trim(_p->>'title'), trim(_p->>'change'), trim(_p->>'reason'),
    coalesce(_p->'evidence', '[]'), trim(_p->>'uncertainty'), trim(_p->>'expected_impact'), cost, cur, nullif(_p->>'est_credits','')::int,
    coalesce(nullif(_p->>'required_level',''), 'none'), trim(_p->>'success_measure'), nullif(_p->>'measure_after','')::date, auth.uid(),
    lvl, trim(coalesce(_p->>'objective','')), trim(coalesce(_p->>'risk','')), trim(coalesce(_p->>'measurement_method','')),
    trim(coalesce(_p->>'approval_requirement','')), trim(coalesce(_p->>'business_context','')), trim(coalesce(_p->>'evidence_gap_reason','')))
  RETURNING * INTO x;
  FOR eid IN SELECT jsonb_array_elements_text(ev) LOOP PERFORM public.proposal_link_evidence_internal(x, eid::uuid, 'supports'); END LOOP;
  INSERT INTO public.activity_events(org_id, workspace_id, entity_type, entity_id, actor_id, action, metadata)
  VALUES (x.org_id, x.workspace_id, 'optimization_proposal', x.id, auth.uid(), 'proposal.created', jsonb_build_object('origin', x.origin, 'category', x.category, 'level', x.level));
  RETURN jsonb_build_object('proposal_id', x.id, 'status', 'created');
END;
$$;
REVOKE ALL ON FUNCTION public.create_optimization_proposal(uuid,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_optimization_proposal(uuid,uuid,jsonb) TO authenticated;

-- review (editor) · promote observation -> formal (member) · approve/reject (admin, after review, stating the evidence seen)
-- · convert to a task (member, approved only) · record outcome (member, converted only) · withdraw.
CREATE OR REPLACE FUNCTION public.advance_optimization_proposal(_proposal uuid, _action text, _data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE x public.optimization_proposals%ROWTYPE; tk uuid; c record; seen uuid[];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO x FROM public.optimization_proposals WHERE id = _proposal FOR UPDATE;
  IF NOT FOUND OR NOT public.has_workspace_role(x.workspace_id, 'member') THEN RAISE EXCEPTION 'Proposal unavailable' USING ERRCODE = '42501'; END IF;
  _data := coalesce(_data, '{}'::jsonb);
  SELECT * INTO c FROM public.proposal_evidence_counts(x.id);
  IF _action = 'review' THEN
    IF NOT public.has_workspace_role(x.workspace_id, 'editor') THEN RAISE EXCEPTION 'Only a business editor or administrator can review proposals' USING ERRCODE = '42501'; END IF;
    IF x.status <> 'proposed' THEN RAISE EXCEPTION 'Only open proposals can be reviewed' USING ERRCODE = '22023'; END IF;
    IF x.level = 'observation' THEN RAISE EXCEPTION 'An observation is promoted to a formal proposal before review' USING ERRCODE = '22023'; END IF;
    UPDATE public.optimization_proposals SET reviewed_by = auth.uid(), reviewed_at = now(), review_note = left(coalesce(_data->>'note',''), 500), updated_at = now()
      WHERE id = x.id RETURNING * INTO x;
  ELSIF _action = 'promote' THEN
    IF x.status <> 'proposed' OR x.level <> 'observation' THEN RAISE EXCEPTION 'Only open observations can be promoted' USING ERRCODE = '22023'; END IF;
    UPDATE public.optimization_proposals SET level = 'formal', evidence_gap_reason = left(trim(coalesce(_data->>'evidence_gap_reason', x.evidence_gap_reason)), 500), updated_at = now()
      WHERE id = x.id RETURNING * INTO x;
  ELSIF _action IN ('approve','reject') THEN
    IF NOT public.has_workspace_role(x.workspace_id, 'admin') THEN RAISE EXCEPTION 'Only an administrator can approve improvement proposals' USING ERRCODE = '42501'; END IF;
    IF x.status <> 'proposed' THEN RAISE EXCEPTION 'Only open proposals can be decided' USING ERRCODE = '22023'; END IF;
    IF _action = 'approve' THEN
      IF x.level = 'observation' THEN RAISE EXCEPTION 'An observation cannot be approved as work' USING ERRCODE = '23514'; END IF;
      IF x.reviewed_at IS NULL THEN RAISE EXCEPTION 'This proposal needs a review before approval' USING ERRCODE = '23514'; END IF;
      -- the approver states the exact evidence they inspected; a changed set means they decided on something else
      IF jsonb_typeof(_data->'seen_evidence') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'State the evidence you inspected' USING ERRCODE = '22023'; END IF;
      SELECT coalesce(array_agg(v::uuid ORDER BY v::uuid), '{}') INTO seen FROM jsonb_array_elements_text(_data->'seen_evidence') v;
      IF seen IS DISTINCT FROM c.linked THEN RAISE EXCEPTION 'The evidence changed since you looked at it' USING ERRCODE = '40001'; END IF;
      IF x.level = 'formal' AND c.independent = 0 AND length(trim(x.evidence_gap_reason)) = 0 THEN
        RAISE EXCEPTION 'A formal proposal needs accepted independent evidence or an explanation why none is available' USING ERRCODE = '23514';
      END IF;
      IF x.level = 'execution' AND c.record_backed = 0 THEN
        RAISE EXCEPTION 'An execution proposal needs an accepted fact or measurement from a business record' USING ERRCODE = '23514';
      END IF;
    END IF;
    UPDATE public.optimization_proposals SET status = CASE WHEN _action = 'approve' THEN 'approved' ELSE 'rejected' END, decided_by = auth.uid(), decided_at = now(),
      decision_note = left(coalesce(_data->>'note',''), 500), updated_at = now() WHERE id = x.id RETURNING * INTO x;
    IF _action = 'approve' THEN
      INSERT INTO public.evidence_events(org_id, workspace_id, evidence_id, action, from_status, to_status, proposal_id, actor_id)
        SELECT e.org_id, e.workspace_id, e.id, 'used_in_decision', e.status, 'used_in_decision', x.id, auth.uid()
        FROM public.proposal_evidence pe JOIN public.evidence_items e ON e.id = pe.evidence_id
        WHERE pe.proposal_id = x.id AND e.status IN ('accepted','used_in_decision');
      UPDATE public.evidence_items e SET status = 'used_in_decision', updated_at = now()
        FROM public.proposal_evidence pe WHERE pe.proposal_id = x.id AND pe.evidence_id = e.id AND e.status = 'accepted';
    END IF;
  ELSIF _action = 'convert' THEN
    IF x.status <> 'approved' OR x.level = 'observation' THEN RAISE EXCEPTION 'A proposal must be approved before it becomes work' USING ERRCODE = '22023'; END IF;
    INSERT INTO public.tasks(org_id, workspace_id, title, description, status, priority, campaign_id, labels, created_by)
    VALUES (x.org_id, x.workspace_id, left(x.title, 200),
      left('Change: ' || x.change || E'\n\nWhy: ' || x.reason || E'\n\nMeasure: ' || x.success_measure, 5000),
      'todo', CASE WHEN x.category IN ('immediate','problem') THEN 'high' ELSE 'medium' END, x.campaign_id, ARRAY['improvement'], auth.uid())
    RETURNING id INTO tk;
    UPDATE public.optimization_proposals SET status = 'converted', task_id = tk, updated_at = now() WHERE id = x.id RETURNING * INTO x;
  ELSIF _action = 'measure' THEN
    IF x.status <> 'converted' THEN RAISE EXCEPTION 'Only proposals that became work can be measured' USING ERRCODE = '22023'; END IF;
    IF coalesce(_data->>'outcome','') NOT IN ('improved','no_change','worse','inconclusive') THEN RAISE EXCEPTION 'Choose an outcome' USING ERRCODE = '22023'; END IF;
    UPDATE public.optimization_proposals SET status = 'measured', outcome = _data->>'outcome', outcome_note = left(coalesce(_data->>'note',''), 600),
      measured_at = now(), updated_at = now() WHERE id = x.id RETURNING * INTO x;
  ELSIF _action = 'withdraw' THEN
    IF x.status NOT IN ('proposed','approved') THEN RAISE EXCEPTION 'This proposal can no longer be withdrawn' USING ERRCODE = '22023'; END IF;
    UPDATE public.optimization_proposals SET status = 'withdrawn', updated_at = now() WHERE id = x.id RETURNING * INTO x;
  ELSE RAISE EXCEPTION 'Unknown proposal action' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.activity_events(org_id, workspace_id, entity_type, entity_id, actor_id, action, metadata)
  VALUES (x.org_id, x.workspace_id, 'optimization_proposal', x.id, auth.uid(),
    'proposal.' || CASE _action WHEN 'review' THEN 'reviewed' WHEN 'promote' THEN 'promoted' ELSE x.status END,
    jsonb_build_object('outcome', x.outcome, 'task', x.task_id, 'level', x.level, 'evidence', c.linked, 'independent', c.independent));
  RETURN jsonb_build_object('proposal_id', x.id, 'status', x.status, 'task_id', x.task_id, 'level', x.level);
END;
$$;
REVOKE ALL ON FUNCTION public.advance_optimization_proposal(uuid,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advance_optimization_proposal(uuid,text,jsonb) TO authenticated;
