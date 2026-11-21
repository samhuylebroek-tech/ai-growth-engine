// Blocked work (pure). A task is blocked while a task it waits on (an execution note of kind "dependency") is still
// open; it is "late" when that prerequisite is overdue or due on or after the waiting task's own deadline. Same rule
// as the Command Center tile, orchestration and task_open_dependencies in SQL, so every screen and the Growth Officer
// agree. A prerequisite whose state was not read is reported as unknown, never as finished.
export type DepTask = { id: string; title: string; status: string; due_date: string | null };
export type Dep = { task_id: string; depends_on: string };
export type Blocked = {
  task: DepTask;
  waitsOn: { id: string; title: string | null; status: string | null; due_date: string | null }[];
  late: boolean;
};

const isOpen = (s: string) => s !== "done" && s !== "cancelled";

export function blockedTasks(tasks: readonly DepTask[], deps: readonly Dep[], today: string): Blocked[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out: Blocked[] = [];
  for (const task of tasks) {
    if (!isOpen(task.status)) continue;
    const waitsOn = [...new Set(deps.filter((d) => d.task_id === task.id && d.depends_on !== task.id).map((d) => d.depends_on))]
      .map((id) => byId.get(id))
      .flatMap((p) => (p && isOpen(p.status) ? [{ id: p.id, title: p.title, status: p.status, due_date: p.due_date }] : []));
    if (!waitsOn.length) continue;
    const late = waitsOn.some((p) => (p.due_date !== null && p.due_date < today) || (p.due_date !== null && task.due_date !== null && p.due_date >= task.due_date));
    out.push({ task, waitsOn, late });
  }
  return out.sort((a, b) => Number(b.late) - Number(a.late) || (a.task.due_date ?? "9999").localeCompare(b.task.due_date ?? "9999"));
}

/** Tasks named by a dependency (either side) whose state was not read, for one bounded follow-up read. */
export function unknownTaskIds(tasks: readonly DepTask[], deps: readonly Dep[]): string[] {
  const known = new Set(tasks.map((t) => t.id));
  return [...new Set(deps.flatMap((d) => [d.task_id, d.depends_on]).filter((id) => !known.has(id)))];
}

// Block diagnosis (pure) for one task: why each unfinished prerequisite holds it up, which later tasks wait on it in
// turn, whether its campaign end date is at risk, and which practical next steps fit. It only suggests: owners,
// deadlines, budgets and campaign states change only through the existing permission-checked actions.
export type BlockCause = "overdue" | "failed" | "awaiting_approval" | "unassigned" | "in_review" | "not_started" | "no_date";
export type BlockAction = "finish_prerequisite" | "assign_owner" | "decide_approval" | "retry_or_replan" | "replan" | "review_prerequisite";
export type DiagTask = DepTask & { owner_id: string | null; campaign_id?: string | null };
export type BlockDiagnosis = {
  prerequisites: (DiagTask & { causes: BlockCause[] })[];
  downstream: DiagTask[];
  campaignAtRisk: boolean;
  actions: BlockAction[];
};

export function diagnoseBlock(
  taskId: string,
  i: { tasks: readonly DiagTask[]; deps: readonly Dep[]; runState?: ReadonlyMap<string, string>; assigned?: ReadonlySet<string>; campaignEnd?: ReadonlyMap<string, string | null>; today: string },
): BlockDiagnosis | null {
  const byId = new Map(i.tasks.map((t) => [t.id, t]));
  const task = byId.get(taskId);
  if (!task || !isOpen(task.status)) return null;
  const pre = [...new Set(i.deps.filter((d) => d.task_id === taskId && d.depends_on !== taskId).map((d) => d.depends_on))]
    .map((id) => byId.get(id)).filter((p): p is DiagTask => !!p && isOpen(p.status));
  if (!pre.length) return null;
  const prerequisites = pre.map((p) => {
    const run = i.runState?.get(p.id);
    const causes: BlockCause[] = [];
    if (p.due_date !== null && p.due_date < i.today) causes.push("overdue");
    if (p.due_date === null) causes.push("no_date");
    if (run === "failed" || run === "uncertain") causes.push("failed");
    if (run === "awaiting_approval" || p.status === "awaiting_approval") causes.push("awaiting_approval");
    if (p.status === "review") causes.push("in_review");
    if (p.status === "todo" && !causes.includes("overdue")) causes.push("not_started");
    if (p.owner_id === null && !i.assigned?.has(p.id)) causes.push("unassigned");
    return { ...p, causes };
  });
  // Later tasks that wait on this one, directly or further down the chain (cycle-safe, open only).
  const downstream: DiagTask[] = [];
  const seen = new Set([taskId]); const queue = [taskId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const d of i.deps) {
      if (d.depends_on !== cur || seen.has(d.task_id)) continue;
      seen.add(d.task_id);
      const t = byId.get(d.task_id);
      if (t && isOpen(t.status)) { downstream.push(t); queue.push(t.id); }
    }
  }
  const latestPre = prerequisites.reduce<string | null>((m, p) => (p.due_date && (!m || p.due_date > m) ? p.due_date : m), null);
  const affected = [task, ...downstream];
  const campaignAtRisk = affected.some((t) => {
    const end = t.campaign_id ? i.campaignEnd?.get(t.campaign_id) ?? null : null;
    return !!end && (prerequisites.some((p) => p.causes.includes("overdue")) ? i.today >= end || (latestPre !== null && latestPre >= end) : latestPre !== null && latestPre >= end);
  });
  const all = new Set(prerequisites.flatMap((p) => p.causes));
  const actions: BlockAction[] = [];
  if (all.has("awaiting_approval")) actions.push("decide_approval");
  if (all.has("in_review")) actions.push("review_prerequisite");
  if (all.has("failed")) actions.push("retry_or_replan");
  if (all.has("unassigned")) actions.push("assign_owner");
  actions.push("finish_prerequisite");
  if (all.has("overdue") || campaignAtRisk || prerequisites.some((p) => p.due_date !== null && task.due_date !== null && p.due_date >= task.due_date)) actions.push("replan");
  return { prerequisites, downstream, campaignAtRisk, actions };
}
