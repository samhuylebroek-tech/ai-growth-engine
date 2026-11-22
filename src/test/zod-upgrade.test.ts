import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { z } from "zod";

// Zod 4 upgrade (advisory GHSA-mrhx-c7xc-m3w5: memory exhaustion on oversized constrained collections, fixed in 4.6.6).
describe("validation library", () => {
  it("is at least the fixed version", () => {
    const v = JSON.parse(readFileSync("node_modules/zod/package.json", "utf8")).version as string;
    const [major, minor, patch] = v.split(".").map(Number) as [number, number, number];
    expect(major * 1e6 + minor * 1e3 + patch).toBeGreaterThanOrEqual(4_006_006);
  });
  it("still accepts identifiers the database derives from md5 (not RFC variant bits)", () => {
    const h = createHash("md5").update("campaign-task").digest("hex");
    const key = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    expect(z.guid().safeParse(key).success).toBe(true);
    expect(z.guid().safeParse("not-an-id").success).toBe(false);
  });
  it("refuses an oversized list against its limit", () => {
    const r = z.array(z.string()).max(7).safeParse(Array.from({ length: 100_000 }, () => "x"));
    expect(r.success).toBe(false);
  });
  it("no validator uses the strict UUID check that would refuse those identifiers", () => {
    const hits = execSync("grep -rlE 'z\\.string\\(\\)\\.uuid\\(\\)|z\\.uuid\\(\\)' src scripts || true", { encoding: "utf8" }).trim();
    expect(hits.split("\n").filter((f) => f && !f.endsWith("zod-upgrade.test.ts"))).toEqual([]);
  });
});
