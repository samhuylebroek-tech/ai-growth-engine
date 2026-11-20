-- PROPOSED migration 0072 (staging only until approved): atomic budget move between two lines of one business.
-- Before: the browser lowered one line and then raised the other in two separate writes, with a best-effort undo;
-- a failure or a concurrent edit in between could leave money missing or counted twice. Now one function locks both
-- lines, checks they belong to the same business, month and currency, checks the caller is a budget editor of that
-- business, and only applies when both amounts are still what the caller saw (so a repeated click or a stale screen
-- changes nothing). The hard cap of the receiving line is respected. Idempotent: CREATE OR REPLACE only.

CREATE OR REPLACE FUNCTION public.move_budget(_from uuid, _to uuid, _amount numeric, _seen_from numeric, _seen_to numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f public.budget_lines; t public.budget_lines;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  IF _from = _to OR _amount IS NULL OR _amount <= 0 OR _amount > 1e12 THEN RAISE EXCEPTION 'invalid budget move' USING ERRCODE = '22023'; END IF;
  -- lock both rows in a fixed order so two concurrent moves cannot deadlock or interleave
  PERFORM 1 FROM public.budget_lines WHERE id IN (_from, _to) ORDER BY id FOR UPDATE;
  SELECT * INTO f FROM public.budget_lines WHERE id = _from;
  SELECT * INTO t FROM public.budget_lines WHERE id = _to;
  IF f.id IS NULL OR t.id IS NULL OR NOT public.has_workspace_role(f.workspace_id, 'editor') THEN
    RAISE EXCEPTION 'budget lines not found' USING ERRCODE = '42501';
  END IF;
  IF f.workspace_id <> t.workspace_id OR f.org_id <> t.org_id THEN RAISE EXCEPTION 'budget lines belong to different businesses' USING ERRCODE = '42501'; END IF;
  IF f.period_month <> t.period_month THEN RAISE EXCEPTION 'budget lines are in different months' USING ERRCODE = '22023'; END IF;
  IF f.currency <> t.currency THEN RAISE EXCEPTION 'budget lines use different currencies' USING ERRCODE = '22023'; END IF;
  IF f.planned <> _seen_from OR t.planned <> _seen_to THEN RAISE EXCEPTION 'budget changed meanwhile' USING ERRCODE = '40001'; END IF;
  IF f.planned < _amount THEN RAISE EXCEPTION 'not enough planned budget to move' USING ERRCODE = '22023'; END IF;
  IF t.hard_cap IS NOT NULL AND t.planned + _amount > t.hard_cap THEN RAISE EXCEPTION 'move exceeds the hard cap' USING ERRCODE = '22023'; END IF;
  UPDATE public.budget_lines SET planned = planned - _amount WHERE id = _from;
  UPDATE public.budget_lines SET planned = planned + _amount WHERE id = _to;
  PERFORM public.log_audit(f.org_id, 'budget.moved', 'budget_line', _from::text,
    jsonb_build_object('workspace_id', f.workspace_id, 'to', _to, 'amount', _amount, 'currency', f.currency, 'month', f.period_month));
  RETURN jsonb_build_object('from_planned', f.planned - _amount, 'to_planned', t.planned + _amount, 'currency', f.currency);
END $$;
REVOKE ALL ON FUNCTION public.move_budget(uuid, uuid, numeric, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_budget(uuid, uuid, numeric, numeric, numeric) TO authenticated;
