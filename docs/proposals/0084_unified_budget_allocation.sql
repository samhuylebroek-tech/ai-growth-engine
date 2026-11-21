-- PROPOSED migration 0084 (staging only until approved): unified budget allocation.
-- Hierarchy without a second financial system: the business budget is the existing budget lines (one channel, month
-- and currency each; optionally earmarked for a goal, initiative or brand). A campaign receives money only through an
-- allocation from a budget line, so a line's planned amount is shared by all campaigns and can never be handed out
-- twice: unallocated = planned - active allocations. Spending entries can name the budget line (channel) they belong
-- to; then actual and simulated exposure are each checked against the campaign's allocation on that line.
-- Guarantees (all server-side):
--   * every change locks the budget line row, so concurrent allocations from the same line are serialised and the
--     second one sees the first; a request key makes repeats no-ops; a stale screen (seen amount) is refused;
--   * allocations above the unallocated amount, into closed campaigns, against an earmark, or below what the campaign
--     already spent or reserved on that line are refused with a stated reason and the refusal is recorded;
--   * a budget line cannot be lowered below what is allocated, nor change currency, month or channel while allocated;
--   * a campaign cannot leave the goal/initiative/brand of a line that still funds it;
--   * history is insert-only; members request changes, editors apply or decide them.
-- Idempotent: IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS only.

CREATE TABLE IF NOT EXISTS public.campaign_budget_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  budget_line_id uuid NOT NULL REFERENCES public.budget_lines(id),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (budget_line_id, campaign_id)
);
CREATE INDEX IF NOT EXISTS campaign_budget_allocations_campaign_idx ON public.campaign_budget_allocations(campaign_id);
CREATE INDEX IF NOT EXISTS campaign_budget_allocations_ws_idx ON public.campaign_budget_allocations(workspace_id);
GRANT SELECT ON public.campaign_budget_allocations TO authenticated;
GRANT ALL ON public.campaign_budget_allocations TO service_role;
ALTER TABLE public.campaign_budget_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allocations readable by business" ON public.campaign_budget_allocations;
CREATE POLICY "allocations readable by business" ON public.campaign_budget_allocations FOR SELECT TO authenticated
  USING (public.has_workspace_role(workspace_id, 'viewer'));

CREATE TABLE IF NOT EXISTS public.budget_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  kind text NOT NULL CHECK (kind IN ('set','move','cancel','release_unused')),
  budget_line_id uuid NOT NULL REFERENCES public.budget_lines(id),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id),
  to_campaign_id uuid REFERENCES public.campaigns(id),
  amount numeric(14,2),
  seen_amount numeric(14,2),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','rejected','failed')),
  result jsonb,
  request_key uuid NOT NULL,
  requested_by uuid NOT NULL,
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, request_key)
);
CREATE INDEX IF NOT EXISTS budget_change_requests_ws_idx ON public.budget_change_requests(workspace_id, status);
GRANT SELECT ON public.budget_change_requests TO authenticated;
GRANT ALL ON public.budget_change_requests TO service_role;
ALTER TABLE public.budget_change_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "budget requests readable by business" ON public.budget_change_requests;
CREATE POLICY "budget requests readable by business" ON public.budget_change_requests FOR SELECT TO authenticated
  USING (public.has_workspace_role(workspace_id, 'viewer'));

CREATE TABLE IF NOT EXISTS public.budget_allocation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  budget_line_id uuid NOT NULL REFERENCES public.budget_lines(id),
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id),
  to_campaign_id uuid REFERENCES public.campaigns(id),
  kind text NOT NULL CHECK (kind IN ('allocate','increase','decrease','move','cancel','release_unused')),
  outcome text NOT NULL CHECK (outcome IN ('applied','rejected')),
  rejection text,
  previous_amount numeric(14,2) NOT NULL,
  new_amount numeric(14,2) NOT NULL,
  difference numeric(14,2) NOT NULL,
  currency text NOT NULL,
  line_planned numeric(14,2) NOT NULL,
  unallocated_before numeric(14,2) NOT NULL,
  reason text NOT NULL,
  request_key uuid NOT NULL,
  change_request_id uuid REFERENCES public.budget_change_requests(id),
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, request_key)
);
CREATE INDEX IF NOT EXISTS budget_allocation_events_line_idx ON public.budget_allocation_events(budget_line_id, created_at);
CREATE INDEX IF NOT EXISTS budget_allocation_events_campaign_idx ON public.budget_allocation_events(campaign_id, created_at);
GRANT SELECT ON public.budget_allocation_events TO authenticated;
GRANT ALL ON public.budget_allocation_events TO service_role;
ALTER TABLE public.budget_allocation_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allocation history readable by business" ON public.budget_allocation_events;
CREATE POLICY "allocation history readable by business" ON public.budget_allocation_events FOR SELECT TO authenticated
  USING (public.has_workspace_role(workspace_id, 'viewer'));

