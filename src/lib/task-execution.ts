// Rules for AI task execution shared by the server runner, the Tasks screen, Home and tests.
// The database (proposal 0063) enforces every state change; these helpers only decide what to offer.
import { z } from "zod";
import { hasRole, type OrgRole } from "@/lib/permissions";

export const executionRole = (role: OrgRole | null): "viewer" | "member" | "admin" =>
  hasRole(role, "admin") ? "admin" : hasRole(role, "member") ? "member" : "viewer";

export const SPECIALIST_KEYS = [
  "business_analyst",
  "market_research",
  "growth_strategist",
  "seo",
  "content",
  "copywriter",
  "marketing",
  "advertising",
  "linkedin",
  "sales",
  "crm",
  "cro",
  "partnership",
  "event_marketing",
  "revenue_analyst",
] as const;
export type TaskSpecialist = (typeof SPECIALIST_KEYS)[number];
export const taskSpecialistSchema = z.enum(SPECIALIST_KEYS);
export type TaskType = "analysis" | "preparation" | "external";
/** The accounted AI request family each specialist runs under (existing single-request kinds). */
export type RequestKind = "research" | "strategy" | "seo" | "content";

type Spec = {
  kind: RequestKind;
  types: readonly TaskType[];
  prompt: string;
  words: readonly string[];
};
export const TASK_SPECIALISTS: Record<TaskSpecialist, Spec> = {
  business_analyst: {
    kind: "research",
    types: ["analysis"],
    words: [
      "analys",
      "analyz",
      "process",
      "kosten",
      "cost",
      "margin",
      "marge",
      "feasib",
      "haalbaar",
      "faisab",
      "operations",
    ],
    prompt:
      "Analyse the business question with the supplied facts: current situation, constraints, options with trade-offs, and a clear recommendation. Separate facts from assumptions.",
  },
  market_research: {
    kind: "research",
    types: ["analysis"],
    words: [
      "market",
      "markt",
      "marché",
      "audience",
      "doelgroep",
      "cible",
      "demand",
      "vraag",
      "research",
      "onderzoek",
      "recherche",
      "persona",
    ],
    prompt:
      "Assess audiences, needs, demand signals and alternatives from supplied evidence only. No live web search is available; never pretend you searched. Give a concrete research plan for open questions.",
  },
  growth_strategist: {
    kind: "strategy",
    types: ["analysis", "preparation"],
    words: ["strateg", "plan", "priorit", "roadmap", "growth", "groei", "croissance"],
    prompt:
      "Turn the task into a prioritised, sequenced approach with owners, timing, success measures and stop/continue criteria.",
  },
  seo: {
    kind: "seo",
    types: ["analysis", "preparation"],
    words: ["seo", "keyword", "zoekwoord", "mot-clé", "google", "ranking", "search", "zoek"],
    prompt:
      "Produce intent-based keyword clusters, page plans and on-page recommendations. Keywords are suggestions, never measured volumes or rankings.",
  },
  content: {
    kind: "content",
    types: ["preparation"],
    words: ["content", "blog", "artikel", "article", "newsletter", "nieuwsbrief", "video", "guide"],
    prompt:
      "Write the actual content draft requested, ready for review: title, audience, full draft and fact-check notes. Do not publish.",
  },
  copywriter: {
    kind: "content",
    types: ["preparation"],
    words: [
      "copy",
      "tekst",
      "texte",
      "offer",
      "aanbod",
      "offre",
      "landing",
      "pagina",
      "page",
      "slogan",
      "headline",
    ],
    prompt:
      "Write persuasive, accurate copy with 2-3 variants, a clear call to action and notes on claims that need verification. Do not publish.",
  },
  marketing: {
    kind: "strategy",
    types: ["analysis", "preparation"],
    words: [
      "marketing",
      "campaign",
      "campagne",
      "promo",
      "launch",
      "lancer",
      "lancering",
      "channel",
      "kanaal",
      "canal",
    ],
    prompt:
      "Design the marketing activity: audience, message, channels, timeline, budget split assumptions and measurement. Nothing is launched.",
  },
  advertising: {
    kind: "strategy",
    types: ["analysis", "preparation", "external"],
    words: ["ads", "advert", "advertent", "publicité", "budget", "cpc", "meta ads", "google ads"],
    prompt:
      "Prepare an advertising plan: targeting, ad variants, budget assumptions, bidding approach and test design. No budget is spent and no ads are created.",
  },
  linkedin: {
    kind: "content",
    types: ["preparation", "external"],
    words: ["linkedin", "post", "b2b", "network", "netwerk", "réseau"],
    prompt:
      "Prepare LinkedIn posts or outreach messages with variants and posting guidance. Nothing is posted or sent.",
  },
  sales: {
    kind: "strategy",
    types: ["analysis", "preparation"],
    words: ["sales", "verkoop", "vente", "offerte", "quote", "devis", "pitch", "deal", "prospect"],
    prompt:
      "Prepare the sales material or approach: qualification questions, pitch structure, objection handling and next steps. No customer is contacted.",
  },
  crm: {
    kind: "strategy",
    types: ["analysis", "preparation", "external"],
    words: ["crm", "lead", "pipeline", "follow-up", "opvolg", "suivi", "segment"],
    prompt:
      "Design the CRM process: stages, lead scoring rules, follow-up cadence and data to record. No records are changed in external systems.",
  },
  cro: {
    kind: "strategy",
    types: ["analysis", "preparation"],
    words: ["conversion", "conversie", "checkout", "funnel", "trechter", "a/b", "test", "ux"],
    prompt:
      "Find conversion bottlenecks from supplied evidence and propose prioritised experiments with hypotheses and success metrics.",
  },
  partnership: {
    kind: "strategy",
    types: ["analysis", "preparation", "external"],
    words: ["partner", "verwijz", "referral", "affiliate", "collab", "samenwerk"],
    prompt:
      "Identify partner profiles, value exchange, outreach approach and agreement points to clarify. No partner is contacted.",
  },
  event_marketing: {
    kind: "strategy",
    types: ["analysis", "preparation"],
    words: ["event", "evenement", "événement", "workshop", "beurs", "salon", "webinar"],
    prompt:
      "Plan the event: goal, audience, format, run sheet, promotion plan, budget assumptions and follow-up. Nothing is booked.",
  },
  revenue_analyst: {
    kind: "research",
    types: ["analysis"],
    words: [
      "revenue",
      "omzet",
      "chiffre",
      "pricing",
      "prijs",
      "prix",
      "forecast",
      "prognose",
      "prévision",
      "roi",
    ],
    prompt:
      "Analyse revenue drivers, pricing and forecasts from supplied figures only. Label every number as recorded, imported or assumed; never invent results.",
  },
};

