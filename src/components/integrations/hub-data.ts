// Caller-RLS reads for the Integration Hub, external actions and their Home tiles. One shared query per workspace.
import { supabase } from "@/integrations/supabase/client";
import { growthDb, retryUnlessNotInstalled, type ExternalActionRow } from "@/lib/pending-schema";
import type { HealthConnection } from "@/lib/integration-health";

export type HubConnection = HealthConnection & {
  account_label: string | null;
  scopes: string[];
  connected_by: string | null;
  connected_at: string | null;
  last_checked_at: string | null;
};
export type HubTask = { id: string; title: string; specialist: string | null };
export type HubData = {
  connections: HubConnection[];
  actions: ExternalActionRow[];
  tasks: Map<string, HubTask>;
  goals: Map<string, string>;
  plans: Map<string, string>;
  paused: boolean;
  mode: number;
};
const LIMIT = 500;

export const hubKey = (orgId?: string, wsId?: string) => ["integration-hub", orgId, wsId] as const;
export function hubOptions(orgId: string | undefined, wsId: string | undefined) {
  return {
    queryKey: hubKey(orgId, wsId),
    enabled: !!orgId && !!wsId,
    staleTime: 15_000,
    retry: retryUnlessNotInstalled,
    queryFn: async (): Promise<HubData> => {
      if (!orgId || !wsId) throw new Error("Choose a workspace");
      const [conns, acts, tasks, profiles, goals, plans, settings] = await Promise.all([
        growthDb
          .from("connector_connections")
          .select(
            "id,connector_key,status,granted_levels,last_sync_at,last_error,expires_at,simulated,account_label,scopes,connected_by,connected_at,last_checked_at",
          )
          .eq("org_id", orgId)
          .eq("workspace_id", wsId)
          .limit(200),
        growthDb
          .from("external_actions")
          .select("*", { count: "exact" })
          .eq("org_id", orgId)
          .eq("workspace_id", wsId)
          .order("created_at", { ascending: false })
          .limit(LIMIT),
        supabase
          .from("tasks")
          .select("id,title")
          .eq("org_id", orgId)
          .eq("workspace_id", wsId)
          .neq("status", "done")
          .limit(2000),
        growthDb
          .from("task_execution_profiles")
          .select("task_id,specialist_key")
          .eq("org_id", orgId)
          .eq("workspace_id", wsId)
          .limit(2000),
        supabase
          .from("growth_goals")
          .select("id,title")
          .eq("org_id", orgId)
          .eq("workspace_id", wsId)
          .limit(500),
        growthDb
          .from("growth_plan_versions")
          .select("id,title,version")
          .eq("org_id", orgId)
          .eq("workspace_id", wsId)
          .limit(500),
        growthDb
          .from("execution_settings")
          .select("paused,mode")
          .eq("workspace_id", wsId)
          .maybeSingle(),
      ]);
      // Fail closed: a partial read would hide problems or approvals.
      for (const r of [conns, acts, tasks, profiles, goals, plans, settings])
        if (r.error) throw r.error;
      if ((acts.count ?? 0) > LIMIT) throw new Error("too_many");
      const spec = new Map((profiles.data ?? []).map((p) => [p.task_id, p.specialist_key]));
      const taskMap = new Map(
        (tasks.data ?? []).map((t) => [
          t.id,
          { id: t.id, title: t.title, specialist: spec.get(t.id) ?? null },
        ]),
      );
      const actions = (acts.data ?? []) as ExternalActionRow[];
      // Actions may point at finished tasks; fetch those titles too so history stays readable.
      const missing = [...new Set(actions.map((a) => a.task_id).filter((id) => !taskMap.has(id)))];
      if (missing.length) {
        const more = await supabase
          .from("tasks")
          .select("id,title")
          .in("id", missing.slice(0, 200));
        if (more.error) throw more.error;
        for (const t of more.data ?? [])
          taskMap.set(t.id, { id: t.id, title: t.title, specialist: spec.get(t.id) ?? null });
      }
      return {
        connections: (conns.data ?? []) as HubConnection[],
        actions,
        tasks: taskMap,
        goals: new Map((goals.data ?? []).map((g) => [g.id, g.title])),
        plans: new Map(
          (plans.data ?? []).map((p) => [
            p.id,
            `${p.title.length > 60 ? `${p.title.slice(0, 57)}…` : p.title} · v${p.version}`,
          ]),
        ),
        paused: settings.data?.paused ?? false,
        mode: settings.data?.mode ?? 2,
      };
    },
  };
}

/** Client mirror of the database execution gate, only to explain why a button is unavailable. */
export function clientGate(
  a: ExternalActionRow,
  c: HubConnection | undefined,
  paused: boolean,
  now = new Date(),
): string | null {
  if (!c || c.status === "disabled" || c.status === "not_configured") return "disconnected";
  if (c.status === "expired" || (c.expires_at && new Date(c.expires_at).getTime() <= now.getTime()))
    return "expired";
  if (c.status === "insufficient_scope") return "permission_missing";
  if (c.status !== "connected") return "connection_error";
  if (!c.granted_levels.includes(a.required_level)) return "level_not_granted";
  if (!c.simulated) return "real_execution_disabled";
  if (paused) return "paused";
  return null;
}
