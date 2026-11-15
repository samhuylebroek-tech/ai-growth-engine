CREATE INDEX IF NOT EXISTS execution_projects_keyset ON public.projects(org_id,workspace_id,id);
CREATE INDEX IF NOT EXISTS execution_tasks_keyset ON public.tasks(org_id,workspace_id,id);
CREATE INDEX IF NOT EXISTS execution_campaigns_keyset ON public.campaigns(org_id,workspace_id,id);
CREATE INDEX IF NOT EXISTS execution_notes_keyset ON public.execution_notes(org_id,workspace_id,id);
CREATE INDEX IF NOT EXISTS execution_approvals_keyset ON public.approvals(org_id,workspace_id,id);