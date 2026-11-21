import { describe, expect, it } from "vitest";
import { economicsSummary, previousPeriod } from "@/lib/econ/summary";
import type { EconData } from "@/lib/econ/read";
import type { RevenueEvent } from "@/lib/bi/attribution";
import { economicsLines, type BusinessDomains } from "@/lib/security/business-context";
import { detectSignals } from "@/lib/signals";
const ok = <T>(rows: T[]) => ({ status: "ok" as const, rows, truncated: false });
const signalBase = (): BusinessDomains => ({
  workspace: { id: "w", name: "Main" },
  objectives: null,
  facts: [],
  goals: [],
  recommendations: [],
  plans: ok([]),
  initiatives: [],
  operations: [],
  projects: [],
  tasks: [],
  budget: ok([]),
  deals: ok([]),
  competitors: ok([]),
  observations: [],
  seo: ok([]),
  content: ok([]),
  versions: [],
  decisions: [],
  campaigns: ok([]),
  connections: ok([]),
  metrics: ok([]),
  measurements: [],
});

let n = 0;
const sale = (amount: number, at: string, customer_ref = "c1"): RevenueEvent => ({ id: `s${++n}`, kind: "sale", amount, currency: "EUR", occurred_at: `${at}T10:00:00Z`, data_class: "manual", source: "manual", source_ref: "", customer_ref, relates_to: null, unit_id: null } as RevenueEvent);
const cost = (amount: number, start: string, end: string, extra: Record<string, unknown> = {}) => ({ id: `k${++n}`, kind: "cost", category: "cogs", amount, currency: "EUR", data_class: "manual", period_start: start, period_end: end, revenue_event_id: null, relates_to: null, initiative_id: null, ...extra });
const base = (): EconData => ({
  campaigns: [{ id: "A", title: "Spring", status: "active", goal_id: null, initiative_id: null, strategy_id: null, channels: ["paid_social"] }],
  budgetLines: [{ id: "L", channel: "paid_social", period_month: "2026-11-01", planned: 1000, currency: "EUR", goal_id: null, initiative_id: null }],
  allocations: [{ id: "x", org_id: "o", workspace_id: "w", budget_line_id: "L", campaign_id: "A", currency: "EUR", amount: 400, status: "active", updated_by: "u", created_at: "", updated_at: "" }],
  spend: [], costs: [], models: [], revenue: [], touches: [], credits: [], usage: [], prices: [], planKey: null,
  initiatives: [], strategies: [], goals: [], learnings: [], proposals: [], requests: [], incomplete: [], costsInstalled: true,
} as unknown as EconData);
const spend = (amount: number, on: string, data_class = "manual") => ({ id: `p${++n}`, campaign_id: "A", kind: "spend", amount, currency: "EUR", data_class, occurred_on: on, category: "marketing", budget_line_id: "L" });
const codes = (d: EconData, today = "2026-11-21") => economicsSummary(d, "2026-11-01", "2026-11-30", "last_touch", today).alerts.map((a) => a.code);

