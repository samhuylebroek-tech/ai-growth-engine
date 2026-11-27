-- PROPOSED migration (not in the journal; not applied to the live database). Applied to staging only,
-- recorded in ops_staging.applied_proposals by scripts/staging/apply-proposal.ts. Idempotent so the
-- later official migration can run on staging again without effect.
--
-- One-time Platform Owner initialization with an immutable audit trail.
-- Step 1 (the person, signed in): request_platform_owner_initialization() reads identity from the
--   server-side session only and records a short-lived request. It grants nothing.
-- Step 2 (controlled administration, database owner only): complete_platform_owner_initialization()
--   checks the request, the confirmed user id AND email, that no owner exists, and assigns the role
--   once. Afterwards the singleton record makes re-initialization impossible.
-- Platform Owner rows can only be created inside step 2; they cannot be changed or removed by any
-- role. The audit log becomes append-only for every role, including administrators.

CREATE TABLE IF NOT EXISTS public.platform_owner_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  email text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  completed_at timestamptz
);
REVOKE ALL ON public.platform_owner_requests FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.platform_owner_requests TO authenticated;
ALTER TABLE public.platform_owner_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own owner requests" ON public.platform_owner_requests;
CREATE POLICY "own owner requests" ON public.platform_owner_requests FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.platform_owner_initialization (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  owner_id uuid NOT NULL,
  request_id uuid NOT NULL REFERENCES public.platform_owner_requests(id),
  audit_id bigint NOT NULL,
  initialized_by text NOT NULL,
  initialized_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.platform_owner_initialization FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public.platform_owner_initialization ENABLE ROW LEVEL SECURITY;

-- Browser sessions never write roles or audit rows directly (RLS already denied it; this removes the grants).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.platform_roles FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_immutable_row() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$;

DROP TRIGGER IF EXISTS audit_logs_append_only ON public.audit_logs;
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_row();
DROP TRIGGER IF EXISTS audit_logs_no_truncate ON public.audit_logs;
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON public.audit_logs FOR EACH STATEMENT EXECUTE FUNCTION public.guard_immutable_row();
DROP TRIGGER IF EXISTS platform_owner_initialization_immutable ON public.platform_owner_initialization;
CREATE TRIGGER platform_owner_initialization_immutable BEFORE UPDATE OR DELETE ON public.platform_owner_initialization FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_row();
DROP TRIGGER IF EXISTS platform_owner_initialization_no_truncate ON public.platform_owner_initialization;
CREATE TRIGGER platform_owner_initialization_no_truncate BEFORE TRUNCATE ON public.platform_owner_initialization FOR EACH STATEMENT EXECUTE FUNCTION public.guard_immutable_row();

CREATE OR REPLACE FUNCTION public.guard_platform_owner_role() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN RAISE EXCEPTION 'platform roles cannot be truncated'; END IF;
  IF TG_OP IN ('UPDATE','DELETE') AND OLD.role = 'platform_owner' THEN
    RAISE EXCEPTION 'The Platform Owner role cannot be changed or removed';
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') AND NEW.role = 'platform_owner'
     AND coalesce(current_setting('app.platform_owner_initialization', true), '') = '' THEN
    RAISE EXCEPTION 'The Platform Owner role is assigned only by the one-time initialization';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS platform_owner_role_guard ON public.platform_roles;
CREATE TRIGGER platform_owner_role_guard BEFORE INSERT OR UPDATE OR DELETE ON public.platform_roles FOR EACH ROW EXECUTE FUNCTION public.guard_platform_owner_role();
DROP TRIGGER IF EXISTS platform_roles_no_truncate ON public.platform_roles;
CREATE TRIGGER platform_roles_no_truncate BEFORE TRUNCATE ON public.platform_roles FOR EACH STATEMENT EXECUTE FUNCTION public.guard_platform_owner_role();

CREATE OR REPLACE FUNCTION public.request_platform_owner_initialization() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u auth.users%ROWTYPE; r public.platform_owner_requests%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('platform_owner_initialization'));
  IF EXISTS (SELECT 1 FROM public.platform_owner_initialization) OR EXISTS (SELECT 1 FROM public.platform_roles WHERE role = 'platform_owner') THEN
    RAISE EXCEPTION 'Platform Owner is already initialized';
  END IF;
  SELECT * INTO u FROM auth.users WHERE id = auth.uid();
  IF NOT FOUND OR u.email IS NULL OR u.email_confirmed_at IS NULL THEN RAISE EXCEPTION 'A confirmed email address is required'; END IF;
  SELECT * INTO r FROM public.platform_owner_requests WHERE user_id = u.id AND completed_at IS NULL AND expires_at > now() ORDER BY requested_at DESC LIMIT 1;
  IF NOT FOUND THEN
    IF (SELECT count(*) FROM public.platform_owner_requests WHERE requested_at > now() - interval '1 day') >= 20 THEN
      RAISE EXCEPTION 'Too many initialization requests; try again later';
    END IF;
    INSERT INTO public.platform_owner_requests(user_id, email) VALUES (u.id, lower(u.email)) RETURNING * INTO r;
    INSERT INTO public.audit_logs(org_id, actor_id, action, target_type, target_id, metadata)
    VALUES (NULL, u.id, 'platform_owner.initialization_requested', 'platform_owner_request', r.id::text, '{}'::jsonb);
  END IF;
  RETURN jsonb_build_object('request_id', r.id, 'user_id', r.user_id, 'email', r.email, 'expires_at', r.expires_at);
