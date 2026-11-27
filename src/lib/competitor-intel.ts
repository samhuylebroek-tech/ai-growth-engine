// Deterministic competitor page signals. Facts are copied from public pages; no estimates.
import { parsePage } from "@/lib/seo-audit";

export type CompetitorPage = {
  url: string;
  title: string;
  description: string;
  h1: string[];
  h2: string[];
  words: number;
  noindex: boolean;
};
export type Observation = {
  kind: "verified_fact";
  category: "positioning" | "offering" | "messaging" | "content" | "seo" | "change";
  statement: string;
  source_url: string;
};

const clean = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
const INTERESTING =
  /(about|over-ons|over|service|dienst|product|pricing|prijs|tarie|offer|aanbod|solution|menu|shop)/i;

export function readCompetitorPage(
  html: string,
  url: string,
): CompetitorPage & { links: string[] } {
  const p = parsePage(html, url);
  const h2 = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)]
    .map((m) => clean(m[1] ?? ""))
    .filter(Boolean)
    .slice(0, 12)
    .map((s) => s.slice(0, 160));
  return {
    url,
    title: p.title.slice(0, 300),
    description: p.description.slice(0, 400),
    h1: p.h1.slice(0, 3).map((s) => s.slice(0, 200)),
    h2,
    words: p.words,
    noindex: p.noindex,
    links: p.links,
  };
}

export function pickPages(links: string[], home: string, max = 4): string[] {
  const host = new URL(home).hostname;
  return [...new Set(links)]
    .filter((u) => {
      try {
        const x = new URL(u);
        return x.hostname === host && INTERESTING.test(x.pathname) && u !== home;
      } catch {
        return false;
      }
    })
    .slice(0, max);
}

export function pageObservations(p: CompetitorPage): Observation[] {
  const o: Observation[] = [];
  const add = (category: Observation["category"], statement: string) =>
    o.push({
      kind: "verified_fact",
      category,
      statement: statement.slice(0, 1000),
      source_url: p.url,
    });
  const path = new URL(p.url).pathname || "/";
  if (p.title) add("positioning", `Page title (${path}): "${p.title}"`);
  if (p.description) add("messaging", `Meta description (${path}): "${p.description}"`);
  if (p.h1[0]) add("messaging", `Main heading (${path}): "${p.h1[0]}"`);
  if (p.h2.length)
    add(
      INTERESTING.test(path) ? "offering" : "content",
      `Section headings (${path}): ${p.h2
        .slice(0, 8)
        .map((h) => `"${h}"`)
        .join(", ")}`,
    );
  add(
    "seo",
    `SEO basics (${path}): ${p.words} words, ${p.title ? "has" : "no"} title, ${p.description ? "has" : "no"} meta description, ${p.h1.length} H1${p.noindex ? ", asks not to be indexed" : ""}.`,
  );
  return o;
}

export function changeObservations(prev: CompetitorPage[], next: CompetitorPage[]): Observation[] {
  const before = new Map(prev.map((p) => [p.url, p]));
  const o: Observation[] = [];
  for (const p of next) {
    const b = before.get(p.url);
    const path = new URL(p.url).pathname || "/";
    if (!b) {
      o.push({
        kind: "verified_fact",
        category: "change",
        statement: `New page seen since last check: ${path}`,
        source_url: p.url,
      });
      continue;
    }
    if (b.title !== p.title)
      o.push({
        kind: "verified_fact",
        category: "change",
        statement: `Title changed on ${path}: "${b.title}" → "${p.title}"`.slice(0, 1000),
        source_url: p.url,
      });
    if (b.description !== p.description)
      o.push({
        kind: "verified_fact",
        category: "change",
        statement: `Meta description changed on ${path}.`,
        source_url: p.url,
      });
    if ((b.h1[0] ?? "") !== (p.h1[0] ?? ""))
      o.push({
        kind: "verified_fact",
        category: "change",
        statement: `Main heading changed on ${path}: "${b.h1[0] ?? ""}" → "${p.h1[0] ?? ""}"`.slice(
          0,
          1000,
        ),
        source_url: p.url,
      });
    const added = p.h2.filter((h) => !b.h2.includes(h));
    if (added.length)
      o.push({
        kind: "verified_fact",
        category: "change",
        statement: `New section headings on ${path}: ${added
          .slice(0, 5)
          .map((h) => `"${h}"`)
          .join(", ")}`.slice(0, 1000),
        source_url: p.url,
      });
  }
  const now = new Set(next.map((p) => p.url));
  for (const p of prev)
    if (!now.has(p.url))
      o.push({
        kind: "verified_fact",
        category: "change",
        statement: `Page no longer found among checked pages: ${new URL(p.url).pathname}`,
        source_url: p.url,
      });
  return o;
}

export function competitorBriefText(
  name: string,
  statements: { statement: string; source_url: string }[],
): string {
  return [
    `Original content brief inspired by observations about ${name}.`,
    "",
    "Write original content for our own business. Do not copy competitor wording; use these observations only to find gaps and angles:",
    ...statements.map((s) => `- ${s.statement} (source: ${s.source_url || "own note"})`),
    "",
    "Angle: explain what we do differently, based on our verified facts only.",
  ]
    .join("\n")
    .slice(0, 8000);
}
