// Rule-based business signals: conflicts, gaps, stale records, risks and opportunities.
// Deterministic (no AI call, no credits), computed from the same scoped records the Growth Officer reads,
// so Home and the AI context always agree. Signals point at evidence; they never claim a cause.
import {
  pipelineStats,
  type BusinessDomains,
  type MetricRow,
} from "@/lib/security/business-context";
import {
  lastCompleteMonth,
  missingLastMonth,
  monthlySeries,
  summarizeMetric,
  metricStatus,
  type Measurement,
} from "@/lib/performance";
import { budgetAlert } from "@/lib/growth-plan";

export type SignalKind = "conflict" | "stale" | "missing" | "risk" | "opportunity";
export type Level = "high" | "medium" | "low";
export type SignalCode =
  | "initiative_outcome_conflict"
  | "initiative_outcome_missing"
  | "goal_metric_conflict"
  | "metric_missing_month"
  | "goal_stale"
  | "seo_stale"
  | "deals_overdue"
  | "deals_stale"
  | "budget_over_cap"
  | "budget_over_plan"
  | "metric_ahead"
  | "no_measurement";
export type SignalBasis =
  "planning_vs_metric" | "team_records" | "website_check" | "pipeline" | "budget";
export type SignalDestination = "/app/performance" | "/app/goals" | "/app/pipeline" | "/app/seo";
export type Signal = {
  id: string;
  code: SignalCode;
  kind: SignalKind;
  impact: Level;
  urgency: Level;
  feasibility: Level;
  basis: SignalBasis;
  to: SignalDestination;
  vars: Record<string, string | number>;
  score: number;
};

const W: Record<Level, number> = { high: 3, medium: 2, low: 1 };
/** Impact weighs most, then urgency, then how easily the team can act on it. */
export const signalScore = (impact: Level, urgency: Level, feasibility: Level) =>
  W[impact] * 3 + W[urgency] * 2 + W[feasibility];
const DAY = 86_400_000;
const days = (iso: string | null | undefined, now: Date) =>
  iso ? Math.floor((now.getTime() - new Date(iso).getTime()) / DAY) : null;
const short = (v: unknown, n = 80) => {
  const s = String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};
const rowsOf = <T>(r: { status: "ok"; rows: T[] } | { status: "unavailable" } | undefined) =>
  r && r.status === "ok" ? r.rows : [];

/** Codes already shown elsewhere on Home (performance attention); still part of the AI context. */
export const HOME_DUPLICATES: ReadonlySet<SignalCode> = new Set(["metric_missing_month"]);

