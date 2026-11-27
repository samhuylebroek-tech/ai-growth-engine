-- PROPOSED migration 0086 (staging only until approved): credit price visibility.
-- The full credit price history (who set a price, why, and prices of other plans) is platform administration and is
-- now readable by the Platform Owner only. Businesses still need the price that applies to them to see what their AI
-- work cost, so a narrow function returns only scope, plan, currency, price and start date, limited to the platform
-- price and the plans of the caller's own organizations. Writing prices is unchanged (Platform Owner only, never
-- back-dated, insert-only). Idempotent.

DROP POLICY IF EXISTS "credit prices readable when signed in" ON public.credit_price_versions;
DROP POLICY IF EXISTS "credit prices readable by platform owner" ON public.credit_price_versions;
CREATE POLICY "credit prices readable by platform owner" ON public.credit_price_versions FOR SELECT TO authenticated
  USING (public.has_platform_role('platform_owner'));

CREATE OR REPLACE FUNCTION public.credit_prices_in_effect()
RETURNS TABLE(scope text, plan_key text, currency text, price_per_credit numeric, effective_from timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT v.scope, v.plan_key, v.currency, v.price_per_credit, v.effective_from
  FROM public.credit_price_versions v
  WHERE auth.uid() IS NOT NULL
    AND (v.scope = 'platform'
      OR v.plan_key IN (SELECT s.plan_key FROM public.subscriptions s WHERE public.is_org_member(s.org_id)))
  ORDER BY v.effective_from, v.scope, v.currency
  LIMIT 5000
$$;
REVOKE ALL ON FUNCTION public.credit_prices_in_effect() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.credit_prices_in_effect() TO authenticated;
