import { describe, expect, it } from "vitest";
import { FALLBACK_GROUP, NAVIGATION } from "@/lib/navigation";

// Information architecture rules from the UX workstream: destinations follow the growth journey, no destination
// carries so many tabs that they stop fitting, and every page is reachable from exactly one place.
describe("navigation", () => {
  it("orders destinations along the growth journey", () => {
    expect(NAVIGATION.map((g) => g.group)).toEqual([
      "Campaigns",
      "Plan",
      "AI team",
      "Execution",
      "Results",
      "Business",
      "Organization",
    ]);
  });

  it("keeps every destination to seven tabs or fewer", () => {
    for (const g of NAVIGATION) expect(g.items.length, g.group).toBeLessThanOrEqual(7);
  });

  it("lists every page exactly once", () => {
    const all = NAVIGATION.flatMap((g) => g.items.map((i) => i.to));
    expect(new Set(all).size).toBe(all.length);
  });

  it("puts the AI specialists next to the Growth Officer", () => {
    const team = NAVIGATION.find((g) => g.group === "AI team");
    expect(team?.items.map((i) => i.to)).toEqual(["/app/growth-officer", "/app/agents"]);
  });

  it("keeps approvals with execution and makes campaigns the first destination", () => {
    const execution = NAVIGATION.find((g) => g.group === "Execution");
    expect(execution?.items.map((i) => i.to)).toContain("/app/approvals");
    expect(NAVIGATION[0].items[0].to).toBe("/app");
    expect(NAVIGATION[0].items.map((i) => i.to)).toContain("/app/campaigns");
    expect(NAVIGATION.flatMap((g) => g.items.map((i) => i.to))).toContain("/app/overview");
  });

  it("falls back to an existing destination", () => {
    expect(NAVIGATION.some((g) => g.group === FALLBACK_GROUP)).toBe(true);
  });
});
