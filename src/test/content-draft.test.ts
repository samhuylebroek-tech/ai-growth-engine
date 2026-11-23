import { describe, it, expect } from "vitest";
import { writingProfileContext, draftBriefSchema } from "@/lib/content-draft";

const base = {
  name: "Brand",
  tone: "warm",
  style: "short",
  audience: "owners",
  channels: ["blog"],
  examples: "SECRET EXAMPLE",
};
describe("content drafting", () => {
  it("never includes unauthorized writing examples", () => {
    expect(writingProfileContext({ ...base, examples_authorized: false })).not.toContain(
      "SECRET EXAMPLE",
    );
  });
  it("includes authorized examples as quoted data", () => {
    expect(writingProfileContext({ ...base, examples_authorized: true })).toContain(
      '<untrusted source="authorized writing examples">',
    );
  });
  it("requires an objective", () => {
    expect(draftBriefSchema.safeParse({ contentType: "Blog article", objective: "" }).success).toBe(
      false,
    );
  });
});