END $$;
REVOKE ALL ON FUNCTION public.request_platform_owner_initialization() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_platform_owner_initialization() TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_platform_owner_initialization(_request uuid, _confirm_user uuid, _confirm_email text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.platform_owner_requests%ROWTYPE; u auth.users%ROWTYPE; aid bigint;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'Initialization is completed by controlled administration, not from an app session'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('platform_owner_initialization'));
  IF EXISTS (SELECT 1 FROM public.platform_owner_initialization) OR EXISTS (SELECT 1 FROM public.platform_roles WHERE role = 'platform_owner') THEN
    RAISE EXCEPTION 'Platform Owner is already initialized';
  END IF;
  SELECT * INTO r FROM public.platform_owner_requests WHERE id = _request FOR UPDATE;
  IF NOT FOUND OR r.completed_at IS NOT NULL OR r.expires_at <= now() THEN RAISE EXCEPTION 'Initialization request is missing, used or expired'; END IF;
  IF r.user_id IS DISTINCT FROM _confirm_user OR r.email IS DISTINCT FROM lower(coalesce(_confirm_email, '')) THEN
    RAISE EXCEPTION 'Confirmed account does not match the request';
  END IF;
  SELECT * INTO u FROM auth.users WHERE id = r.user_id;
  IF NOT FOUND OR u.email_confirmed_at IS NULL OR lower(u.email) IS DISTINCT FROM r.email THEN RAISE EXCEPTION 'Account changed since the request'; END IF;
  PERFORM set_config('app.platform_owner_initialization', r.id::text, true);
  INSERT INTO public.platform_roles(user_id, role) VALUES (r.user_id, 'platform_owner');
  PERFORM set_config('app.platform_owner_initialization', '', true);
  INSERT INTO public.audit_logs(org_id, actor_id, action, target_type, target_id, metadata)
  VALUES (NULL, NULL, 'platform_owner.initialized', 'user', r.user_id::text,
          jsonb_build_object('request_id', r.id, 'requested_at', r.requested_at, 'completed_by_database_role', session_user, 'method', 'one-time initialization'))
  RETURNING id INTO aid;
  UPDATE public.platform_owner_requests SET completed_at = now() WHERE id = r.id;
  INSERT INTO public.platform_owner_initialization(owner_id, request_id, audit_id, initialized_by) VALUES (r.user_id, r.id, aid, session_user);
  RETURN jsonb_build_object('owner_id', r.user_id, 'audit_id', aid);
END $$;
REVOKE ALL ON FUNCTION public.complete_platform_owner_initialization(uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
