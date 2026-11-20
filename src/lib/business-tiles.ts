// Command Center number tiles. Pure: every figure is computed from records the caller already read under RLS,
// carries what kind of number it is, where it comes from and for which period, and is withheld when the source is missing.
import type { MetricSummary } from "@/lib/performance";

export type TileKey =
  | "opportunities" | "goals" | "campaigns" | "leads" | "qualified" | "openDeals" | "wonDeals"
  | "revenue" | "revenueVsTarget" | "spend" | "remaining" | "tasksDone" | "approvals" | "aiRuns" | "aiCredits";
/** What a figure is: a measured result, a manual entry, a goal/plan, a forecast or an estimate, or a plain record count. */
export type TileKind = "actual" | "entered" | "target" | "forecast" | "estimate" | "count";
export type TileSource = "opportunities" | "goals" | "campaigns" | "pipeline" | "imported" | "budget" | "tasks" | "approvals" | "ai";
export type TilePeriod = "now" | "thisMonth" | "lastResult" | "allTime";
export type Unavailable = "not_switched_on" | "no_source" | "no_data" | "no_target" | "load_failed" | "too_many";
export type TileValue = { amount: number; unit: "count" | "currency" | "percent"; currency?: string };
export type Destination = "/app/opportunities" | "/app/goals" | "/app/campaigns" | "/app/pipeline" | "/app/performance" | "/app/tasks" | "/app/approvals" | "/app/activity" | "/app/billing" | "/app/integrations";
export type Tile = { key: TileKey; kind: TileKind; source: TileSource; period: TilePeriod; to: Destination; values: TileValue[]; unavailable?: Unavailable; periodStart?: string };

/** A source either loaded, is not switched on in this workspace, failed, or had more rows than can be totalled safely. */
export type Loaded<T> = { ok: true; data: T } | { ok: false; reason: "not_switched_on" | "load_failed" | "too_many" };
export type Deal = { stage: string; value: number; currency: string; closed_at: string | null };
export type BudgetRow = { planned: number; actual: number; currency: string };
export type RevenueMetric = { currency: string | null; summary: MetricSummary };

export type TileInput = {
  now: Date;
  openOpportunities: Loaded<number>;
  activeGoals: Loaded<number>;
  activeCampaigns: Loaded<number>;
  deals: Loaded<Deal[]>;
  budget: Loaded<BudgetRow[]>;
  tasksDone: Loaded<number>;
  pendingApprovals: Loaded<number>;
  aiRunsThisMonth: Loaded<number>;
  aiCreditsThisMonth: Loaded<number>;
  /** Imported revenue metrics (read-only revenue source); manual pipeline entries never count as revenue. */
  revenue: Loaded<RevenueMetric[]>;
};

const OPEN = new Set(["lead", "qualified", "proposal", "negotiation"]);
const monthStart = (d: Date) => d.toISOString().slice(0, 7);
const count = (n: number): TileValue[] => [{ amount: n, unit: "count" }];

/** Sum per currency, never converting or mixing currencies. Sorted by currency code for a stable display. */
export function perCurrency(rows: readonly { amount: number; currency: string }[]): TileValue[] {
  const by = new Map<string, number>();
  for (const r of rows) if (Number.isFinite(r.amount)) by.set(r.currency, (by.get(r.currency) ?? 0) + r.amount);
  return [...by.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([currency, amount]) => ({ amount, unit: "currency", currency }));
}

function tile(base: Omit<Tile, "values" | "unavailable">, src: Loaded<unknown>, values: () => TileValue[] | Unavailable): Tile {
  if (!src.ok) return { ...base, values: [], unavailable: src.reason };
  const v = values();
  return typeof v === "string" ? { ...base, values: [], unavailable: v } : { ...base, values: v };
}

