import { describe, expect, it } from "vitest";
import { parseOpportunities, priorityScore, rankOpportunities, MAX_OPPORTUNITIES } from "@/lib/opportunities";

const base = { title: "Referral programme", domain: "retention", summary: "Regulars refer friends", impact: 4, feasibility: 4, cost: 2, time_to_value: 2, risk: 2, horizon_days: 90, confidence: "medium" };

describe("revenue opportunities", () => {
  it("weighs impact three times and feasibility twice; low cost, speed and risk add", () => {
    expect(priorityScore({ impact: 5, feasibility: 5, cost: 1, time_to_value: 1, risk: 1 })).toBe(40);
    expect(priorityScore({ impact: 1, feasibility: 1, cost: 5, time_to_value: 5, risk: 5 })).toBe(8);
    const ranked = rankOpportunities([{ ...base, impact: 2 }, { ...base, impact: 5 }]);
    expect(ranked[0]!.impact).toBe(5);
  });

  it("clamps scores, maps unknown domains to other and fixes reversed budget ranges", () => {
    const [o] = parseOpportunities(JSON.stringify({ opportunities: [{ ...base, domain: "telepathy", impact: 9, risk: 0, budget_min: 900, budget_max: 300, horizon_days: 5000 }] }));
    expect(o!.domain).toBe("other");
    expect(o!.impact).toBe(5);
    expect(o!.risk).toBe(1);
    expect([o!.budget_min, o!.budget_max]).toEqual([300, 900]);
    expect(o!.horizon_days).toBe(730);
  });

  it("treats an unknown evidence class as a hypothesis, never as a fact", () => {
    const [o] = parseOpportunities(JSON.stringify({ opportunities: [{ ...base, evidence: [{ statement: "Customers love us", class: "proven" }] }] }));
    expect(o!.evidence[0]!.class).toBe("hypothesis");
  });

  it("drops invalid and duplicate items, keeps at most five", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ ...base, title: `Idea ${i}` }));
    const items = parseOpportunities("```json\n" + JSON.stringify({ opportunities: [{ title: "x" }, { ...base }, { ...base, title: "REFERRAL PROGRAMME" }, ...many] }) + "\n```");
    expect(items).toHaveLength(MAX_OPPORTUNITIES);
    expect(items.filter((o) => o.title.toLowerCase() === "referral programme")).toHaveLength(1);
  });

  it("rejects output without any valid opportunity", () => {
    expect(() => parseOpportunities(JSON.stringify({ opportunities: [{ title: "no" }] }))).toThrow();
    expect(() => parseOpportunities("not json")).toThrow();
  });
});
