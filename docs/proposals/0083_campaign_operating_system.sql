-- PROPOSED migration 0083 (staging only until approved): campaign operating system and hard spending limits.
--
-- 1. Strategic links: a campaign can name the strategy and initiative it serves, its hypothesis, expected
--    contribution, risks, risk level and one primary KPI (baseline, target, unit, actual). Links must stay inside the
--    business and point at the same goal as the campaign, so a campaign can never claim a strategy of another goal.
-- 2. Lifecycle: fourteen statuses with fixed transitions. Status changes go only through transition_campaign, which
--    checks the transition, the caller's role, a reason where one is needed and, for completion, a result or an
--    explicit "results unavailable" explanation plus an outcome that must agree with the recorded KPI. Every change is
--    an insert-only status event (who, when, why, from, to). A direct status UPDATE is refused.
-- 3. Spending limits per campaign: daily, weekly (ISO week, Monday start), monthly and lifetime maxima, an optional
--    reserve held back from the lifetime maximum, alert thresholds and an emergency stop. Limit changes are insert-only
--    history. record_campaign_spend now refuses new spending, new reservations and upward corrections that would exceed
--    a limit (checked per data class, so simulated entries never use or free real room) and logs each refusal.
--    These limits are enforced inside this application only; they do not stop spending at an external provider.

