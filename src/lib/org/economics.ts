// Organization economics (pure): each business's own growth-economics summary, read under the caller's RLS, put
// side by side. Money stays per currency and is never converted here. A total of a derived figure (gross profit)
// is given only when every business with recorded sales in that currency can calculate it; otherwise it names how
// many businesses are missing inputs. AI credits are one organization pool and are simply added.
import type { EconSummary } from "@/lib/econ/summary";

export type BusinessEcon = { id: string; name: string; summary: EconSummary };
export type OrgCurrencyTotal = {
  currency: string;
  businesses: number;
  net: number;
  spent: number;
  simulated: number;
  costs: number;
  grossProfit: number | null;
  grossProfitMissing: number;
  margin: number | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function orgEconomics(rows: readonly BusinessEcon[]) {
  const by = new Map<string, OrgCurrencyTotal & { gpSum: number }>();
  for (const b of rows)
    for (const c of b.summary.currencies) {
      const t = by.get(c.currency) ?? {
        currency: c.currency,
        businesses: 0,
        net: 0,
        spent: 0,
        simulated: 0,
        costs: 0,
        grossProfit: null,
        grossProfitMissing: 0,
        margin: null,
        gpSum: 0,
      };
      t.businesses += 1;
      t.net = r2(t.net + (c.rev?.net ?? 0));
      t.spent = r2(t.spent + c.spent);
      t.simulated = r2(t.simulated + c.simulated);
      t.costs = r2(t.costs + c.costs);
      const hasSales = (c.rev?.sales ?? 0) > 0;
      if (hasSales) {
        if (c.gp?.grossProfit == null) t.grossProfitMissing += 1;
        else t.gpSum = r2(t.gpSum + c.gp.grossProfit);
      }
      by.set(c.currency, t);
    }
  const currencies: OrgCurrencyTotal[] = [...by.values()]
    .sort((a, b) => a.currency.localeCompare(b.currency))
    .map(({ gpSum, ...t }) => {
      const complete = t.grossProfitMissing === 0;
      return {
        ...t,
        grossProfit: complete ? gpSum : null,
        margin: complete && t.net > 0 ? r2((gpSum / t.net) * 100) : null,
      };
    });
  const credits = rows.reduce((n, b) => n + b.summary.ai.total, 0);
  const unpriced = rows.reduce((n, b) => n + b.summary.ai.cost.unpriced, 0);
  const aiCost = r2(rows.reduce((n, b) => n + b.summary.ai.cost.amount, 0));
  const alerts = rows.flatMap((b) =>
    b.summary.alerts.filter((a) => a.level === "high").map((a) => ({ business: b.id, ...a })),
  );
  return {
    currencies,
    credits,
    aiCost: unpriced === 0 && credits > 0 ? aiCost : null,
    aiCostPartial: aiCost,
    unpriced,
    alerts,
    incomplete: rows.filter((b) => b.summary.incomplete.length > 0).map((b) => b.id),
  };
}
