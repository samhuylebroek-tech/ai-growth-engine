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
import { spendSummary } from "@/lib/campaign-spend";
import { limitMaxima, limitUsage, spendForecast } from "@/lib/campaign-budget";

import { detectFactConflicts } from "@/lib/fact-conflicts";
import { economicsSummary, type EconAlertCode } from "@/lib/econ/summary";
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
  | "no_measurement"
  | "tasks_overdue"
  | "initiative_behind"
  | "runs_failing"
  | "runs_waiting"
  | "runs_uncertain"
  | "facts_conflict"
  | "campaign_budget_over"
  | "campaign_budget_near"
  | "campaign_emergency_stop"
  | "campaign_limit_reached"
  | "campaign_spend_forecast"
  | "replan_pending"
  | EconAlertCode;
export type SignalBasis =
  | "planning_vs_metric"
  | "team_records"
  | "website_check"
  | "pipeline"
  | "budget"
  | "ai_work"
  | "business_profile"
  | "economics";
export type SignalDestination =
  "/app/performance" | "/app/goals" | "/app/pipeline" | "/app/seo" | "/app/tasks" | "/app/profile" | "/app/campaigns" | "/app/economics" | "/app/improvements" | "/app/revenue";
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

const ECON_SIGNAL: Record<EconAlertCode, { kind: SignalKind; urgency: Level; feasibility: Level; to: SignalDestination }> = {
  econ_allocation_exceeded: { kind: "risk", urgency: "high", feasibility: "medium", to: "/app/economics" },
  econ_allocation_near: { kind: "risk", urgency: "medium", feasibility: "high", to: "/app/economics" },
  econ_budget_unallocated: { kind: "opportunity", urgency: "low", feasibility: "high", to: "/app/goals" },
  econ_budget_duplicates: { kind: "conflict", urgency: "low", feasibility: "high", to: "/app/goals" },
  econ_request_rejected: { kind: "missing", urgency: "medium", feasibility: "high", to: "/app/goals" },
  econ_cost_model_missing: { kind: "missing", urgency: "medium", feasibility: "high", to: "/app/economics" },
  econ_cost_missing: { kind: "missing", urgency: "medium", feasibility: "high", to: "/app/economics" },
  econ_customer_missing: { kind: "missing", urgency: "low", feasibility: "medium", to: "/app/revenue" },
  econ_attribution_missing: { kind: "missing", urgency: "low", feasibility: "medium", to: "/app/revenue" },
  econ_margin_declining: { kind: "risk", urgency: "medium", feasibility: "medium", to: "/app/economics" },
  econ_price_missing: { kind: "missing", urgency: "low", feasibility: "low", to: "/app/economics" },
  recommendation_measure_due: { kind: "stale", urgency: "high", feasibility: "high", to: "/app/improvements" },
};

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

  // 0. Confirmed facts that contradict each other: the Growth Officer would otherwise read both as true.
  const conflicts = detectFactConflicts(d.facts.map((f, i) => ({ ...f, id: `f${i}` }))).filter(
    (c) => c.confirmedConflict,
  );
  if (conflicts.length)
    add(
      `facts-conflict:${conflicts.map((c) => c.topic).join("|")}`,
      "facts_conflict",
      "conflict",
      "high",
      "medium",
      "high",
      "business_profile",
      "/app/profile",
      {
        n: conflicts.length,
        topics: conflicts
          .slice(0, 3)
          .map((c) => short(c.key, 40))
          .join(", "),
      },
    );

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

  // 6. Execution: overdue initiative tasks, initiatives past their planned week, and AI task runs that need attention.
  const today = now.toISOString().slice(0, 10);
  const overdue = [
    ...new Map(
      [...d.tasks, ...(d.overdueTasks?.status === "ok" ? d.overdueTasks.rows : [])]
        .filter((x) => x.due_date && x.due_date < today && !["done", "cancelled"].includes(x.status))
        .map((x) => [x.id, x]),
    ).values(),
  ];
  if (overdue.length)
    add(
      "tasks:overdue",
      "tasks_overdue",
      "risk",
      "medium",
      "high",
      "high",
      "team_records",
      "/app/tasks",
      { n: overdue.length, task: short(overdue[0]!.title) },
    );
  // Campaign budgets against the recorded spend ledger (EUR only); a truncated read gives no warning.
  if (d.campaignSpend?.status === "ok" && !d.campaignSpend.truncated)
    for (const c of rowsOf(d.campaigns).filter((x) => x.id && !["archived"].includes(x.status))) {
      const sum = spendSummary(Number(c.budget_eur), d.campaignSpend.rows.filter((x) => x.campaign_id === c.id));
      const over = sum.warnings.includes("budget_over") || sum.warnings.includes("committed_over");
      if (over || sum.warnings.includes("budget_near"))
        add(
          `campaign_budget:${c.id}`,
          over ? "campaign_budget_over" : "campaign_budget_near",
          "risk",
          over ? "high" : "medium",
          over ? "high" : "medium",
          "high",
          "budget",
          "/app/campaigns",
          { campaign: short(c.title, 60), p: sum.usedPct === null ? 0 : Math.round(sum.usedPct * 100) },
        );
    }
  // Hard spending limits (proposal 0083): an emergency stop, a limit at 90% or more of its room, or a straight-line
  // forecast above the campaign total. Actual entries only; needs a complete, dated spend read.
  if (d.campaignLimits?.status === "ok" && d.campaignSpend?.status === "ok" && !d.campaignSpend.truncated) {
    const spendRows = d.campaignSpend.rows;
    const dated = spendRows.every((x) => x.id && x.occurred_on);
    const today = now.toISOString().slice(0, 10);
    for (const c of rowsOf(d.campaigns).filter((x) => x.id && !["archived", "completed", "cancelled"].includes(x.status))) {
      const l = d.campaignLimits.rows.find((x) => x.campaign_id === c.id);
      if (!l) continue;
      if (l.emergency_stop) {
        add(`campaign_stop:${c.id}`, "campaign_emergency_stop", "risk", "high", "high", "high", "budget", "/app/campaigns", { campaign: short(c.title, 60), reason: short(l.stop_reason, 80) });
        continue;
      }
      if (!dated) continue;
      const rows = spendRows.filter((x) => x.campaign_id === c.id).map((x) => ({ id: x.id!, kind: x.kind, amount: x.amount, currency: x.currency, occurred_on: x.occurred_on!, data_class: x.data_class, relates_to: x.relates_to ?? null }));
      const top = limitUsage(l, rows, today).filter((u) => u.share >= 0.9).sort((a, b) => b.share - a.share)[0];
      if (top)
        add(`campaign_limit:${c.id}`, "campaign_limit_reached", "risk", top.share >= 1 ? "high" : "medium", "high", "high", "budget", "/app/campaigns", { campaign: short(c.title, 60), p: Math.round(top.share * 100) });
      const total = limitMaxima(l).lifetime;
      const f = total === undefined ? null : spendForecast({ start_date: c.start_date ?? null, end_date: c.end_date ?? null }, rows, l.currency, total, today);
      if (f && f.overspend && f.overspend > 0)
        add(`campaign_forecast:${c.id}`, "campaign_spend_forecast", "risk", "medium", "medium", "low", "budget", "/app/campaigns", { campaign: short(c.title, 60), p: Math.round(f.projected), b: Math.round(total!) });
    }
  }
  // Re-planning proposals waiting for an editor's decision.
  const decided = new Set((d.replanDecisions ?? []).filter((x) => x.decision !== "postponed").map((x) => x.proposal_id));
  const waitingReplans = rowsOf(d.replans).filter((r) => !decided.has(r.id)).length;
  if (waitingReplans)
    add("replan:pending", "replan_pending", "missing", "medium", "high", "high", "team_records", "/app/tasks", { n: waitingReplans });
  const approvedAt = new Map(rowsOf(d.plans).map((p) => [p.id, p.approved_at]));
  for (const i of d.initiatives
    .filter((x) => x.target_week != null && !["completed", "cancelled"].includes(x.status))
    .slice(0, 40)) {
    const at = approvedAt.get(i.plan_version_id);
    if (!at) continue;
    const late = days(at, now)! - i.target_week! * 7;
    if (late > 0)
      add(
        `behind:${i.id}`,
        "initiative_behind",
        "risk",
        "medium",
        "medium",
        "high",
        "team_records",
        "/app/goals",
        { initiative: short(i.title), week: i.target_week!, days: late },
      );
  }
  const runs = rowsOf(d.taskRuns);
  const failedPerTask = new Map<string, number>();
  for (const r of runs)
    if (r.status === "failed")
      failedPerTask.set(r.task_id, (failedPerTask.get(r.task_id) ?? 0) + 1);
  const failing = [...failedPerTask.values()].filter((n) => n >= 2).length;
  if (failing)
    add(
      "runs:failing",
      "runs_failing",
      "risk",
      "medium",
      "medium",
      "medium",
      "ai_work",
      "/app/tasks",
      { n: failing },
    );
  const waiting = runs.filter((r) => r.status === "awaiting_approval").length;
  if (waiting)
    add("runs:waiting", "runs_waiting", "missing", "low", "high", "high", "ai_work", "/app/tasks", {
      n: waiting,
    });
  const uncertain = runs.filter((r) => r.status === "uncertain").length;
  if (uncertain)
    add(
      "runs:uncertain",
      "runs_uncertain",
      "risk",
      "medium",
      "high",
      "medium",
      "ai_work",
      "/app/tasks",
      { n: uncertain },
    );

  // Financial alerts: the same summary as the Growth economics page and the Growth Officer (this calendar month).
  if (d.economics?.status === "ok") {
    const y = now.getUTCFullYear(), m = now.getUTCMonth();
    const from = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    const to = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
    const econ = economicsSummary(d.economics.data, from, to, "last_touch", now.toISOString().slice(0, 10));
    const campaignAlerted = new Set(out.filter((x) => x.id.startsWith("campaign_budget:")).map((x) => x.id.slice(16)));
    for (const a of econ.alerts) {
      const [kind, campaignId] = a.id.split(":");
      if ((kind === "over" || kind === "near") && campaignId && campaignAlerted.has(campaignId)) continue;
      const spec = ECON_SIGNAL[a.code];
      add(`econ:${a.id}`, a.code, spec.kind, a.level, spec.urgency, spec.feasibility, "economics", spec.to, a.vars);
    }
  }

  const seen = new Set<string>();
  return out
    .filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
