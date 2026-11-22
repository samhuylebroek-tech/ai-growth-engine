// What AI Growth Engine knows about a business, area by area (pure, no AI call).
// Each area is confirmed, inferred (found but not yet confirmed), estimated (an AI guess), conflicting, outdated,
// missing or unknown. "Missing" is only said after a complete read of the business facts; an incomplete read gives
// "unknown", so nothing is reported as absent that might exist. Profile fields count as confirmed because they are
// only written by the atomic confirmation (confirm_business_profile).
import { DISCOVERY_FIELDS } from "@/lib/discovery";
import { factTopic, type FactConflict, type FactRow } from "@/lib/fact-conflicts";
import { WINDOWS } from "@/lib/evidence-freshness";

export type UnderstandingStatus = "confirmed" | "inferred" | "estimated" | "conflicting" | "outdated" | "missing" | "unknown";
export type AreaKey = (typeof DISCOVERY_FIELDS)[number]["key"] | "website" | "objectives" | "budget";
export type Area = {
  key: AreaKey;
  status: UnderstandingStatus;
  /** The website check can look for this area; otherwise a person has to tell us. */
  discoverable: boolean;
};
export type ProfileLike = {
  website?: string | null;
  description?: string | null;
  industry?: string | null;
  business_model?: string | null;
  offerings?: unknown;
  audiences?: unknown;
  markets?: unknown;
  competitors?: unknown;
  objectives?: unknown;
  monthly_budget_eur?: number | null;
  updated_at?: string | null;
  onboarding_completed_at?: string | null;
} | null;
type Fact = FactRow & { created_at?: string | null };

/** The order a newcomer reads them in: who you are, what you sell, to whom, how you grow, what you want. */
export const AREAS: readonly AreaKey[] = [
  "company_identity", "description", "website", "industry", "business_model", "offerings", "audiences", "markets",
  "usps", "positioning", "tone", "competitors", "channels", "objectives", "budget",
];
const PROFILE_FIELD: Partial<Record<AreaKey, keyof NonNullable<ProfileLike>>> = {
  website: "website", description: "description", industry: "industry", business_model: "business_model",
  offerings: "offerings", audiences: "audiences", markets: "markets", competitors: "competitors",
  objectives: "objectives", budget: "monthly_budget_eur",
};
const DAY = 86_400_000;
/** Same window as evidence freshness for business facts. */
export const OUTDATED_DAYS = WINDOWS.business_fact[0];

const present = (v: unknown) =>
  Array.isArray(v) ? v.some((x) => typeof x === "string" && x.trim()) : typeof v === "number" ? v > 0 : typeof v === "string" ? !!v.trim() : false;
const label = (k: AreaKey) => DISCOVERY_FIELDS.find((f) => f.key === k)?.label ?? null;
const older = (iso: string | null | undefined, now: Date) => !!iso && now.getTime() - new Date(iso).getTime() > OUTDATED_DAYS * DAY;

export function businessUnderstanding(
  profile: ProfileLike,
  facts: readonly Fact[],
  conflicts: readonly FactConflict[],
  complete: boolean,
  now: Date = new Date(),
): Area[] {
  const conflictTopics = new Set(conflicts.map((c) => c.topic));
  return AREAS.map((key) => {
    const discoverable = DISCOVERY_FIELDS.some((f) => f.key === key);
    const l = label(key);
    const topics = new Set([factTopic(key.replace(/_/g, " ")), ...(l ? [factTopic(l)] : [])]);
    const onTopic = facts.filter((f) => topics.has(factTopic(f.key)));
    const field = PROFILE_FIELD[key];
    const inProfile = !!profile && !!field && present(profile[field]);
    const verified = onTopic.filter((f) => f.verified);
    let status: UnderstandingStatus;
    // A conflict found in part of the facts is still a real conflict.
    if ([...topics].some((t) => conflictTopics.has(t))) status = "conflicting";
    else if (inProfile || verified.length) {
      const newest = [
        ...(inProfile ? [profile?.updated_at ?? profile?.onboarding_completed_at ?? null] : []),
        ...verified.map((f) => f.created_at ?? null),
      ].filter((x): x is string => !!x).sort().at(-1);
      status = older(newest, now) ? "outdated" : "confirmed";
    } else if (onTopic.some((f) => f.source_type !== "ai_assumption")) status = "inferred";
    else if (onTopic.length) status = "estimated";
    else status = complete ? "missing" : "unknown";
    return { key, status, discoverable };
  });
}

export function understandingCounts(areas: readonly Area[]): Record<UnderstandingStatus, number> {
  const c: Record<UnderstandingStatus, number> = { confirmed: 0, inferred: 0, estimated: 0, conflicting: 0, outdated: 0, missing: 0, unknown: 0 };
  for (const a of areas) c[a.status]++;
  return c;
}
