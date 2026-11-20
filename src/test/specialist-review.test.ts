import { describe, expect, it } from "vitest";
import { figuresToVerify, parseReview, reviewRequired, scoreReview, suggestReviewer } from "@/lib/specialist-review";
import { SPECIALIST_KEYS } from "@/lib/task-execution";

const dims = (...s: (number | null)[]) => Object.fromEntries(["completeness", "relevance", "evidence", "calculations", "consistency", "feasibility", "permissions"].slice(0, s.length).map((k, i) => [k, { score: s[i] ?? null, note: "" }]));

describe("second review score (mirrors the database)", () => {
  it("maps the average 1..5 to 0..100 and ignores dimensions that do not apply", () => {
    const r = scoreReview({ dimensions: dims(4, 4, 3, 5, 4, 4, null), findings: [{ dimension: "evidence", severity: "warning", finding: "f", correction: "" }] });
    expect(r).toEqual({ assessed: 6, score: 75, critical: 0, verdict: "acceptable", independenceWarning: false });
  });
  it("flags a top score without any findings as possibly uncritical", () => {
    const r = scoreReview({ dimensions: dims(5, 5, 5, 5, 5, 5), findings: [] });
    expect(r.independenceWarning).toBe(true);
    expect(r.verdict).toBe("needs_changes");
  });
  it("two critical findings make a result unreliable, one asks for changes", () => {
    const crit = { dimension: "calculations", severity: "critical" as const, finding: "wrong", correction: "" };
    expect(scoreReview({ dimensions: dims(4, 4, 4, 4, 4, 4), findings: [crit, crit] }).verdict).toBe("unreliable");
    expect(scoreReview({ dimensions: dims(4, 4, 4, 4, 4, 4), findings: [crit] }).verdict).toBe("needs_changes");
  });
});

describe("parsing a review", () => {
  it("refuses a review that assessed fewer than six dimensions", () => {
    expect(() => parseReview(JSON.stringify({ dimensions: dims(4, 4, null, null, null, null) }))).toThrow();
  });
  it("drops unknown dimensions and clamps scores", () => {
    const r = parseReview(JSON.stringify({ dimensions: { ...dims(9, 0, 3, 3, 3, 3), vibes: { score: 5 } }, findings: [{ severity: "fatal", finding: "x" }] }));
    expect(Object.keys(r.dimensions)).not.toContain("vibes");
    expect(r.dimensions.completeness?.score).toBe(5);
    expect(r.dimensions.relevance?.score).toBe(1);
    expect(r.findings[0]?.severity).toBe("warning");
  });
});

describe("which results need a second review", () => {
  it("high or urgent tasks, revenue and advertising specialists, and results with external actions", () => {
    expect(reviewRequired({ priority: "medium", specialist: "content", externalActions: 0 })).toBe(false);
    expect(reviewRequired({ priority: "high", specialist: "content", externalActions: 0 })).toBe(true);
    expect(reviewRequired({ priority: "low", specialist: "revenue_analyst", externalActions: 0 })).toBe(true);
    expect(reviewRequired({ priority: "low", specialist: "seo", externalActions: 1 })).toBe(true);
  });
  it("always suggests a reviewer with a different expertise", () => {
    for (const k of SPECIALIST_KEYS) expect(suggestReviewer(k)).not.toBe(k);
  });
  it("counts figures that need a source", () => {
    expect(figuresToVerify("Margin 34% on €1.200 and 15 EUR per order; 3 steps")).toBe(3);
  });
});
