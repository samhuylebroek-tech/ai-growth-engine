CREATE OR REPLACE FUNCTION public.guard_context_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE parent_org uuid; parent_workspace uuid; n jsonb:=to_jsonb(NEW); o jsonb;
BEGIN
 IF TG_OP='UPDATE' THEN o:=to_jsonb(OLD); END IF;
 IF TG_TABLE_NAME='messages' THEN
  SELECT org_id INTO parent_org FROM public.conversations WHERE id=(n->>'conversation_id')::uuid;
  IF parent_org IS NULL OR parent_org IS DISTINCT FROM (n->>'org_id')::uuid THEN RAISE EXCEPTION 'Conversation organization mismatch'; END IF;
  IF TG_OP='UPDATE' AND (n->>'conversation_id' IS DISTINCT FROM o->>'conversation_id' OR n->>'org_id' IS DISTINCT FROM o->>'org_id') THEN RAISE EXCEPTION 'Message identity is immutable'; END IF;
 ELSE
  IF n->>'workspace_id' IS NOT NULL THEN
   SELECT org_id INTO parent_org FROM public.workspaces WHERE id=(n->>'workspace_id')::uuid;
   IF parent_org IS NULL OR parent_org IS DISTINCT FROM (n->>'org_id')::uuid THEN RAISE EXCEPTION 'Workspace organization mismatch'; END IF;
  END IF;
  IF TG_TABLE_NAME='approvals' AND n->>'run_id' IS NOT NULL THEN
   SELECT org_id,workspace_id INTO parent_org,parent_workspace FROM public.agent_runs WHERE id=(n->>'run_id')::uuid;
   IF parent_org IS DISTINCT FROM (n->>'org_id')::uuid OR parent_workspace IS DISTINCT FROM (n->>'workspace_id')::uuid THEN RAISE EXCEPTION 'Approval run scope mismatch'; END IF;
  END IF;
  IF TG_TABLE_NAME='documents' AND (n->>'storage_path' NOT LIKE (n->>'org_id')||'/'||(n->>'workspace_id')||'/%' OR n->>'storage_path' ~ '(^|/)\.\.?(/|$)') THEN RAISE EXCEPTION 'Document storage scope mismatch'; END IF;
  IF TG_OP='UPDATE' THEN
   IF n->>'org_id' IS DISTINCT FROM o->>'org_id' OR n->>'workspace_id' IS DISTINCT FROM o->>'workspace_id' THEN RAISE EXCEPTION 'Context identity is immutable'; END IF;
   IF TG_TABLE_NAME='documents' AND n->>'storage_path' IS DISTINCT FROM o->>'storage_path' THEN RAISE EXCEPTION 'Document storage identity is immutable'; END IF;
   IF TG_TABLE_NAME='approvals' AND n->>'run_id' IS DISTINCT FROM o->>'run_id' THEN RAISE EXCEPTION 'Approval run identity is immutable'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;