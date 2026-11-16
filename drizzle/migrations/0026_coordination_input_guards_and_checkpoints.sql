ALTER TABLE public.coordinated_analyses ADD COLUMN partial_results jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE FUNCTION public.validate_coordinated_input() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE ref jsonb; row_id uuid; exists_here boolean; seen text[]:='{}'; identity text; kind text;
BEGIN
 IF NEW.input->>'request' IS NULL OR length(trim(NEW.input->>'request')) NOT BETWEEN 3 AND 4000 THEN RAISE EXCEPTION 'invalid coordinated assignment'; END IF;
 FOR ref IN SELECT value FROM jsonb_array_elements(NEW.input->'executionContext') LOOP
  kind:=ref->>'kind';
  IF kind IS NULL OR kind NOT IN ('projects','tasks','campaigns','approvals','activity_events') OR ref->>'id' IS NULL THEN RAISE EXCEPTION 'invalid coordinated reference'; END IF;
  BEGIN row_id:=(ref->>'id')::uuid; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid coordinated reference'; END;
  identity:=kind||':'||row_id::text;
  IF identity=ANY(seen) THEN RAISE EXCEPTION 'duplicate coordinated reference'; END IF; seen:=array_append(seen,identity);
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE id=$1 AND org_id=$2 AND workspace_id=$3%s)',kind,CASE WHEN kind='approvals' THEN ' AND status IN (''approved'',''executed'')' ELSE '' END) INTO exists_here USING row_id,NEW.org_id,NEW.workspace_id;
  IF NOT exists_here THEN RAISE EXCEPTION 'coordinated reference unavailable'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER coordinated_input_validation BEFORE INSERT ON public.coordinated_analyses FOR EACH ROW EXECUTE FUNCTION public.validate_coordinated_input();
CREATE FUNCTION public.checkpoint_coordinated_analysis(_id uuid,_step integer,_text text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.coordinated_analyses%ROWTYPE;
BEGIN
 SELECT * INTO a FROM public.coordinated_analyses WHERE id=_id FOR UPDATE;
 IF a.id IS NULL OR a.user_id<>auth.uid() OR NOT public.has_workspace_role(a.workspace_id,'member') THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF a.status<>'running' OR _step IS NULL OR _step NOT BETWEEN 0 AND 2 OR _text IS NULL OR length(_text) NOT BETWEEN 1 AND 80000 THEN RAISE EXCEPTION 'invalid analysis checkpoint'; END IF;
 IF a.partial_results ? _step::text THEN
  IF a.partial_results->>_step::text IS DISTINCT FROM _text THEN RAISE EXCEPTION 'analysis checkpoint is immutable'; END IF;
  RETURN;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ai_credit_reservations WHERE run_id=a.run_ids[_step+1] AND status='settled') THEN RAISE EXCEPTION 'checkpoint usage incomplete'; END IF;
 UPDATE public.coordinated_analyses SET partial_results=jsonb_set(partial_results,ARRAY[_step::text],to_jsonb(_text),true) WHERE id=a.id;
END $$;
REVOKE ALL ON FUNCTION public.checkpoint_coordinated_analysis(uuid,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.checkpoint_coordinated_analysis(uuid,integer,text) TO authenticated;