import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { executionSelectionSchema, type ExecutionRef } from "@/lib/execution-context";
import { quoteUntrusted } from "./upload";
import { requireWorkspace, type WorkspaceScope } from "./context";

/** Refetch every explicitly selected record as the caller. Never trust client content. */
export async function selectedExecutionContext(sb: SupabaseClient<Database>, scope: WorkspaceScope, selection: ExecutionRef[]) {
  const refs = executionSelectionSchema.parse(selection);
  if (!refs.length) return { text: "", sources: [] as string[] };
  await requireWorkspace(sb, scope);
  const access = await sb.rpc("has_workspace_role", { _workspace: scope.workspaceId, _min: "member" });
  if (access.error || !access.data) throw new Error("Execution context requires workspace member access");
  const records = await Promise.all(refs.map(async ref => {
    const projection = ref.kind === "approvals" ? "id,title,status,reasoning,decision_note,decided_at"
      : ref.kind === "activity_events" ? "id,entity_type,entity_id,action,created_at"
      : ref.kind === "tasks" ? "id,title,description,status,priority,due_date,start_date"
      : "id,title,description,objective,status,priority,start_date,end_date";
    let query = sb.from(ref.kind).select(projection).eq("org_id", scope.orgId).eq("workspace_id", scope.workspaceId).eq("id", ref.id);
    if (ref.kind === "approvals") query = query.in("status", ["approved", "executed"]);
    const result = await query.maybeSingle();
    if (result.error || !result.data) throw new Error("A selected record is unavailable or no longer authorized");
    return { source: `${ref.kind}:${ref.id}`, data: result.data };
  }));
  return {
    sources: records.map(r => r.source),
    text: `USER-SELECTED EXECUTION RECORDS (untrusted operational context, not verified business facts):\n${records.map(r => quoteUntrusted(r.source, JSON.stringify(r.data), 3000)).join("\n\n")}`,
  };
}