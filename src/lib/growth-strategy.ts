import { z } from "zod";

// Over-long model fields are truncated rather than rejected so paid output is not lost.
const text = (max: number) => z.string().trim().min(1).transform((s) => s.slice(0, max));
export const strategySchema = z.object({
  summary: text(1500),
  channels: z.array(z.object({ name: text(80), why: text(500), share: z.number().min(0).transform((n) => Math.min(100, n)) })).transform((a) => a.slice(0, 8)),
  actions: z.array(z.object({ title: text(200), detail: z.string().default("").transform((s) => s.slice(0, 800)), channel: z.string().default("").transform((s) => s.slice(0, 80)), week: z.number().int().min(1).max(26), effort: z.enum(["low", "medium", "high"]) })).min(1).transform((a) => a.slice(0, 20)),
  kpis: z.array(z.object({ metric: text(160), target: text(300) })).transform((a) => a.slice(0, 10)),
  risks: z.array(text(400)).transform((a) => a.slice(0, 8)),
  assumptions: z.array(text(400)).transform((a) => a.slice(0, 10)),
});
export type Strategy = z.infer<typeof strategySchema>;

/** Parses model JSON (optionally fenced), validates it and normalises channel shares to at most 100%. */
export function parseStrategy(raw: string): Strategy {
  const s = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const parsed = strategySchema.parse(JSON.parse(s));
  const total = parsed.channels.reduce((a, c) => a + c.share, 0);
  if (total > 100) parsed.channels = parsed.channels.map((c) => ({ ...c, share: Math.round((c.share / total) * 100) }));
  parsed.actions.sort((a, b) => a.week - b.week);
  return parsed;
}

export type GoalInput = { title: string; objective: string; metric: string; baseline: number | null; target: number | null; current_value: number | null; due_date: string | null; rationale: string };
export function goalBrief(goal: GoalInput, budget: { channel: string; planned: number; actual: number }[], horizonWeeks: number) {
  const lines = budget.length ? budget.map((b) => `- ${b.channel}: planned ${b.planned}, spent ${b.actual}`).join("\n") : "- No budget planned";
  return `Goal: ${goal.title}\nObjective type: ${goal.objective}\nMetric: ${goal.metric || "not set"}\nBaseline: ${goal.baseline ?? "unknown"}; current: ${goal.current_value ?? "unknown"}; target: ${goal.target ?? "unknown"}\nDeadline: ${goal.due_date ?? "none"}\nPlanning horizon: ${horizonWeeks} weeks\nUser rationale: ${goal.rationale || "none"}\nCurrent month budget (EUR):\n${lines}`;
}

export const STRATEGY_INSTRUCTIONS = `You are a pragmatic growth strategist for a small business. Build an actionable plan to reach the goal.
Rules: use only the business facts and goal data provided; never invent statistics, customers, prices or results. If something needed is unknown, add it to "assumptions". Respect the planned budget; do not propose spending beyond it. Actions must be concrete tasks a small team can do, each with a week number inside the planning horizon.
Return ONLY JSON: {"summary":string,"channels":[{"name":string,"why":string,"share":number(0-100, % of effort)}],"actions":[{"title":string,"detail":string,"channel":string,"week":integer,"effort":"low"|"medium"|"high"}],"kpis":[{"metric":string,"target":string}],"risks":[string],"assumptions":[string]}`;