export function detectSignals(d: BusinessDomains, now: Date = new Date()): Signal[] {
  const out: Signal[] = [];
  const add = (
    id: string,
    code: SignalCode,
    kind: SignalKind,
    impact: Level,
    urgency: Level,
    feasibility: Level,
    basis: SignalBasis,
    to: SignalDestination,
    vars: Record<string, string | number> = {},
  ) =>
    out.push({
      id,
      code,
      kind,
      impact,
      urgency,
      feasibility,
      basis,
      to,
      vars,
      score: signalScore(impact, urgency, feasibility),
    });
  const metrics: MetricRow[] = rowsOf(d.metrics);
  const rows: Measurement[] = d.measurements ?? [];
  const forMetric = (m: MetricRow) => rows.filter((r) => r.metric_id === m.id);
  const latestActual = (m: MetricRow) => summarizeMetric(m, forMetric(m)).actual;

  // 1. Completed initiatives: a finished task list is not a business result.
  for (const i of d.initiatives.filter((x) => x.status === "completed")) {
    const op = d.operations.find((o) => o.initiative_id === i.id);
    const linked = metrics.filter((m) => m.initiative_id === i.id);
    const reachedOnPaper =
      op?.target_value != null && op.current_value != null && op.current_value >= op.target_value;
    const behind = linked.find((m) => metricStatus(summarizeMetric(m, forMetric(m))) === "behind");
    if (reachedOnPaper && behind) {
      const s = summarizeMetric(behind, forMetric(behind));
      add(
        `conflict:${i.id}:${behind.id}`,
        "initiative_outcome_conflict",
        "conflict",
        "high",
        "medium",
        "high",
        "planning_vs_metric",
        "/app/performance",
        {
          initiative: short(i.title),
          metric: short(behind.label, 50),
          recorded: op!.current_value!,
          actual: s.actual?.value ?? "?",
          planned: s.planned ?? "?",
        },
      );
    } else if (
      (op?.target_value == null || op?.current_value == null) &&
      !linked.some((m) => latestActual(m))
    ) {
      add(
        `outcome:${i.id}`,
        "initiative_outcome_missing",
        "missing",
        "medium",
        "medium",
        "high",
        "team_records",
        "/app/goals",
        { initiative: short(i.title) },
      );
    }
  }

  // 2. Goal figure typed by the team vs. the latest result of a metric linked to the same goal.
  for (const g of d.goals.filter((x) => x.status === "active" && x.current_value != null)) {
    for (const m of metrics.filter((x) => x.goal_id === g.id)) {
      const a = latestActual(m);
      if (!a) continue;
      const goalValue = Number(g.current_value);
      const actual = Number(a.value);
      const base = Math.max(Math.abs(goalValue), Math.abs(actual), 1);
      if (Math.abs(goalValue - actual) / base > 0.1)
        add(
          `goalmetric:${g.id}:${m.id}`,
          "goal_metric_conflict",
          "conflict",
          "medium",
          "medium",
          "high",
          "planning_vs_metric",
          "/app/goals",
          { goal: short(g.title), goalValue, metric: short(m.label, 50), actual },
        );
    }
  }

  // 3. Gaps and stale records.
  const month = lastCompleteMonth(now);
  for (const m of missingLastMonth(
    metrics.map((x) => ({ ...x, archived: false })),
    rows,
    now,
  ))
    add(
      `month:${m.id}:${month}`,
      "metric_missing_month",
      "missing",
      m.goal_id ? "medium" : "low",
      "high",
      "high",
      "team_records",
      "/app/performance",
      { metric: short(m.label, 50), month },
    );
  for (const g of d.goals.filter((x) => x.status === "active")) {
    const age = days(g.updated_at, now);
    if (age != null && age > 60)
      add(
        `stale:${g.id}`,
        "goal_stale",
        "stale",
        "medium",
        "low",
        "high",
        "team_records",
        "/app/goals",
        { goal: short(g.title), days: age },
      );
  }
  const audit = rowsOf(d.seo)[0];
  const auditAge = days(audit?.created_at, now);
  if (audit && auditAge != null && auditAge > 30)
    add("seo:stale", "seo_stale", "stale", "low", "low", "high", "website_check", "/app/seo", {
      days: auditAge,
    });
  if (d.goals.some((g) => g.status === "active") && d.metrics?.status === "ok" && !metrics.length)
    add(
      "measure:none",
      "no_measurement",
      "missing",
      "high",
      "medium",
      "high",
      "team_records",
      "/app/performance",
    );

  // 4. Pipeline and budget risks (currencies are never combined).
  const deals = rowsOf(d.deals);
  if (deals.length) {
    const p = pipelineStats(deals, now);
    if (p.overdueClose)
      add(
        "deals:overdue",
        "deals_overdue",
        "risk",
        "medium",
        "high",
        "medium",
        "pipeline",
        "/app/pipeline",
        { n: p.overdueClose },
      );
    if (p.staleOpen)
      add(
        "deals:stale",
        "deals_stale",
        "stale",
        "medium",
        "medium",
        "medium",
        "pipeline",
        "/app/pipeline",
        { n: p.staleOpen },
      );
  }
  const thisMonth = now.toISOString().slice(0, 7);
  for (const l of rowsOf(d.budget).filter((x) => x.period_month.slice(0, 7) === thisMonth)) {
    const alert = budgetAlert({
      planned: Number(l.planned),
      actual: Number(l.actual),
      hard_cap: l.hard_cap == null ? null : Number(l.hard_cap),
    });
    if (alert === "over_cap")
      add(
        `budget:cap:${l.channel}:${l.currency}`,
        "budget_over_cap",
        "risk",
        "high",
        "high",
        "medium",
        "budget",
        "/app/goals",
        { channel: short(l.channel, 40), currency: l.currency },
      );
    else if (alert === "over_plan")
      add(
        `budget:plan:${l.channel}:${l.currency}`,
        "budget_over_plan",
        "risk",
        "medium",
        "medium",
        "medium",
        "budget",
        "/app/goals",
        { channel: short(l.channel, 40), currency: l.currency },
      );
  }

  // 5. Opportunity: the last two months with a plan and a result both met or beat the plan.
  for (const m of metrics) {
    const pts = monthlySeries(forMetric(m))
      .filter((p) => p.planned != null && p.actual != null)
      .slice(-2);
    const beat = (p: { planned: number | null; actual: number | null }) =>
      m.direction === "decrease" ? p.actual! <= p.planned! : p.actual! >= p.planned!;
    if (pts.length === 2 && pts.every(beat))
      add(
        `ahead:${m.id}`,
        "metric_ahead",
        "opportunity",
        "medium",
        "low",
        "medium",
        "planning_vs_metric",
        "/app/performance",
        { metric: short(m.label, 50) },
      );
  }

  const seen = new Set<string>();
  return out
    .filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
