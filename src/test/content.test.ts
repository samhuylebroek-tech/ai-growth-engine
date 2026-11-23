import { describe, expect, it } from "vitest";
import { diffLines, versionApproved } from "@/lib/content";
describe("content studio", () => {
  it("diffs changed lines", () => {
    expect(diffLines("a\nb\nc", "a\nx\nc")).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "x" },
      { kind: "same", text: "c" },
    ]);
  });
  it("approval of one version does not approve another", () => {
    const d = [{ version_id: "v1", decision: "approved" }];
    expect(versionApproved("v1", d)).toBe(true);
    expect(versionApproved("v2", d)).toBe(false);
    expect(versionApproved("v1", [{ version_id: "v1", decision: "rejected" }])).toBe(false);
  });
});
