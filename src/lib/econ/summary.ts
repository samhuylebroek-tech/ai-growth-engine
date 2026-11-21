// Growth economics summary (pure): the one calculation behind the Growth economics page, the Growth Officer context,
// Home financial alerts and the financial report section, so all four show the same figures. It only combines the
// canonical ledgers through the rules in this folder; actual, estimated, simulated and reserved values stay apart,
// figures without their inputs carry the missing inputs, and alerts point to recorded evidence, never to a cause.
import { attribute, revenueTotals, type Model } from "@/lib/bi/attribution";
import { budgetEconomics } from "@/lib/budget-allocation";
import { creditCost } from "@/lib/econ/credit-pricing";
import { cac, campaignRoas, grossProfit, observedCustomerValue } from "@/lib/econ/profitability";
import { completeness, rollup, type Money, type Totals } from "@/lib/econ/rollup";
import { duplicateGroups } from "@/lib/econ/budget-duplicates";
import type { EconData, EconProposal } from "@/lib/econ/read";

export const PRICE_CURRENCY = "EUR";
const c2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
/** The period immediately before [from, to]: the same number of whole calendar months when the period is whole
 *  months (so monthly costs stay comparable), otherwise the same number of days. */
export function previousPeriod(from: string, to: string) {
  const f = new Date(`${from}T00:00:00Z`), t = new Date(`${to}T00:00:00Z`);
  const monthEnd = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate() === t.getUTCDate();
  if (f.getUTCDate() === 1 && monthEnd) {
    const k = (t.getUTCFullYear() - f.getUTCFullYear()) * 12 + t.getUTCMonth() - f.getUTCMonth() + 1;
    return { from: iso(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() - k, 1)), to: iso(Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), 0)) };
  }
  const len = Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;
  return { from: iso(Date.parse(from) - len * DAY), to: iso(Date.parse(from) - DAY) };
}

export type EconAlertCode =
  | "econ_budget_unallocated" | "econ_allocation_exceeded" | "econ_allocation_near" | "econ_request_rejected"
  | "econ_cost_model_missing" | "econ_cost_missing" | "econ_customer_missing" | "econ_attribution_missing"
  | "econ_margin_declining" | "econ_price_missing" | "econ_budget_duplicates" | "recommendation_measure_due";
export type EconAlert = { id: string; code: EconAlertCode; level: "high" | "medium" | "low"; vars: Record<string, string | number> };

