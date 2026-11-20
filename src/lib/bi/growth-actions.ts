// Next Best Growth Actions: one transparent ranking over improvement findings, approved proposals awaiting work,
// experiments and discovered opportunities. Pure; every score is the visible weighted sum of its components.
import type { Candidate, Category } from "./optimization";

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
  }[];
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
  for (const c of i.candidates) {
    const fe = feas(c.requiredLevel === "budget", false, true);
    const comp: Components = {
      value: VALUE[c.code] ?? 3,
      importance: c.goalId ? (IMPORTANCE[i.goalPriority.get(c.goalId) ?? "medium"] ?? 3) : 2,
      urgency: URGENCY[c.category],
      confidence: clamp(c.confidence * 5),
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
    });
  }
  for (const p of i.proposals) {
    const imp = p.goal_id ? (IMPORTANCE[i.goalPriority.get(p.goal_id) ?? "medium"] ?? 3) : 2;
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
        confidence: 3,
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
      });
    }
  }
  for (const o of i.opportunities) {
    if (o.status !== "open" && o.status !== "shortlisted") continue;
    const fe = feas(false, true, true);
    const comp: Components = {
      value: clamp(o.impact),
      importance: o.status === "shortlisted" ? 4 : 2,
      urgency: clamp(o.time_to_value),
      confidence: o.confidence === "high" ? 4 : o.confidence === "medium" ? 3 : 2,
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
    });
  }
  return out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
}
