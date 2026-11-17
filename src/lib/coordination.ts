import { z } from "zod";
import { executionSelectionSchema } from "@/lib/execution-context";
import { specialistKeySchema, SPECIALISTS, specialistOutputSchema, type SpecialistKey } from "@/lib/specialists";
import { quoteUntrusted } from "@/lib/security/upload";

export const coordinationInputSchema = z.object({
  orgId: z.string().uuid(), workspaceId: z.string().uuid(), requestKey: z.string().uuid(),
  request: z.string().trim().min(3).max(4000),
  mode: z.enum(["manual", "auto"]).default("manual"),
  agents: z.array(specialistKeySchema).length(2).refine(a => new Set(a).size === 2, "Choose two different specialists").optional(),
  executionContext: executionSelectionSchema,
}).superRefine((value, context) => {
  if (value.mode === "manual" && !value.agents) {
    context.addIssue({ code: "custom", path: ["agents"], message: "Manual coordination requires two specialists." });
  }
  if (value.mode === "auto" && value.agents) {
    context.addIssue({ code: "custom", path: ["agents"], message: "Specialists are selected internally in automatic mode." });
  }
}).transform(value => ({ ...value, agents: value.agents ?? [] }));

/** Bounded routing from the request topic; no AI call is spent on selecting specialists. */
export function selectSpecialistsForRequest(request: string): [SpecialistKey, SpecialistKey] {
  const text = request.toLowerCase();
  const seo = /(^|[^a-z])seo([^a-z]|$)|search engine|organic search|keyword|keywords|ranking|search visibility|technical seo/.test(text);
  const content = /content|article|blog|newsletter|social media|social post|copywriting|copy|creative|video script/.test(text);
  const research = /market|competitor|competition|audience|customer segment|persona|pricing|positioning|demand|industry|research/.test(text);
  if (seo && content) return ["seo", "content"];
  if (seo) return ["research", "seo"];
  if (content) return ["strategy", "content"];
  if (research) return ["research", "strategy"];
  return ["strategy", "research"];
}
export const COORDINATION_LIMITS = { specialists: 2, calls: 3, reservePerCall: 50, maxCredits: 150 } as const;
export const coordinationClaimSchema = z.object({
  claimed: z.boolean(), id: z.string().uuid(), status: z.enum(["running", "succeeded", "failed"]),
  runIds: z.array(z.string().uuid()).length(3).optional(),
  conversationId: z.string().uuid().nullable().optional(), messageId: z.string().uuid().nullable().optional(),
  error: z.string().nullable().optional(),
});
export const coordinationReceiptSchema = z.object({ conversationId: z.string().uuid(), messageId: z.string().uuid(), credits: z.number().int().min(0).max(150).optional() });
export type SpecialistAnalysis = { agent: z.infer<typeof specialistKeySchema>; output: z.infer<typeof specialistOutputSchema> };
export function synthesisEvidence(results: SpecialistAnalysis[]) {
  if (results.length !== 2 || new Set(results.map(r => r.agent)).size !== 2) throw new Error("Two independent analyses are required");
  return results.map(r => quoteUntrusted(`${SPECIALISTS[r.agent].name} analysis — hypotheses, not verified facts`, JSON.stringify(specialistOutputSchema.parse(r.output)), 10000)).join("\n\n");
}

/** No retries or recursive dispatch: each child once, then one synthesis. */
export async function coordinateOnce<T, R>(agents: z.infer<typeof specialistKeySchema>[], analyze: (agent: z.infer<typeof specialistKeySchema>, index: number) => Promise<T>, synthesize: (results: T[]) => Promise<R>): Promise<R> {
  const selected = z.array(specialistKeySchema).length(2).refine(a => new Set(a).size === 2).parse(agents);
  const results: T[] = [];
  for (const [index, agent] of selected.entries()) results.push(await analyze(agent, index));
  return synthesize(results);
}