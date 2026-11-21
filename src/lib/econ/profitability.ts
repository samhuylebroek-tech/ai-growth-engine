// Customer economics (pure): gross profit, CAC, campaign ROAS and observed customer value from the revenue ledger,
// the business cost ledger, the campaign spend ledger and recorded attribution. A figure is computed only when its
// inputs exist; missing cost is never zero, leads are never customers, estimated and simulated inputs are labelled,
// and currencies are never mixed. Attributed revenue is credit for a sale, not proof the sale would not have happened.
import { netSales, attribute, type Model, type RevenueEvent, type Touch } from "@/lib/bi/attribution";

export type Status = "fully_measurable" | "partially_measurable" | "missing_cost_data" | "missing_customer_data" | "missing_attribution"
  | "insufficient_sample" | "estimated" | "simulated" | "unavailable";
export type CostRow = { id: string; kind: string; category: string; amount: number | string; currency: string; data_class: string; period_start: string; period_end: string; revenue_event_id: string | null; relates_to: string | null };
export type CostModel = { model: string; margin_rate: number | string | null; effective_from: string };
export type SpendRow = { campaign_id: string; kind: string; amount: number | string; currency: string; data_class: string; occurred_on: string; category?: string | null };

const c2 = (n: number) => Math.round(n * 100) / 100;
const day = (iso: string) => iso.slice(0, 10);
const inP = (d: string, from: string, to: string) => d >= from && d <= to;
const months = (from: string, to: string) => {
  const out: string[] = []; let y = +from.slice(0, 4), m = +from.slice(5, 7);
  const ey = +to.slice(0, 4), em = +to.slice(5, 7);
  while (y < ey || (y === ey && m <= em)) { out.push(`${y}-${String(m).padStart(2, "0")}`); m += 1; if (m > 12) { m = 1; y += 1; } }
  return out;
};

/** Cost model in force for a period; "mixed" when a different version starts inside the period. */
export function modelFor(models: readonly CostModel[], from: string, to: string): { model: CostModel | null; mixed: boolean } {
  const sorted = [...models].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  const atEnd = [...sorted].reverse().find((m) => m.effective_from <= to) ?? null;
  const atStart = [...sorted].reverse().find((m) => m.effective_from <= from) ?? null;
  return { model: atEnd, mixed: !!atEnd && atStart?.effective_from !== atEnd.effective_from };
}

/** Effective amount of each cost entry after its own corrections. */
function effectiveCosts(rows: readonly CostRow[]) {
  const corr = new Map<string, number>();
  for (const r of rows) if (r.kind === "correction" && r.relates_to) corr.set(r.relates_to, (corr.get(r.relates_to) ?? 0) + Number(r.amount));
  return rows.filter((r) => r.kind === "cost").map((r) => ({ ...r, value: c2(Number(r.amount) + (corr.get(r.id) ?? 0)) }));
}

