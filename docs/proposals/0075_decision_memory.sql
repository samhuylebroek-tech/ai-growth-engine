-- PROPOSED migration 0075 (staging only until approved): remembered decisions about conflicts and recommendations.
-- 1. Fact conflicts get a history: each resolution, "review started" and "reopened" is an insert-only event with a
--    snapshot of every value on the topic at that moment, who decided, when and why. Earlier decisions stay
--    checkable; the conflict status (open / in review / resolved / disputed again) is derived from these events.
-- 2. Recommendation decisions: an editor can postpone (until a date) or dismiss a next best action, or restore it.
--    Each decision stores a fingerprint of what the recommendation was based on, so a dismissed recommendation only
--    returns when its information changes, not on the next page load. Insert-only; nothing is ever deleted.
-- Both are scoped to one business (workspace) and readable only by people assigned to that business.

CREATE TABLE IF NOT EXISTS public.fact_conflict_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  topic text NOT NULL CHECK (length(topic) BETWEEN 1 AND 200),
  kind text NOT NULL CHECK (kind IN ('review_started','resolved','reopened')),
  kept_fact_id uuid,
  kept_value text CHECK (kept_value IS NULL OR length(kept_value) <= 2000),
  snapshot jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(snapshot) = 'array'),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  actor_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'resolved') = (kept_fact_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS fact_conflict_events_scope ON public.fact_conflict_events (workspace_id, topic, created_at DESC);
REVOKE ALL ON public.fact_conflict_events FROM anon, authenticated;
GRANT SELECT ON public.fact_conflict_events TO authenticated;
GRANT ALL ON public.fact_conflict_events TO service_role;
ALTER TABLE public.fact_conflict_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fact conflict events readable by business" ON public.fact_conflict_events;
CREATE POLICY "fact conflict events readable by business" ON public.fact_conflict_events
  FOR SELECT TO authenticated USING (public.has_workspace_role(workspace_id, 'viewer'));

CREATE TABLE IF NOT EXISTS public.recommendation_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  item_key text NOT NULL CHECK (item_key ~ '^[a-z_]+:[^[:space:]]{1,250}$'),
  decision text NOT NULL CHECK (decision IN ('postponed','dismissed','restored')),
  until date,
  fingerprint text NOT NULL CHECK (length(fingerprint) BETWEEN 1 AND 200),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  actor_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((decision = 'postponed') = (until IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS recommendation_decisions_scope ON public.recommendation_decisions (workspace_id, item_key, created_at DESC);
REVOKE ALL ON public.recommendation_decisions FROM anon, authenticated;
GRANT SELECT ON public.recommendation_decisions TO authenticated;
GRANT ALL ON public.recommendation_decisions TO service_role;
ALTER TABLE public.recommendation_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recommendation decisions readable by business" ON public.recommendation_decisions;
CREATE POLICY "recommendation decisions readable by business" ON public.recommendation_decisions
  FOR SELECT TO authenticated USING (public.has_workspace_role(workspace_id, 'viewer'));

-- Insert-only, also for privileged sessions: history cannot be edited away.
CREATE OR REPLACE FUNCTION public.decision_history_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'decision history is insert-only' USING ERRCODE = '42501'; END $$;
REVOKE ALL ON FUNCTION public.decision_history_immutable() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS fact_conflict_events_immutable ON public.fact_conflict_events;
CREATE TRIGGER fact_conflict_events_immutable BEFORE UPDATE OR DELETE ON public.fact_conflict_events
  FOR EACH ROW EXECUTE FUNCTION public.decision_history_immutable();
DROP TRIGGER IF EXISTS recommendation_decisions_immutable ON public.recommendation_decisions;
CREATE TRIGGER recommendation_decisions_immutable BEFORE UPDATE OR DELETE ON public.recommendation_decisions
  FOR EACH ROW EXECUTE FUNCTION public.decision_history_immutable();

-- Every value on one topic of one business, as it is now (for the event snapshot).
CREATE OR REPLACE FUNCTION public.fact_topic_snapshot(_workspace uuid, _topic text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'value', f.value, 'source_type', f.source_type,
           'source_ref', f.source_ref, 'verified', f.verified, 'created_at', f.created_at) ORDER BY f.created_at), '[]'::jsonb)
  FROM public.business_facts f WHERE f.workspace_id = _workspace AND public.fact_topic(f.key) = _topic
$$;
REVOKE ALL ON FUNCTION public.fact_topic_snapshot(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.resolve_fact_conflict(_keep uuid, _others uuid[], _note text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k public.business_facts; n int; changed int; ev uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  IF _keep IS NULL OR _others IS NULL OR cardinality(_others) NOT BETWEEN 1 AND 20 OR _keep = ANY(_others)
     OR length(coalesce(_note, '')) > 500 THEN
    RAISE EXCEPTION 'invalid conflict resolution' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.business_facts WHERE id = _keep OR id = ANY(_others) ORDER BY id FOR UPDATE;
  SELECT * INTO k FROM public.business_facts WHERE id = _keep;
  IF k.id IS NULL OR NOT public.has_workspace_role(k.workspace_id, 'editor') THEN
    RAISE EXCEPTION 'fact not found' USING ERRCODE = '42501';
  END IF;
  SELECT count(*) INTO n FROM public.business_facts WHERE id = ANY(_others);
  IF n <> cardinality(_others) THEN RAISE EXCEPTION 'fact not found' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.business_facts WHERE id = ANY(_others)
             AND (workspace_id <> k.workspace_id OR org_id <> k.org_id)) THEN
    RAISE EXCEPTION 'facts belong to different businesses' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.business_facts WHERE id = ANY(_others) AND public.fact_topic(key) <> public.fact_topic(k.key)) THEN
    RAISE EXCEPTION 'facts are about different topics' USING ERRCODE = '22023';
  END IF;
  UPDATE public.business_facts SET verified = true WHERE id = _keep AND NOT verified;
  UPDATE public.business_facts SET verified = false WHERE id = ANY(_others) AND verified;
  GET DIAGNOSTICS changed = ROW_COUNT;
  INSERT INTO public.fact_conflict_events(org_id, workspace_id, topic, kind, kept_fact_id, kept_value, snapshot, note)
  VALUES (k.org_id, k.workspace_id, public.fact_topic(k.key), 'resolved', k.id, k.value,
          public.fact_topic_snapshot(k.workspace_id, public.fact_topic(k.key)), coalesce(_note, ''))
  RETURNING id INTO ev;
  PERFORM public.log_audit(k.org_id, 'facts.conflict_resolved', 'business_fact', _keep::text,
    jsonb_build_object('workspace_id', k.workspace_id, 'topic', public.fact_topic(k.key), 'kept', _keep,
                       'set_to_review', to_jsonb(_others), 'note', coalesce(_note, ''), 'event', ev));
  RETURN jsonb_build_object('kept', _keep, 'set_to_review', changed, 'event', ev);
END $$;
REVOKE ALL ON FUNCTION public.resolve_fact_conflict(uuid, uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_fact_conflict(uuid, uuid[], text) TO authenticated;

-- "Review started" or "reopened" on a topic that exists in this business.
CREATE OR REPLACE FUNCTION public.mark_fact_conflict(_workspace uuid, _topic text, _kind text, _note text DEFAULT '')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w public.workspaces; t text := public.fact_topic(_topic); ev uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  IF _kind NOT IN ('review_started','reopened') OR t = '' OR length(coalesce(_note, '')) > 500 THEN
    RAISE EXCEPTION 'invalid conflict status' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO w FROM public.workspaces WHERE id = _workspace;
  IF w.id IS NULL OR NOT public.has_workspace_role(w.id, 'editor') THEN RAISE EXCEPTION 'business not found' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.business_facts WHERE workspace_id = w.id AND public.fact_topic(key) = t) THEN
    RAISE EXCEPTION 'topic not found' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.fact_conflict_events(org_id, workspace_id, topic, kind, snapshot, note)
  VALUES (w.org_id, w.id, t, _kind, public.fact_topic_snapshot(w.id, t), coalesce(_note, '')) RETURNING id INTO ev;
  PERFORM public.log_audit(w.org_id, 'facts.conflict_' || _kind, 'workspace', w.id::text,
    jsonb_build_object('topic', t, 'event', ev, 'note', coalesce(_note, '')));
  RETURN ev;
END $$;
REVOKE ALL ON FUNCTION public.mark_fact_conflict(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_fact_conflict(uuid, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.decide_recommendation(_workspace uuid, _key text, _decision text, _until date,
  _fingerprint text, _note text DEFAULT '')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w public.workspaces; id_ uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  SELECT * INTO w FROM public.workspaces WHERE id = _workspace;
  IF w.id IS NULL OR NOT public.has_workspace_role(w.id, 'editor') THEN RAISE EXCEPTION 'business not found' USING ERRCODE = '42501'; END IF;
  IF _decision NOT IN ('postponed','dismissed','restored') OR _key IS NULL OR _key !~ '^[a-z_]+:[^[:space:]]{1,250}$'
     OR _fingerprint IS NULL OR length(_fingerprint) NOT BETWEEN 1 AND 200 OR length(coalesce(_note, '')) > 500
     OR (_decision = 'postponed') <> (_until IS NOT NULL)
     OR (_until IS NOT NULL AND (_until <= current_date OR _until > current_date + 180)) THEN
    RAISE EXCEPTION 'invalid recommendation decision' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.recommendation_decisions(org_id, workspace_id, item_key, decision, until, fingerprint, note)
  VALUES (w.org_id, w.id, _key, _decision, _until, _fingerprint, coalesce(_note, '')) RETURNING id INTO id_;
  PERFORM public.log_audit(w.org_id, 'recommendation.' || _decision, 'workspace', w.id::text,
    jsonb_build_object('item', _key, 'until', _until, 'decision', id_));
  RETURN id_;
END $$;
REVOKE ALL ON FUNCTION public.decide_recommendation(uuid, text, text, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_recommendation(uuid, text, text, date, text, text) TO authenticated;