describe("economics summary alerts", () => {
  it("reports unallocated budget from the budget line minus active allocations", () => {
    const s = economicsSummary(base(), "2026-11-01", "2026-11-30", "last_touch", "2026-11-21");
    expect(s.budget[0]).toMatchObject({ currency: "EUR", total: 1000, allocated: 400, unallocated: 600 });
    expect(s.alerts.find((a) => a.code === "econ_budget_unallocated")?.vars).toMatchObject({ a: "600 EUR" });
  });
  it("flags a campaign whose actual spending exceeds its allocation, and ignores simulated spending", () => {
    const d = base();
    d.spend = [spend(450, "2026-11-10")] as never;
    expect(codes(d)).toContain("econ_allocation_exceeded");
    d.spend = [spend(390, "2026-11-10")] as never;
    expect(codes(d)).toContain("econ_allocation_near");
    d.spend = [spend(900, "2026-11-10", "simulated")] as never;
    expect(codes(d)).not.toContain("econ_allocation_exceeded");
    expect(codes(d)).not.toContain("econ_allocation_near");
  });
  it("asks for a cost model only when there are sales and no model", () => {
    const d = base();
    expect(codes(d)).not.toContain("econ_cost_model_missing");
    d.revenue = [sale(1000, "2026-11-05")];
    expect(codes(d)).toContain("econ_cost_model_missing");
  });
  it("states a margin decline only when both periods are fully measurable", () => {
    const d = base();
    d.models = [{ model: "per_period", margin_rate: null, effective_from: "2026-01-01" }] as never;
    d.revenue = [sale(1000, "2026-10-05"), sale(1000, "2026-11-05")];
    d.costs = [cost(200, "2026-10-01", "2026-10-31"), cost(400, "2026-11-01", "2026-11-30")] as never;
    const s = economicsSummary(d, "2026-11-01", "2026-11-30", "last_touch", "2026-11-21");
    expect(s.currencies[0]!.gp?.grossMargin).toBe(60);
    expect(s.currencies[0]!.gpPrev?.grossMargin).toBe(80);
    expect(s.alerts.find((a) => a.code === "econ_margin_declining")?.vars).toMatchObject({ now: 60, before: 80 });
    // without October's cost the earlier period is not measurable, so no decline is claimed
    d.costs = [cost(400, "2026-11-01", "2026-11-30")] as never;
    expect(codes(d)).not.toContain("econ_margin_declining");
  });
  it("reminds about recommendations whose measurement date has passed (only when the app is opened)", () => {
    const d = base();
    d.proposals = [
      { id: "p1", title: "Raise prices", status: "converted", outcome: null, measure_after: "2026-11-20", campaign_id: null, category: "immediate", created_at: "2026-10-01", decided_at: "2026-10-02", task_id: null, metric_id: null },
      { id: "p2", title: "Later", status: "converted", outcome: null, measure_after: "2026-12-20", campaign_id: null, category: "immediate", created_at: "2026-10-01", decided_at: "2026-10-02", task_id: null, metric_id: null },
    ];
    const s = economicsSummary(d, "2026-11-01", "2026-11-30", "last_touch", "2026-11-21");
    expect(s.measurementDue.map((p) => p.id)).toEqual(["p1"]);
    expect(s.alerts.find((a) => a.code === "recommendation_measure_due")?.vars).toMatchObject({ n: 1 });
  });
});

describe("AI credits and cost", () => {
  it("takes the business total from the usage ledger and counts campaign work once inside it", () => {
    const d = base();
    d.usage = [{ at: "2026-11-02T10:00:00Z", credits: 6, agent_key: "marketing_strategy" }, { at: "2026-11-03T10:00:00Z", credits: 4, agent_key: "growth_officer" }];
    d.credits = [{ campaign_id: "A", credits: 6, state: "charged", at: "2026-11-02T10:00:00Z" }, { campaign_id: "A", credits: 3, state: "pending", at: "2026-11-04T10:00:00Z" }];
    const s = economicsSummary(d, "2026-11-01", "2026-11-30", "last_touch", "2026-11-21");
    expect(s.ai).toMatchObject({ total: 10, onCampaigns: 6, otherWork: 4, pending: 3, reconciled: true, priceSet: false });
    expect(s.alerts.map((a) => a.code)).toContain("econ_price_missing");
  });
  it("prices each credit at the price valid when it was used; a later price leaves earlier costs unchanged", () => {
    const d = base();
    d.usage = [{ at: "2026-11-02T10:00:00Z", credits: 10, agent_key: "seo" }, { at: "2026-11-20T10:00:00Z", credits: 10, agent_key: "seo" }];
    d.prices = [{ scope: "platform", plan_key: null, currency: "EUR", price_per_credit: 0.05, effective_from: "2026-11-01T00:00:00Z" }];
    const before = economicsSummary(d, "2026-11-01", "2026-11-30", "last_touch", "2026-11-21").ai.cost;
    expect(before).toMatchObject({ amount: 1, priced: 20, unpriced: 0 });
    d.prices = [...d.prices, { scope: "platform", plan_key: null, currency: "EUR", price_per_credit: 0.1, effective_from: "2026-11-15T00:00:00Z" }];
    expect(economicsSummary(d, "2026-11-01", "2026-11-30", "last_touch", "2026-11-21").ai.cost.amount).toBe(1.5);
    // a price that starts in the future does not price usage that happened before it
    d.prices = [{ scope: "platform", plan_key: null, currency: "EUR", price_per_credit: 0.05, effective_from: "2026-12-01T00:00:00Z" }];
    const future = economicsSummary(d, "2026-11-01", "2026-11-30", "last_touch", "2026-11-21");
    expect(future.ai.cost).toMatchObject({ priced: 0, unpriced: 20 });
    // a price exists but did not apply when the credits were used, so the "credits only" alert still shows
    expect(future.alerts.find((a) => a.code === "econ_price_missing")?.vars).toMatchObject({ n: 20 });
  });
  it("marks totals as not reconciled when campaign work exceeds the readable usage", () => {
    const d = base();
    d.credits = [{ campaign_id: "A", credits: 6, state: "charged", at: "2026-11-02T10:00:00Z" }];
    expect(economicsSummary(d, "2026-11-01", "2026-11-30", "last_touch", "2026-11-21").ai.reconciled).toBe(false);
  });
});

