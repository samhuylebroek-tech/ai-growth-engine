// One pure pass that turns the organization view into its intelligence: cross-business opportunities, resource
// recommendations, specialist insights, monitoring and ranked next best actions. The Command Center and the
// Organization Growth Officer both use it, so the screen and the AI brief never disagree.
import type { OrgIntelData, OrgOverviewData } from "@/components/org/org-data";
import type { BusinessRef, OrgView } from "@/lib/org/overview";
import { detectOpportunities, type OppBusiness, type OppDraft } from "@/lib/org/opportunities";
import {
  allocationRecommendations,
  specialistInsights,
  type BudgetLineLite,
} from "@/lib/org/allocation";
import { monitorOrganization } from "@/lib/org/monitoring";
import { orgCandidates, rankActions } from "@/lib/org/priorities";
import { orgStrategyBodySchema } from "@/lib/org/strategy";

const OPEN = ["awaiting_approval", "queued", "paused", "running", "uncertain"];
type Scope = { userCanDecide: (workspaceId: string) => boolean };

export function orgIntelligence(
  d: OrgOverviewData,
  view: OrgView,
  businesses: readonly BusinessRef[],
  today: string,
  intel: OrgIntelData | null,
  scope: Scope = { userCanDecide: () => false },
) {
  const by = <T extends { workspace_id: string | null }>(rows: readonly T[], id: string) =>
    rows.filter((r) => r.workspace_id === id);
  const count = (rows: readonly { specialist_key: string }[]) =>
    rows.reduce<Record<string, number>>(
      (m, r) => ((m[r.specialist_key] = (m[r.specialist_key] ?? 0) + 1), m),
      {},
    );
  const oppBusinesses: OppBusiness[] = businesses.map((b) => ({
    ...b,
    profile: view.profiles.get(b.id)!,
    campaigns: by(d.campaigns, b.id).map((c) => ({
      title: c.title,
      status: c.status,
      channels: c.channels ?? [],
    })),
    budget: by(d.budget, b.id).map((l) => ({
      channel: l.channel,
      month: l.period_month,
      planned: Number(l.planned),
      currency: l.currency,
    })),
    experiments: by(d.experiments, b.id).map((e) => ({
      title: e.title,
      objective: e.objective,
      conclusion: e.conclusion ?? "",
      evidence_strength: e.evidence_strength,
    })),
    activeObjectives: by(d.goals, b.id)
      .filter((g) => g.status === "active")
      .map((g) => g.objective),
    specialistDone: count(by(d.runs, b.id).filter((r) => r.status === "succeeded")),
    specialistOpen: count(by(d.runs, b.id).filter((r) => OPEN.includes(r.status))),
  }));
  const tracked = new Set((intel?.opportunities ?? []).map((o) => o.rule_key).filter(Boolean));
  const allDrafts = detectOpportunities(oppBusinesses, view.findings);
  const drafts: OppDraft[] = allDrafts.filter((o) => !tracked.has(o.ruleKey));
  const lines: BudgetLineLite[] = d.budget.map((l) => ({
    id: l.id,
    workspace_id: l.workspace_id,
    channel: l.channel,
    period_month: l.period_month,
    planned: Number(l.planned),
    actual: Number(l.actual),
    hard_cap: l.hard_cap == null ? null : Number(l.hard_cap),
    currency: l.currency,
  }));
  const recs = allocationRecommendations(view.rows, lines, view.load, today);
  const insights = specialistInsights(view.load);
  const approved = intel?.strategies.find((s) => s.status === "approved") ?? null;
  const approvedBody = approved ? orgStrategyBodySchema.safeParse(approved.body) : null;
  const priorities = approvedBody?.success ? approvedBody.data.business_priorities : [];
  const activeGoals: Record<string, number> = {};
  for (const g of d.goals)
    if (g.status === "active") activeGoals[g.workspace_id] = (activeGoals[g.workspace_id] ?? 0) + 1;
  const monitor = monitorOrganization({
    rows: view.rows,
    findings: view.findings,
    insights,
    today,
    initiatives: (intel?.initiatives ?? []).map((i) => ({
      id: i.id,
      title: i.title,
      status: i.status,
      created_at: i.created_at,
      business_ids: i.business_ids,
    })),
    opportunities: (intel?.opportunities ?? []).map((o) => ({
      id: o.id,
      title: o.title,
      status: o.status,
      business_ids: o.business_ids,
    })),
    priorities,
    activeGoals,
    paused: d.settings.filter((s) => s.paused).map((s) => s.workspace_id),
  });
  const initiativeOpps = new Set(
    (intel?.initiatives ?? [])
      .filter((i) => !["declined", "cancelled"].includes(i.status))
      .map((i) => i.opportunity_id)
      .filter(Boolean),
  );
  const pending = {
    strategyDrafts: (intel?.strategies ?? []).filter((s) => s.status === "draft").length,
    commitmentsToDecide: (intel?.commitments ?? [])
      .filter((c) => c.status === "pending" && scope.userCanDecide(c.workspace_id))
      .map((c) => ({
        id: c.id,
        business: c.workspace_id,
        title: intel?.initiatives.find((i) => i.id === c.initiative_id)?.title ?? "",
      })),
    proposals: (intel?.proposals ?? [])
      .filter((p) => p.status === "pending")
      .map((p) => ({ id: p.id, title: p.title, businesses: p.business_ids })),
    validated: (intel?.opportunities ?? [])
      .filter((o) => o.status === "validated" && !initiativeOpps.has(o.id))
      .map((o) => ({ id: o.id, title: o.title, businesses: o.business_ids })),
  };
  const actions = rankActions(
    orgCandidates({ rows: view.rows, monitor, opportunities: drafts, recs, pending }),
    10,
  );
  return {
    drafts,
    allDrafts,
    recs,
    insights,
    monitor,
    actions,
    approved,
    approvedBody: approvedBody?.success ? approvedBody.data : null,
    pending,
  };
}
export type OrgIntelligence = ReturnType<typeof orgIntelligence>;
