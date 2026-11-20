// One filtered business view (period, brand/unit, campaign, channel, strategy) over records read under the
// caller's RLS. Pure, so the Command Center, Business performance screens, tests and the Growth Officer agree.
import {
  attribute,
  revenueTotals,
  type Attribution,
  type Model,
  type RevenueEvent,
  type Touch,
} from "./attribution";
import {
  computeKpis,
  detectModels,
  metricInputs,
  periodRange,
  type DealLite,
  type Input,
  type Kpi,
  type PeriodKey,
} from "./kpis";
import { detectImprovements, type Candidate } from "./optimization";
import { growthActionsWithHidden, type GrowthAction } from "./growth-actions";
import type { RecDecision } from "@/lib/recommendation-memory";
import { proposalsOnConfirmedConflicts } from "@/lib/fact-conflicts";
import { understand, type Knowledge } from "./understanding";
import { progressOf, type Src } from "./comparison";
import { fromEvidenceItem, type NormalEvidence } from "@/lib/evidence";
import { evidenceFreshness, isStale, sourceState } from "@/lib/evidence-freshness";
import type { EvidenceItemRow, ProposalEvidenceRow } from "@/lib/pending-schema";
import type { Measurement } from "@/lib/performance";

export type Filters = {
  unit: string | null;
  campaign: string | null;
  channel: string | null;
  plan: string | null;
  period: PeriodKey;
};
export const NO_FILTERS: Filters = {
  unit: null,
  campaign: null,
  channel: null,
  plan: null,
  period: "last_month",
};

export type BiMetric = {
  id: string;
  key: string;
  label: string;
  unit: string;
  currency: string | null;
  direction: string;
  goal_id: string | null;
  initiative_id: string | null;
  campaign_id: string | null;
  unit_id: string | null;
  channel: string;
  category: string;
  archived: boolean;
};
export type BiData = {
  metrics: BiMetric[];
  measurements: (Measurement & { source: string })[];
  revenue: (RevenueEvent & { deal_id: string | null; note: string; created_at: string })[];
  touches: Touch[];
  units: { id: string; kind: string; name: string; parent_id: string | null; archived: boolean }[];
  goals: (Src["goals"][number] & { priority: string; status: string })[];
  plans: Src["plans"];
  initiatives: Src["initiatives"];
  operations: Src["operations"];
  campaigns: (Src["campaigns"][number] & { status: string })[];
  budget: Src["budget"];
  deals: (DealLite & { goal_id: string | null })[];
  tasks: (Src["tasks"][number] & { title: string })[];
  runs: Src["runs"];
  experiments: {
    id: string;
    title: string;
    status: string;
    evidence_strength: string | null;
    variant_value: number | null;
    control_value: number | null;
    updated_at: string;
    started_at: string | null;
    duration_days: number;
    unit_id: string | null;
  }[];
  proposals: {
    id: string;
    title: string;
    status: string;
    category: "immediate" | "strategic" | "opportunity" | "problem" | "experiment";
    required_level: string;
    measure_after: string | null;
    goal_id: string | null;
    est_credits: number | null;
    source_key: string;
    unit_id: string | null;
  }[];
  opportunities: {
    id: string;
    title: string;
    status: string;
    impact: number;
    feasibility: number;
    risk: number;
    time_to_value: number;
    confidence: string;
    evidence?: unknown;
  }[];
  profile: {
    business_model: string | null;
    description: string | null;
    industry: string | null;
    offerings: unknown;
    audiences: unknown;
    objectives: unknown;
    monthly_budget_eur: number | null;
  } | null;
  facts: {
    id?: string;
    key: string;
    value: string;
    verified: boolean;
    source_type?: string;
    source_ref?: string | null;
    created_at?: string;
  }[];
  connections: { connector_key: string; status: string; granted_levels: string[] }[];
  creditBalance: number | null;
  /** Proposal 0073; null when evidence governance is not installed in the connected database. */
  evidence?: EvidenceItemRow[] | null;
  proposalEvidence?: ProposalEvidenceRow[];
  /** Proposal 0075: remembered postpone/dismiss decisions; empty when not installed. */
  recDecisions?: RecDecision[];
};

export type ScopedMoney = { currency: string; amount: number }[];
export type View = {
  range: { from: string; to: string };
  models: ReturnType<typeof detectModels>;
  totals: ReturnType<typeof revenueTotals>;
  attribution: Attribution[];
  /** Attributed revenue for the selected campaign, channel or strategy (or everything), per currency. */
  scopedAttributed: ScopedMoney;
  scopeLabel: "all" | "campaign" | "channel" | "plan";
  kpis: Kpi[];
  inputs: Map<string, Input>;
  spend: ScopedMoney;
  plannedSpend: ScopedMoney;
  pipeline: ScopedMoney;
  closedWon: ScopedMoney;
  leadsFromPipeline: number;
  goals: { id: string; title: string; progress: number | null }[];
  credits: number;
  candidates: Candidate[];
  actions: GrowthAction[];
  /** Recommendations hidden by a postpone/dismiss decision, with that decision (for restoring). */
  hiddenActions: { action: GrowthAction; decision: RecDecision }[];
  understanding: Knowledge[];
  importedSources: string[];
  latestImport: string | null;
};

