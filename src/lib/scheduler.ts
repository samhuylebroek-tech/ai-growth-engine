// Client mirror of the scheduler rules in proposal 0064. The database decides; these helpers explain.
export const GATE_CODES = ["paused", "closed", "no_specialist", "external", "analysis_only", "specialist_not_allowed", "over_run_cap", "blocked_dependency",
  "unfinished_run", "retry_limit", "monthly_cap", "daily_cap", "outside_window", "no_credits", "parallel_limit", "approval_batch_full", "has_result", "mode", "not_due", "cycle_open"] as const;
export type GateCode = (typeof GATE_CODES)[number];
export const CYCLE_REASONS = [...GATE_CODES, "ready", "needs_approval"] as const;
export type CycleReason = (typeof CYCLE_REASONS)[number];

/** The database attaches `gate:<code>` to refusals; anything else stays a generic failure. */
export function gateCode(err: { details?: string | null; message?: string } | null | undefined): GateCode | null {
  const m = /^gate:([a-z_]+)$/.exec(err?.details ?? "");
  return m && (GATE_CODES as readonly string[]).includes(m[1]!) ? (m[1] as GateCode) : null;
}

export type ScoreInput = { priority: string; due_date: string | null; goalPriority: "primary" | "secondary" | null; inInitiative: boolean; failedRuns: number };
/** Same weights as public.task_priority_score: priority, deadline, goal importance, approved-plan link, past failures. */
export function taskScore(t: ScoreInput, today: string) {
  const pr = ({ urgent: 40, high: 30, medium: 20 } as Record<string, number>)[t.priority] ?? 10;
  const soon = new Date(`${today}T00:00:00Z`); soon.setUTCDate(soon.getUTCDate() + 7);
  const due = !t.due_date ? 0 : t.due_date < today ? 25 : t.due_date <= soon.toISOString().slice(0, 10) ? 15 : 0;
  const goal = t.goalPriority === "primary" ? 15 : t.goalPriority === "secondary" ? 8 : 0;
  return pr + due + goal + (t.inInitiative ? 10 : 0) - 5 * t.failedRuns;
}

/** Whether the execution window (hours, workspace time zone) is open at `hour`. Equal or missing bounds = always open. */
export function windowOpen(start: number | null, end: number | null, hour: number) {
  if (start == null || end == null || start === end) return true;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}
