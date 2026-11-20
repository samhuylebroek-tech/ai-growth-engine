// Organization-level financial consolidation across businesses (workspaces). Pure: callers pass rows read under their
// own RLS, so a total only ever covers businesses the caller may see. Rules: every figure stays per currency; a
// converted organization total exists only when an explicit, dated, sourced rate covers every currency involved —
// otherwise it is withheld and the missing pairs are named. Estimated revenue never counts as revenue.
import { goalProgress } from "@/lib/growth-plan";
import { netSales, revenueTotals, type RevenueEvent } from "@/lib/bi/attribution";

export type Money = Record<string, number>; // currency -> amount, never summed across currencies
export type Rate = { id: string; base_currency: string; quote_currency: string; rate: number | string; rate_date: string; source: string; kind?: string };
export type Conversion = { from: string; to: string; rate: number; rateDate: string; source: string; inverted: boolean; rateId: string | null; ageDays: number; official: boolean };
export const STALE_RATE_DAYS = 31;
export const REPORTING_CURRENCIES = ["EUR", "USD", "GBP", "CHF", "SEK", "DKK", "NOK", "PLN", "CAD", "AUD"] as const;

const r2 = (v: number) => Math.round(v * 100) / 100;
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

export function addMoney(a: Money, currency: string, amount: number): Money {
  if (!amount) return a;
  a[currency] = r2((a[currency] ?? 0) + amount);
  return a;
}
export function mergeMoney(...all: Money[]): Money {
  const out: Money = {};
  for (const m of all) for (const [c, v] of Object.entries(m)) addMoney(out, c, v);
  return out;
}

/** The most recent explicit rate on or before asOf, direct or inverse. No triangulation through a third currency. */
export function findRate(rates: readonly Rate[], from: string, to: string, asOf: string): Conversion | null {
  if (from === to) return { from, to, rate: 1, rateDate: asOf, source: "same currency", inverted: false, rateId: null, ageDays: 0, official: false };
  let best: Conversion | null = null;
  for (const x of rates) {
    if (x.rate_date > asOf) continue;
    const direct = x.base_currency === from && x.quote_currency === to;
    const inverse = x.base_currency === to && x.quote_currency === from;
    if (!direct && !inverse) continue;
    const rate = direct ? Number(x.rate) : 1 / Number(x.rate);
    if (!(rate > 0)) continue;
    const c: Conversion = { from, to, rate, rateDate: x.rate_date, source: x.source, inverted: inverse, rateId: x.id, ageDays: days(x.rate_date, asOf), official: x.kind === "official" };
    // Newest date wins; on the same date an official rate beats a manual one, then a direct pair beats an inverse.
    const better = !best || c.rateDate > best.rateDate || (c.rateDate === best.rateDate &&
      ((c.official && !best.official) || (c.official === best.official && best.inverted && !c.inverted)));
    if (better) best = c;
  }
  return best;
}

export type Converted = { total: number | null; used: Conversion[]; missing: string[]; stale: string[] };
/** Converts a per-currency amount into one currency, or withholds the total when any rate is missing. */
export function convertMoney(m: Money, target: string, rates: readonly Rate[], asOf: string): Converted {
  const used: Conversion[] = []; const missing: string[] = []; const stale: string[] = [];
  let total = 0;
  for (const [cur, amount] of Object.entries(m).sort(([a], [b]) => a.localeCompare(b))) {
    const c = findRate(rates, cur, target, asOf);
    if (!c) { missing.push(`${cur}→${target}`); continue; }
    if (c.rateId) { used.push(c); if (c.ageDays > STALE_RATE_DAYS) stale.push(`${cur}→${target}`); }
    total += amount * c.rate;
  }
  return { total: missing.length ? null : r2(total), used, missing, stale };
}

