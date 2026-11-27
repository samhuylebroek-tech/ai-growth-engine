import { describe, expect, it } from "vitest";
import {
  consumeGrowthDraft,
  growthDraftKey,
  storeGrowthContext,
  consumeGrowthContext,
} from "@/lib/growth-draft";

describe("Workspace question handoff", () => {
  it("does not consume another workspace's question", () => {
    const drafts = new Map([
      [growthDraftKey("organization-a", "workspace-a"), "Analyze my growth opportunities"],
    ]);
    const storage = {
      getItem: (key: string) => drafts.get(key) ?? null,
      removeItem: (key: string) => {
        drafts.delete(key);
      },
    };
    expect(consumeGrowthDraft(storage, "organization-a", "workspace-b")).toBe("");
    expect(drafts.get(growthDraftKey("organization-a", "workspace-a"))).toBe(
      "Analyze my growth opportunities",
    );
  });
  it("does not consume another organization's question", () => {
    const drafts = new Map([
      [growthDraftKey("organization-a", "workspace-a"), "Create my action plan"],
    ]);
    const storage = {
      getItem: (key: string) => drafts.get(key) ?? null,
      removeItem: (key: string) => {
        drafts.delete(key);
      },
    };
    expect(consumeGrowthDraft(storage, "organization-b", "workspace-a")).toBe("");
    expect(drafts.size).toBe(1);
  });
  it("returns the matching question exactly once", () => {
    const drafts = new Map([
      [growthDraftKey("organization-a", "workspace-a"), "Create my action plan"],
    ]);
    const storage = {
      getItem: (key: string) => drafts.get(key) ?? null,
      removeItem: (key: string) => {
        drafts.delete(key);
      },
    };
    expect(consumeGrowthDraft(storage, "organization-a", "workspace-a")).toBe(
      "Create my action plan",
    );
    expect(consumeGrowthDraft(storage, "organization-a", "workspace-a")).toBe("");
  });
});

describe("Explicit campaign question context", () => {
  const id = "a0000000-0000-4000-8000-000000000001";
  const makeStorage = () => {
    const rows = new Map<string, string>();
    return {
      rows,
      getItem: (key: string) => rows.get(key) ?? null,
      setItem: (key: string, value: string) => {
        rows.set(key, value);
      },
      removeItem: (key: string) => {
        rows.delete(key);
      },
    };
  };
  it("consumes explicitly selected references only once in their organization and business", () => {
    const s = makeStorage();
    storeGrowthContext(s, "org-a", "business-a", [{ kind: "campaigns", id }], "Question A");
    expect(consumeGrowthContext(s, "org-b", "business-a", "Question A")).toEqual([]);
    expect(consumeGrowthContext(s, "org-a", "business-b", "Question A")).toEqual([]);
    expect(consumeGrowthContext(s, "org-a", "business-a", "Question A")).toEqual([
      { kind: "campaigns", id },
    ]);
    expect(consumeGrowthContext(s, "org-a", "business-a", "Question A")).toEqual([]);
  });
  it("refuses stale context when another entry point replaced the question", () => {
    const s = makeStorage();
    storeGrowthContext(s, "org-a", "business-a", [{ kind: "campaigns", id }], "Question A");
    expect(consumeGrowthContext(s, "org-a", "business-a", "Question B")).toEqual([]);
    expect(s.rows.size).toBe(0);
  });
  it("rejects malformed, duplicate and excessive references instead of sending them", () => {
    const s = makeStorage();
    storeGrowthContext(
      s,
      "org-a",
      "business-a",
      [{ kind: "campaigns", id: "not-a-guid" }],
      "Question A",
    );
    expect(s.rows.size).toBe(0);
    storeGrowthContext(
      s,
      "org-a",
      "business-a",
      [
        { kind: "campaigns", id },
        { kind: "campaigns", id },
      ],
      "Question A",
    );
    expect(s.rows.size).toBe(0);
    storeGrowthContext(
      s,
      "org-a",
      "business-a",
      Array.from({ length: 13 }, (_, n) => ({
        kind: "campaigns",
        id: `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      })),
      "Question A",
    );
    expect(s.rows.size).toBe(0);
    s.setItem(`${growthDraftKey("org-a", "business-a")}.records`, "broken JSON");
    expect(consumeGrowthContext(s, "org-a", "business-a", "Question A")).toEqual([]);
  });
});
