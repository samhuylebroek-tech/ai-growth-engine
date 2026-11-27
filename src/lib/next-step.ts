// One clear next step for the Command Center (pure, no AI call, no credits).
// The step is chosen from the same scoped records Home already reads, in a fixed priority order, and only steps the
// current person can actually take are offered: a viewer is never sent to a decision they cannot make, a member is
// never sent to the business setup that only editors may confirm.
import type { Signal, SignalDestination } from "@/lib/signals";

export type StepCode =
  | "setup_business"
  | "setup_waiting"
  | "tell_more"
  | "decide_urgent"
  | "signal"
  | "overdue_tasks"
  | "set_goal"
  | "decide_approvals"
  | "awaiting_decision"
  | "confirm_facts"
  | "ask_officer"
  | "read_overview";
export type StepDestination =
  | "/app/onboarding"
  | "/app/profile"
  | "/app/approvals"
  | "/app/tasks"
  | "/app/goals"
  | "/app/growth-officer"
  | "/app/performance"
  | SignalDestination;
export type NextStep = {
  code: StepCode;
  to: StepDestination;
  vars: Record<string, string | number>;
  /** Present when the step comes from a Command Center warning; its texts are the warning's own explanation. */
  signal?: Signal;
  urgent: boolean;
};
export type NextStepInput = {
  canEdit: boolean; // member and above: tasks, goals, warnings that ask for a change
  canConfirm: boolean; // editor and above: business setup and fact confirmation
  canDecide: boolean; // admin and above: approvals
  canUseAi: boolean;
  onboardingDone: boolean;
  confirmedFacts: number;
  unconfirmedFacts: number;
  pendingApprovals: number;
  highRiskApprovals: number;
  overdueTasks: number;
  /** Guided onboarding key questions answered; null while unknown (never treated as "nothing answered"). */
  understanding?: { answered: number; total: number } | null;
  /** null while unknown (not read yet or failed): never treated as "no goal". */
  hasActiveGoal: boolean | null;
  signals: readonly Signal[];
};

const isPressing = (s: Signal) => s.impact === "high" && s.urgency === "high";

/** Every applicable step, most important first; the first is the recommendation, the rest are alternatives. */
export function candidateSteps(i: NextStepInput): NextStep[] {
  const out: NextStep[] = [];
  const signals = [...i.signals].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  if (!i.onboardingDone) {
    if (i.canConfirm)
      out.push({ code: "setup_business", to: "/app/onboarding", vars: {}, urgent: false });
    else if (i.confirmedFacts === 0)
      out.push({ code: "setup_waiting", to: "/app/profile", vars: {}, urgent: false });
  }
  if (i.canDecide && i.highRiskApprovals > 0)
    out.push({
      code: "decide_urgent",
      to: "/app/approvals",
      vars: { n: i.highRiskApprovals },
      urgent: true,
    });
  const pressing = i.canEdit ? signals.find(isPressing) : undefined;
  if (pressing)
    out.push({
      code: "signal",
      to: pressing.to,
      vars: pressing.vars,
      signal: pressing,
      urgent: true,
    });
  if (i.canEdit && i.overdueTasks > 0)
    out.push({
      code: "overdue_tasks",
      to: "/app/tasks",
      vars: { n: i.overdueTasks },
      urgent: true,
    });
  // Knowing customers, sales, challenges, time and boundaries makes every later step fit; only editors can answer.
  if (
    i.onboardingDone &&
    i.canConfirm &&
    i.understanding &&
    i.understanding.answered < i.understanding.total
  )
    out.push({
      code: "tell_more",
      to: "/app/onboarding",
      vars: { answered: i.understanding.answered, total: i.understanding.total },
      urgent: false,
    });
  if (i.canEdit && i.hasActiveGoal === false)
    out.push({ code: "set_goal", to: "/app/goals", vars: {}, urgent: false });
  if (i.canDecide && i.pendingApprovals > i.highRiskApprovals)
    out.push({
      code: "decide_approvals",
      to: "/app/approvals",
      vars: { n: i.pendingApprovals - i.highRiskApprovals },
      urgent: false,
    });
  if (i.canEdit) {
    // The overdue-task step already covers the same warning.
    const other = signals.find(
      (s) => s !== pressing && !(s.code === "tasks_overdue" && i.overdueTasks > 0),
    );
    if (other)
      out.push({ code: "signal", to: other.to, vars: other.vars, signal: other, urgent: false });
  }
  // Says who can act: proposals the person sent or can see wait for an administrator, so nobody waits in the dark.
  if (!i.canDecide && i.canEdit && i.pendingApprovals > 0)
    out.push({
      code: "awaiting_decision",
      to: "/app/approvals",
      vars: { n: i.pendingApprovals },
      urgent: false,
    });
  if (i.canConfirm && i.unconfirmedFacts > 0)
    out.push({
      code: "confirm_facts",
      to: "/app/profile",
      vars: { n: i.unconfirmedFacts },
      urgent: false,
    });
  if (i.canUseAi)
    out.push({ code: "ask_officer", to: "/app/growth-officer", vars: {}, urgent: false });
  out.push({ code: "read_overview", to: "/app/performance", vars: {}, urgent: false });
  return out;
}

export function nextSteps(
  i: NextStepInput,
  alternatives = 2,
): { primary: NextStep; alternatives: NextStep[] } {
  const all = candidateSteps(i);
  // Never fails: "read_overview" is always a candidate.
  const [primary, ...rest] = all as [NextStep, ...NextStep[]];
  return { primary, alternatives: rest.slice(0, alternatives) };
}
