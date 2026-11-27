// Evidence freshness (pure). How current a piece of evidence is depends on what it is: last month's ad results
// age quickly, a business fact stays valid but should be reconfirmed yearly, and a recorded sale, closed deal or
// finished experiment is history that stays true however old it is. A source record that was deleted or is no
// longer confirmed is flagged, never silently trusted. Freshness only explains; the database stays the authority.
import type { EvidenceType, SourceKind } from "@/lib/evidence";

export type Freshness = "current" | "updated" | "outdated" | "expired" | "unavailable" | "verify";
/** What we know about the record behind the evidence. "unknown" when the screen cannot check that kind of source. */
export type SourceState = "found" | "missing" | "unconfirmed" | "unknown";

/** Records of something that happened: they never expire. */
export const HISTORICAL: readonly SourceKind[] = ["revenue_event", "crm_deal", "experiment"];
/** [days until outdated, days until expired] per source; Infinity = never expires (reconfirm instead). */
export const WINDOWS: Record<SourceKind, readonly [number, number]> = {
  measurement: [60, 180],
  budget_line: [45, 120],
  seo_audit: [90, 365],
  competitor_observation: [90, 270],
  website: [180, 540],
  business_fact: [365, Infinity],
  document: [365, 730],
  user_statement: [180, 540],
  ai_analysis: [30, 90],
  other: [180, 540],
  revenue_event: [Infinity, Infinity],
  crm_deal: [Infinity, Infinity],
  experiment: [Infinity, Infinity],
};
const SOFT: readonly EvidenceType[] = ["estimate", "assumption", "hypothesis"];
const DAY = 86_400_000;

export type FreshnessInput = {
  evidence_type: EvidenceType | null;
  source_kind: SourceKind;
  collected_at: string;
  period_end?: string | null;
  version_no?: number;
  updated_at?: string | null;
  source?: SourceState;
};
export type FreshnessResult = { level: Freshness; historical: boolean; ageDays: number };

export function evidenceFreshness(e: FreshnessInput, now: Date = new Date()): FreshnessResult {
  const ref = Date.parse(e.period_end ? `${e.period_end.slice(0, 10)}T23:59:59Z` : e.collected_at);
  const ageDays = Number.isFinite(ref) ? Math.max(0, Math.floor((now.getTime() - ref) / DAY)) : 0;
  const historical = HISTORICAL.includes(e.source_kind);
  const res = (level: Freshness): FreshnessResult => ({ level, historical, ageDays });
  if (e.source === "missing") return res("unavailable");
  if (e.source === "unconfirmed") return res("verify");
  if (e.evidence_type === "missing_information" || historical) return res("current");
  const [fresh, expire] = WINDOWS[e.source_kind] ?? WINDOWS.other;
  if (ageDays > expire)
    return res(SOFT.includes(e.evidence_type as EvidenceType) ? "verify" : "expired");
  if (ageDays > fresh)
    return res(
      e.source_kind === "business_fact" || SOFT.includes(e.evidence_type as EvidenceType)
        ? "verify"
        : "outdated",
    );
  const touched = e.updated_at ? Date.parse(e.updated_at) : NaN;
  if ((e.version_no ?? 1) > 1 && Number.isFinite(touched) && now.getTime() - touched <= 14 * DAY)
    return res("updated");
  return res("current");
}

/** Evidence that should no longer count as a fact or measurement until someone refreshes or reconfirms it. */
export const isStale = (f: Freshness) => f === "expired" || f === "unavailable" || f === "verify";

/** Looks up the record behind an evidence item in data the caller already read under its own access rights. */
export function sourceState(
  e: { source_kind: SourceKind; source_ref: string },
  known: {
    facts?: ReadonlyMap<string, boolean>;
    measurements?: ReadonlySet<string>;
    revenue?: ReadonlySet<string>;
  },
): SourceState {
  if (!e.source_ref) return "unknown";
  if (e.source_kind === "business_fact" && known.facts) {
    const v = known.facts.get(e.source_ref);
    return v === undefined ? "missing" : v ? "found" : "unconfirmed";
  }
  if (e.source_kind === "measurement" && known.measurements)
    return known.measurements.has(e.source_ref) ? "found" : "missing";
  if (e.source_kind === "revenue_event" && known.revenue)
    return known.revenue.has(e.source_ref) ? "found" : "missing";
  return "unknown";
}
