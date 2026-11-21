import { describe, expect, it } from "vitest";
import { pickConversionGoal } from "@/lib/execution";

const goals = [{ id: "goal-top" }, { id: "goal-second" }];

describe("goal used when turning a recommendation into work", () => {
  it("preselects the top goal when nothing was chosen", () => {
    expect(pickConversionGoal(null, goals)).toBe("goal-top");
  });
  it("keeps an explicit 'no growth goal' choice even when goals exist", () => {
    expect(pickConversionGoal("", goals)).toBe("");
  });
  it("uses the goal the user picked", () => {
    expect(pickConversionGoal("goal-second", goals)).toBe("goal-second");
  });
  it("has no goal when the business has none", () => {
    expect(pickConversionGoal(null, [])).toBe("");
  });
});
