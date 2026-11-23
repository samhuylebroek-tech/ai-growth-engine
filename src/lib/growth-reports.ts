// Initiative, strategy and recommendation-learning reports (pure; Phase 9). Same rules as `reports.ts`: figures come
// only from rows read under the caller's RLS and anything that cannot be computed is listed as missing (never zero).
// Money and AI credits come only from the canonical economics rollup (`econ/rollup.ts`) for the report period, so
// these reports show the same amounts as the Growth economics page; work progress counts each task and campaign once
// per initiative or strategy (a task linked through both a project and a campaign is not counted twice).
import { goalMeasurement, type GoalLike } from "@/lib/goal-measurement";
import { learningPatterns, type Learning, type Pattern } from "@/lib/econ/learning";
import { rollup, type Level, type RollupInput, type Totals } from "@/lib/econ/rollup";
import type { Period } from "@/lib/reports";

export type GInitiative = {
  id: string;
  title: string;
  status: string;
  plan_version_id: string;
  goal_id: string | null;
  project_id: string | null;
  channel: string;
};
export type GPlan = {
  id: string;
  goal_id: string;
  strategy_id: string | null;
  version: number;
  status: string;
  title: string;
  approved_at: string | null;
  created_at: string;
  plan_snapshot?: unknown;
};
export type GCampaign = {
  id: string;
  title: string;
  status: string;
  goal_id: string | null;
  initiative_id: string | null;
  strategy_id?: string | null;
  budget_eur: number | string;
};
export type GTask = {
  id: string;
  status: string;
  project_id: string | null;
  campaign_id: string | null;
  due_date: string | null;
};
export type GOperation = {
  initiative_id: string;
  success_metric: string;
  baseline_value: number | null;
  target_value: number | null;
  current_value: number | null;
  due_date: string | null;
};
export type GGoal = GoalLike & { id: string; title: string; status: string };
export type GBudget = {
  goal_id: string | null;
  initiative_id: string | null;
  planned: number | string;
  currency: string;
};

export type LineMissing =
  "no_work" | "no_kpi" | "kpi_incomplete" | "no_spend" | "no_budget" | "money_unavailable";
