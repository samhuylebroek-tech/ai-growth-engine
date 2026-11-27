// Pure helpers for the guided onboarding: reading answers back from business facts, encoding choices as readable text,
// adaptive visibility, progress and the "what we understand" summary. No AI, no credits.
import { factTopic } from "@/lib/fact-conflicts";
import {
  ANSWER_SOURCE,
  QUESTIONS,
  SECTIONS,
  questionById,
  type Question,
  type SectionId,
} from "@/lib/onboarding/questions";

export type AnswerFact = {
  id?: string;
  key: string;
  value: string;
  verified: boolean;
  source_type: string;
  source_ref?: string | null;
  created_at?: string | null;
};
export type Draft = { choices: string[]; other: string; text: string };
/** All labels an option has had in any language, so an answer saved in Dutch is still recognised in French. */
export type LabelsOf = (questionId: string, option: string) => readonly string[];
export type LabelOf = (questionId: string, option: string) => string;

export const emptyDraft = (): Draft => ({ choices: [], other: "", text: "" });
const MAX = 1000;

/**
 * The newest saved onboarding answer per question key. Only confirmed rows count, like in save_business_answers: an
 * unconfirmed row with the same source (a member can add unconfirmed facts) is never treated as an answer.
 */
export function savedAnswers(facts: readonly AnswerFact[]): Map<string, AnswerFact> {
  const out = new Map<string, AnswerFact>();
  for (const f of facts) {
    if (!f.verified || f.source_ref !== ANSWER_SOURCE || !QUESTIONS.some((x) => x.key === f.key))
      continue;
    const prev = out.get(f.key);
    if (!prev || (f.created_at ?? "") > (prev.created_at ?? "")) out.set(f.key, f);
  }
  return out;
}

const labelSource = (q: Question) => q.optionsFrom ?? q.id;
export function optionsOf(q: Question, drafts: Readonly<Record<string, Draft>>): readonly string[] {
  if (q.optionsFrom) return drafts[q.optionsFrom]?.choices ?? [];
  return q.options ?? [];
}

/** Choices become one line each in the person's language; an own answer follows as its own line. */
export function encodeAnswer(q: Question, d: Draft, label: LabelOf): string {
  if (q.kind === "text") return d.text.trim().slice(0, MAX);
  const lines = d.choices.map((c) => label(labelSource(q), c));
  const own = d.other.trim();
  if (q.kind === "multi" && q.other && own) lines.push(own);
  return lines.join("\n").slice(0, MAX);
}

export function decodeAnswer(q: Question, value: string, labels: LabelsOf): Draft {
  if (q.kind === "text") return { choices: [], other: "", text: value };
  const pool = q.optionsFrom ? (questionById(q.optionsFrom)?.options ?? []) : (q.options ?? []);
  const norm = (s: string) => s.trim().toLowerCase();
  const choices: string[] = [];
  const rest: string[] = [];
  for (const line of value
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)) {
    const hit = pool.find((o) => labels(labelSource(q), o).some((l) => norm(l) === norm(line)));
    if (hit && !choices.includes(hit)) choices.push(hit);
    else if (!hit) rest.push(line);
  }
  return {
    choices: q.kind === "single" ? choices.slice(0, 1) : choices,
    other: rest.join("\n"),
    text: "",
  };
}

export const hasContent = (q: Question, d: Draft | undefined) =>
  !!d &&
  (q.kind === "text"
    ? !!d.text.trim()
    : d.choices.length > 0 || (q.kind === "multi" && !!q.other && !!d.other.trim()));

/** Follow-up questions appear only when an earlier answer makes them matter. */
export function isVisible(q: Question, drafts: Readonly<Record<string, Draft>>): boolean {
  if (!q.showIf) return true;
  const d = drafts[q.showIf.question];
  if (!d) return false;
  if (q.showIf.anyOf && !d.choices.some((c) => q.showIf?.anyOf?.includes(c))) return false;
  if (q.showIf.minChoices && d.choices.length < q.showIf.minChoices) return false;
  return true;
}

/** Drafts for every question from what is saved. */
export function draftsFromFacts(
  facts: readonly AnswerFact[],
  labels: LabelsOf,
): Record<string, Draft> {
  const saved = savedAnswers(facts);
  const out: Record<string, Draft> = {};
  for (const q of QUESTIONS) {
    const f = saved.get(q.key);
    out[q.id] = f ? decodeAnswer(q, f.value, labels) : emptyDraft();
  }
  return out;
}

export type SectionProgress = {
  section: SectionId;
  coreAnswered: number;
  coreTotal: number;
  answered: number;
  total: number;
  done: boolean;
};
export function sectionProgress(facts: readonly AnswerFact[]): SectionProgress[] {
  const saved = savedAnswers(facts);
  return SECTIONS.map((section) => {
    const qs = QUESTIONS.filter((x) => x.section === section);
    const core = qs.filter((x) => x.core);
    const coreAnswered = core.filter((x) => saved.has(x.key)).length;
    return {
      section,
      coreAnswered,
      coreTotal: core.length,
      answered: qs.filter((x) => saved.has(x.key)).length,
      total: qs.length,
      done: coreAnswered === core.length,
    };
  });
}
export function overallProgress(facts: readonly AnswerFact[]): {
  answered: number;
  total: number;
  nextSection: SectionId | null;
} {
  const p = sectionProgress(facts);
  return {
    answered: p.reduce((n, s) => n + s.coreAnswered, 0),
    total: p.reduce((n, s) => n + s.coreTotal, 0),
    nextSection: p.find((s) => !s.done)?.section ?? null,
  };
}

