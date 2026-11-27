import { describe, expect, it } from "vitest";
import { beforeAfter, comparable, kpiQuality, periodDays } from "@/lib/kpi-periods";

let n = 0;
const m = (
  start: string,
  end: string,
  value: number,
  kind = "manual_actual",
  corrects_id: string | null = null,
  metric_id = "M",
) => ({
  id: `r${++n}`,
  metric_id,
  kind,
  period_start: start,
  period_end: end,
  value,
  corrects_id,
  created_at: "2026-01-01",
});

describe("KPI measurement periods", () => {
  it("treats calendar months as comparable and rejects different lengths, overlaps and plans", () => {
    expect(comparable(m("2026-02-01", "2026-02-28", 1), m("2026-03-01", "2026-03-31", 1)).ok).toBe(
      true,
    );
    expect(comparable(m("2026-03-01", "2026-03-07", 1), m("2026-03-08", "2026-03-31", 1))).toEqual({
      ok: false,
      reason: "different_length",
    });
    expect(comparable(m("2026-03-01", "2026-03-31", 1), m("2026-03-15", "2026-04-14", 1))).toEqual({
      ok: false,
      reason: "overlap",
    });
    expect(
      comparable(m("2026-03-01", "2026-03-31", 1, "planned"), m("2026-04-01", "2026-04-30", 1)),
    ).toEqual({ ok: false, reason: "not_actual" });
    expect(periodDays(m("2026-03-01", "2026-03-07", 1))).toBe(7);
  });
  it("compares only a comparable after-period with the last period before the decision", () => {
    const rows = [
      m("2026-05-01", "2026-05-31", 100),
      m("2026-06-01", "2026-06-07", 900),
      m("2026-06-01", "2026-06-30", 120),
    ];
    const r = beforeAfter(rows, "M", "increase", "2026-06-01");
    expect(r).toMatchObject({
      outcome: "improved",
      reason: "ok",
      changePct: 20,
      confidence: "low",
    });
    expect(r.after?.period_end).toBe("2026-06-30");
  });
  it("is inconclusive without a comparable after-period rather than comparing a week with a month", () => {
    const r = beforeAfter(
      [m("2026-05-01", "2026-05-31", 100), m("2026-06-01", "2026-06-07", 900)],
      "M",
      "increase",
      "2026-06-01",
    );
    expect(r).toMatchObject({ outcome: "inconclusive", reason: "no_comparable_after" });
    expect(
      beforeAfter([m("2026-06-01", "2026-06-30", 1)], "M", "increase", "2026-06-01").reason,
    ).toBe("no_before");
  });
  it("gives medium confidence only when the change exceeds the earlier normal fluctuation", () => {
    const base = [
      m("2026-02-01", "2026-02-28", 100),
      m("2026-03-01", "2026-03-31", 104),
      m("2026-04-01", "2026-04-30", 100),
    ];
    expect(
      beforeAfter([...base, m("2026-05-01", "2026-05-31", 130)], "M", "increase", "2026-05-01"),
    ).toMatchObject({ confidence: "medium", normalFluctuationPct: 4 });
    expect(
      beforeAfter([...base, m("2026-05-01", "2026-05-31", 103)], "M", "increase", "2026-05-01")
        .confidence,
    ).toBe("low");
  });
  it("uses corrected values, not the replaced ones", () => {
    const old = m("2026-05-01", "2026-05-31", 50);
    const rows = [
      old,
      m("2026-05-01", "2026-05-31", 100, "manual_actual", old.id),
      m("2026-06-01", "2026-06-30", 90),
    ];
    expect(beforeAfter(rows, "M", "increase", "2026-06-01")).toMatchObject({
      outcome: "worse",
      changePct: -10,
    });
  });
  it("reports gaps, mixed lengths, overlaps, corrections and age", () => {
    const old = m("2026-01-01", "2026-01-31", 5);
    const q = kpiQuality(
      [
        old,
        m("2026-01-01", "2026-01-31", 6, "manual_actual", old.id),
        m("2026-03-01", "2026-03-31", 1),
        m("2026-04-01", "2026-04-07", 1),
        m("2026-04-05", "2026-04-11", 1),
      ],
      "M",
      "2026-04-21",
    );
    expect(q).toMatchObject({
      periods: 4,
      gaps: 1,
      mixedLengths: true,
      overlaps: 1,
      corrections: 1,
      lastPeriodEnd: "2026-04-11",
      staleDays: 10,
    });
  });
});
