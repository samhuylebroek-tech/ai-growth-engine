-- The public plan catalogue is read-only for signed-out callers; RLS already denies writes.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.plans, public.plan_entitlements FROM anon;
