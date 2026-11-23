import { describe, expect, it } from "vitest";
import { claimScope, orgClaim, SECTION_KIND } from "@/lib/org/claims";

describe("organization statement kinds", () => {
  it("an AI 'recorded' claim citing a business record is a fact", () => {
    expect(orgClaim("recorded", "ai", "Average order €42 (source: #F-1a2b3c4d)")).toEqual({
      kind: "fact",
      downgraded: false,
    });
  });
  it("an AI 'verified' claim without a record reference is shown as a hypothesis", () => {
    expect(orgClaim("verified", "ai", "Both businesses serve offices")).toEqual({
      kind: "hypothesis",
      downgraded: true,
    });
  });
  it("rule evidence read from records stays a fact", () => {
    expect(orgClaim("recorded", "rule", "Both list catering")).toEqual({
      kind: "fact",
      downgraded: false,
    });
  });
  it("platform-computed organization figures are calculations; estimates, assumptions and gaps keep their kind", () => {
    expect(orgClaim("calculated", "ai", "").kind).toBe("calc");
    expect(orgClaim("estimate", "ai", "").kind).toBe("estimate");
    expect(orgClaim("assumption", "ai", "").kind).toBe("hypothesis");
    expect(orgClaim("missing", "ai", "").kind).toBe("missing");
    expect(orgClaim("something-else", "ai", "").kind).toBe("hypothesis");
  });
  it("recommendations, synergies, risks and gaps have fixed kinds", () => {
    expect(SECTION_KIND.resources).toBe("recommendation");
    expect(SECTION_KIND.collaboration).toBe("hypothesis");
    expect(SECTION_KIND.risks).toBe("hypothesis");
    expect(SECTION_KIND.gaps).toBe("missing");
  });
  it("one business is business-level, several or none organization-level", () => {
    expect(claimScope(["a"])).toBe("business");
    expect(claimScope(["a", "b"])).toBe("organization");
    expect(claimScope([null])).toBe("organization");
  });
});

import { parseOrgStrategy } from "@/lib/org/strategy";
describe("organization strategy evidence classes", () => {
  it("objectives may be calculated; opportunity evidence never gets a class the database would refuse", () => {
    const raw = JSON.stringify({
      title: "T",
      summary: "S",
      objectives: [{ objective: "Grow", kpi: "rev", target: "+10%", basis: "calculated" }],
      opportunities: [
        {
          kind: "cross_sell",
          title: "X",
          businesses: ["B1", "B2"],
          evidence: [{ text: "Overlap", class: "calculated" }],
          expected_impact: "",
          estimated_cost: "",
          dependencies: "",
          risks: "",
          confidence: "low",
          next_action: "",
        },
      ],
    });
    const p = parseOrgStrategy(raw, {
      B1: "11111111-1111-1111-1111-111111111111",
      B2: "22222222-2222-2222-2222-222222222222",
    });
    expect(p.objectives[0]?.basis).toBe("calculated");
    expect(p.opportunities[0]?.evidence[0]?.class).toBe("assumption");
  });
});
