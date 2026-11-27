/**
 * One-line plain-text preview of a stored AI answer or summary for lists (activity rows, cards). AI answers are stored
 * as Markdown with statement tags ("[fact]") and source notes; a preview shows only the readable sentences. The full
 * answer is still rendered with its labels where it is opened.
 */
const TAG = /\[(?:fact|calc|calculation|estimate|hypothesis|recommendation|missing)\]:?\s*/gi;
const SOURCE = /\(\s*(?:source|sources|bron|bronnen|source[s]?)\s*:[^)]*\)/gi;

export function plainPreview(text: string, max = 280): string {
  let s = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+.*$/gm, " ")
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, " ")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(TAG, "")
    .replace(SOURCE, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .replace(/\|/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > max) s = `${s.slice(0, max - 1).trimEnd()}…`;
  return s;
}
