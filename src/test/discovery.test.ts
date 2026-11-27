import { describe, expect, it } from "vitest";
import { approvedContextFacts, parseDiscovery } from "@/lib/discovery";

describe("business discovery trust", () => {
  it("only confirmed information becomes approved context", () => {
    expect(
      approvedContextFacts([
        { value: "Extracted", verified: false },
        { value: "Confirmed", verified: true },
      ]),
    ).toEqual([{ value: "Confirmed", verified: true }]);
  });
  it("invented sources cannot become extracted evidence", () => {
    const result = parseDiscovery(
      JSON.stringify({
        facts: [
          {
            key: "industry",
            value: "Retail",
            confidence: 0.8,
            provenance: "extracted",
            source: "https://invented.test",
          },
        ],
        suggestions: [],
      }),
      ["https://real.test"],
    );
    expect(result.facts[0]?.source).toBe("");
    expect(result.facts[0]?.provenance).toBe("assumption");
  });
  it("preserves source and confidence for accessible pages", () => {
    const result = parseDiscovery(
      JSON.stringify({
        facts: [
          {
            key: "industry",
            value: "Retail",
            confidence: 0.8,
            provenance: "extracted",
            source: "https://real.test",
          },
        ],
        suggestions: [],
      }),
      ["https://real.test"],
    );
    expect(result.facts[0]).toEqual({
      key: "industry",
      value: "Retail",
      confidence: 0.8,
      provenance: "extracted",
      source: "https://real.test",
    });
  });
});
