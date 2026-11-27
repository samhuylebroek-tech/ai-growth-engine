// Strategy, initiative, campaign, channel, specialist and period comparison. Pure.
// Rows are ranked only against rows with the same objective and a similar time horizon; rows with different
// objectives are shown side by side but never ranked against each other, and revenue alone never decides a rank.
import type { Credit } from "./attribution";
import type { DataClass } from "./provenance";

export type Dimension = "plan" | "initiative" | "campaign" | "channel" | "specialist" | "period";
export const DIMENSIONS: Dimension[] = [
  "plan",
  "initiative",
  "campaign",
  "channel",
  "specialist",
  "period",
];
export type Money = Record<string, { planned: number; actual: number }>;

export type CompareRow = {
  id: string;
  label: string;
  /** Objective used for comparability (goal objective + metric, success metric, or the dimension itself). */
  objective: string | null;
  horizonDays: number | null;
  budget: Money;
  credits: number;
  expected: number | null;
  actual: number | null;
  /** Share of the target reached, 0–100+, from baseline to target. */
  progress: number | null;
  attributed: Record<string, number>;
  daysToFirstResult: number | null;
  tasksDone: number;
  tasksTotal: number;
  runs: { succeeded: number; failed: number };
  evidence: DataClass | null;
};

export type Reason = {
  code:
    | "higher_progress"
    | "cheaper_progress"
    | "faster"
    | "more_efficient_spend"
    | "more_reliable_runs"
    | "stronger_evidence"
    | "more_done";
  vars: Record<string, string | number>;
};
export type Ranked = CompareRow & { rank: number | null; reasons: Reason[] };
export type Group = {
  key: string;
  objective: string | null;
  horizon: string;
  comparable: boolean;
  rows: Ranked[];
};
export const ASSUMPTIONS = [
  "same_objective",
  "similar_horizon",
  "progress_first",
  "currencies_separate",
  "attribution_model",
  "credits_not_money",
  "manual_unverified",
] as const;

export const progressOf = (
  baseline: number | null,
  target: number | null,
  current: number | null,
) => {
  if (target === null || current === null) return null;
  const b = baseline ?? 0;
  if (target === b) return current === target ? 100 : null;
  return Math.round(((current - b) / (target - b)) * 1000) / 10;
};
const horizon = (d: number | null) =>
  d === null ? "unknown" : d <= 30 ? "30" : d <= 90 ? "90" : d <= 180 ? "180" : "long";
const spent = (m: Money) => Object.values(m).reduce((s, x) => s + x.actual, 0);
const singleCurrency = (m: Money) => {
  const k = Object.keys(m).filter((c) => m[c]!.actual > 0);
  return k.length === 1 ? k[0]! : null;
};
const EV: Record<DataClass, number> = { actual: 3, manual: 2, estimated: 1, planned: 0 };

function score(dim: Dimension, r: CompareRow): number | null {
  if (dim === "specialist") {
    const n = r.runs.succeeded + r.runs.failed;
    return n ? r.runs.succeeded / n : null;
  }
  if (dim === "channel") {
    const cur = singleCurrency(r.budget);
    const rev = cur ? r.attributed[cur] : undefined;
    return cur && rev !== undefined && r.budget[cur]!.actual > 0
      ? rev / r.budget[cur]!.actual
      : null;
  }
  if (dim === "period") return null;
  return r.progress;
}

