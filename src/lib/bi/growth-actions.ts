// Next Best Growth Actions: one transparent ranking over improvement findings, approved proposals awaiting work,
// experiments and discovered opportunities. Pure; every score is the visible weighted sum of its components.
import type { Candidate, Category } from "./optimization";
import {
  evidenceQuality,
  experimentQuality,
  fromClassified,
  fromDrafts,
  type NormalEvidence,
  type Quality,
} from "@/lib/evidence";

/** Evidence quality caps the confidence component, so a weakly supported item never ranks as if it were proven. */
export const QUALITY_CONFIDENCE: Record<Quality, number> = {
  strong: 5,
  some: 4,
  limited: 3,
  hypothesis: 2,
  missing: 1,
};

export type Components = {
  value: number;
  importance: number;
  urgency: number;
  confidence: number;
  feasibility: number;
  risk: number;
};
export const WEIGHTS: Components = {
  value: 0.3,
  importance: 0.2,
  urgency: 0.2,
  confidence: 0.15,
  feasibility: 0.15,
  risk: -0.1,
};
export type ActionKind =
  | "finding"
  | "convert_proposal"
  | "decide_proposal"
  | "measure_proposal"
  | "start_experiment"
  | "close_experiment"
  | "opportunity";
export type Delay =
  | "cost_keeps_rising"
  | "target_missed"
  | "budget_overrun_grows"
  | "advantage_lost"
  | "learning_unused"
  | "blind_spot_stays"
  | "work_waits"
  | "result_unknown"
  | "opportunity_ages";
export type GrowthAction = {
  id: string;
  kind: ActionKind;
  category: Category;
  code: string;
  vars: Record<string, string | number>;
  components: Components;
  score: number;
  delay: Delay;
  to:
    | "/app/improvements"
    | "/app/experiments"
    | "/app/opportunities"
    | "/app/revenue"
    | "/app/performance";
  blockers: ("no_budget" | "low_credits" | "busy_team" | "needs_approval" | "needs_permission")[];
  /** Evidence behind the item (proposal 0073 labels); "uncertain" ranks are shown as indicative only. */
  quality: Quality;
  uncertain: boolean;
  /** Other suggestions about the same thing that were folded into this one (ids), so nothing is shown twice. */
  alsoSuggested?: string[];
};

