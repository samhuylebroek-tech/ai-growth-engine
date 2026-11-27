import { z } from "zod";
export const specialistKeySchema = z.enum(["strategy", "research", "seo", "content"]);
export type SpecialistKey = z.infer<typeof specialistKeySchema>;
export const SPECIALISTS: Record<SpecialistKey, { name: string; prompt: string; starter: string }> =
  {
    strategy: {
      name: "Strategy",
      starter: "Create a focused 30-day growth strategy",
      prompt:
        "Develop a prioritized growth strategy: goals, positioning, channel choices, resource trade-offs, three practical experiments and evidence needed to evaluate them. Never invent measured results.",
    },
    research: {
      name: "Research",
      starter: "Assess my market hypotheses and evidence gaps",
      prompt:
        "Analyze ONLY the supplied evidence for audiences, needs, competitors and market opportunities. Distinguish observed evidence from hypotheses. Provide a practical research plan, questions and source gaps. No live web search or external tools are available; do not pretend you searched.",
    },
    seo: {
      name: "SEO",
      starter: "Create a keyword and content opportunity plan",
      prompt:
        "Produce intent-based suggested keyword clusters, candidate pages, internal-linking recommendations and a prioritized SEO action plan from supplied evidence. Keywords are suggestions, never measured search volumes or rankings. You have no crawling, ranking or traffic tools; do not claim technical measurements.",
    },
    content: {
      name: "Content",
      starter: "Write a complete article draft for my target audience",
      prompt:
        "Write an actual usable content draft, not just writing advice. Include a brief, audience, proposed title, keyword suggestions, a complete draft in the requested format, and review checks for factual claims and brand tone. Do not publish or imply publishing. Avoid unsupported facts and fabricated testimonials.",
    },
  };
export const specialistOutputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  sections: z
    .array(z.object({ heading: z.string().min(1).max(120), body: z.string().min(1).max(16000) }))
    .min(1)
    .max(8),
  evidence_gaps: z.array(z.string().max(800)).max(10),
  actions: z
    .array(z.object({ title: z.string().min(1).max(200), rationale: z.string().max(1500) }))
    .max(8),
});
export function parseSpecialistOutput(raw: string) {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "");
  return specialistOutputSchema.parse(JSON.parse(trimmed));
}
export function specialistMarkdown(
  output: z.infer<typeof specialistOutputSchema>,
  sources: string[],
) {
  return [
    `# ${output.title}`,
    ...output.sections.map((s) => `## ${s.heading}\n\n${s.body}`),
    output.evidence_gaps.length
      ? `## Evidence gaps\n\n${output.evidence_gaps.map((s) => `- ${s}`).join("\n")}`
      : "",
    output.actions.length
      ? `## Proposed actions\n\n${output.actions.map((a) => `- **${a.title}** — ${a.rationale}`).join("\n")}`
      : "",
    sources.length ? `## Selected sources\n\n${sources.map((s) => `- ${s}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
