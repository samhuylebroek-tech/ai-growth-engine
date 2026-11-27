import { beforeEach, describe, it, expect, vi } from "vitest";
type Row = Record<string, unknown>;
const store = vi.hoisted(() => ({
  rows: {} as Record<string, Row[]>,
  reads: [] as { table: string; filters: [string, unknown][] }[],
  failTable: "",
}));
function from(table: string) {
  let cursor = "",
    column = "id",
    included: string[] | null = null;
  const filters: [string, unknown][] = [];
  let excluded = "";
  const query = {
    select: () => query,
    order: () => query,
    limit: () => query,
    lte: () => query,
    eq: (key: string, value: unknown) => {
      filters.push([key, value]);
      return query;
    },
    neq: (_key: string, value: string) => {
      excluded = value;
      return query;
    },
    gt: (key: string, value: string) => {
      column = key;
      cursor = value;
      return query;
    },
    in: (_key: string, values: string[]) => {
      included = values;
      return query;
    },
    maybeSingle: async () => ({ data: { paused: true, mode: 2 }, error: null }),
    then: (resolve: (value: { data: Row[] | null; error: unknown }) => unknown) => {
      store.reads.push({ table, filters });
      if (store.failTable === table && cursor)
        return Promise.resolve(resolve({ data: null, error: new Error("second page refused") }));
      const data = (store.rows[table] ?? [])
        .filter(
          (row) =>
            String(row[column] ?? row["task_id"]) > cursor &&
            (!included || included.includes(String(row["id"]))) &&
            (!excluded || row["status"] !== excluded),
        )
        .slice(0, 2);
      return Promise.resolve(resolve({ data, error: null }));
    },
  };
  return query;
}
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));
vi.mock("@/lib/pending-schema", () => ({
  growthDb: { from },
  retryUnlessNotInstalled: () => false,
}));
import { hubOptions } from "@/components/integrations/hub-data";
const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: String(i).padStart(5, "0"), title: `Test row ${i}` }));
describe("complete scoped integration reads (synthetic paginated transport)", () => {
  beforeEach(() => {
    store.rows = {};
    store.reads = [];
    store.failTable = "";
  });
  it("reads more than 500 actions and preserves all referenced finished task titles", async () => {
    store.rows["external_actions"] = rows(501).map((r) => ({
      ...r,
      task_id: r.id,
      created_at: "2026-11-26",
    }));
    store.rows["tasks"] = rows(501).map((r) => ({ ...r, status: "done" }));
    const result = await hubOptions("org-a", "ws-a").queryFn();
    expect(result.actions).toHaveLength(501);
    expect(result.tasks.size).toBe(501);
    expect(result.tasks.get("00500")?.title).toBe("Test row 500");
  });
  it("keeps organization and business predicates on every fetched page", async () => {
    store.rows["connector_connections"] = rows(205);
    const result = await hubOptions("org-a", "ws-a").queryFn();
    expect(result.connections).toHaveLength(205);
    for (const read of store.reads) {
      expect(read.filters).toContainEqual(["org_id", "org-a"]);
      expect(read.filters).toContainEqual(["workspace_id", "ws-a"]);
    }
  });
  it("rejects the complete summary when a later page fails instead of hiding approvals", async () => {
    store.rows["external_actions"] = rows(3);
    store.failTable = "external_actions";
    await expect(hubOptions("org-a", "ws-a").queryFn()).rejects.toThrow("second page refused");
  });
  it("keeps assigned specialists using the task primary key across short pages", async () => {
    store.rows["tasks"] = rows(3).map((r) => ({ ...r, status: "todo" }));
    store.rows["task_execution_profiles"] = rows(3).map((r) => ({
      task_id: r.id,
      specialist_key: "content",
    }));
    const result = await hubOptions("org-a", "ws-a").queryFn();
    expect(result.tasks.get("00002")?.specialist).toBe("content");
    expect(result.paused).toBe(true);
  });
});
