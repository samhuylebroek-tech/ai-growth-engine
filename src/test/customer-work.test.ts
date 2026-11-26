import { describe, it, expect } from "vitest";
import {
  customerPurpose,
  customerTaskState,
  customerWorkSchema,
  customerWorkLabels,
  customerInputLabel,
} from "@/lib/customer-work";
const input = {
  orgId: "b0000000-0000-0000-0000-000000000001",
  workspaceId: "b0000000-0000-0000-0000-000000000002",
  dealId: "b0000000-0000-0000-0000-000000000003",
  requestId: "b0000000-0000-0000-0000-000000000004",
  purpose: "retention" as const,
  title: "Check delivery and consent",
  description: "Review recorded sale",
  due: "2026-12-01",
};
describe("customer-care preparation rules", () => {
  it("selects retention only for a recorded won sale", () => {
    expect(customerPurpose("won")).toBe("retention");
    expect(customerPurpose("proposal")).toBe("followup");
  });
  it("selects reactivation only for a recorded lost sale", () => {
    expect(customerPurpose("lost")).toBe("reactivation");
    expect(customerPurpose("qualified")).toBe("followup");
  });
  it("never upgrades prepared or team-completed work into delivered customer outcomes", () => {
    expect(customerTaskState("todo", null, "2026-11-26")).toBe("prepared");
    expect(customerTaskState("done", "2026-11-20", "2026-11-26")).toBe("recorded_done");
  });
  it("flags overdue open work but not cancelled work", () => {
    expect(customerTaskState("in_progress", "2026-11-25", "2026-11-26")).toBe("overdue");
    expect(customerTaskState("cancelled", "2026-11-25", "2026-11-26")).toBe("cancelled");
  });
  it("binds retry identity to the complete draft including scope and description", async () => {
    const label = await customerInputLabel(input);
    expect(await customerInputLabel({ ...input })).toBe(label);
    expect(await customerInputLabel({ ...input, description: "Changed" })).not.toBe(label);
    expect(await customerInputLabel({ ...input, workspaceId: input.orgId })).not.toBe(label);
  });
  it("rejects impossible dates and preserves explicit source labels", () => {
    expect(customerWorkSchema.safeParse({ ...input, due: "2026-02-30" }).success).toBe(false);
    expect(customerWorkLabels(input.dealId, "retention")).toEqual([
      "customer-work",
      `crm-deal:${input.dealId}`,
      "customer-purpose:retention",
    ]);
  });
});