CREATE OR REPLACE FUNCTION public.budget_history_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'budget allocation history is insert-only' USING ERRCODE = '42501'; END $$;
DROP TRIGGER IF EXISTS budget_allocation_events_immutable ON public.budget_allocation_events;
CREATE TRIGGER budget_allocation_events_immutable BEFORE UPDATE OR DELETE ON public.budget_allocation_events
  FOR EACH ROW EXECUTE FUNCTION public.budget_history_immutable();

-- Spending entries may name the budget line (channel and month) they were paid from.
ALTER TABLE public.campaign_spend_entries ADD COLUMN IF NOT EXISTS budget_line_id uuid REFERENCES public.budget_lines(id);
CREATE INDEX IF NOT EXISTS campaign_spend_entries_line_idx ON public.campaign_spend_entries(budget_line_id) WHERE budget_line_id IS NOT NULL;

-- Net exposure (spend + corrections + open reservations) of one campaign on one budget line, per data class.
CREATE OR REPLACE FUNCTION public.campaign_line_exposure(_campaign uuid, _line uuid, _class text) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(sum(amount), 0) FROM public.campaign_spend_entries
   WHERE campaign_id = _campaign AND budget_line_id = _line AND data_class = _class
$$;
REVOKE ALL ON FUNCTION public.campaign_line_exposure(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- Internal executor: caller rights are checked by the public wrappers. Returns the recorded result.
CREATE OR REPLACE FUNCTION public.apply_budget_allocation(_ws uuid, _kind text, _line uuid, _campaign uuid, _to uuid,
  _amount numeric, _seen numeric, _reason text, _request uuid, _actor uuid, _change_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE l public.budget_lines; c public.campaigns; t public.campaigns; prior public.budget_allocation_events;
  cur numeric; new_ numeric; to_cur numeric; others numeric; unalloc numeric; exp_ numeric; ev_kind text; code text; diff numeric;
BEGIN
  SELECT * INTO prior FROM public.budget_allocation_events WHERE workspace_id = _ws AND request_key = _request;
  IF prior.id IS NOT NULL THEN
    RETURN jsonb_build_object('status', CASE WHEN prior.outcome = 'applied' THEN 'existing' ELSE 'rejected' END,
      'code', prior.rejection, 'amount', prior.new_amount, 'event', prior.id);
  END IF;
  IF _kind NOT IN ('set','move','cancel','release_unused') OR _reason IS NULL OR length(trim(_reason)) NOT BETWEEN 3 AND 500
     OR (_kind IN ('set','move') AND (_amount IS NULL OR _amount < 0 OR _amount > 1e11 OR round(_amount, 2) <> _amount))
     OR (_kind = 'move' AND (_to IS NULL OR _to = _campaign OR _amount = 0)) THEN
    RAISE EXCEPTION 'invalid budget allocation' USING ERRCODE = '22023';
  END IF;
  -- one lock per budget line serialises every allocation that draws on it
  SELECT * INTO l FROM public.budget_lines WHERE id = _line FOR UPDATE;
  IF l.id IS NULL OR l.workspace_id <> _ws THEN RAISE EXCEPTION 'budget line not found' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.campaigns WHERE id IN (_campaign, coalesce(_to, _campaign)) AND workspace_id = _ws ORDER BY id FOR UPDATE;
  SELECT * INTO c FROM public.campaigns WHERE id = _campaign AND workspace_id = _ws;
  IF c.id IS NULL THEN RAISE EXCEPTION 'campaign not found' USING ERRCODE = '22023'; END IF;
  IF _to IS NOT NULL THEN
    SELECT * INTO t FROM public.campaigns WHERE id = _to AND workspace_id = _ws;
    IF t.id IS NULL THEN RAISE EXCEPTION 'campaign not found' USING ERRCODE = '22023'; END IF;
  END IF;
  SELECT coalesce((SELECT amount FROM public.campaign_budget_allocations WHERE budget_line_id = l.id AND campaign_id = c.id AND status = 'active'), 0) INTO cur;
  IF _seen IS NOT NULL AND _seen <> cur THEN RAISE EXCEPTION 'allocation changed meanwhile' USING ERRCODE = '40001'; END IF;
  SELECT coalesce(sum(amount), 0) INTO others FROM public.campaign_budget_allocations WHERE budget_line_id = l.id AND status = 'active' AND campaign_id <> c.id;
  unalloc := l.planned - others - cur;
  exp_ := public.campaign_line_exposure(c.id, l.id, 'manual');
  new_ := CASE _kind WHEN 'set' THEN _amount WHEN 'move' THEN cur - _amount WHEN 'cancel' THEN 0 ELSE greatest(exp_, 0) END;
  diff := new_ - cur;
  ev_kind := CASE WHEN _kind = 'move' THEN 'move' WHEN _kind = 'cancel' THEN 'cancel' WHEN _kind = 'release_unused' THEN 'release_unused'
                  WHEN cur = 0 THEN 'allocate' WHEN diff > 0 THEN 'increase' ELSE 'decrease' END;
  -- rules, first failure wins
  IF diff = 0 AND _kind <> 'move' THEN code := 'no_change';
  ELSIF _kind = 'release_unused' AND c.status NOT IN ('completed','cancelled','paused','archived') THEN code := 'campaign_running';
  ELSIF _kind = 'move' AND _amount > cur THEN code := 'move_more_than_allocated';
  ELSIF new_ < exp_ THEN code := 'below_committed';
  ELSIF diff > 0 AND c.status IN ('completed','cancelled','archived') THEN code := 'campaign_closed';
  ELSIF _kind = 'move' AND t.status IN ('completed','cancelled','archived') THEN code := 'campaign_closed';
  ELSIF diff > 0 AND ((l.goal_id IS NOT NULL AND c.goal_id IS DISTINCT FROM l.goal_id)
        OR (l.initiative_id IS NOT NULL AND c.initiative_id IS DISTINCT FROM l.initiative_id)
        OR (l.unit_id IS NOT NULL AND c.unit_id IS DISTINCT FROM l.unit_id)) THEN code := 'earmark_mismatch';
  ELSIF _kind = 'move' AND ((l.goal_id IS NOT NULL AND t.goal_id IS DISTINCT FROM l.goal_id)
        OR (l.initiative_id IS NOT NULL AND t.initiative_id IS DISTINCT FROM l.initiative_id)
        OR (l.unit_id IS NOT NULL AND t.unit_id IS DISTINCT FROM l.unit_id)) THEN code := 'earmark_mismatch';
  ELSIF diff > 0 AND diff > unalloc THEN code := 'exceeds_unallocated';
  END IF;
  INSERT INTO public.budget_allocation_events(org_id, workspace_id, budget_line_id, campaign_id, to_campaign_id, kind, outcome, rejection,
    previous_amount, new_amount, difference, currency, line_planned, unallocated_before, reason, request_key, change_request_id, actor_id)
  VALUES (l.org_id, l.workspace_id, l.id, c.id, _to, ev_kind, CASE WHEN code IS NULL THEN 'applied' ELSE 'rejected' END, code,
    cur, CASE WHEN code IS NULL THEN new_ ELSE cur END, CASE WHEN code IS NULL THEN diff ELSE 0 END, l.currency, l.planned, unalloc,
    trim(_reason), _request, _change_request, _actor);
  IF code IS NOT NULL THEN
    PERFORM public.log_audit(l.org_id, 'budget.allocation_refused', 'campaign', c.id::text,
      jsonb_build_object('workspace_id', l.workspace_id, 'line', l.id, 'code', code, 'requested', new_, 'current', cur, 'unallocated', unalloc, 'committed', exp_, 'currency', l.currency));
    RETURN jsonb_build_object('status', 'rejected', 'code', code, 'current', cur, 'requested', new_, 'unallocated', unalloc, 'committed', exp_, 'currency', l.currency);
  END IF;
  INSERT INTO public.campaign_budget_allocations(org_id, workspace_id, budget_line_id, campaign_id, currency, amount, status, updated_by)
  VALUES (l.org_id, l.workspace_id, l.id, c.id, l.currency, new_, CASE WHEN _kind = 'cancel' THEN 'cancelled' ELSE 'active' END, _actor)
  ON CONFLICT (budget_line_id, campaign_id) DO UPDATE SET amount = EXCLUDED.amount, status = EXCLUDED.status, updated_by = EXCLUDED.updated_by, updated_at = now();
  IF _kind = 'move' THEN
    SELECT coalesce((SELECT amount FROM public.campaign_budget_allocations WHERE budget_line_id = l.id AND campaign_id = t.id AND status = 'active'), 0) INTO to_cur;
    INSERT INTO public.campaign_budget_allocations(org_id, workspace_id, budget_line_id, campaign_id, currency, amount, status, updated_by)
    VALUES (l.org_id, l.workspace_id, l.id, t.id, l.currency, to_cur + _amount, 'active', _actor)
    ON CONFLICT (budget_line_id, campaign_id) DO UPDATE SET amount = EXCLUDED.amount, status = 'active', updated_by = EXCLUDED.updated_by, updated_at = now();
  END IF;
  PERFORM public.log_audit(l.org_id, 'budget.allocation_changed', 'campaign', c.id::text,
    jsonb_build_object('workspace_id', l.workspace_id, 'line', l.id, 'kind', ev_kind, 'from', cur, 'to', new_, 'to_campaign', _to, 'currency', l.currency));
  RETURN jsonb_build_object('status', 'applied', 'kind', ev_kind, 'previous', cur, 'amount', new_, 'unallocated', unalloc - CASE WHEN _kind = 'move' THEN 0 ELSE diff END, 'currency', l.currency);
END $$;
REVOKE ALL ON FUNCTION public.apply_budget_allocation(uuid, text, uuid, uuid, uuid, numeric, numeric, text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Editors change allocations directly. _p: kind, budget_line_id, campaign_id, to_campaign_id, amount, seen_amount, reason.
CREATE OR REPLACE FUNCTION public.change_campaign_allocation(_workspace uuid, _request uuid, _p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  IF NOT public.has_workspace_role(_workspace, 'editor') THEN RAISE EXCEPTION 'only editors change budget allocations' USING ERRCODE = '42501'; END IF;
  IF _request IS NULL OR jsonb_typeof(_p) IS DISTINCT FROM 'object'
     OR (_p - ARRAY['kind','budget_line_id','campaign_id','to_campaign_id','amount','seen_amount','reason']) <> '{}'::jsonb
     OR NOT (_p ? 'seen_amount') THEN
    RAISE EXCEPTION 'invalid budget allocation' USING ERRCODE = '22023';
  END IF;
  RETURN public.apply_budget_allocation(_workspace, _p->>'kind', (_p->>'budget_line_id')::uuid, (_p->>'campaign_id')::uuid,
    nullif(_p->>'to_campaign_id','')::uuid, (_p->>'amount')::numeric, (_p->>'seen_amount')::numeric, _p->>'reason', _request, auth.uid(), NULL);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'invalid budget allocation' USING ERRCODE = '22023';
END $$;
REVOKE ALL ON FUNCTION public.change_campaign_allocation(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_campaign_allocation(uuid, uuid, jsonb) TO authenticated;

-- Members (and above) ask for a change; nothing moves until an editor decides.
CREATE OR REPLACE FUNCTION public.request_budget_change(_workspace uuid, _request uuid, _p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w public.workspaces; prior public.budget_change_requests; l public.budget_lines; id_ uuid; k text := _p->>'kind';
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  SELECT * INTO w FROM public.workspaces WHERE id = _workspace;
  IF w.id IS NULL OR NOT public.has_workspace_role(w.id, 'member') THEN RAISE EXCEPTION 'business not found' USING ERRCODE = '42501'; END IF;
  IF _request IS NULL OR jsonb_typeof(_p) IS DISTINCT FROM 'object'
     OR (_p - ARRAY['kind','budget_line_id','campaign_id','to_campaign_id','amount','seen_amount','reason']) <> '{}'::jsonb
     OR k NOT IN ('set','move','cancel','release_unused') THEN
    RAISE EXCEPTION 'invalid budget request' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO prior FROM public.budget_change_requests WHERE workspace_id = w.id AND request_key = _request;
  IF prior.id IS NOT NULL THEN RETURN jsonb_build_object('id', prior.id, 'status', 'existing'); END IF;
  SELECT * INTO l FROM public.budget_lines WHERE id = (_p->>'budget_line_id')::uuid AND workspace_id = w.id;
  IF l.id IS NULL OR NOT EXISTS (SELECT 1 FROM public.campaigns WHERE id = (_p->>'campaign_id')::uuid AND workspace_id = w.id)
     OR (nullif(_p->>'to_campaign_id','') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.campaigns WHERE id = (_p->>'to_campaign_id')::uuid AND workspace_id = w.id))
     OR (k IN ('set','move') AND ((_p->>'amount')::numeric IS NULL OR (_p->>'amount')::numeric < 0))
     OR (k = 'move' AND nullif(_p->>'to_campaign_id','') IS NULL)
     OR length(trim(coalesce(_p->>'reason',''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'invalid budget request' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.budget_change_requests(org_id, workspace_id, kind, budget_line_id, campaign_id, to_campaign_id, amount, seen_amount, reason, request_key, requested_by)
  VALUES (w.org_id, w.id, k, l.id, (_p->>'campaign_id')::uuid, nullif(_p->>'to_campaign_id','')::uuid, round((_p->>'amount')::numeric, 2),
    (_p->>'seen_amount')::numeric, trim(_p->>'reason'), _request, auth.uid())
  RETURNING id INTO id_;
  PERFORM public.log_audit(w.org_id, 'budget.change_requested', 'budget_line', l.id::text, jsonb_build_object('workspace_id', w.id, 'request', id_, 'kind', k));
  RETURN jsonb_build_object('id', id_, 'status', 'pending');
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'invalid budget request' USING ERRCODE = '22023';
END $$;
REVOKE ALL ON FUNCTION public.request_budget_change(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_budget_change(uuid, uuid, jsonb) TO authenticated;

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
  EXCEPTION WHEN SQLSTATE '40001' THEN res := jsonb_build_object('status', 'rejected', 'code', 'stale');
  END;
  UPDATE public.budget_change_requests SET status = CASE WHEN res->>'status' IN ('applied','existing') THEN 'applied' ELSE 'failed' END,
    result = res, decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(coalesce(_note,'')), '') WHERE id = r.id;
  RETURN res;
END $$;
REVOKE ALL ON FUNCTION public.decide_budget_change(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_budget_change(uuid, boolean, text) TO authenticated;

-- A budget line cannot fall below what it funds, nor change identity while it funds campaigns.
CREATE OR REPLACE FUNCTION public.guard_budget_line_allocations() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE alloc numeric;
BEGIN
  SELECT coalesce(sum(amount), 0) INTO alloc FROM public.campaign_budget_allocations WHERE budget_line_id = OLD.id AND status = 'active';
  IF alloc > 0 THEN
    IF NEW.planned < alloc THEN
      RAISE EXCEPTION 'budget_below_allocated: % % is allocated to campaigns', alloc, OLD.currency USING ERRCODE = 'P0001';
    END IF;
    IF NEW.currency <> OLD.currency OR NEW.period_month <> OLD.period_month OR NEW.channel <> OLD.channel OR NEW.workspace_id <> OLD.workspace_id THEN
      RAISE EXCEPTION 'budget_line_in_use' USING ERRCODE = 'P0001';
    END IF;
    IF (NEW.goal_id IS NOT NULL AND NEW.goal_id IS DISTINCT FROM OLD.goal_id) OR (NEW.initiative_id IS NOT NULL AND NEW.initiative_id IS DISTINCT FROM OLD.initiative_id)
       OR (NEW.unit_id IS NOT NULL AND NEW.unit_id IS DISTINCT FROM OLD.unit_id) THEN
      IF EXISTS (SELECT 1 FROM public.campaign_budget_allocations a JOIN public.campaigns c ON c.id = a.campaign_id
                  WHERE a.budget_line_id = OLD.id AND a.status = 'active' AND a.amount > 0
                    AND ((NEW.goal_id IS NOT NULL AND c.goal_id IS DISTINCT FROM NEW.goal_id)
                      OR (NEW.initiative_id IS NOT NULL AND c.initiative_id IS DISTINCT FROM NEW.initiative_id)
                      OR (NEW.unit_id IS NOT NULL AND c.unit_id IS DISTINCT FROM NEW.unit_id))) THEN
        RAISE EXCEPTION 'earmark_conflicts_with_allocations' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS budget_line_allocation_guard ON public.budget_lines;
CREATE TRIGGER budget_line_allocation_guard BEFORE UPDATE ON public.budget_lines FOR EACH ROW EXECUTE FUNCTION public.guard_budget_line_allocations();

CREATE OR REPLACE FUNCTION public.guard_campaign_funding_links() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (NEW.goal_id IS DISTINCT FROM OLD.goal_id OR NEW.initiative_id IS DISTINCT FROM OLD.initiative_id OR NEW.unit_id IS DISTINCT FROM OLD.unit_id)
     AND EXISTS (SELECT 1 FROM public.campaign_budget_allocations a JOIN public.budget_lines l ON l.id = a.budget_line_id
                  WHERE a.campaign_id = OLD.id AND a.status = 'active' AND a.amount > 0
                    AND ((l.goal_id IS NOT NULL AND NEW.goal_id IS DISTINCT FROM l.goal_id)
                      OR (l.initiative_id IS NOT NULL AND NEW.initiative_id IS DISTINCT FROM l.initiative_id)
                      OR (l.unit_id IS NOT NULL AND NEW.unit_id IS DISTINCT FROM l.unit_id))) THEN
    RAISE EXCEPTION 'campaign_funded_by_earmarked_budget' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS campaign_funding_link_guard ON public.campaigns;
CREATE TRIGGER campaign_funding_link_guard BEFORE UPDATE OF goal_id, initiative_id, unit_id ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.guard_campaign_funding_links();

-- record_campaign_spend (from proposal 0083) now accepts an optional budget_line_id and checks the allocation.
CREATE OR REPLACE FUNCTION public.record_campaign_spend(_workspace uuid, _request uuid, _campaign uuid, _p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w public.workspaces; c public.campaigns; prior public.campaign_spend_entries; rel public.campaign_spend_entries; lim public.campaign_spend_limits;
  k text := _p->>'kind'; amt numeric := (_p->>'amount')::numeric; cur text := upper(trim(coalesce(_p->>'currency','')));
  day date := (_p->>'occurred_on')::date; cls text := coalesce(_p->>'data_class','manual'); ref text := trim(coalesce(_p->>'source_ref',''));
  rel_id uuid := nullif(_p->>'relates_to','')::uuid; remaining numeric; id_ uuid; tz text; local_today date;
  line_id uuid := nullif(_p->>'budget_line_id','')::uuid; l public.budget_lines; al numeric; lexp numeric;
  pday date; used_d numeric; used_w numeric; used_m numeric; used_l numeric; hit text; hit_max numeric; hit_used numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  SELECT * INTO w FROM public.workspaces WHERE id = _workspace;
  IF w.id IS NULL OR NOT public.has_workspace_role(w.id, 'member') THEN RAISE EXCEPTION 'business not found' USING ERRCODE = '42501'; END IF;
  IF _request IS NULL OR jsonb_typeof(_p) IS DISTINCT FROM 'object'
     OR (_p - ARRAY['kind','amount','currency','occurred_on','data_class','source_ref','relates_to','note','budget_line_id']) <> '{}'::jsonb THEN
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
    -- releases and corrections stay on the budget line of the entry they adjust
    IF line_id IS NOT NULL AND line_id IS DISTINCT FROM rel.budget_line_id THEN RAISE EXCEPTION 'invalid related entry' USING ERRCODE = '22023'; END IF;
    line_id := rel.budget_line_id;
  ELSIF line_id IS NOT NULL THEN
    SELECT * INTO l FROM public.budget_lines WHERE id = line_id AND workspace_id = w.id;
    IF l.id IS NULL OR l.currency <> cur OR date_trunc('month', day)::date <> l.period_month THEN
      RAISE EXCEPTION 'spend_line_mismatch' USING ERRCODE = 'P0001';
    END IF;
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
  INSERT INTO public.campaign_spend_entries(org_id, workspace_id, campaign_id, kind, amount, currency, occurred_on, data_class, source_ref, relates_to, note, request_key, budget_line_id)
  VALUES (w.org_id, w.id, c.id, k, round(amt, 2), cur, day, cls, ref, rel_id, coalesce(_p->>'note',''), _request, line_id)
  RETURNING id INTO id_;
  PERFORM public.log_audit(w.org_id, 'campaign.spend_recorded', 'campaign', c.id::text,
    jsonb_build_object('entry', id_, 'kind', k, 'amount', round(amt, 2), 'currency', cur, 'class', cls, 'line', line_id));
  RETURN jsonb_build_object('id', id_, 'status', 'created');
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
  RAISE EXCEPTION 'invalid spend entry' USING ERRCODE = '22023';
END $$;
REVOKE ALL ON FUNCTION public.record_campaign_spend(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_campaign_spend(uuid, uuid, uuid, jsonb) TO authenticated;