export type GrossProfit = {
  currency: string; revenue: number; refunds: number; net: number; cogs: number | null; grossProfit: number | null; grossMargin: number | null;
  status: Status; model: string | null; missing: string[]; salesWithoutCost: number; monthsWithoutCost: string[];
};
export function grossProfit(events: readonly RevenueEvent[], costs: readonly CostRow[], models: readonly CostModel[], from: string, to: string): GrossProfit[] {
  const sales = netSales(events).filter((n) => n.sale.data_class !== "estimated" && inP(day(n.sale.occurred_at), from, to));
  const eff = effectiveCosts(costs).filter((c) => c.category === "cogs");
  const { model, mixed } = modelFor(models, from, to);
  const out: GrossProfit[] = [];
  for (const cur of [...new Set(sales.map((s) => s.sale.currency))].sort()) {
    const mine = sales.filter((s) => s.sale.currency === cur);
    const revenue = c2(mine.reduce((t, s) => t + Number(s.sale.amount), 0));
    const net = c2(mine.reduce((t, s) => t + s.net, 0));
    const base = { currency: cur, revenue, refunds: c2(revenue - net), net, model: model?.model ?? null, salesWithoutCost: 0, monthsWithoutCost: [] as string[] };
    const none = (status: Status, missing: string[]): GrossProfit => ({ ...base, cogs: null, grossProfit: null, grossMargin: null, status, missing });
    if (!model || model.model === "none") { out.push(none("missing_cost_data", ["cost_model"])); continue; }
    if (mixed) { out.push(none("partially_measurable", ["single_cost_model_for_period"])); continue; }
    if (model.model === "margin_estimate") {
      const gp = c2(net * Number(model.margin_rate));
      out.push({ ...base, cogs: c2(net - gp), grossProfit: gp, grossMargin: net ? c2((gp / net) * 100) : null, status: "estimated", missing: [] });
      continue;
    }
    const curCosts = eff.filter((c) => c.currency === cur);
    const actual = curCosts.filter((c) => c.data_class === "manual" || c.data_class === "imported");
    const estimated = curCosts.some((c) => c.data_class === "estimated");
    let cogs = 0; const missing: string[] = [];
    if (model.model === "per_sale") {
      const covered = new Set(curCosts.filter((c) => c.revenue_event_id && c.data_class !== "simulated").map((c) => c.revenue_event_id));
      base.salesWithoutCost = mine.filter((s) => !covered.has(s.sale.id)).length;
      cogs = c2(curCosts.filter((c) => c.data_class !== "simulated" && c.revenue_event_id && mine.some((s) => s.sale.id === c.revenue_event_id)).reduce((t, c) => t + c.value, 0));
      if (base.salesWithoutCost) missing.push("cost_per_sale");
    } else {
      const inside = curCosts.filter((c) => c.data_class !== "simulated" && !c.revenue_event_id && c.period_start >= from && c.period_end <= to);
      const straddling = curCosts.some((c) => c.data_class !== "simulated" && !c.revenue_event_id && c.period_start <= to && c.period_end >= from && !(c.period_start >= from && c.period_end <= to));
      const coveredMonths = new Set(inside.flatMap((c) => months(c.period_start, c.period_end)));
      base.monthsWithoutCost = months(from, to).filter((m) => !coveredMonths.has(m));
      cogs = c2(inside.reduce((t, c) => t + c.value, 0));
      if (base.monthsWithoutCost.length) missing.push("cost_per_month");
      if (straddling) missing.push("cost_period_outside_report");
    }
    if (missing.length) { out.push({ ...none(cogs > 0 ? "partially_measurable" : "missing_cost_data", missing), salesWithoutCost: base.salesWithoutCost, monthsWithoutCost: base.monthsWithoutCost }); continue; }
    if (!actual.length && curCosts.every((c) => c.data_class === "simulated")) { out.push(none("simulated", ["actual_cost"])); continue; }
    const gp = c2(net - cogs);
    out.push({ ...base, cogs, grossProfit: gp, grossMargin: net ? c2((gp / net) * 100) : null, status: estimated ? "estimated" : "fully_measurable", missing: [] });
  }
  return out;
}

export type Cac = { currency: string; spend: number; newCustomers: number; value: number | null; status: Status; salesWithoutCustomer: number; simulatedSpend: number };
/** CAC = actual acquisition spending in the period / customers whose first recorded sale falls in the period. */
export function cac(events: readonly RevenueEvent[], spend: readonly SpendRow[], costs: readonly CostRow[], from: string, to: string): Cac[] {
  const actualSales = netSales(events).filter((n) => n.sale.data_class !== "estimated" && n.net > 0);
  const first = new Map<string, string>();
  for (const n of actualSales) {
    const ref = n.sale.customer_ref.trim().toLowerCase(); if (!ref) continue;
    const key = `${n.sale.currency}|${ref}`, d = day(n.sale.occurred_at);
    if (!first.has(key) || d < first.get(key)!) first.set(key, d);
  }
  const inPeriodSales = actualSales.filter((n) => inP(day(n.sale.occurred_at), from, to));
  const curs = new Set([...inPeriodSales.map((n) => n.sale.currency), ...spend.map((s) => s.currency)]);
  const out: Cac[] = [];
  for (const cur of [...curs].sort()) {
    const sp = spend.filter((s) => s.currency === cur && (s.kind === "spend" || s.kind === "correction") && inP(s.occurred_on, from, to));
    const actual = c2(sp.filter((s) => s.data_class === "manual").reduce((t, s) => t + Number(s.amount), 0)
      + effectiveCosts(costs).filter((c) => c.currency === cur && c.category === "marketing" && c.data_class === "manual" && c.period_start >= from && c.period_end <= to).reduce((t, c) => t + c.value, 0));
    const simulated = c2(sp.filter((s) => s.data_class === "simulated").reduce((t, s) => t + Number(s.amount), 0));
    const newCustomers = [...first.entries()].filter(([k, d]) => k.startsWith(`${cur}|`) && inP(d, from, to)).length;
    const salesWithoutCustomer = inPeriodSales.filter((n) => n.sale.currency === cur && !n.sale.customer_ref.trim()).length;
    const base = { currency: cur, spend: actual, newCustomers, salesWithoutCustomer, simulatedSpend: simulated };
    const status: Status = salesWithoutCustomer > 0 ? "missing_customer_data" : actual <= 0 ? (simulated > 0 ? "simulated" : "unavailable") : newCustomers === 0 ? "insufficient_sample" : newCustomers < 5 ? "partially_measurable" : "fully_measurable";
    out.push({ ...base, status, value: status === "fully_measurable" || status === "partially_measurable" ? c2(actual / newCustomers) : null });
  }
  return out;
}

