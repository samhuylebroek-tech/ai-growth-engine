// Reading order for long AI answers (pure). The Growth Officer writes sections such as "what is happening",
// "what the evidence shows", "likely cause" and "what to do next". On screen the conclusion (intro + first section)
// and the action sections come first; the supporting analysis stays one click away, in its original order.
// Sections are classified by their statement labels, not by heading words, so it works in every language.
import { MARKER } from "@/lib/claims";

export type AnswerSection = { heading: string; body: string };
export type AnswerLayout = { lead: string; support: AnswerSection[] } | null;

const HEADING = /^(#{1,3})\s+(.+?)\s*#*\s*$/;
const MARKER_SPAN = /`(⟦[^`]+⟧)`/g;

function kinds(md: string) {
  const out: string[] = [];
  for (const m of md.matchAll(MARKER_SPAN)) {
    const k = (m[1] ?? "").match(MARKER);
    if (k?.[1]) out.push(k[1]);
  }
  return out;
}

/** Splits marked answer text at its top heading level. Returns null when there is nothing worth folding. */
export function answerLayout(marked: string, minSections = 3): AnswerLayout {
  const lines = marked.split("\n");
  let fence = false;
  let level = 9;
  for (const l of lines) {
    if (l.trimStart().startsWith("```")) fence = !fence;
    else if (!fence) {
      const m = l.match(HEADING);
      if (m?.[1]) level = Math.min(level, m[1].length);
    }
  }
  if (level === 9) return null;
  const intro: string[] = [];
  const sections: { heading: string; lines: string[] }[] = [];
  fence = false;
  for (const l of lines) {
    if (l.trimStart().startsWith("```")) fence = !fence;
    const m = !fence ? l.match(HEADING) : null;
    if (m?.[1]?.length === level) sections.push({ heading: m[2] ?? "", lines: [l] });
    else (sections.at(-1)?.lines ?? intro).push(l);
  }
  if (sections.length < minSections) return null;
  const isAction = (s: { lines: string[] }) => {
    const k = kinds(s.lines.join("\n"));
    const rec = k.filter((x) => x === "recommendation").length;
    return rec > 0 && rec * 2 >= k.length;
  };
  const lead: string[] = [intro.join("\n")];
  const support: AnswerSection[] = [];
  sections.forEach((s, i) => {
    const text = s.lines.join("\n");
    if (i === 0 || isAction(s)) lead.push(text);
    else support.push({ heading: s.heading.replace(/[*_`]/g, ""), body: text });
  });
  if (!support.length) return null;
  return { lead: lead.filter((x) => x.trim()).join("\n\n"), support };
}
