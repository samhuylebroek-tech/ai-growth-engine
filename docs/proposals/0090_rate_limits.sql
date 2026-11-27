-- PROPOSED migration 0090 (staging only until approved): rate limits per person, business and organization.
-- * Limits live in rate_limit_policies (action, scope, window, maximum). Platform values, readable by signed-in
--   users so the app can explain a limit; nobody changes them through the app.
-- * Every counted attempt is one row in rate_limit_events. Nobody can read, write or delete these rows through the
--   API; only the SECURITY DEFINER functions below write them, so a limit cannot be reset by the user.
-- * AI requests and file uploads are counted by triggers on agent_runs, documents and file notes (execution_notes), so every path (also
--   inside other database functions) is limited and the app cannot skip the check. A refused attempt raises
--   SQLSTATE RL429 "rate_limited:<action>:<scope>:<seconds>" and the whole insert is rolled back: no AI run is
--   created and no credits are reserved.
-- * Website checks and data-source connections fetch outside the database first, so the server asks
--   consume_rate_limit() before it fetches; that function only counts for members of the business.
-- * Failed attempts (refused website targets, rejected connection tokens, missing permission) are recorded with
--   record_failed_attempt(); 10 within 15 minutes pause that person's website checks and connections for the rest
--   of that window. Provider outages are not counted against a person.
-- * Checks for one organization are serialized with a transaction advisory lock, so parallel requests cannot slip
--   past a maximum. Rows older than 2 days are pruned as new rows arrive (no scheduled job).

CREATE TABLE IF NOT EXISTS public.rate_limit_policies (
  action text NOT NULL CHECK (action IN ('ai','upload','seo','connect','failure')),
  scope text NOT NULL CHECK (scope IN ('user','workspace','organization')),
  window_seconds int NOT NULL CHECK (window_seconds BETWEEN 60 AND 86400),
  max_count int NOT NULL CHECK (max_count BETWEEN 1 AND 100000),
  PRIMARY KEY (action, scope, window_seconds)
);
REVOKE ALL ON public.rate_limit_policies FROM anon;
GRANT SELECT ON public.rate_limit_policies TO authenticated;
GRANT ALL ON public.rate_limit_policies TO service_role;
ALTER TABLE public.rate_limit_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "signed-in users read rate limits" ON public.rate_limit_policies;
CREATE POLICY "signed-in users read rate limits" ON public.rate_limit_policies FOR SELECT TO authenticated USING (true);

INSERT INTO public.rate_limit_policies(action, scope, window_seconds, max_count) VALUES
  ('ai','user',60,10), ('ai','user',3600,60), ('ai','workspace',3600,200), ('ai','organization',3600,500),
  ('upload','user',600,20), ('upload','user',3600,60), ('upload','workspace',3600,150),
  ('seo','user',600,5), ('seo','user',3600,20), ('seo','workspace',3600,40), ('seo','organization',86400,150),
  ('connect','user',900,5), ('connect','workspace',3600,20),
  ('failure','user',900,10)
