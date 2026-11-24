import { spendSummary } from "@/lib/campaign-spend";
import type { CampaignSpendRow } from "@/lib/pending-schema";

export const CAMPAIGN_FILTERS = ["all", "active", "preparing", "planned", "awaiting", "paused", "completed", "at_risk"] as const;
export type CampaignFilter = (typeof CAMPAIGN_FILTERS)[number];

/** Display groups only: never changes lifecycle rules or the stored status. */
export function matchesCampaignFilter(status: string, filter: CampaignFilter, atRisk = false): boolean {
  switch (filter) {
    case "all": return true;
    case "active": return ["active", "optimizing", "needs_attention"].includes(status);
    case "preparing": return ["idea", "proposed", "draft"].includes(status);
    case "planned": return ["approved", "planned", "scheduled"].includes(status);
    case "awaiting": return status === "awaiting_approval";
    case "paused": return status === "paused";
    case "completed": return ["completed", "archived", "cancelled"].includes(status);
    case "at_risk": return status === "needs_attention" || atRisk;
  }
}

/** No tasks means no recorded work progress, not a fictional zero percent. */
export function campaignWorkProgress(tasks: readonly { status: string }[]): number | null {
  const relevant = tasks.filter((t) => t.status !== "cancelled");
  return relevant.length ? Math.round(100 * relevant.filter((t) => t.status === "done").length / relevant.length) : null;
}

/** An unavailable ledger must remain unknown; reuse the authoritative per-currency classification. */
export function campaignOverviewMoney(budget: number, entries: readonly CampaignSpendRow[] | undefined) {
  return entries === undefined ? null : spendSummary(budget, entries);
}