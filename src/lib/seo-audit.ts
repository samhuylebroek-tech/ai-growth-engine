// Deterministic on-page SEO checks over fetched public HTML. No AI, no estimates.
export type SeoPage = { url: string; status: number; title: string; description: string; h1: string[]; canonical: string; noindex: boolean; internalLinks: number; externalLinks: number; words: number; imagesWithoutAlt: number };
export type SeoFinding = { severity: "high" | "medium" | "low"; code: string; url: string; message: string };

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
const attr = (tag: string, name: string) => decode(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag)?.slice(2).find(x => x !== undefined) ?? "");

export function parsePage(html: string, url: string, status = 200): SeoPage & { links: string[] } {
  const base = new URL(url);
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/<[^>]+>/g, "") ?? "");
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
  const meta = (n: string) => attr(metas.find(m => attr(m, "name").toLowerCase() === n) ?? "", "content");
  const canonTag = (html.match(/<link\b[^>]*>/gi) ?? []).find(l => attr(l, "rel").toLowerCase().split(/\s+/).includes("canonical"));
  const h1 = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => decode((m[1] ?? "").replace(/<[^>]+>/g, " "))).filter(Boolean).slice(0, 10);
  const links: string[] = []; let internal = 0, external = 0;
  for (const a of html.match(/<a\b[^>]*>/gi) ?? []) {
    const href = attr(a, "href"); if (!href || /^(#|mailto:|tel:|javascript:)/i.test(href)) continue;
    try { const u = new URL(href, base); if (!/^https?:$/.test(u.protocol)) continue; u.hash = "";
      if (u.hostname === base.hostname) { internal++; links.push(u.toString()); } else external++; } catch { /* ignore malformed */ }
  }
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  const words = decode(body).split(" ").filter(w => /\p{L}/u.test(w)).length;
  const imagesWithoutAlt = (html.match(/<img\b[^>]*>/gi) ?? []).filter(i => !/\balt\s*=/i.test(i)).length;
  return { url, status, title, description: meta("description"), h1, canonical: canonTag ? attr(canonTag, "href") : "", noindex: /noindex/i.test(meta("robots")), internalLinks: internal, externalLinks: external, words, imagesWithoutAlt, links: [...new Set(links)] };
}

export function pageFindings(p: SeoPage): SeoFinding[] {
  const f: SeoFinding[] = []; const add = (severity: SeoFinding["severity"], code: string, message: string) => f.push({ severity, code, url: p.url, message });
  if (p.status >= 400) { add("high", "broken", `Page responds with status ${p.status}.`); return f; }
  if (p.noindex) add("high", "noindex", "Page asks search engines not to index it.");
  if (!p.title) add("high", "title_missing", "Page has no title.");
  else if (p.title.length > 60) add("low", "title_long", `Title is ${p.title.length} characters; over about 60 may be cut off.`);
  else if (p.title.length < 15) add("medium", "title_short", `Title is only ${p.title.length} characters.`);
  if (!p.description) add("medium", "description_missing", "Page has no meta description.");
  else if (p.description.length > 160) add("low", "description_long", `Meta description is ${p.description.length} characters; over about 160 may be cut off.`);
  if (p.h1.length === 0) add("medium", "h1_missing", "Page has no main heading (H1).");
  else if (p.h1.length > 1) add("low", "h1_multiple", `Page has ${p.h1.length} main headings (H1).`);
  if (!p.canonical) add("low", "canonical_missing", "Page has no canonical link.");
  if (p.words < 150) add("medium", "thin", `Page has only about ${p.words} words of text.`);
  if (p.imagesWithoutAlt > 0) add("low", "img_alt", `${p.imagesWithoutAlt} image(s) have no alt text.`);
  return f;
}

export function siteFindings(pages: SeoPage[], robots: { found: boolean; blocksAll: boolean }, sitemap: { found: boolean; urls: number }, origin: string): SeoFinding[] {
  const f: SeoFinding[] = [];
  if (!robots.found) f.push({ severity: "low", code: "robots_missing", url: `${origin}/robots.txt`, message: "No robots.txt file found." });
  if (robots.blocksAll) f.push({ severity: "high", code: "robots_blocks_all", url: `${origin}/robots.txt`, message: "robots.txt blocks all search engines from the whole site." });
  if (!sitemap.found) f.push({ severity: "medium", code: "sitemap_missing", url: `${origin}/sitemap.xml`, message: "No XML sitemap found." });
  const seen = new Map<string, string>();
  for (const p of pages) { if (!p.title) continue; const k = p.title.toLowerCase(); const prev = seen.get(k);
    if (prev) f.push({ severity: "medium", code: "title_duplicate", url: p.url, message: `Same title as ${prev}.` }); else seen.set(k, p.url); }
  return [...f, ...pages.flatMap(pageFindings)];
}

export function parseRobots(text: string): { blocksAll: boolean; sitemaps: string[] } {
  let star = false, blocksAll = false; const sitemaps: string[] = [];
  for (const raw of text.split(/\r?\n/)) { const line = raw.replace(/#.*/, "").trim(); const [k, ...rest] = line.split(":"); const v = rest.join(":").trim(); const key = (k ?? "").toLowerCase();
    if (key === "user-agent") star = v === "*"; else if (key === "disallow" && star && v === "/") blocksAll = true; else if (key === "sitemap" && v) sitemaps.push(v); }
  return { blocksAll, sitemaps: sitemaps.slice(0, 5) };
}
export const parseSitemap = (xml: string) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => decode(m[1] ?? "")).slice(0, 500);
export const severityRank = { high: 0, medium: 1, low: 2 } as const;
