import { describe, expect, it } from "vitest";
import { draftExecutionPlan } from "@/lib/execution";
import { claimCounts, markClaims, readMarker, stripClaimTags, tagLines } from "@/lib/claims";

const answer = `## What I found
- [fact] You recorded 120 leads last month (source: performance, Oct 2026).
- [calc] Lead-to-customer conversion was 8% (formula: 10 customers ÷ 120 leads, Oct 2026).
- [hypothesis] The lower conversion may be related to slow follow-up.
- [recommendation] Review the time between an enquiry and the first contact.
- [missing] Response-time data is not available yet.
\`\`\`proposals
[{"title":"[fact] not a label inside code"}]
\`\`\``;

describe("claim labels", () => {
  it("labels each statement with its own kind", () => {
    expect(tagLines(answer).map((l) => l.kind)).toEqual([null, "fact", "calc", "hypothesis", "recommendation", "missing", null, null, null]);
    expect(claimCounts(answer)).toMatchObject({ fact: 1, calc: 1, hypothesis: 1, recommendation: 1, missing: 1, estimate: 0 });
  });
  it("shows a 'fact' worded as uncertain as a hypothesis, in English, Dutch and French", () => {
    for (const s of ["- [fact] Sales probably dropped in May.", "- [fact] De omzet is waarschijnlijk gedaald.", "- [fact] Les ventes ont peut-être baissé."]) {
      const [l] = tagLines(s);
      expect(l).toMatchObject({ kind: "hypothesis", downgraded: true });
    }
  });
  it("does not mistake the month May for uncertainty", () => {
    expect(tagLines("- [fact] You recorded 40 leads in May (source: performance).")[0]).toMatchObject({ kind: "fact", downgraded: false });
  });
  it("never upgrades untagged text to a fact", () => {
    expect(tagLines("Revenue grew 20%.")[0]?.kind).toBeNull();
  });
  it("keeps list structure and leaves code blocks untouched", () => {
    const m = markClaims(answer);
    expect(m).toContain("- `⟦fact⟧` You recorded 120 leads");
    expect(m).toContain('[{"title":"[fact] not a label inside code"}]');
    expect(readMarker("⟦hypothesis!⟧")).toEqual({ kind: "hypothesis", downgraded: true });
    expect(readMarker("plain code")).toBeNull();
  });
  it("accepts bold or capitalised tags and 'calculation'", () => {
    expect(tagLines("1. **[Calculation]** 8%")[0]?.kind).toBe("calc");
  });
  it("removes tags for task titles and exports", () => {
    expect(stripClaimTags("- [recommendation] Call back within a day")).toBe("- Call back within a day");
  });
  it("keeps labels out of task titles drafted from an answer", () => {
    const plan = draftExecutionPlan("Plan\n- [recommendation] Call every enquiry back within a day\n- **[missing]** Measure response time");
    expect(plan.tasks.map((x) => x.title)).toEqual(["Call every enquiry back within a day", "Measure response time"]);
  });
});
