import { describe, expect, it } from "vitest";
import { FALLBACK_GROUP, NAVIGATION } from "@/lib/navigation";

// Information architecture rules from the UX workstream: destinations follow the growth journey, no destination
// carries so many tabs that they stop fitting, and every page is reachable from exactly one place.
describe("navigation", () => {
  it("orders destinations along the growth journey", () => {
    expect(NAVIGATION.map((g) => g.group)).toEqual([
      "Home",
      "AI team",
      "Business",
      "Plan",
      "Execution",
      "Results",
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

  it("keeps approvals on Home, where pending decisions are announced", () => {
    const home = NAVIGATION.find((g) => g.group === "Home");
    expect(home?.items.map((i) => i.to)).toContain("/app/approvals");
  });

  it("falls back to an existing destination", () => {
    expect(NAVIGATION.some((g) => g.group === FALLBACK_GROUP)).toBe(true);
  });
});
