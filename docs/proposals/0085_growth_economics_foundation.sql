-- PROPOSED migration 0085 (staging only until approved): growth economics foundation.
-- Extends the existing ledgers instead of adding competing ones:
--   * campaign spending keeps one ledger (campaign_spend_entries) and gains a cost category, so production, agency and
--     software costs of a campaign are classified without a second campaign ledger;
--   * business-level costs that belong to no campaign (cost of goods/services, software, agency retainers, other
--     operating costs, marketing not tied to a campaign) go to one insert-only business cost ledger. It cannot name a
--     campaign, so a campaign cost can never be counted twice; it may name an initiative or a sale (per-sale cost);
--   * AI execution is never recorded by hand: its cost is credits x the credit price valid at the time of use;
--   * cost models (per sale, per period, estimated margin, none) are versioned per business, because a consultancy,
--     a SaaS company and a shop cannot share one cost formula;
--   * credit prices are insert-only versions set by the Platform Owner, never back-dated, so old costs never change;
--   * recommendation learnings are insert-only and record what was expected and what happened; the database fills in
--     the credits actually charged and the time to result, and refuses a positive or negative learning without a
--     recorded measurement.
-- Also hardens decide_budget_change: an invalid request is marked failed instead of staying pending.
-- Idempotent: IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS only.

-- 1. Budget change decisions never leave a request pending because of an invalid stored request.
CREATE OR REPLACE FUNCTION public.decide_budget_change(_id uuid, _approve boolean, _note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.budget_change_requests; res jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM public.budget_change_requests WHERE id = _id FOR UPDATE;
  IF r.id IS NULL OR NOT public.has_workspace_role(r.workspace_id, 'editor') THEN RAISE EXCEPTION 'only editors decide budget changes' USING ERRCODE = '42501'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'request already decided' USING ERRCODE = '22023'; END IF;
  IF NOT _approve THEN
    IF length(trim(coalesce(_note,''))) < 3 THEN RAISE EXCEPTION 'a reason is required to reject' USING ERRCODE = '22023'; END IF;
    UPDATE public.budget_change_requests SET status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = trim(_note) WHERE id = r.id;
    PERFORM public.log_audit(r.org_id, 'budget.change_rejected', 'budget_line', r.budget_line_id::text, jsonb_build_object('workspace_id', r.workspace_id, 'request', r.id));
    RETURN jsonb_build_object('status', 'rejected');
  END IF;
  BEGIN
    res := public.apply_budget_allocation(r.workspace_id, r.kind, r.budget_line_id, r.campaign_id, r.to_campaign_id, r.amount, r.seen_amount,
      r.reason, r.request_key, auth.uid(), r.id);
  EXCEPTION
    WHEN SQLSTATE '40001' THEN res := jsonb_build_object('status', 'rejected', 'code', 'stale');
    WHEN SQLSTATE '22023' THEN res := jsonb_build_object('status', 'rejected', 'code', 'invalid_request');
  END;
  UPDATE public.budget_change_requests SET status = CASE WHEN res->>'status' IN ('applied','existing') THEN 'applied' ELSE 'failed' END,
    result = res, decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(coalesce(_note,'')), '') WHERE id = r.id;
  PERFORM public.log_audit(r.org_id, 'budget.change_decided', 'budget_line', r.budget_line_id::text,
    jsonb_build_object('workspace_id', r.workspace_id, 'request', r.id, 'result', res->>'status', 'code', res->>'code'));
  RETURN res;
