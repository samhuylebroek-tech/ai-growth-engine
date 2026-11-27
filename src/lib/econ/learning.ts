// Recommendation learning (pure). Follows a recommendation (improvement proposal) from proposal to recorded learning
// and finds patterns only where enough comparable, actual learnings exist. Rules:
//   * stages come from recorded state only (task completion is not success; measurement is a separate step);
//   * simulated or estimated learnings never count as evidence for a pattern;
//   * a pattern needs at least 3 learnings from at least 2 different campaigns or businesses-periods; otherwise it is
//     "not enough observations"; confidence is qualitative and never "high" (before/after is not causal proof);
//   * learning informs recommendations; it never changes strategies, budgets, campaigns or targets by itself.
export type Stage =
  | "proposed"
  | "evidence_reviewed"
  | "approved"
  | "rejected"
  | "deferred"
  | "converted"
  | "assigned"
  | "execution_started"
  | "execution_completed"
  | "measurement_pending"
  | "measurement_completed"
  | "evaluated"
  | "learning_recorded"
  | "archived";
export const STAGES: Stage[] = [
  "proposed",
  "evidence_reviewed",
  "approved",
  "rejected",
  "deferred",
  "converted",
  "assigned",
  "execution_started",
  "execution_completed",
  "measurement_pending",
  "measurement_completed",
  "evaluated",
  "learning_recorded",
  "archived",
];

type Proposal = {
  id: string;
  status: string;
  reviewed_at?: string | null;
  outcome: string | null;
  measure_after: string | null;
  campaign_id: string | null;
  category: string;
  created_at: string;
};
type Task = { status: string; owner_id: string | null } | null;
export type Learning = {
  id: string;
  proposal_id: string;
  outcome_class: string;
  evidence_class: string;
  lever: string;
  channel: string;
  business_model: string;
  measured_change_pct: number | string | null;
  expected_cost: number | string | null;
  actual_cost: number | string | null;
  currency: string | null;
  expected_credits: number | null;
  actual_credits: number;
  days_to_result: number | null;
  execution_quality: string;
  created_at: string;
};

const DONE = ["done", "completed"];
const STARTED = ["in_progress", "doing", "review", "blocked"];
/** Furthest recorded stage. `assigned` means a person or specialist is on the task. */
export function stageOf(
  p: Proposal,
  task: Task,
  learnings: readonly Pick<Learning, "proposal_id">[],
  specialistAssigned: boolean,
  today: string,
): Stage {
  if (learnings.some((l) => l.proposal_id === p.id)) return "learning_recorded";
  if (p.status === "measured") return p.outcome ? "evaluated" : "measurement_completed";
  if (p.status === "rejected") return "rejected";
  if (p.status === "withdrawn") return "archived";
  if (p.status === "approved") return "approved";
  if (p.status === "proposed") return p.reviewed_at ? "evidence_reviewed" : "proposed";
  if (p.status === "converted") {
    // completed work waits for its measurement date before a measurement is due
    if (task && DONE.includes(task.status))
      return p.measure_after && p.measure_after > today
        ? "execution_completed"
        : "measurement_pending";
    if (task && STARTED.includes(task.status)) return "execution_started";
    if (task && (task.owner_id || specialistAssigned)) return "assigned";
    return "converted";
  }
  return "proposed";
}

export const MEASURED = ["positive", "negative", "no_change"];
export type Confidence = "not_enough" | "low" | "medium";
export type Pattern = {
  key: string;
  lever: string;
  channel: string;
  businessModel: string;
  observations: number;
  campaigns: number;
  positive: number;
  negative: number;
  noChange: number;
  from: string;
  to: string;
  consistency: number;
  confidence: Confidence;
  direction: "positive" | "negative" | "mixed";
  avgDaysToResult: number | null;
  costOverruns: number;
  limitations: string[];
  lastValidated: string;
};

