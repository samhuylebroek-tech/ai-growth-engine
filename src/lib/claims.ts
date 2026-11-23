// Claim-level information labels for AI answers (pure). The AI starts each statement about the business with one tag;
// the screen turns tags into labels. A statement tagged as a fact but worded as uncertain is shown as a hypothesis,
// so an answer can never look more certain than it is. Untagged text stays plain: it is not upgraded to a fact.

export const CLAIM_KINDS = ["fact", "calc", "estimate", "hypothesis", "recommendation", "missing"] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

/** Instruction shared by every AI surface that writes free text about the business. Tags stay in English. */
export const CLAIM_RULE = `Label each statement about this business by starting its sentence or bullet with exactly one tag in square brackets (tags stay in English; the text after them is in the user's language):
[fact] only for something stated in a confirmed business fact or recorded data in the context; end it with "(source: <reference or section>, <date if given>)".
[calc] for a result you calculated from listed records; give the formula, the period and the references used, e.g. "(formula: customers ÷ leads, Oct 2026; source: #K-1a2b3c4d)".
[estimate] for an approximate value; give its basis and how uncertain it is, e.g. "(basis: …; uncertainty: …)".
Context lines may start with a record reference such as #F-1a2b3c4d (fact), #G- (goal), #I- (initiative), #C- (campaign) or #K- (metric). Whenever a statement rests on such a line, copy that exact reference into its "(source: …)"; never invent or alter a reference.
[hypothesis] for a possible explanation or opportunity that has not been confirmed.
[recommendation] for a proposed action.
[missing] for information needed to answer reliably that is not available; say why it matters, what can still be concluded and the most useful next step to get it.
Never tag a recommendation, estimate or hypothesis as [fact], never present an estimate as an actual result, and never invent a value for missing information. Headings, greetings and questions back to the user need no tag.`;

const TAG = /^(\s*(?:[-*+]|\d+[.)])?\s*)(?:\*\*)?\[(fact|calc|calculation|estimate|hypothesis|recommendation|missing)\](?:\*\*)?:?\s*/i;
// Wording that signals uncertainty in English, Dutch and French.
const HEDGE = /\b(might|may (?:be|have|indicate|explain|reflect)|could|likely|probably|possibly|perhaps|presumably|approximately|roughly|estimated?|zou kunnen|kan zijn|misschien|waarschijnlijk|vermoedelijk|mogelijk|ongeveer|naar schatting|peut-être|probablement|sans doute|environ|pourrait|semble)\b/i;

export type TaggedLine = { kind: ClaimKind | null; downgraded: boolean; text: string };

const norm = (k: string): ClaimKind => (k.toLowerCase() === "calculation" ? "calc" : (k.toLowerCase() as ClaimKind));

/** One entry per line: its label (or none) and the text without the tag. */
export function tagLines(markdown: string): TaggedLine[] {
  return markdown.split("\n").map((line) => {
    const m = line.match(TAG);
    if (!m) return { kind: null, downgraded: false, text: line };
    const rest = line.slice(m[0].length);
    let kind = norm(m[2] ?? "");
    let downgraded = false;
    if (kind === "fact" && HEDGE.test(rest)) { kind = "hypothesis"; downgraded = true; }
    return { kind, downgraded, text: `${m[1] ?? ""}${rest}` };
  });
}

/** Markdown with each tag replaced by an inline marker the renderer shows as a label (`⟦kind⟧` or `⟦kind!⟧`). */
export function markClaims(markdown: string): string {
  // Fenced code blocks (e.g. action proposals) are left untouched. Each marker carries its statement number.
  const parts = markdown.split(/(```[\s\S]*?```)/g);
  let n = 0;
  return parts.map((p) => (p.startsWith("```") ? p : tagLines(p).map((l) => {
    if (!l.kind) return l.text;
    const lead = l.text.match(/^(\s*(?:[-*+]|\d+[.)])?\s*)/)?.[1] ?? "";
    return `${lead}\`⟦${l.kind}${l.downgraded ? "!" : ""}:${n++}⟧\` ${l.text.slice(lead.length)}`;
  }).join("\n"))).join("");
}