export function economicsSummary(d: EconData, from: string, to: string, model: Model, today: string) {
  const inPeriod = <T extends { occurred_on: string }>(r: T) => r.occurred_on >= from && r.occurred_on <= to;
  const periodSpend = d.spend.filter(inPeriod);
  const periodCosts = d.costs.filter((c) => c.period_start >= from && c.period_end <= to);
  const input = { campaigns: d.campaigns, allocations: d.allocations, spend: d.spend, costs: d.costs, credits: d.credits };
  const pbiz: Totals = rollup("business", null, { ...input, spend: periodSpend, costs: periodCosts, credits: d.credits.filter((c) => c.at.slice(0, 10) >= from && c.at.slice(0, 10) <= to) });
  const revenue = revenueTotals(d.revenue, from, to);
  const att = attribute(d.revenue, d.touches, model, from, to);
  const gp = grossProfit(d.revenue, d.costs, d.models, from, to);
  const prev = previousPeriod(from, to);
  const gpPrev = grossProfit(d.revenue, d.costs, d.models, prev.from, prev.to);
  const cc = cac(d.revenue, d.spend, d.costs, from, to);
  const clv = observedCustomerValue(d.revenue);
  const curs = new Set([...revenue.map((r) => r.currency), ...Object.keys(pbiz.spent), ...Object.keys(pbiz.directCosts), ...Object.keys(pbiz.simulatedSpent), ...Object.keys(pbiz.estimatedCosts), ...Object.keys(pbiz.reserved)]);
  const cats = (m: Record<string, Money>, cur: string) => Object.entries(m).filter(([, v]) => v[cur]).map(([k, v]) => [k, v[cur]!] as const);
  const currencies = [...curs].sort().map((cur) => ({
    currency: cur, rev: revenue.find((r) => r.currency === cur) ?? null, att: att.find((a) => a.currency === cur) ?? null,
    spent: pbiz.spent[cur] ?? 0, reserved: pbiz.reserved[cur] ?? 0, simulated: pbiz.simulatedSpent[cur] ?? 0, costs: pbiz.directCosts[cur] ?? 0, estCosts: pbiz.estimatedCosts[cur] ?? 0,
    byCat: cats(pbiz.spentByCategory, cur), costCat: cats(pbiz.costsByCategory, cur),
    gp: gp.find((g) => g.currency === cur) ?? null, gpPrev: gpPrev.find((g) => g.currency === cur) ?? null,
    cac: cc.find((x) => x.currency === cur) ?? null, clv: clv.find((x) => x.currency === cur) ?? null,
  }));

  // AI: the usage ledger is the business total (every chargeable call once); campaign work is the part whose task
  // runs and reviews name a campaign's task. Pending and unknown outcomes are kept apart and never priced.
  const inP = (at: string) => at.slice(0, 10) >= from && at.slice(0, 10) <= to;
  const usage = d.usage.filter((u) => inP(u.at));
  const usageTotal = usage.reduce((t, u) => t + u.credits, 0);
  const work = d.credits.filter((c) => inP(c.at));
  const onCampaigns = work.filter((c) => c.state === "charged" && c.campaign_id).reduce((t, c) => t + c.credits, 0);
  const taskWork = work.filter((c) => c.state === "charged").reduce((t, c) => t + c.credits, 0);
  const byAgent = Object.entries(usage.reduce<Record<string, number>>((m, u) => ({ ...m, [u.agent_key]: (m[u.agent_key] ?? 0) + u.credits }), {})).sort((a, b) => b[1] - a[1]);
  const cost = creditCost(usage.map((u) => ({ credits: u.credits, at: u.at })), d.prices, d.planKey, PRICE_CURRENCY);
  const ai = {
    total: usageTotal, onCampaigns, otherWork: Math.max(0, usageTotal - taskWork), byAgent,
    pending: work.filter((c) => c.state === "pending").reduce((t, c) => t + c.credits, 0),
    uncertain: work.filter((c) => c.state === "uncertain").length,
    cost, priceSet: d.prices.length > 0,
    /** Campaign work larger than the usage ledger means some usage could not be read; totals are then not reconciled. */
    reconciled: taskWork <= usageTotal,
  };
  const priced = ai.cost.priced > 0 && ai.cost.unpriced === 0;

  // Budget of the period's months: planned, allocated to campaigns, unallocated (per currency, lines kept separate)
  const lines = d.budgetLines.filter((l) => l.period_month.slice(0, 10) >= from.slice(0, 7) + "-01" && l.period_month.slice(0, 10) <= to);
  const be = budgetEconomics(lines.map((l) => ({ ...l, actual: 0 })), d.allocations, d.spend);
  const budget = Object.values(be.byCurrency).sort((a, b) => a.currency.localeCompare(b.currency));
  const duplicates = duplicateGroups(lines);

  const campaigns = d.campaigns.map((c) => {
    const ct = rollup("campaign", c.id, input);
    const roas = campaignRoas(c.id, d.revenue, d.touches, d.spend, model, from, to);
    const over = Object.entries(ct.allocated).filter(([cur, a]) => a > 0 && (ct.spent[cur] ?? 0) > a).map(([cur, a]) => ({ currency: cur, allocated: a, spent: ct.spent[cur] ?? 0 }));
    const near = Object.entries(ct.allocated).filter(([cur, a]) => a > 0 && (ct.spent[cur] ?? 0) <= a && (ct.spent[cur] ?? 0) >= 0.9 * a).map(([cur, a]) => ({ currency: cur, allocated: a, spent: ct.spent[cur] ?? 0 }));
    return { id: c.id, title: c.title, status: c.status, channels: c.channels, t: ct, roas, over, near, inputs: completeness(ct, { attributedRevenue: roas.some((r) => r.revenue > 0), priced }) };
  });

  // Channel economics: actual spending of the period by the campaign's first channel, and allocations by budget line channel
  const channels: Record<string, Money> = {};
  for (const s of periodSpend) {
    if (s.data_class !== "manual" || (s.kind !== "spend" && s.kind !== "correction")) continue;
    const ch = d.campaigns.find((c) => c.id === s.campaign_id)?.channels?.[0] || "unspecified";
    (channels[ch] ??= {})[s.currency] = c2((channels[ch]![s.currency] ?? 0) + Number(s.amount));
  }

  // Recommendations: measured outcomes, learnings, and measurements that are due (shown when the app is opened)
  const learned = new Set(d.learnings.map((l) => l.proposal_id));
  const measurementDue: EconProposal[] = d.proposals.filter((p) => p.status === "converted" && p.measure_after !== null && p.measure_after <= today);
  const outcomes = {
    improved: d.proposals.filter((p) => p.status === "measured" && p.outcome === "improved").length,
    worse: d.proposals.filter((p) => p.status === "measured" && p.outcome === "worse").length,
    noChange: d.proposals.filter((p) => p.status === "measured" && p.outcome === "no_change").length,
    inconclusive: d.proposals.filter((p) => p.status === "measured" && !["improved", "worse", "no_change"].includes(p.outcome ?? "")).length,
    measuredWithoutLesson: d.proposals.filter((p) => p.status === "measured" && !learned.has(p.id)).length,
    lessons: d.learnings.length,
  };

  const alerts: EconAlert[] = [];
  const add = (id: string, code: EconAlertCode, level: EconAlert["level"], vars: EconAlert["vars"] = {}) => alerts.push({ id, code, level, vars });
  for (const b of budget) if (b.unallocated > 0 && b.total > 0) add(`unalloc:${b.currency}`, "econ_budget_unallocated", "low", { a: `${b.unallocated} ${b.currency}`, total: `${b.total} ${b.currency}` });
  for (const c of campaigns) for (const o of c.over) add(`over:${c.id}:${o.currency}`, "econ_allocation_exceeded", "high", { c: c.title, s: `${o.spent} ${o.currency}`, a: `${o.allocated} ${o.currency}` });
  for (const c of campaigns) for (const o of c.near) add(`near:${c.id}:${o.currency}`, "econ_allocation_near", "medium", { c: c.title, s: `${o.spent} ${o.currency}`, a: `${o.allocated} ${o.currency}` });
  const recentRejected = d.requests.filter((r) => r.status === "rejected" && r.decided_at && Date.parse(today) - Date.parse(r.decided_at.slice(0, 10)) <= 14 * DAY);
  if (recentRejected.length) add("rejected", "econ_request_rejected", "medium", { n: recentRejected.length });
  if (duplicates.length) add("dups", "econ_budget_duplicates", "low", { n: duplicates.length });
  for (const c of currencies) {
    const sales = c.rev?.sales ?? 0;
    if (c.gp && sales > 0) {
      if (c.gp.missing.includes("cost_model")) add(`model:${c.currency}`, "econ_cost_model_missing", "medium", { cur: c.currency });
      else if (c.gp.missing.length) add(`cost:${c.currency}`, "econ_cost_missing", "medium", { cur: c.currency, m: c.gp.monthsWithoutCost.join(", ") || "—", n: c.gp.salesWithoutCost });
    }
    if (c.cac && c.cac.salesWithoutCustomer > 0) add(`cust:${c.currency}`, "econ_customer_missing", "low", { n: c.cac.salesWithoutCustomer, cur: c.currency });
    if (c.att && c.att.unattributedSales > 0) add(`att:${c.currency}`, "econ_attribution_missing", "low", { n: c.att.unattributedSales, cur: c.currency });
    // a margin decline is only stated when both periods were fully measurable from actual records
    if (c.gp?.status === "fully_measurable" && c.gpPrev?.status === "fully_measurable" && c.gp.grossMargin !== null && c.gpPrev.grossMargin !== null && c.gpPrev.grossMargin - c.gp.grossMargin >= 5)
      add(`margin:${c.currency}`, "econ_margin_declining", "high", { now: c.gp.grossMargin, before: c.gpPrev.grossMargin, cur: c.currency });
  }
  if (ai.total > 0 && !ai.priceSet) add("price", "econ_price_missing", "low", { n: ai.total });
  if (measurementDue.length) add("measure", "recommendation_measure_due", "medium", { n: measurementDue.length, t: measurementDue[0]!.title.slice(0, 80) });

  return { from, to, prev, model, currencies, ai, budget, duplicates, campaigns, channels, outcomes, measurementDue, alerts, incomplete: d.incomplete };
}
export type EconSummary = ReturnType<typeof economicsSummary>;
