import { describe, expect, it } from "vitest";
import { initiativeLines, learningReport, strategyLines, type EconInput } from "@/lib/growth-reports";

const p = { from: "2026-11-01", to: "2026-11-30" };
const today = "2026-11-21";
const initiatives = [
  { id: "i1", title: "Price the offer", status: "in_progress", plan_version_id: "v1", goal_id: "g1", project_id: "p1", channel: "" },
  { id: "i2", title: "Unstarted", status: "planned", plan_version_id: "v1", goal_id: "g1", project_id: null, channel: "" },
];
const campaigns = [
  { id: "c1", title: "Lunch", status: "active", goal_id: "g1", initiative_id: "i1", budget_eur: 300 },
  { id: "c2", title: "Other", status: "active", goal_id: "g1", initiative_id: null, budget_eur: 100 },
];
const tasks = [
  // linked through both the initiative's project and its campaign: counted once
  { id: "t1", status: "done", project_id: "p1", campaign_id: "c1", due_date: null },
  { id: "t2", status: "todo", project_id: "p1", campaign_id: null, due_date: "2026-11-10" },
];
const econ: EconInput = {
  campaigns: [{ id: "c1", title: "Lunch", status: "active", initiative_id: "i1", strategy_id: "s1", goal_id: "g1" }, { id: "c2", title: "Other", status: "active", initiative_id: null, strategy_id: null, goal_id: "g1" }],
  allocations: [],
  spend: [
    { campaign_id: "c1", kind: "spend", amount: 120, currency: "EUR", data_class: "manual", occurred_on: "2026-11-05" },
    { campaign_id: "c1", kind: "commitment", amount: 50, currency: "EUR", data_class: "manual", occurred_on: "2026-11-06" },
    { campaign_id: "c1", kind: "spend", amount: 40, currency: "EUR", data_class: "simulated", occurred_on: "2026-11-07" },
    { campaign_id: "c1", kind: "spend", amount: 999, currency: "EUR", data_class: "manual", occurred_on: "2026-10-05" },
  ],
  costs: [],
  credits: [{ campaign_id: "c1", credits: 6, state: "charged", at: "2026-11-08" }],
};

describe("initiative report", () => {
  const lines = initiativeLines({ initiatives, campaigns, tasks, operations: [], econ }, p, today);
  it("counts a task linked through project and campaign once", () => {
    expect(lines[0]?.work).toEqual({ campaigns: 1, tasks: 2, done: 1, open: 1, overdue: 1 });
  });
  it("uses only actual spending in the period; reservations and simulated spending stay apart", () => {
    expect(lines[0]?.money?.spent).toEqual({ EUR: 120 });
    expect(lines[0]?.money?.reserved).toEqual({ EUR: 50 });
    expect(lines[0]?.money?.simulatedSpent).toEqual({ EUR: 40 });
    expect(lines[0]?.money?.credits).toBe(6);
  });
  it("lists missing work and KPI instead of showing zero", () => {
    expect(lines[1]?.missing).toContain("no_work");
    expect(lines[0]?.missing).toContain("no_kpi");
  });
  it("says money is unavailable when the ledgers could not be read", () => {
    const l = initiativeLines({ initiatives, campaigns, tasks, operations: [], econ: null }, p, today);
    expect(l[0]?.money).toBeNull();
    expect(l[0]?.missing).toContain("money_unavailable");
  });
});

