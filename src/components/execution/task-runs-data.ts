import { collectPages } from "@/lib/pagination";
import {
  growthDb,
  retryUnlessNotInstalled,
  type ExecutionSettingsRow,
  type TaskProfileRow,
  type TaskRunRow,
} from "@/lib/pending-schema";

export type EffectiveSettings = Omit<
  ExecutionSettingsRow,
  "workspace_id" | "org_id" | "updated_by" | "updated_at"
>;
/** Same defaults as public.task_execution_settings for workspaces that never saved settings. */
export const DEFAULT_SETTINGS: EffectiveSettings = {
  mode: 2,
  max_credits_per_run: 20,
  monthly_credit_cap: 200,
  paused: false,
  pause_reason: null,
  paused_by: null,
  paused_at: null,
  daily_credit_cap: null,
  max_parallel: 3,
  max_attempts: 3,
  allowed_specialists: [],
  window_start: null,
  window_end: null,
  timezone: "Europe/Brussels",
  schedule: "off",
  schedule_hour: 9,
};
export type ExecutionData = {
  settings: EffectiveSettings;
  profiles: TaskProfileRow[];
  runs: TaskRunRow[];
  monthUsed: number;
};

/** Workspace-wide AI task execution state under the caller's RLS. Members first settle expired runs (no AI, no credits). */
export function taskExecutionOptions(
  orgId: string | undefined,
  wsId: string | undefined,
  canSettle: boolean,
) {
  return {
    queryKey: ["task-execution", orgId, wsId],
    enabled: !!orgId && !!wsId,
    retry: retryUnlessNotInstalled,
    refetchInterval: (q: { state: { data?: ExecutionData | undefined } }) =>
      // Bounded foreground polling only while something is actually in motion.
      q.state.data?.runs.some((r) => r.status === "running" || r.status === "queued")
        ? 5000
        : false,
    queryFn: async (): Promise<ExecutionData> => {
      if (!orgId || !wsId) throw new Error("Choose a workspace");
      if (canSettle) {
        const rec = await growthDb.rpc("reconcile_task_runs", { _workspace: wsId });
        if (rec.error) throw rec.error;
      }
      const watermark = new Date().toISOString();
      const [s, profiles, runRows] = await Promise.all([
        growthDb
          .from("execution_settings")
          .select("*")
          .eq("org_id", orgId)
          .eq("workspace_id", wsId)
          .maybeSingle(),
        collectPages(async (cursor, size) => {
          let query = growthDb
            .from("task_execution_profiles")
            .select("*")
            .eq("org_id", orgId)
            .eq("workspace_id", wsId)
            .lte("assigned_at", watermark)
            .order("task_id")
            .limit(size);
          if (cursor) query = query.gt("task_id", cursor);
          const r = await query;
          return { error: r.error, data: r.data?.map((p) => ({ ...p, id: p.task_id })) ?? null };
        }),
        collectPages(async (cursor, size) => {
          let query = growthDb
            .from("task_runs")
            .select("*")
            .eq("org_id", orgId)
            .eq("workspace_id", wsId)
            .lte("created_at", watermark)
            .order("id")
            .limit(size);
          if (cursor) query = query.gt("id", cursor);
          return await query;
        }),
      ]);
      if (s.error) throw s.error;
      const runs = runRows.sort(
        (a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
      );
      const month = new Date();
      month.setUTCDate(1);
      month.setUTCHours(0, 0, 0, 0);
      const monthUsed = runs
        .filter((x) => new Date(x.created_at) >= month)
        .reduce(
          (n, x) =>
            n +
            (x.credits_charged ??
              (["failed", "cancelled", "rejected"].includes(x.status) ? 0 : x.estimated_credits)),
          0,
        );
      return {
        settings: { ...DEFAULT_SETTINGS, ...(s.data ?? {}) },
        profiles,
        runs,
        monthUsed,
      };
    },
  };
}

export type TaskRunState =
  | "none"
  | "awaiting_approval"
  | "queued"
  | "paused"
  | "running"
  | "succeeded"
  | "failed"
  | "uncertain"
  | "cancelled"
  | "rejected";
/** Latest run and attempt count per task. Runs arrive newest first. */
export function runsByTask(runs: readonly TaskRunRow[]) {
  const m = new Map<
    string,
    { latest: TaskRunRow; all: TaskRunRow[]; attempts: number; charged: number }
  >();
  for (const r of runs) {
    const e = m.get(r.task_id);
    const counts = ["succeeded", "failed", "uncertain"].includes(r.status) ? 1 : 0;
    if (!e)
      m.set(r.task_id, { latest: r, all: [r], attempts: counts, charged: r.credits_charged ?? 0 });
    else {
      e.all.push(r);
      e.attempts += counts;
      e.charged += r.credits_charged ?? 0;
    }
  }
  return m;
}

/** Badge tone per run state. */
export const runTone = (s: string) =>
  s === "succeeded"
    ? "border-success/50 text-success"
    : ["failed", "uncertain", "rejected"].includes(s)
      ? "border-destructive/50 text-destructive"
      : s === "awaiting_approval"
        ? "border-warning/50 text-warning"
        : "";
