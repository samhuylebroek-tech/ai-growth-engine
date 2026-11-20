// Campaign progress and warnings (pure). Uses only the campaign record and its tasks; spend per campaign is not
// recorded, so no budget overrun is claimed here (channel budgets are checked in Goals & budget).
export type HealthState =
  | "not_started" | "planning" | "active" | "on_track" | "needs_attention" | "at_risk" | "paused" | "completed" | "evaluated";
export type HealthWarning =
  | "no_goal" | "no_tasks" | "overdue_tasks" | "behind_schedule" | "past_end_open" | "ended_without_results" | "no_end_date" | "start_passed";
export type CampaignLike = {
  status: string; start_date: string | null; end_date: string | null; goal_id?: string | null; results: string;
};
export type TaskLike = { status: string; due_date: string | null };
export type Health = { state: HealthState; warnings: HealthWarning[]; overdue: number; done: number; total: number; elapsed: number | null };

const DAY = 86_400_000;
const closed = (s: string) => s === "done" || s === "cancelled";

export function campaignHealth(c: CampaignLike, tasks: readonly TaskLike[], today: string): Health {
  const live = tasks.filter((t) => t.status !== "cancelled");
  const done = live.filter((t) => t.status === "done").length;
  const overdue = live.filter((t) => !closed(t.status) && t.due_date !== null && t.due_date < today).length;
  const started = !!c.start_date && c.start_date <= today;
  const ended = !!c.end_date && c.end_date < today;
  let elapsed: number | null = null;
  if (c.start_date && c.end_date && c.end_date > c.start_date) {
    const span = Date.parse(c.end_date) - Date.parse(c.start_date);
    elapsed = Math.min(1, Math.max(0, (Date.parse(today) - Date.parse(c.start_date)) / span));
  }
  const hasResults = c.results.trim().length > 0;
  if (c.status === "completed" || c.status === "archived") {
    return { state: hasResults ? "evaluated" : "completed", warnings: hasResults ? [] : ["ended_without_results"], overdue, done, total: live.length, elapsed };
  }
  if (c.status === "paused") return { state: "paused", warnings: [], overdue, done, total: live.length, elapsed };
  const w: HealthWarning[] = [];
  if (!c.goal_id) w.push("no_goal");
  if (live.length === 0) w.push("no_tasks");
  if (overdue > 0) w.push("overdue_tasks");
  // Behind: clearly more time has passed than work has been finished (25 points margin, only with tasks and dates).
  if (elapsed !== null && live.length > 0 && elapsed - done / live.length > 0.25) w.push("behind_schedule");
  if (c.status === "active" && ended) w.push(hasResults ? "past_end_open" : "ended_without_results");
  if (c.status === "active" && !c.end_date) w.push("no_end_date");
  if (c.status === "planned") {
    const pw: HealthWarning[] = [...(c.goal_id ? [] : (["no_goal"] as const)), ...(started ? (["start_passed"] as const) : [])];
    return { state: started ? "needs_attention" : live.length ? "planning" : "not_started", warnings: pw, overdue, done, total: live.length, elapsed };
  }
  const serious = w.filter((x) => x === "overdue_tasks" || x === "behind_schedule" || x === "ended_without_results").length;
  const state: HealthState = serious >= 2 ? "at_risk" : w.length ? "needs_attention" : "on_track";
  return { state, warnings: w, overdue, done, total: live.length, elapsed };
}
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
