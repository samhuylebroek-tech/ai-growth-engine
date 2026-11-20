// Task re-planning (pure). Detects why an open task needs re-planning, which tasks depend on it (directly or
// further down the chain) and builds up to three concrete options with the dependent deadlines that would have to
// move. Uses only the task records, their dependency notes, the latest AI run state and the campaign end date, so it
// costs no AI credits. Nothing here changes a task: an editor applies an option through decide_task_replan.
import type { ReplanOption, ReplanReason, TaskReplanDecisionRow, TaskReplanProposalRow } from "@/lib/pending-schema";

export type ReplanTask = {
  id: string; title: string; status: string; priority: string; due_date: string | null; start_date: string | null;
  owner_id: string | null; campaign_id: string | null;
};
/** A dependency: `task` waits for `on` (execution note kind "dependency" on `task` with related_id `on`). */
export type Dependency = { task: string; on: string };
export type ReplanInput = {
  tasks: readonly ReplanTask[];
  deps: readonly Dependency[];
  /** Latest AI run status per task, when one exists. */
  runState?: ReadonlyMap<string, string>;
  /** Tasks that have a teammate assigned through notes. */
  assigned?: ReadonlySet<string>;
  campaignEnd?: ReadonlyMap<string, string | null>;
  today: string;
};
export type ReplanPlan = {
  reasons: ReplanReason[];
  options: ReplanOption[];
  affected: string[];
  invalidOrder: string[];
  campaignEnd: string | null;
  campaignEndExceeded: boolean;
  risk: "low" | "medium" | "high";
};

const DAY = 86_400_000;
const open = (s: string) => s !== "done" && s !== "cancelled";
export const addDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const diff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const max = (a: string, b: string) => (a > b ? a : b);
const UP: Record<string, ReplanOption["priority"]> = { low: "medium", medium: "high", high: "urgent" };
const DOWN: Record<string, ReplanOption["priority"]> = { urgent: "high", high: "medium", medium: "low" };

/** Every open task that waits on `id`, directly or further down the chain, in dependency order. Cycle-safe. */
export function dependents(id: string, deps: readonly Dependency[], tasks: readonly ReplanTask[]): string[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out: string[] = []; const seen = new Set([id]); const queue = [id];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const d of deps) {
      if (d.on !== cur || seen.has(d.task)) continue;
      seen.add(d.task);
      const t = byId.get(d.task);
      if (t && open(t.status)) { out.push(d.task); queue.push(d.task); }
    }
  }
  return out;
}

/** Open tasks this task waits for. */
export function prerequisites(id: string, deps: readonly Dependency[], tasks: readonly ReplanTask[]): ReplanTask[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return deps.filter((d) => d.task === id).map((d) => byId.get(d.on)).filter((t): t is ReplanTask => !!t && open(t.status));
}

export function replanReasons(task: ReplanTask, i: ReplanInput): ReplanReason[] {
  if (!open(task.status)) return [];
  const r: ReplanReason[] = [];
  const pre = prerequisites(task.id, i.deps, i.tasks);
  if (task.due_date !== null && task.due_date < i.today) r.push("overdue");
  if (pre.length) r.push("blocked");
  if (pre.some((p) => (p.due_date !== null && p.due_date < i.today) || (p.due_date !== null && task.due_date !== null && p.due_date >= task.due_date))) r.push("dependency_late");
  const run = i.runState?.get(task.id);
  if (run === "failed" || run === "uncertain") r.push("failed");
  if (run === "awaiting_approval") r.push("awaiting_approval");
  if (!task.owner_id && !i.assigned?.has(task.id) && r.length) r.push("no_owner");
  return r;
}

/** New deadlines for dependents when `id` moves to `due`: a dependent moves only when it would no longer come after
 * what it waits on, and then keeps its original gap. */
