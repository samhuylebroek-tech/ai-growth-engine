import { describe, it, expect } from "vitest";
import { contentReviewState } from "@/lib/content-review-state";
describe("campaign content exact-version review", () => {
  it("does not inherit approval when a draft body changes", () => {
    expect(
      contentReviewState(
        { title: "Offer", draft_body: "New promise" },
        { title: "Offer", body: "Reviewed wording" },
        "approved",
      ),
    ).toBe("draft");
  });
  it("does not inherit approval when a draft title changes", () => {
    expect(
      contentReviewState(
        { title: "New title", draft_body: "Body" },
        { title: "Offer", body: "Body" },
        "approved",
      ),
    ).toBe("draft");
  });
  it("keeps the exact decision on unchanged recorded material", () => {
    const draft = { title: "Offer", draft_body: "Body" },
      version = { title: "Offer", body: "Body" };
    expect(contentReviewState(draft, version, "approved")).toBe("approved");
    expect(contentReviewState(draft, version, "rejected")).toBe("rejected");
    expect(contentReviewState(draft, version, null)).toBe("awaiting");
    expect(contentReviewState(draft, null, "approved")).toBe("draft");
  });
});
