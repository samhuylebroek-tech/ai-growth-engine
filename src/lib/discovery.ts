import { z } from "zod";

export const DISCOVERY_FIELDS = [
  { key: "company_identity", label: "Company identity" },
  { key: "description", label: "Business description" },
  { key: "industry", label: "Industry" },
  { key: "business_model", label: "Business model" },
  { key: "offerings", label: "Products & services" },
  { key: "audiences", label: "Target audiences" },
  { key: "markets", label: "Markets" },
  { key: "positioning", label: "Brand positioning" },
  { key: "tone", label: "Tone of voice" },
  { key: "usps", label: "Unique selling points" },
  { key: "competitors", label: "Competitors" },
  { key: "channels", label: "Marketing channels" },
] as const;
export const DiscoverySchema = z.object({
  facts: z.array(z.object({
    key: z.enum(["company_identity", "description", "industry", "business_model", "offerings", "audiences", "markets", "positioning", "tone", "usps", "competitors", "channels"]),
    value: z.string().trim().min(1).max(3000), confidence: z.number().min(0).max(1),
    provenance: z.enum(["extracted", "assumption"]), source: z.string().max(500),
  })).max(12),
  suggestions: z.array(z.object({
    category: z.enum(["audiences", "markets", "seo", "content", "social", "conversion", "revenue", "positioning"]),
    title: z.string().min(3).max(120), value: z.string().min(1).max(1000),
    confidence: z.number().min(0).max(1), source: z.string().max(500),
  })).max(8),
});
export type Discovery = z.infer<typeof DiscoverySchema>;
export type DiscoveryFact = Discovery["facts"][number];

export function parseDiscovery(text: string, sources: string[]): Discovery {
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error("The website analysis returned no readable findings.");
  const result = DiscoverySchema.parse(JSON.parse(json));
  const seen = new Set<string>();
  return {
    facts: result.facts.filter(f => { if (seen.has(f.key)) return false; seen.add(f.key); return true; }).map(f => ({
      ...f, source: sources.includes(f.source) ? f.source : "", provenance: sources.includes(f.source) ? f.provenance : "assumption",
    })),
    suggestions: result.suggestions.map(s => ({ ...s, source: sources.includes(s.source) ? s.source : "" })),
  };
}

export function approvedContextFacts<T extends { verified: boolean }>(facts: T[]): T[] {
  return facts.filter(f => f.verified);
}