import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { growthSummaryOptions } from "@/lib/growth-summary";

describe("Growth summary cache compatibility", () => {
  it("does not serve the old overview shape to the remade pages", () => {
    const client = new QueryClient();
    const legacy = { balance: 191, bp: null, docs: [], facts: [], runs: [], approvals: [] };
    client.setQueryData(["overview", "org-a", "workspace-a"], legacy);
    const options = growthSummaryOptions("org-a", "workspace-a", "owner");
    expect(client.getQueryData(options.queryKey)).toBeUndefined();
    expect(client.getQueryData(["overview", "org-a", "workspace-a"])).toEqual(legacy);
  });

  it("keeps the new summary isolated by organization and workspace", () => {
    const client = new QueryClient();
    const options = growthSummaryOptions("org-a", "workspace-a", "owner");
    client.setQueryData(options.queryKey, {
      profile: null,
      documents: [],
      facts: [],
      runs: [],
      approvals: [],
    });
    expect(
      client.getQueryData(growthSummaryOptions("org-a", "workspace-b", "owner").queryKey),
    ).toBeUndefined();
    expect(
      client.getQueryData(growthSummaryOptions("org-b", "workspace-a", "owner").queryKey),
    ).toBeUndefined();
  });

  it("retains overview-prefix invalidation after credit and approval changes", async () => {
    const client = new QueryClient();
    const options = growthSummaryOptions("org-a", "workspace-a", "owner");
    client.setQueryData(options.queryKey, { documents: [] });
    await client.invalidateQueries({ queryKey: ["overview"] });
    expect(client.getQueryState(options.queryKey)?.isInvalidated).toBe(true);
  });
});
