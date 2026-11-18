-- Defense in depth. The database's default privileges grant every new public object to anon and
-- authenticated. RLS policies and in-function session checks already deny those callers; this removes
-- the unused privileges so a future policy mistake cannot expose tenant data. Forward-only and idempotent.

-- 1. Signed-out callers never read or write tenant tables (public plan catalogue stays readable).
REVOKE ALL ON public.ai_call_receipts, public.ai_credit_reservations, public.budget_lines,
  public.coordinated_analyses, public.crm_contacts, public.crm_deals, public.growth_goals,
  public.growth_initiative_operations, public.growth_initiatives, public.growth_plan_versions,
  public.growth_strategies, public.growth_strategy_conversions, public.seo_audits,
  public.workspace_members FROM anon;

-- 2. Growth Plan records are written only through the role-checked RPCs.
REVOKE INSERT, UPDATE, DELETE ON public.growth_plan_versions, public.growth_initiatives,
  public.growth_initiative_operations FROM authenticated;

DO $$
DECLARE r record;
BEGIN
  -- 3. TRUNCATE bypasses RLS; REFERENCES/TRIGGER are never needed by app callers.
  FOR r IN SELECT c.oid::regclass AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r','p') LOOP
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON %s FROM anon, authenticated', r.t);
  END LOOP;
  -- 4. Session-dependent privileged functions are not callable without a session.
  --    is_platform_staff stays callable: the public plan catalogue policy evaluates it for anon.
  FOR r IN SELECT p.oid::regprocedure AS f FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.prosecdef AND p.proname = ANY (ARRAY[
             'approve_growth_plan','convert_execution_plan','create_growth_initiative_work',
             'create_growth_plan_draft','create_growth_strategy_project','credit_balance',
             'execution_user_allowed','execution_workspace_members','has_org_role','has_platform_role',
             'is_org_member','org_entitlement','repeat_execution_task','shares_org_with',
             'update_growth_initiative_operations','ws_org']) LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.f);
  END LOOP;
END $$;
