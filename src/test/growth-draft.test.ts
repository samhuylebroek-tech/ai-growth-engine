import { describe, expect, it } from "vitest";
import { consumeGrowthDraft, growthDraftKey } from "@/lib/growth-draft";

describe("Workspace question handoff", () => {
  it("does not consume another workspace's question", () => {
    const drafts = new Map([[growthDraftKey("organization-a", "workspace-a"), "Analyze my growth opportunities"]]);
    const storage = { getItem: (key: string) => drafts.get(key) ?? null, removeItem: (key: string) => { drafts.delete(key); } };
    expect(consumeGrowthDraft(storage, "organization-a", "workspace-b")).toBe("");
    expect(drafts.get(growthDraftKey("organization-a", "workspace-a"))).toBe("Analyze my growth opportunities");
  });
  it("does not consume another organization's question", () => {
    const drafts = new Map([[growthDraftKey("organization-a", "workspace-a"), "Create my action plan"]]);
    const storage = { getItem: (key: string) => drafts.get(key) ?? null, removeItem: (key: string) => { drafts.delete(key); } };
    expect(consumeGrowthDraft(storage, "organization-b", "workspace-a")).toBe("");
    expect(drafts.size).toBe(1);
  });
  it("returns the matching question exactly once", () => {
    const drafts = new Map([[growthDraftKey("organization-a", "workspace-a"), "Create my action plan"]]);
    const storage = { getItem: (key: string) => drafts.get(key) ?? null, removeItem: (key: string) => { drafts.delete(key); } };
    expect(consumeGrowthDraft(storage, "organization-a", "workspace-a")).toBe("Create my action plan");
    expect(consumeGrowthDraft(storage, "organization-a", "workspace-a")).toBe("");
  });
});