const sumBy = (rows: { currency: string; amount: number }[]): ScopedMoney => {
  const m = new Map<string, number>();
  for (const r of rows)
    m.set(r.currency, Math.round(((m.get(r.currency) ?? 0) + r.amount) * 100) / 100);
  return [...m]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => ({ currency, amount }));
};
const inRange = (iso: string | null | undefined, from: string, to: string) =>
  !!iso && iso.slice(0, 10) >= from && iso.slice(0, 10) <= to;

export function buildView(d: BiData, f: Filters, model: Model, now: Date = new Date()): View {
  const range = periodRange(f.period, now);
  const plan = f.plan ? d.plans.find((p) => p.id === f.plan) : undefined;
  const planInits = new Set(
    d.initiatives.filter((n) => n.plan_version_id === f.plan).map((n) => n.id),
  );
  const planProjects = new Set(
    d.initiatives
      .filter((n) => n.plan_version_id === f.plan)
      .map((n) => n.project_id)
      .filter(Boolean) as string[],
  );
  const ch = f.channel?.trim().toLowerCase() ?? null;

  const revenue = d.revenue.filter((e) => !f.unit || e.unit_id === f.unit);
  const saleIds = new Set(revenue.map((e) => e.id));
  const touches = d.touches.filter((t) => saleIds.has(t.revenue_event_id));
  const totals = revenueTotals(revenue, range.from, range.to);
  const attribution = attribute(revenue, touches, model, range.from, range.to);
  const byChannel = ch ? attribute(revenue, touches, model, range.from, range.to, "channel") : [];
  const scopeLabel: View["scopeLabel"] = f.campaign
    ? "campaign"
    : ch
      ? "channel"
      : f.plan
        ? "plan"
        : "all";
  const scopedAttributed = sumBy(
    scopeLabel === "campaign"
      ? attribution.flatMap((a) =>
          a.credits
            .filter((c) => c.key === `campaign:${f.campaign}`)
            .map((c) => ({ currency: a.currency, amount: c.amount })),
        )
      : scopeLabel === "channel"
        ? byChannel.flatMap((a) =>
            a.credits
              .filter((c) => c.key === `channel:${ch}`)
              .map((c) => ({ currency: a.currency, amount: c.amount })),
          )
        : scopeLabel === "plan"
          ? attribution.flatMap((a) =>
              a.credits
                .filter((c) => c.key.startsWith("initiative:") && planInits.has(c.key.slice(11)))
                .map((c) => ({ currency: a.currency, amount: c.amount })),
            )
          : attribution.map((a) => ({ currency: a.currency, amount: a.attributed })),
  );

  const metrics = d.metrics.filter(
    (m) =>
      !m.archived &&
      (!f.unit || m.unit_id === f.unit) &&
      (!f.campaign || m.campaign_id === f.campaign) &&
      (!ch || m.channel.trim().toLowerCase() === ch) &&
      (!plan ||
        m.goal_id === plan.goal_id ||
        (m.initiative_id !== null && planInits.has(m.initiative_id))),
  );
  const inputs = metricInputs(metrics, d.measurements, range.from, range.to);
  const attributedMap = new Map(scopedAttributed.map((x) => [x.currency, x.amount]));
  const models = detectModels([
    d.profile?.business_model,
    d.profile?.industry,
    d.profile?.description,
    ...d.facts.filter((x) => x.verified && x.key === "business_model").map((x) => x.value),
  ]);
  const deals = d.deals.filter((x) => !plan || x.goal_id === plan.goal_id);
  const kpis = computeKpis({
    inputs,
    deals,
    attributed: attributedMap,
    models,
    from: range.from,
    to: range.to,
  });

  const budget = d.budget.filter(
    (b) =>
      inRange(b.period_month, range.from, range.to) &&
      (!ch || b.channel.trim().toLowerCase() === ch) &&
      (!plan || (b.initiative_id && planInits.has(b.initiative_id)) || b.goal_id === plan.goal_id),
  );
  const spend = sumBy(budget.map((b) => ({ currency: b.currency, amount: Number(b.actual) })));
  const plannedSpend = sumBy(
    budget.map((b) => ({ currency: b.currency, amount: Number(b.planned) })),
  );
  const OPEN = new Set(["lead", "qualified", "proposal", "negotiation"]);
  const pipeline = sumBy(
    deals
      .filter((x) => OPEN.has(x.stage))
      .map((x) => ({ currency: x.currency, amount: Number(x.value) })),
  );
  const closedWon = sumBy(
    deals
      .filter((x) => x.stage === "won" && inRange(x.closed_at, range.from, range.to))
      .map((x) => ({ currency: x.currency, amount: Number(x.value) })),
  );
  const leadsFromPipeline = deals.filter((x) => inRange(x.created_at, range.from, range.to)).length;

  const taskIds = new Set(
    d.tasks
      .filter(
        (t) =>
          (!f.campaign || t.campaign_id === f.campaign) &&
          (!plan || (t.project_id !== null && planProjects.has(t.project_id))),
      )
      .map((t) => t.id),
  );
  const credits = d.runs
    .filter(
      (r) =>
        inRange(r.created_at, range.from, range.to) &&
        (!f.campaign && !plan ? true : taskIds.has(r.task_id)),
    )
    .reduce((s, r) => s + (r.credits_charged ?? 0), 0);
  const goals = d.goals
    .filter((g) => g.status === "active" && (!plan || g.id === plan.goal_id))
    .map((g) => ({
      id: g.id,
      title: g.title,
      progress: progressOf(g.baseline, g.target, g.current_value),
    }));

  const proposals = d.proposals.filter((p) => !f.unit || p.unit_id === f.unit);
  const experiments = d.experiments.filter((x) => !f.unit || x.unit_id === f.unit);
  const candidates = detectImprovements({
    metrics,
    measurements: d.measurements,
    budget: d.budget,
    goals: d.goals,
    attribution: attribute(revenue, touches, model, range.from, range.to, "channel"),
    experiments,
    proposals,
    now,
  });
  const budgetLeft = new Map(
    plannedSpend.map((p) => [
      p.currency,
      p.amount - (spend.find((s) => s.currency === p.currency)?.amount ?? 0),
    ]),
  );
  const { actions, hidden: hiddenActions } = growthActionsWithHidden({
    candidates,
    proposalEvidence: linkedEvidence(d),
    conflictedProposals: proposalsOnConfirmedConflicts(
      d.facts.filter((f) => f.id).map((f) => ({ ...f, id: f.id!, source_type: f.source_type ?? "user" })),
      d.evidence ?? [],
      d.proposalEvidence ?? [],
    ),
    decisions: d.recDecisions ?? [],
    proposals,
    experiments,
    opportunities: d.opportunities,
    goalPriority: new Map(d.goals.map((g) => [g.id, g.priority])),
    budgetLeft,
    creditBalance: d.creditBalance,
    openWork: d.tasks.filter((t) => t.status === "in_progress").length,
    grantedBudgetLevel: d.connections.some(
      (c) => c.status === "connected" && c.granted_levels.includes("budget"),
    ),
    now,
  });
  const understanding = understand({
    facts: d.facts,
    profile: d.profile,
    hasRevenue: d.revenue.length > 0,
    hasDeals: d.deals.length > 0,
    hasRetentionMetric: d.metrics.some(
      (m) =>
        ["active_customers", "churned_customers", "returning_customers"].includes(m.key) ||
        m.category === "retention",
    ),
    hasMarginMetric: d.metrics.some((m) => m.key === "gross_margin"),
    hasBudget: d.budget.length > 0,
    hasMarketingMetric: d.metrics.some((m) => m.category === "marketing"),
    hasGoals: d.goals.length > 0,
  });
  const imported = d.revenue.filter((e) => e.data_class === "imported");
  return {
    range,
    models,
    totals,
    attribution,
    scopedAttributed,
    scopeLabel,
    kpis,
    inputs,
    spend,
    plannedSpend,
    pipeline,
    closedWon,
    leadsFromPipeline,
    goals,
    credits,
    candidates,
    actions,
    hiddenActions,
    understanding,
    importedSources: [...new Set(imported.map((e) => e.source))],
    latestImport:
      imported
        .map((e) => e.created_at)
        .sort()
        .at(-1) ?? null,
  };
}

