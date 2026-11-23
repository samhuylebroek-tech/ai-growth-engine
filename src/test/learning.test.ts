import { describe, expect, it } from "vitest";
import {
  allowedOutcomes,
  expectedVsActual,
  learningPatterns,
  stageOf,
  type Learning,
} from "@/lib/econ/learning";

const p = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id,
  status,
  outcome: null,
  measure_after: null,
  campaign_id: null,
  category: "immediate",
  created_at: "2026-11-01",
  reviewed_at: null,
  ...extra,
});
let n = 0;
const l = (
  proposal_id: string,
  outcome_class: string,
  extra: Partial<Learning> = {},
): Learning => ({
  id: `l${++n}`,
  proposal_id,
  outcome_class,
  evidence_class: "actual",
  lever: "lead_generation",
  channel: "email",
  business_model: "B2B",
  measured_change_pct: 10,
  expected_cost: 100,
  actual_cost: 100,
  currency: "EUR",
  expected_credits: 5,
  actual_credits: 6,
  days_to_result: 20,
  execution_quality: "good",
  created_at: "2026-11-10T00:00:00Z",
  ...extra,
});

describe("recommendation stages", () => {
  it("follows recorded state, and completed work is not success", () => {
    expect(stageOf(p("a", "proposed", { reviewed_at: "x" }), null, [], false, "2026-11-21")).toBe(
      "evidence_reviewed",
    );
    expect(
      stageOf(p("a", "converted"), { status: "todo", owner_id: null }, [], true, "2026-11-21"),
    ).toBe("assigned");
    expect(
      stageOf(
        p("a", "converted"),
        { status: "in_progress", owner_id: null },
        [],
        false,
        "2026-11-21",
      ),
    ).toBe("execution_started");
    expect(
      stageOf(
        p("a", "converted", { measure_after: "2026-12-01" }),
        { status: "done", owner_id: null },
        [],
        false,
        "2026-11-21",
      ),
    ).toBe("execution_completed");
    expect(
      stageOf(
        p("a", "converted", { measure_after: "2026-11-01" }),
        { status: "done", owner_id: null },
        [],
        false,
        "2026-11-21",
      ),
    ).toBe("measurement_pending");
    expect(
      stageOf(p("a", "measured", { outcome: "improved" }), null, [], false, "2026-11-21"),
    ).toBe("evaluated");
    expect(
      stageOf(
        p("a", "measured", { outcome: "improved" }),
        null,
        [{ proposal_id: "a" }],
        false,
        "2026-11-21",
      ),
    ).toBe("learning_recorded");
    expect(stageOf(p("a", "withdrawn"), null, [], false, "2026-11-21")).toBe("archived");
  });
});

describe("learning patterns", () => {
  const props = [
    p("a", "measured", { campaign_id: "c1" }),
    p("b", "measured", { campaign_id: "c2" }),
    p("c", "measured", { campaign_id: "c3" }),
    p("d", "measured", { campaign_id: "c1" }),
  ];
  it("does not generalise from one campaign or fewer than three learnings", () => {
    const [pat] = learningPatterns(
      [
        l("a", "positive"),
        l("d", "positive"),
        l("a", "positive", { created_at: "2026-11-12T00:00:00Z" }),
      ],
      props,
    );
    expect(pat).toMatchObject({ observations: 2, campaigns: 1, confidence: "not_enough" });
    expect(pat!.limitations).toEqual(
      expect.arrayContaining(["correlation_not_cause", "few_observations", "single_campaign"]),
    );
  });
  it("reaches at most medium confidence for consistent learnings across campaigns", () => {
    const [pat] = learningPatterns(
      [l("a", "positive"), l("b", "positive"), l("c", "positive", { actual_cost: 200 })],
      props,
    );
    expect(pat).toMatchObject({
      observations: 3,
      campaigns: 3,
      confidence: "medium",
      direction: "positive",
      costOverruns: 1,
      avgDaysToResult: 20,
    });
  });
  it("ignores simulated and unmeasured learnings", () => {
    expect(
      learningPatterns(
        [l("a", "positive", { evidence_class: "simulated" }), l("b", "not_executed")],
        props,
      ),
    ).toEqual([]);
  });
  it("is low confidence when results disagree", () => {
    expect(
      learningPatterns([l("a", "positive"), l("b", "negative"), l("c", "no_change")], props)[0],
    ).toMatchObject({ confidence: "low", direction: "mixed" });
  });
  it("compares expected and actual only where both are recorded", () => {
    expect(expectedVsActual(l("a", "positive", { actual_cost: 130 }))).toMatchObject({
      cost: { diff: 30 },
      credits: { diff: 1 },
    });
    expect(expectedVsActual(l("a", "positive", { actual_cost: null })).cost).toBeNull();
  });
});

describe("allowedOutcomes", () => {
  it("allows a positive learning only after a measurement recorded an improvement", () => {
    expect(allowedOutcomes({ status: "measured", outcome: "improved" })).toContain("positive");
    expect(allowedOutcomes({ status: "measured", outcome: "worse" })).not.toContain("positive");
    expect(allowedOutcomes({ status: "converted", outcome: null })).not.toContain("positive");
  });
  it("allows no learning before the recommendation became work", () => {
    expect(allowedOutcomes({ status: "approved", outcome: null })).toEqual([]);
    expect(allowedOutcomes({ status: "proposed", outcome: null })).toEqual([]);
  });
});
