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
  it("never proposes moving money between lines in different currencies", () => {
    const l = [{ id: "a", channel: "Search", planned: 1000, actual: 100, hard_cap: null, currency: "EUR" }, { id: "b", channel: "Social", planned: 200, actual: 400, hard_cap: null, currency: "USD" }];
    expect(reallocationProposals(l, 0.8)).toEqual([]);
    expect(reallocationProposals([l[0]!, { ...l[1]!, currency: "EUR" }], 0.8)).toHaveLength(1);
  });
  it("proposes nothing in the first half of the month", () => { expect(reallocationProposals(lines, 0.4)).toEqual([]); });
  it("moves at most half the unused budget and never beyond the receiving hard cap", () => {
    const p = reallocationProposals(lines, 0.6);
    expect(p).toHaveLength(1); expect(p[0]!.amount).toBe(50); expect(p[0]!.fromId).toBe("a"); expect(p[0]!.toId).toBe("b");
  });
  it("skips a receiving line already at its hard cap", () => {
    expect(reallocationProposals([lines[0]!, { ...lines[1]!, planned: 350 }], 0.9)).toEqual([]);
  });
});
describe("growth strategy details", () => {
  const step = (title: string, week: number, extra: Record<string, unknown> = {}) => ({ title, week, effort: "medium", ...extra });
  it("still reads strategies saved before the detailed format, with empty details", () => {
    const s = parseStrategy(JSON.stringify({ ...base, channels: [], actions: [step("a", 1)] }));
    expect(s.audience).toBe(""); expect(s.budget).toBeNull(); expect(s.dependencies).toEqual([]);
    expect(s.evidence).toEqual({ facts: [], estimates: [], hypotheses: [] });
    expect(s.actions[0]).toMatchObject({ kind: "task", specialist: "", budget: null, integrations: [], dependsOn: [], needsApproval: false });
  });
  it("drops specialists that are not registered and unknown step kinds", () => {
    const s = parseStrategy(JSON.stringify({ ...base, channels: [], actions: [step("a", 1, { specialist: "hacker", kind: "launch" }), step("b", 2, { specialist: "seo", kind: "campaign" })] }));
    expect(s.actions.map((a) => [a.specialist, a.kind])).toEqual([["", "task"], ["seo", "campaign"]]);
  });
  it("renumbers dependencies after ordering by week and removes forward or self references", () => {
    const s = parseStrategy(JSON.stringify({ ...base, channels: [], actions: [step("late", 3, { dependsOn: [3, 1] }), step("early", 1, { dependsOn: [1] }), step("mid", 2, { dependsOn: [2, 9] })] }));
    expect(s.actions.map((a) => a.title)).toEqual(["early", "mid", "late"]);
    expect(s.actions.map((a) => a.dependsOn)).toEqual([[], [1], [2]]);
  });
  it("keeps facts, estimates and hypotheses apart", () => {
    const s = parseStrategy(JSON.stringify({ ...base, channels: [], actions: [step("a", 1)], evidence: { facts: ["Open since 2019"], estimates: ["~20 leads/month"], hypotheses: ["Parents prefer weekend slots"] } }));
    expect(s.evidence.facts).toEqual(["Open since 2019"]); expect(s.evidence.estimates).toEqual(["~20 leads/month"]); expect(s.evidence.hypotheses).toEqual(["Parents prefer weekend slots"]);
  });
});
