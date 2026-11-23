import { describe, expect, it } from "vitest";
import { REPORT_FIGURES, type Figure } from "@/lib/report-claims";

const all = Object.entries(REPORT_FIGURES) as [string, Figure][];

describe("report figure labels", () => {
  it("every derived figure (calc) names its formula", () => {
    for (const [id, x] of all) if (x.kind === "calc") expect(x.formula, id).toBeTruthy();
  });
  it("period changes are always calculations, never facts", () => {
    for (const [id, x] of all) if (id.endsWith(".change")) expect(x.kind, id).toBe("calc");
  });
  it("estimated amounts are labelled estimates, never facts", () => {
    expect(REPORT_FIGURES["fin.estimated"].kind).toBe("estimate");
    expect(REPORT_FIGURES["econ.estCosts"].kind).toBe("estimate");
    expect(REPORT_FIGURES["econ.gpEstimated"].kind).toBe("estimate");
  });
  it("net revenue, revenue per spend, CAC and gross profit are calculated from recorded inputs", () => {
    for (const id of ["fin.net", "fin.perSpend", "econ.cac", "econ.gp", "econ.margin"] as const)
      expect(REPORT_FIGURES[id].kind).toBe("calc");
  });
  it("refunds are recorded figures that carry the sale-month rule", () => {
    expect(REPORT_FIGURES["fin.refunds"]).toEqual({
      kind: "fact",
      source: "revenue",
      formula: "refunds",
    });
  });
});