export type WorkFigures = {
  campaigns: number;
  tasks: number;
  done: number;
  open: number;
  overdue: number;
};
export type InitiativeLine = {
  id: string;
  title: string;
  status: string;
  planVersionId: string;
  channel: string;
  work: WorkFigures;
  /** Canonical totals for the period (spending, reservations, costs, credits); null when the ledgers could not be read. */
  money: Totals | null;
  kpi: {
    metric: string;
    baseline: number | null;
    target: number | null;
    current: number | null;
    progress: number | null;
  } | null;
  missing: LineMissing[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const DONE = ["done", "completed"];
const CLOSED = [...DONE, "cancelled"];
/** Economics rows for one report; spending, costs and credits are limited to the period here, allocations are budget. */
export type EconInput = Omit<RollupInput, "credits" | "spend"> & {
  credits: readonly (RollupInput["credits"][number] & { at: string })[];
  spend: readonly (RollupInput["spend"][number] & { occurred_on: string })[];
};
type Input = {
  initiatives: readonly GInitiative[];
  campaigns: readonly GCampaign[];
  tasks: readonly GTask[];
  operations: readonly GOperation[];
  econ: EconInput | null;
};

export function periodRollup(
  econ: EconInput | null,
  level: Level,
  id: string,
  p: Period,
): Totals | null {
  if (!econ) return null;
  const inP2 = (d: string) => d.slice(0, 10) >= p.from && d.slice(0, 10) <= p.to;
  return rollup(level, id, {
    ...econ,
    spend: econ.spend.filter((s) => inP2(s.occurred_on)),
    costs: econ.costs.filter((c) => c.period_start >= p.from && c.period_end <= p.to),
    credits: econ.credits.filter((c) => inP2(c.at)),
  });
}
/** The canonical rollup over an explicit set of campaigns (each once) plus business costs booked on the given
 *  initiatives: the business-level rule applied to that subset, so no amount is computed differently. */
export function scopedRollup(
  econ: EconInput | null,
  campaignIds: ReadonlySet<string>,
  initiativeIds: ReadonlySet<string>,
  p: Period,
): Totals | null {
  if (!econ) return null;
  const inP2 = (d: string) => d.slice(0, 10) >= p.from && d.slice(0, 10) <= p.to;
  return rollup("business", null, {
    campaigns: econ.campaigns.filter((c) => campaignIds.has(c.id)),
    allocations: econ.allocations,
    spend: econ.spend.filter((s) => campaignIds.has(s.campaign_id) && inP2(s.occurred_on)),
    costs: econ.costs.filter(
      (c) =>
        !!c.initiative_id &&
        initiativeIds.has(c.initiative_id) &&
        c.period_start >= p.from &&
        c.period_end <= p.to,
    ),
    credits: econ.credits.filter(
      (c) => !!c.campaign_id && campaignIds.has(c.campaign_id) && inP2(c.at),
    ),
  });
}
/** Actual spending or recorded costs only: simulated amounts never hide that real spending is missing. */
const hasMoney = (t: Totals) =>
  [t.spent, t.directCosts].some((m) => Object.values(m).some((v) => v !== 0));

/** Unique campaigns and tasks behind a set of initiatives (through their project and their campaigns). */
function workOf(
  inits: readonly GInitiative[],
  i: Pick<Input, "campaigns" | "tasks">,
  today: string,
  strategyId?: string | null,
): WorkFigures & { campIds: Set<string> } {
  const ids = new Set(inits.map((n) => n.id));
  const projects = new Set(inits.map((n) => n.project_id).filter((p): p is string => !!p));
  // A strategy's campaigns: those of its initiatives plus those linked to its strategy record, each once.
  const campaigns = i.campaigns.filter(
    (c) =>
      (c.initiative_id && ids.has(c.initiative_id)) ||
      (!!strategyId && c.strategy_id === strategyId),
  );
  const campIds = new Set(campaigns.map((c) => c.id));
  const tasks = i.tasks.filter(
    (t) =>
      (t.project_id && projects.has(t.project_id)) || (t.campaign_id && campIds.has(t.campaign_id)),
  );
  const open = tasks.filter((t) => !CLOSED.includes(t.status));
  return {
    campaigns: campaigns.length,
    tasks: tasks.length,
    done: tasks.filter((t) => DONE.includes(t.status)).length,
    open: open.length,
    overdue: open.filter((t) => !!t.due_date && t.due_date < today).length,
    campIds,
  };
}
const plain = ({ campIds: _c, ...w }: WorkFigures & { campIds: Set<string> }): WorkFigures => w;

export function initiativeLines(i: Input, p: Period, today: string): InitiativeLine[] {
  return i.initiatives.map((n) => {
    const w = workOf([n], i, today);
    const money = periodRollup(i.econ, "initiative", n.id, p);
    const op = i.operations.find((o) => o.initiative_id === n.id);
    const missing: LineMissing[] = [];
    if (w.tasks === 0 && w.campaigns === 0) missing.push("no_work");
    let kpi: InitiativeLine["kpi"] = null;
    if (!op || !op.success_metric.trim()) missing.push("no_kpi");
    else {
      const m = goalMeasurement(
        {
          metric: op.success_metric,
          baseline: op.baseline_value,
          target: op.target_value,
          current_value: op.current_value,
          due_date: op.due_date,
        },
        today,
      );
      if (!m.measurable || op.current_value === null) missing.push("kpi_incomplete");
      kpi = {
        metric: op.success_metric,
        baseline: op.baseline_value,
        target: op.target_value,
        current: op.current_value,
        progress: m.progress,
      };
    }
    if (!money) missing.push("money_unavailable");
    else if (w.campaigns > 0 && !hasMoney(money)) missing.push("no_spend");
    return {
      id: n.id,
      title: n.title,
      status: n.status,
      planVersionId: n.plan_version_id,
      channel: n.channel,
      work: plain(w),
      money,
      kpi,
      missing,
    };
  });
}

export type StrategyMissing = LineMissing | "goal_not_measurable" | "no_initiatives";
export type StrategyLine = {
  id: string;
  goalId: string;
  goalTitle: string;
  title: string;
  version: number;
  status: string;
  approvedAt: string | null;
  goal: {
    progress: number | null;
    pace: string | null;
    baseline: number | null;
    target: number | null;
    current: number | null;
    metric: string;
  } | null;
  initiatives: Record<string, number>;
  initiativesWithoutWork: number;
  work: WorkFigures;
  /** Canonical totals of the strategy's campaigns (its initiatives' campaigns and those linked to its strategy record,
   *  each once) plus business costs booked on its initiatives; null when the ledgers could not be read. */
  money: Totals | null;
  /** Planned amounts of the goal's budget lines, per currency (entered plans, never spending). */
  budget: Record<string, number>;
  /** Goal campaigns that are not part of any initiative of this version (shown, not counted into the strategy). */
  unlinkedGoalCampaigns: number;
  assumptions: number;
  risks: number;
  /** A newer draft of this goal is waiting for a decision. */
  pendingDraft: boolean;
  missing: StrategyMissing[];
};

const listLen = (snap: unknown, k: string) => {
  const v = snap && typeof snap === "object" ? (snap as Record<string, unknown>)[k] : undefined;
  return Array.isArray(v) ? v.length : 0;
};

/** One line per approved (current) or superseded strategy version of a goal that is not archived; drafts and rejected
 *  versions are decisions, not strategies in effect. */
export function strategyLines(
  i: Input & { plans: readonly GPlan[]; goals: readonly GGoal[]; budget: readonly GBudget[] },
  p: Period,
  today: string,
): StrategyLine[] {
  const archived = new Set(i.goals.filter((g) => g.status === "archived").map((g) => g.id));
  return i.plans
    .filter(
      (v) => (v.status === "approved" || v.status === "superseded") && !archived.has(v.goal_id),
    )
    .sort((a, b) => a.goal_id.localeCompare(b.goal_id) || b.version - a.version)
    .map((v) => {
      const inits = i.initiatives.filter((n) => n.plan_version_id === v.id);
      const w = workOf(inits, i, today, v.strategy_id);
      const money = scopedRollup(i.econ, w.campIds, new Set(inits.map((n) => n.id)), p);
      const g = i.goals.find((x) => x.id === v.goal_id);
      const m = g ? goalMeasurement(g, today) : null;
      const byStatus: Record<string, number> = {};
      for (const n of inits) byStatus[n.status] = (byStatus[n.status] ?? 0) + 1;
      const withoutWork = inits.filter(
        (n) => !n.project_id && !i.campaigns.some((c) => c.initiative_id === n.id),
      ).length;
      const budget: StrategyLine["budget"] = {};
      for (const b of i.budget)
        if (b.goal_id === v.goal_id)
          budget[b.currency] = r2((budget[b.currency] ?? 0) + Number(b.planned));
      const missing: StrategyMissing[] = [];
      if (!inits.length) missing.push("no_initiatives");
      if (!m || !m.measurable) missing.push("goal_not_measurable");
      if (!Object.keys(budget).length) missing.push("no_budget");
      if (!money) missing.push("money_unavailable");
      else if (w.campaigns > 0 && !hasMoney(money)) missing.push("no_spend");
      return {
        id: v.id,
        goalId: v.goal_id,
        goalTitle: g?.title ?? "",
        title: v.title,
        version: v.version,
        status: v.status,
        approvedAt: v.approved_at,
        goal:
          g && m
            ? {
                progress: m.progress,
                pace: m.pace,
                baseline: g.baseline,
                target: g.target,
                current: g.current_value,
                metric: g.metric,
              }
            : null,
        initiatives: byStatus,
        initiativesWithoutWork: withoutWork,
        work: plain(w),
        money,
        budget,
        unlinkedGoalCampaigns: i.campaigns.filter(
          (c) => c.goal_id === v.goal_id && !w.campIds.has(c.id) && c.status !== "archived",
        ).length,
        assumptions: listLen(v.plan_snapshot, "assumptions"),
        risks: listLen(v.plan_snapshot, "risks"),
        pendingDraft: i.plans.some(
          (d) => d.goal_id === v.goal_id && d.status === "draft" && d.version > v.version,
        ),
        missing,
      };
    });
}

export type LProposal = {
  id: string;
  status: string;
  outcome: string | null;
  created_at: string;
  decided_at: string | null;
  measured_at: string | null;
  campaign_id: string | null;
  category: string;
};
export type LearningReport = {
  created: number;
  converted: number;
  measured: number;
  rejected: number;
  outcomes: { improved: number; no_change: number; worse: number; inconclusive: number };
  /** Converted work whose outcome has not been measured yet (any age). */
  awaitingMeasurement: number;
  learnings: Record<string, number>;
  evidence: Record<string, number>;
  patterns: Pattern[];
};
const inP = (iso: string | null | undefined, p: Period) =>
  !!iso && iso.slice(0, 10) >= p.from && iso.slice(0, 10) <= p.to;

/** Recommendation learning in the period. Outcomes come from recorded measurements; patterns use every actual learning so far. */
export function learningReport(
  proposals: readonly LProposal[],
  learnings: readonly Learning[],
  p: Period,
): LearningReport {
  const measured = proposals.filter((x) => x.status === "measured" && inP(x.measured_at, p));
  const outcomes = { improved: 0, no_change: 0, worse: 0, inconclusive: 0 };
  for (const x of measured) {
    const k =
      x.outcome === "improved" || x.outcome === "no_change" || x.outcome === "worse"
        ? x.outcome
        : "inconclusive";
    outcomes[k] += 1;
  }
  const inPeriod = learnings.filter((l) => inP(l.created_at, p));
  const count = (xs: readonly string[]) =>
    xs.reduce<Record<string, number>>((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {});
  return {
    created: proposals.filter((x) => inP(x.created_at, p)).length,
    converted: proposals.filter(
      (x) => (x.status === "converted" || x.status === "measured") && inP(x.decided_at, p),
    ).length,
    measured: measured.length,
    rejected: proposals.filter((x) => x.status === "rejected" && inP(x.decided_at, p)).length,
    outcomes,
    awaitingMeasurement: proposals.filter((x) => x.status === "converted").length,
    learnings: count(inPeriod.map((l) => l.outcome_class)),
    evidence: count(inPeriod.map((l) => l.evidence_class)),
    patterns: learningPatterns(learnings, proposals),
  };
}
