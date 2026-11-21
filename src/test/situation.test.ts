import { describe, expect, it } from "vitest";
import { growthSituation, type SituationInput } from "@/lib/situation";

const empty: SituationInput = { today: "2026-11-21", facts: [], factsComplete: true, conflicts: { open: 0, inReview: 0, resolved: 0, redisputed: 0 }, opportunities: [], revenue: [], spend: null, deals: [], tasks: [], runs: [], campaigns: [], experiments: [], reviews: null, budget: [], metrics: 0, measuredRecently: 0, purchaseCostsRecorded: false };
const sec = (s: ReturnType<typeof growthSituation>, k: string) => s.sections.find((x) => x.key === k)!;

describe("growth situation analysis", () => {
  it("a business without records is unknown everywhere, never good, and lists what is missing", () => {
    const s = growthSituation(empty);
    for (const k of ["health", "financial", "sales", "customers", "execution", "marketing"]) expect(sec(s, k).status).toBe("unknown");
    expect(sec(s, "financial").missing).toEqual(expect.arrayContaining(["revenue", "purchase_costs", "spend"]));
    expect(s.priorities.map((p) => p.code)).toContain("blind_spots");
  });
  it("ranks a budget overrun and many overdue tasks as the top priorities", () => {
    const s = growthSituation({ ...empty, facts: [{ verified: true }],
      tasks: [1, 2, 3].map(() => ({ status: "todo", due_date: "2026-11-01", updated_at: "2026-11-01T00:00:00Z" })),
      campaigns: [{ status: "active", state: "at_risk", overBudget: true }] });
    expect(sec(s, "execution").status).toBe("problem");
    expect(sec(s, "problems").status).toBe("problem");
    expect(s.priorities.map((p) => p.code)).toEqual(expect.arrayContaining(["overdue", "over_budget"]));
  });
  it("a budget overrun from simulated spending only is labelled simulated and is not a priority", () => {
    const s = growthSituation({ ...empty, campaigns: [{ status: "active", state: "on_track", overBudget: false, simulatedOverBudget: true }] });
    const f = sec(s, "marketing").findings.find((x) => x.code === "over_budget");
    expect(f?.reliability).toBe("simulated");
    expect(s.priorities.map((p) => p.code)).not.toContain("over_budget");
    expect(sec(s, "risks").findings.map((x) => x.code)).not.toContain("budget_risk");
  });
  it("keeps currencies apart, ignores estimates and flags a revenue drop of more than 20%", () => {
    const r = (amount: number, occurred_at: string, currency = "EUR", data_class = "manual") => ({ kind: "sale", amount, currency, occurred_at, data_class });
    const s = growthSituation({ ...empty, revenue: [r(500, "2026-11-10T00:00:00Z"), r(1000, "2026-10-10T00:00:00Z"), r(70, "2026-11-12T00:00:00Z", "USD"), r(9999, "2026-11-12T00:00:00Z", "EUR", "estimated")] });
    const f = sec(s, "financial").findings.filter((x) => x.code === "net_revenue");
    expect(f.map((x) => [x.params?.["c"], x.params?.["v"]])).toEqual([["EUR", 500], ["USD", 70]]);
    expect(f[0]?.weight).toBe(2);
    expect(f[0]?.reliability).toBe("entered");
  });
  it("counts repeat customers only from sales with a customer reference", () => {
    const sale = (ref: string) => ({ kind: "sale", amount: 10, currency: "EUR", occurred_at: "2026-11-10T00:00:00Z", data_class: "manual", customer_ref: ref });
    const s = growthSituation({ ...empty, revenue: [sale("a"), sale("a"), sale("b"), sale("")] });
    expect(sec(s, "customers").findings[0]?.params).toEqual({ n: 2, r: 1 });
  });
  it("open or disputed-again fact conflicts make business health conflicting; resolved ones do not", () => {
    const base = { ...empty, facts: [{ verified: true }] };
    expect(sec(growthSituation({ ...base, conflicts: { open: 1, inReview: 0, resolved: 0, redisputed: 0 } }), "health").status).toBe("conflicting");
    expect(sec(growthSituation({ ...base, conflicts: { open: 0, inReview: 0, resolved: 2, redisputed: 0 } }), "health").status).toBe("good");
    expect(sec(growthSituation({ ...base, conflicts: null }), "health").missing).toContain("conflict_history");
  });
  it("metrics whose latest measurement is older than 60 days make marketing outdated", () => {
    const base = { ...empty, metrics: 2, campaigns: [{ status: "active", state: "on_track", overBudget: false }] };
    expect(sec(growthSituation({ ...base, lastMeasurement: "2026-08-01" }), "marketing").status).toBe("outdated");
    expect(sec(growthSituation({ ...base, lastMeasurement: "2026-11-01", measuredRecently: 1 }), "marketing").status).toBe("good");
  });
  it("a healthy status says no problem was found and is never high confidence with missing data", () => {
    const s = growthSituation({ ...empty, facts: [{ verified: true }] });
    expect(sec(s, "health").reason).toBeNull();
    expect(sec(s, "financial").confidence).toBe("low");
  });
  it("priorities carry impact, urgency, confidence, owner, measure and a next action", () => {
    const s = growthSituation({ ...empty, facts: [{ verified: true }], tasks: [1, 2, 3].map(() => ({ status: "todo", due_date: "2026-11-01", updated_at: "2026-11-01T00:00:00Z" })) });
    const p = s.priorities.find((x) => x.code === "overdue");
    expect(p).toMatchObject({ urgency: "high", confidence: "high", owner: "workspace_editor", measure: "overdue_tasks", action: { to: "/app/tasks" } });
  });
});
