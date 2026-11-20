import { describe, expect, it } from "vitest";
import { mergeActivity, readableRunSummary } from "@/lib/command-center";

describe("AI run summaries on screen", () => {
  it("keeps a plain-language summary as it is", () => {
    expect(readableRunSummary("Website reviewed")).toBe("Website reviewed");
  });
  it("shows the summary field of a complete JSON answer", () => {
    expect(readableRunSummary('{"summary":"12-week plan","items":[1]}')).toBe("12-week plan");
  });
  it("reads the summary field of a cut-off JSON answer and marks it unfinished", () => {
    expect(readableRunSummary('{ "summary": "Proposed 12-week plan to pursue')).toBe("Proposed 12-week plan to pursue…");
  });
  it("shows nothing for raw JSON without a summary, so the fallback label is used", () => {
    expect(readableRunSummary('{ "opportunities": [ { "title": "x"')).toBeNull();
    expect(readableRunSummary("[1,2]")).toBeNull();
    const run = { id: "r1", agent_key: "marketing_strategy", status: "succeeded", summary: '{ "opportunities": [', error: null, created_at: "2026-11-14T10:00:00Z", finished_at: null };
    expect(mergeActivity([run], [], [])[0]?.detail).toBe("AI assignment");
  });
});
