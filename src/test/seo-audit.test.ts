import { describe, expect, it } from "vitest";
import { pageFindings, parsePage, parseRobots, parseSitemap, siteFindings } from "@/lib/seo-audit";
const html = `<html><head><title>Bakery Ghent</title><meta name="description" content="Fresh"><link rel="canonical" href="https://x.be/"></head><body><h1>A</h1><h1>B</h1><a href="/menu">m</a><a href="https://o.com">o</a><a href="mailto:a@b">e</a><img src="a.png"></body></html>`;
describe("seo audit", () => {
  it("parses on-page signals", () => { const p = parsePage(html, "https://x.be/"); expect(p.title).toBe("Bakery Ghent"); expect(p.h1).toEqual(["A", "B"]); expect(p.internalLinks).toBe(1); expect(p.externalLinks).toBe(1); expect(p.links).toEqual(["https://x.be/menu"]); expect(p.imagesWithoutAlt).toBe(1); });
  it("flags noindex and missing title as high", () => { const f = pageFindings(parsePage(`<meta name="robots" content="noindex">`, "https://x.be/")); expect(f.filter(x => x.severity === "high").map(x => x.code).sort()).toEqual(["noindex", "title_missing"]); });
  it("broken page only reports broken", () => { expect(pageFindings(parsePage("", "https://x.be/a", 404)).map(x => x.code)).toEqual(["broken"]); });
  it("detects disallow-all and sitemaps in robots", () => { expect(parseRobots("User-agent: *\nDisallow: /\nSitemap: https://x.be/s.xml")).toEqual({ blocksAll: true, sitemaps: ["https://x.be/s.xml"] }); expect(parseRobots("User-agent: bot\nDisallow: /").blocksAll).toBe(false); });
  it("reads sitemap locs and duplicate titles", () => { expect(parseSitemap("<url><loc> https://x.be/a </loc></url>")).toEqual(["https://x.be/a"]); const p = parsePage(html, "https://x.be/"); const q = { ...p, url: "https://x.be/b" }; expect(siteFindings([p, q], { found: true, blocksAll: false }, { found: true, urls: 2 }, "https://x.be").some(f => f.code === "title_duplicate")).toBe(true); });
});
