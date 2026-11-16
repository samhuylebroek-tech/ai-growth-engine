import { describe, expect, it } from "vitest";
import { changeObservations, pageObservations, pickPages, readCompetitorPage, competitorBriefText } from "@/lib/competitor-intel";

const html = `<html><head><title>Best Bakery Ghent</title><meta name="description" content="Fresh bread daily"></head><body><h1>Bread since 1950</h1><h2>Sourdough</h2><h2>Cakes</h2><a href="/over-ons">About</a><a href="/blog/x">Blog</a><a href="https://other.com/services">x</a></body></html>`;
describe("competitor intel", () => {
  it("reads facts from the page with source URL", () => {
    const p = readCompetitorPage(html, "https://bake.be/");
    const o = pageObservations(p);
    expect(o.every(x => x.kind === "verified_fact" && x.source_url === "https://bake.be/")).toBe(true);
    expect(o.find(x => x.category === "positioning")?.statement).toContain("Best Bakery Ghent");
  });
  it("only follows interesting same-site pages", () => {
    expect(pickPages(readCompetitorPage(html, "https://bake.be/").links, "https://bake.be/")).toEqual(["https://bake.be/over-ons"]);
  });
  it("records changes instead of overwriting", () => {
    const a = readCompetitorPage(html, "https://bake.be/"); const b = { ...a, title: "Best Bakery Belgium", h2: [...a.h2, "Catering"] };
    const c = changeObservations([a], [b]).map(x => x.statement);
    expect(c.some(s => s.includes("Best Bakery Ghent") && s.includes("Best Bakery Belgium"))).toBe(true);
    expect(c.some(s => s.includes("Catering"))).toBe(true);
    expect(changeObservations([a], [a])).toEqual([]);
  });
  it("brief tells the writer not to copy", () => {
    expect(competitorBriefText("X", [{ statement: "s", source_url: "u" }])).toMatch(/Do not copy/);
  });
});
