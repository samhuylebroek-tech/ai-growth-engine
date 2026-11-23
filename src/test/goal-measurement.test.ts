import { describe, expect, it } from "vitest";
import { goalMeasurement } from "@/lib/goal-measurement";

const g = {
  metric: "monthly revenue",
  baseline: 10000,
  target: 12000,
  current_value: 10500,
  due_date: "2027-05-21",
  created_at: "2026-11-21",
};
describe("goal measurement", () => {
  it("'+20% monthly revenue in six months' without a baseline is not measurable and no baseline is assumed", () => {
    const m = goalMeasurement({ ...g, baseline: null }, "2026-11-21");
    expect(m.measurable).toBe(false);
    expect(m.missing).toEqual(["baseline"]);
    expect(m.progress).toBeNull();
  });
  it("lists every missing input", () => {
    expect(
      goalMeasurement(
        { metric: "", baseline: null, target: null, current_value: null, due_date: null },
        "2026-11-21",
      ).missing,
    ).toEqual(["metric", "baseline", "target", "current", "deadline"]);
  });
  it("reports progress, gap, days left and pace from entered values", () => {
    const m = goalMeasurement(g, "2027-02-19"); // about half the period, a quarter of the way
    expect(m).toMatchObject({
      measurable: true,
      progress: 25,
      gap: 1500,
      daysLeft: 91,
      pace: "behind",
    });
    expect(goalMeasurement({ ...g, current_value: 11000 }, "2027-02-19").pace).toBe("on_pace");
  });
  it("a goal past its deadline below target is overdue", () => {
    expect(goalMeasurement(g, "2027-06-01").pace).toBe("overdue");
  });
});
