import { describe, expect, it } from "vitest";
import { detectSignals, signalScore } from "@/lib/signals";
import { renderBusinessContext, type BusinessDomains } from "@/lib/security/business-context";
import type { Measurement } from "@/lib/performance";

const NOW = new Date("2026-11-20T08:00:00Z");
const ok = <T>(rows: T[]) => ({ status: "ok" as const, rows, truncated: false });
const base = (): BusinessDomains => ({
  workspace: { id: "w", name: "Main" },
  objectives: null,
  facts: [],
  goals: [],
  recommendations: [],
  plans: ok([]),
  initiatives: [],
  operations: [],
  projects: [],
  tasks: [],
  budget: ok([]),
  deals: ok([]),
  competitors: ok([]),
  observations: [],
  seo: ok([]),
  content: ok([]),
  versions: [],
  decisions: [],
  campaigns: ok([]),
  connections: ok([]),
  metrics: ok([]),
  measurements: [],
});
let n = 0;
const m = (metric_id: string, kind: string, month: string, value: number): Measurement => ({
  id: `r${n++}`,
  metric_id,
  kind,
  period_start: `${month}-01`,
  period_end: `${month}-28`,
  value,
  corrects_id: null,
  created_at: `${month}-28T00:00:00Z`,
});
const goal = {
  id: "g1",
  title: "More bookings",
  objective: "reservations",
  metric: "bookings",
  baseline: 40,
  target: 60,
  current_value: 62,
  due_date: null,
  priority: "primary",
  status: "active",
  updated_at: "2026-11-10T00:00:00Z",
};

describe("rule-based signals", () => {
  it("flags a completed initiative that reached its target on paper while its metric is behind plan", () => {
    const d = base();
    d.initiatives = [
      {
        id: "i1",
        plan_version_id: "p",
        title: "Booking page",
        detail: "",
        channel: "web",
        target_week: 2,
        effort: null,
        status: "completed",
        project_id: null,
      },
    ];
    d.operations = [
      {
        initiative_id: "i1",
        due_date: null,
        success_metric: "bookings",
        baseline_value: 40,
        target_value: 60,
        current_value: 62,
        blocker_note: null,
        owner_id: "u",
      } as BusinessDomains["operations"][number],
    ];
    d.metrics = ok([
      {
        id: "mx",
        label: "Online bookings",
        unit: "count",
        currency: null,
        direction: "increase",
        goal_id: null,
        initiative_id: "i1",
      },
    ]);
    d.measurements = [m("mx", "planned", "2026-10", 50), m("mx", "manual_actual", "2026-10", 46)];
    const s = detectSignals(d, NOW).find((x) => x.code === "initiative_outcome_conflict");
    expect(s).toMatchObject({ kind: "conflict", vars: { recorded: 62, actual: 46, planned: 50 } });
  });
  it("asks for a measurement when a completed initiative has no outcome at all", () => {
    const d = base();
    d.initiatives = [
      {
        id: "i2",
        plan_version_id: "p",
        title: "Flyers",
        detail: "",
        channel: "offline",
        target_week: 1,
        effort: null,
        status: "completed",
        project_id: null,
      },
    ];
    expect(detectSignals(d, NOW).map((s) => s.code)).toContain("initiative_outcome_missing");
  });
  it("flags a goal value that differs more than 10% from its linked metric, not a small difference", () => {
    const d = base();
    d.goals = [goal];
    d.metrics = ok([
      {
        id: "m1",
        label: "Bookings",
        unit: "count",
        currency: null,
        direction: "increase",
        goal_id: "g1",
      },
    ]);
    d.measurements = [m("m1", "manual_actual", "2026-10", 46)];
    expect(detectSignals(d, NOW).some((s) => s.code === "goal_metric_conflict")).toBe(true);
    d.measurements = [m("m1", "manual_actual", "2026-10", 60)];
    expect(detectSignals(d, NOW).some((s) => s.code === "goal_metric_conflict")).toBe(false);
  });
  it("marks goals untouched for more than 60 days as possibly outdated", () => {
    const d = base();
    d.goals = [{ ...goal, current_value: null, updated_at: "2026-08-01T00:00:00Z" }];
    expect(detectSignals(d, NOW).find((s) => s.code === "goal_stale")?.vars["days"]).toBe(111);
  });
  it("reports budget over its hard cap per currency, this month only", () => {
    const d = base();
    d.budget = ok([
      {
        channel: "Ads",
        period_month: "2026-11-01",
        planned: 100,
        actual: 130,
        hard_cap: 120,
        currency: "EUR",
        goal_id: null,
      },
      {
        channel: "Ads",
        period_month: "2026-10-01",
        planned: 100,
        actual: 500,
        hard_cap: 120,
        currency: "USD",
        goal_id: null,
      },
    ]);
    const codes = detectSignals(d, NOW).filter((s) => s.code === "budget_over_cap");
    expect(codes).toHaveLength(1);
    expect(codes[0]!.vars["currency"]).toBe("EUR");
  });
  it("sees an opportunity only after two months at or above plan, respecting lower-is-better", () => {
    const d = base();
    d.metrics = ok([
      {
        id: "c",
        label: "Cost per lead",
        unit: "currency",
        currency: "EUR",
        direction: "decrease",
        goal_id: null,
      },
    ]);
    d.measurements = [
      m("c", "planned", "2026-09", 30),
      m("c", "manual_actual", "2026-09", 28),
      m("c", "planned", "2026-10", 30),
      m("c", "manual_actual", "2026-10", 29),
    ];
    expect(detectSignals(d, NOW).some((s) => s.code === "metric_ahead")).toBe(true);
    d.measurements = [m("c", "planned", "2026-10", 30), m("c", "manual_actual", "2026-10", 29)];
    expect(detectSignals(d, NOW).some((s) => s.code === "metric_ahead")).toBe(false);
  });
  it("weighs impact more than urgency, and urgency more than feasibility", () => {
    expect(signalScore("high", "medium", "medium")).toBeGreaterThan(
      signalScore("medium", "high", "medium"),
    );
    expect(signalScore("medium", "high", "medium")).toBeGreaterThan(
      signalScore("medium", "medium", "high"),
    );
  });
  it("puts the signals into the Growth Officer context with their evidence class", () => {
    const d = base();
    d.goals = [goal];
    d.metrics = ok([]);
    const text = renderBusinessContext(d, NOW);
    expect(text).toContain("DETECTED SIGNALS");
    expect(text).toContain("Your goals have no metrics to measure them");
    expect(text).toContain("never to a cause");
  });
});
