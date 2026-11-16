import { describe, it, expect } from "vitest";
import { parseStrategy } from "@/lib/growth-strategy";
import { parseRepurpose } from "@/lib/content-repurpose";
import { reallocationProposals } from "@/lib/growth-plan";

const base = { summary: "s", kpis: [], risks: [], assumptions: [] };
describe("growth strategy", () => {
  it("normalises channel shares above 100% and sorts actions by week", () => {
    const s = parseStrategy("```json\n" + JSON.stringify({ ...base, channels: [{ name: "SEO", why: "w", share: 90 }, { name: "Email", why: "w", share: 30 }], actions: [{ title: "b", week: 3, effort: "low" }, { title: "a", week: 1, effort: "high" }] }) + "\n```");
    expect(s.channels.map((c) => c.share)).toEqual([75, 25]);
    expect(s.actions.map((a) => a.title)).toEqual(["a", "b"]);
  });
  it("rejects a plan without actions", () => {
    expect(() => parseStrategy(JSON.stringify({ ...base, channels: [], actions: [] }))).toThrow();
  });
});
describe("repurpose", () => {
  it("keeps only requested channels in requested order", () => {
    const r = parseRepurpose(JSON.stringify({ items: [{ channel: "email", title: "E", body: "e" }, { channel: "ad", title: "A", body: "a" }, { channel: "linkedin", title: "L", body: "l" }] }), ["linkedin", "email"]);
    expect(r.map((i) => i.channel)).toEqual(["linkedin", "email"]);
  });
});
describe("budget reallocation", () => {
  const lines = [{ id: "a", channel: "Meta", planned: 400, actual: 100, hard_cap: null }, { id: "b", channel: "Google", planned: 300, actual: 380, hard_cap: 350 }];
  it("proposes nothing in the first half of the month", () => { expect(reallocationProposals(lines, 0.4)).toEqual([]); });
  it("moves at most half the unused budget and never beyond the receiving hard cap", () => {
    const p = reallocationProposals(lines, 0.6);
    expect(p).toHaveLength(1); expect(p[0]!.amount).toBe(50); expect(p[0]!.fromId).toBe("a"); expect(p[0]!.toId).toBe("b");
  });
  it("skips a receiving line already at its hard cap", () => {
    expect(reallocationProposals([lines[0]!, { ...lines[1]!, planned: 350 }], 0.9)).toEqual([]);
  });
});
