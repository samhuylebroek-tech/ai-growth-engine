-- PROPOSED migration 0076 (staging only until approved): recorded business checks (monitoring log).
-- A business check is a snapshot taken when a team member starts it: which records were inspected per area
-- (financial, marketing, sales, customers, operations), which findings the deterministic rules produced, and what
-- changed since the previous check (new / still open / resolved). It costs no AI credits. Checks are insert-only.
-- The check frequency (off / daily / weekly / monthly) only marks a check as due on screen: nothing runs in the
-- background, so the platform never claims continuous monitoring.

CREATE TABLE IF NOT EXISTS public.business_check_settings (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  frequency text NOT NULL DEFAULT 'off' CHECK (frequency IN ('off','daily','weekly','monthly')),
  updated_by uuid NOT NULL DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.business_check_settings FROM anon, authenticated;
GRANT SELECT ON public.business_check_settings TO authenticated;
GRANT ALL ON public.business_check_settings TO service_role;
ALTER TABLE public.business_check_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "check settings readable by business" ON public.business_check_settings;
CREATE POLICY "check settings readable by business" ON public.business_check_settings
  FOR SELECT TO authenticated USING (public.has_workspace_role(workspace_id, 'viewer'));

CREATE TABLE IF NOT EXISTS public.business_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  kind text NOT NULL CHECK (kind IN ('manual','daily','weekly','monthly','after_campaign','after_experiment')),
  subject_id uuid,
  inspected jsonb NOT NULL CHECK (jsonb_typeof(inspected) = 'object' AND length(inspected::text) <= 4000),
  findings jsonb NOT NULL CHECK (jsonb_typeof(findings) = 'array' AND jsonb_array_length(findings) <= 100),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_id uuid REFERENCES public.business_checks(id),
  actor_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind IN ('after_campaign','after_experiment')) = (subject_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS business_checks_scope ON public.business_checks (workspace_id, created_at DESC);
REVOKE ALL ON public.business_checks FROM anon, authenticated;
GRANT SELECT ON public.business_checks TO authenticated;
GRANT ALL ON public.business_checks TO service_role;
ALTER TABLE public.business_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "business checks readable by business" ON public.business_checks;
CREATE POLICY "business checks readable by business" ON public.business_checks
  FOR SELECT TO authenticated USING (public.has_workspace_role(workspace_id, 'viewer'));
DROP TRIGGER IF EXISTS business_checks_immutable ON public.business_checks;
CREATE TRIGGER business_checks_immutable BEFORE UPDATE OR DELETE ON public.business_checks
  FOR EACH ROW EXECUTE FUNCTION public.decision_history_immutable();

-- Records one check. Findings are validated item by item; the change summary is computed here from the previous
-- check of the same business, so it cannot be supplied by the caller. At most one check per business per minute.
CREATE OR REPLACE FUNCTION public.record_business_check(_workspace uuid, _kind text, _subject uuid,
  _inspected jsonb, _findings jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w public.workspaces; prev public.business_checks; id_ uuid; f jsonb; ids text[] := '{}'; prev_ids text[] := '{}';
  n_new int; n_resolved int; n_open int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  SELECT * INTO w FROM public.workspaces WHERE id = _workspace;
  IF w.id IS NULL OR NOT public.has_workspace_role(w.id, 'member') THEN RAISE EXCEPTION 'business not found' USING ERRCODE = '42501'; END IF;
  IF _kind NOT IN ('manual','daily','weekly','monthly','after_campaign','after_experiment')
     OR _inspected IS NULL OR jsonb_typeof(_inspected) <> 'object' OR length(_inspected::text) > 4000
     OR _findings IS NULL OR jsonb_typeof(_findings) <> 'array' OR jsonb_array_length(_findings) > 100
     OR ((_kind IN ('after_campaign','after_experiment')) <> (_subject IS NOT NULL)) THEN
    RAISE EXCEPTION 'invalid business check' USING ERRCODE = '22023';
  END IF;
  IF _kind = 'after_campaign' AND NOT EXISTS (SELECT 1 FROM public.campaigns WHERE id = _subject AND workspace_id = w.id) THEN
    RAISE EXCEPTION 'campaign not found' USING ERRCODE = '22023';
  END IF;
  IF _kind = 'after_experiment' AND NOT EXISTS (SELECT 1 FROM public.growth_experiments WHERE id = _subject AND workspace_id = w.id) THEN
    RAISE EXCEPTION 'experiment not found' USING ERRCODE = '22023';
  END IF;
  FOR f IN SELECT * FROM jsonb_array_elements(_findings) LOOP
    IF jsonb_typeof(f) <> 'object' OR coalesce(f->>'id', '') !~ '^[a-z_]+(:[A-Za-z0-9_-]{1,80}){0,3}$'
       OR coalesce(f->>'code', '') !~ '^[a-z_]{1,60}$'
       OR coalesce(f->>'kind', '') NOT IN ('conflict','stale','missing','risk','opportunity')
       OR coalesce(f->>'impact', '') NOT IN ('high','medium','low')
       OR jsonb_typeof(coalesce(f->'vars', '{}'::jsonb)) <> 'object' OR length(f::text) > 1200 THEN
      RAISE EXCEPTION 'invalid finding' USING ERRCODE = '22023';
    END IF;
    ids := ids || (f->>'id');
  END LOOP;
  PERFORM 1 FROM public.workspaces WHERE id = w.id FOR UPDATE;  -- serialise checks per business
  SELECT * INTO prev FROM public.business_checks WHERE workspace_id = w.id ORDER BY created_at DESC LIMIT 1;
  IF prev.id IS NOT NULL AND prev.created_at > now() - interval '60 seconds' THEN
    RAISE EXCEPTION 'check_too_soon' USING ERRCODE = 'P0001', HINT = 'wait one minute';
  END IF;
  IF prev.id IS NOT NULL THEN
    SELECT coalesce(array_agg(e->>'id'), '{}') INTO prev_ids FROM jsonb_array_elements(prev.findings) e;
  END IF;
  SELECT count(*) INTO n_new FROM unnest(ids) x WHERE NOT x = ANY(prev_ids);
  SELECT count(*) INTO n_resolved FROM unnest(prev_ids) x WHERE NOT x = ANY(ids);
  n_open := cardinality(ids) - n_new;
  INSERT INTO public.business_checks(org_id, workspace_id, kind, subject_id, inspected, findings, summary, previous_id)
  VALUES (w.org_id, w.id, _kind, _subject, _inspected, _findings,
          jsonb_build_object('findings', cardinality(ids), 'new', n_new, 'still_open', n_open, 'resolved', n_resolved,
                             'first', prev.id IS NULL),
          prev.id)
  RETURNING id INTO id_;
  PERFORM public.log_audit(w.org_id, 'monitoring.check_recorded', 'workspace', w.id::text,
    jsonb_build_object('check', id_, 'kind', _kind, 'findings', cardinality(ids), 'new', n_new, 'resolved', n_resolved));
  RETURN jsonb_build_object('id', id_, 'new', n_new, 'still_open', n_open, 'resolved', n_resolved, 'first', prev.id IS NULL);
END $$;
REVOKE ALL ON FUNCTION public.record_business_check(uuid, text, uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_business_check(uuid, text, uuid, jsonb, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_business_check_frequency(_workspace uuid, _frequency text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w public.workspaces;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  IF _frequency NOT IN ('off','daily','weekly','monthly') THEN RAISE EXCEPTION 'invalid frequency' USING ERRCODE = '22023'; END IF;
  SELECT * INTO w FROM public.workspaces WHERE id = _workspace;
  IF w.id IS NULL OR NOT public.has_workspace_role(w.id, 'admin') THEN RAISE EXCEPTION 'business not found' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.business_check_settings(workspace_id, org_id, frequency, updated_by, updated_at)
  VALUES (w.id, w.org_id, _frequency, auth.uid(), now())
  ON CONFLICT (workspace_id) DO UPDATE SET frequency = excluded.frequency, updated_by = excluded.updated_by, updated_at = now();
  PERFORM public.log_audit(w.org_id, 'monitoring.frequency_set', 'workspace', w.id::text, jsonb_build_object('frequency', _frequency));
END $$;
REVOKE ALL ON FUNCTION public.set_business_check_frequency(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_business_check_frequency(uuid, text) TO authenticated;
