import { describe, it, expect } from "vitest";
import { parseReview, applySuggestion } from "@/lib/content-review";

const raw = JSON.stringify({
  overall: "Solid.",
  assessments: [{ dimension: "factual", score: 3, explanation: "x" }, { dimension: "seo", score: 2, explanation: "y" }],
  claims: [
    { claim: "Founded 2010", status: "verified", factKeys: ["founded_year"], explanation: "" },
    { claim: "1000 clients", status: "verified", factKeys: ["made_up"], explanation: "" },
    { claim: "Best in class", status: "unsupported", factKeys: [], explanation: "" },
  ],
  suggestions: [{ severity: "minor", action: "grammar", explanation: "typo", find: "teh", replace: "the" }],
});

describe("content review", () => {
  it("keeps a claim verified only when it cites a real verified fact", () => {
    const r = parseReview(raw, ["factual"], ["founded_year"]);
    expect(r.claims.map((c) => c.status)).toEqual(["verified", "needs_review", "unsupported"]);
    expect(r.claims[1]!.factKeys).toEqual([]);
  });
  it("drops assessments for dimensions the user did not request", () => {
    expect(parseReview(raw, ["factual"], []).assessments.map((a) => a.dimension)).toEqual(["factual"]);
  });
  it("applies a suggestion only to a unique exact passage", () => {
    expect(applySuggestion("fix teh text", { find: "teh", replace: "the" })).toBe("fix the text");
    expect(applySuggestion("teh and teh", { find: "teh", replace: "the" })).toBeNull();
    expect(applySuggestion("nothing", { find: "teh", replace: "the" })).toBeNull();
  });
  it("rejects malformed output", () => {
    expect(() => parseReview("not json", ["factual"], [])).toThrow();
  });
});