export type GoalLite = { id: string; title: string; objective: string; status: string; baseline: number | null; target: number | null; current_value: number | null; due_date: string | null; unit_id?: string | null; created_at?: string };
export type TaskLite = { id: string; title: string; status: string; due_date: string | null };
export type BudgetLite = { channel: string; period_month: string; planned: number | string; actual: number | string; hard_cap: number | string | null; currency: string; unit_id?: string | null };
export type RunLite = { status: string; specialist_key: string; estimated_credits: number; credits_charged: number | null; created_at: string };
export type BusinessInput = {
  id: string; name: string; reportingCurrency: string;
  revenue: readonly RevenueEvent[]; goals: readonly GoalLite[]; tasks: readonly TaskLite[]; budget: readonly BudgetLite[];
  runs: readonly RunLite[]; pendingApprovals: number; truncated: boolean;
};
export type GoalHealth = { active: number; achieved: number; onTrack: number; behind: number; unmeasured: number };
export type AttentionReason = "overdue_tasks" | "failed_runs" | "goals_behind" | "over_cap" | "pending_approvals" | "uncertain_runs";
export type BusinessRow = {
  id: string; name: string; reportingCurrency: string; truncated: boolean;
  revenue: Money; estimated: Money; sales: number;
  planned: Money; spent: Money; utilization: Record<string, number | null>; overCap: number;
  creditsUsed: number; creditsReserved: number; failedRuns: number; uncertainRuns: number;
  goals: GoalHealth; openTasks: number; overdueTasks: number; pendingApprovals: number;
  attention: number; reasons: AttentionReason[];
};

const OPEN_RUN = ["awaiting_approval", "queued", "paused", "running", "uncertain"];
/** A goal is behind when its measured progress trails the share of time elapsed by more than 15 points. */
export function goalHealth(goals: readonly GoalLite[], today: string): GoalHealth {
  const h: GoalHealth = { active: 0, achieved: 0, onTrack: 0, behind: 0, unmeasured: 0 };
  for (const g of goals) {
    if (g.status === "achieved") { h.achieved += 1; continue; }
    if (g.status !== "active") continue;
    h.active += 1;
    const p = goalProgress(g.baseline, g.target, g.current_value);
    if (p == null) { h.unmeasured += 1; continue; }
    if (p >= 100) { h.onTrack += 1; continue; }
    const start = g.created_at?.slice(0, 10);
    if (g.due_date && g.due_date < today) { h.behind += 1; continue; }
    if (g.due_date && start) {
      const span = days(start, g.due_date), gone = days(start, today);
      const expected = span > 0 ? Math.min(100, (gone / span) * 100) : 100;
      if (p + 15 < expected) { h.behind += 1; continue; }
    }
    h.onTrack += 1;
  }
  return h;
}

export function businessRow(b: BusinessInput, month: string, today: string, from?: string, to?: string): BusinessRow {
  const revenue: Money = {}, estimated: Money = {}; let sales = 0;
  for (const t of revenueTotals(b.revenue, from, to)) { addMoney(revenue, t.currency, t.net); addMoney(estimated, t.currency, t.estimated); sales += t.sales; }
  const planned: Money = {}, spent: Money = {}; let overCap = 0;
  for (const l of b.budget) {
    if (l.period_month.slice(0, 7) !== month.slice(0, 7)) continue;
    addMoney(planned, l.currency, Number(l.planned)); addMoney(spent, l.currency, Number(l.actual));
    if (l.hard_cap != null && Number(l.actual) > Number(l.hard_cap)) overCap += 1;
  }
  const utilization: Record<string, number | null> = {};
  for (const c of new Set([...Object.keys(planned), ...Object.keys(spent)])) utilization[c] = planned[c] ? Math.round(((spent[c] ?? 0) / planned[c]!) * 100) : null;
  let creditsUsed = 0, creditsReserved = 0, failedRuns = 0, uncertainRuns = 0;
  for (const r of b.runs) {
    creditsUsed += r.credits_charged ?? 0;
    if (OPEN_RUN.includes(r.status)) creditsReserved += r.estimated_credits;
    if (r.status === "failed") failedRuns += 1;
    if (r.status === "uncertain") uncertainRuns += 1;
  }
  const open = b.tasks.filter((t) => t.status !== "done" && t.status !== "cancelled");
  const overdueTasks = open.filter((t) => t.due_date && t.due_date < today).length;
  const goals = goalHealth(b.goals, today);
  const reasons: AttentionReason[] = [];
  if (overCap) reasons.push("over_cap");
  if (uncertainRuns) reasons.push("uncertain_runs");
  if (goals.behind) reasons.push("goals_behind");
  if (failedRuns) reasons.push("failed_runs");
  if (overdueTasks) reasons.push("overdue_tasks");
  if (b.pendingApprovals) reasons.push("pending_approvals");
  const attention = overCap * 4 + uncertainRuns * 4 + goals.behind * 3 + failedRuns * 3 + overdueTasks * 2 + b.pendingApprovals;
  return { id: b.id, name: b.name, reportingCurrency: b.reportingCurrency, truncated: b.truncated, revenue, estimated, sales, planned, spent, utilization, overCap,
    creditsUsed, creditsReserved, failedRuns, uncertainRuns, goals, openTasks: open.length, overdueTasks, pendingApprovals: b.pendingApprovals, attention, reasons };
}

