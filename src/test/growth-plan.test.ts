import { describe, it, expect } from "vitest";
import { goalProgress, budgetTotals, budgetAlert } from "@/lib/growth-plan";
describe("growth plan", () => {
  it("measures progress from baseline", () => { expect(goalProgress(20, 120, 70)).toBe(50); expect(goalProgress(null, 100, null)).toBeNull(); expect(goalProgress(0, 100, 150)).toBe(100); expect(goalProgress(null, 100, 40)).toBeNull(); });
  it("totals budget", () => { expect(budgetTotals([{ planned: 350, actual: 100, hard_cap: null }, { planned: 250, actual: 300, hard_cap: 400 }])).toEqual({ planned: 600, actual: 400, remaining: 200, variance: -200 }); });
  it("flags spend", () => {
    expect(budgetAlert({ planned: 100, actual: 130, hard_cap: 120 })).toBe("over_cap");
    expect(budgetAlert({ planned: 100, actual: 110, hard_cap: null })).toBe("over_plan");
    expect(budgetAlert({ planned: 100, actual: 80, hard_cap: null })).toBe("near_plan");
    expect(budgetAlert({ planned: 100, actual: 10, hard_cap: null })).toBeNull();
  });
});
