import { describe, expect, it } from "vitest";
import { collectPages, pageSlice } from "@/lib/pagination";
describe("complete keyset work traversal", () => {
  const rows = Array.from({ length: 3507 }, (_, i) => ({
    id: String(i).padStart(8, "0"),
    status: i % 2 ? "done" : "todo",
  }));
  it("reads more than 1000 records without missing or duplicate IDs", async () => {
    const result = await collectPages(async (cursor, size) => ({
      data: rows.filter((r) => !cursor || r.id > cursor).slice(0, size),
      error: null,
    }));
    expect(result).toEqual(rows);
    expect(new Set(result.map((r) => r.id)).size).toBe(3507);
  });
  it("keeps fetching when provider silently caps pages below requested size", async () => {
    const result = await collectPages(async (cursor) => ({
      data: rows.filter((r) => !cursor || r.id > cursor).slice(0, 100),
      error: null,
    }));
    expect(result.length).toBe(3507);
  });
  it("fails closed when a later page errors", async () => {
    await expect(
      collectPages(async (cursor) => ({
        data: cursor ? null : rows.slice(0, 500),
        error: cursor ? new Error("revoked") : null,
      })),
    ).rejects.toThrow("revoked");
  });
  it("rejects nonadvancing or duplicate cursors", async () => {
    await expect(
      collectPages(async () => ({ data: rows.slice(0, 2), error: null })),
    ).rejects.toThrow("Non-advancing");
  });
  it("filters before page selection and returns the complete count", () => {
    const filtered = rows.filter((r) => r.status === "todo");
    const result = pageSlice(filtered, 36);
    expect(result.total).toBe(1754);
    expect(result.pages).toBe(36);
    expect(result.rows).toEqual(filtered.slice(1750));
  });
  it("clamps stale pages after filtering", () => {
    expect(pageSlice(rows.slice(0, 3), 40).page).toBe(1);
  });
});