export function buildBusinessTiles(i: TileInput): Tile[] {
  const month = monthStart(i.now);
  const data = <T,>(l: Loaded<T>) => (l.ok ? l.data : (undefined as never));
  const latestRevenue = () => {
    // Only results imported from the payment provider count as revenue; manual or corrected entries never do.
    const withActual = data(i.revenue).filter(m => m.summary.actual?.kind === "imported_actual" && m.summary.period);
    if (!withActual.length) return null;
    const latest = withActual.map(m => m.summary.period!.start).sort().at(-1)!;
    return { start: latest, items: withActual.filter(m => m.summary.period!.start === latest) };
  };
  const rev = i.revenue.ok ? latestRevenue() : null;
  return [
    tile({ key: "opportunities", kind: "count", source: "opportunities", period: "now", to: "/app/opportunities" }, i.openOpportunities, () => count(data(i.openOpportunities))),
    tile({ key: "goals", kind: "count", source: "goals", period: "now", to: "/app/goals" }, i.activeGoals, () => count(data(i.activeGoals))),
    tile({ key: "campaigns", kind: "count", source: "campaigns", period: "now", to: "/app/campaigns" }, i.activeCampaigns, () => count(data(i.activeCampaigns))),
    tile({ key: "leads", kind: "entered", source: "pipeline", period: "now", to: "/app/pipeline" }, i.deals, () => count(data(i.deals).filter(d => d.stage === "lead").length)),
    tile({ key: "qualified", kind: "entered", source: "pipeline", period: "now", to: "/app/pipeline" }, i.deals, () => count(data(i.deals).filter(d => d.stage === "qualified").length)),
    tile({ key: "openDeals", kind: "estimate", source: "pipeline", period: "now", to: "/app/pipeline" }, i.deals, () => {
      const open = data(i.deals).filter(d => OPEN.has(d.stage));
      return open.length ? [...count(open.length), ...perCurrency(open.map(d => ({ amount: Number(d.value), currency: d.currency })))] : count(0);
    }),
    tile({ key: "wonDeals", kind: "entered", source: "pipeline", period: "thisMonth", to: "/app/pipeline" }, i.deals, () => {
      const won = data(i.deals).filter(d => d.stage === "won" && d.closed_at?.slice(0, 7) === month);
      return won.length ? [...count(won.length), ...perCurrency(won.map(d => ({ amount: Number(d.value), currency: d.currency })))] : count(0);
    }),
    tile({ key: "revenue", kind: "actual", source: "imported", period: "lastResult", to: "/app/performance", ...(rev ? { periodStart: rev.start } : {}) }, i.revenue, () =>
      rev ? perCurrency(rev.items.map(m => ({ amount: m.summary.actual!.value, currency: m.currency ?? "" }))) : "no_source"),
    tile({ key: "revenueVsTarget", kind: "target", source: "imported", period: "lastResult", to: "/app/performance", ...(rev ? { periodStart: rev.start } : {}) }, i.revenue, () => {
      if (!rev) return "no_source";
      const planned = rev.items.filter(m => m.summary.planned != null && m.summary.planned > 0);
      if (!planned.length) return "no_target";
      return planned.sort((a, b) => ((a.currency ?? "") < (b.currency ?? "") ? -1 : 1)).map(m => ({ amount: Math.round((m.summary.actual!.value / m.summary.planned!) * 100), unit: "percent" as const, currency: m.currency ?? "" }));
    }),
    tile({ key: "spend", kind: "entered", source: "budget", period: "thisMonth", to: "/app/goals" }, i.budget, () => {
      const rows = data(i.budget);
      return rows.length ? perCurrency(rows.map(r => ({ amount: Number(r.actual), currency: r.currency }))) : "no_data";
    }),
    tile({ key: "remaining", kind: "target", source: "budget", period: "thisMonth", to: "/app/goals" }, i.budget, () => {
      const rows = data(i.budget);
      return rows.length ? perCurrency(rows.map(r => ({ amount: Number(r.planned) - Number(r.actual), currency: r.currency }))) : "no_data";
    }),
    tile({ key: "tasksDone", kind: "count", source: "tasks", period: "allTime", to: "/app/tasks" }, i.tasksDone, () => count(data(i.tasksDone))),
    tile({ key: "approvals", kind: "count", source: "approvals", period: "now", to: "/app/approvals" }, i.pendingApprovals, () => count(data(i.pendingApprovals))),
    tile({ key: "aiRuns", kind: "count", source: "ai", period: "thisMonth", to: "/app/activity" }, i.aiRunsThisMonth, () => count(data(i.aiRunsThisMonth))),
    tile({ key: "aiCredits", kind: "actual", source: "ai", period: "thisMonth", to: "/app/billing" }, i.aiCreditsThisMonth, () => count(data(i.aiCreditsThisMonth))),
  ];
}
