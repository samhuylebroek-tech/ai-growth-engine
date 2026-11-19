-- PROPOSED migration (not in the journal; not applied to the live database). Staging only via
-- scripts/staging/apply-proposal.ts. Idempotent. Depends on proposal 0057.
--
-- Read-only connectors: credentials, connection health and import history.
-- * Credentials (OAuth refresh tokens, restricted API keys) are stored encrypted in Vault and are
--   readable only through a server-attested function; no app role can select them.
-- * Connection health distinguishes connected, expired, insufficient permissions and errors.
-- * Every import is a run with a unique request key, counts and errors, kept as history.

ALTER TABLE public.connector_connections DROP CONSTRAINT IF EXISTS connector_connections_status_check;
ALTER TABLE public.connector_connections ADD CONSTRAINT connector_connections_status_check
  CHECK (status IN ('not_configured','connected','error','disabled','expired','insufficient_scope'));
ALTER TABLE public.connector_connections ADD COLUMN IF NOT EXISTS account_label text;
ALTER TABLE public.connector_connections ADD COLUMN IF NOT EXISTS scopes text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.connector_connections ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE public.connector_connections ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;
ALTER TABLE public.connector_connections ADD COLUMN IF NOT EXISTS last_sync_at timestamptz;
ALTER TABLE public.connector_connections ADD COLUMN IF NOT EXISTS last_error text;

CREATE TABLE IF NOT EXISTS public.connector_credentials (
  connection_id uuid PRIMARY KEY REFERENCES public.connector_connections(id) ON DELETE CASCADE,
  secret_id uuid NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.connector_credentials FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public.connector_credentials ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.connector_import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  connector_key text NOT NULL,
  request_key uuid NOT NULL,
  months int NOT NULL CHECK (months BETWEEN 1 AND 24),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','partial','failed')),
  created_count int NOT NULL DEFAULT 0, corrected_count int NOT NULL DEFAULT 0,
  unchanged_count int NOT NULL DEFAULT 0, skipped_count int NOT NULL DEFAULT 0,
  error text,
  started_by uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (workspace_id, request_key)
);
CREATE INDEX IF NOT EXISTS connector_import_runs_recent ON public.connector_import_runs(workspace_id, connector_key, started_at DESC);
REVOKE ALL ON public.connector_import_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.connector_import_runs TO authenticated;
GRANT ALL ON public.connector_import_runs TO service_role;
ALTER TABLE public.connector_import_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connector_import_runs_read ON public.connector_import_runs;
CREATE POLICY connector_import_runs_read ON public.connector_import_runs FOR SELECT TO authenticated
  USING (public.has_workspace_role(workspace_id, 'viewer'));

