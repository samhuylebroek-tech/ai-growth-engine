import { describe, it, expect } from "vitest";
import { pipelineSummary, nextStage } from "@/lib/pipeline";
describe("pipeline", () => {
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
