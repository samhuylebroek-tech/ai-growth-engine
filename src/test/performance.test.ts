import { describe, expect, it } from "vitest";
import {
  effectiveMeasurements,
  correctionHistory,
  summarizeMetric,
  sumSameUnit,
  metricKey,
  monthPeriod,
  EVIDENCE,
  USER_KINDS,
  type Measurement,
} from "@/lib/performance";

const row = (
  id: string,
  kind: string,
  start: string,
  end: string,
  value: number,
  corrects_id: string | null = null,
): Measurement => ({
  id,
  metric_id: "m",
  kind,
  period_start: start,
  period_end: end,
  value,
  corrects_id,
  created_at: "2026-11-01T00:00:00Z",
});

describe("performance measurements", () => {
  it("a corrected value is history, the correction is in force", () => {
    const rows = [
      row("a", "manual_actual", "2026-10-01", "2026-10-31", 12000),
      row("b", "manual_actual", "2026-10-01", "2026-10-31", 12500, "a"),
    ];
    expect(effectiveMeasurements(rows).map((r) => r.id)).toEqual(["b"]);
    expect(correctionHistory(rows, "b").map((r) => r.id)).toEqual(["a", "b"]);
  });
  it("compares actual with the plan of the same period and respects direction", () => {
    const rows = [
      row("p", "planned", "2026-10-01", "2026-10-31", 15000),
      row("a", "manual_actual", "2026-10-01", "2026-10-31", 12500),
      row("s", "manual_actual", "2026-09-01", "2026-09-30", 11000),
      row("future", "planned", "2026-12-01", "2026-12-31", 20000),
    ];
    const s = summarizeMetric({ id: "m", direction: "increase" }, rows);
    expect(s.period).toEqual({ start: "2026-10-01", end: "2026-10-31" });
    expect(s.actual).toEqual({ value: 12500, kind: "manual_actual" });
    expect(s.variance).toBe(-2500);
    expect(s.onTrack).toBe(false);
    expect(s.previousActual).toBe(11000);
    expect(summarizeMetric({ id: "m", direction: "decrease" }, rows).onTrack).toBe(true);
  });
  it("prefers a verified result over an entered one for the same period", () => {
    const rows = [
      row("a", "manual_actual", "2026-10-01", "2026-10-31", 10),
      row("v", "verified_actual", "2026-10-01", "2026-10-31", 9),
    ];
    expect(summarizeMetric({ id: "m", direction: "increase" }, rows).actual).toEqual({
      value: 9,
      kind: "verified_actual",
    });
  });
  it("never shows a variance without both a plan and a result", () => {
    const s = summarizeMetric({ id: "m", direction: "increase" }, [
      row("a", "manual_actual", "2026-10-01", "2026-10-31", 10),
    ]);
    expect(s.variance).toBeNull();
    expect(s.onTrack).toBeNull();
  });
  it("refuses to add different currencies, units, or percentages", () => {
    expect(() =>
      sumSameUnit([
        { value: 1, unit: "currency", currency: "EUR" },
        { value: 1, unit: "currency", currency: "USD" },
      ]),
    ).toThrow();
    expect(() =>
      sumSameUnit([
        { value: 1, unit: "count", currency: null },
        { value: 1, unit: "currency", currency: "EUR" },
      ]),
    ).toThrow();
    expect(() =>
      sumSameUnit([
        { value: 10, unit: "percent", currency: null },
        { value: 5, unit: "percent", currency: null },
      ]),
    ).toThrow();
    expect(
      sumSameUnit([
        { value: 100, unit: "currency", currency: "EUR" },
        { value: 50, unit: "currency", currency: "EUR" },
      ]),
    ).toEqual({ total: 150, unit: "currency", currency: "EUR" });
  });
  it("users can only enter planned, forecast and entered results; only verified counts as measured fact", () => {
    expect(USER_KINDS).toEqual(["planned", "forecast", "manual_actual"]);
    expect(EVIDENCE.manual_actual).toBe("user_entered");
    expect(EVIDENCE.verified_actual).toBe("verified");
  });
  it("builds valid metric keys and month periods", () => {
    expect(metricKey("Omzet per maand (€)")).toBe("omzet_per_maand");
    expect(metricKey("2026 leads")).toBe("m_2026_leads");
    expect(monthPeriod("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(monthPeriod("2028-02").end).toBe("2028-02-29");
    expect(() => monthPeriod("2026-13")).toThrow();
  });
});

import { renderBusinessContext } from "@/lib/security/business-context";
describe("performance in the business context", () => {
  const base = {
    workspace: { id: "w", name: "W" },
    objectives: null,
    facts: [],
    goals: [],
    recommendations: [],
    plans: { status: "ok" as const, rows: [], truncated: false },
    initiatives: [],
    operations: [],
    projects: [],
    tasks: [],
    budget: { status: "ok" as const, rows: [], truncated: false },
    deals: { status: "ok" as const, rows: [], truncated: false },
    competitors: { status: "ok" as const, rows: [], truncated: false },
    observations: [],
    seo: { status: "ok" as const, rows: [], truncated: false },
    content: { status: "ok" as const, rows: [], truncated: false },
    versions: [],
    decisions: [],
    campaigns: { status: "ok" as const, rows: [], truncated: false },
    connections: { status: "ok" as const, rows: [], truncated: false },
  };
  it("labels team-entered results as not verified and compares with the plan", () => {
    const text = renderBusinessContext({
      ...base,
      metrics: {
        status: "ok",
        rows: [
          {
            id: "m",
            label: "Qualified leads",
            unit: "count",
            currency: null,
            direction: "increase",
            goal_id: null,
          },
        ],
        truncated: false,
      },
      measurements: [
        row("p", "planned", "2026-10-01", "2026-10-31", 40),
        row("a", "manual_actual", "2026-10-01", "2026-10-31", 31),
      ],
    });
    expect(text).toContain("result 31 (entered by the team, not verified)");
    expect(text).toContain("behind plan by 9");
  });
  it("names the read-only source of imported results and prefers them over entered ones", () => {
    const text = renderBusinessContext({
      ...base,
      connections: {
        status: "ok",
        rows: [{ connector_key: "stripe", status: "connected" }],
        truncated: false,
      },
      metrics: {
        status: "ok",
        rows: [
          {
            id: "m",
            label: "Net revenue (EUR)",
            unit: "currency",
            currency: "EUR",
            direction: "increase",
            goal_id: null,
          },
        ],
        truncated: false,
      },
      measurements: [
        row("a", "manual_actual", "2026-10-01", "2026-10-31", 9000),
        { ...row("i", "imported_actual", "2026-10-01", "2026-10-31", 12600), source: "stripe" },
      ],
    });
    expect(text).toContain(
      "latest result 12600 (imported read-only from Stripe, not independently verified)",
    );
    expect(text).toContain("imported values exist from Stripe");
  });
  it("summarizes completed initiatives against their own targets without claiming cause", () => {
    const text = renderBusinessContext({
      ...base,
      initiatives: [
        {
          id: "i1",
          plan_version_id: "p",
          title: "Local SEO pages",
          detail: "",
          channel: "seo",
          target_week: 2,
          effort: "m",
          status: "completed",
          project_id: null,
        },
      ],
      operations: [
        {
          initiative_id: "i1",
          due_date: null,
          success_metric: "Leads",
          baseline_value: 20,
          target_value: 30,
          current_value: 34,
          blocker_note: null,
          owner_id: "u",
        },
      ],
      metrics: {
        status: "ok",
        rows: [
          {
            id: "m",
            label: "Qualified leads",
            unit: "count",
            currency: null,
            direction: "increase",
            goal_id: null,
            initiative_id: "i1",
          },
        ],
        truncated: false,
      },
      measurements: [
        row("a", "manual_actual", "2026-09-01", "2026-09-30", 22),
        row("b", "manual_actual", "2026-10-01", "2026-10-31", 34),
      ],
    });
    expect(text).toContain(
      "Local SEO pages (seo): target reached on Leads 20→30, user-entered current 34",
    );
    expect(text).toContain(
      "Qualified leads latest 34 (entered by the team, not verified), previous 22",
    );
    expect(text).toContain("not proven cause");
  });
  it("says tracking is unavailable instead of empty when not installed", () => {
    const text = renderBusinessContext({ ...base, metrics: { status: "unavailable" } });
    expect(text).toContain("performance tracking not installed");
  });
});

import { monthlySeries, metricStatus, forecastDeviations } from "@/lib/performance";
describe("monthly series and status", () => {
  const rows = [
    row("p1", "planned", "2026-09-01", "2026-09-30", 30),
    row("a1", "manual_actual", "2026-09-01", "2026-09-30", 33),
    row("p2", "planned", "2026-10-01", "2026-10-31", 40),
    row("f2", "forecast", "2026-10-01", "2026-10-31", 38),
    row("a2", "manual_actual", "2026-10-01", "2026-10-31", 31),
    { ...row("a2c", "manual_actual", "2026-10-01", "2026-10-31", 35), corrects_id: "a2" },
  ];
  it("builds one point per month from values still in force, oldest first", () => {
    expect(monthlySeries(rows)).toEqual([
      { month: "2026-09", planned: 30, forecast: null, actual: 33, actualKind: "manual_actual" },
      { month: "2026-10", planned: 40, forecast: 38, actual: 35, actualKind: "manual_actual" },
    ]);
  });
  it("marks a metric behind plan only when a result and a plan exist for the same month", () => {
    expect(metricStatus(summarizeMetric({ id: "m", direction: "increase" }, rows))).toBe("behind");
    expect(metricStatus(summarizeMetric({ id: "m", direction: "decrease" }, rows))).toBe(
      "on_track",
    );
    expect(
      metricStatus(
        summarizeMetric({ id: "m", direction: "increase" }, [
          row("p", "planned", "2026-10-01", "2026-10-31", 5),
        ]),
      ),
    ).toBe("no_result");
    expect(metricStatus(summarizeMetric({ id: "m", direction: "increase" }, []))).toBe("no_data");
  });
  it("compares forecasts with corrected results", () => {
    expect(forecastDeviations(rows)).toEqual([
      { month: "2026-10", forecast: 38, actual: 35, deviation: -3 },
    ]);
  });
});

describe("Growth Officer metric context", () => {
  const base2 = {
    workspace: { id: "w", name: "W" },
    objectives: null,
    facts: [],
    recommendations: [],
    plans: { status: "ok" as const, rows: [], truncated: false },
    operations: [],
    projects: [],
    tasks: [],
    budget: { status: "ok" as const, rows: [], truncated: false },
    deals: { status: "ok" as const, rows: [], truncated: false },
    competitors: { status: "ok" as const, rows: [], truncated: false },
    observations: [],
    seo: { status: "ok" as const, rows: [], truncated: false },
    content: { status: "ok" as const, rows: [], truncated: false },
    versions: [],
    decisions: [],
    campaigns: { status: "ok" as const, rows: [], truncated: false },
    connections: { status: "ok" as const, rows: [], truncated: false },
  };
  it("names linked goals and initiatives, the monthly trend and forecast deviations with reliability", () => {
    const text = renderBusinessContext({
      ...base2,
      goals: [
        {
          id: "g",
          title: "Grow leads",
          objective: "",
          metric: "",
          baseline: null,
          target: null,
          current_value: null,
          due_date: null,
          priority: "high",
          status: "active",
        },
      ],
      initiatives: [
        {
          id: "i",
          plan_version_id: "p",
          title: "Fix SEO basics",
          detail: "",
          channel: "seo",
          target_week: 2,
          effort: null,
          status: "planned",
          project_id: null,
        },
      ],
      metrics: {
        status: "ok",
        rows: [
          {
            id: "m",
            label: "Qualified leads",
            unit: "count",
            currency: null,
            direction: "increase",
            goal_id: "g",
            initiative_id: "i",
          },
        ],
        truncated: false,
      },
      measurements: [
        row("p1", "planned", "2026-09-01", "2026-09-30", 30),
        row("a1", "manual_actual", "2026-09-01", "2026-09-30", 33),
        row("p2", "planned", "2026-10-01", "2026-10-31", 40),
        row("f2", "forecast", "2026-10-01", "2026-10-31", 38),
        row("a2", "manual_actual", "2026-10-01", "2026-10-31", 35),
      ],
    });
    expect(text).toContain('linked to goal "Grow leads", initiative "Fix SEO basics"');
    expect(text).toContain("status behind plan");
    expect(text).toContain("2026-09 result 33 (entered by the team, not verified) / plan 30");
    expect(text).toContain("2026-10 forecast 38, result 35 (-3)");
    expect(text).toContain("never state a number that is not listed");
  });
});
