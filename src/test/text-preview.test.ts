import { describe, expect, it } from "vitest";
import { plainPreview } from "@/lib/text-preview";

describe("plainPreview", () => {
  it("drops headings, statement tags and source notes from a stored AI answer", () => {
    const answer =
      "## Wat er gebeurt\n\n[recommendation] Geef ‘QA office breakfast boxes’ deze week de meeste aandacht. (source: #C-5ceb24e7; BLOCKED WORK)\n\n### Bewijs\n- [fact] Er is EUR 300 gepland.";
    expect(plainPreview(answer)).toBe(
      "Geef ‘QA office breakfast boxes’ deze week de meeste aandacht. Er is EUR 300 gepland.",
    );
  });

  it("keeps link text and removes emphasis markers", () => {
    expect(plainPreview("**Open** the [campaign](/app/campaigns) now")).toBe(
      "Open the campaign now",
    );
  });

  it("shortens long text with an ellipsis", () => {
    const out = plainPreview("a ".repeat(400), 20);
    expect(out.length).toBe(20);
    expect(out.endsWith("…")).toBe(true);
  });

  it("leaves ordinary text unchanged", () => {
    expect(plainPreview("Business document")).toBe("Business document");
  });
});
