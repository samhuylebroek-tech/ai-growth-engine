// Command Center tiles for execution, built only from task, dependency and AI run records the caller can read.
export type ExecTileKey =
  | "openTasks"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "approvals"
  | "onTime"
  | "creditsUsed"
  | "creditsReserved"
  | "initiatives";
export type ExecTile = {
  key: ExecTileKey;
  value: number;
  total?: number;
  period: "now" | "thisMonth" | "allTime";
  to: "/app/tasks" | "/app/goals" | "/app/billing";
};
export type ExecInput = {
  now: Date;
  tasks: { id: string; status: string; due_date: string | null; updated_at: string }[];
  dependencies: { task_id: string; depends_on: string }[];
  runs: {
    task_id: string;
    status: string;
    estimated_credits: number;
    credits_charged: number | null;
    created_at: string;
  }[];
  activeInitiatives: number | null;
};
const ACTIVE = ["awaiting_approval", "queued", "paused", "running", "uncertain"];

export function buildExecutionTiles(i: ExecInput): ExecTile[] {
  const open = i.tasks.filter((t) => !["done", "cancelled"].includes(t.status));
  const openIds = new Set(open.map((t) => t.id));
  const latest = new Map<string, string>();
  for (const r of [...i.runs].sort((a, b) => b.created_at.localeCompare(a.created_at)))
    if (!latest.has(r.task_id)) latest.set(r.task_id, r.status);
  const blocked = new Set(
    i.dependencies
      .filter((d) => openIds.has(d.task_id) && openIds.has(d.depends_on))
      .map((d) => d.task_id),
  );
  // On time: a done task whose last change was on or before its deadline day.
  const doneWithDeadline = i.tasks.filter((t) => t.status === "done" && t.due_date);
  const onTime = doneWithDeadline.filter((t) => t.updated_at.slice(0, 10) <= t.due_date!).length;
  const month = i.now.toISOString().slice(0, 7);
  const thisMonth = i.runs.filter((r) => r.created_at.slice(0, 7) === month);
  const tiles: ExecTile[] = [
    { key: "openTasks", value: open.length, period: "now", to: "/app/tasks" },
    {
      key: "running",
      value: [...latest.values()].filter((s) => s === "running" || s === "queued").length,
      period: "now",
      to: "/app/tasks",
    },
    {
      key: "completed",
      value: i.tasks.filter((t) => t.status === "done").length,
      period: "allTime",
      to: "/app/tasks",
    },
    {
      key: "failed",
      value: [...latest.entries()].filter(
        ([id, s]) => (s === "failed" || s === "uncertain") && openIds.has(id),
      ).length,
      period: "now",
      to: "/app/tasks",
    },
    { key: "blocked", value: blocked.size, period: "now", to: "/app/tasks" },
    {
      key: "approvals",
      value: [...latest.values()].filter((s) => s === "awaiting_approval").length,
      period: "now",
      to: "/app/tasks",
    },
    {
      key: "onTime",
      value: onTime,
      total: doneWithDeadline.length,
      period: "allTime",
      to: "/app/tasks",
    },
    {
      key: "creditsUsed",
      value: thisMonth.reduce((n, r) => n + (r.credits_charged ?? 0), 0),
      period: "thisMonth",
      to: "/app/billing",
    },
    {
      key: "creditsReserved",
      value: i.runs
        .filter((r) => ACTIVE.includes(r.status))
        .reduce((n, r) => n + r.estimated_credits, 0),
      period: "now",
      to: "/app/tasks",
    },
  ];
  if (i.activeInitiatives != null)
    tiles.push({ key: "initiatives", value: i.activeInitiatives, period: "now", to: "/app/goals" });
  return tiles;
}
