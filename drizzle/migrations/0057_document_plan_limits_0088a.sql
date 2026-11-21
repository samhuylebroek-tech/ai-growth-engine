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