// Caller-RLS reads for the Integration Hub, external actions and their Home tiles. One shared query per workspace.
import { collectPages } from "@/lib/pagination";
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

export const hubKey = (orgId?: string, wsId?: string) => ["integration-hub", orgId, wsId] as const;
export function hubOptions(orgId: string | undefined, wsId: string | undefined) {
  return {
    queryKey: hubKey(orgId, wsId),
    enabled: !!orgId && !!wsId,
    staleTime: 15_000,
    retry: retryUnlessNotInstalled,
    queryFn: async (): Promise<HubData> => {
      if (!orgId || !wsId) throw new Error("Choose a workspace");
      const watermark = new Date().toISOString();
      const [conns, acts, tasks, profiles, goals, plans, settings] = await Promise.all([
        collectPages(async (cursor, size) => {
          let q = growthDb
            .from("connector_connections")
            .select(
              "id,connector_key,status,granted_levels,last_sync_at,last_error,expires_at,simulated,account_label,scopes,connected_by,connected_at,last_checked_at",
            )
            .eq("org_id", orgId)
            .eq("workspace_id", wsId)
            .order("id")
            .limit(size);
          if (cursor) q = q.gt("id", cursor);
          return await q;
        }),
        collectPages(async (cursor, size) => {
          let q = growthDb
            .from("external_actions")
            .select("*")
            .eq("org_id", orgId)
            .eq("workspace_id", wsId)
            .lte("created_at", watermark)
            .order("id")
            .limit(size);
          if (cursor) q = q.gt("id", cursor);
          return await q;
        }),
        collectPages(async (cursor, size) => {
          let q = supabase
            .from("tasks")
            .select("id,title")
            .eq("org_id", orgId)
            .eq("workspace_id", wsId)
            .neq("status", "done")
            .lte("created_at", watermark)
            .order("id")
            .limit(size);
          if (cursor) q = q.gt("id", cursor);
          return await q;
        }),
        collectPages(async (cursor, size) => {
          let q = growthDb
            .from("task_execution_profiles")
            .select("task_id,specialist_key")
            .eq("org_id", orgId)
            .eq("workspace_id", wsId)
            .order("task_id")
            .limit(size);
          if (cursor) q = q.gt("task_id", cursor);
          const r = await q;
          return { data: r.data?.map((p) => ({ ...p, id: p.task_id })) ?? null, error: r.error };
        }),
        collectPages(async (cursor, size) => {
          let q = supabase
            .from("growth_goals")
            .select("id,title")
            .eq("org_id", orgId)
            .eq("workspace_id", wsId)
            .order("id")
            .limit(size);
          if (cursor) q = q.gt("id", cursor);
          return await q;
        }),
        collectPages(async (cursor, size) => {
          let q = growthDb
            .from("growth_plan_versions")
            .select("id,title,version")
            .eq("org_id", orgId)
            .eq("workspace_id", wsId)
            .order("id")
            .limit(size);
          if (cursor) q = q.gt("id", cursor);
          return await q;
        }),
        growthDb
          .from("execution_settings")
          .select("paused,mode")
          .eq("org_id", orgId)
          .eq("workspace_id", wsId)
          .maybeSingle(),
      ]);
      if (settings.error) throw settings.error;
      const spec = new Map(profiles.map((p) => [p.task_id, p.specialist_key]));
      const taskMap = new Map(
        tasks.map((t) => [t.id, { id: t.id, title: t.title, specialist: spec.get(t.id) ?? null }]),
      );
      const actions = acts.sort(
        (a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id),
      ) as ExternalActionRow[];
      // Historical actions can reference done tasks: read all missing titles in bounded, scoped batches.
      const missing = [...new Set(actions.map((a) => a.task_id).filter((id) => !taskMap.has(id)))];
      for (let i = 0; i < missing.length; i += 100) {
        const more = await collectPages(async (cursor, size) => {
          let q = supabase
            .from("tasks")
            .select("id,title")
            .eq("org_id", orgId)
            .eq("workspace_id", wsId)
            .in("id", missing.slice(i, i + 100))
            .order("id")
            .limit(size);
          if (cursor) q = q.gt("id", cursor);
          return await q;
        });
        for (const t of more)
          taskMap.set(t.id, { id: t.id, title: t.title, specialist: spec.get(t.id) ?? null });
      }
      return {
        connections: conns as HubConnection[],
        actions,
        tasks: taskMap,
        goals: new Map(goals.map((g) => [g.id, g.title])),
        plans: new Map(
          plans.map((p) => [
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
