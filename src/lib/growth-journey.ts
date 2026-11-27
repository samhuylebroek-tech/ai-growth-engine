// The first growth journey after onboarding (pure): twelve connected steps from "tell us about the business" to
// "what happens next", each with a state decided only from records the caller read under RLS. A step whose read
// failed is "unknown", never "done"; nothing is created by the journey itself, it only points to the existing pages.
import { hasRole, type OrgRole } from "@/lib/permissions";

export const JOURNEY_STEPS = [
  "onboarding",
  "review",
  "confirm",
  "situation",
  "ask",
  "opportunity",
  "goal",
  "strategy",
  "initiatives",
  "campaign",
  "resources",
  "next",
] as const;
export type JourneyStep = (typeof JOURNEY_STEPS)[number];
/** done: recorded; attention: exists but needs a person (unconfirmed, not measurable, waiting for approval);
 *  todo: nothing recorded yet; waiting: an earlier step must come first; ready: a page to read, never "done";
 *  unknown: the read failed, so nothing is claimed. */
export type JourneyState = "done" | "attention" | "todo" | "waiting" | "ready" | "unknown";

type Known<T> = T | "unknown";
export type JourneyInput = {
  onboarding: Known<{ answered: number; total: number }>;
  understanding: Known<{ known: number; total: number; unconfirmed: number; conflicts: number }>;
  conversations: Known<number>;
  opportunities: Known<number>;
  goals: Known<{ active: number; measurable: number }>;
  strategies: Known<number>;
  plans: Known<{ approvedWithInitiatives: number; approved: number; draft: number }>;
  campaigns: Known<number>;
  budgetLines: Known<number>;
  pendingApprovals: Known<number>;
};

/** Minimum role per step, matching the pages the step opens (database rules stay the enforcement point). */
export const STEP_ROLE: Record<JourneyStep, OrgRole> = {
  onboarding: "editor",
  review: "viewer",
  confirm: "editor",
  situation: "viewer",
  ask: "member",
  opportunity: "viewer",
  goal: "member",
  strategy: "member",
  initiatives: "admin",
  campaign: "member",
  resources: "editor",
  next: "viewer",
};

export type JourneyItem = {
  step: JourneyStep;
  state: JourneyState;
  /** Counts for the explanation, only when they were read. */
  n?: number;
  total?: number;
  canAct: boolean;
  /** The step the person should take now (first open, required step they can act on or must wait for). */
  current: boolean;
};

const OPTIONAL: ReadonlySet<JourneyStep> = new Set(["opportunity"]);
const OPEN: ReadonlySet<JourneyState> = new Set(["todo", "attention"]);

export function growthJourney(
  i: JourneyInput,
  role: OrgRole | null | undefined,
): { items: JourneyItem[]; done: number; total: number; current: JourneyStep | null } {
  const u = <T, R>(v: Known<T>, f: (x: T) => R, fallback: R): R =>
    v === "unknown" ? fallback : f(v);
  const goalsDone = u(i.goals, (g) => g.measurable > 0, false);
  const raw: Omit<JourneyItem, "canAct" | "current">[] = [
    i.onboarding === "unknown"
      ? { step: "onboarding", state: "unknown" }
      : {
          step: "onboarding",
          state:
            i.onboarding.answered >= i.onboarding.total
              ? "done"
              : i.onboarding.answered > 0
                ? "attention"
                : "todo",
          n: i.onboarding.answered,
          total: i.onboarding.total,
        },
    i.understanding === "unknown"
      ? { step: "review", state: "unknown" }
      : { step: "review", state: "ready", n: i.understanding.known, total: i.understanding.total },
    i.understanding === "unknown"
      ? { step: "confirm", state: "unknown" }
      : {
          step: "confirm",
          state:
            i.understanding.unconfirmed + i.understanding.conflicts > 0
              ? "attention"
              : i.understanding.known > 0
                ? "done"
                : "waiting",
          n: i.understanding.unconfirmed + i.understanding.conflicts,
        },
    { step: "situation", state: "ready" },
    i.conversations === "unknown"
      ? { step: "ask", state: "unknown" }
      : { step: "ask", state: i.conversations > 0 ? "done" : "todo", n: i.conversations },
    i.opportunities === "unknown"
      ? { step: "opportunity", state: "unknown" }
      : { step: "opportunity", state: i.opportunities > 0 ? "done" : "todo", n: i.opportunities },
    i.goals === "unknown"
      ? { step: "goal", state: "unknown" }
      : {
          step: "goal",
          state: i.goals.measurable > 0 ? "done" : i.goals.active > 0 ? "attention" : "todo",
          n: i.goals.measurable,
          total: i.goals.active,
        },
    i.strategies === "unknown"
      ? { step: "strategy", state: "unknown" }
      : {
          step: "strategy",
          state: i.strategies > 0 ? "done" : goalsDone ? "todo" : "waiting",
          n: i.strategies,
        },
    i.plans === "unknown"
      ? { step: "initiatives", state: "unknown" }
      : {
          step: "initiatives",
          state:
            i.plans.approvedWithInitiatives > 0
              ? "done"
              : i.plans.draft > 0 || i.plans.approved > 0
                ? "attention"
                : u(i.strategies, (s) => s > 0, false)
                  ? "todo"
                  : "waiting",
          n: i.plans.approvedWithInitiatives,
        },
    i.campaigns === "unknown"
      ? { step: "campaign", state: "unknown" }
      : {
          step: "campaign",
          state: i.campaigns > 0 ? "done" : goalsDone ? "todo" : "waiting",
          n: i.campaigns,
        },
    i.budgetLines === "unknown" || i.pendingApprovals === "unknown"
      ? { step: "resources", state: "unknown" }
      : {
          step: "resources",
          state:
            i.pendingApprovals > 0
              ? "attention"
              : i.budgetLines > 0
                ? "done"
                : u(i.campaigns, (c) => c > 0, false) || goalsDone
                  ? "todo"
                  : "waiting",
          n: i.pendingApprovals,
          total: i.budgetLines,
        },
    { step: "next", state: "ready" },
  ];
  const items: JourneyItem[] = raw.map((r) => ({
    ...r,
    canAct: hasRole(role, STEP_ROLE[r.step]),
    current: false,
  }));
  // The current step is the first open required step this person can take; when only others can act, the first open one.
  const open = items.filter((x) => !OPTIONAL.has(x.step) && OPEN.has(x.state));
  const current = open.find((x) => x.canAct) ?? open[0];
  if (current) current.current = true;
  const counted = items.filter((x) => x.state !== "ready");
  return {
    items,
    done: counted.filter((x) => x.state === "done").length,
    total: counted.length,
    current: current?.step ?? null,
  };
}