/** Explains why `a` ranks above `b`, using only numbers both rows actually have. */
export function reasons(dim: Dimension, a: CompareRow, b: CompareRow): Reason[] {
  const out: Reason[] = [];
  if (a.progress !== null && b.progress !== null && a.progress > b.progress)
    out.push({ code: "higher_progress", vars: { a: a.progress, b: b.progress } });
  const cpa = a.progress && a.credits ? a.credits / a.progress : null,
    cpb = b.progress && b.credits ? b.credits / b.progress : null;
  if (cpa !== null && cpb !== null && cpa < cpb)
    out.push({
      code: "cheaper_progress",
      vars: { a: Math.round(cpa * 10) / 10, b: Math.round(cpb * 10) / 10 },
    });
  if (
    a.daysToFirstResult !== null &&
    b.daysToFirstResult !== null &&
    a.daysToFirstResult < b.daysToFirstResult
  )
    out.push({ code: "faster", vars: { a: a.daysToFirstResult, b: b.daysToFirstResult } });
  if (dim === "channel") {
    const sa = score(dim, a),
      sb = score(dim, b);
    if (sa !== null && sb !== null && sa > sb)
      out.push({
        code: "more_efficient_spend",
        vars: { a: Math.round(sa * 100) / 100, b: Math.round(sb * 100) / 100 },
      });
  }
  if (dim === "specialist") {
    const sa = score(dim, a),
      sb = score(dim, b);
    if (sa !== null && sb !== null && sa > sb)
      out.push({
        code: "more_reliable_runs",
        vars: { a: Math.round(sa * 100), b: Math.round(sb * 100) },
      });
  }
  if (a.evidence && b.evidence && EV[a.evidence] > EV[b.evidence])
    out.push({ code: "stronger_evidence", vars: { a: a.evidence, b: b.evidence } });
  if (a.tasksTotal && b.tasksTotal && a.tasksDone / a.tasksTotal > b.tasksDone / b.tasksTotal)
    out.push({
      code: "more_done",
      vars: {
        a: Math.round((a.tasksDone / a.tasksTotal) * 100),
        b: Math.round((b.tasksDone / b.tasksTotal) * 100),
      },
    });
  return out;
}

export function compare(dim: Dimension, rows: readonly CompareRow[]): Group[] {
  const groups = new Map<string, CompareRow[]>();
  for (const r of rows) {
    const key =
      dim === "plan" || dim === "initiative" || dim === "campaign"
        ? `${r.objective ?? "none"}|${horizon(r.horizonDays)}`
        : dim;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([key, rs]) => {
      const objective = rs[0]!.objective;
      const comparable =
        dim === "period"
          ? false
          : (dim === "channel" || dim === "specialist" || objective !== null) && rs.length > 1;
      const scored = rs.map((r) => ({ r, s: comparable ? score(dim, r) : null }));
      scored.sort(
        (x, y) =>
          (y.s ?? -Infinity) - (x.s ?? -Infinity) ||
          (dim === "period"
            ? y.r.label.localeCompare(x.r.label)
            : x.r.label.localeCompare(y.r.label)),
      );
      let rank = 0;
      const ranked: Ranked[] = scored.map(({ r, s }, i) => {
        const next = scored[i + 1];
        const myRank = s === null ? null : ++rank;
        return {
          ...r,
          rank: myRank,
          reasons: myRank !== null && next && next.s !== null ? reasons(dim, r, next.r) : [],
        };
      });
      return {
        key,
        objective,
        horizon:
          dim === "plan" || dim === "initiative" || dim === "campaign"
            ? horizon(rs[0]!.horizonDays)
            : "n/a",
        comparable,
        rows: ranked,
      };
    })
    .sort((a, b) => Number(b.comparable) - Number(a.comparable) || b.rows.length - a.rows.length);
}

// ---- Row builders from records read under the caller's RLS ----------------------------------------------------
export type Src = {
  goals: readonly {
    id: string;
    title: string;
    objective: string;
    metric: string;
    baseline: number | null;
    target: number | null;
    current_value: number | null;
    due_date: string | null;
    created_at: string;
  }[];
  plans: readonly {
    id: string;
    goal_id: string;
    title: string;
    version: number;
    status: string;
    approved_at: string | null;
    created_at: string;
  }[];
  initiatives: readonly {
    id: string;
    plan_version_id: string;
    title: string;
    channel: string;
    project_id: string | null;
    created_at: string;
  }[];
  operations: readonly {
    initiative_id: string;
    success_metric: string;
    baseline_value: number | null;
    target_value: number | null;
    current_value: number | null;
    due_date: string | null;
  }[];
  campaigns: readonly {
    id: string;
    title: string;
    objective: string;
    goal_id: string | null;
    budget_eur: number;
    start_date: string | null;
    end_date: string | null;
    created_at: string;
  }[];
  budget: readonly {
    goal_id: string | null;
    initiative_id?: string | null;
    channel: string;
    period_month: string;
    planned: number;
    actual: number;
    currency: string;
  }[];
  tasks: readonly {
    id: string;
    project_id: string | null;
    campaign_id: string | null;
    status: string;
    updated_at?: string;
    created_at: string;
  }[];
  runs: readonly {
    task_id: string;
    specialist_key: string;
    status: string;
    credits_charged: number | null;
    created_at: string;
    finished_at: string | null;
  }[];
  credits: readonly Credit[];
  /** Effective actual measurement dates per campaign (first result) */
  firstResult: ReadonlyMap<string, string>;
  /** Per-month revenue per currency, for the period dimension. */
  monthly?: ReadonlyMap<string, { attributed: Record<string, number>; spend: Money }>;
};