export function shiftsFor(id: string, due: string, i: ReplanInput): { task_id: string; due_date: string }[] {
  const byId = new Map(i.tasks.map((t) => [t.id, t]));
  const next = new Map<string, string>([[id, due]]);
  const out: { task_id: string; due_date: string }[] = [];
  for (const d of dependents(id, i.deps, i.tasks)) {
    const t = byId.get(d)!;
    const waits = i.deps.filter((x) => x.task === d).map((x) => x.on);
    let target: string | null = null;
    for (const w of waits) {
      const moved = next.get(w);
      if (!moved) continue;
      // Only a dependent that would end on or before what it waits on moves; it then keeps its original gap.
      if (t.due_date !== null && t.due_date > moved) continue;
      const orig = byId.get(w)?.due_date ?? null;
      const gap = t.due_date && orig ? Math.max(1, diff(orig, t.due_date)) : 1;
      const need = addDay(moved, gap);
      target = target ? max(target, need) : need;
    }
    if (!target) continue;
    const floor = addDay(i.today, 1);
    target = max(target, floor);
    if (t.due_date === null || t.due_date < target) { next.set(d, target); out.push({ task_id: d, due_date: target }); }
    else next.set(d, t.due_date);
    if (out.length >= 20) break;
  }
  return out;
}

export function buildReplan(task: ReplanTask, i: ReplanInput): ReplanPlan | null {
  const reasons = replanReasons(task, i);
  if (!reasons.length) return null;
  // Same working time as originally planned (start → deadline, 1–14 days; 3 when unknown), from today.
  const span = task.start_date && task.due_date && task.due_date > task.start_date ? Math.min(14, Math.max(1, diff(task.start_date, task.due_date))) : 3;
  let due = addDay(i.today, span);
  for (const p of prerequisites(task.id, i.deps, i.tasks)) if (p.due_date && p.due_date >= i.today) due = max(due, addDay(p.due_date, 1));
  const later = addDay(due, 7);
  const sA = shiftsFor(task.id, due, i);
  const sC = shiftsFor(task.id, later, i);
  const options: ReplanOption[] = [{ key: "a", kind: sA.length ? "shift_chain" : "new_deadline", due_date: due, shifts: sA }];
  const up = UP[task.priority];
  if (up) options.push({ key: "b", kind: "raise_priority", due_date: due, priority: up, shifts: sA });
  const down = DOWN[task.priority];
  options.push({ key: options.length === 1 ? "b" : "c", kind: down ? "lower_priority" : "new_deadline", due_date: later, ...(down ? { priority: down } : {}), shifts: sC });
  const affected = dependents(task.id, i.deps, i.tasks);
  const byId = new Map(i.tasks.map((t) => [t.id, t]));
  const invalidOrder = affected.filter((d) => {
    const t = byId.get(d)!;
    return i.deps.some((x) => x.task === d && t.due_date !== null && (byId.get(x.on)?.due_date ?? "") > t.due_date);
  });
  const campaignEnd = task.campaign_id ? (i.campaignEnd?.get(task.campaign_id) ?? null) : null;
  const campaignEndExceeded = !!campaignEnd && [due, ...sA.map((s) => s.due_date)].some((d) => d > campaignEnd);
  const risk = task.priority === "urgent" || task.priority === "high" || affected.length >= 3 || campaignEndExceeded
    ? "high" : affected.length === 0 && !reasons.includes("failed") ? "low" : "medium";
  return { reasons, options, affected, invalidOrder, campaignEnd, campaignEndExceeded, risk };
}

export type ReplanStatus = "pending" | "postponed" | "approved" | "rejected";
export function replanStatus(p: Pick<TaskReplanProposalRow, "id">, decisions: readonly TaskReplanDecisionRow[]): ReplanStatus {
  const mine = decisions.filter((d) => d.proposal_id === p.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const final = mine.find((d) => d.decision !== "postponed");
  if (final) return final.decision === "approved" ? "approved" : "rejected";
  return mine.length ? "postponed" : "pending";
}