describe("previousPeriod", () => {
  it("compares whole months with the same number of whole months before", () => {
    expect(previousPeriod("2026-11-01", "2026-11-30")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(previousPeriod("2026-08-01", "2026-10-31")).toEqual({ from: "2026-05-01", to: "2026-07-31" });
    expect(previousPeriod("2026-01-01", "2026-01-31")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });
  it("uses the same number of days for other periods", () => {
    expect(previousPeriod("2026-11-05", "2026-11-14")).toEqual({ from: "2026-10-26", to: "2026-11-04" });
  });
});

describe("one source of truth for page, Growth Officer and Home", () => {
  const withOverrun = () => { const d = base(); d.spend = [spend(450, "2026-11-10")] as never; d.usage = [{ at: "2026-11-02T10:00:00Z", credits: 5, agent_key: "seo" }]; return d; };
  const NOW = new Date("2026-11-21T09:00:00Z");
  it("gives the Growth Officer the same figures as the page, with labels and no invented money", () => {
    const d = withOverrun();
    const page = economicsSummary(d, "2026-11-01", "2026-11-30", "last_touch", "2026-11-21");
    const lines = economicsLines({ economics: { status: "ok", data: d } } as unknown as BusinessDomains, NOW).join("\n");
    expect(lines).toContain(`not allocated ${page.budget[0]!.unallocated}`);
    expect(lines).toContain("ACTUAL SPENDING ABOVE ALLOCATION");
    expect(lines).toContain("no credit price set — state AI work in credits only");
    expect(lines).toMatch(/gross profit: not calculable/);
  });
  it("says the module is unavailable instead of empty when it is not installed", () => {
    expect(economicsLines({ economics: { status: "unavailable" } } as unknown as BusinessDomains, NOW)[0]).toMatch(/unavailable/);
  });
  it("turns the same alerts into Home signals, without repeating a campaign that already has a budget alert", () => {
    const d = withOverrun();
    const domains = { ...signalBase(), economics: { status: "ok" as const, data: d } };
    const sig = detectSignals(domains, NOW);
    expect(sig.find((s) => s.code === "econ_allocation_exceeded")).toMatchObject({ to: "/app/economics", basis: "economics", impact: "high" });
    expect(sig.map((s) => s.code)).toContain("econ_budget_unallocated");
    const alerted = {
      ...domains,
      campaigns: { status: "ok" as const, rows: [{ id: "A", title: "Spring", status: "active", budget_eur: 100, results: "", channels: [], end_date: null, start_date: null, goal_id: null, objective: "" }], truncated: false },
      campaignSpend: { status: "ok" as const, rows: d.spend, truncated: false },
    } as unknown as BusinessDomains;
    const again = detectSignals(alerted, NOW);
    expect(again.map((s) => s.id)).toContain("campaign_budget:A");
    expect(again.map((s) => s.code)).not.toContain("econ_allocation_exceeded");
  });
});
