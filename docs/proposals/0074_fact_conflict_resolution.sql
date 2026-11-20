-- PROPOSED migration 0074 (staging only until approved): resolve conflicting business facts in one step.
-- Before: two facts with the same topic but different values (e.g. two prices) could both be confirmed, and the
-- Growth Officer then read both as verified. Fixing it meant several separate edits with no record of why.
-- Now an editor of the business picks the value to keep: in one transaction that fact is confirmed, the other
-- facts on the same topic are set back to "needs review" (never deleted, so their history and any evidence
-- pointing at them stay traceable), and the decision is written to the audit log. Only facts of one business
-- and one topic can be resolved together. Idempotent: CREATE OR REPLACE only.

CREATE OR REPLACE FUNCTION public.fact_topic(_key text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT lower(btrim(regexp_replace(regexp_replace(coalesce(_key, ''), '[[:punct:]]+', ' ', 'g'), '\s+', ' ', 'g')))
$$;

CREATE OR REPLACE FUNCTION public.resolve_fact_conflict(_keep uuid, _others uuid[], _note text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k public.business_facts; n int; changed int;
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
  PERFORM public.log_audit(k.org_id, 'facts.conflict_resolved', 'business_fact', _keep::text,
    jsonb_build_object('workspace_id', k.workspace_id, 'topic', public.fact_topic(k.key), 'kept', _keep,
                       'set_to_review', to_jsonb(_others), 'note', coalesce(_note, '')));
  RETURN jsonb_build_object('kept', _keep, 'set_to_review', changed);
END $$;
REVOKE ALL ON FUNCTION public.resolve_fact_conflict(uuid, uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_fact_conflict(uuid, uuid[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fact_topic(text) TO authenticated;
