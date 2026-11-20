import { z } from "zod";

// Over-long model fields are truncated rather than rejected so paid output is not lost.
const text = (max: number) => z.string().trim().min(1).transform((s) => s.slice(0, max));
const opt = (max: number) => z.string().default("").transform((s) => s.trim().slice(0, max));
const list = (max: number, n: number) => z.array(z.string()).default([]).transform((a) => a.map((s) => s.trim().slice(0, max)).filter(Boolean).slice(0, n));
/** Specialists a plan step may name; registry keys only, anything else is dropped rather than trusted. */
export const PLAN_SPECIALISTS = ["growth_officer", "marketing_strategy", "market_research", "competitor_intel", "seo", "content", "social", "advertising", "crm", "email"] as const;
export const STEP_KINDS = ["campaign", "project", "task"] as const;
const actionSchema = z.object({
  title: text(200), detail: z.string().default("").transform((s) => s.slice(0, 800)), channel: z.string().default("").transform((s) => s.slice(0, 80)),
  week: z.number().int().min(1).max(26), effort: z.enum(["low", "medium", "high"]),
  kind: z.string().default("task").transform((k) => ((STEP_KINDS as readonly string[]).includes(k) ? (k as (typeof STEP_KINDS)[number]) : "task")),
  specialist: z.string().default("").transform((k) => ((PLAN_SPECIALISTS as readonly string[]).includes(k) ? k : "")),
  budget: z.number().nonnegative().nullable().default(null).catch(null),
  integrations: list(60, 5),
  /** 1-based step numbers this step waits for; references to unknown or later steps are removed when parsing. */
  dependsOn: z.array(z.number().int()).default([]).catch([]),
  needsApproval: z.boolean().default(false).catch(false),
});
export const strategySchema = z.object({
  summary: text(1500),
  opportunity: opt(800), relevance: opt(800), outcome: opt(600), audience: opt(600), timeline: opt(400), measurement: opt(800),
  budget: z.object({ amount: z.number().nonnegative().nullable().default(null), currency: z.string().default("EUR").transform((c) => c.trim().toUpperCase().slice(0, 3) || "EUR"), basis: opt(400) }).nullable().default(null).catch(null),
  channels: z.array(z.object({ name: text(80), why: text(500), share: z.number().min(0).transform((n) => Math.min(100, n)) })).transform((a) => a.slice(0, 8)),
  actions: z.array(actionSchema).min(1).transform((a) => a.slice(0, 20)),
  kpis: z.array(z.object({ metric: text(160), target: text(300) })).transform((a) => a.slice(0, 10)),
  risks: z.array(text(400)).transform((a) => a.slice(0, 8)),
  dependencies: list(400, 8),
  assumptions: z.array(text(400)).transform((a) => a.slice(0, 10)),
  /** What the strategy rests on, kept apart: confirmed facts, estimates and untested hypotheses. */
  evidence: z.object({ facts: list(400, 10), estimates: list(400, 10), hypotheses: list(400, 10) }).default({ facts: [], estimates: [], hypotheses: [] }).catch({ facts: [], estimates: [], hypotheses: [] }),
});
export type Strategy = z.infer<typeof strategySchema>;

/** Orders steps by week and rewrites dependencies to the new step numbers, dropping self, unknown and forward references. */
export function normalizeSteps(strategy: Strategy): Strategy {
  const indexed = strategy.actions.map((a, i) => ({ a, from: i + 1 }));
  indexed.sort((x, y) => x.a.week - y.a.week || x.from - y.from);
  const renumber = new Map(indexed.map((x, i) => [x.from, i + 1] as const));
  const actions = indexed.map((x, i) => ({ ...x.a, dependsOn: [...new Set(x.a.dependsOn.map((d) => renumber.get(d)).filter((d): d is number => d != null && d < i + 1))] }));
  return { ...strategy, actions };
}

/** Parses model JSON (optionally fenced), validates it and normalises channel shares to at most 100%. */
export function parseStrategy(raw: string): Strategy {
  const s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const parsed = strategySchema.parse(JSON.parse(s));
  const total = parsed.channels.reduce((a, c) => a + c.share, 0);
  if (total > 100) parsed.channels = parsed.channels.map((c) => ({ ...c, share: Math.round((c.share / total) * 100) }));
  return normalizeSteps(parsed);
}

