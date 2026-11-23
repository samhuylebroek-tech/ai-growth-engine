// Campaign lifecycle (pure). Mirrors the transition rules of staging proposal 0083 (transition_campaign): which status
// may follow which, the role a caller needs, which moves need a written reason and what completion requires. The
// database enforces the same rules; this module only decides what the screen offers and explains.
export const CAMPAIGN_STATUSES = [
  "idea",
  "proposed",
  "draft",
  "awaiting_approval",
  "approved",
  "planned",
  "scheduled",
  "active",
  "paused",
  "needs_attention",
  "optimizing",
  "completed",
  "cancelled",
  "archived",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
/** Statuses the database accepted before proposal 0083 (the live database until it is approved). */
export const LEGACY_CAMPAIGN_STATUSES = [
  "planned",
  "active",
  "paused",
  "completed",
  "archived",
] as const;
export const INITIAL_CAMPAIGN_STATUSES = ["idea", "proposed", "draft"] as const;
export type CampaignOutcome = "achieved" | "partially_achieved" | "not_achieved" | "unknown";

const NEXT: Record<CampaignStatus, readonly CampaignStatus[]> = {
  idea: ["proposed", "draft", "cancelled"],
  proposed: ["draft", "awaiting_approval", "cancelled"],
  draft: ["awaiting_approval", "cancelled"],
  awaiting_approval: ["approved", "draft", "cancelled"],
  approved: ["planned", "scheduled", "active", "cancelled"],
  planned: ["awaiting_approval", "scheduled", "active", "paused", "cancelled"],
  scheduled: ["active", "paused", "cancelled"],
  active: ["paused", "needs_attention", "optimizing", "completed", "cancelled"],
  paused: ["active", "completed", "cancelled"],
  needs_attention: ["active", "optimizing", "paused", "completed", "cancelled"],
  optimizing: ["active", "paused", "completed", "cancelled"],
  completed: ["archived"],
  cancelled: ["archived"],
  archived: [],
};
export const isCampaignStatus = (s: string): s is CampaignStatus =>
  (CAMPAIGN_STATUSES as readonly string[]).includes(s);
export const transitionAllowed = (from: string, to: string) =>
  isCampaignStatus(from) && NEXT[from].includes(to as CampaignStatus);
/** Minimum business role to move a campaign into `to` from `from`: members propose, submit and stop; editors decide. */
export function transitionRole(from: string, to: string): "member" | "editor" {
  if (
    to === "proposed" ||
    to === "awaiting_approval" ||
    to === "paused" ||
    to === "needs_attention"
  )
    return "member";
  if (to === "draft" && (from === "idea" || from === "proposed")) return "member";
  return "editor";
}
export const transitionNeedsReason = (from: string, to: string) =>
  to === "paused" ||
  to === "cancelled" ||
  to === "needs_attention" ||
  (from === "awaiting_approval" && to === "draft");

const RANK: Record<string, number> = { owner: 5, admin: 4, editor: 3, member: 2, viewer: 1 };
export const roleRank = (role: string | null | undefined) => (role ? (RANK[role] ?? 0) : 0);

export type NextStep = {
  to: CampaignStatus;
  allowed: boolean;
  needsReason: boolean;
  role: "member" | "editor";
};
/** Every status that may follow `from`, marked with whether this caller's role may take the step. */
export function nextSteps(from: string, role: string | null | undefined): NextStep[] {
  if (!isCampaignStatus(from)) return [];
  return NEXT[from].map((to) => {
    const need = transitionRole(from, to);
    return {
      to,
      role: need,
      needsReason: transitionNeedsReason(from, to),
      allowed: roleRank(role) >= RANK[need]!,
    };
  });
}

export type KpiCampaign = {
  primary_kpi?: string | null;
  kpi_baseline?: number | string | null;
  kpi_target?: number | string | null;
  kpi_actual?: number | string | null;
  results: string;
};
const num = (v: number | string | null | undefined) =>
  v === null || v === undefined || v === "" ? null : Number(v);
/**
 * Why a completion would be refused, or null when it is acceptable. "Achieved" needs a recorded KPI value when the
 * campaign has a primary KPI, and that value must reach the target in the direction baseline → target.
 */
export function completionProblem(
  c: KpiCampaign,
  p: { outcome: string; resultsUnavailable: string; kpiActual: string },
): "result_required" | "outcome_required" | "outcome_unsupported" | "invalid_actual" | null {
  if (!c.results.trim() && !p.resultsUnavailable.trim()) return "result_required";
  if (!["achieved", "partially_achieved", "not_achieved", "unknown"].includes(p.outcome))
    return "outcome_required";
  const typed = p.kpiActual.trim() === "" ? null : Number(p.kpiActual.replace(",", "."));
  if (typed !== null && !Number.isFinite(typed)) return "invalid_actual";
  const actual = typed ?? num(c.kpi_actual);
  if (p.outcome === "achieved") {
    if ((c.primary_kpi ?? "").trim() && actual === null) return "outcome_unsupported";
    const base = num(c.kpi_baseline),
      target = num(c.kpi_target);
    if (actual !== null && base !== null && target !== null && target !== base) {
      if (target > base ? actual < target : actual > target) return "outcome_unsupported";
    }
  }
  return null;
}

export type LinkCampaign = {
  goal_id?: string | null;
  strategy_id?: string | null;
  initiative_id?: string | null;
  primary_kpi?: string | null;
  kpi_target?: number | string | null;
};
export type LinkGap = "no_goal" | "no_strategy" | "no_kpi" | "no_target";
/** What is missing for a campaign to be traceable to a goal and measurable. Nothing is inferred. */
export function linkGaps(c: LinkCampaign): LinkGap[] {
  const gaps: LinkGap[] = [];
  if (!c.goal_id) gaps.push("no_goal");
  if (!c.strategy_id && !c.initiative_id) gaps.push("no_strategy");
  if (!(c.primary_kpi ?? "").trim()) gaps.push("no_kpi");
  else if (num(c.kpi_target) === null) gaps.push("no_target");
  return gaps;
}

/** Phase used to group the board: preparing, running, stopped or finished. */
export function campaignPhase(status: string): "preparing" | "running" | "paused" | "finished" {
  if (["active", "needs_attention", "optimizing"].includes(status)) return "running";
  if (status === "paused") return "paused";
  if (["completed", "cancelled", "archived"].includes(status)) return "finished";
  return "preparing";
}