END $$;
REVOKE ALL ON FUNCTION public.decide_budget_change(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_budget_change(uuid, boolean, text) TO authenticated;

-- 2. Campaign spending gets a cost category (existing rows are marketing spend).
ALTER TABLE public.campaign_spend_entries ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'marketing';
ALTER TABLE public.campaign_spend_entries DROP CONSTRAINT IF EXISTS campaign_spend_entries_category_check;
ALTER TABLE public.campaign_spend_entries ADD CONSTRAINT campaign_spend_entries_category_check
  CHECK (category IN ('marketing','production','agency','software','other'));

CREATE OR REPLACE FUNCTION public.record_campaign_spend(_workspace uuid, _request uuid, _campaign uuid, _p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w public.workspaces; c public.campaigns; prior public.campaign_spend_entries; rel public.campaign_spend_entries; lim public.campaign_spend_limits;
  k text := _p->>'kind'; amt numeric := (_p->>'amount')::numeric; cur text := upper(trim(coalesce(_p->>'currency','')));
  day date := (_p->>'occurred_on')::date; cls text := coalesce(_p->>'data_class','manual'); ref text := trim(coalesce(_p->>'source_ref',''));
  rel_id uuid := nullif(_p->>'relates_to','')::uuid; remaining numeric; id_ uuid; tz text; local_today date;
  line_id uuid := nullif(_p->>'budget_line_id','')::uuid; l public.budget_lines; al numeric; lexp numeric;
  cat text := nullif(_p->>'category','');
  pday date; used_d numeric; used_w numeric; used_m numeric; used_l numeric; hit text; hit_max numeric; hit_used numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  SELECT * INTO w FROM public.workspaces WHERE id = _workspace;
  IF w.id IS NULL OR NOT public.has_workspace_role(w.id, 'member') THEN RAISE EXCEPTION 'business not found' USING ERRCODE = '42501'; END IF;
  IF _request IS NULL OR jsonb_typeof(_p) IS DISTINCT FROM 'object'
     OR (_p - ARRAY['kind','amount','currency','occurred_on','data_class','source_ref','relates_to','note','budget_line_id','category']) <> '{}'::jsonb THEN
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
     OR (cat IS NOT NULL AND cat NOT IN ('marketing','production','agency','software','other'))
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
    -- releases and corrections stay on the budget line and in the category of the entry they adjust
    IF (line_id IS NOT NULL AND line_id IS DISTINCT FROM rel.budget_line_id) OR (cat IS NOT NULL AND cat <> rel.category) THEN
      RAISE EXCEPTION 'invalid related entry' USING ERRCODE = '22023';
    END IF;
    line_id := rel.budget_line_id; cat := rel.category;
  ELSIF line_id IS NOT NULL THEN
    SELECT * INTO l FROM public.budget_lines WHERE id = line_id AND workspace_id = w.id;
    IF l.id IS NULL OR l.currency <> cur OR date_trunc('month', day)::date <> l.period_month THEN
      RAISE EXCEPTION 'spend_line_mismatch' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  cat := coalesce(cat, 'marketing');
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
  -- Entries paid from a budget line must fit the campaign's allocation on that line (actual and simulated each in their own room).
  IF amt > 0 AND line_id IS NOT NULL THEN
    SELECT coalesce((SELECT amount FROM public.campaign_budget_allocations WHERE budget_line_id = line_id AND campaign_id = c.id AND status = 'active'), 0) INTO al;
    lexp := public.campaign_line_exposure(c.id, line_id, cls);
    IF lexp + amt > al THEN
      SELECT currency INTO cur FROM public.budget_lines WHERE id = line_id;
      PERFORM public.log_audit(w.org_id, 'campaign.spend_blocked', 'campaign', c.id::text,
        jsonb_build_object('limit', 'allocation', 'line', line_id, 'kind', k, 'amount', round(amt, 2), 'currency', cur, 'class', cls, 'limit_amount', al, 'used', lexp));
      RETURN jsonb_build_object('status', 'blocked', 'limit', 'allocation', 'limit_amount', al, 'used', lexp, 'currency', cur);
    END IF;
  END IF;
  INSERT INTO public.campaign_spend_entries(org_id, workspace_id, campaign_id, kind, amount, currency, occurred_on, data_class, source_ref, relates_to, note, request_key, budget_line_id, category)
  VALUES (w.org_id, w.id, c.id, k, round(amt, 2), cur, day, cls, ref, rel_id, coalesce(_p->>'note',''), _request, line_id, cat)
  RETURNING id INTO id_;
  PERFORM public.log_audit(w.org_id, 'campaign.spend_recorded', 'campaign', c.id::text,
    jsonb_build_object('entry', id_, 'kind', k, 'amount', round(amt, 2), 'currency', cur, 'class', cls, 'line', line_id, 'category', cat));
  RETURN jsonb_build_object('id', id_, 'status', 'created');
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'invalid spend entry' USING ERRCODE = '22023';
END $$;
REVOKE ALL ON FUNCTION public.record_campaign_spend(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_campaign_spend(uuid, uuid, uuid, jsonb) TO authenticated;

-- 3. Business-level costs (never campaign costs): one insert-only ledger with linked corrections.
CREATE TABLE IF NOT EXISTS public.business_cost_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  category text NOT NULL CHECK (category IN ('cogs','software','agency','marketing','other_operating')),
  kind text NOT NULL CHECK (kind IN ('cost','correction')),
  amount numeric(14,2) NOT NULL CHECK (amount <> 0 AND abs(amount) < 1e12),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  period_start date NOT NULL,
  period_end date NOT NULL,
  data_class text NOT NULL CHECK (data_class IN ('manual','estimated','simulated','imported')),
  initiative_id uuid,
  revenue_event_id uuid REFERENCES public.revenue_events(id),
  relates_to uuid REFERENCES public.business_cost_entries(id),
  source_ref text NOT NULL DEFAULT '' CHECK (length(source_ref) <= 120),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 300),
  request_key uuid NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, request_key),
  CHECK (period_end >= period_start AND period_end - period_start <= 366),
  CHECK ((kind = 'cost' AND amount > 0 AND relates_to IS NULL) OR (kind = 'correction' AND relates_to IS NOT NULL)),
  FOREIGN KEY (initiative_id, org_id, workspace_id) REFERENCES public.growth_initiatives(id, org_id, workspace_id)
);
CREATE INDEX IF NOT EXISTS business_cost_entries_ws_idx ON public.business_cost_entries(workspace_id, period_start);
REVOKE ALL ON public.business_cost_entries FROM anon, authenticated;
GRANT SELECT ON public.business_cost_entries TO authenticated;
GRANT ALL ON public.business_cost_entries TO service_role;
ALTER TABLE public.business_cost_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "business costs readable by business" ON public.business_cost_entries;
CREATE POLICY "business costs readable by business" ON public.business_cost_entries FOR SELECT TO authenticated
  USING (public.has_workspace_role(workspace_id, 'viewer'));
