import { describe, it, expect } from "vitest";
import { pipelineSummary, pipelineCurrencies, nextStage, pipelineMatches } from "@/lib/pipeline";
describe("pipeline", () => {
  it("finds customers by name, company or source without accents or case affecting matching", () => {
    expect(pipelineMatches(["Élodie", "Studio", "lead-form:website"], "elodie")).toBe(true);
    expect(pipelineMatches(["Élodie", "Studio", "lead-form:website"], "WEBSITE")).toBe(true);
    expect(pipelineMatches([null, "Studio"], "unrelated")).toBe(false);
  });
  it("never combines sales values from different currencies", () => {
    const result = pipelineCurrencies([
      { stage: "lead", value: 100, currency: "EUR" },
      { stage: "proposal", value: 50, currency: "USD" },
      { stage: "won", value: 300, currency: "USD" },
    ]);
    expect(result.map(({ currency, open, won }) => ({ currency, open, won }))).toEqual([
      { currency: "EUR", open: 100, won: 0 },
      { currency: "USD", open: 50, won: 300 },
    ]);
  });
  it("sums open and won value and win rate from closed deals only", () => {
    const s = pipelineSummary([
      { stage: "lead", value: 100 },
      { stage: "proposal", value: "50" },
      { stage: "won", value: 300 },
      { stage: "lost", value: 80 },
    ]);
    expect(s).toEqual({
      open: 150,
      openCount: 2,
      won: 300,
      wonCount: 1,
      lostCount: 1,
      winRate: 50,
    });
  });
  it("has no win rate without closed deals", () => {
    expect(pipelineSummary([{ stage: "lead", value: 1 }]).winRate).toBeNull();
  });
  it("advances up to negotiation only", () => {
    expect(nextStage("lead")).toBe("qualified");
    expect(nextStage("negotiation")).toBeNull();
    expect(nextStage("won")).toBeNull();
  });
});
