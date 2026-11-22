-- PROPOSED migration 0091 (staging only until approved): guided onboarding answers as confirmed business facts.
-- * There is no separate onboarding store. An answer is a business fact with source_ref 'Onboarding answer',
--   source_type 'user' and verified = true, so Business Knowledge, the Growth Officer context, reports and the next
--   step read the same records.
-- * Only editors and above save answers, through this role-checked SECURITY DEFINER function, and only for the fixed
--   list of question keys (kept equal to src/lib/onboarding/questions.ts by a unit test).
-- * One answer per question key: a repeated identical answer changes nothing; a changed answer updates the row and
--   writes an audit entry with the previous value; an emptied answer removes it, also audited.
-- * Only confirmed rows count as answers: an unconfirmed row a member added with the same source is ignored.
-- * Concurrent edits: each answer carries the value the person last saw ("expected"); if someone else changed it in
--   the meantime the whole save is refused (AN409) and nothing is written.
-- * Facts from other sources (website, documents, the profile) are never touched: a different answer on the same
--   topic shows up as a conflict for an editor to decide (fact_conflicts), never as a silent overwrite.

CREATE OR REPLACE FUNCTION public.save_business_answers(_workspace uuid, _answers jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  oid uuid; a jsonb; k text; v text; cur public.business_facts; fid uuid;
  saved int := 0; same int := 0; cleared int := 0;
  allowed constant text[] := ARRAY['Customer type','Ideal customer','Customer needs and problems','Customer segments','Repeat purchases','How customers find the business','How enquiries come in','Typical sales cycle','Who decides on a purchase','Why interested people do not buy','Follow-up after an enquiry','Sales and CRM tools','Business challenges','Biggest challenge','Time available for growth each week','Who can help with growth','Room to take on more customers','Content and creative resources','Marketing tools in use','Desired outcomes','Time horizon for results','Priority for the next 30 days','Revenue ambition','Channels not to use','Who must approve work','Activities the business does not want','Rules and regulations to respect','Brand requirements','Geographic limits'];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'answers_forbidden' USING ERRCODE = '42501'; END IF;
  SELECT org_id INTO oid FROM public.workspaces WHERE id = _workspace;
  IF oid IS NULL OR NOT public.has_workspace_role(_workspace, 'editor') THEN RAISE EXCEPTION 'answers_forbidden' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(_answers) IS DISTINCT FROM 'array' OR jsonb_array_length(_answers) NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'answers_invalid' USING ERRCODE = '22023';
  END IF;
  FOR a IN SELECT value FROM jsonb_array_elements(_answers) LOOP
    IF jsonb_typeof(a) IS DISTINCT FROM 'object'
       OR NOT (coalesce(a->>'key', '') = ANY (allowed))
       OR jsonb_typeof(a->'value') IS DISTINCT FROM 'string'
       OR length(a->>'value') > 1000
       OR (a ? 'expected' AND jsonb_typeof(a->'expected') NOT IN ('string', 'null')) THEN
      RAISE EXCEPTION 'answers_invalid' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT x->>'key') FROM jsonb_array_elements(_answers) x) <> jsonb_array_length(_answers) THEN
    RAISE EXCEPTION 'answers_invalid' USING ERRCODE = '22023';
  END IF;
  -- One save per business at a time, so two editors cannot interleave half of each other's answers.
  PERFORM pg_advisory_xact_lock(hashtext('business_answers:' || _workspace::text));
  FOR a IN SELECT value FROM jsonb_array_elements(_answers) LOOP
    k := a->>'key'; v := btrim(a->>'value'); cur := NULL;
    SELECT * INTO cur FROM public.business_facts
      WHERE workspace_id = _workspace AND key = k AND source_ref = 'Onboarding answer' AND verified
      ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    IF a ? 'expected' AND ((cur.id IS NULL AND a->>'expected' IS NOT NULL) OR (cur.id IS NOT NULL AND cur.value IS DISTINCT FROM a->>'expected')) THEN
      RAISE EXCEPTION 'answers_changed' USING ERRCODE = 'AN409';
    END IF;
    IF v = '' THEN
      IF cur.id IS NOT NULL THEN
        DELETE FROM public.business_facts WHERE id = cur.id;
        cleared := cleared + 1;
        PERFORM public.log_audit(oid, 'business_answer.cleared', 'business_fact', cur.id::text, jsonb_build_object('workspace_id', _workspace, 'key', k, 'previous', left(cur.value, 300)));
      END IF;
    ELSIF cur.id IS NULL THEN
      INSERT INTO public.business_facts(org_id, workspace_id, key, value, source_type, source_ref, confidence, verified)
        VALUES (oid, _workspace, k, v, 'user', 'Onboarding answer', 1, true) RETURNING id INTO fid;
      saved := saved + 1;
      PERFORM public.log_audit(oid, 'business_answer.added', 'business_fact', fid::text, jsonb_build_object('workspace_id', _workspace, 'key', k));
    ELSIF cur.value = v THEN
      same := same + 1;
    ELSE
      UPDATE public.business_facts SET value = v, verified = true, confidence = 1, source_type = 'user' WHERE id = cur.id;
      saved := saved + 1;
      PERFORM public.log_audit(oid, 'business_answer.changed', 'business_fact', cur.id::text, jsonb_build_object('workspace_id', _workspace, 'key', k, 'previous', left(cur.value, 300)));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('saved', saved, 'unchanged', same, 'cleared', cleared);
END $$;
REVOKE ALL ON FUNCTION public.save_business_answers(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_business_answers(uuid, jsonb) TO authenticated;