/** Answers that changed compared with what is saved, as the rows save_business_answers expects (max 12 per call). */
export function changedAnswers(
  section: SectionId,
  drafts: Readonly<Record<string, Draft>>,
  saved: ReadonlyMap<string, AnswerFact>,
  label: LabelOf,
): { key: string; value: string; expected: string | null }[] {
  const out: { key: string; value: string; expected: string | null }[] = [];
  for (const q of QUESTIONS.filter((x) => x.section === section)) {
    const d = drafts[q.id] ?? emptyDraft();
    // A hidden follow-up keeps what was saved; it is not cleared behind the person's back.
    if (!isVisible(q, drafts)) continue;
    const value = encodeAnswer(q, d, label);
    const prev = saved.get(q.key)?.value ?? null;
    if ((prev ?? "") === value) continue;
    out.push({ key: q.key, value, expected: prev });
  }
  return out;
}

// ---- Summary -----------------------------------------------------------------------------------------------------
export type SummaryStatus = "confirmed" | "unconfirmed" | "assumption";
export type SummaryItem = { source: string; value: string; status: SummaryStatus };
export type SummaryTopic = {
  topic: SummaryTopicKey;
  items: SummaryItem[];
  edit: SectionId | "basics";
};
export type SummaryTopicKey =
  | "does"
  | "sells"
  | "customers"
  | "revenue"
  | "acquisition"
  | "challenges"
  | "resources"
  | "ambitions"
  | "constraints";
export type ProfileForSummary = {
  description?: string | null;
  business_model?: string | null;
  offerings?: unknown;
  audiences?: unknown;
  markets?: unknown;
  objectives?: unknown;
  monthly_budget_eur?: number | null;
} | null;

const TOPICS: {
  topic: SummaryTopicKey;
  profile: (keyof NonNullable<ProfileForSummary>)[];
  facts: string[];
  questions: string[];
  edit: SectionId | "basics";
}[] = [
  {
    topic: "does",
    profile: ["description"],
    facts: ["Business description", "Company identity"],
    questions: [],
    edit: "basics",
  },
  {
    topic: "sells",
    profile: ["offerings"],
    facts: ["Products & services", "Unique selling points"],
    questions: [],
    edit: "basics",
  },
  {
    topic: "customers",
    profile: ["audiences"],
    facts: ["Target audiences"],
    questions: ["customer_type", "ideal_customer", "customer_needs", "segments"],
    edit: "customers",
  },
  {
    topic: "revenue",
    profile: ["business_model"],
    facts: ["Business model"],
    questions: ["repeat"],
    edit: "basics",
  },
  {
    topic: "acquisition",
    profile: [],
    facts: ["Marketing channels"],
    questions: ["discovery_channels", "enquiries", "sales_cycle"],
    edit: "sales",
  },
  {
    topic: "challenges",
    profile: [],
    facts: [],
    questions: ["challenges", "main_challenge", "obstacles"],
    edit: "challenges",
  },
  {
    topic: "resources",
    profile: ["monthly_budget_eur"],
    facts: [],
    questions: ["hours", "team", "capacity", "content"],
    edit: "resources",
  },
  {
    topic: "ambitions",
    profile: ["objectives"],
    facts: [],
    questions: ["outcomes", "horizon", "priority_now", "revenue_ambition"],
    edit: "ambitions",
  },
  {
    topic: "constraints",
    profile: [],
    facts: [],
    questions: [
      "excluded_channels",
      "approvals",
      "excluded_activities",
      "regulation",
      "brand_rules",
      "geography",
    ],
    edit: "constraints",
  },
];

const show = (v: unknown): string =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).join(", ")
    : typeof v === "number"
      ? v > 0
        ? String(v)
        : ""
      : typeof v === "string"
        ? v.trim()
        : "";

/**
 * What AI Growth Engine understands, topic by topic. Profile fields are confirmed (only the atomic confirmation writes
 * them); facts keep their own state: confirmed, found but not confirmed, or an AI assumption. A topic without items
 * is what is still missing. Values are shown as stored; nothing is rephrased or invented.
 */
export function understandingSummary(
  profile: ProfileForSummary,
  facts: readonly AnswerFact[],
): SummaryTopic[] {
  return TOPICS.map(({ topic, profile: fields, facts: factKeys, questions, edit }) => {
    const items: SummaryItem[] = [];
    for (const f of fields) {
      const v = profile ? show(profile[f]) : "";
      if (v) items.push({ source: `profile:${f}`, value: v, status: "confirmed" });
    }
    const topics = new Set(factKeys.map(factTopic));
    const seen = new Set(items.map((i) => i.value.toLowerCase()));
    for (const f of facts) {
      if (
        !topics.has(factTopic(f.key)) ||
        !f.value.trim() ||
        seen.has(f.value.trim().toLowerCase())
      )
        continue;
      seen.add(f.value.trim().toLowerCase());
      items.push({
        source: `fact:${f.key}`,
        value: f.value.trim(),
        status: f.verified
          ? "confirmed"
          : f.source_type === "ai_assumption"
            ? "assumption"
            : "unconfirmed",
      });
    }
    const saved = savedAnswers(facts);
    for (const id of questions) {
      const q = questionById(id);
      const f = q ? saved.get(q.key) : undefined;
      if (f?.value.trim())
        items.push({
          source: `question:${id}`,
          value: f.value.trim(),
          status: f.verified ? "confirmed" : "unconfirmed",
        });
    }
    return { topic, items, edit };
  });
}