/** Records the caller could read, to tell whether the record behind a piece of evidence still exists / is confirmed. */
// A list read up to its limit may be incomplete, so a record absent from it is "unknown", never "missing".
export const SOURCE_READ_LIMITS = { facts: 200, measurements: 5000 } as const;
export function knownSources(d: Partial<Pick<BiData, "facts" | "measurements" | "revenue">>) {
  return {
    ...(d.facts && d.facts.length < SOURCE_READ_LIMITS.facts
      ? { facts: new Map(d.facts.filter((f) => f.id).map((f) => [f.id!, f.verified])) }
      : {}),
    ...(d.measurements && d.measurements.length < SOURCE_READ_LIMITS.measurements
      ? { measurements: new Set(d.measurements.map((m) => m.id)) }
      : {}),
    ...(d.revenue ? { revenue: new Set(d.revenue.map((r) => r.id)) } : {}),
  };
}

/** Linked evidence per improvement proposal, normalized (rejected and superseded versions drop out). */
export function linkedEvidence(
  d: Pick<BiData, "evidence" | "proposalEvidence"> &
    Partial<Pick<BiData, "facts" | "measurements" | "revenue">>,
  now: Date = new Date(),
): Map<string, NormalEvidence[]> {
  const byId = new Map((d.evidence ?? []).map((e) => [e.id, e]));
  const known = knownSources(d);
  const out = new Map<string, NormalEvidence[]>();
  for (const l of d.proposalEvidence ?? []) {
    const e = byId.get(l.evidence_id);
    const n = e
      ? fromEvidenceItem(
          e,
          l.role,
          isStale(evidenceFreshness({ ...e, source: sourceState(e, known) }, now).level),
        )
      : null;
    if (n) out.set(l.proposal_id, [...(out.get(l.proposal_id) ?? []), n]);
  }
  return out;
}