describe("strategy report", () => {
  const goals = [{ id: "g1", title: "More orders", status: "active", metric: "orders", baseline: 10, target: 20, current_value: 15, due_date: "2026-12-31" }];
  const plans = [
    { id: "v1", goal_id: "g1", strategy_id: "s1", version: 1, status: "approved", title: "Lunch", approved_at: "2026-11-01", created_at: "2026-11-01", plan_snapshot: { risks: ["a", "b"], assumptions: ["x"] } },
    { id: "v2", goal_id: "g1", strategy_id: "s2", version: 2, status: "draft", title: "Lunch v2", approved_at: null, created_at: "2026-11-20" },
  ];
  const lines = strategyLines({ initiatives, campaigns, tasks, operations: [], econ, plans, goals, budget: [] }, p, today);
  it("reports only strategies in effect, with goal progress 50% and a pending draft", () => {
    expect(lines).toHaveLength(1);
    expect(lines[0]?.goal?.progress).toBe(50);
    expect(lines[0]?.pendingDraft).toBe(true);
  });
  it("counts the strategy's money once and keeps goal campaigns outside the strategy apart", () => {
    expect(lines[0]?.money?.spent).toEqual({ EUR: 120 });
    expect(lines[0]?.unlinkedGoalCampaigns).toBe(1);
    expect(lines[0]?.initiativesWithoutWork).toBe(1);
  });
  it("counts a campaign linked only to the strategy record in both work and money", () => {
    const extra = [...campaigns, { id: "c3", title: "Strategy-only", status: "active", goal_id: "g1", initiative_id: null, strategy_id: "s1", budget_eur: 0 }];
    const e2: EconInput = { ...econ, campaigns: [...econ.campaigns, { id: "c3", title: "Strategy-only", status: "active", initiative_id: null, strategy_id: "s1", goal_id: "g1" }],
      spend: [...econ.spend, { campaign_id: "c3", kind: "spend", amount: 30, currency: "EUR", data_class: "manual", occurred_on: "2026-11-09" }] };
    const l = strategyLines({ initiatives, campaigns: extra, tasks, operations: [], econ: e2, plans, goals, budget: [] }, p, today)[0];
    expect(l?.work.campaigns).toBe(2);
    expect(l?.money?.spent).toEqual({ EUR: 150 });
    expect(l?.unlinkedGoalCampaigns).toBe(1);
  });
  it("still reports missing actual spending when only simulated spending exists", () => {
    const simOnly: EconInput = { ...econ, spend: [{ campaign_id: "c1", kind: "spend", amount: 40, currency: "EUR", data_class: "simulated", occurred_on: "2026-11-07" }] };
    const l = initiativeLines({ initiatives, campaigns, tasks, operations: [], econ: simOnly }, p, today)[0];
    expect(l?.missing).toContain("no_spend");
    expect(l?.money?.simulatedSpent).toEqual({ EUR: 40 });
  });
  it("leaves out strategies of archived goals", () => {
    expect(strategyLines({ initiatives, campaigns, tasks, operations: [], econ, plans, goals: [{ ...goals[0]!, status: "archived" }], budget: [] }, p, today)).toHaveLength(0);
  });
  it("marks a missing planned budget as missing", () => {
    expect(lines[0]?.missing).toContain("no_budget");
    expect(lines[0]?.risks).toBe(2);
  });
});

describe("recommendation learning report", () => {
  const proposals = [
    { id: "a", status: "measured", outcome: "improved", created_at: "2026-10-01", decided_at: "2026-10-02", measured_at: "2026-11-10", campaign_id: "c1", category: "pricing" },
    { id: "b", status: "measured", outcome: null, created_at: "2026-11-01", decided_at: "2026-11-02", measured_at: "2026-11-12", campaign_id: null, category: "pricing" },
    { id: "c", status: "converted", outcome: null, created_at: "2026-11-03", decided_at: "2026-11-04", measured_at: null, campaign_id: null, category: "sales" },
  ];
  const r = learningReport(proposals, [], p);
  it("counts measured outcomes in the period; a measurement without an outcome is inconclusive", () => {
    expect(r.measured).toBe(2);
    expect(r.outcomes).toEqual({ improved: 1, no_change: 0, worse: 0, inconclusive: 1 });
  });
  it("counts converted work still waiting for measurement", () => {
    expect(r.awaitingMeasurement).toBe(1);
    expect(r.converted).toBe(2);
  });
});