CREATE OR REPLACE FUNCTION public.connector_required_scopes(_connector text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _connector
    WHEN 'google_analytics' THEN ARRAY['https://www.googleapis.com/auth/analytics.readonly']
    WHEN 'search_console' THEN ARRAY['https://www.googleapis.com/auth/webmasters.readonly']
    WHEN 'hubspot' THEN ARRAY['crm.objects.deals.read']
    WHEN 'stripe' THEN ARRAY['read_only_restricted_key']
    ELSE NULL END
$$;

CREATE OR REPLACE FUNCTION public.store_connector_credential_verified(
  _workspace uuid, _connector text, _secret text, _scopes text[], _expires timestamptz,
  _account_label text, _config jsonb, _proof text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w public.workspaces%ROWTYPE; req text[]; st text; conn uuid; cred public.connector_credentials%ROWTYPE; sid uuid;
BEGIN
  PERFORM public.verify_ai_accounting(_proof);
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  req := public.connector_required_scopes(_connector);
  IF req IS NULL THEN RAISE EXCEPTION 'Unknown read-only connector'; END IF;
  SELECT * INTO w FROM public.workspaces WHERE id = _workspace;
  IF NOT FOUND OR NOT public.has_workspace_role(_workspace, 'admin') THEN RAISE EXCEPTION 'Only workspace administrators can connect data sources'; END IF;
  IF _secret IS NULL OR length(_secret) < 10 OR length(_secret) > 8000 THEN RAISE EXCEPTION 'Credential is not valid'; END IF;
  IF _config IS NOT NULL AND (jsonb_typeof(_config) <> 'object' OR length(_config::text) > 2000) THEN RAISE EXCEPTION 'Connection settings are not valid'; END IF;
  st := CASE WHEN coalesce(_scopes, '{}') @> req THEN 'connected' ELSE 'insufficient_scope' END;
  INSERT INTO public.connector_connections(org_id, workspace_id, connector_key, status, config, scopes, expires_at, account_label, last_checked_at, last_error)
  VALUES (w.org_id, w.id, _connector, st, coalesce(_config, '{}'), coalesce(_scopes, '{}'), _expires, left(_account_label, 120), now(), NULL)
  ON CONFLICT (org_id, workspace_id, connector_key) DO UPDATE SET status = EXCLUDED.status, config = EXCLUDED.config,
    scopes = EXCLUDED.scopes, expires_at = EXCLUDED.expires_at, account_label = EXCLUDED.account_label, last_checked_at = now(), last_error = NULL
  RETURNING id INTO conn;
  SELECT * INTO cred FROM public.connector_credentials WHERE connection_id = conn FOR UPDATE;
  IF FOUND THEN
    PERFORM vault.update_secret(cred.secret_id, _secret);
    UPDATE public.connector_credentials SET updated_at = now() WHERE connection_id = conn;
  ELSE
    sid := vault.create_secret(_secret, 'connector:' || conn::text, 'read-only connector credential');
    INSERT INTO public.connector_credentials(connection_id, secret_id, created_by) VALUES (conn, sid, auth.uid());
  END IF;
  INSERT INTO public.audit_logs(org_id, actor_id, action, target_type, target_id, metadata)
  VALUES (w.org_id, auth.uid(), 'connector.connected', 'connector', _connector, jsonb_build_object('workspace_id', w.id, 'status', st, 'scopes', coalesce(_scopes, '{}')));
  RETURN jsonb_build_object('status', st, 'missing_scopes', (SELECT coalesce(array_agg(s), '{}') FROM unnest(req) s WHERE NOT (s = ANY (coalesce(_scopes, '{}')))));
END $$;

CREATE OR REPLACE FUNCTION public.read_connector_credential_verified(_workspace uuid, _connector text, _proof text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.connector_connections%ROWTYPE; s text;
BEGIN
  PERFORM public.verify_ai_accounting(_proof);
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.has_workspace_role(_workspace, 'member') THEN RAISE EXCEPTION 'Data source unavailable'; END IF;
  SELECT * INTO c FROM public.connector_connections WHERE workspace_id = _workspace AND connector_key = _connector;
  IF NOT FOUND THEN RAISE EXCEPTION 'Data source is not connected'; END IF;
  SELECT d.decrypted_secret INTO s FROM public.connector_credentials k JOIN vault.decrypted_secrets d ON d.id = k.secret_id WHERE k.connection_id = c.id;
  IF s IS NULL THEN RAISE EXCEPTION 'Data source is not connected'; END IF;
  RETURN jsonb_build_object('secret', s, 'status', c.status, 'scopes', c.scopes, 'expires_at', c.expires_at, 'config', c.config);
END $$;

CREATE OR REPLACE FUNCTION public.report_connector_health_verified(_workspace uuid, _connector text, _status text, _error text, _proof text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.connector_connections%ROWTYPE;
BEGIN
  PERFORM public.verify_ai_accounting(_proof);
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _status NOT IN ('connected','expired','insufficient_scope','error') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  IF NOT public.has_workspace_role(_workspace, 'member') THEN RAISE EXCEPTION 'Data source unavailable'; END IF;
  SELECT * INTO c FROM public.connector_connections WHERE workspace_id = _workspace AND connector_key = _connector FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.connector_credentials WHERE connection_id = c.id) THEN RAISE EXCEPTION 'Data source is not connected'; END IF;
  UPDATE public.connector_connections SET status = _status, last_checked_at = now(),
    last_error = CASE WHEN _status = 'connected' THEN NULL ELSE left(coalesce(_error, ''), 300) END WHERE id = c.id;
  IF c.status IS DISTINCT FROM _status THEN
    INSERT INTO public.audit_logs(org_id, actor_id, action, target_type, target_id, metadata)
    VALUES (c.org_id, auth.uid(), 'connector.health_changed', 'connector', _connector, jsonb_build_object('workspace_id', _workspace, 'from', c.status, 'to', _status));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.disconnect_connector_verified(_workspace uuid, _connector text, _proof text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.connector_connections%ROWTYPE; k public.connector_credentials%ROWTYPE;
BEGIN
  PERFORM public.verify_ai_accounting(_proof);
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.has_workspace_role(_workspace, 'admin') THEN RAISE EXCEPTION 'Only workspace administrators can disconnect data sources'; END IF;
  SELECT * INTO c FROM public.connector_connections WHERE workspace_id = _workspace AND connector_key = _connector FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO k FROM public.connector_credentials WHERE connection_id = c.id;
  IF FOUND THEN DELETE FROM vault.secrets WHERE id = k.secret_id; DELETE FROM public.connector_credentials WHERE connection_id = c.id; END IF;
  UPDATE public.connector_connections SET status = 'not_configured', scopes = '{}', expires_at = NULL, account_label = NULL, config = '{}', last_error = NULL, last_checked_at = now() WHERE id = c.id;
  INSERT INTO public.audit_logs(org_id, actor_id, action, target_type, target_id, metadata)
  VALUES (c.org_id, auth.uid(), 'connector.disconnected', 'connector', _connector, jsonb_build_object('workspace_id', _workspace));
END $$;

CREATE OR REPLACE FUNCTION public.begin_connector_import_verified(_workspace uuid, _connector text, _request uuid, _months int, _proof text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.connector_connections%ROWTYPE; r public.connector_import_runs%ROWTYPE;
BEGIN
  PERFORM public.verify_ai_accounting(_proof);
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.has_workspace_role(_workspace, 'member') THEN RAISE EXCEPTION 'Data source unavailable'; END IF;
  IF _request IS NULL OR _months IS NULL OR _months < 1 OR _months > 24 THEN RAISE EXCEPTION 'Invalid import request'; END IF;
  SELECT * INTO r FROM public.connector_import_runs WHERE workspace_id = _workspace AND request_key = _request;
  IF FOUND THEN
    IF r.connector_key <> _connector THEN RAISE EXCEPTION 'This request key was already used'; END IF;
    RETURN jsonb_build_object('run_id', r.id, 'status', r.status, 'existing', true);
  END IF;
  SELECT * INTO c FROM public.connector_connections WHERE workspace_id = _workspace AND connector_key = _connector FOR UPDATE;
  IF NOT FOUND OR c.status <> 'connected' THEN RAISE EXCEPTION 'Connector is not connected for this workspace'; END IF;
  IF EXISTS (SELECT 1 FROM public.connector_import_runs WHERE workspace_id = _workspace AND connector_key = _connector AND status = 'running' AND started_at > now() - interval '10 minutes') THEN
    RAISE EXCEPTION 'An import for this data source is already running';
  END IF;
  INSERT INTO public.connector_import_runs(org_id, workspace_id, connector_key, request_key, months, started_by)
  VALUES (c.org_id, _workspace, _connector, _request, _months, auth.uid()) RETURNING * INTO r;
  RETURN jsonb_build_object('run_id', r.id, 'status', r.status, 'existing', false);
END $$;

CREATE OR REPLACE FUNCTION public.finish_connector_import_verified(_run uuid, _status text, _created int, _corrected int, _unchanged int, _skipped int, _error text, _proof text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.connector_import_runs%ROWTYPE;
BEGIN
  PERFORM public.verify_ai_accounting(_proof);
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _status NOT IN ('succeeded','partial','failed') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  SELECT * INTO r FROM public.connector_import_runs WHERE id = _run FOR UPDATE;
  IF NOT FOUND OR r.started_by IS DISTINCT FROM auth.uid() OR NOT public.has_workspace_role(r.workspace_id, 'member') THEN RAISE EXCEPTION 'Import unavailable'; END IF;
  IF r.status <> 'running' THEN RAISE EXCEPTION 'Import already finished'; END IF;
  IF least(_created, _corrected, _unchanged, _skipped) < 0 THEN RAISE EXCEPTION 'Invalid counts'; END IF;
  UPDATE public.connector_import_runs SET status = _status, created_count = _created, corrected_count = _corrected,
    unchanged_count = _unchanged, skipped_count = _skipped, error = left(_error, 500), finished_at = now() WHERE id = _run;
  IF _status IN ('succeeded','partial') THEN
    UPDATE public.connector_connections SET last_sync_at = now() WHERE workspace_id = r.workspace_id AND connector_key = r.connector_key;
  END IF;
END $$;

DO $grants$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.store_connector_credential_verified(uuid,text,text,text[],timestamptz,text,jsonb,text)',
    'public.read_connector_credential_verified(uuid,text,text)',
    'public.report_connector_health_verified(uuid,text,text,text,text)',
    'public.disconnect_connector_verified(uuid,text,text)',
    'public.begin_connector_import_verified(uuid,text,uuid,int,text)',
    'public.finish_connector_import_verified(uuid,text,int,int,int,int,text,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $grants$;
REVOKE ALL ON FUNCTION public.connector_required_scopes(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.connector_required_scopes(text) TO authenticated;
