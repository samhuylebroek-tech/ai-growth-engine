-- PROPOSED migration (not in the journal; staging only until the owner approves live migrations). Apply only with
-- scripts/staging/apply-proposal.ts. Idempotent. Depends on 0056, proposals 0059, 0063 and 0065.
--
-- Business performance intelligence: one performance layer built on the existing metric_definitions /
-- performance_measurements (no parallel reporting tables), plus the records that layer was missing.
-- * Business units: brands and units inside a workspace (the workspace is the business), so every performance,
--   revenue and attribution record can be scoped to the right organization, business, brand and unit.
-- * Metrics gain campaign, channel, category and unit links; their identity (key, unit, currency) stays fixed.
-- * revenue_events: a permanent per-currency ledger of sales, refunds, cancellations and corrections. A source
--   reference can be recorded once per source, refunds can never exceed what remains of their sale, and estimated
--   entries are kept apart from actual revenue. Imported events enter only through a server-attested function.
-- * attribution_touchpoints: evidence that a sale was preceded by a campaign/initiative/channel touch. Attribution
--   models are computed from these in application code; with no touchpoint a sale stays unattributed.
-- * growth_experiments: hypothesis -> approval -> run -> result, with the evidence strength fixed by the method so a
--   before/after comparison can never be recorded as a controlled (causal) result.
-- * optimization_proposals: improvement proposals with change, reason, evidence, uncertainty, cost, permission and
--   success measure. Only an administrator approves; an approved proposal becomes a task in the existing execution
--   engine. Nothing here changes strategies, budgets or external campaigns.