CREATE OR REPLACE FUNCTION public.economics_history_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'economics history is insert-only' USING ERRCODE = '42501'; END $$;
DROP TRIGGER IF EXISTS business_cost_entries_immutable ON public.business_cost_entries;
CREATE TRIGGER business_cost_entries_immutable BEFORE UPDATE OR DELETE ON public.business_cost_entries
  FOR EACH ROW EXECUTE FUNCTION public.economics_history_immutable();

-- _p: category, kind, amount, currency, period_start, period_end, data_class, initiative_id, revenue_event_id, relates_to, source_ref, note
CREATE OR REPLACE FUNCTION public.record_business_cost(_workspace uuid, _request uuid, _p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w public.workspaces; prior public.business_cost_entries; rel public.business_cost_entries; rv public.revenue_events;
  k text := coalesce(_p->>'kind','cost'); cat text := _p->>'category'; amt numeric := (_p->>'amount')::numeric;
  cur text := upper(trim(coalesce(_p->>'currency',''))); ps date := (_p->>'period_start')::date; pe date := (_p->>'period_end')::date;
  cls text := coalesce(_p->>'data_class','manual'); ref text := trim(coalesce(_p->>'source_ref',''));
  ini uuid := nullif(_p->>'initiative_id','')::uuid; rev uuid := nullif(_p->>'revenue_event_id','')::uuid; rel_id uuid := nullif(_p->>'relates_to','')::uuid;
  remaining numeric; id_ uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  SELECT * INTO w FROM public.workspaces WHERE id = _workspace;
  IF w.id IS NULL OR NOT public.has_workspace_role(w.id, 'member') THEN RAISE EXCEPTION 'business not found' USING ERRCODE = '42501'; END IF;
  IF _request IS NULL OR jsonb_typeof(_p) IS DISTINCT FROM 'object'
     OR (_p - ARRAY['category','kind','amount','currency','period_start','period_end','data_class','initiative_id','revenue_event_id','relates_to','source_ref','note']) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'invalid cost entry' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO prior FROM public.business_cost_entries WHERE workspace_id = w.id AND request_key = _request;
  IF prior.id IS NOT NULL THEN RETURN jsonb_build_object('id', prior.id, 'status', 'existing'); END IF;
  -- imported costs only arrive through a verified connector import (none is enabled); AI costs come from credits
  IF k NOT IN ('cost','correction') OR amt IS NULL OR amt = 0 OR cur !~ '^[A-Z]{3}$' OR ps IS NULL OR pe IS NULL OR pe < ps OR pe - ps > 366
     OR cls NOT IN ('manual','estimated','simulated') OR length(ref) > 120 OR length(coalesce(_p->>'note','')) > 300
     OR (k = 'cost' AND (amt < 0 OR rel_id IS NOT NULL)) OR (k = 'correction' AND rel_id IS NULL) THEN
    RAISE EXCEPTION 'invalid cost entry' USING ERRCODE = '22023';
  END IF;
  IF k = 'correction' THEN
    SELECT * INTO rel FROM public.business_cost_entries WHERE id = rel_id AND workspace_id = w.id FOR UPDATE;
    IF rel.id IS NULL OR rel.kind <> 'cost' OR rel.currency <> cur THEN RAISE EXCEPTION 'invalid related entry' USING ERRCODE = '22023'; END IF;
    SELECT rel.amount + coalesce(sum(amount), 0) INTO remaining FROM public.business_cost_entries WHERE relates_to = rel.id;
    IF remaining + amt < 0 THEN RAISE EXCEPTION 'cost_below_zero' USING ERRCODE = 'P0001'; END IF;
    -- a correction keeps the classification of the cost it corrects
    cat := rel.category; cls := rel.data_class; ps := rel.period_start; pe := rel.period_end; ini := rel.initiative_id; rev := rel.revenue_event_id;
  ELSE
    IF cat IS NULL OR cat NOT IN ('cogs','software','agency','marketing','other_operating') THEN
      RAISE EXCEPTION 'invalid cost entry' USING ERRCODE = '22023';
    END IF;
    IF ini IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.growth_initiatives WHERE id = ini AND workspace_id = w.id) THEN
      RAISE EXCEPTION 'initiative not found' USING ERRCODE = '22023';
    END IF;
    IF rev IS NOT NULL THEN
      SELECT * INTO rv FROM public.revenue_events WHERE id = rev AND workspace_id = w.id;
      IF rv.id IS NULL OR rv.kind <> 'sale' OR cat <> 'cogs' OR rv.currency <> cur THEN RAISE EXCEPTION 'cost_sale_mismatch' USING ERRCODE = 'P0001'; END IF;
    END IF;
  END IF;
  IF ref <> '' AND EXISTS (SELECT 1 FROM public.business_cost_entries WHERE workspace_id = w.id AND data_class = cls AND kind = k AND source_ref = ref) THEN
    RAISE EXCEPTION 'cost_duplicate_reference' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.business_cost_entries(org_id, workspace_id, category, kind, amount, currency, period_start, period_end, data_class,
    initiative_id, revenue_event_id, relates_to, source_ref, note, request_key, created_by)
  VALUES (w.org_id, w.id, cat, k, round(amt, 2), cur, ps, pe, cls, ini, rev, rel_id, ref, coalesce(_p->>'note',''), _request, auth.uid())
  RETURNING id INTO id_;
  PERFORM public.log_audit(w.org_id, 'business.cost_recorded', 'business_cost', id_::text,
    jsonb_build_object('workspace_id', w.id, 'kind', k, 'category', cat, 'amount', round(amt, 2), 'currency', cur, 'class', cls));
  RETURN jsonb_build_object('id', id_, 'status', 'created');
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'invalid cost entry' USING ERRCODE = '22023';
END $$;
REVOKE ALL ON FUNCTION public.record_business_cost(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_business_cost(uuid, uuid, jsonb) TO authenticated;

-- 4. Cost models per business, versioned (the latest version effective on a date applies to that date).
CREATE TABLE IF NOT EXISTS public.business_cost_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  model text NOT NULL CHECK (model IN ('per_sale','per_period','margin_estimate','none')),
  margin_rate numeric(5,4) CHECK (margin_rate IS NULL OR (margin_rate >= 0 AND margin_rate <= 1)),
  effective_from date NOT NULL,
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 300),
  request_key uuid NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, request_key),
  CHECK ((model = 'margin_estimate') = (margin_rate IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS business_cost_models_ws_idx ON public.business_cost_models(workspace_id, effective_from);
REVOKE ALL ON public.business_cost_models FROM anon, authenticated;
GRANT SELECT ON public.business_cost_models TO authenticated;
GRANT ALL ON public.business_cost_models TO service_role;
ALTER TABLE public.business_cost_models ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cost models readable by business" ON public.business_cost_models;
CREATE POLICY "cost models readable by business" ON public.business_cost_models FOR SELECT TO authenticated
  USING (public.has_workspace_role(workspace_id, 'viewer'));
DROP TRIGGER IF EXISTS business_cost_models_immutable ON public.business_cost_models;
CREATE TRIGGER business_cost_models_immutable BEFORE UPDATE OR DELETE ON public.business_cost_models
  FOR EACH ROW EXECUTE FUNCTION public.economics_history_immutable();

CREATE OR REPLACE FUNCTION public.set_cost_model(_workspace uuid, _request uuid, _model text, _margin_rate numeric, _effective_from date, _note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w public.workspaces; prior public.business_cost_models; id_ uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  SELECT * INTO w FROM public.workspaces WHERE id = _workspace;
  IF w.id IS NULL OR NOT public.has_workspace_role(w.id, 'editor') THEN RAISE EXCEPTION 'only editors set the cost model' USING ERRCODE = '42501'; END IF;
  SELECT * INTO prior FROM public.business_cost_models WHERE workspace_id = w.id AND request_key = _request;
  IF prior.id IS NOT NULL THEN RETURN jsonb_build_object('id', prior.id, 'status', 'existing'); END IF;
  IF _request IS NULL OR _model NOT IN ('per_sale','per_period','margin_estimate','none') OR _effective_from IS NULL
     OR ((_model = 'margin_estimate') <> (_margin_rate IS NOT NULL)) OR (_margin_rate IS NOT NULL AND (_margin_rate < 0 OR _margin_rate > 1))
     OR length(coalesce(_note,'')) > 300 THEN
    RAISE EXCEPTION 'invalid cost model' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.business_cost_models(org_id, workspace_id, model, margin_rate, effective_from, note, request_key, created_by)
  VALUES (w.org_id, w.id, _model, _margin_rate, _effective_from, coalesce(trim(_note),''), _request, auth.uid()) RETURNING id INTO id_;
  PERFORM public.log_audit(w.org_id, 'business.cost_model_set', 'workspace', w.id::text,
    jsonb_build_object('model', _model, 'margin_rate', _margin_rate, 'effective_from', _effective_from));
  RETURN jsonb_build_object('id', id_, 'status', 'created');
END $$;
REVOKE ALL ON FUNCTION public.set_cost_model(uuid, uuid, text, numeric, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_cost_model(uuid, uuid, text, numeric, date, text) TO authenticated;

-- 5. Credit prices: insert-only versions, never back-dated, set by the Platform Owner only.
CREATE TABLE IF NOT EXISTS public.credit_price_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('platform','plan')),
  plan_key text REFERENCES public.plans(key),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  price_per_credit numeric(12,6) NOT NULL CHECK (price_per_credit > 0 AND price_per_credit < 1000),
  effective_from timestamptz NOT NULL,
  methodology text NOT NULL CHECK (length(trim(methodology)) BETWEEN 3 AND 500),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'plan') = (plan_key IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS credit_price_versions_unique ON public.credit_price_versions(scope, coalesce(plan_key, ''), currency, effective_from);
REVOKE ALL ON public.credit_price_versions FROM anon, authenticated;
GRANT SELECT ON public.credit_price_versions TO authenticated;
GRANT ALL ON public.credit_price_versions TO service_role;
ALTER TABLE public.credit_price_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "credit prices readable when signed in" ON public.credit_price_versions;
CREATE POLICY "credit prices readable when signed in" ON public.credit_price_versions FOR SELECT TO authenticated USING (true);
DROP TRIGGER IF EXISTS credit_price_versions_immutable ON public.credit_price_versions;
CREATE TRIGGER credit_price_versions_immutable BEFORE UPDATE OR DELETE ON public.credit_price_versions
  FOR EACH ROW EXECUTE FUNCTION public.economics_history_immutable();

CREATE OR REPLACE FUNCTION public.set_credit_price(_scope text, _plan text, _currency text, _price numeric, _effective_from timestamptz, _methodology text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE id_ uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_platform_role('platform_owner') THEN RAISE EXCEPTION 'only the Platform Owner sets credit prices' USING ERRCODE = '42501'; END IF;
  IF _scope NOT IN ('platform','plan') OR ((_scope = 'plan') <> (_plan IS NOT NULL)) OR upper(coalesce(_currency,'')) !~ '^[A-Z]{3}$'
     OR _price IS NULL OR _price <= 0 OR _price >= 1000 OR length(trim(coalesce(_methodology,''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'invalid credit price' USING ERRCODE = '22023';
  END IF;
  -- never back-dated: an existing usage keeps the price that applied when it happened
  IF _effective_from IS NULL OR _effective_from < now() - interval '5 minutes' THEN RAISE EXCEPTION 'credit_price_backdated' USING ERRCODE = 'P0001'; END IF;
  IF _plan IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.plans WHERE key = _plan) THEN RAISE EXCEPTION 'invalid credit price' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.credit_price_versions(scope, plan_key, currency, price_per_credit, effective_from, methodology, created_by)
  VALUES (_scope, _plan, upper(_currency), _price, _effective_from, trim(_methodology), auth.uid()) RETURNING id INTO id_;
  PERFORM public.log_audit(NULL, 'platform.credit_price_set', 'credit_price', id_::text,
    jsonb_build_object('scope', _scope, 'plan', _plan, 'currency', upper(_currency), 'price', _price, 'effective_from', _effective_from));
  RETURN id_;
END $$;
REVOKE ALL ON FUNCTION public.set_credit_price(text, text, text, numeric, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_credit_price(text, text, text, numeric, timestamptz, text) TO authenticated;

-- 6. Recommendation learnings: what was expected, what happened, insert-only.
CREATE TABLE IF NOT EXISTS public.recommendation_learnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  proposal_id uuid NOT NULL REFERENCES public.optimization_proposals(id),
  outcome_class text NOT NULL CHECK (outcome_class IN ('positive','negative','no_change','inconclusive','insufficient_data','not_executed','partially_executed','measurement_unavailable')),
  evidence_class text NOT NULL CHECK (evidence_class IN ('actual','estimated','simulated')),
  lever text NOT NULL DEFAULT '' CHECK (lever = '' OR lever ~ '^[a-z_]{2,60}$'),
  channel text NOT NULL DEFAULT '' CHECK (length(channel) <= 80),
  business_model text NOT NULL DEFAULT '' CHECK (length(business_model) <= 120),
  measured_change_pct numeric(9,2) CHECK (measured_change_pct IS NULL OR abs(measured_change_pct) < 1e6),
  expected_impact text NOT NULL DEFAULT '',
  expected_cost numeric(14,2),
  actual_cost numeric(14,2) CHECK (actual_cost IS NULL OR actual_cost >= 0),
  currency text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  expected_credits integer,
  actual_credits integer NOT NULL DEFAULT 0,
  uncertain_runs integer NOT NULL DEFAULT 0,
  days_to_result integer,
  task_status text NOT NULL DEFAULT '',
  execution_quality text NOT NULL CHECK (execution_quality IN ('good','acceptable','poor','unknown')),
  lesson text NOT NULL CHECK (length(trim(lesson)) BETWEEN 3 AND 800),
  request_key uuid NOT NULL,
  recorded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, request_key)
);
CREATE INDEX IF NOT EXISTS recommendation_learnings_ws_idx ON public.recommendation_learnings(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS recommendation_learnings_proposal_idx ON public.recommendation_learnings(proposal_id);
REVOKE ALL ON public.recommendation_learnings FROM anon, authenticated;
GRANT SELECT ON public.recommendation_learnings TO authenticated;
GRANT ALL ON public.recommendation_learnings TO service_role;
ALTER TABLE public.recommendation_learnings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "learnings readable by business" ON public.recommendation_learnings;
CREATE POLICY "learnings readable by business" ON public.recommendation_learnings FOR SELECT TO authenticated
  USING (public.has_workspace_role(workspace_id, 'viewer'));
DROP TRIGGER IF EXISTS recommendation_learnings_immutable ON public.recommendation_learnings;
CREATE TRIGGER recommendation_learnings_immutable BEFORE UPDATE OR DELETE ON public.recommendation_learnings
  FOR EACH ROW EXECUTE FUNCTION public.economics_history_immutable();

-- _p: outcome_class, evidence_class, lever, channel, measured_change_pct, actual_cost, execution_quality, lesson
CREATE OR REPLACE FUNCTION public.record_recommendation_learning(_proposal uuid, _request uuid, _p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.optimization_proposals; prior public.recommendation_learnings; ts text := ''; cr integer := 0; unc integer := 0;
  oc text := _p->>'outcome_class'; ev text := coalesce(_p->>'evidence_class','actual'); bm text := ''; ch text := trim(coalesce(_p->>'channel',''));
  chg numeric := (_p->>'measured_change_pct')::numeric; ac numeric := (_p->>'actual_cost')::numeric; days_ integer; id_ uuid; allowed text[];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM public.optimization_proposals WHERE id = _proposal;
  IF p.id IS NULL OR NOT public.has_workspace_role(p.workspace_id, 'editor') THEN RAISE EXCEPTION 'only editors record learnings' USING ERRCODE = '42501'; END IF;
  IF _request IS NULL OR jsonb_typeof(_p) IS DISTINCT FROM 'object'
     OR (_p - ARRAY['outcome_class','evidence_class','lever','channel','measured_change_pct','actual_cost','execution_quality','lesson']) <> '{}'::jsonb THEN
    RAISE EXCEPTION 'invalid learning' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO prior FROM public.recommendation_learnings WHERE workspace_id = p.workspace_id AND request_key = _request;
  IF prior.id IS NOT NULL THEN RETURN jsonb_build_object('id', prior.id, 'status', 'existing'); END IF;
  IF p.status NOT IN ('converted','measured') THEN RAISE EXCEPTION 'learning_needs_work' USING ERRCODE = 'P0001'; END IF;
  -- a positive, negative or no-change learning requires the recorded measurement that says so
  allowed := CASE
    WHEN p.status = 'measured' AND p.outcome = 'improved' THEN ARRAY['positive','partially_executed']
    WHEN p.status = 'measured' AND p.outcome = 'worse' THEN ARRAY['negative','partially_executed']
    WHEN p.status = 'measured' AND p.outcome = 'no_change' THEN ARRAY['no_change','partially_executed']
    WHEN p.status = 'measured' THEN ARRAY['inconclusive','insufficient_data','measurement_unavailable','partially_executed']
    ELSE ARRAY['not_executed','partially_executed','insufficient_data','measurement_unavailable'] END;
  IF oc IS NULL OR NOT (oc = ANY (allowed)) THEN RAISE EXCEPTION 'learning_outcome_not_measured' USING ERRCODE = 'P0001'; END IF;
  IF ev NOT IN ('actual','estimated','simulated') OR coalesce(_p->>'execution_quality','') NOT IN ('good','acceptable','poor','unknown')
     OR length(trim(coalesce(_p->>'lesson',''))) NOT BETWEEN 3 AND 800 OR length(ch) > 80
     OR (coalesce(_p->>'lever','') <> '' AND (_p->>'lever') !~ '^[a-z_]{2,60}$')
     OR (chg IS NOT NULL AND abs(chg) >= 1e6) OR (ac IS NOT NULL AND (ac < 0 OR p.currency IS NULL)) THEN
    RAISE EXCEPTION 'invalid learning' USING ERRCODE = '22023';
  END IF;
  -- facts filled in by the database: task status, credits actually charged (runs and their reviews), time to result
  IF p.task_id IS NOT NULL THEN
    SELECT status INTO ts FROM public.tasks WHERE id = p.task_id;
    SELECT coalesce(sum(credits_charged), 0), count(*) FILTER (WHERE status = 'uncertain') INTO cr, unc FROM public.task_runs WHERE task_id = p.task_id;
    cr := cr + coalesce((SELECT sum(r.credits) FROM public.specialist_reviews r JOIN public.task_runs t ON t.id = r.task_run_id WHERE t.task_id = p.task_id), 0);
  END IF;
  days_ := CASE WHEN p.measured_at IS NOT NULL AND p.decided_at IS NOT NULL THEN (p.measured_at::date - p.decided_at::date) END;
  SELECT coalesce(business_model, '') INTO bm FROM public.business_profiles WHERE workspace_id = p.workspace_id;
  IF ch = '' AND p.campaign_id IS NOT NULL THEN SELECT coalesce(channels[1], '') INTO ch FROM public.campaigns WHERE id = p.campaign_id; END IF;
  INSERT INTO public.recommendation_learnings(org_id, workspace_id, proposal_id, outcome_class, evidence_class, lever, channel, business_model,
    measured_change_pct, expected_impact, expected_cost, actual_cost, currency, expected_credits, actual_credits, uncertain_runs, days_to_result,
    task_status, execution_quality, lesson, request_key, recorded_by)
  VALUES (p.org_id, p.workspace_id, p.id, oc, ev, coalesce(_p->>'lever',''), left(ch, 80), left(coalesce(bm,''), 120),
    CASE WHEN p.status = 'measured' THEN round(chg, 2) END, p.expected_impact, p.est_cost, round(ac, 2), p.currency, p.est_credits, cr, unc, days_,
    coalesce(ts,''), _p->>'execution_quality', trim(_p->>'lesson'), _request, auth.uid())
  RETURNING id INTO id_;
  PERFORM public.log_audit(p.org_id, 'recommendation.learning_recorded', 'optimization_proposal', p.id::text,
    jsonb_build_object('workspace_id', p.workspace_id, 'learning', id_, 'outcome', oc, 'evidence', ev));
  RETURN jsonb_build_object('id', id_, 'status', 'created', 'actual_credits', cr, 'days_to_result', days_);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'invalid learning' USING ERRCODE = '22023';
END $$;
REVOKE ALL ON FUNCTION public.record_recommendation_learning(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_recommendation_learning(uuid, uuid, jsonb) TO authenticated;
