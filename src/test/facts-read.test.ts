import { describe, expect, it } from "vitest";
import { readFactPages } from "@/lib/facts-read";

const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i).padStart(6, "0") }));
const source = (all: { id: string }[], cap = 1000) => async (cursor: string | undefined, size: number) => ({
  data: all.filter((r) => cursor === undefined || r.id > cursor).slice(0, Math.min(size, cap)),
  error: null,
});

describe("complete business fact reads", () => {
  it("reads past the old 200-fact limit, also when the server returns smaller pages", async () => {
    const r = await readFactPages(source(ids(1234), 100));
    expect(r.rows).toHaveLength(1234);
    expect(r.complete).toBe(true);
  });
  it("says the read is incomplete when the ceiling is reached", async () => {
    const r = await readFactPages(source(ids(30)), 25, 10);
    expect(r.rows).toHaveLength(25);
    expect(r.complete).toBe(false);
  });
  it("is complete when the ceiling is exactly the number of facts", async () => {
    const r = await readFactPages(source(ids(25)), 25, 10);
    expect(r.complete).toBe(true);
  });
  it("fails on a read error or a cursor that does not advance", async () => {
    await expect(readFactPages(async () => ({ data: null, error: new Error("denied") }))).rejects.toThrow("denied");
    await expect(readFactPages(async () => ({ data: [{ id: "a" }], error: null }))).rejects.toThrow("Non-advancing");
  });
});