export const MARKER = /^⟦(fact|calc|estimate|hypothesis|recommendation|missing)(!?)(?::(\d+))?⟧$/;
export function readMarker(code: string): { kind: ClaimKind; downgraded: boolean; index: number | null } | null {
  const m = code.match(MARKER);
  return m ? { kind: m[1] as ClaimKind, downgraded: m[2] === "!", index: m[3] !== undefined ? Number(m[3]) : null } : null;
}

export function claimCounts(markdown: string): Record<ClaimKind, number> & { downgraded: number } {
  const c = { fact: 0, calc: 0, estimate: 0, hypothesis: 0, recommendation: 0, missing: 0, downgraded: 0 };
  for (const l of tagLines(markdown.replace(/```[\s\S]*?```/g, ""))) if (l.kind) { c[l.kind]++; if (l.downgraded) c.downgraded++; }
  return c;
}

/** Plain text for task titles and exports: tags removed. */
export const stripClaimTags = (s: string) => s.split("\n").map((l) => { const m = l.match(TAG); return m ? `${m[1] ?? ""}${l.slice(m[0].length)}` : l; }).join("\n");

// ---- Evidence per statement -------------------------------------------------------------------------------------
// What a statement says it rests on: record references copied from the context (resolved on screen against the
// viewer's own records) and the source, formula, period, basis and uncertainty the AI wrote. Stated parts are shown as
// "as stated in the answer", never as checked evidence; only a resolved reference is a link to a record.
export type RefType = "fact" | "goal" | "initiative" | "campaign" | "metric";
const REF_TYPE: Record<string, RefType> = { F: "fact", G: "goal", I: "initiative", C: "campaign", K: "metric" };
export type RecordRef = { type: RefType; short: string; code: string };
export type StatedEvidence = { refs: RecordRef[]; source?: string; formula?: string; period?: string; basis?: string; uncertainty?: string; dates: string[] };

const FIELD: [keyof Omit<StatedEvidence, "refs" | "dates">, RegExp][] = [
  ["source", /^(?:sources?|bron(?:nen)?|source)\s*:/i],
  ["formula", /^(?:formula|formule|berekening|calcul)\s*:/i],
  ["period", /^(?:period|periode|période)\s*:/i],
  ["basis", /^(?:basis|base|grondslag|gebaseerd op|basé sur)\s*:/i],
  ["uncertainty", /^(?:uncertainty|onzekerheid|incertitude|marge)\s*:/i],
];

export function recordRefs(text: string): RecordRef[] {
  const out: RecordRef[] = [];
  for (const m of text.matchAll(/#([FGICK])-([0-9a-f]{8})(?![0-9a-z])/gi)) {
    const type = REF_TYPE[(m[1] ?? "").toUpperCase()];
    const short = (m[2] ?? "").toLowerCase();
    if (type && !out.some((r) => r.type === type && r.short === short)) out.push({ type, short, code: `#${(m[1] ?? "").toUpperCase()}-${short}` });
  }
  return out;
}

/** Parses "(source: …)", "(formula: …; period: …)" and the like from one statement, in English, Dutch or French. */
export function statedEvidence(text: string): StatedEvidence {
  const e: StatedEvidence = { refs: recordRefs(text), dates: [] };
  for (const g of text.matchAll(/\(([^()]{2,400})\)/g)) {
    for (const part of (g[1] ?? "").split(/;\s*/)) {
      const p = part.trim();
      for (const [field, re] of FIELD) {
        const m = p.match(re);
        if (!m) continue;
        const value = p.slice(m[0].length).trim();
        if (value) e[field] = e[field] ? `${e[field]}; ${value}` : value;
        break;
      }
    }
  }
  e.dates = [...new Set([...text.matchAll(/\b(20\d{2}-\d{2}(?:-\d{2})?)\b/g)].map((m) => m[1] ?? ""))].filter(Boolean);
  return e;
}

/** Each labelled statement in order (code blocks skipped), so a label on screen can open its own evidence. */
export function claimStatements(markdown: string): { kind: ClaimKind; downgraded: boolean; text: string }[] {
  const out: { kind: ClaimKind; downgraded: boolean; text: string }[] = [];
  for (const part of markdown.split(/(```[\s\S]*?```)/g)) {
    if (part.startsWith("```")) continue;
    for (const l of tagLines(part)) if (l.kind) out.push({ kind: l.kind, downgraded: l.downgraded, text: l.text.trim() });
  }
  return out;
}