/** Patterns per growth lever and channel over actual, measured learnings only. */
export function learningPatterns(
  learnings: readonly Learning[],
  proposals: readonly Pick<Proposal, "id" | "campaign_id" | "category">[],
): Pattern[] {
  const usable = learnings.filter(
    (l) => l.evidence_class === "actual" && MEASURED.includes(l.outcome_class),
  );
  // latest learning per proposal only (re-validation replaces, never adds an observation)
  const latest = new Map<string, Learning>();
  for (const l of usable) {
    const p = latest.get(l.proposal_id);
    if (!p || l.created_at > p.created_at) latest.set(l.proposal_id, l);
  }
  const groups = new Map<string, Learning[]>();
  for (const l of latest.values()) {
    const lever =
      l.lever || proposals.find((p) => p.id === l.proposal_id)?.category || "unspecified";
    const k = `${lever}|${l.channel.toLowerCase()}|${l.business_model}`;
    groups.set(k, [...(groups.get(k) ?? []), { ...l, lever }]);
  }
  return [...groups.entries()]
    .map(([key, ls]): Pattern => {
      const pos = ls.filter((l) => l.outcome_class === "positive").length,
        neg = ls.filter((l) => l.outcome_class === "negative").length;
      const nc = ls.length - pos - neg;
      const camps = new Set(
        ls.map(
          (l) => proposals.find((p) => p.id === l.proposal_id)?.campaign_id ?? `p:${l.proposal_id}`,
        ),
      ).size;
      const consistency = Math.round((Math.max(pos, neg, nc) / ls.length) * 100) / 100;
      const limitations: string[] = ["correlation_not_cause"];
      if (ls.length < 3) limitations.push("few_observations");
      if (camps < 2) limitations.push("single_campaign");
      if (consistency < 0.7) limitations.push("inconsistent");
      if (ls.some((l) => l.execution_quality === "poor"))
        limitations.push("poor_execution_included");
      const confidence: Confidence =
        ls.length < 3 || camps < 2 ? "not_enough" : consistency >= 0.7 ? "medium" : "low";
      const days = ls.map((l) => l.days_to_result).filter((d): d is number => d !== null);
      const dates = ls.map((l) => l.created_at.slice(0, 10)).sort();
      return {
        key,
        lever: ls[0]!.lever,
        channel: ls[0]!.channel,
        businessModel: ls[0]!.business_model,
        observations: ls.length,
        campaigns: camps,
        positive: pos,
        negative: neg,
        noChange: nc,
        from: dates[0]!,
        to: dates.at(-1)!,
        consistency,
        confidence,
        direction: (pos / ls.length >= 0.7
          ? "positive"
          : neg / ls.length >= 0.7
            ? "negative"
            : "mixed") as Pattern["direction"],
        avgDaysToResult: days.length
          ? Math.round(days.reduce((a, b) => a + b, 0) / days.length)
          : null,
        costOverruns: ls.filter(
          (l) =>
            l.expected_cost !== null &&
            l.actual_cost !== null &&
            Number(l.actual_cost) > Number(l.expected_cost) * 1.2,
        ).length,
        limitations,
        lastValidated: dates.at(-1)!,
      };
    })
    .sort((a, b) => b.observations - a.observations);
}

/** Expected versus actual for one learning; differences only where both sides were recorded. */
export function expectedVsActual(l: Learning) {
  const ec = l.expected_cost === null ? null : Number(l.expected_cost),
    ac = l.actual_cost === null ? null : Number(l.actual_cost);
  return {
    cost:
      ec !== null && ac !== null
        ? {
            expected: ec,
            actual: ac,
            diff: Math.round((ac - ec) * 100) / 100,
            currency: l.currency,
          }
        : null,
    credits:
      l.expected_credits !== null
        ? {
            expected: l.expected_credits,
            actual: l.actual_credits,
            diff: l.actual_credits - l.expected_credits,
          }
        : null,
    days: l.days_to_result,
    change: l.measured_change_pct === null ? null : Number(l.measured_change_pct),
  };
}

/** Outcomes a learning may record for a proposal; mirrors `record_recommendation_learning`: a positive, negative or
 *  no-change learning needs the recorded measurement that says so. Empty when the proposal has no work yet. */
export function allowedOutcomes(
  p: Pick<Proposal, "status" | "outcome">,
): Learning["outcome_class"][] {
  if (p.status === "measured") {
    if (p.outcome === "improved") return ["positive", "partially_executed"];
    if (p.outcome === "worse") return ["negative", "partially_executed"];
    if (p.outcome === "no_change") return ["no_change", "partially_executed"];
    return ["inconclusive", "insufficient_data", "measurement_unavailable", "partially_executed"];
  }
  if (p.status === "converted")
    return ["not_executed", "partially_executed", "insufficient_data", "measurement_unavailable"];
  return [];
}
