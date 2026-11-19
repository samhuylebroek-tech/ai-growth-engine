-- PROPOSED migration (not in the journal; not applied anywhere). New migration files can only be created
-- by the platform migration tool, which also applies them to the live database, so this waits for the
-- owner's approval of live migrations. Verified on staging inside a rolled-back transaction with
-- scripts/staging/try-proposal.ts.
--
-- Read-only integration imports into performance tracking.
-- 1. Connection status can no longer be written by browser sessions: "connected" must come from a
--    server-attested connection flow, never from an admin editing a row (no app code writes it).
-- 2. Imported results enter only through a server-attested function, only for a connector that is
--    connected in the same workspace, and only as kind imported_actual with the connector as source.
--    Re-syncing a period records a correction of the previous import instead of a duplicate.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.connector_connections FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.import_measurement_verified(
  _metric uuid, _connector text, _period_start date, _period_end date, _value numeric,
  _source_ref text, _request uuid, _proof text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m public.metric_definitions%ROWTYPE;
  prior public.performance_measurements%ROWTYPE;
  live public.performance_measurements%ROWTYPE;
  new_id uuid;
BEGIN
  PERFORM public.verify_ai_accounting(_proof);
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF _connector IS NULL OR _connector NOT IN ('google_analytics','search_console','stripe','hubspot') THEN
    RAISE EXCEPTION 'Unknown read-only connector';
  END IF;
  IF _request IS NULL THEN RAISE EXCEPTION 'Request key required'; END IF;
  SELECT * INTO m FROM public.metric_definitions WHERE id = _metric FOR UPDATE;
  IF NOT FOUND OR NOT public.has_workspace_role(m.workspace_id, 'member') THEN RAISE EXCEPTION 'Metric unavailable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.connector_connections c
                 WHERE c.org_id = m.org_id AND c.workspace_id = m.workspace_id
                   AND c.connector_key = _connector AND c.status = 'connected') THEN
    RAISE EXCEPTION 'Connector is not connected for this workspace';
  END IF;
  SELECT * INTO prior FROM public.performance_measurements WHERE workspace_id = m.workspace_id AND request_key = _request;
  IF FOUND THEN
    IF prior.metric_id = m.id AND prior.kind = 'imported_actual' AND prior.source = _connector
       AND prior.period_start = _period_start AND prior.period_end = _period_end AND prior.value = _value THEN
      RETURN jsonb_build_object('measurement_id', prior.id, 'status', 'existing');
    END IF;
    RAISE EXCEPTION 'This request key was already used for a different value';
  END IF;
  IF m.archived THEN RAISE EXCEPTION 'Archived metrics do not accept new values'; END IF;
  IF _period_start IS NULL OR _period_end IS NULL OR _period_end < _period_start OR _period_end - _period_start > 366 THEN
    RAISE EXCEPTION 'Invalid measurement period';
  END IF;
  IF _value IS NULL OR (m.unit IN ('count','currency','days','ratio') AND _value < 0)
     OR (m.unit = 'percent' AND (_value < -1000 OR _value > 1000)) THEN
    RAISE EXCEPTION 'Value is not valid for this metric';
  END IF;
  SELECT p.* INTO live FROM public.performance_measurements p
   WHERE p.metric_id = m.id AND p.kind = 'imported_actual' AND p.source = _connector
     AND p.period_start = _period_start AND p.period_end = _period_end
     AND NOT EXISTS (SELECT 1 FROM public.performance_measurements c WHERE c.corrects_id = p.id)
   LIMIT 1;
  IF FOUND AND live.value = _value THEN
    RETURN jsonb_build_object('measurement_id', live.id, 'status', 'unchanged');
  END IF;
  INSERT INTO public.performance_measurements(org_id, workspace_id, metric_id, period_start, period_end, kind, value,
    source, source_ref, note, request_key, corrects_id, created_by)
  VALUES (m.org_id, m.workspace_id, m.id, _period_start, _period_end, 'imported_actual', _value,
    _connector, left(coalesce(_source_ref,''),300), '', _request, live.id, auth.uid())
  RETURNING id INTO new_id;
  RETURN jsonb_build_object('measurement_id', new_id, 'status', CASE WHEN live.id IS NULL THEN 'created' ELSE 'corrected' END);
END;
$$;
REVOKE ALL ON FUNCTION public.import_measurement_verified(uuid,text,date,date,numeric,text,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_measurement_verified(uuid,text,date,date,numeric,text,uuid,text) TO authenticated;
