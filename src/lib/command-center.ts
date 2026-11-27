import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type Run = Pick<
  Database["public"]["Tables"]["agent_runs"]["Row"],
  "id" | "agent_key" | "status" | "summary" | "error" | "created_at" | "finished_at"
>;
type Document = Pick<
  Database["public"]["Tables"]["documents"]["Row"],
  "id" | "name" | "status" | "created_at"
>;
type Approval = Pick<
  Database["public"]["Tables"]["approvals"]["Row"],
  "id" | "title" | "status" | "risk" | "created_at" | "decided_at" | "reasoning" | "expected_impact"
>;
export type ActivityKind = "ai" | "documents" | "approvals";
export type Activity = {
  id: string;
  entityId: string;
  kind: ActivityKind;
  title: string;
  detail: string;
  status: string;
  time: string;
  to: "/app/activity" | "/app/documents" | "/app/approvals";
};

/**
 * Run summaries of structured AI requests can hold the raw JSON answer, often cut off.
 * Show its plain-language "summary" field when one can be read, otherwise nothing, so raw data never reaches the screen.
 */
export function readableRunSummary(summary: string | null | undefined): string | null {
  const text = summary?.trim();
  if (!text) return null;
  if (!text.startsWith("{") && !text.startsWith("[")) return text;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const value = (parsed as Record<string, unknown>)["summary"];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
  } catch {
    const match = /^\{\s*"summary"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(text);
    if (!match?.[1]) return null;
    const partial = match[1]
      .replace(/\\(["\\/])/g, "$1")
      .replace(/\\n/g, " ")
      .trim();
    return partial ? (text.length > match[0].length + 1 ? partial : `${partial}…`) : null;
  }
}

export function mergeActivity(
  runs: Run[],
  documents: Document[],
  approvals: Approval[],
): Activity[] {
  const items: Activity[] = [
    ...runs.map((r) => ({
      id: `ai:${r.id}`,
      entityId: r.id,
      kind: "ai" as const,
      title: r.agent_key.replace(/_/g, " "),
      detail: r.error ?? readableRunSummary(r.summary) ?? "AI assignment",
      status: r.status,
      time: r.finished_at ?? r.created_at,
      to: "/app/activity" as const,
    })),
    ...documents.map((d) => ({
      id: `document:${d.id}`,
      entityId: d.id,
      kind: "documents" as const,
      title: d.name,
      detail: "Business document",
      status: d.status,
      time: d.created_at,
      to: "/app/documents" as const,
    })),
    ...approvals.map((a) => ({
      id: `approval:${a.id}`,
      entityId: a.id,
      kind: "approvals" as const,
      title: a.title,
      detail: a.reasoning ?? "Recommendation for review",
      status: a.status,
      time: a.decided_at ?? a.created_at,
      to: "/app/approvals" as const,
    })),
  ];
  return [...new Map(items.map((item) => [item.id, item])).values()].sort(
    (a, b) => Date.parse(b.time) - Date.parse(a.time),
  );
}

export function prioritizeApprovals<T extends { risk: string; created_at: string }>(
  items: T[],
): T[] {
  const priority: Record<string, number> = { high: 0, medium: 1, low: 2 };
  return [...items].sort(
    (a, b) =>
      (priority[a.risk] ?? 2) - (priority[b.risk] ?? 2) ||
      Date.parse(a.created_at) - Date.parse(b.created_at),
  );
}

export function homePreferenceKey(userId: string, orgId: string, workspaceId: string) {
  return `age.home.v3:${userId}:${orgId}:${workspaceId}`;
}

export function commandCenterOptions(
  orgId: string | undefined,
  workspaceId: string | undefined,
  userId: string,
) {
  return {
    queryKey: ["command-center", "v1", orgId, workspaceId, userId],
    enabled: !!orgId && !!workspaceId && !!userId,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      if (!orgId || !workspaceId || !userId) throw new Error("Select an authorized workspace.");
      const [runs, active, documents, approvals, connections] = await Promise.all([
        supabase
          .from("agent_runs")
          .select("id,agent_key,status,summary,error,created_at,finished_at")
          .eq("org_id", orgId)
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("agent_runs")
          .select("id,agent_key,status,summary,error,created_at,finished_at", { count: "exact" })
          .eq("org_id", orgId)
          .eq("workspace_id", workspaceId)
          .in("status", ["running", "pending"])
          .order("created_at", { ascending: false })
          .limit(30),
        supabase
          .from("documents")
          .select("id,name,status,created_at")
          .eq("org_id", orgId)
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("approvals")
          .select("id,title,status,risk,reasoning,expected_impact,created_at,decided_at")
          .eq("org_id", orgId)
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .limit(50),
        supabase
          .from("connector_connections")
          .select("id,connector_key,status")
          .eq("org_id", orgId)
          .eq("workspace_id", workspaceId),
      ]);
      for (const result of [runs, active, documents, approvals, connections])
        if (result.error) throw result.error;
      return {
        activity: mergeActivity(runs.data ?? [], documents.data ?? [], approvals.data ?? []),
        runs: runs.data ?? [],
        documents: documents.data ?? [],
        active: active.data ?? [],
        activeCount: active.count ?? 0,
        connections: connections.data ?? [],
      };
    },
  };
}