-- 1. Strategic links -----------------------------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS growth_strategies_scope_unique ON public.growth_strategies (id, org_id, workspace_id);
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS strategy_id uuid;
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS initiative_id uuid;
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS hypothesis text NOT NULL DEFAULT '' CHECK (length(hypothesis) <= 1000);
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS expected_contribution text NOT NULL DEFAULT '' CHECK (length(expected_contribution) <= 500);
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS risks text NOT NULL DEFAULT '' CHECK (length(risks) <= 1000);
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS risk_level text NOT NULL DEFAULT 'medium' CHECK (risk_level IN ('low','medium','high'));
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS primary_kpi text NOT NULL DEFAULT '' CHECK (length(primary_kpi) <= 80);
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS kpi_unit text NOT NULL DEFAULT '' CHECK (length(kpi_unit) <= 20);
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS kpi_baseline numeric CHECK (kpi_baseline IS NULL OR abs(kpi_baseline) < 1e12);
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS kpi_target numeric CHECK (kpi_target IS NULL OR abs(kpi_target) < 1e12);
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS kpi_actual numeric CHECK (kpi_actual IS NULL OR abs(kpi_actual) < 1e12);
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT 'not_evaluated'
  CHECK (outcome IN ('not_evaluated','achieved','partially_achieved','not_achieved','unknown'));
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS results_unavailable_reason text NOT NULL DEFAULT '' CHECK (length(results_unavailable_reason) <= 500);
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS approved_by uuid;
ALTER TABLE public.campaigns ADD COLUMN IF NOT EXISTS approved_at timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_strategy_scope_fk') THEN
    ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_strategy_scope_fk FOREIGN KEY (strategy_id, org_id, workspace_id) REFERENCES public.growth_strategies (id, org_id, workspace_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_initiative_scope_fk') THEN
    ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_initiative_scope_fk FOREIGN KEY (initiative_id, org_id, workspace_id) REFERENCES public.growth_initiatives (id, org_id, workspace_id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS campaigns_strategy ON public.campaigns (workspace_id, strategy_id) WHERE strategy_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS campaigns_initiative ON public.campaigns (workspace_id, initiative_id) WHERE initiative_id IS NOT NULL;

-- Widen the status set (existing values keep their meaning); new campaigns start as a draft.
ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS campaigns_status_check;
ALTER TABLE public.campaigns ADD CONSTRAINT campaigns_status_check CHECK (status IN
  ('idea','proposed','draft','awaiting_approval','approved','planned','scheduled','active','paused','needs_attention','optimizing','completed','cancelled','archived'));
ALTER TABLE public.campaigns ALTER COLUMN status SET DEFAULT 'draft';

-- Role a caller needs to move a campaign INTO a status (member = 2, editor = 3).
CREATE OR REPLACE FUNCTION public.campaign_transition_allowed(_from text, _to text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT _to = ANY (CASE _from
    WHEN 'idea' THEN ARRAY['proposed','draft','cancelled']
    WHEN 'proposed' THEN ARRAY['draft','awaiting_approval','cancelled']
    WHEN 'draft' THEN ARRAY['awaiting_approval','cancelled']
    WHEN 'awaiting_approval' THEN ARRAY['approved','draft','cancelled']
    WHEN 'approved' THEN ARRAY['planned','scheduled','active','cancelled']
    WHEN 'planned' THEN ARRAY['awaiting_approval','scheduled','active','paused','cancelled']
    WHEN 'scheduled' THEN ARRAY['active','paused','cancelled']
    WHEN 'active' THEN ARRAY['paused','needs_attention','optimizing','completed','cancelled']
    WHEN 'paused' THEN ARRAY['active','completed','cancelled']
    WHEN 'needs_attention' THEN ARRAY['active','optimizing','paused','completed','cancelled']
    WHEN 'optimizing' THEN ARRAY['active','paused','completed','cancelled']
    WHEN 'completed' THEN ARRAY['archived']
    WHEN 'cancelled' THEN ARRAY['archived']
    ELSE ARRAY[]::text[] END)
$$;
CREATE OR REPLACE FUNCTION public.campaign_transition_role(_from text, _to text) RETURNS public.org_role
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN _to IN ('proposed','awaiting_approval','paused','needs_attention') THEN 'member'::public.org_role
    WHEN _to = 'draft' AND _from IN ('idea','proposed') THEN 'member'::public.org_role
    ELSE 'editor'::public.org_role END
$$;
-- Transitions that need a written reason.
CREATE OR REPLACE FUNCTION public.campaign_transition_needs_reason(_from text, _to text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT _to IN ('paused','cancelled','needs_attention') OR (_from = 'awaiting_approval' AND _to = 'draft')
$$;

CREATE OR REPLACE FUNCTION public.campaign_links_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sg uuid; ig uuid;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status NOT IN ('idea','proposed','draft','planned') THEN
    RAISE EXCEPTION 'campaign_initial_status' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status
     AND coalesce(current_setting('app.campaign_transition', true), '') <> NEW.id::text THEN
    RAISE EXCEPTION 'campaign_status_via_transition' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND coalesce(current_setting('app.campaign_transition', true), '') <> NEW.id::text
     AND (NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
          OR NEW.outcome IS DISTINCT FROM OLD.outcome OR NEW.results_unavailable_reason IS DISTINCT FROM OLD.results_unavailable_reason) THEN
    RAISE EXCEPTION 'campaign_status_via_transition' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' AND (NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL OR NEW.outcome <> 'not_evaluated' OR NEW.results_unavailable_reason <> '') THEN
    RAISE EXCEPTION 'campaign_status_via_transition' USING ERRCODE = '42501';
  END IF;
  IF NEW.strategy_id IS NOT NULL THEN
    SELECT goal_id INTO sg FROM public.growth_strategies WHERE id = NEW.strategy_id AND workspace_id = NEW.workspace_id;
    IF NEW.goal_id IS NULL OR sg IS DISTINCT FROM NEW.goal_id THEN RAISE EXCEPTION 'campaign_strategy_goal_mismatch' USING ERRCODE = '22023'; END IF;
  END IF;
  IF NEW.initiative_id IS NOT NULL THEN
    SELECT goal_id INTO ig FROM public.growth_initiatives WHERE id = NEW.initiative_id AND workspace_id = NEW.workspace_id;
    IF NEW.goal_id IS NULL OR ig IS DISTINCT FROM NEW.goal_id THEN RAISE EXCEPTION 'campaign_initiative_goal_mismatch' USING ERRCODE = '22023'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS campaign_links_guard ON public.campaigns;
CREATE TRIGGER campaign_links_guard BEFORE INSERT OR UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.campaign_links_guard();

-- 2. Lifecycle history ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.campaign_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  campaign_id uuid NOT NULL,
  from_status text NOT NULL,
  to_status text NOT NULL,
  reason text NOT NULL DEFAULT '' CHECK (length(reason) <= 500),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object' AND length(detail::text) <= 4000),
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (campaign_id, org_id, workspace_id) REFERENCES public.campaigns(id, org_id, workspace_id)
);
CREATE INDEX IF NOT EXISTS campaign_status_events_campaign ON public.campaign_status_events (workspace_id, campaign_id, created_at DESC);
REVOKE ALL ON public.campaign_status_events FROM anon, authenticated;
GRANT SELECT ON public.campaign_status_events TO authenticated;
GRANT ALL ON public.campaign_status_events TO service_role;
ALTER TABLE public.campaign_status_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "campaign status history readable by business" ON public.campaign_status_events;
CREATE POLICY "campaign status history readable by business" ON public.campaign_status_events
  FOR SELECT TO authenticated USING (public.has_workspace_role(workspace_id, 'viewer'));
DROP TRIGGER IF EXISTS campaign_status_events_immutable ON public.campaign_status_events;
CREATE TRIGGER campaign_status_events_immutable BEFORE UPDATE OR DELETE ON public.campaign_status_events
  FOR EACH ROW EXECUTE FUNCTION public.decision_history_immutable();

CREATE OR REPLACE FUNCTION public.transition_campaign(_workspace uuid, _campaign uuid, _to text, _p jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.campaigns; reason text := trim(coalesce(_p->>'reason',''));
  outcome_ text := coalesce(_p->>'outcome',''); unavailable text := trim(coalesce(_p->>'results_unavailable',''));
  actual numeric; ev uuid; up boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(_p) IS DISTINCT FROM 'object' OR (_p - ARRAY['reason','outcome','results_unavailable','kpi_actual']) <> '{}'::jsonb
     OR length(reason) > 500 OR length(unavailable) > 500 THEN
    RAISE EXCEPTION 'invalid campaign transition' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO c FROM public.campaigns WHERE id = _campaign AND workspace_id = _workspace FOR UPDATE;
  IF c.id IS NULL OR NOT public.has_workspace_role(_workspace, 'viewer') THEN RAISE EXCEPTION 'campaign not found' USING ERRCODE = '42501'; END IF;
  IF NOT public.campaign_transition_allowed(c.status, _to) THEN RAISE EXCEPTION 'campaign_transition_invalid' USING ERRCODE = '22023'; END IF;
  IF NOT public.has_workspace_role(_workspace, public.campaign_transition_role(c.status, _to)) THEN
    RAISE EXCEPTION 'campaign_transition_forbidden' USING ERRCODE = '42501';
  END IF;
  IF public.campaign_transition_needs_reason(c.status, _to) AND reason = '' THEN RAISE EXCEPTION 'campaign_reason_required' USING ERRCODE = '22023'; END IF;
  IF _to = 'scheduled' AND c.start_date IS NULL THEN RAISE EXCEPTION 'campaign_start_required' USING ERRCODE = '22023'; END IF;
  IF _to = 'completed' THEN
    IF trim(c.results) = '' AND unavailable = '' THEN RAISE EXCEPTION 'campaign_result_required' USING ERRCODE = '22023'; END IF;
    IF outcome_ NOT IN ('achieved','partially_achieved','not_achieved','unknown') THEN RAISE EXCEPTION 'campaign_outcome_required' USING ERRCODE = '22023'; END IF;
    BEGIN actual := nullif(_p->>'kpi_actual','')::numeric;
    EXCEPTION WHEN others THEN RAISE EXCEPTION 'invalid campaign transition' USING ERRCODE = '22023'; END;
    IF actual IS NOT NULL AND abs(actual) >= 1e12 THEN RAISE EXCEPTION 'invalid campaign transition' USING ERRCODE = '22023'; END IF;
    actual := coalesce(actual, c.kpi_actual);
    -- "Achieved" must be supported by the recorded KPI when the campaign has one; task completion alone never counts.
    IF outcome_ = 'achieved' THEN
      IF c.primary_kpi <> '' AND actual IS NULL THEN RAISE EXCEPTION 'campaign_outcome_unsupported' USING ERRCODE = '22023'; END IF;
      IF actual IS NOT NULL AND c.kpi_target IS NOT NULL AND c.kpi_baseline IS NOT NULL AND c.kpi_target <> c.kpi_baseline THEN
        up := c.kpi_target > c.kpi_baseline;
        IF (up AND actual < c.kpi_target) OR (NOT up AND actual > c.kpi_target) THEN
          RAISE EXCEPTION 'campaign_outcome_unsupported' USING ERRCODE = '22023';
        END IF;
      END IF;
    END IF;
  END IF;
  PERFORM set_config('app.campaign_transition', c.id::text, true);
  UPDATE public.campaigns SET status = _to,
    approved_by = CASE WHEN _to = 'approved' THEN auth.uid() WHEN _to = 'draft' THEN NULL ELSE approved_by END,
    approved_at = CASE WHEN _to = 'approved' THEN now() WHEN _to = 'draft' THEN NULL ELSE approved_at END,
    outcome = CASE WHEN _to = 'completed' THEN outcome_ ELSE outcome END,
    kpi_actual = CASE WHEN _to = 'completed' THEN actual ELSE kpi_actual END,
    results_unavailable_reason = CASE WHEN _to = 'completed' AND trim(c.results) = '' THEN unavailable ELSE results_unavailable_reason END
  WHERE id = c.id;
  PERFORM set_config('app.campaign_transition', '', true);
  INSERT INTO public.campaign_status_events(org_id, workspace_id, campaign_id, from_status, to_status, reason, detail, actor_id)
  VALUES (c.org_id, c.workspace_id, c.id, c.status, _to, reason,
          CASE WHEN _to = 'completed' THEN jsonb_build_object('outcome', outcome_, 'kpi_actual', actual, 'results_unavailable', unavailable <> '' AND trim(c.results) = '') ELSE '{}'::jsonb END,
          auth.uid())
  RETURNING id INTO ev;
  PERFORM public.log_audit(c.org_id, 'campaign.status_changed', 'campaign', c.id::text,
    jsonb_build_object('from', c.status, 'to', _to, 'event', ev));
  RETURN jsonb_build_object('id', ev, 'from', c.status, 'to', _to);
END $$;
REVOKE ALL ON FUNCTION public.transition_campaign(uuid, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_campaign(uuid, uuid, text, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.campaign_links_guard() FROM PUBLIC, anon, authenticated;

-- 3. Spending limits -----------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.campaign_spend_limits (
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  campaign_id uuid NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  daily_max numeric(14,2) CHECK (daily_max IS NULL OR (daily_max > 0 AND daily_max < 1e12)),
  weekly_max numeric(14,2) CHECK (weekly_max IS NULL OR (weekly_max > 0 AND weekly_max < 1e12)),
  monthly_max numeric(14,2) CHECK (monthly_max IS NULL OR (monthly_max > 0 AND monthly_max < 1e12)),
  lifetime_max numeric(14,2) CHECK (lifetime_max IS NULL OR (lifetime_max > 0 AND lifetime_max < 1e12)),
  reserve_amount numeric(14,2) CHECK (reserve_amount IS NULL OR reserve_amount >= 0),
  alert_thresholds int[] NOT NULL DEFAULT '{50,80,90,100}' CHECK (cardinality(alert_thresholds) BETWEEN 0 AND 6 AND alert_thresholds <@ ARRAY[10,20,25,30,40,50,60,70,75,80,85,90,95,100]),
  emergency_stop boolean NOT NULL DEFAULT false,
  stop_reason text NOT NULL DEFAULT '' CHECK (length(stop_reason) <= 300),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, campaign_id),
  CHECK (reserve_amount IS NULL OR (lifetime_max IS NOT NULL AND reserve_amount < lifetime_max)),
  FOREIGN KEY (campaign_id, org_id, workspace_id) REFERENCES public.campaigns(id, org_id, workspace_id)
);
REVOKE ALL ON public.campaign_spend_limits FROM anon, authenticated;
GRANT SELECT ON public.campaign_spend_limits TO authenticated;
GRANT ALL ON public.campaign_spend_limits TO service_role;
ALTER TABLE public.campaign_spend_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "campaign limits readable by business" ON public.campaign_spend_limits;
CREATE POLICY "campaign limits readable by business" ON public.campaign_spend_limits
  FOR SELECT TO authenticated USING (public.has_workspace_role(workspace_id, 'viewer'));

CREATE TABLE IF NOT EXISTS public.campaign_spend_limit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  campaign_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('limits','stop_on','stop_off')),
  before jsonb,
  after jsonb NOT NULL,
  reason text NOT NULL DEFAULT '' CHECK (length(reason) <= 300),
  request_key uuid NOT NULL,
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, request_key),
  FOREIGN KEY (campaign_id, org_id, workspace_id) REFERENCES public.campaigns(id, org_id, workspace_id)
);
CREATE INDEX IF NOT EXISTS campaign_spend_limit_events_campaign ON public.campaign_spend_limit_events (workspace_id, campaign_id, created_at DESC);
REVOKE ALL ON public.campaign_spend_limit_events FROM anon, authenticated;
GRANT SELECT ON public.campaign_spend_limit_events TO authenticated;
GRANT ALL ON public.campaign_spend_limit_events TO service_role;
ALTER TABLE public.campaign_spend_limit_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "campaign limit history readable by business" ON public.campaign_spend_limit_events;
CREATE POLICY "campaign limit history readable by business" ON public.campaign_spend_limit_events
  FOR SELECT TO authenticated USING (public.has_workspace_role(workspace_id, 'viewer'));
DROP TRIGGER IF EXISTS campaign_spend_limit_events_immutable ON public.campaign_spend_limit_events;
CREATE TRIGGER campaign_spend_limit_events_immutable BEFORE UPDATE OR DELETE ON public.campaign_spend_limit_events
  FOR EACH ROW EXECUTE FUNCTION public.decision_history_immutable();

-- Editors set limits (with a reason, audit-logged). Members may only switch the emergency stop ON; switching it OFF
-- needs an editor. Same request key = same result (no duplicate history).
CREATE OR REPLACE FUNCTION public.set_campaign_spend_limits(_workspace uuid, _request uuid, _campaign uuid, _p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.campaigns; cur public.campaign_spend_limits; prior public.campaign_spend_limit_events;
  reason text := trim(coalesce(_p->>'reason','')); kind_ text; nxt jsonb; stop_ boolean; ccy text; th int[]; ev uuid;
  dmax numeric; wmax numeric; mmax numeric; lmax numeric; rsv numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  IF _request IS NULL OR jsonb_typeof(_p) IS DISTINCT FROM 'object'
     OR (_p - ARRAY['currency','daily_max','weekly_max','monthly_max','lifetime_max','reserve_amount','alert_thresholds','emergency_stop','reason']) <> '{}'::jsonb
     OR length(reason) > 300 THEN
    RAISE EXCEPTION 'invalid spending limits' USING ERRCODE = '22023';
  END IF;
  IF NOT public.has_workspace_role(_workspace, 'member') THEN RAISE EXCEPTION 'business not found' USING ERRCODE = '42501'; END IF;
  SELECT * INTO prior FROM public.campaign_spend_limit_events WHERE workspace_id = _workspace AND request_key = _request;
  IF prior.id IS NOT NULL THEN RETURN jsonb_build_object('id', prior.id, 'status', 'existing'); END IF;
  SELECT * INTO c FROM public.campaigns WHERE id = _campaign AND workspace_id = _workspace FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'campaign not found' USING ERRCODE = '22023'; END IF;
  SELECT * INTO cur FROM public.campaign_spend_limits WHERE workspace_id = _workspace AND campaign_id = c.id;
  IF reason = '' THEN RAISE EXCEPTION 'limit_reason_required' USING ERRCODE = '22023'; END IF;
  IF _p ? 'emergency_stop' AND (_p - ARRAY['emergency_stop','reason']) = '{}'::jsonb THEN
    stop_ := (_p->>'emergency_stop')::boolean;
    IF stop_ IS NULL THEN RAISE EXCEPTION 'invalid spending limits' USING ERRCODE = '22023'; END IF;
    IF NOT stop_ AND NOT public.has_workspace_role(_workspace, 'editor') THEN RAISE EXCEPTION 'limit_forbidden' USING ERRCODE = '42501'; END IF;
    kind_ := CASE WHEN stop_ THEN 'stop_on' ELSE 'stop_off' END;
    IF cur.campaign_id IS NULL THEN
      INSERT INTO public.campaign_spend_limits(org_id, workspace_id, campaign_id, currency, emergency_stop, stop_reason, updated_by)
      VALUES (c.org_id, c.workspace_id, c.id, 'EUR', stop_, CASE WHEN stop_ THEN reason ELSE '' END, auth.uid());
    ELSE
      UPDATE public.campaign_spend_limits SET emergency_stop = stop_, stop_reason = CASE WHEN stop_ THEN reason ELSE '' END,
        updated_by = auth.uid(), updated_at = now() WHERE workspace_id = _workspace AND campaign_id = c.id;
    END IF;
  ELSE
    IF NOT public.has_workspace_role(_workspace, 'editor') THEN RAISE EXCEPTION 'limit_forbidden' USING ERRCODE = '42501'; END IF;
    kind_ := 'limits';
    ccy := upper(trim(coalesce(_p->>'currency','')));
    IF ccy !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'invalid spending limits' USING ERRCODE = '22023'; END IF;
    BEGIN
      dmax := nullif(_p->>'daily_max','')::numeric; wmax := nullif(_p->>'weekly_max','')::numeric;
      mmax := nullif(_p->>'monthly_max','')::numeric; lmax := nullif(_p->>'lifetime_max','')::numeric;
      rsv := nullif(_p->>'reserve_amount','')::numeric;
      th := coalesce(ARRAY(SELECT DISTINCT x::int FROM jsonb_array_elements_text(coalesce(_p->'alert_thresholds','[50,80,90,100]'::jsonb)) x ORDER BY 1), '{}');
    EXCEPTION WHEN others THEN RAISE EXCEPTION 'invalid spending limits' USING ERRCODE = '22023'; END;
    -- Limits in another currency than recorded entries could never be compared without conversion.
    IF EXISTS (SELECT 1 FROM public.campaign_spend_entries WHERE campaign_id = c.id AND workspace_id = _workspace AND currency <> ccy) THEN
      RAISE EXCEPTION 'limit_currency_mismatch' USING ERRCODE = '22023';
    END IF;
    IF cur.campaign_id IS NULL THEN
      INSERT INTO public.campaign_spend_limits(org_id, workspace_id, campaign_id, currency, daily_max, weekly_max, monthly_max, lifetime_max, reserve_amount, alert_thresholds, updated_by)
      VALUES (c.org_id, c.workspace_id, c.id, ccy, dmax, wmax, mmax, lmax, rsv, th, auth.uid());
    ELSE
      UPDATE public.campaign_spend_limits SET currency = ccy, daily_max = dmax, weekly_max = wmax, monthly_max = mmax, lifetime_max = lmax,
        reserve_amount = rsv, alert_thresholds = th, updated_by = auth.uid(), updated_at = now()
      WHERE workspace_id = _workspace AND campaign_id = c.id;
    END IF;
  END IF;
  SELECT to_jsonb(l) - ARRAY['org_id','workspace_id','updated_by','updated_at'] INTO nxt FROM public.campaign_spend_limits l WHERE workspace_id = _workspace AND campaign_id = c.id;
  INSERT INTO public.campaign_spend_limit_events(org_id, workspace_id, campaign_id, kind, before, after, reason, request_key, actor_id)
  VALUES (c.org_id, c.workspace_id, c.id, kind_, CASE WHEN cur.campaign_id IS NULL THEN NULL ELSE to_jsonb(cur) - ARRAY['org_id','workspace_id','updated_by','updated_at'] END,
          nxt, reason, _request, auth.uid())
  RETURNING id INTO ev;
  PERFORM public.log_audit(c.org_id, 'campaign.limits_' || kind_, 'campaign', c.id::text, jsonb_build_object('event', ev, 'after', nxt));
  RETURN jsonb_build_object('id', ev, 'status', 'created', 'kind', kind_);
EXCEPTION WHEN check_violation THEN RAISE EXCEPTION 'invalid spending limits' USING ERRCODE = '22023';
END $$;
REVOKE ALL ON FUNCTION public.set_campaign_spend_limits(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_campaign_spend_limits(uuid, uuid, uuid, jsonb) TO authenticated;

-- Spending recorded against a campaign; now with hard limits. Exposure in a period = spending + open reservations of the
-- same data class and currency, each correction/release counted on the day of the entry it adjusts.
CREATE OR REPLACE FUNCTION public.record_campaign_spend(_workspace uuid, _request uuid, _campaign uuid, _p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w public.workspaces; c public.campaigns; prior public.campaign_spend_entries; rel public.campaign_spend_entries; lim public.campaign_spend_limits;
  k text := _p->>'kind'; amt numeric := (_p->>'amount')::numeric; cur text := upper(trim(coalesce(_p->>'currency','')));
  day date := (_p->>'occurred_on')::date; cls text := coalesce(_p->>'data_class','manual'); ref text := trim(coalesce(_p->>'source_ref',''));
  rel_id uuid := nullif(_p->>'relates_to','')::uuid; remaining numeric; id_ uuid; tz text; local_today date;
  pday date; used_d numeric; used_w numeric; used_m numeric; used_l numeric; hit text; hit_max numeric; hit_used numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  SELECT * INTO w FROM public.workspaces WHERE id = _workspace;
  IF w.id IS NULL OR NOT public.has_workspace_role(w.id, 'member') THEN RAISE EXCEPTION 'business not found' USING ERRCODE = '42501'; END IF;
  IF _request IS NULL OR jsonb_typeof(_p) IS DISTINCT FROM 'object'
     OR (_p - ARRAY['kind','amount','currency','occurred_on','data_class','source_ref','relates_to','note']) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'invalid spend entry' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO prior FROM public.campaign_spend_entries WHERE workspace_id = w.id AND request_key = _request;
  IF prior.id IS NOT NULL THEN RETURN jsonb_build_object('id', prior.id, 'status', 'existing'); END IF;
  SELECT * INTO c FROM public.campaigns WHERE id = _campaign AND workspace_id = w.id FOR UPDATE;  -- serialise per campaign
  IF c.id IS NULL THEN RAISE EXCEPTION 'campaign not found' USING ERRCODE = '22023'; END IF;
  SELECT coalesce((SELECT timezone FROM public.execution_settings WHERE workspace_id = w.id), 'Europe/Brussels') INTO tz;
  local_today := (now() AT TIME ZONE tz)::date;
  IF k NOT IN ('spend','commitment','release','correction') OR amt IS NULL OR amt = 0 OR cur !~ '^[A-Z]{3}$' OR day IS NULL
     OR cls NOT IN ('manual','simulated') OR length(ref) > 120 OR length(coalesce(_p->>'note','')) > 300
     OR (k IN ('spend','correction') AND day > local_today) THEN
    RAISE EXCEPTION 'invalid spend entry' USING ERRCODE = '22023';
  END IF;
  IF k IN ('spend','commitment') AND (amt < 0 OR rel_id IS NOT NULL) THEN RAISE EXCEPTION 'invalid spend entry' USING ERRCODE = '22023'; END IF;
  IF k IN ('release','correction') THEN
    SELECT * INTO rel FROM public.campaign_spend_entries WHERE id = rel_id AND campaign_id = c.id AND workspace_id = w.id;
    IF rel.id IS NULL OR (k = 'release' AND rel.kind <> 'commitment') OR (k = 'correction' AND rel.kind <> 'spend') OR rel.currency <> cur THEN
      RAISE EXCEPTION 'invalid related entry' USING ERRCODE = '22023';
    END IF;
    SELECT rel.amount + coalesce(sum(amount), 0) INTO remaining FROM public.campaign_spend_entries WHERE relates_to = rel.id;
    IF (k = 'release' AND amt > 0) OR remaining + amt < 0 THEN RAISE EXCEPTION 'spend_below_zero' USING ERRCODE = 'P0001'; END IF;
  END IF;
  IF ref <> '' AND EXISTS (SELECT 1 FROM public.campaign_spend_entries WHERE workspace_id = w.id AND data_class = cls AND kind = k AND source_ref = ref) THEN
    RAISE EXCEPTION 'spend_duplicate_reference' USING ERRCODE = 'P0001';
  END IF;
  -- Hard limits: only entries that add exposure are checked; releases and downward corrections always pass.
  IF amt > 0 THEN
    SELECT * INTO lim FROM public.campaign_spend_limits WHERE workspace_id = w.id AND campaign_id = c.id;
    IF lim.campaign_id IS NOT NULL THEN
      IF lim.emergency_stop THEN hit := 'emergency_stop';
      ELSIF (lim.daily_max IS NOT NULL OR lim.weekly_max IS NOT NULL OR lim.monthly_max IS NOT NULL OR lim.lifetime_max IS NOT NULL) AND lim.currency <> cur THEN
        hit := 'currency';
      ELSE
        pday := CASE WHEN k IN ('release','correction') THEN rel.occurred_on ELSE day END;
        SELECT coalesce(sum(s.amount) FILTER (WHERE coalesce(r.occurred_on, s.occurred_on) = pday), 0),
               coalesce(sum(s.amount) FILTER (WHERE date_trunc('week', coalesce(r.occurred_on, s.occurred_on)) = date_trunc('week', pday)), 0),
               coalesce(sum(s.amount) FILTER (WHERE date_trunc('month', coalesce(r.occurred_on, s.occurred_on)) = date_trunc('month', pday)), 0),
               coalesce(sum(s.amount), 0)
          INTO used_d, used_w, used_m, used_l
          FROM public.campaign_spend_entries s LEFT JOIN public.campaign_spend_entries r ON r.id = s.relates_to
         WHERE s.campaign_id = c.id AND s.workspace_id = w.id AND s.data_class = cls AND s.currency = cur;
        IF lim.daily_max IS NOT NULL AND used_d + amt > lim.daily_max THEN hit := 'daily'; hit_max := lim.daily_max; hit_used := used_d;
        ELSIF lim.weekly_max IS NOT NULL AND used_w + amt > lim.weekly_max THEN hit := 'weekly'; hit_max := lim.weekly_max; hit_used := used_w;
        ELSIF lim.monthly_max IS NOT NULL AND used_m + amt > lim.monthly_max THEN hit := 'monthly'; hit_max := lim.monthly_max; hit_used := used_m;
        ELSIF lim.lifetime_max IS NOT NULL AND used_l + amt > lim.lifetime_max - coalesce(lim.reserve_amount, 0) THEN
          hit := 'lifetime'; hit_max := lim.lifetime_max - coalesce(lim.reserve_amount, 0); hit_used := used_l;
        END IF;
      END IF;
      IF hit IS NOT NULL THEN
        PERFORM public.log_audit(w.org_id, 'campaign.spend_blocked', 'campaign', c.id::text,
          jsonb_build_object('limit', hit, 'kind', k, 'amount', round(amt, 2), 'currency', cur, 'class', cls, 'limit_amount', hit_max, 'used', hit_used));
        RETURN jsonb_build_object('status', 'blocked', 'limit', hit, 'limit_amount', hit_max, 'used', hit_used, 'currency', lim.currency);
      END IF;
    END IF;
  END IF;
  INSERT INTO public.campaign_spend_entries(org_id, workspace_id, campaign_id, kind, amount, currency, occurred_on, data_class, source_ref, relates_to, note, request_key)
  VALUES (w.org_id, w.id, c.id, k, round(amt, 2), cur, day, cls, ref, rel_id, coalesce(_p->>'note',''), _request)
  RETURNING id INTO id_;
  PERFORM public.log_audit(w.org_id, 'campaign.spend_recorded', 'campaign', c.id::text,
    jsonb_build_object('entry', id_, 'kind', k, 'amount', round(amt, 2), 'currency', cur, 'class', cls));
  RETURN jsonb_build_object('id', id_, 'status', 'created');
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'invalid spend entry' USING ERRCODE = '22023';
END $$;
REVOKE ALL ON FUNCTION public.record_campaign_spend(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_campaign_spend(uuid, uuid, uuid, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.campaign_transition_allowed(text, text), public.campaign_transition_role(text, text), public.campaign_transition_needs_reason(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.campaign_transition_allowed(text, text), public.campaign_transition_role(text, text), public.campaign_transition_needs_reason(text, text) TO authenticated;
