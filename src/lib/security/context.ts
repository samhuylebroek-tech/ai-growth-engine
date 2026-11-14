import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { approvedContextFacts } from "@/lib/discovery";
import { quoteUntrusted } from "./upload";

type DB = SupabaseClient<Database>;
export type WorkspaceScope = { orgId: string; workspaceId: string };

export async function requireWorkspace(sb: DB, scope: WorkspaceScope) {
  const result = await sb.from("workspaces").select("id,org_id,name,kind").eq("id", scope.workspaceId).eq("org_id", scope.orgId).maybeSingle();
  if (result.error || !result.data) throw new Error("Workspace not found.");
  return result.data;
}

export async function readConversation(sb: DB, scope: WorkspaceScope, id: string, userId: string) {
  const result = await sb.from("conversations").select("id").eq("id", id).eq("org_id", scope.orgId).eq("workspace_id", scope.workspaceId).eq("user_id", userId).maybeSingle();
  if (result.error || !result.data) throw new Error("Conversation not found in this workspace.");
  const history = await sb.from("messages").select("role,content").eq("conversation_id", id).eq("org_id", scope.orgId).order("created_at", { ascending: false }).limit(12);
  if (history.error) throw new Error("Could not read conversation.");
  return history.data ?? [];
}

export async function readDocument(sb: DB, scope: WorkspaceScope, id: string) {
  await requireWorkspace(sb, scope);
  const result = await sb.from("documents").select("*").eq("id", id).eq("org_id", scope.orgId).eq("workspace_id", scope.workspaceId).maybeSingle();
  if (result.error || !result.data || !result.data.storage_path.startsWith(`${scope.orgId}/${scope.workspaceId}/`)) throw new Error("Document not found in this workspace.");
  return result.data;
}

export async function workspaceContext(sb: DB, scope: WorkspaceScope) {
  const workspace = await requireWorkspace(sb, scope);
  const [profile, facts, recommendations] = await Promise.all([
    sb.from("business_profiles").select("objectives,monthly_budget_eur,onboarding_completed_at").eq("org_id", scope.orgId).eq("workspace_id", scope.workspaceId).maybeSingle(),
    sb.from("business_facts").select("key,value,source_type,verified").eq("org_id", scope.orgId).eq("workspace_id", scope.workspaceId).eq("verified", true).order("created_at", { ascending: false }).limit(60),
    sb.from("approvals").select("title,reasoning,status").eq("org_id", scope.orgId).eq("workspace_id", scope.workspaceId).order("created_at", { ascending: false }).limit(10),
  ]);
  if (profile.error || facts.error || recommendations.error) throw new Error("Could not read business context.");
  // Descriptive profile fields can be stale after a fact is edited/rejected; never use them as a second trust path.
  const objectives = profile.data?.onboarding_completed_at ? { objectives: profile.data.objectives, monthly_budget_eur: profile.data.monthly_budget_eur } : {};
  return [
    `CUSTOMER OBJECTIVES (not evidence):\n${quoteUntrusted("objectives", JSON.stringify(objectives))}`,
    `VERIFIED FACTS:\n${quoteUntrusted("verified-facts", approvedContextFacts(facts.data ?? []).map(f => `- ${f.key}: ${f.value}`).join("\n") || "(none)")}`,
    `WORKSPACE:\n${quoteUntrusted("workspace", JSON.stringify(workspace))}`,
    `PREVIOUS RECOMMENDATIONS (hypotheses, never facts):\n${quoteUntrusted("recommendations", JSON.stringify(recommendations.data ?? []))}`,
    "Unconfirmed claims and descriptive profile mirrors are excluded. Conversation history is not verified evidence; ask for confirmation when evidence is missing.",
  ].join("\n\n");
}