export type ActionInput = {
  candidates: readonly Candidate[];
  proposals: readonly {
    id: string;
    title: string;
    status: string;
    category: Category;
    required_level: string;
    measure_after: string | null;
    goal_id: string | null;
    est_credits: number | null;
  }[];
  experiments: readonly {
    id: string;
    title: string;
    status: string;
    started_at: string | null;
    duration_days: number;
    evidence_strength?: string | null;
  }[];
  opportunities: readonly {
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
  /** Linked evidence per improvement proposal, normalized; missing entries mean no linked evidence. */
  proposalEvidence?: ReadonlyMap<string, readonly NormalEvidence[]>;
  goalPriority: ReadonlyMap<string, string>;
  budgetLeft: ReadonlyMap<string, number>;
  creditBalance: number | null;
  openWork: number;
  grantedBudgetLevel: boolean;
  now: Date;
};

const clamp = (v: number) => Math.max(0, Math.min(5, Math.round(v * 10) / 10));
export const scoreOf = (c: Components) =>
  Math.round(
    ((c.value * WEIGHTS.value +
      c.importance * WEIGHTS.importance +
      c.urgency * WEIGHTS.urgency +
      c.confidence * WEIGHTS.confidence +
      c.feasibility * WEIGHTS.feasibility +
      c.risk * WEIGHTS.risk) /
      5) *
      1000,
  ) / 10;

const VALUE: Record<string, number> = {
  metric_behind: 4,
  metric_ahead: 3,
  budget_overspent: 3,
  cost_per_lead_rising: 4,
  best_channel: 4,
  unattributed_revenue: 3,
  roll_out_experiment: 4,
  goal_without_metric: 3,
};
const URGENCY: Record<Category, number> = {
  immediate: 5,
  problem: 4,
  strategic: 2,
  opportunity: 3,
  experiment: 2,
};
const DELAY: Record<string, Delay> = {
  metric_behind: "target_missed",
  metric_ahead: "advantage_lost",
  budget_overspent: "budget_overrun_grows",
  cost_per_lead_rising: "cost_keeps_rising",
  best_channel: "advantage_lost",
  unattributed_revenue: "blind_spot_stays",
  roll_out_experiment: "learning_unused",
  goal_without_metric: "blind_spot_stays",
};
const IMPORTANCE: Record<string, number> = { urgent: 5, high: 4, medium: 3, low: 2 };

export function nextGrowthActions(i: ActionInput, limit = 8): GrowthAction[] {
  const out: GrowthAction[] = [];
  const busy = i.openWork > 25;
  const lowCredits = i.creditBalance !== null && i.creditBalance < 10;
  const anyBudget = [...i.budgetLeft.values()].some((v) => v > 0);
  const feas = (needsBudget: boolean, needsAi: boolean, needsApproval: boolean) => {
    let f = 5;
    const b: GrowthAction["blockers"] = [];
    if (needsBudget && !anyBudget) {
      f -= 2;
      b.push("no_budget");
    }
    if (needsBudget && !i.grantedBudgetLevel) {
      f -= 1;
      b.push("needs_permission");
    }
    if (needsAi && lowCredits) {
      f -= 1.5;
      b.push("low_credits");
    }
    if (busy) {
      f -= 1;
      b.push("busy_team");
    }
    if (needsApproval) {
      f -= 0.5;
      b.push("needs_approval");
    }
    return { f: clamp(f), b };
  };
  const q = (quality: Quality) => ({
    quality,
    uncertain: quality !== "strong" && quality !== "some",
  });
  for (const c of i.candidates) {
    const fe = feas(c.requiredLevel === "budget", false, true);
    const quality = evidenceQuality(fromDrafts(c.records)).level;
    const comp: Components = {
      value: VALUE[c.code] ?? 3,
      importance: c.goalId ? (IMPORTANCE[i.goalPriority.get(c.goalId) ?? "medium"] ?? 3) : 2,
      urgency: URGENCY[c.category],
      confidence: Math.min(clamp(c.confidence * 5), QUALITY_CONFIDENCE[quality]),
      feasibility: fe.f,
      risk: c.requiredLevel === "budget" ? 3 : 1,
    };
    out.push({
      id: `finding:${c.sourceKey}`,
      kind: "finding",
      category: c.category,
      code: c.code,
      vars: c.vars,
      components: comp,
      score: scoreOf(comp),
      delay: DELAY[c.code] ?? "work_waits",
      to: "/app/improvements",
      blockers: fe.b,
      ...q(quality),
    });
  }
  for (const p of i.proposals) {
    const imp = p.goal_id ? (IMPORTANCE[i.goalPriority.get(p.goal_id) ?? "medium"] ?? 3) : 2;
    const pq = evidenceQuality(i.proposalEvidence?.get(p.id) ?? []).level;
    if (p.status === "proposed" || p.status === "approved") {
      const fe = feas(
        p.required_level === "budget",
        (p.est_credits ?? 0) > 0,
        p.status === "proposed",
      );
      const comp: Components = {
        value: 3.5,
        importance: imp,
        urgency: URGENCY[p.category] ?? 3,
        confidence: Math.min(3, QUALITY_CONFIDENCE[pq]),
        feasibility: fe.f,
        risk: p.required_level === "budget" ? 3 : 1,
      };
      out.push({
        id: `proposal:${p.id}`,
        kind: p.status === "approved" ? "convert_proposal" : "decide_proposal",
        category: p.category,
        code: p.status === "approved" ? "convert_proposal" : "decide_proposal",
        vars: { title: p.title },
        components: comp,
        score: scoreOf(comp),
        delay: "work_waits",
        to: "/app/improvements",
        blockers: fe.b,
        ...q(pq),
      });
    } else if (
      p.status === "converted" &&
      p.measure_after &&
      p.measure_after <= i.now.toISOString().slice(0, 10)
    ) {
      const comp: Components = {
        value: 3,
        importance: imp,
        urgency: 3,
        confidence: 4,
        feasibility: 5,
        risk: 0,
      };
      out.push({
        id: `measure:${p.id}`,
        kind: "measure_proposal",
        category: "strategic",
        code: "measure_proposal",
        vars: { title: p.title },
        components: comp,
        score: scoreOf(comp),
        delay: "result_unknown",
        to: "/app/improvements",
        blockers: [],
        ...q(pq),
      });
    }
  }
  for (const x of i.experiments) {
    if (x.status === "approved") {
      const fe = feas(false, false, false);
      const comp: Components = {
        value: 3,
        importance: 2,
        urgency: 2,
        confidence: 3,
        feasibility: fe.f,
        risk: 1,
      };
      out.push({
        id: `experiment:${x.id}`,
        kind: "start_experiment",
        category: "experiment",
        code: "start_experiment",
        vars: { title: x.title },
        components: comp,
        score: scoreOf(comp),
        delay: "learning_unused",
        to: "/app/experiments",
        blockers: fe.b,
        ...q(experimentQuality(x.status, x.evidence_strength ?? null)),
      });
    } else if (
      x.status === "running" &&
      x.started_at &&
      new Date(x.started_at).getTime() + x.duration_days * 86_400_000 <= i.now.getTime()
    ) {
      const comp: Components = {
        value: 3.5,
        importance: 2,
        urgency: 4,
        confidence: 4,
        feasibility: 5,
        risk: 0,
      };
      out.push({
        id: `experiment_due:${x.id}`,
        kind: "close_experiment",
        category: "experiment",
        code: "close_experiment",
        vars: { title: x.title },
        components: comp,
        score: scoreOf(comp),
        delay: "result_unknown",
        to: "/app/experiments",
        blockers: [],
        ...q(experimentQuality(x.status, x.evidence_strength ?? null)),
      });
    }
  }
  for (const o of i.opportunities) {
    if (o.status !== "open" && o.status !== "shortlisted") continue;
    const fe = feas(false, true, true);
    // Discovered by the AI: its own confidence label never outranks the evidence it cites.
    const oq = opportunityQuality(o.evidence);
    const comp: Components = {
      value: clamp(o.impact),
      importance: o.status === "shortlisted" ? 4 : 2,
      urgency: clamp(o.time_to_value),
      confidence: Math.min(
        o.confidence === "high" ? 4 : o.confidence === "medium" ? 3 : 2,
        QUALITY_CONFIDENCE[oq],
      ),
      feasibility: clamp((o.feasibility + fe.f) / 2),
      risk: clamp(o.risk),
    };
    out.push({
      id: `opportunity:${o.id}`,
      kind: "opportunity",
      category: "opportunity",
      code: "opportunity",
      vars: { title: o.title },
      components: comp,
      score: scoreOf(comp),
      delay: "opportunity_ages",
      to: "/app/opportunities",
      blockers: fe.b,
      ...q(oq),
    });
  }
  return dedupeActions(out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))).slice(
    0,
    limit,
  );
}