ON CONFLICT (action, scope, window_seconds) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.rate_limit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action text NOT NULL CHECK (action IN ('ai','upload','seo','connect','failure')),
  user_id uuid NOT NULL,
  org_id uuid,
  workspace_id uuid,
  detail text NOT NULL DEFAULT '' CHECK (length(detail) <= 40),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rate_limit_events_user_idx ON public.rate_limit_events(action, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rate_limit_events_ws_idx ON public.rate_limit_events(action, workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rate_limit_events_org_idx ON public.rate_limit_events(action, org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rate_limit_events_age_idx ON public.rate_limit_events(created_at);
REVOKE ALL ON public.rate_limit_events FROM anon, authenticated;
GRANT ALL ON public.rate_limit_events TO service_role;
ALTER TABLE public.rate_limit_events ENABLE ROW LEVEL SECURITY;

-- Seconds until the attempt would be allowed, or 0. Internal: not executable through the API.
CREATE OR REPLACE FUNCTION public.rl_wait(_action text, _scope text, _id uuid, _window int, _max int)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((
    SELECT greatest(1, ceil(extract(epoch FROM (e.created_at + make_interval(secs => _window) - now())))::int)
    FROM public.rate_limit_events e
    WHERE e.action = _action AND e.created_at > now() - make_interval(secs => _window)
      AND CASE _scope WHEN 'user' THEN e.user_id = _id WHEN 'workspace' THEN e.workspace_id = _id ELSE e.org_id = _id END
    ORDER BY e.created_at DESC OFFSET _max - 1 LIMIT 1), 0)
$$;

-- Checks every policy for the action (and the failure pause for website checks / connections), then counts the
-- attempt. Returns NULL when allowed, otherwise {scope, retry_after}. Internal.
CREATE OR REPLACE FUNCTION public.rl_take(_action text, _user uuid, _org uuid, _workspace uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; w int; worst int := 0; worst_scope text;
BEGIN
  IF _user IS NULL THEN RETURN jsonb_build_object('scope','user','retry_after',60); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('rate_limit:' || coalesce(_org::text, _user::text), 0));
  FOR p IN SELECT * FROM public.rate_limit_policies
           WHERE action = _action OR (action = 'failure' AND _action IN ('seo','connect')) LOOP
    CONTINUE WHEN (p.scope = 'workspace' AND _workspace IS NULL) OR (p.scope = 'organization' AND _org IS NULL);
    w := public.rl_wait(p.action, p.scope,
           CASE p.scope WHEN 'user' THEN _user WHEN 'workspace' THEN _workspace ELSE _org END, p.window_seconds, p.max_count);
    IF w > worst THEN worst := w; worst_scope := CASE WHEN p.action = 'failure' THEN 'failures' ELSE p.scope END; END IF;
  END LOOP;
  IF worst > 0 THEN RETURN jsonb_build_object('scope', worst_scope, 'retry_after', worst); END IF;
  INSERT INTO public.rate_limit_events(action, user_id, org_id, workspace_id) VALUES (_action, _user, _org, _workspace);
  DELETE FROM public.rate_limit_events WHERE id IN (
    SELECT id FROM public.rate_limit_events WHERE created_at < now() - interval '2 days' ORDER BY created_at LIMIT 200);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.rl_guard_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a text := TG_ARGV[0]; j jsonb := to_jsonb(NEW); r jsonb;
BEGIN
  r := public.rl_take(a, (CASE WHEN a = 'upload' THEN coalesce(j->>'uploaded_by', j->>'created_by') ELSE j->>'user_id' END)::uuid,
                      (j->>'org_id')::uuid, (j->>'workspace_id')::uuid);
  IF r IS NOT NULL THEN
    RAISE EXCEPTION 'rate_limited:%:%:%', a, r->>'scope', r->>'retry_after' USING ERRCODE = 'RL429';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS agent_runs_rate_limit ON public.agent_runs;
CREATE TRIGGER agent_runs_rate_limit BEFORE INSERT ON public.agent_runs
  FOR EACH ROW EXECUTE FUNCTION public.rl_guard_insert('ai');
DROP TRIGGER IF EXISTS documents_rate_limit ON public.documents;
CREATE TRIGGER documents_rate_limit BEFORE INSERT ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.rl_guard_insert('upload');
DROP TRIGGER IF EXISTS execution_files_rate_limit ON public.execution_notes;
CREATE TRIGGER execution_files_rate_limit BEFORE INSERT ON public.execution_notes
  FOR EACH ROW WHEN (NEW.kind = 'asset' AND NEW.storage_path IS NOT NULL) EXECUTE FUNCTION public.rl_guard_insert('upload');

-- Called by the server before a website check or a data-source connection fetches anything.
CREATE OR REPLACE FUNCTION public.consume_rate_limit(_action text, _workspace uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o uuid; r jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  IF _action NOT IN ('seo','connect') THEN RAISE EXCEPTION 'unknown rate-limited action' USING ERRCODE = '22023'; END IF;
  IF NOT public.has_workspace_role(_workspace, 'member') THEN
    RETURN jsonb_build_object('allowed', false, 'scope', 'forbidden', 'retry_after', 0);
  END IF;
  SELECT org_id INTO o FROM public.workspaces WHERE id = _workspace;
  r := public.rl_take(_action, auth.uid(), o, _workspace);
  IF r IS NULL THEN RETURN jsonb_build_object('allowed', true); END IF;
  RETURN jsonb_build_object('allowed', false) || r;
END $$;

-- Records one failed attempt by the caller (at most 50 per hour are kept, so the table cannot be flooded).
CREATE OR REPLACE FUNCTION public.record_failed_attempt(_action text, _workspace uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ws uuid; o uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  IF _action NOT IN ('seo','connect') THEN RAISE EXCEPTION 'unknown rate-limited action' USING ERRCODE = '22023'; END IF;
  IF _workspace IS NOT NULL AND public.has_workspace_role(_workspace, 'viewer') THEN
    ws := _workspace; SELECT org_id INTO o FROM public.workspaces WHERE id = _workspace;
  END IF;
  IF (SELECT count(*) FROM public.rate_limit_events WHERE action = 'failure' AND user_id = auth.uid()
      AND created_at > now() - interval '1 hour') >= 50 THEN RETURN; END IF;
  INSERT INTO public.rate_limit_events(action, user_id, org_id, workspace_id, detail)
  VALUES ('failure', auth.uid(), o, ws, _action);
END $$;

REVOKE ALL ON FUNCTION public.rl_wait(text, text, uuid, int, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rl_take(text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rl_guard_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_rate_limit(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_failed_attempt(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_failed_attempt(text, uuid) TO authenticated;

-- A refused upload (rate limit or plan limit) leaves the stored file without a document record. Until now only
-- admins could remove document files, so a member's refused upload stayed behind and counted against the plan.
-- The person who uploaded a file may now remove it while no document record points to it; recorded files keep
-- the admin-only rule.
CREATE OR REPLACE FUNCTION public.document_file_unrecorded(_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.documents WHERE storage_path = _name)
$$;
REVOKE ALL ON FUNCTION public.document_file_unrecorded(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.document_file_unrecorded(text) TO authenticated;
DROP POLICY IF EXISTS "uploader removes unrecorded document file" ON storage.objects;
CREATE POLICY "uploader removes unrecorded document file" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'documents' AND owner_id = auth.uid()::text AND public.document_path_access(name, 'member')
         AND public.document_file_unrecorded(name));
DROP POLICY IF EXISTS "workspace storage delete" ON storage.objects;
CREATE POLICY "workspace storage delete" ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
  USING (bucket_id <> 'documents' OR public.document_path_access(name, 'admin')
         OR (owner_id = auth.uid()::text AND public.document_path_access(name, 'member') AND public.document_file_unrecorded(name)));
