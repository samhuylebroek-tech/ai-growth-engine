import { describe, expect, it } from "vitest";
import { answerLayout } from "@/lib/answer-layout";
import { markClaims } from "@/lib/claims";

const answer = markClaims(`I read this as: why did leads drop?

## What is happening
[fact] Leads fell from 40 to 22 (source: #K-1a2b3c4d, 2026-10).

## What the evidence shows
[calc] Conversion is 8% (formula: 22 ÷ 275).

## Likely cause
[hypothesis] The paused campaign.

## What to do next
- [recommendation] Restart the campaign.
- [recommendation] Fix the form.

\`\`\`
## not a heading inside a code block
\`\`\`

## How we will measure success
[recommendation] Track weekly leads.
[fact] Baseline is 22 (source: #K-1a2b3c4d).
[fact] Target is 40 (source: #G-1a2b3c4d).`);

describe("answerLayout", () => {
  it("puts the first section and action sections first, keeps the rest in order", () => {
    const l = answerLayout(answer);
    expect(l).not.toBeNull();
    expect(l?.lead).toContain("I read this as");
    expect(l?.lead).toContain("## What is happening");
    expect(l?.lead).toContain("## What to do next");
    expect(l?.lead.indexOf("What is happening")).toBeLessThan(
      l?.lead.indexOf("What to do next") ?? -1,
    );
    expect(l?.support.map((s) => s.heading)).toEqual([
      "What the evidence shows",
      "Likely cause",
      "How we will measure success",
    ]);
  });

  it("keeps statement numbers so each label still opens its own evidence", () => {
    const l = answerLayout(answer);
    expect(l?.lead).toContain("⟦recommendation:3⟧");
    expect(l?.support[0]?.body).toContain("⟦calc:1⟧");
  });

  it("does not split at headings inside code blocks", () => {
    const l = answerLayout(answer);
    expect(l?.lead).toContain("## not a heading inside a code block");
  });

  it("leaves short answers whole", () => {
    expect(answerLayout(markClaims("[fact] Two leads (source: x)."))).toBeNull();
    expect(answerLayout(markClaims("## A\n[fact] x\n## B\n[calc] y"))).toBeNull();
  });
});