/** Growth Officer's rule-based suggestion: the specialist whose vocabulary best matches the task. Free and explainable. */
export function suggestSpecialist(
  title: string,
  description = "",
): { specialist: TaskSpecialist; matched: string[] } {
  const text = `${title} ${description}`.toLowerCase();
  let best: { specialist: TaskSpecialist; matched: string[] } = {
    specialist: "growth_strategist",
    matched: [],
  };
  for (const key of SPECIALIST_KEYS) {
    const matched = TASK_SPECIALISTS[key].words.filter((w) => text.includes(w));
    if (matched.length > best.matched.length) best = { specialist: key, matched };
  }
  return best;
}
export const defaultTaskType = (s: TaskSpecialist): TaskType =>
  TASK_SPECIALISTS[s].types.includes("preparation") ? "preparation" : "analysis";

export type RunStatus =
  | "awaiting_approval"
  | "queued"
  | "paused"
  | "running"
  | "succeeded"
  | "failed"
  | "uncertain"
  | "cancelled"
  | "rejected";
export const ACTIVE_RUN: readonly RunStatus[] = [
  "awaiting_approval",
  "queued",
  "paused",
  "running",
  "uncertain",
];
export const MAX_ATTEMPTS = 3;
/** Shown before every run; the database rejects anything above the workspace's per-run limit. */
export const RUN_ESTIMATE = 8;
export const RUN_OUTPUT_TOKENS = 3000;

export type RunAction =
  "run" | "start" | "approve" | "reject" | "pause" | "resume" | "cancel" | "retry" | "accept";
/** Actions offered for a task's latest run, given the viewer's role. The database re-checks each one. */
export function runActions(i: {
  latest: { status: RunStatus } | null;
  attempts: number;
  role: "viewer" | "member" | "admin";
  taskType: TaskType | null;
  taskStatus: string;
  blocked: boolean;
  resultAccepted?: boolean;
  resultNeedsRework?: boolean;
}): RunAction[] {
  if (i.role === "viewer" || !i.taskType || i.taskType === "external") return [];
  const out: RunAction[] = [];
  const s = i.latest?.status;
  const closed = ["done", "cancelled"].includes(i.taskStatus);
  if (
    !closed &&
    !i.blocked &&
    (!s || ["cancelled", "rejected"].includes(s)) &&
    i.attempts < MAX_ATTEMPTS
  )
    out.push("run");
  if (!closed && !i.blocked && s === "failed" && i.attempts < MAX_ATTEMPTS) out.push("retry");
  if (
    !closed &&
    !i.blocked &&
    s === "succeeded" &&
    i.resultNeedsRework &&
    i.attempts < MAX_ATTEMPTS
  )
    out.push("retry");
  if (s === "awaiting_approval" && i.role === "admin") out.push("approve", "reject");
  if (s === "queued") out.push(...(i.blocked ? [] : ["start" as const]), "pause");
  if (s === "paused") out.push("resume");
  if (s && ["queued", "paused", "awaiting_approval"].includes(s)) out.push("cancel");
  if (s === "succeeded" && !closed && i.resultAccepted) out.push("accept");
  return out;
}

