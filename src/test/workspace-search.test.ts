import { expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { literalSearchPattern, searchWorkspace } from "@/lib/workspace-search";
it("treats wildcard input literally and rejects unbounded terms", () => {
  expect(literalSearchPattern("100%_\\")).toBe("%100\\%\\_\\\\%");
  expect(() => literalSearchPattern("a")).toThrow();
  expect(() => literalSearchPattern("a".repeat(101))).toThrow();
});
it("scopes every source and keeps conversations private with five matches per source", async () => {
  const calls: { kind: string; filters: Record<string, unknown>; cap: number }[] = [];
  const client = {
    from(kind: string) {
      const c = { kind, filters: {} as Record<string, unknown>, cap: 0 };
      calls.push(c);
      const q = {
        select() {
          return q;
        },
        eq(k: string, v: unknown) {
          c.filters[k] = v;
          return q;
        },
        ilike() {
          return q;
        },
        order() {
          return q;
        },
        limit(n: number) {
          c.cap = n;
          return Promise.resolve({ data: [], error: null });
        },
      };
      return q;
    },
  } as unknown as SupabaseClient<Database>;
  await searchWorkspace(client, { orgId: "org-a", workspaceId: "ws-a", userId: "user-a" }, "query");
  expect(calls).toHaveLength(6);
  for (const c of calls) {
    expect(c.filters["org_id"]).toBe("org-a");
    expect(c.filters["workspace_id"]).toBe("ws-a");
    expect(c.cap).toBe(5);
  }
  expect(calls.find((c) => c.kind === "conversations")?.filters["user_id"]).toBe("user-a");
});