export type Roas = { currency: string; revenue: number; spend: number; value: number | null; model: Model; status: Status; simulatedSpend: number };
/** Campaign ROAS: revenue credited to the campaign by the chosen model / the campaign's actual marketing spending. */
export function campaignRoas(campaignId: string, events: readonly RevenueEvent[], touches: readonly Touch[], spend: readonly SpendRow[], model: Model, from: string, to: string): Roas[] {
  const att = attribute(events, touches.filter((t) => t.campaign_id === campaignId), model, from, to);
  const mine = spend.filter((s) => s.campaign_id === campaignId && (s.kind === "spend" || s.kind === "correction") && (s.category ?? "marketing") === "marketing" && inP(s.occurred_on, from, to));
  const curs = new Set([...mine.map((s) => s.currency), ...att.map((a) => a.currency)]);
  return [...curs].sort().map((cur) => {
    const revenue = c2(att.find((a) => a.currency === cur)?.credits.find((c) => c.key === `campaign:${campaignId}`)?.amount ?? 0);
    const sp = c2(mine.filter((s) => s.currency === cur && s.data_class === "manual").reduce((t, s) => t + Number(s.amount), 0));
    const sim = c2(mine.filter((s) => s.currency === cur && s.data_class === "simulated").reduce((t, s) => t + Number(s.amount), 0));
    const status: Status = sp <= 0 ? (sim > 0 ? "simulated" : "unavailable") : revenue <= 0 ? "missing_attribution" : "fully_measurable";
    return { currency: cur, revenue, spend: sp, value: status === "fully_measurable" ? c2(revenue / sp) : null, model, status, simulatedSpend: sim };
  });
}

export type ObservedValue = { currency: string; customers: number; avgRevenue: number | null; repeatRate: number | null; avgSpanDays: number | null; status: Status; salesWithoutCustomer: number };
/** Observed (historical) value per customer; a predicted lifetime value is not produced (needs churn and assumptions). */
export function observedCustomerValue(events: readonly RevenueEvent[]): ObservedValue[] {
  const sales = netSales(events).filter((n) => n.sale.data_class !== "estimated");
  return [...new Set(sales.map((s) => s.sale.currency))].sort().map((cur) => {
    const mine = sales.filter((s) => s.sale.currency === cur);
    const by = new Map<string, { net: number; n: number; first: string; last: string }>();
    for (const s of mine) {
      const ref = s.sale.customer_ref.trim().toLowerCase(); if (!ref) continue;
      const d = day(s.sale.occurred_at), e = by.get(ref) ?? { net: 0, n: 0, first: d, last: d };
      e.net += s.net; e.n += 1; if (d < e.first) e.first = d; if (d > e.last) e.last = d; by.set(ref, e);
    }
    const customers = by.size, without = mine.filter((s) => !s.sale.customer_ref.trim()).length;
    const vals = [...by.values()];
    const status: Status = without > 0 ? "missing_customer_data" : customers < 10 ? "insufficient_sample" : "fully_measurable";
    const show = customers > 0 && status !== "missing_customer_data";
    return {
      currency: cur, customers, salesWithoutCustomer: without, status,
      avgRevenue: show ? c2(vals.reduce((t, v) => t + v.net, 0) / customers) : null,
      repeatRate: show ? c2((vals.filter((v) => v.n > 1).length / customers) * 100) : null,
      avgSpanDays: show ? Math.round(vals.reduce((t, v) => t + (Date.parse(v.last) - Date.parse(v.first)) / 86_400_000, 0) / customers) : null,
    };
  });
}