/** The structured result every specialist returns. */
export const taskOutputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(1500),
  sections: z
    .array(z.object({ heading: z.string().min(1).max(120), body: z.string().min(1).max(12000) }))
    .min(1)
    .max(8),
  deliverables: z.array(z.string().max(300)).max(10).default([]),
  evidence_gaps: z.array(z.string().max(500)).max(10).default([]),
  next_steps: z
    .array(
      z.object({ title: z.string().min(1).max(200), owner: z.enum(["team", "ai"]).catch("team") }),
    )
    .max(8)
    .default([]),
  external_actions: z
    .array(z.object({ action: z.string().min(1).max(300), system: z.string().max(80).default("") }))
    .max(6)
    .default([]),
});
export type TaskOutput = z.infer<typeof taskOutputSchema>;
export function parseTaskOutput(raw: string): TaskOutput {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "");
  return taskOutputSchema.parse(JSON.parse(trimmed));
}
/** Recorded recovery wrappers are parsed exactly like the original delivery, never treated as validated by default. */
export function recordedTaskOutput(value: unknown): TaskOutput | null {
  const parsed = taskOutputSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (
    !value ||
    typeof value !== "object" ||
    !("markdown" in value) ||
    typeof value.markdown !== "string"
  )
    return null;
  try {
    return parseTaskOutput(value.markdown);
  } catch {
    return null;
  }
}
export function taskOutputMarkdown(output: TaskOutput): string {
  return [
    `# ${output.title}`,
    output.summary,
    ...output.sections.map((section) => `## ${section.heading}\n\n${section.body}`),
    ...(output.evidence_gaps.length
      ? [`## Evidence gaps\n${output.evidence_gaps.map((gap) => `- ${gap}`).join("\n")}`]
      : []),
    ...(output.external_actions.length
      ? [
          `## External actions — not authorized or executed\n${output.external_actions.map((action) => `- ${action.action}${action.system ? ` (${action.system})` : ""}`).join("\n")}`,
        ]
      : []),
  ].join("\n\n");
}
export const TASK_OUTPUT_FORMAT = `Return ONLY JSON: {"title":"...","summary":"2-4 sentences","sections":[{"heading":"...","body":"markdown"}],"deliverables":["..."],"evidence_gaps":["..."],"next_steps":[{"title":"...","owner":"team|ai"}],"external_actions":[{"action":"...","system":"..."}]}. 1-8 sections. List anything that would publish, send, spend or change an outside system under external_actions; you cannot do those yourself.`;

/** Growth Officer's rule-based check of a specialist result; it flags, it never changes the result. */
export type ReviewFlag = "evidence_gaps" | "external_actions" | "no_deliverables" | "recovered";
export function reviewOutput(output: unknown): {
  flags: ReviewFlag[];
  next: "accept" | "fill_gaps" | "approve_external";
} {
  const parsed = taskOutputSchema.safeParse(output);
  if (!parsed.success) return { flags: ["recovered"], next: "fill_gaps" };
  const o = parsed.data;
  const flags: ReviewFlag[] = [];
  if (o.evidence_gaps.length) flags.push("evidence_gaps");
  if (o.external_actions.length) flags.push("external_actions");
  if (!o.deliverables.length) flags.push("no_deliverables");
  return {
    flags,
    next: o.external_actions.length
      ? "approve_external"
      : o.evidence_gaps.length
        ? "fill_gaps"
        : "accept",
  };
}

/** Mode 4 batch: which tasks the Growth Officer may run now, in order, within explicit stopping conditions. */
export const BATCH_LIMIT = 3;
export function readyForBatch<
  T extends {
    id: string;
    priority: string;
    due_date: string | null;
    status: string;
    type: TaskType | null;
    blocked: boolean;
    active: boolean;
    attempts: number;
    succeeded: boolean;
  },
>(tasks: readonly T[]): T[] {
  const rank: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  return tasks
    .filter(
      (t) =>
        t.type &&
        t.type !== "external" &&
        !t.blocked &&
        !t.active &&
        !t.succeeded &&
        t.attempts < MAX_ATTEMPTS &&
        !["done", "cancelled", "review"].includes(t.status),
    )
    .sort(
      (a, b) =>
        (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9) ||
        (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"),
    )
    .slice(0, BATCH_LIMIT);
}
