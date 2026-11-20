import { describe, expect, it } from "vitest";
import { daysToSample, designGaps, evaluateExperiment, experimentActions, sampleSizePerGroup } from "@/lib/experiment-stats";

const obs = (vn: number, vc: number, cn: number, cc: number, data_class = "manual") => ({ variant_n: vn, variant_conversions: vc, control_n: cn, control_conversions: cc, data_class });

describe("sample size (alpha 5% two-sided, power 80%)", () => {
  it("matches the database reference values", () => {
    expect(sampleSizePerGroup(10, 2)).toBe(3841);
    expect(sampleSizePerGroup(50, 40)).toBe(20);
    expect(sampleSizePerGroup(5, 1)).toBe(8158);
  });
  it("is unknown without both rates or outside 0–100%", () => {
    expect(sampleSizePerGroup(10, null)).toBeNull();
    expect(sampleSizePerGroup(95, 5)).toBeNull();
  });
});

describe("evaluation never claims significance too early", () => {
  const ab = { method: "ab_test" as const, sample_per_group: 3841 };
  it("a significant-looking early result is 'too early' and only inconclusive may be recorded", () => {
    const e = evaluateExperiment(ab, obs(400, 60, 400, 40));
    expect(e.z).toBeGreaterThan(1.96);
    expect(e.verdict).toBe("too_early");
    expect(e.allowed).toEqual(["inconclusive"]);
  });
  it("planned sample reached with a significant improvement allows successful", () => {
    const e = evaluateExperiment({ method: "ab_test", sample_per_group: 20 }, obs(30, 27, 30, 15));
    expect(e.verdict).toBe("better");
    expect(e.allowed).toContain("successful");
  });
  it("planned sample reached without a difference allows unsuccessful but not successful", () => {
    const e = evaluateExperiment({ method: "ab_test", sample_per_group: 100 }, obs(100, 10, 100, 10));
    expect(e.verdict).toBe("no_difference");
    expect(e.allowed).toEqual(["unsuccessful", "inconclusive"]);
  });
  it("a clearly worse variant may be called unsuccessful before the planned sample", () => {
    const e = evaluateExperiment(ab, obs(200, 4, 200, 30));
    expect(e.verdict).toBe("too_early");
    expect(e.allowed).toEqual(["unsuccessful", "inconclusive"]);
  });
  it("before/after is correlational, whatever the numbers", () => {
    expect(evaluateExperiment({ method: "before_after" }, obs(1000, 300, 1000, 100)).verdict).toBe("correlational");
  });
  it("reports the difference with a 95% interval and the guardrail", () => {
    const e = evaluateExperiment({ method: "ab_test", sample_per_group: 100, guardrail_min_rate: 8 }, obs(100, 5, 100, 10, "simulated"));
    expect(e.difference).toBe(-5);
    expect(e.interval?.[0]).toBeLessThan(-5);
    expect(e.interval?.[1]).toBeGreaterThan(-5);
    expect(e.guardrailHit).toBe(true);
    expect(e.simulated).toBe(true);
  });
  it("no data means no verdict", () => {
    expect(evaluateExperiment(ab, null).verdict).toBe("no_data");
  });
});

describe("lifecycle actions follow the database", () => {
  const member = { member: true, admin: false };
  const admin = { member: true, admin: true };
  it("only an administrator approves", () => {
    expect(experimentActions("proposed", member, false)).not.toContain("approve");
    expect(experimentActions("proposed", admin, false)).toContain("approve");
  });
  it("evaluation needs recorded results", () => {
    expect(experimentActions("running", member, false)).not.toContain("evaluate");
    expect(experimentActions("running", member, true)).toContain("evaluate");
  });
  it("viewers and closed experiments have no actions", () => {
    expect(experimentActions("draft", { member: false, admin: false }, false)).toEqual([]);
    expect(experimentActions("completed", admin, true)).toEqual([]);
  });
  it("a controlled design needs a control group and a sample size before approval", () => {
    expect(designGaps({ method: "ab_test", primary_kpi: "x", success_criteria: "s", stop_criteria: "t" })).toEqual(["control", "sample"]);
    expect(designGaps({ method: "before_after", primary_kpi: "x", success_criteria: "s", stop_criteria: "t" })).toEqual([]);
  });
  it("estimates duration from daily traffic", () => {
    expect(daysToSample(3841, 300)).toBe(13);
    expect(daysToSample(3841, null)).toBeNull();
  });
});
