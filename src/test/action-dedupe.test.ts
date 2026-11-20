import { describe, expect, it } from "vitest";
import { dedupeActions, sameIdea, type GrowthAction } from "@/lib/bi/growth-actions";

const act = (id: string, kind: GrowthAction["kind"], title: string, score: number): GrowthAction => ({
  id, kind, category: "opportunity", code: kind, vars: { title },
  components: { value: 3, importance: 3, urgency: 3, confidence: 3, feasibility: 3, risk: 1 },
  score, delay: "work_waits", to: "/app/opportunities", blockers: [], quality: "some", uncertain: false,
});

describe("duplicate recommendations", () => {
  it("recognises the same idea despite case, accents and filler words", () => {
    expect(sameIdea("Launch a loyalty programme for regulars", "launch loyalty programme regulars")).toBe(true);
    expect(sameIdea("Lancer un programme de fidélité", "lancer programme fidelite")).toBe(true);
    expect(sameIdea("Launch a loyalty programme", "Raise prices for catering")).toBe(false);
  });
  it("keeps the higher-ranked copy and lists the other one", () => {
    const out = dedupeActions([
      act("proposal:1", "decide_proposal", "Start Google Ads campaign for catering", 70),
      act("opportunity:9", "opportunity", "start google ads campaign catering", 60),
    ]);
    expect(out.map((a) => a.id)).toEqual(["proposal:1"]);
    expect(out[0]?.alsoSuggested).toEqual(["opportunity:9"]);
  });
  it("never folds a running experiment into a matching suggestion", () => {
    const out = dedupeActions([
      act("opportunity:9", "opportunity", "Test new homepage headline", 70),
      act("experiment_due:3", "close_experiment", "Test new homepage headline", 60),
    ]);
    expect(out).toHaveLength(2);
  });
});
