// AI credit costs rolled up the growth hierarchy from task runs, kept separate from entered marketing
// budgets and from revenue. Pure: callers pass rows read under their own RLS. Nothing is estimated as actual.
export type CostRun = {
  task_id: string;
  status: string;
  estimated_credits: number;
  credits_charged: number | null;
  specialist_key: string;
};
export type CostInput = {
  runs: readonly CostRun[];
  tasks: readonly {
    id: string;
    title: string;
    project_id: string | null;
    campaign_id: string | null;
  }[];
  projects: readonly { id: string; title: string; goal_id: string | null }[];
  campaigns: readonly { id: string; title: string; goal_id: string | null; budget_eur: number }[];
  initiatives: readonly {
    id: string;
    title: string;
    project_id: string | null;
    plan_version_id: string;
  }[];
  plans: readonly {
    id: string;
    title: string;
    version: number;
    goal_id: string;
    strategy_id: string | null;
  }[];
  goals: readonly { id: string; title: string }[];
  budget: readonly { goal_id: string | null; planned: number; actual: number; currency: string }[];
};
export type Credits = {
  runs: number;
  consumed: number;
  reserved: number;
  released: number;
  releasedRuns: number;
};
export type Money = Record<string, { planned: number; actual: number }>; // per currency, never summed across currencies
export type CostNode = {
  id: string;
  title: string;
  credits: Credits;
  budget?: Money;
  campaignBudgetEur?: number;
};
export type Level = "specialist" | "task" | "project" | "campaign" | "initiative" | "plan" | "goal";
export type CostReport = Record<Level, CostNode[]> & { workspace: Credits; unlinkedTasks: number };

const OPEN = ["awaiting_approval", "queued", "paused", "running", "uncertain"];
const RELEASED = ["failed", "cancelled", "rejected"];
const zero = (): Credits => ({ runs: 0, consumed: 0, reserved: 0, released: 0, releasedRuns: 0 });
function add(c: Credits, r: CostRun) {
  c.runs += 1;
  c.consumed += r.credits_charged ?? 0;
  if (OPEN.includes(r.status)) c.reserved += r.estimated_credits;
  // A finished run that charged nothing released its whole reservation; a partial charge released the rest.
  if (RELEASED.includes(r.status)) {
    c.released += Math.max(0, r.estimated_credits - (r.credits_charged ?? 0));
    c.releasedRuns += 1;
  }
}
const merge = (a: Credits, b: Credits) => {
  a.runs += b.runs;
  a.consumed += b.consumed;
  a.reserved += b.reserved;
  a.released += b.released;
  a.releasedRuns += b.releasedRuns;
};

export function rollUpCosts(i: CostInput): CostReport {
  const workspace = zero();
  const bySpec = new Map<string, Credits>();
  const byTask = new Map<string, Credits>();
  for (const r of i.runs) {
    add(workspace, r);
    if (!bySpec.has(r.specialist_key)) bySpec.set(r.specialist_key, zero());
    add(bySpec.get(r.specialist_key)!, r);
    if (!byTask.has(r.task_id)) byTask.set(r.task_id, zero());
    add(byTask.get(r.task_id)!, r);
  }
  const sum = (taskIds: Iterable<string>) => {
    const c = zero();
    for (const id of taskIds) {
      const t = byTask.get(id);
      if (t) merge(c, t);
    }
    return c;
  };
  const tasksOf = (pred: (t: CostInput["tasks"][number]) => boolean) =>
    i.tasks.filter(pred).map((t) => t.id);
  const projectTasks = new Map(
    i.projects.map((p) => [p.id, tasksOf((t) => t.project_id === p.id)]),
  );
  const campaignTasks = new Map(
    i.campaigns.map((c) => [c.id, tasksOf((t) => t.campaign_id === c.id)]),
  );
  const initiativeTasks = new Map(
    i.initiatives.map((n) => [n.id, n.project_id ? (projectTasks.get(n.project_id) ?? []) : []]),
  );
  const planTasks = new Map(
    i.plans.map((p) => [
      p.id,
      [
        ...new Set(
          i.initiatives
            .filter((n) => n.plan_version_id === p.id)
            .flatMap((n) => initiativeTasks.get(n.id) ?? []),
        ),
      ],
    ]),
  );
  // A goal's tasks: through its projects and campaigns (each task counted once even when linked both ways).
  const goalTasks = new Map(
    i.goals.map((g) => [
      g.id,
      [
        ...new Set([
          ...i.projects
            .filter((p) => p.goal_id === g.id)
            .flatMap((p) => projectTasks.get(p.id) ?? []),
          ...i.campaigns
            .filter((c) => c.goal_id === g.id)
            .flatMap((c) => campaignTasks.get(c.id) ?? []),
        ]),
      ],
    ]),
  );
  const money = (goalId: string | null) => {
    const m: Money = {};
    for (const b of i.budget)
      if (b.goal_id === goalId) {
        const e = (m[b.currency] ??= { planned: 0, actual: 0 });
        e.planned += Number(b.planned);
        e.actual += Number(b.actual);
      }
    return m;
  };
  const byCost = (a: CostNode, b: CostNode) =>
    b.credits.consumed - a.credits.consumed ||
    b.credits.reserved - a.credits.reserved ||
    a.title.localeCompare(b.title);
  const linked = new Set(i.tasks.filter((t) => t.project_id || t.campaign_id).map((t) => t.id));
  return {
    workspace,
    unlinkedTasks: [...byTask.keys()].filter((id) => !linked.has(id)).length,
    specialist: [...bySpec.entries()]
      .map(([id, c]) => ({ id, title: id, credits: c }))
      .sort(byCost),
    task: i.tasks
      .filter((t) => byTask.has(t.id))
      .map((t) => ({ id: t.id, title: t.title, credits: byTask.get(t.id)! }))
      .sort(byCost),
    project: i.projects
      .map((p) => ({ id: p.id, title: p.title, credits: sum(projectTasks.get(p.id) ?? []) }))
      .sort(byCost),
    campaign: i.campaigns
      .map((c) => ({
        id: c.id,
        title: c.title,
        credits: sum(campaignTasks.get(c.id) ?? []),
        campaignBudgetEur: Number(c.budget_eur),
      }))
      .sort(byCost),
    initiative: i.initiatives
      .map((n) => ({ id: n.id, title: n.title, credits: sum(initiativeTasks.get(n.id) ?? []) }))
      .sort(byCost),
    plan: i.plans
      .map((p) => ({
        id: p.id,
        title: `${p.title} · v${p.version}`,
        credits: sum(planTasks.get(p.id) ?? []),
      }))
      .sort(byCost),
    goal: i.goals
      .map((g) => ({
        id: g.id,
        title: g.title,
        credits: sum(goalTasks.get(g.id) ?? []),
        budget: money(g.id),
      }))
      .sort(byCost),
  };
}
