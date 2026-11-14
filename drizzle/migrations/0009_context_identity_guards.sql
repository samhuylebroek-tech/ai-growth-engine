CREATE OR REPLACE FUNCTION public.guard_context_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE parent_org uuid; parent_workspace uuid;
BEGIN
 IF TG_TABLE_NAME='messages' THEN
  SELECT org_id INTO parent_org FROM public.conversations WHERE id=NEW.conversation_id;
  IF parent_org IS NULL OR parent_org IS DISTINCT FROM NEW.org_id THEN RAISE EXCEPTION 'Conversation organization mismatch'; END IF;
  IF TG_OP='UPDATE' AND (NEW.conversation_id IS DISTINCT FROM OLD.conversation_id OR NEW.org_id IS DISTINCT FROM OLD.org_id) THEN RAISE EXCEPTION 'Message identity is immutable'; END IF;
 ELSE
  IF NEW.workspace_id IS NOT NULL THEN
   SELECT org_id INTO parent_org FROM public.workspaces WHERE id=NEW.workspace_id;
   IF parent_org IS NULL OR parent_org IS DISTINCT FROM NEW.org_id THEN RAISE EXCEPTION 'Workspace organization mismatch'; END IF;
  END IF;
  IF TG_TABLE_NAME='approvals' AND NEW.run_id IS NOT NULL THEN
   SELECT org_id,workspace_id INTO parent_org,parent_workspace FROM public.agent_runs WHERE id=NEW.run_id;
   IF parent_org IS DISTINCT FROM NEW.org_id OR parent_workspace IS DISTINCT FROM NEW.workspace_id THEN RAISE EXCEPTION 'Approval run scope mismatch'; END IF;
  END IF;
  IF TG_TABLE_NAME='documents' AND (NEW.storage_path NOT LIKE NEW.org_id::text||'/'||NEW.workspace_id::text||'/%' OR NEW.storage_path ~ '(^|/)\.\.?(/|$)') THEN RAISE EXCEPTION 'Document storage scope mismatch'; END IF;
  IF TG_OP='UPDATE' THEN
   IF NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN RAISE EXCEPTION 'Context identity is immutable'; END IF;
   IF TG_TABLE_NAME='documents' AND NEW.storage_path IS DISTINCT FROM OLD.storage_path THEN RAISE EXCEPTION 'Document storage identity is immutable'; END IF;
   IF TG_TABLE_NAME='approvals' AND NEW.run_id IS DISTINCT FROM OLD.run_id THEN RAISE EXCEPTION 'Approval run identity is immutable'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER context_identity_messages BEFORE INSERT OR UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION public.guard_context_identity();
CREATE TRIGGER context_identity_documents BEFORE INSERT OR UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.guard_context_identity();
CREATE TRIGGER context_identity_profiles BEFORE INSERT OR UPDATE ON public.business_profiles FOR EACH ROW EXECUTE FUNCTION public.guard_context_identity();
CREATE TRIGGER context_identity_runs BEFORE INSERT OR UPDATE ON public.agent_runs FOR EACH ROW EXECUTE FUNCTION public.guard_context_identity();
CREATE TRIGGER context_identity_approvals BEFORE INSERT OR UPDATE ON public.approvals FOR EACH ROW EXECUTE FUNCTION public.guard_context_identity();