const days = (a: string | null | undefined, b: string | null | undefined) =>
  a && b
    ? Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000))
    : null;
const moneyOf = (rows: Src["budget"]) => {
  const m: Money = {};
  for (const b of rows) {
    const e = (m[b.currency] ??= { planned: 0, actual: 0 });
    e.planned += Number(b.planned);
    e.actual += Number(b.actual);
  }
  return m;
};

export function buildRows(
  dim: Dimension,
  src: Src,
  attributed: ReadonlyMap<string, Record<string, number>>,
): CompareRow[] {
  const taskDone = (ids: string[]) =>
    src.tasks.filter((t) => ids.includes(t.id) && t.status === "done").length;
  const runsOf = (ids: string[]) => src.runs.filter((r) => ids.includes(r.task_id));
  const creditsOf = (ids: string[]) =>
    runsOf(ids).reduce((s, r) => s + (r.credits_charged ?? 0), 0);
  const runStats = (ids: string[]) => {
    const rs = runsOf(ids);
    return {
      succeeded: rs.filter((r) => r.status === "succeeded").length,
      failed: rs.filter((r) => r.status === "failed").length,
    };
  };
  const projTasks = (projectIds: (string | null)[]) =>
    src.tasks.filter((t) => t.project_id && projectIds.includes(t.project_id)).map((t) => t.id);
  const opOf = new Map(src.operations.map((o) => [o.initiative_id, o]));
  const base = (id: string, label: string): CompareRow => ({
    id,
    label,
    objective: null,
    horizonDays: null,
    budget: {},
    credits: 0,
    expected: null,
    actual: null,
    progress: null,
    attributed: attributed.get(id) ?? {},
    daysToFirstResult: null,
    tasksDone: 0,
    tasksTotal: 0,
    runs: { succeeded: 0, failed: 0 },
    evidence: null,
  });

  if (dim === "initiative" || dim === "plan") {
    const initRow = (n: Src["initiatives"][number]): CompareRow => {
      const op = opOf.get(n.id);
      const ids = projTasks([n.project_id]);
      return {
        ...base(`initiative:${n.id}`, n.title),
        objective: op?.success_metric?.trim().toLowerCase() || null,
        horizonDays: days(n.created_at, op?.due_date),
        budget: moneyOf(src.budget.filter((b) => b.initiative_id === n.id)),
        credits: creditsOf(ids),
        expected: op?.target_value ?? null,
        actual: op?.current_value ?? null,
        progress: op ? progressOf(op.baseline_value, op.target_value, op.current_value) : null,
        tasksDone: taskDone(ids),
        tasksTotal: ids.length,
        runs: runStats(ids),
        evidence: op?.current_value != null ? "manual" : null,
      };
    };
    if (dim === "initiative") return src.initiatives.map(initRow);
    return src.plans
      .filter((p) => p.status === "approved" || p.status === "superseded" || p.approved_at)
      .map((p) => {
        const g = src.goals.find((x) => x.id === p.goal_id);
        const kids = src.initiatives.filter((n) => n.plan_version_id === p.id).map(initRow);
        const withP = kids.filter((k) => k.progress !== null);
        const ids = projTasks(
          src.initiatives.filter((n) => n.plan_version_id === p.id).map((n) => n.project_id),
        );
        const money: Money = {};
        for (const k of kids)
          for (const [c, v] of Object.entries(k.budget)) {
            const e = (money[c] ??= { planned: 0, actual: 0 });
            e.planned += v.planned;
            e.actual += v.actual;
          }
        const attr: Record<string, number> = {};
        for (const k of kids)
          for (const [c, v] of Object.entries(k.attributed)) attr[c] = (attr[c] ?? 0) + v;
        return {
          ...base(`plan:${p.id}`, `${p.title} · v${p.version}`),
          objective: g ? `${g.objective}|${g.metric}`.toLowerCase() : null,
          horizonDays: days(p.approved_at ?? p.created_at, g?.due_date),
          budget: money,
          credits: creditsOf(ids),
          attributed: attr,
          progress: withP.length
            ? Math.round((withP.reduce((s, k) => s + k.progress!, 0) / withP.length) * 10) / 10
            : null,
          tasksDone: taskDone(ids),
          tasksTotal: ids.length,
          runs: runStats(ids),
          evidence: withP.length ? "manual" : null,
        };
      });
  }
  if (dim === "campaign")
    return src.campaigns.map((c) => {
      const g = c.goal_id ? src.goals.find((x) => x.id === c.goal_id) : undefined;
      const ids = src.tasks.filter((t) => t.campaign_id === c.id).map((t) => t.id);
      return {
        ...base(`campaign:${c.id}`, c.title),
        objective: g
          ? `${g.objective}|${g.metric}`.toLowerCase()
          : c.objective.trim().toLowerCase() || null,
        horizonDays: days(c.start_date ?? c.created_at, c.end_date),
        budget:
          Number(c.budget_eur) > 0 ? { EUR: { planned: Number(c.budget_eur), actual: 0 } } : {},
        credits: creditsOf(ids),
        progress: g ? progressOf(g.baseline, g.target, g.current_value) : null,
        daysToFirstResult: days(c.start_date ?? c.created_at, src.firstResult.get(c.id)),
        tasksDone: taskDone(ids),
        tasksTotal: ids.length,
        runs: runStats(ids),
      };
    });
  if (dim === "channel") {
    const names = new Set([
      ...src.budget.map((b) => b.channel.trim().toLowerCase()).filter(Boolean),
      ...[...attributed.keys()].filter((k) => k.startsWith("channel:")).map((k) => k.slice(8)),
    ]);
    return [...names].map((ch) => ({
      ...base(`channel:${ch}`, ch),
      objective: "channel",
      budget: moneyOf(src.budget.filter((b) => b.channel.trim().toLowerCase() === ch)),
    }));
  }
  if (dim === "specialist") {
    const keys = [...new Set(src.runs.map((r) => r.specialist_key))];
    return keys.map((k) => {
      const rs = src.runs.filter((r) => r.specialist_key === k);
      const ids = [...new Set(rs.map((r) => r.task_id))];
      const durations = rs
        .filter((r) => r.finished_at)
        .map((r) => days(r.created_at, r.finished_at)!);
      return {
        ...base(`specialist:${k}`, k),
        objective: "execution",
        credits: rs.reduce((s, r) => s + (r.credits_charged ?? 0), 0),
        runs: {
          succeeded: rs.filter((r) => r.status === "succeeded").length,
          failed: rs.filter((r) => r.status === "failed").length,
        },
        tasksDone: taskDone(ids),
        tasksTotal: ids.length,
        daysToFirstResult: durations.length ? Math.min(...durations) : null,
        evidence: "actual" as DataClass,
      };
    });
  }
  // period: one row per month with spend, attributed revenue and AI credits.
  const months = [...(src.monthly?.keys() ?? [])].sort().reverse();
  return months.map((m) => {
    const v = src.monthly!.get(m)!;
    const credits = src.runs
      .filter((r) => r.created_at.slice(0, 7) === m)
      .reduce((s, r) => s + (r.credits_charged ?? 0), 0);
    const done = src.tasks.filter(
      (t) => t.status === "done" && (t.updated_at ?? t.created_at).slice(0, 7) === m,
    ).length;
    return {
      ...base(`period:${m}`, m),
      objective: "period",
      budget: v.spend,
      attributed: v.attributed,
      credits,
      tasksDone: done,
      tasksTotal: done,
    };
  });
}

/** Spend share actually used, per currency (actual ÷ planned), never across currencies. */
export const budgetUse = (m: Money) =>
  Object.entries(m).map(([currency, v]) => ({
    currency,
    planned: v.planned,
    actual: v.actual,
    use: v.planned > 0 ? Math.round((v.actual / v.planned) * 100) : null,
  }));
export const totalSpend = spent;