export type OpportunityInput = { title: string; summary: string; analysis: string; audience: string; expected_impact: string; budget_min: number | null; budget_max: number | null; currency: string; horizon_days: number; resources: string[]; integrations: string[]; risks: string[]; confidence: string };
/** The growth opportunity a goal came from, as plain text for the strategist. */
export function sourceOpportunityBrief(o: OpportunityInput) {
  const budget = o.budget_min != null || o.budget_max != null ? `${o.budget_min ?? "?"}–${o.budget_max ?? "?"} ${o.currency} (estimate)` : "not estimated";
  return `Opportunity: ${o.title}\nSummary: ${o.summary}\nAnalysis: ${o.analysis}\nAudience: ${o.audience || "not stated"}\nExpected impact (estimate): ${o.expected_impact || "not stated"}\nBudget range: ${budget}\nHorizon: ${o.horizon_days} days\nResources: ${o.resources.join(", ") || "none listed"}\nIntegrations: ${o.integrations.join(", ") || "none"}\nRisks: ${o.risks.join("; ") || "none listed"}\nConfidence: ${o.confidence}`;
}

export type GoalInput = { title: string; objective: string; metric: string; baseline: number | null; target: number | null; current_value: number | null; due_date: string | null; rationale: string };
export function goalBrief(goal: GoalInput, budget: { channel: string; planned: number; actual: number }[], horizonWeeks: number) {
  const lines = budget.length ? budget.map((b) => `- ${b.channel}: planned ${b.planned}, spent ${b.actual}`).join("\n") : "- No budget planned";
  return `Goal: ${goal.title}\nObjective type: ${goal.objective}\nMetric: ${goal.metric || "not set"}\nBaseline: ${goal.baseline ?? "unknown"}; current: ${goal.current_value ?? "unknown"}; target: ${goal.target ?? "unknown"}\nDeadline: ${goal.due_date ?? "none"}\nPlanning horizon: ${horizonWeeks} weeks\nUser rationale: ${goal.rationale || "none"}\nCurrent month budget (EUR):\n${lines}`;
}

export const STRATEGY_INSTRUCTIONS = `You are a pragmatic growth strategist for a small business. Build a concrete, actionable strategy to reach the goal, starting from the growth opportunity when one is given.
Rules: use only the business facts, goal, opportunity, budget, campaigns and initiatives provided; never invent statistics, customers, prices or results. Respect the planned budget; never propose spending beyond it. Do not duplicate existing campaigns or initiatives; build on them instead. Steps must be specific to this business and opportunity, not generic templates, each with a week number inside the planning horizon.
Explain: which commercial opportunity is pursued ("opportunity"), why it is relevant ("relevance"), the intended commercial outcome ("outcome"), the target audience ("audience"), channels, required activities ("actions"), required budget ("budget": amount or null if unknown, currency, basis), expected timeline ("timeline"), how performance is measured ("measurement" and "kpis"), risks and dependencies.
Keep evidence apart: "facts" only restate provided confirmed facts; "estimates" are your quantified guesses; "hypotheses" are untested assumptions to validate. Anything unknown goes into "assumptions".
Each action: "kind" campaign|project|task, optional "specialist" (one of ${PLAN_SPECIALISTS.join("|")}) who would prepare it, "budget" (number or null), "integrations" it needs, "dependsOn" (earlier step numbers, 1-based), "needsApproval" true when it would publish, send, spend or contact anyone outside the business.
Return ONLY JSON: {"summary":string,"opportunity":string,"relevance":string,"outcome":string,"audience":string,"timeline":string,"measurement":string,"budget":{"amount":number|null,"currency":string,"basis":string},"channels":[{"name":string,"why":string,"share":number(0-100, % of effort)}],"actions":[{"title":string,"detail":string,"channel":string,"week":integer,"effort":"low"|"medium"|"high","kind":string,"specialist":string,"budget":number|null,"integrations":[string],"dependsOn":[integer],"needsApproval":boolean}],"kpis":[{"metric":string,"target":string}],"risks":[string],"dependencies":[string],"assumptions":[string],"evidence":{"facts":[string],"estimates":[string],"hypotheses":[string]}}`;
