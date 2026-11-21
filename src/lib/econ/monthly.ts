// Month-by-month growth economics (pure), for converting a period month by month at each month's own exchange
// rate. Every month uses the same canonical rules as the period summary: revenue by sale month (refunds count in the
// month of their sale), campaign spending by day of the entry, business costs by the month their period ends
// (only costs the period summary itself includes), gross profit by the same cost-model rules. `reconciles` states
// whether the months add up to the period summary; a converted figure is only shown when they do.
import { revenueTotals } from "@/lib/bi/attribution";
import { grossProfit } from "@/lib/econ/profitability";
import { rollup, type Money } from "@/lib/econ/rollup";
import type { EconData } from "@/lib/econ/read";
import type { EconSummary } from "@/lib/econ/summary";

export type MonthFigures = { month: string; from: string; to: string; net: Money; spent: Money; costs: Money; gp: Money; gpMissing: string[] };
const r2 = (n: number) => Math.round(n * 100) / 100;

export function periodMonths(from: string, to: string) {
  const out: { month: string; from: string; to: string }[] = [];
  let y = +from.slice(0, 4), m = +from.slice(5, 7);
  while (`${y}-${String(m).padStart(2, "0")}` <= to.slice(0, 7)) {
    const month = `${y}-${String(m).padStart(2, "0")}`;
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    out.push({ month, from: `${month}-01` < from ? from : `${month}-01`, to: end > to ? to : end });
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

export function monthlyFigures(d: EconData, from: string, to: string): MonthFigures[] {
  const periodCosts = d.costs.filter((c) => c.period_start >= from && c.period_end <= to);
  return periodMonths(from, to).map((p) => {
    const spend = d.spend.filter((s) => s.occurred_on >= p.from && s.occurred_on <= p.to);
    const costs = periodCosts.filter((c) => c.period_end >= p.from && c.period_end <= p.to);
    const t = rollup("business", null, { campaigns: d.campaigns, allocations: d.allocations, spend, costs, credits: [] });
    const net: Money = {};
    for (const r of revenueTotals(d.revenue, p.from, p.to)) if (r.net) net[r.currency] = r.net;
    const gp: Money = {}; const gpMissing: string[] = [];
    for (const g of grossProfit(d.revenue, d.costs, d.models, p.from, p.to)) {
      if (g.grossProfit === null) gpMissing.push(g.currency); else gp[g.currency] = g.grossProfit;
    }
    return { ...p, net, spent: t.spent, costs: t.directCosts, gp, gpMissing };
  });
}

const sum = (months: readonly MonthFigures[], k: "net" | "spent" | "costs" | "gp") => {
  const m: Money = {};
  for (const x of months) for (const [c, v] of Object.entries(x[k])) m[c] = r2((m[c] ?? 0) + v);
  return m;
};
const same = (a: Money, b: Money) => [...new Set([...Object.keys(a), ...Object.keys(b)])].every((c) => Math.abs((a[c] ?? 0) - (b[c] ?? 0)) < 0.005);

/** Whether the months add up to the period summary, per figure. Gross profit adds up only when every month with
 *  sales is calculable and the monthly sum equals the period's own figure. */
export function reconcileMonths(months: readonly MonthFigures[], s: EconSummary) {
  const per = (pick: (c: EconSummary["currencies"][number]) => number | null | undefined) => {
    const m: Money = {};
    for (const c of s.currencies) { const v = pick(c); if (v) m[c.currency] = v; }
    return m;
  };
  const gpPeriod = per((c) => c.gp?.grossProfit ?? null);
  const gpComplete = months.every((m) => m.gpMissing.length === 0) && s.currencies.every((c) => !(c.rev?.sales) || c.gp?.grossProfit != null);
  return {
    net: same(sum(months, "net"), per((c) => c.rev?.net)),
    spent: same(sum(months, "spent"), per((c) => c.spent)),
    costs: same(sum(months, "costs"), per((c) => c.costs)),
    gp: gpComplete && same(sum(months, "gp"), gpPeriod),
  };
}
export const monthlySum = sum;
