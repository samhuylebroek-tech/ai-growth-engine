-- PROPOSED migration 0071 (staging only until approved): organization AI credit overview.
-- AI credits are owned by the organization as one pool (credit_ledger.org_id); businesses do not hold separate
-- balances. Reservations are readable only by the user who made them, so organization-wide reserved/consumed/
-- released totals need an aggregate read. This function returns aggregates only (no users, prompts or run ids),
-- splits usage per business and specialist only for businesses the caller can open, books Organization Growth
-- Officer requests separately from the business that recorded them, and counts every run exactly once.
-- Idempotent: CREATE OR REPLACE only; no table or data changes.

CREATE OR REPLACE FUNCTION public.org_credit_overview(_org uuid, _month date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m0 timestamptz; m1 timestamptz; res jsonb;
BEGIN
  IF NOT public.is_org_member(_org) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF _month IS NULL THEN RAISE EXCEPTION 'month required'; END IF;
  m0 := date_trunc('month', _month::timestamp) AT TIME ZONE 'UTC'; m1 := (date_trunc('month', _month::timestamp) + interval '1 month') AT TIME ZONE 'UTC';
  WITH r AS (
    SELECT c.run_id, c.reserved, c.charged, c.status, c.settled_at, a.workspace_id, a.agent_key,
           a.agent_key = 'organization_growth_officer' AS org_officer,
           (a.workspace_id IS NOT NULL AND public.has_workspace_role(a.workspace_id, 'viewer')) AS visible,
           CASE WHEN c.status = 'settled' THEN coalesce(c.charged, 0) ELSE 0 END AS used,
           CASE WHEN c.status = 'settled' AND c.settled_at >= m0 AND c.settled_at < m1 THEN coalesce(c.charged, 0) ELSE 0 END AS used_month,
           CASE WHEN c.status = 'reserved' THEN c.reserved ELSE 0 END AS pending,
           CASE WHEN c.status = 'refunded' THEN c.reserved WHEN c.status = 'settled' THEN greatest(c.reserved - coalesce(c.charged, 0), 0) ELSE 0 END AS released
    FROM public.ai_credit_reservations c JOIN public.agent_runs a ON a.id = c.run_id AND a.org_id = c.org_id
    WHERE c.org_id = _org
  ), l AS (
    SELECT coalesce(sum(delta), 0)::int AS balance,
           coalesce(sum(delta) FILTER (WHERE delta > 0 AND reason <> 'refund'), 0)::int AS granted,
           coalesce(sum(-delta) FILTER (WHERE reason = 'usage' AND coalesce(ref, '') NOT LIKE 'run:%'), 0)::int AS direct_used,
           coalesce(sum(-delta) FILTER (WHERE reason = 'usage' AND coalesce(ref, '') NOT LIKE 'run:%' AND created_at >= m0 AND created_at < m1), 0)::int AS direct_used_month,
           coalesce(sum(-delta) FILTER (WHERE delta < 0 AND reason <> 'usage'), 0)::int AS other_debits
    FROM public.credit_ledger WHERE org_id = _org
  )
  SELECT jsonb_build_object(
    'month', to_char(m0 AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
    'balance', l.balance, 'granted', l.granted,
    'reserved_pending', (SELECT coalesce(sum(pending), 0)::int FROM r),
    'consumed', (SELECT coalesce(sum(used), 0)::int FROM r) + l.direct_used,
    'consumed_month', (SELECT coalesce(sum(used_month), 0)::int FROM r) + l.direct_used_month,
    'released', (SELECT coalesce(sum(released), 0)::int FROM r),
    'direct_used', l.direct_used, 'other_debits', l.other_debits,
    'runs', (SELECT count(*)::int FROM r),
    -- Ledger check: what was granted minus what was used, held or debited otherwise must equal the balance.
    'reconciles', l.balance = l.granted - ((SELECT coalesce(sum(used), 0) FROM r) + l.direct_used) - (SELECT coalesce(sum(pending), 0) FROM r) - l.other_debits,
    'org_officer', (SELECT jsonb_build_object('consumed', coalesce(sum(used), 0)::int, 'consumed_month', coalesce(sum(used_month), 0)::int, 'reserved_pending', coalesce(sum(pending), 0)::int, 'runs', count(*)::int) FROM r WHERE org_officer),
    'businesses', coalesce((SELECT jsonb_agg(b ORDER BY b->>'workspace_id') FROM (
        SELECT jsonb_build_object('workspace_id', workspace_id, 'consumed', sum(used)::int, 'consumed_month', sum(used_month)::int, 'reserved_pending', sum(pending)::int, 'released', sum(released)::int, 'runs', count(*)::int) b
        FROM r WHERE visible AND NOT org_officer GROUP BY workspace_id) x), '[]'::jsonb),
    'specialists', coalesce((SELECT jsonb_agg(s ORDER BY s->>'workspace_id', s->>'agent_key') FROM (
        SELECT jsonb_build_object('workspace_id', workspace_id, 'agent_key', agent_key, 'consumed', sum(used)::int, 'consumed_month', sum(used_month)::int, 'reserved_pending', sum(pending)::int, 'runs', count(*)::int) s
        FROM r WHERE visible AND NOT org_officer GROUP BY workspace_id, agent_key) y), '[]'::jsonb),
    'not_visible', (SELECT jsonb_build_object('consumed', coalesce(sum(used), 0)::int, 'consumed_month', coalesce(sum(used_month), 0)::int, 'reserved_pending', coalesce(sum(pending), 0)::int) FROM r WHERE NOT visible AND NOT org_officer)
  ) INTO res FROM l;
  RETURN res;
END $$;

REVOKE ALL ON FUNCTION public.org_credit_overview(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_credit_overview(uuid, date) TO authenticated;
