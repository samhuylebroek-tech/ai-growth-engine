// Business reports (pure). One architecture for every report type: a period and the previous period of the same
// length, figures computed only from recorded rows read under the caller's RLS, each figure labelled as recorded,
// computed or estimated, and an explicit list of what is missing. Nothing is projected or invented.
import { campaignHealth, type HealthState } from "@/lib/campaign-health";
import { spendSummary } from "@/lib/campaign-spend";

export const REPORT_TYPES = ["weekly", "monthly", "financial", "campaign", "ai_execution", "experiments"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export type PeriodKey = "7d" | "30d" | "last_month";
export type Period = { from: string; to: string };
export const DEFAULT_PERIOD: Record<ReportType, PeriodKey> = { weekly: "7d", monthly: "last_month", financial: "last_month", campaign: "30d", ai_execution: "30d", experiments: "30d" };

const DAY = 86_400_000;
const add = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const day = (iso: string) => iso.slice(0, 10);
const inP = (iso: string | null | undefined, p: Period) => !!iso && day(iso) >= p.from && day(iso) <= p.to;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function periods(key: PeriodKey, today: string): { current: Period; previous: Period } {
  if (key === "last_month") {
    const [y, m] = today.split("-").map(Number) as [number, number];
    const first = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
    const last = add(`${today.slice(0, 7)}-01`, -1);
    const prevFirst = new Date(Date.UTC(y, m - 3, 1)).toISOString().slice(0, 10);
    return { current: { from: first, to: last }, previous: { from: prevFirst, to: add(first, -1) } };
  }
  const n = key === "7d" ? 7 : 30;
  const from = add(today, -(n - 1));
  return { current: { from, to: today }, previous: { from: add(from, -n), to: add(from, -1) } };
}

export type RevenueRow = { kind: string; amount: number | string; currency: string; occurred_at: string; data_class: string };
export type Money = { sales: number; refunds: number; corrections: number; net: number; entries: number };
/** Recorded (imported or entered) revenue per currency; estimated rows are kept apart and never added to net revenue. */
export function revenueFigures(rows: readonly RevenueRow[], p: Period) {
  const recorded: Record<string, Money> = {};
  const estimated: Record<string, number> = {};
  for (const r of rows) {
    if (!inP(r.occurred_at, p)) continue;
    const a = Number(r.amount);
    if (r.data_class === "estimated") { estimated[r.currency] = r2((estimated[r.currency] ?? 0) + a); continue; }
    const m = (recorded[r.currency] ??= { sales: 0, refunds: 0, corrections: 0, net: 0, entries: 0 });
    if (r.kind === "sale") m.sales = r2(m.sales + a);
    else if (r.kind === "refund" || r.kind === "cancellation") m.refunds = r2(m.refunds + a);
    else m.corrections = r2(m.corrections + a);
    m.net = r2(m.net + a);
    m.entries += 1;
  }
  return { recorded, estimated };
}

export type SpendRow = { campaign_id: string; kind: string; amount: number | string; currency: string; occurred_on: string; data_class: string };
export function spendFigures(rows: readonly SpendRow[], p: Period) {
  const spent: Record<string, number> = {};
  let simulated = 0; let entries = 0;
  for (const r of rows) {
    if ((r.kind !== "spend" && r.kind !== "correction") || !inP(r.occurred_on, p)) continue;
    spent[r.currency] = r2((spent[r.currency] ?? 0) + Number(r.amount));
    entries += 1;
    if (r.data_class === "simulated") simulated += 1;
  }
  return { spent, entries, simulated };
}

export type TaskRow = { id: string; status: string; due_date: string | null; created_at: string; updated_at: string; campaign_id: string | null };
/** Tasks: "done" counts tasks marked done whose last change falls in the period (there is no separate completion date). */
export function taskFigures(tasks: readonly TaskRow[], p: Period, today: string) {
  const open = tasks.filter((t) => t.status !== "done" && t.status !== "cancelled");
  return {
    created: tasks.filter((t) => inP(t.created_at, p)).length,
    doneLastChanged: tasks.filter((t) => t.status === "done" && inP(t.updated_at, p)).length,
    open: open.length,
    overdue: open.filter((t) => t.due_date !== null && t.due_date < today).length,
  };
}

export type RunRow = { status: string; credits_charged: number | null; created_at: string; specialist_key?: string | null };
export function runFigures(runs: readonly RunRow[], p: Period) {
  const mine = runs.filter((r) => inP(r.created_at, p));
  const by = (s: string) => mine.filter((r) => r.status === s).length;
  const perSpecialist: Record<string, { runs: number; succeeded: number; failed: number; credits: number }> = {};
  for (const r of mine) {
    const k = r.specialist_key ?? "growth_officer";
    const e = (perSpecialist[k] ??= { runs: 0, succeeded: 0, failed: 0, credits: 0 });
    e.runs += 1; e.credits += r.credits_charged ?? 0;
    if (r.status === "succeeded") e.succeeded += 1;
    if (r.status === "failed" || r.status === "uncertain") e.failed += 1;
  }
  return { total: mine.length, succeeded: by("succeeded"), failed: by("failed"), uncertain: by("uncertain"), waiting: by("awaiting_approval"),
    credits: mine.reduce((n, r) => n + (r.credits_charged ?? 0), 0), perSpecialist };
}

export type ExperimentRow = { status: string; evidence_strength: string | null; updated_at: string; started_at: string | null };
export function experimentFigures(rows: readonly ExperimentRow[], p: Period) {
  const concluded = rows.filter((e) => e.status === "completed" && inP(e.updated_at, p));
  return {
    running: rows.filter((e) => ["running", "collecting", "evaluating", "paused"].includes(e.status)).length,
    proposed: rows.filter((e) => ["draft", "in_review", "proposed"].includes(e.status)).length,
    concluded: concluded.length,
    controlled: concluded.filter((e) => e.evidence_strength === "controlled").length,
    correlational: concluded.filter((e) => e.evidence_strength === "correlational").length,
    inconclusive: concluded.filter((e) => e.evidence_strength === "inconclusive" || e.evidence_strength === null).length,
  };
}

export type CampaignRow = { id: string; title: string; status: string; budget_eur: number | string; start_date: string | null; end_date: string | null; goal_id: string | null; results?: string };
export type CampaignLine = { id: string; title: string; state: HealthState; budget: number; spentEur: number; remaining: number | null; over: boolean; done: number; total: number; otherCurrencies: boolean };
export function campaignLines(campaigns: readonly CampaignRow[], tasks: readonly TaskRow[], spend: readonly SpendRow[] | null, today: string): CampaignLine[] {
  return campaigns.filter((c) => c.status !== "archived").map((c) => {
    const s = spend ? spendSummary(Number(c.budget_eur), spend.filter((x) => x.campaign_id === c.id).map((x) => ({ ...x, kind: x.kind as "spend", data_class: x.data_class as "manual" }))) : null;
    const h = campaignHealth({ status: c.status, start_date: c.start_date, end_date: c.end_date, goal_id: c.goal_id, results: c.results ?? "" }, tasks.filter((t) => t.campaign_id === c.id), today, s ?? undefined);
    return { id: c.id, title: c.title, state: h.state, budget: Number(c.budget_eur), spentEur: s?.eur.spent ?? 0, remaining: s?.remaining ?? null,
      over: !!s?.warnings.includes("budget_over"), done: h.done, total: h.total, otherCurrencies: !!s?.warnings.includes("other_currency") };
  });
}

export type Delta = { now: number; before: number; change: number; pct: number | null };
export const delta = (now: number, before: number): Delta => ({ now, before, change: r2(now - before), pct: before === 0 ? null : Math.round(((now - before) / Math.abs(before)) * 100) });

export type MissingCode = "revenue" | "spend" | "spend_unavailable" | "runs" | "experiments" | "campaigns" | "return_on_spend";
export type ReportInput = {
  revenue: readonly RevenueRow[]; spend: readonly SpendRow[] | null; tasks: readonly TaskRow[]; runs: readonly RunRow[];
  experiments: readonly ExperimentRow[]; campaigns: readonly CampaignRow[];
  replans?: { pending: number; approvedInPeriod: number } | undefined;
};
export type Report = ReturnType<typeof buildReport>;

/** One report. Sections not relevant to a type are omitted; figures that cannot be computed go to `missing`. */
export function buildReport(type: ReportType, key: PeriodKey, i: ReportInput, today: string) {
  const { current, previous } = periods(key, today);
  const rev = revenueFigures(i.revenue, current);
  const revPrev = revenueFigures(i.revenue, previous);
  const spend = i.spend ? spendFigures(i.spend, current) : null;
  const spendPrev = i.spend ? spendFigures(i.spend, previous) : null;
  const missing: MissingCode[] = [];
  const currencies = [...new Set([...Object.keys(rev.recorded), ...Object.keys(revPrev.recorded)])].sort();
  const finance = currencies.map((c) => {
    const now = rev.recorded[c]; const before = revPrev.recorded[c];
    const spent = spend?.spent[c] ?? null;
    // Computed only when both sides are recorded in the same currency; this is not attributed return.
    const perSpend = spent && spent > 0 && now ? r2(now.net / spent) : null;
    return { currency: c, now: now ?? null, net: delta(now?.net ?? 0, before?.net ?? 0), refunds: now?.refunds ?? 0, spent, perSpend, estimated: rev.estimated[c] ?? null };
  });
  const wantsMoney = type === "weekly" || type === "monthly" || type === "financial";
  if (wantsMoney && currencies.length === 0) missing.push("revenue");
  if (wantsMoney || type === "campaign") {
    if (!i.spend) missing.push("spend_unavailable");
    else if (spend && spend.entries === 0) missing.push("spend");
  }
  if (wantsMoney && finance.length && finance.every((f) => f.perSpend === null)) missing.push("return_on_spend");
  const runs = runFigures(i.runs, current);
  const runsPrev = runFigures(i.runs, previous);
  if ((type === "ai_execution" || type === "weekly" || type === "monthly") && runs.total === 0) missing.push("runs");
  const exps = experimentFigures(i.experiments, current);
  if (type === "experiments" && i.experiments.length === 0) missing.push("experiments");
  const camps = campaignLines(i.campaigns, i.tasks, i.spend, today);
  if (type === "campaign" && camps.length === 0) missing.push("campaigns");
  const tasks = taskFigures(i.tasks, current, today);
  const tasksPrev = taskFigures(i.tasks, previous, today);
  const show = {
    finance: wantsMoney, spend: wantsMoney || type === "campaign", tasks: type === "weekly" || type === "monthly",
    runs: type === "ai_execution" || type === "weekly" || type === "monthly", specialists: type === "ai_execution",
    experiments: type === "experiments" || type === "monthly", campaigns: type === "campaign" || type === "monthly",
  };
  return {
    type, key, current, previous, show, finance,
    spend: spend ? { ...spend, before: spendPrev?.spent ?? {} } : null,
    tasks: { ...tasks, done: delta(tasks.doneLastChanged, tasksPrev.doneLastChanged), created: delta(tasks.created, tasksPrev.created) },
    runs: { ...runs, totalDelta: delta(runs.total, runsPrev.total), creditsDelta: delta(runs.credits, runsPrev.credits) },
    experiments: exps, campaigns: camps, replans: i.replans ?? null, missing,
  };
}
