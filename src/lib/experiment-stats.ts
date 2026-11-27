// Experiment design and evaluation (proposal 0079). Pure; mirrors the SQL rules in move_experiment so the screen
// shows exactly what the database will accept. Rates and effects are percentages (0–100).
import type { ExperimentStatus } from "@/lib/pending-schema";

const Z_ALPHA = 1.959964; // two-sided 5%
const Z_POWER = 0.841621; // 80% power
export const MIN_PER_GROUP = 30;

/** Visitors (or customers) needed in EACH group to detect `effect` points on top of `baseline`; mirrors experiment_sample_size. */
export function sampleSizePerGroup(baseline: number | null, effect: number | null): number | null {
  if (
    baseline == null ||
    effect == null ||
    baseline <= 0 ||
    effect <= 0 ||
    baseline + effect >= 100
  )
    return null;
  const p1 = baseline / 100;
  const p2 = (baseline + effect) / 100;
  const pb = (baseline + effect / 2) / 100;
  const n =
    (Z_ALPHA * Math.sqrt(2 * pb * (1 - pb)) + Z_POWER * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) **
      2 /
    (effect / 100) ** 2;
  return Math.ceil(n);
}

export type Observation = {
  variant_n: number;
  variant_conversions: number;
  control_n: number;
  control_conversions: number;
  data_class: string;
};
export type Method = "ab_test" | "comparison_group" | "before_after" | "observational";
export type Verdict =
  "no_data" | "too_early" | "better" | "worse" | "no_difference" | "correlational";
export type Outcome = "successful" | "unsuccessful" | "inconclusive";

export type Evaluation = {
  variantRate: number | null;
  controlRate: number | null;
  /** variant minus control, in percentage points */
  difference: number | null;
  /** 95% interval of the difference, in percentage points (normal approximation) */
  interval: [number, number] | null;
  z: number | null;
  needed: number;
  reached: boolean;
  verdict: Verdict;
  /** the variant fell under the guardrail with at least the minimum group size */
  guardrailHit: boolean;
  simulated: boolean;
  allowed: Outcome[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function evaluateExperiment(
  design: { method: Method; sample_per_group?: number | null; guardrail_min_rate?: number | null },
  latest: Observation | null,
): Evaluation {
  const controlled = design.method === "ab_test" || design.method === "comparison_group";
  const needed = Math.max(MIN_PER_GROUP, design.sample_per_group ?? MIN_PER_GROUP);
  if (!latest || latest.variant_n === 0 || latest.control_n === 0) {
    return {
      variantRate: null,
      controlRate: null,
      difference: null,
      interval: null,
      z: null,
      needed,
      reached: false,
      verdict: "no_data",
      guardrailHit: false,
      simulated: latest?.data_class === "simulated",
      allowed: ["inconclusive"],
    };
  }
  const pv = latest.variant_conversions / latest.variant_n;
  const pc = latest.control_conversions / latest.control_n;
  const pool =
    (latest.variant_conversions + latest.control_conversions) /
    (latest.variant_n + latest.control_n);
  const z =
    pool > 0 && pool < 1
      ? r2((pv - pc) / Math.sqrt(pool * (1 - pool) * (1 / latest.variant_n + 1 / latest.control_n)))
      : null;
  const se = Math.sqrt((pv * (1 - pv)) / latest.variant_n + (pc * (1 - pc)) / latest.control_n);
  const diff = (pv - pc) * 100;
  const reached = latest.variant_n >= needed && latest.control_n >= needed;
  const sig = z !== null && Math.abs(z) >= 1.96;
  const verdict: Verdict = !controlled
    ? "correlational"
    : !reached
      ? "too_early"
      : sig
        ? z! > 0
          ? "better"
          : "worse"
        : "no_difference";
  const allowed: Outcome[] = controlled
    ? [
        ...(reached && z !== null && z >= 1.96 ? (["successful"] as const) : []),
        ...(reached ||
        (z !== null &&
          z <= -1.96 &&
          latest.variant_n >= MIN_PER_GROUP &&
          latest.control_n >= MIN_PER_GROUP)
          ? (["unsuccessful"] as const)
          : []),
        "inconclusive",
      ]
    : ["successful", "unsuccessful", "inconclusive"];
  const g = design.guardrail_min_rate;
  return {
    variantRate: r2(pv * 100),
    controlRate: r2(pc * 100),
    difference: r2(diff),
    interval: [r2(diff - 1.96 * se * 100), r2(diff + 1.96 * se * 100)],
    z,
    needed,
    reached,
    verdict,
    guardrailHit: g != null && latest.variant_n >= MIN_PER_GROUP && pv * 100 < g,
    simulated: latest.data_class === "simulated",
    allowed,
  };
}

export type ExperimentAction =
  | "submit_review"
  | "return_to_draft"
  | "request_approval"
  | "approve"
  | "reject"
  | "schedule"
  | "start"
  | "pause"
  | "resume"
  | "stop_intervention"
  | "evaluate"
  | "complete"
  | "cancel";

/** Lifecycle shown as steps; paused/rejected/cancelled are side states. */
export const STAGES = [
  "draft",
  "in_review",
  "proposed",
  "approved",
  "scheduled",
  "running",
  "collecting",
  "evaluating",
  "completed",
] as const;

/** Actions the database accepts from this status for this role (mirrors move_experiment). */
export function experimentActions(
  status: ExperimentStatus,
  role: { member: boolean; admin: boolean },
  hasData: boolean,
): ExperimentAction[] {
  if (!role.member) return [];
  const a: ExperimentAction[] = [];
  switch (status) {
    case "draft":
      a.push("submit_review");
      break;
    case "in_review":
      a.push("request_approval", "return_to_draft");
      break;
    case "proposed":
      if (role.admin) a.push("approve", "reject");
      a.push("return_to_draft");
      break;
    case "approved":
      a.push("start", "schedule");
      break;
    case "scheduled":
      a.push("start");
      break;
    case "running":
      a.push("stop_intervention", "pause");
      if (hasData) a.push("evaluate");
      break;
    case "collecting":
      a.push("pause");
      if (hasData) a.push("evaluate");
      break;
    case "paused":
      a.push("resume");
      break;
    case "evaluating":
      a.push("complete");
      break;
    default:
      break;
  }
  if (!["completed", "rejected", "cancelled"].includes(status)) a.push("cancel");
  return a;
}

/** What still blocks a request for approval (mirrors the SQL check). */
export function designGaps(x: {
  method: Method;
  primary_kpi?: string;
  success_criteria?: string;
  stop_criteria?: string;
  control_description?: string;
  sample_per_group?: number | null;
}): ("primary_kpi" | "success_criteria" | "stop_criteria" | "control" | "sample")[] {
  const g: ("primary_kpi" | "success_criteria" | "stop_criteria" | "control" | "sample")[] = [];
  if (!x.primary_kpi?.trim()) g.push("primary_kpi");
  if (!x.success_criteria?.trim()) g.push("success_criteria");
  if (!x.stop_criteria?.trim()) g.push("stop_criteria");
  if (x.method === "ab_test" || x.method === "comparison_group") {
    if (!x.control_description?.trim()) g.push("control");
    if (x.sample_per_group == null) g.push("sample");
  }
  return g;
}

/** Days needed to reach the planned sample at a given daily traffic per group, or null when unknown. */
export function daysToSample(needed: number | null, dailyPerGroup: number | null): number | null {
  if (!needed || !dailyPerGroup || dailyPerGroup <= 0) return null;
  return Math.ceil(needed / dailyPerGroup);
}
