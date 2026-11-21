import { describe, expect, it } from "vitest";
import { compareVersions, type ComparableVersion } from "@/lib/strategy-compare";

const v1: ComparableVersion = {
  id: "a", version: 1, status: "superseded", title: "Lunch offer", summary: "Test a lunch offer.",
  plan_snapshot: { assumptions: ["Offices nearby order lunch"], risks: ["Costs unknown"], kpis: [{ metric: "Margin per order" }], budget: { amount: 500, currency: "EUR", basis: "estimate" }, outcome: "First paid orders" },
  initiatives: [{ title: "Price the offer", channel: "", status: "completed" }, { title: "Partner outreach", channel: "email", status: "cancelled" }],
};
const v2: ComparableVersion = {
  ...v1, id: "b", version: 2, status: "approved", summary: "Test a lunch offer with fixed order terms.",
  plan_snapshot: { assumptions: ["Offices nearby order lunch"], risks: ["Costs unknown", "Minimum order may deter"], kpis: [{ metric: "Margin per order" }, { metric: "Accepted quotes" }], budget: { amount: 800, currency: "EUR", basis: "estimate" }, outcome: "First paid orders" },
  initiatives: [{ title: "Price the offer", channel: "", status: "planned" }, { title: "Order terms page", channel: "web", status: "planned" }],
};

describe("comparing two strategy versions", () => {
  it("lists initiatives added and removed by title", () => {
    const c = compareVersions(v1, v2);
    expect(c.initiatives.added).toEqual(["Order terms page"]);
    expect(c.initiatives.removed).toEqual(["Partner outreach"]);
    expect(c.initiatives.kept).toBe(1);
  });
  it("shows changed risks and KPIs, and an unchanged assumption as kept", () => {
    const c = compareVersions(v1, v2);
    expect(c.lists.risks.added).toEqual(["Minimum order may deter"]);
    expect(c.lists.kpis.added).toEqual(["Accepted quotes"]);
    expect(c.lists.assumptions).toEqual({ added: [], removed: [], kept: 1 });
  });
  it("reports the budget change from 500 to 800 EUR", () => {
    const c = compareVersions(v1, v2);
    expect(c.budget.changed).toBe(true);
    expect(c.budget.before?.amount).toBe(500);
    expect(c.budget.after?.amount).toBe(800);
  });
  it("keeps the previous version's recorded initiative results", () => {
    expect(compareVersions(v1, v2).previousInitiatives).toEqual({ completed: 1, cancelled: 1 });
  });
  it("calls two identical versions unchanged", () => {
    expect(compareVersions(v1, { ...v1, id: "c", version: 2 }).unchanged).toBe(true);
  });
});
