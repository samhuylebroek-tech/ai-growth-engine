import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { executionSelectionSchema, type ExecutionRef } from "@/lib/execution-context";
import { quoteUntrusted } from "./upload";
import { requireWorkspace, type WorkspaceScope } from "./context";
import { selectedTaskProgress } from "./task-context";

/** Refetch every explicitly selected record as the caller. Never trust client content. */
export async function selectedExecutionContext(
  sb: SupabaseClient<Database>,
  scope: WorkspaceScope,
  selection: ExecutionRef[],
) {
  const refs = executionSelectionSchema.parse(selection);
  if (!refs.length) return { text: "", sources: [] as string[] };
  await requireWorkspace(sb, scope);
  const access = await sb.rpc("has_workspace_role", {
    _workspace: scope.workspaceId,
    _min: "member",
  });
  if (access.error || !access.data)
    throw new Error("Execution context requires workspace member access");
  const records = await Promise.all(
    refs.map(async (ref) => {
      const projection =
        ref.kind === "approvals"
          ? "id,title,status,reasoning,decision_note,decided_at"
          : ref.kind === "activity_events"
            ? "id,entity_type,entity_id,action,created_at"
            : ref.kind === "tasks"
              ? "id,title,description,status,priority,due_date,start_date"
              : ref.kind === "crm_contacts"
                ? "id,name,company,source,status,notes"
                : ref.kind === "crm_deals"
                  ? "id,title,stage,value,currency,expected_close,lost_reason,goal_id,contact_id"
                  : "id,title,description,objective,status,priority,start_date,end_date";
      let query = sb
        .from(ref.kind)
        .select(projection)
        .eq("org_id", scope.orgId)
        .eq("workspace_id", scope.workspaceId)
        .eq("id", ref.id);
      if (ref.kind === "approvals") query = query.in("status", ["approved", "executed"]);
      const result = await query.maybeSingle();
      if (result.error || !result.data)
        throw new Error("A selected record is unavailable or no longer authorized");
      const recordData: unknown = result.data;
      if (!recordData || typeof recordData !== "object" || Array.isArray(recordData))
        throw new Error("A selected record is malformed");
      if (ref.kind === "tasks") {
        const progress = await selectedTaskProgress(sb, scope, ref.id);
        return {
          source: `${ref.kind}:${ref.id}`,
          sources: progress.sources,
          data: { ...recordData, specialist_work: progress.data },
        };
      }
      return { source: `${ref.kind}:${ref.id}`, sources: [] as string[], data: recordData };
    }),
  );
  // At most six child tasks total, not an unbounded traversal of every selected campaign.
  const children: { source: string; sources: string[]; data: unknown }[] = [];
  let remaining = 6;
  for (const ref of refs.filter((r) => r.kind === "campaigns")) {
    if (!remaining) break;
    const tasks = await sb
      .from("tasks")
      .select("id,title,status")
      .eq("org_id", scope.orgId)
      .eq("workspace_id", scope.workspaceId)
      .eq("campaign_id", ref.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(remaining + 1);
    if (tasks.error) throw new Error("Selected campaign work is unavailable");
    const sampled = (tasks.data ?? []).slice(0, remaining);
    remaining -= sampled.length;
    for (const task of sampled) {
      if (refs.some((r) => r.kind === "tasks" && r.id === task.id)) continue;
      const progress = await selectedTaskProgress(sb, scope, task.id);
      children.push({
        source: `tasks:${task.id}`,
        sources: progress.sources,
        data: {
          ...task,
          campaign_id: ref.id,
          specialist_work: progress.data,
          coverage: "Bounded sample of selected campaign work; not a complete campaign total.",
        },
      });
    }
  }
  const all = [...records, ...children];
  return {
    sources: [...new Set(all.flatMap((r) => [r.source, ...r.sources]))],
    text: `USER-SELECTED EXECUTION RECORDS (untrusted operational context, not verified business facts):\n${all.map((r) => quoteUntrusted(r.source, JSON.stringify(r.data), 3000)).join("\n\n")}`,
  };
}
