import { z } from "zod";
import { CHANNELS } from "@/lib/content";

export const repurposeItemSchema = z.object({
  channel: z.enum(CHANNELS),
  title: z
    .string()
    .trim()
    .min(1)
    .transform((s) => s.slice(0, 200)),
  body: z.string().trim().min(1).max(20000),
});
/** Keeps only one item per requested channel, in the requested order. */
export function parseRepurpose(raw: string, channels: readonly string[]) {
  const s = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");
  const items = z
    .object({ items: z.array(repurposeItemSchema).max(12) })
    .parse(JSON.parse(s)).items;
  return channels
    .map((c) => items.find((i) => i.channel === c))
    .filter((i): i is z.infer<typeof repurposeItemSchema> => !!i);
}
export const REPURPOSE_INSTRUCTIONS = `Adapt the source content for each requested channel, following channel conventions (length, structure, hooks, calls to action) and the writing profile.
Keep every factual claim from the source unchanged; do not add new statistics, customers, prices or promises. If a channel needs a claim the source lacks, write [needs source].
Return ONLY JSON: {"items":[{"channel":one of the requested channels,"title":string,"body":string}]}`;
