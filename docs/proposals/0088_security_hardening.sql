-- PROPOSED migration 0088 — security hardening. Staging only until separately approved.
-- Requires 0058 (append-only audit), 0064 (execution pause), 0065 (external action gate), 0086 (credit prices).
-- Idempotent. What it changes:
--  1. Least privilege: internal execution helpers are no longer callable through the API (they leaked another
--     workspace's settings or task facts to anyone who knew an id); TRUNCATE/REFERENCES/TRIGGER removed from API roles.
--  2. The audit log can no longer be written directly by signed-in sessions (members could add misleading entries);
--     member role changes, removals, organization changes, approval policies and subscriptions are audited by
--     database triggers in the same transaction instead of by a separate browser call.
--  3. Tamper evidence: every new audit entry is linked into one SHA-256 hash chain; the Platform Owner can verify it.
--     Entries from before this change stay as they are and are reported as "not chained", never rewritten.
--  4. Two-step verification: credit prices, credit adjustments, plans, entitlements, subscriptions and the platform
--     stop require a session verified with a second factor (JWT aal2), in addition to the exact Platform Owner role.
--  5. Security events: refused owner-center access is recorded (bounded per user) and summarized for the owner.
--  6. Emergency stop at organization and platform level on top of the per-business pause; a business admin cannot
--     lift a stop placed by the organization or the platform. Existing pauses are kept.
--  7. Document plan limits are enforced by the database (rows and stored files), not only by the browser.

-- 1. Least privilege ----------------------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.task_execution_settings(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.task_open_dependencies(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.task_priority_score(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.execution_user_allowed(uuid, uuid) FROM PUBLIC, anon, authenticated;
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m') LOOP
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM PUBLIC, anon, authenticated', r.relname);
  END LOOP;
END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM PUBLIC, anon, authenticated;

-- 2. Audit writes only from the database ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.log_audit(uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.audit_admin_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE act text; org uuid; tgt text; meta jsonb;
BEGIN
  IF TG_TABLE_NAME = 'organization_members' THEN
    IF TG_OP = 'DELETE' THEN
      act := CASE WHEN OLD.user_id = auth.uid() THEN 'member.left' ELSE 'member.removed' END;
      org := OLD.org_id; tgt := OLD.user_id::text; meta := jsonb_build_object('role', OLD.role);
    ELSE
      IF NEW.role IS NOT DISTINCT FROM OLD.role THEN RETURN NEW; END IF;
      act := 'member.role_changed'; org := NEW.org_id; tgt := NEW.user_id::text; meta := jsonb_build_object('from', OLD.role, 'to', NEW.role);
    END IF;
  ELSIF TG_TABLE_NAME = 'organizations' THEN
    IF NEW.name IS NOT DISTINCT FROM OLD.name AND NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.parent_org_id IS NOT DISTINCT FROM OLD.parent_org_id AND NEW.type IS NOT DISTINCT FROM OLD.type THEN RETURN NEW; END IF;
    act := 'organization.updated'; org := NEW.id; tgt := NEW.id::text;
    meta := jsonb_build_object('name_changed', NEW.name IS DISTINCT FROM OLD.name, 'from_status', OLD.status, 'to_status', NEW.status);
  ELSIF TG_TABLE_NAME = 'policies' THEN
    IF TG_OP = 'DELETE' THEN
      act := 'policy.changed'; org := OLD.org_id; tgt := OLD.capability_key; meta := jsonb_build_object('op', 'delete', 'from', OLD.mode);
    ELSIF TG_OP = 'INSERT' THEN
      act := 'policy.changed'; org := NEW.org_id; tgt := NEW.capability_key; meta := jsonb_build_object('op', 'insert', 'to', NEW.mode);
    ELSE
      IF NEW.mode IS NOT DISTINCT FROM OLD.mode THEN RETURN NEW; END IF;
      act := 'policy.changed'; org := NEW.org_id; tgt := NEW.capability_key; meta := jsonb_build_object('op', 'update', 'from', OLD.mode, 'to', NEW.mode);
    END IF;
  ELSIF TG_TABLE_NAME = 'subscriptions' THEN
    IF NEW.plan_key IS NOT DISTINCT FROM OLD.plan_key AND NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.billing_cycle IS NOT DISTINCT FROM OLD.billing_cycle THEN RETURN NEW; END IF;
    act := 'subscription.changed'; org := NEW.org_id; tgt := NEW.org_id::text;
    meta := jsonb_build_object('from_plan', OLD.plan_key, 'to_plan', NEW.plan_key, 'from_status', OLD.status, 'to_status', NEW.status);
  ELSE
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  INSERT INTO public.audit_logs(org_id, actor_id, action, target_type, target_id, metadata)
  VALUES (org, auth.uid(), act, TG_TABLE_NAME, tgt, meta || jsonb_build_object('recorded_by', 'database'));
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION public.audit_admin_change() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS audit_member_changes ON public.organization_members;
CREATE TRIGGER audit_member_changes AFTER UPDATE OR DELETE ON public.organization_members FOR EACH ROW EXECUTE FUNCTION public.audit_admin_change();
DROP TRIGGER IF EXISTS audit_org_changes ON public.organizations;
CREATE TRIGGER audit_org_changes AFTER UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.audit_admin_change();
DROP TRIGGER IF EXISTS audit_policy_changes ON public.policies;
CREATE TRIGGER audit_policy_changes AFTER INSERT OR UPDATE OR DELETE ON public.policies FOR EACH ROW EXECUTE FUNCTION public.audit_admin_change();
DROP TRIGGER IF EXISTS audit_subscription_changes ON public.subscriptions;
CREATE TRIGGER audit_subscription_changes AFTER UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.audit_admin_change();

-- 3. Tamper-evident hash chain ----------------------------------------------------------------------------------------
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS chain_seq bigint;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS prev_hash text;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS row_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS audit_logs_chain_seq_key ON public.audit_logs(chain_seq) WHERE chain_seq IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_logs_actor_action_time ON public.audit_logs(actor_id, created_at DESC) WHERE action LIKE 'security.%';
COMMENT ON COLUMN public.audit_logs.row_hash IS 'SHA-256 over this entry and prev_hash (0088); NULL for entries written before the chain started';

CREATE TABLE IF NOT EXISTS public.audit_chain_head (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  seq bigint NOT NULL,
  hash text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.audit_chain_head FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.audit_chain_head TO service_role;
ALTER TABLE public.audit_chain_head ENABLE ROW LEVEL SECURITY;
INSERT INTO public.audit_chain_head(id, seq, hash) VALUES (true, 0, 'genesis') ON CONFLICT (id) DO NOTHING;

-- Length-prefixed fields, so no value can be shifted into a neighbouring field without changing the hash.
CREATE OR REPLACE FUNCTION public.audit_row_hash(_seq bigint, _prev text, _id bigint, _org uuid, _actor uuid, _action text,
  _target_type text, _target_id text, _meta jsonb, _at timestamptz) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT encode(sha256(convert_to(string_agg(length(v)::text || ':' || v, '|' ORDER BY i), 'UTF8')), 'hex')
  FROM unnest(ARRAY[_seq::text, coalesce(_prev, ''), _id::text, coalesce(_org::text, ''), coalesce(_actor::text, ''),
    coalesce(_action, ''), coalesce(_target_type, ''), coalesce(_target_id, ''), coalesce(_meta, '{}'::jsonb)::text,
    to_char(_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')]) WITH ORDINALITY AS f(v, i)
$$;
REVOKE ALL ON FUNCTION public.audit_row_hash(bigint, text, bigint, uuid, uuid, text, text, text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.audit_chain_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE h public.audit_chain_head;
BEGIN
  -- The row lock serializes chain extension; a waiting transaction re-reads the latest head after the lock.
  SELECT * INTO h FROM public.audit_chain_head WHERE id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'audit chain head missing'; END IF;
  NEW.chain_seq := h.seq + 1;
  NEW.prev_hash := h.hash;
  NEW.row_hash := public.audit_row_hash(NEW.chain_seq, NEW.prev_hash, NEW.id, NEW.org_id, NEW.actor_id, NEW.action,
    NEW.target_type, NEW.target_id, NEW.metadata, NEW.created_at);
  UPDATE public.audit_chain_head SET seq = NEW.chain_seq, hash = NEW.row_hash WHERE id;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.audit_chain_link() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS audit_logs_chain ON public.audit_logs;
CREATE TRIGGER audit_logs_chain BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.audit_chain_link();

CREATE OR REPLACE FUNCTION public.verify_audit_chain() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; h public.audit_chain_head; expected_prev text := 'genesis'; expected_seq bigint := 1; n bigint := 0;
        problem jsonb; unchained bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_platform_role('platform_owner') THEN
    RAISE EXCEPTION 'only the Platform Owner verifies the audit chain' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO h FROM public.audit_chain_head WHERE id;
  FOR r IN SELECT * FROM public.audit_logs WHERE chain_seq IS NOT NULL ORDER BY chain_seq LOOP
    IF r.chain_seq <> expected_seq THEN problem := jsonb_build_object('kind', 'missing_entry', 'seq', expected_seq); EXIT; END IF;
    IF r.prev_hash IS DISTINCT FROM expected_prev THEN problem := jsonb_build_object('kind', 'broken_link', 'seq', r.chain_seq, 'id', r.id); EXIT; END IF;
    IF r.row_hash IS DISTINCT FROM public.audit_row_hash(r.chain_seq, r.prev_hash, r.id, r.org_id, r.actor_id, r.action,
         r.target_type, r.target_id, r.metadata, r.created_at) THEN
      problem := jsonb_build_object('kind', 'altered_entry', 'seq', r.chain_seq, 'id', r.id); EXIT;
    END IF;
    expected_prev := r.row_hash; expected_seq := expected_seq + 1; n := n + 1;
  END LOOP;
  IF problem IS NULL AND (h.seq IS DISTINCT FROM n OR h.hash IS DISTINCT FROM expected_prev) THEN
    problem := jsonb_build_object('kind', CASE WHEN h.seq > n THEN 'missing_latest_entries' ELSE 'head_mismatch' END, 'seq', n);
  END IF;
  SELECT count(*) INTO unchained FROM public.audit_logs WHERE chain_seq IS NULL;
  RETURN jsonb_build_object('ok', problem IS NULL, 'checked', n, 'head_seq', h.seq, 'head_hash', h.hash,
    'started_at', h.started_at, 'unchained_before_start', unchained, 'problem', problem, 'checked_at', now());
END $$;
REVOKE ALL ON FUNCTION public.verify_audit_chain() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_audit_chain() TO authenticated;

-- 4. Two-step verification for platform administration ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.session_mfa_verified() RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$ SELECT coalesce(auth.jwt()->>'aal', '') = 'aal2' $$;
REVOKE ALL ON FUNCTION public.session_mfa_verified() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.session_mfa_verified() TO authenticated;

CREATE OR REPLACE FUNCTION public.set_credit_price(_scope text, _plan text, _currency text, _price numeric, _effective_from timestamptz, _methodology text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE id_ uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_platform_role('platform_owner') THEN RAISE EXCEPTION 'only the Platform Owner sets credit prices' USING ERRCODE = '42501'; END IF;
  IF NOT public.session_mfa_verified() THEN RAISE EXCEPTION 'mfa_required' USING ERRCODE = '42501', HINT = 'two-step verification required'; END IF;
  IF _scope NOT IN ('platform','plan') OR ((_scope = 'plan') <> (_plan IS NOT NULL)) OR upper(coalesce(_currency,'')) !~ '^[A-Z]{3}$'
     OR _price IS NULL OR _price <= 0 OR _price >= 1000 OR length(trim(coalesce(_methodology,''))) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'invalid credit price' USING ERRCODE = '22023';
  END IF;
  IF _effective_from IS NULL OR _effective_from < now() - interval '5 minutes' THEN RAISE EXCEPTION 'credit_price_backdated' USING ERRCODE = 'P0001'; END IF;
  IF _plan IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.plans WHERE key = _plan) THEN RAISE EXCEPTION 'invalid credit price' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.credit_price_versions(scope, plan_key, currency, price_per_credit, effective_from, methodology, created_by)
  VALUES (_scope, _plan, upper(_currency), _price, _effective_from, trim(_methodology), auth.uid()) RETURNING id INTO id_;
  PERFORM public.log_audit(NULL, 'platform.credit_price_set', 'credit_price', id_::text,
    jsonb_build_object('scope', _scope, 'plan', _plan, 'currency', upper(_currency), 'price', _price, 'effective_from', _effective_from, 'mfa', true));
  RETURN id_;
END $$;

CREATE OR REPLACE FUNCTION public.admin_grant_credits(_org uuid, _amount integer, _note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_platform_role('platform_owner') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT public.session_mfa_verified() THEN RAISE EXCEPTION 'mfa_required' USING ERRCODE = '42501', HINT = 'two-step verification required'; END IF;
  IF _amount IS NULL OR _amount = 0 OR abs(_amount) > 100000 THEN RAISE EXCEPTION 'credit adjustment must be between -100000 and 100000 and not zero' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = _org) THEN RAISE EXCEPTION 'organization not found' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.credit_ledger(org_id, delta, reason, ref, created_by) VALUES (_org, _amount, 'adjustment', left(coalesce(_note, ''), 100), auth.uid());
  INSERT INTO public.audit_logs(org_id, actor_id, action, target_type, target_id, metadata)
  VALUES (_org, auth.uid(), 'credits.adjusted', 'organization', _org::text, jsonb_build_object('amount', _amount, 'note', left(coalesce(_note, ''), 200), 'mfa', true));
END $$;

ALTER POLICY "staff manage plans" ON public.plans
  USING (public.has_platform_role('platform_owner') AND public.session_mfa_verified())
  WITH CHECK (public.has_platform_role('platform_owner') AND public.session_mfa_verified());
ALTER POLICY "staff manage entitlements" ON public.plan_entitlements
  USING (public.has_platform_role('platform_owner') AND public.session_mfa_verified())
  WITH CHECK (public.has_platform_role('platform_owner') AND public.session_mfa_verified());
ALTER POLICY "platform owner updates sub" ON public.subscriptions
  USING (public.has_platform_role('platform_owner') AND public.session_mfa_verified())
  WITH CHECK (public.has_platform_role('platform_owner') AND public.session_mfa_verified());

-- 5. Security events ----------------------------------------------------------------------------------------------------
-- A refused request is recorded by the server after the refusal (the refused transaction itself rolls back). The event is
-- always attributed to the calling session, so nobody can record events in someone else's name; at most 30 per hour.
CREATE OR REPLACE FUNCTION public.record_security_event(_kind text, _detail jsonb DEFAULT '{}'::jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE recent int; d jsonb := coalesce(_detail, '{}'::jsonb);
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  IF _kind IS NULL OR _kind NOT IN ('owner_access_denied','owner_mfa_required','credit_price_denied','platform_stop_denied') THEN
    RAISE EXCEPTION 'unknown security event' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(d) <> 'object' OR length(d::text) > 1000 THEN d := '{}'::jsonb; END IF;
  SELECT count(*) INTO recent FROM public.audit_logs
  WHERE actor_id = auth.uid() AND action LIKE 'security.%' AND created_at > now() - interval '1 hour';
  IF recent >= 30 THEN RETURN false; END IF;
  INSERT INTO public.audit_logs(org_id, actor_id, action, target_type, target_id, metadata)
  VALUES (NULL, auth.uid(), 'security.' || _kind, 'security', NULL, d || jsonb_build_object('reported_by', 'session'));
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.record_security_event(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_security_event(text, jsonb) TO authenticated;

-- Deterministic summary for the Platform Owner: refusals by kind, users with repeated refusals, and organizations whose
-- AI credit use in the last 24 hours is far above their own 7-day daily average. Signals, not proof of an attack.
CREATE OR REPLACE FUNCTION public.security_overview(_days int DEFAULT 7) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE d int := least(greatest(coalesce(_days, 7), 1), 90);
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_platform_role('platform_owner') THEN
    RAISE EXCEPTION 'only the Platform Owner reads security events' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'days', d,
    'by_kind', coalesce((SELECT jsonb_object_agg(action, n) FROM (SELECT action, count(*)::int n FROM public.audit_logs
        WHERE action LIKE 'security.%' AND created_at > now() - make_interval(days => d) GROUP BY action) x), '{}'::jsonb),
    'repeated', coalesce((SELECT jsonb_agg(jsonb_build_object('actor', actor_id, 'count', n, 'last', last) ORDER BY n DESC) FROM (
        SELECT actor_id, count(*)::int n, max(created_at) last FROM public.audit_logs
        WHERE action LIKE 'security.%' AND created_at > now() - make_interval(days => d) GROUP BY actor_id HAVING count(*) >= 3 LIMIT 20) y), '[]'::jsonb),
    'credit_spikes', coalesce((SELECT jsonb_agg(jsonb_build_object('org', org_id, 'last_24h', a, 'daily_avg_7d', round(b, 1)) ORDER BY a DESC) FROM (
        SELECT org_id,
          sum(credits_charged) FILTER (WHERE created_at > now() - interval '24 hours')::int a,
          coalesce(sum(credits_charged) FILTER (WHERE created_at <= now() - interval '24 hours'), 0) / 7.0 b
        FROM public.ai_usage_events WHERE created_at > now() - interval '8 days' GROUP BY org_id) z
        WHERE a >= 20 AND a > 3 * b LIMIT 20), '[]'::jsonb),
    'stops', coalesce((SELECT jsonb_agg(jsonb_build_object('scope', scope, 'org', org_id, 'reason', reason, 'started_at', started_at))
        FROM public.execution_stops WHERE ended_at IS NULL), '[]'::jsonb),
    'generated_at', now());
END $$;
REVOKE ALL ON FUNCTION public.security_overview(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.security_overview(int) TO authenticated;

-- 6. Emergency stop at organization and platform level --------------------------------------------------------------------
-- execution_settings.paused stays the single value every gate reads (task_run_gate, start_task_run_verified,
-- external_action_gate, cycles); it is now derived from three independent stops so no level can lift another's.
ALTER TABLE public.execution_settings ADD COLUMN IF NOT EXISTS workspace_paused boolean NOT NULL DEFAULT false;
ALTER TABLE public.execution_settings ADD COLUMN IF NOT EXISTS org_paused boolean NOT NULL DEFAULT false;
ALTER TABLE public.execution_settings ADD COLUMN IF NOT EXISTS platform_paused boolean NOT NULL DEFAULT false;
UPDATE public.execution_settings SET workspace_paused = true WHERE paused AND NOT workspace_paused AND NOT org_paused AND NOT platform_paused;

CREATE OR REPLACE FUNCTION public.execution_effective_pause() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.paused := NEW.workspace_paused OR NEW.org_paused OR NEW.platform_paused; RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.execution_effective_pause() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS execution_settings_effective_pause ON public.execution_settings;
CREATE TRIGGER execution_settings_effective_pause BEFORE INSERT OR UPDATE ON public.execution_settings
  FOR EACH ROW EXECUTE FUNCTION public.execution_effective_pause();

CREATE TABLE IF NOT EXISTS public.execution_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('organization','platform')),
  org_id uuid REFERENCES public.organizations(id),
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 300),
  workspaces int NOT NULL DEFAULT 0,
  started_by uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_by uuid,
  ended_at timestamptz,
  CHECK ((scope = 'platform') = (org_id IS NULL)),
  CHECK ((ended_at IS NULL) = (ended_by IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS execution_stops_one_active ON public.execution_stops
  (scope, coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE ended_at IS NULL;
REVOKE ALL ON public.execution_stops FROM PUBLIC, anon;
GRANT SELECT ON public.execution_stops TO authenticated;
GRANT ALL ON public.execution_stops TO service_role;
ALTER TABLE public.execution_stops ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS execution_stops_read ON public.execution_stops;
CREATE POLICY execution_stops_read ON public.execution_stops FOR SELECT TO authenticated
  USING (scope = 'platform' OR public.is_org_member(org_id) OR public.is_platform_staff());

CREATE OR REPLACE FUNCTION public.set_execution_paused(_workspace uuid, _paused boolean, _reason text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.execution_settings; n text := nullif(left(trim(coalesce(_reason, '')), 300), '');
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_workspace_role(_workspace, 'admin') THEN RAISE EXCEPTION 'Pausing AI work requires workspace admin permission'; END IF;
  s := public.task_execution_settings(_workspace);
  INSERT INTO public.execution_settings(workspace_id, org_id, mode, max_credits_per_run, monthly_credit_cap, updated_by, updated_at, workspace_paused, pause_reason, paused_by, paused_at)
  VALUES (_workspace, s.org_id, s.mode, s.max_credits_per_run, s.monthly_credit_cap, auth.uid(), now(), _paused,
    CASE WHEN _paused THEN n END, CASE WHEN _paused THEN auth.uid() END, CASE WHEN _paused THEN now() END)
  ON CONFLICT (workspace_id) DO UPDATE SET workspace_paused = EXCLUDED.workspace_paused, pause_reason = EXCLUDED.pause_reason,
    paused_by = EXCLUDED.paused_by, paused_at = EXCLUDED.paused_at, updated_by = auth.uid(), updated_at = now();
  IF _paused THEN
    UPDATE public.execution_cycles SET status = 'stopped', finished_at = now(), stop_reason = 'paused' WHERE workspace_id = _workspace AND status = 'open';
  END IF;
  PERFORM public.log_audit(s.org_id, CASE WHEN _paused THEN 'execution.paused' ELSE 'execution.resumed' END, 'workspace', _workspace::text, jsonb_build_object('reason', n));
  RETURN to_jsonb(public.task_execution_settings(_workspace));
END $$;
REVOKE ALL ON FUNCTION public.set_execution_paused(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_execution_paused(uuid, boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_execution_stop(_scope text, _org uuid, _on boolean) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  IF _on THEN
    INSERT INTO public.execution_settings(workspace_id, org_id, updated_by, updated_at, org_paused, platform_paused)
    SELECT w.id, w.org_id, auth.uid(), now(), _scope = 'organization', _scope = 'platform' FROM public.workspaces w
    WHERE _org IS NULL OR w.org_id = _org
    ON CONFLICT (workspace_id) DO UPDATE SET
      org_paused = execution_settings.org_paused OR _scope = 'organization',
      platform_paused = execution_settings.platform_paused OR _scope = 'platform',
      updated_by = auth.uid(), updated_at = now();
    GET DIAGNOSTICS n = ROW_COUNT;
    UPDATE public.execution_cycles c SET status = 'stopped', finished_at = now(), stop_reason = 'paused'
    WHERE c.status = 'open' AND (_org IS NULL OR c.workspace_id IN (SELECT id FROM public.workspaces WHERE org_id = _org));
  ELSE
    UPDATE public.execution_settings SET
      org_paused = CASE WHEN _scope = 'organization' THEN false ELSE org_paused END,
      platform_paused = CASE WHEN _scope = 'platform' THEN false ELSE platform_paused END,
      updated_by = auth.uid(), updated_at = now()
    WHERE (_org IS NULL OR org_id = _org) AND ((_scope = 'organization' AND org_paused) OR (_scope = 'platform' AND platform_paused));
    GET DIAGNOSTICS n = ROW_COUNT;
  END IF;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.apply_execution_stop(text, uuid, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_org_execution_stop(_org uuid, _stop boolean, _reason text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE st public.execution_stops; n int; r text := left(trim(coalesce(_reason, '')), 300);
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_org_role(_org, 'admin') THEN
    RAISE EXCEPTION 'Stopping AI work for the organization requires organization admin permission' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO st FROM public.execution_stops WHERE scope = 'organization' AND org_id = _org AND ended_at IS NULL FOR UPDATE;
  IF _stop THEN
    IF FOUND THEN RETURN to_jsonb(st); END IF;
    IF length(r) < 3 THEN RAISE EXCEPTION 'Give a reason for the stop' USING ERRCODE = '22023'; END IF;
    n := public.apply_execution_stop('organization', _org, true);
    INSERT INTO public.execution_stops(scope, org_id, reason, workspaces, started_by) VALUES ('organization', _org, r, n, auth.uid()) RETURNING * INTO st;
    PERFORM public.log_audit(_org, 'execution.org_stopped', 'organization', _org::text, jsonb_build_object('reason', r, 'workspaces', n));
  ELSE
    IF NOT FOUND THEN RETURN NULL; END IF;
    n := public.apply_execution_stop('organization', _org, false);
    UPDATE public.execution_stops SET ended_at = now(), ended_by = auth.uid() WHERE id = st.id RETURNING * INTO st;
    PERFORM public.log_audit(_org, 'execution.org_resumed', 'organization', _org::text, jsonb_build_object('workspaces', n, 'stop', st.id));
  END IF;
  RETURN to_jsonb(st);
END $$;
REVOKE ALL ON FUNCTION public.set_org_execution_stop(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_org_execution_stop(uuid, boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_platform_execution_stop(_stop boolean, _reason text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE st public.execution_stops; n int; r text := left(trim(coalesce(_reason, '')), 300);
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_platform_role('platform_owner') THEN RAISE EXCEPTION 'only the Platform Owner stops the platform' USING ERRCODE = '42501'; END IF;
  IF NOT public.session_mfa_verified() THEN RAISE EXCEPTION 'mfa_required' USING ERRCODE = '42501', HINT = 'two-step verification required'; END IF;
  SELECT * INTO st FROM public.execution_stops WHERE scope = 'platform' AND ended_at IS NULL FOR UPDATE;
  IF _stop THEN
    IF FOUND THEN RETURN to_jsonb(st); END IF;
    IF length(r) < 3 THEN RAISE EXCEPTION 'Give a reason for the stop' USING ERRCODE = '22023'; END IF;
    n := public.apply_execution_stop('platform', NULL, true);
    INSERT INTO public.execution_stops(scope, org_id, reason, workspaces, started_by) VALUES ('platform', NULL, r, n, auth.uid()) RETURNING * INTO st;
    PERFORM public.log_audit(NULL, 'execution.platform_stopped', 'platform', NULL, jsonb_build_object('reason', r, 'workspaces', n, 'mfa', true));
  ELSE
    IF NOT FOUND THEN RETURN NULL; END IF;
    n := public.apply_execution_stop('platform', NULL, false);
    UPDATE public.execution_stops SET ended_at = now(), ended_by = auth.uid() WHERE id = st.id RETURNING * INTO st;
    PERFORM public.log_audit(NULL, 'execution.platform_resumed', 'platform', NULL, jsonb_build_object('workspaces', n, 'stop', st.id, 'mfa', true));
  END IF;
  RETURN to_jsonb(st);
END $$;
REVOKE ALL ON FUNCTION public.set_platform_execution_stop(boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_platform_execution_stop(boolean, text) TO authenticated;

-- A business created during a stop starts stopped.
CREATE OR REPLACE FUNCTION public.workspace_inherits_stop() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o boolean; p boolean;
BEGIN
  o := EXISTS (SELECT 1 FROM public.execution_stops WHERE scope = 'organization' AND org_id = NEW.org_id AND ended_at IS NULL);
  p := EXISTS (SELECT 1 FROM public.execution_stops WHERE scope = 'platform' AND ended_at IS NULL);
  IF o OR p THEN
    INSERT INTO public.execution_settings(workspace_id, org_id, updated_at, org_paused, platform_paused)
    VALUES (NEW.id, NEW.org_id, now(), o, p) ON CONFLICT (workspace_id) DO UPDATE SET org_paused = EXCLUDED.org_paused, platform_paused = EXCLUDED.platform_paused;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.workspace_inherits_stop() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS workspace_inherits_stop ON public.workspaces;
CREATE TRIGGER workspace_inherits_stop AFTER INSERT ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.workspace_inherits_stop();

-- 7. Document plan limits in the database -----------------------------------------------------------------------------------
-- No subscription or no "documents" entitlement = not included; a NULL limit on an existing entitlement = unlimited.
CREATE OR REPLACE FUNCTION public.document_capacity(_org uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE included boolean; lim int; used int; files int;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(_org) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT true, e.limit_value INTO included, lim FROM public.subscriptions s JOIN public.plan_entitlements e ON e.plan_key = s.plan_key
  WHERE s.org_id = _org AND e.feature_key = 'documents';
  SELECT count(*) INTO used FROM public.documents WHERE org_id = _org;
  SELECT count(*) INTO files FROM storage.objects WHERE bucket_id = 'documents' AND split_part(name, '/', 1) = _org::text;
  RETURN jsonb_build_object('included', coalesce(included, false), 'limit', lim, 'used', used, 'stored_files', files);
END $$;
REVOKE ALL ON FUNCTION public.document_capacity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.document_capacity(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.document_upload_allowed(_path text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE o uuid; included boolean; lim int; files int;
BEGIN
  BEGIN o := split_part(_path, '/', 1)::uuid; EXCEPTION WHEN invalid_text_representation THEN RETURN false; END;
  SELECT true, e.limit_value INTO included, lim FROM public.subscriptions s JOIN public.plan_entitlements e ON e.plan_key = s.plan_key
  WHERE s.org_id = o AND e.feature_key = 'documents';
  IF NOT coalesce(included, false) THEN RETURN false; END IF;
  IF lim IS NULL THEN RETURN true; END IF;
  -- Stored files (not only registered documents) count, so files without a document record cannot exceed the plan.
  SELECT count(*) INTO files FROM storage.objects WHERE bucket_id = 'documents' AND split_part(name, '/', 1) = o::text;
  RETURN files < lim;
END $$;
REVOKE ALL ON FUNCTION public.document_upload_allowed(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.document_upload_allowed(text) TO authenticated;

DROP POLICY IF EXISTS "documents within plan" ON storage.objects;
CREATE POLICY "documents within plan" ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (bucket_id <> 'documents' OR public.document_upload_allowed(name));

CREATE OR REPLACE FUNCTION public.enforce_document_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE included boolean; lim int; used int;
BEGIN
  -- Lock the organization's subscription so concurrent uploads are counted one after another.
  PERFORM 1 FROM public.subscriptions WHERE org_id = NEW.org_id FOR UPDATE;
  SELECT true, e.limit_value INTO included, lim FROM public.subscriptions s JOIN public.plan_entitlements e ON e.plan_key = s.plan_key
  WHERE s.org_id = NEW.org_id AND e.feature_key = 'documents';
  IF NOT coalesce(included, false) THEN RAISE EXCEPTION 'documents_not_included' USING ERRCODE = '42501', HINT = 'The current plan does not include documents'; END IF;
  IF lim IS NOT NULL THEN
    SELECT count(*) INTO used FROM public.documents WHERE org_id = NEW.org_id;
    IF used >= lim THEN RAISE EXCEPTION 'document_limit_reached' USING ERRCODE = '42501', HINT = format('The plan allows %s documents', lim); END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_document_limit() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS documents_plan_limit ON public.documents;
CREATE TRIGGER documents_plan_limit BEFORE INSERT ON public.documents FOR EACH ROW EXECUTE FUNCTION public.enforce_document_limit();
