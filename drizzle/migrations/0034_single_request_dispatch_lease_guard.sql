CREATE FUNCTION public.guard_single_ai_receipt_dispatch() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.single_ai_requests%ROWTYPE;
BEGIN
 PERFORM 1 FROM public.organizations WHERE id=NEW.org_id FOR UPDATE;
 SELECT * INTO a FROM public.single_ai_requests WHERE run_id=NEW.run_id FOR UPDATE;
 IF a.id IS NOT NULL AND (a.status<>'running' OR a.created_at<=now()-interval '15 minutes' OR a.user_id IS DISTINCT FROM NEW.user_id OR a.workspace_id IS DISTINCT FROM NEW.workspace_id OR a.org_id IS DISTINCT FROM NEW.org_id) THEN RAISE EXCEPTION 'Request is closed or expired; recover before dispatch'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_single_ai_receipt_dispatch() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER single_ai_receipt_dispatch_guard BEFORE INSERT ON public.ai_call_receipts FOR EACH ROW EXECUTE FUNCTION public.guard_single_ai_receipt_dispatch();