export type OrgTotals = { revenue: Money; estimated: Money; planned: Money; spent: Money; creditsUsed: number; creditsReserved: number; goals: GoalHealth; businesses: number };
export function orgTotals(rows: readonly BusinessRow[]): OrgTotals {
  const goals: GoalHealth = { active: 0, achieved: 0, onTrack: 0, behind: 0, unmeasured: 0 };
  for (const r of rows) for (const k of Object.keys(goals) as (keyof GoalHealth)[]) goals[k] += r.goals[k];
  return {
    revenue: mergeMoney(...rows.map((r) => r.revenue)), estimated: mergeMoney(...rows.map((r) => r.estimated)),
    planned: mergeMoney(...rows.map((r) => r.planned)), spent: mergeMoney(...rows.map((r) => r.spent)),
    creditsUsed: rows.reduce((s, r) => s + r.creditsUsed, 0), creditsReserved: rows.reduce((s, r) => s + r.creditsReserved, 0),
    goals, businesses: rows.length,
  };
}

/** Businesses ordered by how much they need attention; ties keep name order so the list is stable. */
export const byAttention = (rows: readonly BusinessRow[]) =>
  [...rows].sort((a, b) => b.attention - a.attention || a.name.localeCompare(b.name));

export type UnitRevenue = { unitId: string | null; revenue: Money; sales: number };
/** Net actual revenue per brand/unit (null = not linked to a brand or unit), per currency. */
export function revenueByUnit(events: readonly RevenueEvent[], from?: string, to?: string): UnitRevenue[] {
  const out = new Map<string | null, UnitRevenue>();
  for (const n of netSales(events)) {
    if (n.sale.data_class === "estimated") continue;
    const d = n.sale.occurred_at.slice(0, 10);
    if ((from && d < from) || (to && d > to)) continue;
    const row = out.get(n.sale.unit_id) ?? { unitId: n.sale.unit_id, revenue: {}, sales: 0 };
    addMoney(row.revenue, n.sale.currency, n.net); row.sales += 1; out.set(n.sale.unit_id, row);
  }
  return [...out.values()].sort((a, b) => (a.unitId === null ? 1 : b.unitId === null ? -1 : 0));
}

export type SpecialistLoad = { specialist: string; businesses: { id: string; open: number; used: number; cap: number | null; enabled: boolean }[]; open: number; used: number };
export type AllocationLite = { workspace_id: string; specialist_key: string; enabled: boolean; monthly_credit_cap: number | null };
/** Workload and this-month credits per specialist across businesses; same counting rule as the SQL cap check. */
export function specialistLoad(perBusiness: readonly { id: string; runs: readonly RunLite[] }[], allocations: readonly AllocationLite[], monthStart: string): SpecialistLoad[] {
  const map = new Map<string, SpecialistLoad>();
  const get = (s: string) => map.get(s) ?? (map.set(s, { specialist: s, businesses: [], open: 0, used: 0 }), map.get(s)!);
  const slot = (l: SpecialistLoad, id: string) => {
    let b = l.businesses.find((x) => x.id === id);
    if (!b) { const a = allocations.find((x) => x.workspace_id === id && x.specialist_key === l.specialist); b = { id, open: 0, used: 0, cap: a?.monthly_credit_cap ?? null, enabled: a?.enabled ?? true }; l.businesses.push(b); }
    return b;
  };
  for (const a of allocations) slot(get(a.specialist_key), a.workspace_id);
  for (const b of perBusiness) for (const r of b.runs) {
    const l = get(r.specialist_key); const s = slot(l, b.id);
    if (OPEN_RUN.includes(r.status)) { s.open += 1; l.open += 1; }
    if (r.created_at >= monthStart) {
      const c = r.credits_charged ?? (["failed", "cancelled", "rejected"].includes(r.status) ? 0 : r.estimated_credits);
      s.used += c; l.used += c;
    }
  }
  return [...map.values()].sort((a, b) => b.open - a.open || b.used - a.used || a.specialist.localeCompare(b.specialist));
}
