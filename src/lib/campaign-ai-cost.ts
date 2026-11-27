// Campaign AI economics (pure): which specialists work on a campaign and what their AI work cost, from the campaign's
// own tasks, their recorded task runs and second reviews (task_runs / specialist_reviews under caller RLS).
//   * charged credits come from the run's recorded charge only; runs without a charge yet are "pending";
//   * an uncertain outcome is listed apart (its credits stay reserved, never assumed refunded or charged);
//   * credits are not converted to money: no credit price is set, so a money value would be invented;
//   * a read that hit its limit makes the totals incomplete instead of silently smaller.
// The team is derived from tasks assigned to a specialist (tasks.agent_key) and runs (specialist_key).
type Task = { id: string; campaign_id: string | null; agent_key: string | null; status: string };
type Run = {
  id: string;
  task_id: string;
  specialist_key: string;
  status: string;
  credits_charged: number | null;
  estimated_credits: number;
  created_at: string;
};
type Review = {
  task_run_id: string;
  reviewer_specialist: string;
  credits: number | null;
  score: number | null;
};

export type SpecialistShare = {
  specialist: string;
  tasks: number;
  openTasks: number;
  doneTasks: number;
  runs: number;
  succeeded: number;
  credits: number;
  reviewCredits: number;
  reviewsReceived: number;
  avgReviewScore: number | null;
  lastRunAt: string | null;
};
export type CampaignAiEconomics = {
  tasks: number;
  runs: number;
  chargedCredits: number;
  reviewCredits: number;
  totalCredits: number;
  pendingRuns: number;
  pendingEstimate: number;
  uncertainRuns: number;
  failedRuns: number;
  team: SpecialistShare[];
  unassignedOpenTasks: number;
  complete: boolean;
};

const DONE = ["done", "completed", "cancelled"];
export function campaignAiEconomics(
  campaignId: string,
  tasks: readonly Task[],
  runs: readonly Run[],
  reviews: readonly Review[],
  complete = true,
): CampaignAiEconomics {
  const mine = tasks.filter((t) => t.campaign_id === campaignId);
  const ids = new Set(mine.map((t) => t.id));
  const rs = runs.filter((r) => ids.has(r.task_id));
  const runIds = new Set(rs.map((r) => r.id));
  const rv = reviews.filter((r) => runIds.has(r.task_run_id));
  const team = new Map<string, SpecialistShare>();
  const get = (k: string) => {
    let s = team.get(k);
    if (!s) {
      s = {
        specialist: k,
        tasks: 0,
        openTasks: 0,
        doneTasks: 0,
        runs: 0,
        succeeded: 0,
        credits: 0,
        reviewCredits: 0,
        reviewsReceived: 0,
        avgReviewScore: null,
        lastRunAt: null,
      };
      team.set(k, s);
    }
    return s;
  };
  for (const t of mine)
    if (t.agent_key) {
      const s = get(t.agent_key);
      s.tasks += 1;
      if (DONE.includes(t.status)) s.doneTasks += 1;
      else s.openTasks += 1;
    }
  const scores = new Map<string, number[]>();
  for (const r of rs) {
    const s = get(r.specialist_key);
    s.runs += 1;
    if (r.status === "succeeded") s.succeeded += 1;
    s.credits += r.credits_charged ?? 0;
    if (!s.lastRunAt || r.created_at > s.lastRunAt) s.lastRunAt = r.created_at;
  }
  for (const v of rv) {
    get(v.reviewer_specialist).reviewCredits += v.credits ?? 0;
    const run = rs.find((r) => r.id === v.task_run_id);
    if (run && v.score !== null) {
      const list = scores.get(run.specialist_key) ?? [];
      list.push(v.score);
      scores.set(run.specialist_key, list);
      get(run.specialist_key).reviewsReceived += 1;
    }
  }
  for (const [k, list] of scores)
    get(k).avgReviewScore = Math.round(list.reduce((a, b) => a + b, 0) / list.length);
  const charged = rs.reduce((n, r) => n + (r.credits_charged ?? 0), 0);
  const reviewCredits = rv.reduce((n, r) => n + (r.credits ?? 0), 0);
  const pending = rs.filter(
    (r) =>
      r.credits_charged === null &&
      !["failed", "cancelled", "rejected", "uncertain"].includes(r.status),
  );
  return {
    tasks: mine.length,
    runs: rs.length,
    chargedCredits: charged,
    reviewCredits,
    totalCredits: charged + reviewCredits,
    pendingRuns: pending.length,
    pendingEstimate: pending.reduce((n, r) => n + r.estimated_credits, 0),
    uncertainRuns: rs.filter((r) => r.status === "uncertain").length,
    failedRuns: rs.filter((r) => r.status === "failed").length,
    team: [...team.values()].sort(
      (a, b) => b.credits + b.reviewCredits - (a.credits + a.reviewCredits) || b.tasks - a.tasks,
    ),
    unassignedOpenTasks: mine.filter((t) => !t.agent_key && !DONE.includes(t.status)).length,
    complete,
  };
}
