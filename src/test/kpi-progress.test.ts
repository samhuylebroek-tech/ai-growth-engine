import { describe, expect, it } from "vitest";
import { currentRow, kpiProgress, type BaselineRow, type TargetRow } from "@/lib/kpi-progress";
import type { Measurement } from "@/lib/performance";

const M = (
  id: string,
  month: string,
  value: number,
  kind = "manual_actual",
  corrects: string | null = null,
): Measurement => {
  const [y, mo] = month.split("-").map(Number) as [number, number];
  const end = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
  return {
    id,
    metric_id: "m",
    kind,
    period_start: `${month}-01`,
    period_end: end,
    value,
    corrects_id: corrects,
    created_at: `${month}-28T00:00:00Z`,
  };
};
const B = (over: Partial<BaselineRow> = {}): BaselineRow => ({
  id: "b1",
  metric_id: "m",
  basis: "manual",
  measurement_kind: null,
  value: 40,
  period_start: "2026-01-01",
  period_end: "2026-01-31",
  source: "Sheet",
  note: "",
  supersedes_id: null,
  created_by: "u",
  created_at: "2026-02-01T00:00:00Z",
  ...over,
});
const T = (over: Partial<TargetRow> = {}): TargetRow => ({
  id: "t1",
  metric_id: "m",
  withdrawn: false,
  value: 80,
  target_date: "2026-12-31",
  period_kind: "month",
  owner_id: null,
  note: "",
  supersedes_id: null,
  created_by: "u",
  created_at: "2026-02-01T00:00:00Z",
  ...over,
});
const base = { metricId: "m", direction: "increase", unit: "count", today: "2026-06-15" };

describe("KPI baselines and targets", () => {
  it("a newer baseline replaces the older one; a withdrawn target means no target", () => {
    expect(
      currentRow([
        B(),
        B({ id: "b2", supersedes_id: "b1", value: 30, created_at: "2026-03-01T00:00:00Z" }),
      ])?.id,
    ).toBe("b2");
    const p = kpiProgress({
      ...base,
      rows: [],
      baselines: [],
      targets: [
        T(),
        T({
          id: "t2",
          withdrawn: true,
          value: null,
          supersedes_id: "t1",
          created_at: "2026-03-01T00:00:00Z",
        }),
      ],
    });
    expect(p.target).toBeNull();
  });
  it("change and progress: baseline 40, result 60, target 80 → +20, +50%, 50% of the way", () => {
    const p = kpiProgress({
      ...base,
      rows: [M("a", "2026-05", 60)],
      baselines: [B()],
      targets: [T()],
    });
    expect([p.change, p.changePct, p.progress, p.improving]).toEqual([20, 50, 50, true]);
  });
  it("for a lower-is-better KPI a drop is an improvement", () => {
    const p = kpiProgress({
      ...base,
      direction: "decrease",
      rows: [M("a", "2026-05", 30)],
      baselines: [B()],
      targets: [T({ value: 20 })],
    });
    expect([p.change, p.improving, p.progress]).toEqual([-10, true, 50]);
  });
  it("never compares periods of different length", () => {
    const p = kpiProgress({
      ...base,
      rows: [M("a", "2026-05", 60)],
      baselines: [B({ period_start: "2025-01-01", period_end: "2025-12-31" })],
      targets: [],
    });
    expect([p.change, p.changeBlocked]).toEqual([null, "different_length"]);
  });
  it("percent KPIs change in points, never a percentage of a percentage; zero baselines give no percentage", () => {
    expect(
      kpiProgress({
        ...base,
        unit: "percent",
        rows: [M("a", "2026-05", 6)],
        baselines: [B({ value: 4 })],
        targets: [],
      }).changePct,
    ).toBeNull();
    expect(
      kpiProgress({
        ...base,
        rows: [M("a", "2026-05", 6)],
        baselines: [B({ value: 0 })],
        targets: [],
      }).changePct,
    ).toBeNull();
  });
  it("without a baseline, says so instead of inventing a starting point", () => {
    const p = kpiProgress({
      ...base,
      rows: [M("a", "2026-05", 60)],
      baselines: [],
      targets: [T()],
    });
    expect([p.change, p.progress, p.changeBlocked]).toEqual([null, null, "no_baseline"]);
  });
  it("plans and corrected values never count as the current result", () => {
    const p = kpiProgress({
      ...base,
      rows: [
        M("a", "2026-05", 60),
        M("b", "2026-05", 65, "manual_actual", "a"),
        M("c", "2026-06", 99, "planned"),
      ],
      baselines: [B()],
      targets: [],
    });
    expect(p.current?.value).toBe(65);
  });
  it("lists months without a result between the baseline and the latest result", () => {
    const p = kpiProgress({
      ...base,
      rows: [M("a", "2026-02", 45), M("b", "2026-05", 60)],
      baselines: [B()],
      targets: [],
    });
    expect(p.missingMonths).toEqual(["2026-03", "2026-04"]);
  });
  it("trend needs three months moving the same way", () => {
    expect(
      kpiProgress({
        ...base,
        rows: [M("a", "2026-03", 1), M("b", "2026-04", 2), M("c", "2026-05", 3)],
        baselines: [],
        targets: [],
      }).trend,
    ).toBe("up");
    expect(
      kpiProgress({
        ...base,
        rows: [M("a", "2026-03", 1), M("b", "2026-04", 3), M("c", "2026-05", 2)],
        baselines: [],
        targets: [],
      }).trend,
    ).toBe("unknown");
  });
});

import { kpiGoalLine, type BusinessDomains, type MetricRow } from "@/lib/security/business-context";
describe("Growth Officer reads starting point and target", () => {
  const metric: MetricRow = {
    id: "m",
    label: "Leads",
    unit: "count",
    currency: null,
    direction: "increase",
    goal_id: null,
  };
  it("states the same change and progress as the metric page", () => {
    const d = {
      kpiBaselines: { status: "ok", rows: [B()], truncated: false },
      kpiTargets: { status: "ok", rows: [T()], truncated: false },
    } as unknown as BusinessDomains;
    const line = kpiGoalLine(d, metric, [M("a", "2026-05", 60)], new Date("2026-06-15T00:00:00Z"));
    expect(line).toContain(
      "starting point 40 for 2026-01-01–2026-01-31 (entered by the team, source: Sheet)",
    );
    expect(line).toContain("change since starting point +20 (50%), improving");
    expect(line).toContain("50% of the way to the target");
  });
  it("says no starting point is set instead of assuming one", () => {
    const d = {
      kpiBaselines: { status: "ok", rows: [], truncated: false },
      kpiTargets: { status: "ok", rows: [], truncated: false },
    } as unknown as BusinessDomains;
    expect(kpiGoalLine(d, metric, [M("a", "2026-05", 60)])).toContain(
      "no starting point set (do not assume one)",
    );
  });
});