// Same recommendation from two places (an AI opportunity and a team proposal, or the same idea saved twice):
// titles are compared on their meaningful words; the highest-ranked copy stays and lists the others.
const STOP = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "for",
  "to",
  "in",
  "on",
  "with",
  "de",
  "het",
  "een",
  "en",
  "of",
  "voor",
  "van",
  "naar",
  "met",
  "op",
  "le",
  "la",
  "les",
  "un",
  "une",
  "des",
  "et",
  "du",
  "pour",
  "avec",
  "sur",
]);
export function titleWords(t: string): Set<string> {
  return new Set(
    t
      .toLowerCase()
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 1 && !STOP.has(w)),
  );
}
export function sameIdea(a: string, b: string): boolean {
  const x = titleWords(a),
    y = titleWords(b);
  if (!x.size || !y.size) return false;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / (x.size + y.size - shared) >= 0.75;
}
// Only undecided suggestions fold together; a step on work already approved or running stays its own action.
const FOLDABLE: readonly ActionKind[] = ["opportunity", "decide_proposal"];
export function dedupeActions(sorted: readonly GrowthAction[]): GrowthAction[] {
  const kept: GrowthAction[] = [];
  for (const a of sorted) {
    const title =
      FOLDABLE.includes(a.kind) && typeof a.vars["title"] === "string"
        ? (a.vars["title"] as string)
        : null;
    const twin = title
      ? kept.find(
          (k) =>
            FOLDABLE.includes(k.kind) &&
            typeof k.vars["title"] === "string" &&
            sameIdea(k.vars["title"] as string, title),
        )
      : undefined;
    if (twin) twin.alsoSuggested = [...(twin.alsoSuggested ?? []), a.id];
    else kept.push({ ...a });
  }
  return kept;
}

/** AI-discovered opportunity evidence ([{class|kind|type, text}]) normalized; AI "facts" become unverified claims. */
export function opportunityQuality(
  evidence: unknown,
  origin: "ai" | "rule" | "user" = "ai",
): Quality {
  if (!Array.isArray(evidence)) return "missing";
  const items = evidence
    .map((e) => (e && typeof e === "object" ? (e as Record<string, unknown>) : null))
    .filter((e): e is Record<string, unknown> => !!e)
    .map((e) => fromClassified(String(e["class"] ?? e["kind"] ?? e["type"] ?? ""), origin));
  return evidenceQuality(items).level;
}
