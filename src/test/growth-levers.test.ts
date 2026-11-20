import { describe, expect, it } from "vitest";
import { LEVERS, leverCoverage, leverLines } from "@/lib/growth-levers";

const empty = { facts: [], metricLabels: [], revenueRows: 0, attributedTouches: 0, deals: 0, budgetLines: 0, campaigns: 0, experiments: 0, competitorObservations: 0 };

describe("growth lever coverage", () => {
  it("checks all fifteen levers", () => {
    expect(LEVERS).toHaveLength(15);
    expect(leverCoverage(empty)).toHaveLength(15);
  });
  it("names missing data instead of inventing support when nothing is recorded", () => {
    const c = leverCoverage(empty);
    expect(c.every((x) => x.have.length === 0)).toBe(true);
    expect(leverLines(c)[0]).toContain("no supporting data");
  });
  it("only counts confirmed facts, and recognises Dutch and French metric names", () => {
    const c = leverCoverage({
      ...empty,
      facts: [{ key: "Prijs per box", verified: false }, { key: "Verwijzingsprogramma", verified: true }],
      metricLabels: ["Terugkerende klanten", "Taux de conversion"],
    });
    const by = Object.fromEntries(c.map((x) => [x.lever, x.have]));
    expect(by["pricing"]).not.toContain("pricing_fact");
    expect(by["referrals"]).toEqual(["referral_fact", "retention_metric"]);
    expect(by["conversion"]).toContain("conversion_metric");
  });
});