-- 1. Business units ------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.business_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  kind text NOT NULL CHECK (kind IN ('brand','unit')),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  parent_id uuid,
  archived boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, org_id, workspace_id),
  CHECK (parent_id IS DISTINCT FROM id),
  FOREIGN KEY (parent_id, org_id, workspace_id) REFERENCES public.business_units(id, org_id, workspace_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS business_units_name_unique ON public.business_units(workspace_id, kind, lower(name));
REVOKE ALL ON public.business_units FROM anon, authenticated;
GRANT SELECT ON public.business_units TO authenticated;
GRANT ALL ON public.business_units TO service_role;
ALTER TABLE public.business_units ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS business_units_read ON public.business_units;
CREATE POLICY business_units_read ON public.business_units FOR SELECT TO authenticated USING (public.has_workspace_role(workspace_id, 'viewer'));

CREATE OR REPLACE FUNCTION public.create_business_unit(_workspace uuid, _kind text, _name text, _parent uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w public.workspaces%ROWTYPE; u public.business_units%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO w FROM public.workspaces WHERE id = _workspace;
  IF NOT FOUND OR NOT public.has_workspace_role(_workspace, 'admin') THEN RAISE EXCEPTION 'Only an administrator can add brands and units'; END IF;
  SELECT * INTO u FROM public.business_units WHERE workspace_id = w.id AND kind = _kind AND lower(name) = lower(trim(_name));
  IF FOUND THEN RETURN jsonb_build_object('unit_id', u.id, 'status', 'existing'); END IF;
  INSERT INTO public.business_units(org_id, workspace_id, kind, name, parent_id, created_by)
  VALUES (w.org_id, w.id, _kind, trim(_name), _parent, auth.uid()) RETURNING * INTO u;
  PERFORM public.log_audit(w.org_id, 'business_unit.created', 'business_unit', u.id::text, jsonb_build_object('kind', u.kind));
  RETURN jsonb_build_object('unit_id', u.id, 'status', 'created');
END;
$$;
REVOKE ALL ON FUNCTION public.create_business_unit(uuid,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_business_unit(uuid,text,text,uuid) TO authenticated;

-- 2. Metric links ---------------------------------------------------------------------------------------------------
ALTER TABLE public.metric_definitions ADD COLUMN IF NOT EXISTS campaign_id uuid;
ALTER TABLE public.metric_definitions ADD COLUMN IF NOT EXISTS unit_id uuid;
ALTER TABLE public.metric_definitions ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT '';
ALTER TABLE public.metric_definitions ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'other';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'metric_definitions_campaign_scope_fk') THEN
    ALTER TABLE public.metric_definitions ADD CONSTRAINT metric_definitions_campaign_scope_fk
      FOREIGN KEY (campaign_id, org_id, workspace_id) REFERENCES public.campaigns(id, org_id, workspace_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'metric_definitions_unit_scope_fk') THEN
    ALTER TABLE public.metric_definitions ADD CONSTRAINT metric_definitions_unit_scope_fk
      FOREIGN KEY (unit_id, org_id, workspace_id) REFERENCES public.business_units(id, org_id, workspace_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'metric_definitions_category_check') THEN
    ALTER TABLE public.metric_definitions ADD CONSTRAINT metric_definitions_category_check
      CHECK (category IN ('marketing','sales','retention','financial','website','other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'metric_definitions_channel_check') THEN
    ALTER TABLE public.metric_definitions ADD CONSTRAINT metric_definitions_channel_check CHECK (length(channel) <= 40);
  END IF;
END $$;

-- Same function as 0056, now also accepting the new link fields. Identity stays fixed (trigger from 0056).
CREATE OR REPLACE FUNCTION public.update_metric_definition(_metric uuid, _patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.metric_definitions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF jsonb_typeof(_patch) IS DISTINCT FROM 'object'
     OR (_patch - ARRAY['label','direction','goal_id','initiative_id','archived','campaign_id','unit_id','channel','category']) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'Invalid metric update';
  END IF;
  SELECT * INTO m FROM public.metric_definitions WHERE id = _metric FOR UPDATE;
  IF NOT FOUND OR NOT public.has_workspace_role(m.workspace_id, 'member') THEN
    RAISE EXCEPTION 'Metric unavailable';
  END IF;
  UPDATE public.metric_definitions SET
    label = CASE WHEN _patch ? 'label' THEN trim(_patch->>'label') ELSE label END,
    direction = CASE WHEN _patch ? 'direction' THEN _patch->>'direction' ELSE direction END,
    goal_id = CASE WHEN _patch ? 'goal_id' THEN nullif(_patch->>'goal_id','')::uuid ELSE goal_id END,
    initiative_id = CASE WHEN _patch ? 'initiative_id' THEN nullif(_patch->>'initiative_id','')::uuid ELSE initiative_id END,
    archived = CASE WHEN _patch ? 'archived' THEN (_patch->>'archived')::boolean ELSE archived END,
    campaign_id = CASE WHEN _patch ? 'campaign_id' THEN nullif(_patch->>'campaign_id','')::uuid ELSE campaign_id END,
    unit_id = CASE WHEN _patch ? 'unit_id' THEN nullif(_patch->>'unit_id','')::uuid ELSE unit_id END,
    channel = CASE WHEN _patch ? 'channel' THEN left(trim(coalesce(_patch->>'channel','')), 40) ELSE channel END,
    category = CASE WHEN _patch ? 'category' THEN _patch->>'category' ELSE category END,
    updated_at = now()
  WHERE id = m.id RETURNING * INTO m;
  RETURN jsonb_build_object('metric_id', m.id, 'archived', m.archived);
END;
$$;
REVOKE ALL ON FUNCTION public.update_metric_definition(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_metric_definition(uuid,jsonb) TO authenticated;

-- 3. Revenue ledger -------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.revenue_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  unit_id uuid,
  kind text NOT NULL CHECK (kind IN ('sale','refund','cancellation','correction')),
  amount numeric(14,2) NOT NULL CHECK (amount > -1e12 AND amount < 1e12 AND amount <> 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  occurred_at timestamptz NOT NULL,
  data_class text NOT NULL CHECK (data_class IN ('imported','manual','estimated')),
  source text NOT NULL CHECK (source ~ '^(manual|[a-z][a-z0-9_.]{1,40})$'),
  source_ref text NOT NULL DEFAULT '' CHECK (length(source_ref) <= 200),
  customer_ref text NOT NULL DEFAULT '' CHECK (length(customer_ref) <= 120 AND customer_ref !~ '@'),
  deal_id uuid,
  relates_to uuid,
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 300),
  request_key uuid NOT NULL,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, request_key),
  UNIQUE (id, org_id, workspace_id),
  CHECK ((kind = 'sale' AND amount > 0 AND relates_to IS NULL)
      OR (kind IN ('refund','cancellation') AND amount < 0 AND relates_to IS NOT NULL)
      OR (kind = 'correction' AND relates_to IS NOT NULL)),
  CHECK (relates_to IS DISTINCT FROM id),
  CHECK ((data_class = 'imported') = (source <> 'manual')),
  FOREIGN KEY (relates_to, org_id, workspace_id) REFERENCES public.revenue_events(id, org_id, workspace_id),
  FOREIGN KEY (unit_id, org_id, workspace_id) REFERENCES public.business_units(id, org_id, workspace_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS revenue_events_source_ref_unique ON public.revenue_events(workspace_id, source, kind, source_ref) WHERE source_ref <> '';
CREATE INDEX IF NOT EXISTS revenue_events_scope_time ON public.revenue_events(org_id, workspace_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS revenue_events_relates ON public.revenue_events(relates_to) WHERE relates_to IS NOT NULL;
REVOKE ALL ON public.revenue_events FROM anon, authenticated;
GRANT SELECT ON public.revenue_events TO authenticated;
GRANT ALL ON public.revenue_events TO service_role;
ALTER TABLE public.revenue_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS revenue_events_read ON public.revenue_events;
CREATE POLICY revenue_events_read ON public.revenue_events FOR SELECT TO authenticated USING (public.has_workspace_role(workspace_id, 'viewer'));

CREATE OR REPLACE FUNCTION public.guard_permanent_row() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'These records are permanent history; record a correction instead'; END;
$$;
REVOKE ALL ON FUNCTION public.guard_permanent_row() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS revenue_events_permanent ON public.revenue_events;
CREATE TRIGGER revenue_events_permanent BEFORE UPDATE OR DELETE ON public.revenue_events FOR EACH ROW EXECUTE FUNCTION public.guard_permanent_row();

-- Shared insert path for manual and imported events. Caller has already checked role/proof.
CREATE OR REPLACE FUNCTION public.revenue_event_insert(
  _workspace uuid, _request uuid, _kind text, _amount numeric, _currency text, _occurred timestamptz, _class text,
  _source text, _source_ref text, _customer_ref text, _deal uuid, _relates uuid, _unit uuid, _note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  w public.workspaces%ROWTYPE; prior public.revenue_events%ROWTYPE; sale public.revenue_events%ROWTYPE; e public.revenue_events%ROWTYPE;
  cur text := upper(trim(coalesce(_currency,''))); remaining numeric; ref text := left(trim(coalesce(_source_ref,'')), 200);
BEGIN
  SELECT * INTO w FROM public.workspaces WHERE id = _workspace;
  IF NOT FOUND THEN RAISE EXCEPTION 'Workspace unavailable'; END IF;
  IF _request IS NULL THEN RAISE EXCEPTION 'Request key required'; END IF;
  SELECT * INTO prior FROM public.revenue_events WHERE workspace_id = w.id AND request_key = _request;
  IF FOUND THEN
    IF prior.kind = _kind AND prior.amount = round(_amount, 2) AND prior.currency = cur AND prior.source = _source
       AND prior.data_class = _class AND prior.occurred_at = _occurred AND prior.source_ref = ref
       AND prior.relates_to IS NOT DISTINCT FROM _relates AND prior.deal_id IS NOT DISTINCT FROM _deal THEN
      RETURN jsonb_build_object('event_id', prior.id, 'status', 'existing');
    END IF;
    RAISE EXCEPTION 'This request key was already used for a different entry';
  END IF;
  IF _occurred IS NULL OR _occurred > now() + interval '1 day' THEN RAISE EXCEPTION 'Revenue cannot be dated in the future'; END IF;
  IF ref <> '' AND EXISTS (SELECT 1 FROM public.revenue_events WHERE workspace_id = w.id AND source = _source AND kind = _kind AND source_ref = ref) THEN
    RAISE EXCEPTION 'This source reference is already recorded; revenue is never counted twice';
  END IF;
  IF _deal IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.crm_deals d WHERE d.id = _deal AND d.org_id = w.org_id AND d.workspace_id = w.id) THEN
    RAISE EXCEPTION 'Deal unavailable';
  END IF;
  IF _kind = 'sale' THEN
    IF _relates IS NOT NULL THEN RAISE EXCEPTION 'A sale cannot refer to another entry'; END IF;
    IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'A sale must be a positive amount'; END IF;
  ELSE
    -- Serialize all changes against one sale so refunds can never exceed it.
    SELECT * INTO sale FROM public.revenue_events WHERE id = _relates AND workspace_id = w.id FOR UPDATE;
    IF NOT FOUND OR sale.kind <> 'sale' THEN RAISE EXCEPTION 'Refunds, cancellations and corrections must refer to a sale in this workspace'; END IF;
    IF sale.currency <> cur THEN RAISE EXCEPTION 'A refund or correction must use the currency of its sale'; END IF;
    IF (sale.data_class = 'estimated') <> (_class = 'estimated') THEN RAISE EXCEPTION 'Estimated and actual entries cannot correct each other'; END IF;
    IF _kind IN ('refund','cancellation') AND (_amount IS NULL OR _amount >= 0) THEN RAISE EXCEPTION 'Refunds and cancellations are negative amounts'; END IF;
    SELECT sale.amount + coalesce(sum(r.amount), 0) INTO remaining FROM public.revenue_events r WHERE r.relates_to = sale.id;
    IF remaining + _amount < 0 THEN RAISE EXCEPTION 'This would take the sale below zero; refunds cannot exceed the sale'; END IF;
    IF _unit IS NULL THEN _unit := sale.unit_id; END IF;
  END IF;
  INSERT INTO public.revenue_events(org_id, workspace_id, unit_id, kind, amount, currency, occurred_at, data_class, source, source_ref,
    customer_ref, deal_id, relates_to, note, request_key, created_by)
  VALUES (w.org_id, w.id, _unit, _kind, round(_amount, 2), cur, _occurred, _class, _source, ref,
    left(trim(coalesce(_customer_ref,'')), 120), _deal, _relates, left(coalesce(_note,''), 300), _request, auth.uid())
  RETURNING * INTO e;
  INSERT INTO public.activity_events(org_id, workspace_id, entity_type, entity_id, actor_id, action, metadata)
  VALUES (w.org_id, w.id, 'revenue_event', e.id, auth.uid(), 'revenue.' || e.kind, jsonb_build_object('currency', e.currency, 'class', e.data_class, 'source', e.source));
  RETURN jsonb_build_object('event_id', e.id, 'status', 'created');
END;
$$;
REVOKE ALL ON FUNCTION public.revenue_event_insert(uuid,uuid,text,numeric,text,timestamptz,text,text,text,text,uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated;

-- Team entries: manual or estimated, never "imported".
CREATE OR REPLACE FUNCTION public.record_revenue_event(
  _workspace uuid, _request uuid, _kind text, _amount numeric, _currency text, _occurred timestamptz, _class text,
  _source_ref text, _customer_ref text, _deal uuid, _relates uuid, _unit uuid, _note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.has_workspace_role(_workspace, 'member') THEN RAISE EXCEPTION 'Workspace unavailable'; END IF;
  IF _class NOT IN ('manual','estimated') THEN RAISE EXCEPTION 'Team entries are manual or estimated; imported revenue comes only from a connected source'; END IF;
  RETURN public.revenue_event_insert(_workspace, _request, _kind, _amount, _currency, _occurred, _class, 'manual', _source_ref, _customer_ref, _deal, _relates, _unit, _note);
END;
$$;
REVOKE ALL ON FUNCTION public.record_revenue_event(uuid,uuid,text,numeric,text,timestamptz,text,text,text,uuid,uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_revenue_event(uuid,uuid,text,numeric,text,timestamptz,text,text,text,uuid,uuid,uuid,text) TO authenticated;

-- Imported events: server-attested, from a connector connected in this workspace, with its own source reference.
CREATE OR REPLACE FUNCTION public.import_revenue_event_verified(
  _workspace uuid, _connector text, _request uuid, _kind text, _amount numeric, _currency text, _occurred timestamptz,
  _source_ref text, _customer_ref text, _relates_ref text, _proof text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rel uuid;
BEGIN
  PERFORM public.verify_ai_accounting(_proof);
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.has_workspace_role(_workspace, 'member') THEN RAISE EXCEPTION 'Workspace unavailable'; END IF;
  IF _connector NOT IN ('stripe','hubspot','sim.stripe','sim.hubspot','sim.salesforce') THEN RAISE EXCEPTION 'This source cannot provide revenue'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.connector_connections c WHERE c.workspace_id = _workspace AND c.connector_key = _connector AND c.status = 'connected') THEN
    RAISE EXCEPTION 'Connector is not connected for this workspace';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.connector_connections c WHERE c.workspace_id = _workspace AND c.connector_key = _connector AND 'read' = ANY (c.granted_levels)) THEN
    RAISE EXCEPTION 'Read permission is not granted for this connector';
  END IF;
  IF length(trim(coalesce(_source_ref,''))) = 0 THEN RAISE EXCEPTION 'Imported revenue needs the source record reference'; END IF;
  IF _kind <> 'sale' THEN
    SELECT id INTO rel FROM public.revenue_events WHERE workspace_id = _workspace AND source = _connector AND kind = 'sale' AND source_ref = _relates_ref;
    IF rel IS NULL THEN RAISE EXCEPTION 'The related sale has not been imported'; END IF;
  END IF;
  RETURN public.revenue_event_insert(_workspace, _request, _kind, _amount, _currency, _occurred, 'imported', _connector, _source_ref, _customer_ref, NULL, rel, NULL, '');
END;
$$;
REVOKE ALL ON FUNCTION public.import_revenue_event_verified(uuid,text,uuid,text,numeric,text,timestamptz,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_revenue_event_verified(uuid,text,uuid,text,numeric,text,timestamptz,text,text,text,text) TO authenticated;

-- 4. Attribution touchpoints ----------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attribution_touchpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  revenue_event_id uuid NOT NULL,
  campaign_id uuid,
  initiative_id uuid,
  channel text NOT NULL DEFAULT '' CHECK (length(channel) <= 40),
  touched_at timestamptz NOT NULL,
  evidence text NOT NULL CHECK (evidence IN ('verified_link','tracked','manual')),
  source text NOT NULL CHECK (source ~ '^(manual|[a-z][a-z0-9_.]{1,40})$'),
  source_ref text NOT NULL DEFAULT '' CHECK (length(source_ref) <= 200),
  request_key uuid NOT NULL,
  retracted_at timestamptz,
  retracted_by uuid,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, request_key),
  CHECK (campaign_id IS NOT NULL OR initiative_id IS NOT NULL OR channel <> ''),
  CHECK ((evidence = 'manual') = (source = 'manual')),
  FOREIGN KEY (revenue_event_id, org_id, workspace_id) REFERENCES public.revenue_events(id, org_id, workspace_id),
  FOREIGN KEY (campaign_id, org_id, workspace_id) REFERENCES public.campaigns(id, org_id, workspace_id),
  FOREIGN KEY (initiative_id, org_id, workspace_id) REFERENCES public.growth_initiatives(id, org_id, workspace_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS attribution_touchpoints_once ON public.attribution_touchpoints(
  revenue_event_id, coalesce(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(initiative_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(channel), touched_at)
  WHERE retracted_at IS NULL;
REVOKE ALL ON public.attribution_touchpoints FROM anon, authenticated;
GRANT SELECT ON public.attribution_touchpoints TO authenticated;
GRANT ALL ON public.attribution_touchpoints TO service_role;
ALTER TABLE public.attribution_touchpoints ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attribution_touchpoints_read ON public.attribution_touchpoints;
CREATE POLICY attribution_touchpoints_read ON public.attribution_touchpoints FOR SELECT TO authenticated USING (public.has_workspace_role(workspace_id, 'viewer'));

-- Only retraction may change a touchpoint, and only once.
CREATE OR REPLACE FUNCTION public.guard_touchpoint() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Touchpoints are retracted, not deleted'; END IF;
  IF OLD.retracted_at IS NOT NULL OR NEW.retracted_at IS NULL
     OR (to_jsonb(NEW) - ARRAY['retracted_at','retracted_by']) <> (to_jsonb(OLD) - ARRAY['retracted_at','retracted_by']) THEN
    RAISE EXCEPTION 'A touchpoint can only be retracted once';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_touchpoint() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS attribution_touchpoints_guard ON public.attribution_touchpoints;
CREATE TRIGGER attribution_touchpoints_guard BEFORE UPDATE OR DELETE ON public.attribution_touchpoints FOR EACH ROW EXECUTE FUNCTION public.guard_touchpoint();

CREATE OR REPLACE FUNCTION public.touchpoint_insert(_sale uuid, _request uuid, _campaign uuid, _initiative uuid, _channel text,
  _touched timestamptz, _evidence text, _source text, _source_ref text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.revenue_events%ROWTYPE; prior public.attribution_touchpoints%ROWTYPE; tp public.attribution_touchpoints%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.revenue_events WHERE id = _sale;
  IF NOT FOUND OR NOT public.has_workspace_role(s.workspace_id, 'member') THEN RAISE EXCEPTION 'Sale unavailable'; END IF;
  IF s.kind <> 'sale' THEN RAISE EXCEPTION 'Touchpoints attach to sales only'; END IF;
  IF _request IS NULL THEN RAISE EXCEPTION 'Request key required'; END IF;
  SELECT * INTO prior FROM public.attribution_touchpoints WHERE workspace_id = s.workspace_id AND request_key = _request;
  IF FOUND THEN
    IF prior.revenue_event_id = s.id THEN RETURN jsonb_build_object('touchpoint_id', prior.id, 'status', 'existing'); END IF;
    RAISE EXCEPTION 'This request key was already used for a different touchpoint';
  END IF;
  IF _touched IS NULL OR _touched > s.occurred_at THEN RAISE EXCEPTION 'A touchpoint must happen before the sale it is credited for'; END IF;
  IF _touched < s.occurred_at - interval '730 days' THEN RAISE EXCEPTION 'Touchpoints older than two years before the sale are not credited'; END IF;
  INSERT INTO public.attribution_touchpoints(org_id, workspace_id, revenue_event_id, campaign_id, initiative_id, channel, touched_at, evidence, source, source_ref, request_key, created_by)
  VALUES (s.org_id, s.workspace_id, s.id, _campaign, _initiative, left(trim(coalesce(_channel,'')), 40), _touched, _evidence, _source, left(coalesce(_source_ref,''), 200), _request, auth.uid())
  RETURNING * INTO tp;
  RETURN jsonb_build_object('touchpoint_id', tp.id, 'status', 'created');
END;
$$;
REVOKE ALL ON FUNCTION public.touchpoint_insert(uuid,uuid,uuid,uuid,text,timestamptz,text,text,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_touchpoint(_sale uuid, _request uuid, _campaign uuid, _initiative uuid, _channel text, _touched timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  RETURN public.touchpoint_insert(_sale, _request, _campaign, _initiative, _channel, _touched, 'manual', 'manual', '');
END;
$$;
REVOKE ALL ON FUNCTION public.record_touchpoint(uuid,uuid,uuid,uuid,text,timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_touchpoint(uuid,uuid,uuid,uuid,text,timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.import_touchpoint_verified(_sale uuid, _request uuid, _campaign uuid, _initiative uuid, _channel text,
  _touched timestamptz, _evidence text, _connector text, _source_ref text, _proof text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.revenue_events%ROWTYPE;
BEGIN
  PERFORM public.verify_ai_accounting(_proof);
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _evidence NOT IN ('verified_link','tracked') THEN RAISE EXCEPTION 'Imported touchpoints are verified links or tracked visits'; END IF;
  SELECT * INTO s FROM public.revenue_events WHERE id = _sale;
  IF NOT FOUND OR NOT public.has_workspace_role(s.workspace_id, 'member') THEN RAISE EXCEPTION 'Sale unavailable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.connector_connections c WHERE c.workspace_id = s.workspace_id AND c.connector_key = _connector AND c.status = 'connected') THEN
    RAISE EXCEPTION 'Connector is not connected for this workspace';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.connector_connections c WHERE c.workspace_id = s.workspace_id AND c.connector_key = _connector AND 'read' = ANY (c.granted_levels)) THEN
    RAISE EXCEPTION 'Read permission is not granted for this connector';
  END IF;
  IF length(trim(coalesce(_source_ref,''))) = 0 THEN RAISE EXCEPTION 'Imported touchpoints need the source record reference'; END IF;
  RETURN public.touchpoint_insert(_sale, _request, _campaign, _initiative, _channel, _touched, _evidence, _connector, _source_ref);
END;
$$;
REVOKE ALL ON FUNCTION public.import_touchpoint_verified(uuid,uuid,uuid,uuid,text,timestamptz,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_touchpoint_verified(uuid,uuid,uuid,uuid,text,timestamptz,text,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.retract_touchpoint(_touchpoint uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tp public.attribution_touchpoints%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO tp FROM public.attribution_touchpoints WHERE id = _touchpoint FOR UPDATE;
  IF NOT FOUND OR NOT public.has_workspace_role(tp.workspace_id, 'member') THEN RAISE EXCEPTION 'Touchpoint unavailable'; END IF;
  IF tp.evidence <> 'manual' AND NOT public.has_workspace_role(tp.workspace_id, 'admin') THEN RAISE EXCEPTION 'Only an administrator can retract an imported touchpoint'; END IF;
  IF tp.retracted_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'already_retracted'); END IF;
  UPDATE public.attribution_touchpoints SET retracted_at = now(), retracted_by = auth.uid() WHERE id = tp.id;
  RETURN jsonb_build_object('status', 'retracted');
END;
$$;
REVOKE ALL ON FUNCTION public.retract_touchpoint(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retract_touchpoint(uuid) TO authenticated;

-- 5. Experiments ----------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.growth_experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  unit_id uuid, goal_id uuid, campaign_id uuid, metric_id uuid,
  request_key uuid NOT NULL,
  origin text NOT NULL DEFAULT 'team' CHECK (origin IN ('team','growth_officer','rule')),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  hypothesis text NOT NULL CHECK (length(trim(hypothesis)) BETWEEN 1 AND 1000),
  objective text NOT NULL DEFAULT '' CHECK (length(objective) <= 500),
  audience text NOT NULL DEFAULT '' CHECK (length(audience) <= 300),
  intervention text NOT NULL CHECK (length(trim(intervention)) BETWEEN 1 AND 1000),
  budget numeric(14,2) CHECK (budget IS NULL OR (budget >= 0 AND budget < 1e12)),
  currency text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  expected_result text NOT NULL DEFAULT '' CHECK (length(expected_result) <= 500),
  success_metric text NOT NULL CHECK (length(trim(success_metric)) BETWEEN 1 AND 200),
  duration_days int NOT NULL CHECK (duration_days BETWEEN 1 AND 365),
  risks text NOT NULL DEFAULT '' CHECK (length(risks) <= 1000),
  method text NOT NULL CHECK (method IN ('ab_test','comparison_group','before_after','observational')),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected','running','completed','cancelled')),
  decided_by uuid, decided_at timestamptz, decision_note text NOT NULL DEFAULT '' CHECK (length(decision_note) <= 500),
  started_at timestamptz, ended_at timestamptz,
  variant_value numeric, control_value numeric, variant_n int CHECK (variant_n IS NULL OR variant_n >= 0), control_n int CHECK (control_n IS NULL OR control_n >= 0),
  actual_result text NOT NULL DEFAULT '' CHECK (length(actual_result) <= 1000),
  conclusion text NOT NULL DEFAULT '' CHECK (length(conclusion) <= 1000),
  evidence_strength text CHECK (evidence_strength IS NULL OR evidence_strength IN ('controlled','correlational','inconclusive')),
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, request_key),
  UNIQUE (id, org_id, workspace_id),
  CHECK ((budget IS NULL) = (currency IS NULL)),
  CHECK (evidence_strength IS DISTINCT FROM 'controlled' OR method IN ('ab_test','comparison_group')),
  FOREIGN KEY (unit_id, org_id, workspace_id) REFERENCES public.business_units(id, org_id, workspace_id),
  FOREIGN KEY (goal_id, org_id, workspace_id) REFERENCES public.growth_goals(id, org_id, workspace_id),
  FOREIGN KEY (campaign_id, org_id, workspace_id) REFERENCES public.campaigns(id, org_id, workspace_id),
  FOREIGN KEY (metric_id, org_id, workspace_id) REFERENCES public.metric_definitions(id, org_id, workspace_id)
);
-- z of a two-proportion test on rates entered as percentages; only a |z| >= 1.96 controlled test is labelled "controlled".
ALTER TABLE public.growth_experiments ADD COLUMN IF NOT EXISTS z_score numeric;
REVOKE ALL ON public.growth_experiments FROM anon, authenticated;
GRANT SELECT ON public.growth_experiments TO authenticated;
GRANT ALL ON public.growth_experiments TO service_role;
ALTER TABLE public.growth_experiments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS growth_experiments_read ON public.growth_experiments;
CREATE POLICY growth_experiments_read ON public.growth_experiments FOR SELECT TO authenticated USING (public.has_workspace_role(workspace_id, 'viewer'));

CREATE OR REPLACE FUNCTION public.propose_experiment(_workspace uuid, _request uuid, _p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w public.workspaces%ROWTYPE; x public.growth_experiments%ROWTYPE; bud numeric := nullif(_p->>'budget','')::numeric; cur text := nullif(upper(trim(coalesce(_p->>'currency',''))),'');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO w FROM public.workspaces WHERE id = _workspace;
  IF NOT FOUND OR NOT public.has_workspace_role(_workspace, 'member') THEN RAISE EXCEPTION 'Workspace unavailable'; END IF;
  IF jsonb_typeof(_p) IS DISTINCT FROM 'object' OR (_p - ARRAY['title','hypothesis','objective','audience','intervention','budget','currency','expected_result','success_metric','duration_days','risks','method','goal_id','campaign_id','metric_id','unit_id','origin']) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'Invalid experiment';
  END IF;
  SELECT * INTO x FROM public.growth_experiments WHERE workspace_id = w.id AND request_key = _request;
  IF FOUND THEN RETURN jsonb_build_object('experiment_id', x.id, 'status', 'existing'); END IF;
  IF bud IS NULL THEN cur := NULL; ELSIF cur IS NULL THEN RAISE EXCEPTION 'A budget needs a currency'; END IF;
  INSERT INTO public.growth_experiments(org_id, workspace_id, unit_id, goal_id, campaign_id, metric_id, request_key, origin, title, hypothesis, objective, audience,
    intervention, budget, currency, expected_result, success_metric, duration_days, risks, method, created_by)
  VALUES (w.org_id, w.id, nullif(_p->>'unit_id','')::uuid, nullif(_p->>'goal_id','')::uuid, nullif(_p->>'campaign_id','')::uuid, nullif(_p->>'metric_id','')::uuid, _request,
    coalesce(nullif(_p->>'origin',''), 'team'), trim(_p->>'title'), trim(_p->>'hypothesis'), coalesce(_p->>'objective',''), coalesce(_p->>'audience',''),
    trim(_p->>'intervention'), bud, cur, coalesce(_p->>'expected_result',''), trim(_p->>'success_metric'), (_p->>'duration_days')::int, coalesce(_p->>'risks',''), _p->>'method', auth.uid())
  RETURNING * INTO x;
  INSERT INTO public.activity_events(org_id, workspace_id, entity_type, entity_id, actor_id, action, metadata)
  VALUES (x.org_id, x.workspace_id, 'experiment', x.id, auth.uid(), 'experiment.proposed', jsonb_build_object('method', x.method));
  RETURN jsonb_build_object('experiment_id', x.id, 'status', 'created');
END;
$$;
REVOKE ALL ON FUNCTION public.propose_experiment(uuid,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propose_experiment(uuid,uuid,jsonb) TO authenticated;

-- Lifecycle: approve/reject (admin), start (member, approved only), complete (member, running only), cancel.
CREATE OR REPLACE FUNCTION public.advance_experiment(_experiment uuid, _action text, _data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE x public.growth_experiments%ROWTYPE; strength text; vv numeric; cv numeric; vn int; cn int; z numeric; pool numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO x FROM public.growth_experiments WHERE id = _experiment FOR UPDATE;
  IF NOT FOUND OR NOT public.has_workspace_role(x.workspace_id, 'member') THEN RAISE EXCEPTION 'Experiment unavailable'; END IF;
  _data := coalesce(_data, '{}'::jsonb);
  IF _action IN ('approve','reject') THEN
    IF NOT public.has_workspace_role(x.workspace_id, 'admin') THEN RAISE EXCEPTION 'Only an administrator can approve experiments'; END IF;
    IF x.status <> 'proposed' THEN RAISE EXCEPTION 'Only proposed experiments can be decided'; END IF;
    UPDATE public.growth_experiments SET status = CASE WHEN _action = 'approve' THEN 'approved' ELSE 'rejected' END, decided_by = auth.uid(), decided_at = now(),
      decision_note = left(coalesce(_data->>'note',''), 500), updated_at = now() WHERE id = x.id RETURNING * INTO x;
  ELSIF _action = 'start' THEN
    IF x.status <> 'approved' THEN RAISE EXCEPTION 'An experiment must be approved before it starts'; END IF;
    UPDATE public.growth_experiments SET status = 'running', started_at = now(), updated_at = now() WHERE id = x.id RETURNING * INTO x;
  ELSIF _action = 'complete' THEN
    IF x.status <> 'running' THEN RAISE EXCEPTION 'Only running experiments can be completed'; END IF;
    vv := nullif(_data->>'variant_value','')::numeric; cv := nullif(_data->>'control_value','')::numeric;
    vn := nullif(_data->>'variant_n','')::int; cn := nullif(_data->>'control_n','')::int;
    IF length(trim(coalesce(_data->>'actual_result',''))) = 0 OR length(trim(coalesce(_data->>'conclusion',''))) = 0 THEN
      RAISE EXCEPTION 'Record the actual result and a conclusion';
    END IF;
    -- Evidence strength follows the method, never the hoped-for answer.
    -- Controlled methods: rates in percent, at least 30 per group, two-proportion z-test; |z| >= 1.96 is required for "controlled".
    z := NULL;
    IF x.method IN ('ab_test','comparison_group') AND vv IS NOT NULL AND cv IS NOT NULL AND coalesce(vn,0) >= 30 AND coalesce(cn,0) >= 30
       AND vv BETWEEN 0 AND 100 AND cv BETWEEN 0 AND 100 THEN
      pool := (vv / 100 * vn + cv / 100 * cn) / (vn + cn);
      IF pool > 0 AND pool < 1 THEN z := round(((vv - cv) / 100 / sqrt(pool * (1 - pool) * (1.0 / vn + 1.0 / cn)))::numeric, 2); END IF;
    END IF;
    strength := CASE
      WHEN vv IS NULL THEN 'inconclusive'
      WHEN x.method IN ('ab_test','comparison_group') AND z IS NOT NULL AND abs(z) >= 1.96 THEN 'controlled'
      WHEN x.method IN ('ab_test','comparison_group') THEN 'inconclusive'
      ELSE 'correlational' END;
    UPDATE public.growth_experiments SET status = 'completed', ended_at = now(), variant_value = vv, control_value = cv, variant_n = vn, control_n = cn, z_score = z,
      actual_result = left(_data->>'actual_result', 1000), conclusion = left(_data->>'conclusion', 1000), evidence_strength = strength, updated_at = now()
    WHERE id = x.id RETURNING * INTO x;
  ELSIF _action = 'cancel' THEN
    IF x.status NOT IN ('proposed','approved','running') THEN RAISE EXCEPTION 'This experiment is already closed'; END IF;
    UPDATE public.growth_experiments SET status = 'cancelled', ended_at = now(), updated_at = now() WHERE id = x.id RETURNING * INTO x;
  ELSE RAISE EXCEPTION 'Unknown experiment action';
  END IF;
  INSERT INTO public.activity_events(org_id, workspace_id, entity_type, entity_id, actor_id, action, metadata)
  VALUES (x.org_id, x.workspace_id, 'experiment', x.id, auth.uid(), 'experiment.' || x.status, jsonb_build_object('strength', x.evidence_strength));
  RETURN jsonb_build_object('experiment_id', x.id, 'status', x.status, 'evidence_strength', x.evidence_strength, 'z_score', x.z_score);
END;
$$;
REVOKE ALL ON FUNCTION public.advance_experiment(uuid,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advance_experiment(uuid,text,jsonb) TO authenticated;

-- 6. Optimization proposals -----------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.optimization_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  unit_id uuid, goal_id uuid, campaign_id uuid, initiative_id uuid, metric_id uuid, task_id uuid,
  request_key uuid NOT NULL,
  source_key text NOT NULL DEFAULT '' CHECK (length(source_key) <= 120),
  origin text NOT NULL CHECK (origin IN ('rule','team','growth_officer')),
  category text NOT NULL CHECK (category IN ('immediate','strategic','opportunity','problem','experiment')),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  change text NOT NULL CHECK (length(trim(change)) BETWEEN 1 AND 1000),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 1000),
  evidence jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(evidence) = 'array' AND jsonb_array_length(evidence) <= 12 AND length(evidence::text) <= 4000),
  uncertainty text NOT NULL CHECK (length(trim(uncertainty)) BETWEEN 1 AND 600),
  expected_impact text NOT NULL CHECK (length(trim(expected_impact)) BETWEEN 1 AND 600),
  est_cost numeric(14,2) CHECK (est_cost IS NULL OR (est_cost >= 0 AND est_cost < 1e12)),
  currency text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  est_credits int CHECK (est_credits IS NULL OR est_credits BETWEEN 0 AND 100000),
  required_level text NOT NULL DEFAULT 'none' CHECK (required_level IN ('none','read','draft','modify','execute','publish','budget')),
  success_measure text NOT NULL CHECK (length(trim(success_measure)) BETWEEN 1 AND 300),
  measure_after date,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected','converted','measured','withdrawn')),
  decided_by uuid, decided_at timestamptz, decision_note text NOT NULL DEFAULT '' CHECK (length(decision_note) <= 500),
  outcome text CHECK (outcome IS NULL OR outcome IN ('improved','no_change','worse','inconclusive')),
  outcome_note text NOT NULL DEFAULT '' CHECK (length(outcome_note) <= 600), measured_at timestamptz,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, request_key),
  CHECK ((est_cost IS NULL) = (currency IS NULL)),
  CHECK ((status IN ('converted','measured')) = (task_id IS NOT NULL)),
  FOREIGN KEY (unit_id, org_id, workspace_id) REFERENCES public.business_units(id, org_id, workspace_id),
  FOREIGN KEY (goal_id, org_id, workspace_id) REFERENCES public.growth_goals(id, org_id, workspace_id),
  FOREIGN KEY (campaign_id, org_id, workspace_id) REFERENCES public.campaigns(id, org_id, workspace_id),
  FOREIGN KEY (initiative_id, org_id, workspace_id) REFERENCES public.growth_initiatives(id, org_id, workspace_id),
  FOREIGN KEY (metric_id, org_id, workspace_id) REFERENCES public.metric_definitions(id, org_id, workspace_id),
  FOREIGN KEY (task_id, org_id, workspace_id) REFERENCES public.tasks(id, org_id, workspace_id)
);
-- One open proposal per rule finding, so repeated checks never pile up duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS optimization_proposals_open_source ON public.optimization_proposals(workspace_id, source_key)
  WHERE source_key <> '' AND status IN ('proposed','approved','converted');
REVOKE ALL ON public.optimization_proposals FROM anon, authenticated;
GRANT SELECT ON public.optimization_proposals TO authenticated;
GRANT ALL ON public.optimization_proposals TO service_role;
ALTER TABLE public.optimization_proposals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS optimization_proposals_read ON public.optimization_proposals;
CREATE POLICY optimization_proposals_read ON public.optimization_proposals FOR SELECT TO authenticated USING (public.has_workspace_role(workspace_id, 'viewer'));

CREATE OR REPLACE FUNCTION public.create_optimization_proposal(_workspace uuid, _request uuid, _p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w public.workspaces%ROWTYPE; x public.optimization_proposals%ROWTYPE; sk text := left(coalesce(_p->>'source_key',''), 120);
  cost numeric := nullif(_p->>'est_cost','')::numeric; cur text := nullif(upper(trim(coalesce(_p->>'currency',''))),'');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO w FROM public.workspaces WHERE id = _workspace;
  IF NOT FOUND OR NOT public.has_workspace_role(_workspace, 'member') THEN RAISE EXCEPTION 'Workspace unavailable'; END IF;
  IF jsonb_typeof(_p) IS DISTINCT FROM 'object' OR (_p - ARRAY['source_key','origin','category','title','change','reason','evidence','uncertainty','expected_impact','est_cost','currency','est_credits','required_level','success_measure','measure_after','goal_id','campaign_id','initiative_id','metric_id','unit_id']) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'Invalid proposal';
  END IF;
  SELECT * INTO x FROM public.optimization_proposals WHERE workspace_id = w.id AND request_key = _request;
  IF FOUND THEN RETURN jsonb_build_object('proposal_id', x.id, 'status', 'existing'); END IF;
  IF sk <> '' THEN
    SELECT * INTO x FROM public.optimization_proposals WHERE workspace_id = w.id AND source_key = sk AND status IN ('proposed','approved','converted');
    IF FOUND THEN RETURN jsonb_build_object('proposal_id', x.id, 'status', 'already_open'); END IF;
  END IF;
  IF cost IS NULL THEN cur := NULL; ELSIF cur IS NULL THEN RAISE EXCEPTION 'A cost needs a currency'; END IF;
  INSERT INTO public.optimization_proposals(org_id, workspace_id, unit_id, goal_id, campaign_id, initiative_id, metric_id, request_key, source_key, origin, category,
    title, change, reason, evidence, uncertainty, expected_impact, est_cost, currency, est_credits, required_level, success_measure, measure_after, created_by)
  VALUES (w.org_id, w.id, nullif(_p->>'unit_id','')::uuid, nullif(_p->>'goal_id','')::uuid, nullif(_p->>'campaign_id','')::uuid, nullif(_p->>'initiative_id','')::uuid,
    nullif(_p->>'metric_id','')::uuid, _request, sk, coalesce(nullif(_p->>'origin',''), 'team'), _p->>'category', trim(_p->>'title'), trim(_p->>'change'), trim(_p->>'reason'),
    coalesce(_p->'evidence', '[]'), trim(_p->>'uncertainty'), trim(_p->>'expected_impact'), cost, cur, nullif(_p->>'est_credits','')::int,
    coalesce(nullif(_p->>'required_level',''), 'none'), trim(_p->>'success_measure'), nullif(_p->>'measure_after','')::date, auth.uid())
  RETURNING * INTO x;
  INSERT INTO public.activity_events(org_id, workspace_id, entity_type, entity_id, actor_id, action, metadata)
  VALUES (x.org_id, x.workspace_id, 'optimization_proposal', x.id, auth.uid(), 'proposal.created', jsonb_build_object('origin', x.origin, 'category', x.category));
  RETURN jsonb_build_object('proposal_id', x.id, 'status', 'created');
END;
$$;
REVOKE ALL ON FUNCTION public.create_optimization_proposal(uuid,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_optimization_proposal(uuid,uuid,jsonb) TO authenticated;

-- approve/reject (admin) · convert to a task (member, approved only) · record outcome (member, converted only) · withdraw.
CREATE OR REPLACE FUNCTION public.advance_optimization_proposal(_proposal uuid, _action text, _data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE x public.optimization_proposals%ROWTYPE; tk uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO x FROM public.optimization_proposals WHERE id = _proposal FOR UPDATE;
  IF NOT FOUND OR NOT public.has_workspace_role(x.workspace_id, 'member') THEN RAISE EXCEPTION 'Proposal unavailable'; END IF;
  _data := coalesce(_data, '{}'::jsonb);
  IF _action IN ('approve','reject') THEN
    IF NOT public.has_workspace_role(x.workspace_id, 'admin') THEN RAISE EXCEPTION 'Only an administrator can approve improvement proposals'; END IF;
    IF x.status <> 'proposed' THEN RAISE EXCEPTION 'Only open proposals can be decided'; END IF;
    UPDATE public.optimization_proposals SET status = CASE WHEN _action = 'approve' THEN 'approved' ELSE 'rejected' END, decided_by = auth.uid(), decided_at = now(),
      decision_note = left(coalesce(_data->>'note',''), 500), updated_at = now() WHERE id = x.id RETURNING * INTO x;
  ELSIF _action = 'convert' THEN
    IF x.status <> 'approved' THEN RAISE EXCEPTION 'A proposal must be approved before it becomes work'; END IF;
    -- Becomes ordinary work in the existing execution engine; nothing else is changed.
    INSERT INTO public.tasks(org_id, workspace_id, title, description, status, priority, campaign_id, labels, created_by)
    VALUES (x.org_id, x.workspace_id, left(x.title, 200),
      left('Change: ' || x.change || E'\n\nWhy: ' || x.reason || E'\n\nMeasure: ' || x.success_measure, 5000),
      'todo', CASE WHEN x.category IN ('immediate','problem') THEN 'high' ELSE 'medium' END, x.campaign_id, ARRAY['improvement'], auth.uid())
    RETURNING id INTO tk;
    UPDATE public.optimization_proposals SET status = 'converted', task_id = tk, updated_at = now() WHERE id = x.id RETURNING * INTO x;
  ELSIF _action = 'measure' THEN
    IF x.status <> 'converted' THEN RAISE EXCEPTION 'Only proposals that became work can be measured'; END IF;
    IF coalesce(_data->>'outcome','') NOT IN ('improved','no_change','worse','inconclusive') THEN RAISE EXCEPTION 'Choose an outcome'; END IF;
    UPDATE public.optimization_proposals SET status = 'measured', outcome = _data->>'outcome', outcome_note = left(coalesce(_data->>'note',''), 600),
      measured_at = now(), updated_at = now() WHERE id = x.id RETURNING * INTO x;
  ELSIF _action = 'withdraw' THEN
    IF x.status NOT IN ('proposed','approved') THEN RAISE EXCEPTION 'This proposal can no longer be withdrawn'; END IF;
    UPDATE public.optimization_proposals SET status = 'withdrawn', updated_at = now() WHERE id = x.id RETURNING * INTO x;
  ELSE RAISE EXCEPTION 'Unknown proposal action';
  END IF;
  INSERT INTO public.activity_events(org_id, workspace_id, entity_type, entity_id, actor_id, action, metadata)
  VALUES (x.org_id, x.workspace_id, 'optimization_proposal', x.id, auth.uid(), 'proposal.' || x.status, jsonb_build_object('outcome', x.outcome, 'task', x.task_id));
  RETURN jsonb_build_object('proposal_id', x.id, 'status', x.status, 'task_id', x.task_id);
END;
$$;
REVOKE ALL ON FUNCTION public.advance_optimization_proposal(uuid,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advance_optimization_proposal(uuid,text,jsonb) TO authenticated;

-- Tenant links stay immutable on mutable records (project rule), enforced for both tables.
CREATE OR REPLACE FUNCTION public.guard_bi_scope() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'These records are closed, not deleted'; END IF;
  IF NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.request_key IS DISTINCT FROM OLD.request_key
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Scope and origin cannot change';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_bi_scope() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS growth_experiments_scope ON public.growth_experiments;
CREATE TRIGGER growth_experiments_scope BEFORE UPDATE OR DELETE ON public.growth_experiments FOR EACH ROW EXECUTE FUNCTION public.guard_bi_scope();
DROP TRIGGER IF EXISTS optimization_proposals_scope ON public.optimization_proposals;
CREATE TRIGGER optimization_proposals_scope BEFORE UPDATE OR DELETE ON public.optimization_proposals FOR EACH ROW EXECUTE FUNCTION public.guard_bi_scope();
