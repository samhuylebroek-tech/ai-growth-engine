import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { readBusinessDomains, renderBusinessContext } from "./business-context";
import { quoteUntrusted } from "./upload";

type DB = SupabaseClient<Database>;
export type WorkspaceScope = { orgId: string; workspaceId: string };

export async function requireWorkspace(sb: DB, scope: WorkspaceScope) {
  const result = await sb
    .from("workspaces")
    .select("id,org_id,name,kind")
    .eq("id", scope.workspaceId)
    .eq("org_id", scope.orgId)
    .maybeSingle();
  if (result.error || !result.data) throw new Error("Workspace not found.");
  return result.data;
}

export async function readConversation(sb: DB, scope: WorkspaceScope, id: string, userId: string) {
  const result = await sb
    .from("conversations")
    .select("id")
    .eq("id", id)
    .eq("org_id", scope.orgId)
    .eq("workspace_id", scope.workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (result.error || !result.data) throw new Error("Conversation not found in this workspace.");
  const history = await sb
    .from("messages")
    .select("role,content")
    .eq("conversation_id", id)
    .eq("org_id", scope.orgId)
    .order("created_at", { ascending: false })
    .limit(12);
  if (history.error) throw new Error("Could not read conversation.");
  return history.data ?? [];
}

export async function readDocument(sb: DB, scope: WorkspaceScope, id: string) {
  await requireWorkspace(sb, scope);
  const result = await sb
    .from("documents")
    .select("*")
    .eq("id", id)
    .eq("org_id", scope.orgId)
    .eq("workspace_id", scope.workspaceId)
    .maybeSingle();
  if (
    result.error ||
    !result.data ||
    !result.data.storage_path.startsWith(`${scope.orgId}/${scope.workspaceId}/`)
  )
    throw new Error("Document not found in this workspace.");
  return result.data;
}

/**
 * Unified business context for every AI surface: explicit org/workspace scope on every read,
 * evidence-classified sections, fail-closed on read errors, hard-capped at BUSINESS_CONTEXT_LIMIT.
 */
export async function workspaceContext(
  sb: DB,
  scope: WorkspaceScope,
  options: { now?: Date; focus?: readonly string[] } = {},
) {
  const workspace = await requireWorkspace(sb, scope);
  const domains = await readBusinessDomains(sb, scope, workspace);
  return renderBusinessContext(domains, options.now ?? new Date(), options.focus ?? []);
}
