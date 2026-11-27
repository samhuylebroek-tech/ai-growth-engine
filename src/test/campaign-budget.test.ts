import { describe, expect, it } from "vitest";
import {
  budgetAlerts,
  limitUsage,
  spendForecast,
  weekStart,
  wouldExceed,
  type SpendLimits,
} from "@/lib/campaign-budget";

let n = 0;
const e = (
  kind: "spend" | "commitment" | "release" | "correction",
  amount: number,
  occurred_on: string,
  extra: {
    data_class?: "manual" | "simulated";
    currency?: string;
    relates_to?: string;
    id?: string;
  } = {},
) => ({
  id: extra.id ?? `e${++n}`,
  kind,
  amount,
  occurred_on,
  currency: extra.currency ?? "EUR",
  data_class: extra.data_class ?? "manual",
  relates_to: extra.relates_to ?? null,
});
const limits = (p: Partial<SpendLimits> = {}): SpendLimits => ({
  currency: "EUR",
  daily_max: null,
  weekly_max: null,
  monthly_max: null,
  lifetime_max: null,
  reserve_amount: null,
  alert_thresholds: [50, 80, 90, 100],
  emergency_stop: false,
  stop_reason: "",
  ...p,
});

describe("campaign spending limits (mirrors proposal 0083)", () => {
  it("weeks start on Monday", () => {
    expect(weekStart("2026-11-22")).toBe("2026-11-16"); // Sunday
    expect(weekStart("2026-11-23")).toBe("2026-11-23"); // Monday
  });

  it("daily, weekly and monthly limits are separate controls, not multiples of each other", () => {
    const l = limits({ daily_max: 80, weekly_max: 100, monthly_max: 1000 });
    const rows = [e("spend", 60, "2026-11-16"), e("spend", 30, "2026-11-18")];
    expect(
      wouldExceed(l, rows, {
        kind: "spend",
        amount: 30,
        currency: "EUR",
        occurred_on: "2026-11-16",
        data_class: "manual",
        relates_to: null,
      })?.limit,
    ).toBe("daily");
    expect(
      wouldExceed(l, rows, {
        kind: "spend",
        amount: 20,
        currency: "EUR",
        occurred_on: "2026-11-19",
        data_class: "manual",
        relates_to: null,
      })?.limit,
    ).toBe("weekly");
    expect(
      wouldExceed(l, rows, {
        kind: "spend",
        amount: 20,
        currency: "EUR",
        occurred_on: "2026-11-23",
        data_class: "manual",
        relates_to: null,
      }),
    ).toBeNull();
  });

  it("counts reservations, holds the reserve back and never lets simulated spending use real room", () => {
    const l = limits({ lifetime_max: 300, reserve_amount: 50 });
    const rows = [
      e("spend", 100, "2026-11-01"),
      e("commitment", 100, "2026-12-01"),
      e("spend", 1000, "2026-11-02", { data_class: "simulated" }),
    ];
    expect(
      wouldExceed(l, rows, {
        kind: "commitment",
        amount: 60,
        currency: "EUR",
        occurred_on: "2026-12-05",
        data_class: "manual",
        relates_to: null,
      }),
    ).toEqual({ limit: "lifetime", max: 250, used: 200 });
    expect(
      wouldExceed(l, rows, {
        kind: "spend",
        amount: 50,
        currency: "EUR",
        occurred_on: "2026-11-05",
        data_class: "manual",
        relates_to: null,
      }),
    ).toBeNull();
  });

  it("releases and downward corrections always pass; a correction counts on the day of its spend", () => {
    const l = limits({ daily_max: 100 });
    const rows = [
      e("spend", 90, "2026-11-10", { id: "s1" }),
      e("commitment", 50, "2026-11-11", { id: "c1" }),
    ];
    expect(
      wouldExceed(l, rows, {
        kind: "release",
        amount: -50,
        currency: "EUR",
        occurred_on: "2026-11-12",
        data_class: "manual",
        relates_to: "c1",
      }),
    ).toBeNull();
    expect(
      wouldExceed(l, rows, {
        kind: "correction",
        amount: 20,
        currency: "EUR",
        occurred_on: "2026-11-20",
        data_class: "manual",
        relates_to: "s1",
      })?.limit,
    ).toBe("daily");
  });

  it("an emergency stop blocks everything new and other currencies cannot be compared", () => {
    expect(
      wouldExceed(limits({ emergency_stop: true }), [], {
        kind: "spend",
        amount: 1,
        currency: "EUR",
        occurred_on: "2026-11-10",
        data_class: "manual",
        relates_to: null,
      })?.limit,
    ).toBe("emergency_stop");
    expect(
      wouldExceed(limits({ weekly_max: 100 }), [], {
        kind: "spend",
        amount: 1,
        currency: "USD",
        occurred_on: "2026-11-10",
        data_class: "manual",
        relates_to: null,
      })?.limit,
    ).toBe("currency");
  });

  it("reports the highest alert threshold crossed, once per limit", () => {
    const u = limitUsage(
      limits({ weekly_max: 100, monthly_max: 1000 }),
      [e("spend", 85, "2026-11-17")],
      "2026-11-18",
    );
    expect(u.map((x) => [x.key, x.crossed])).toEqual([
      ["weekly", 80],
      ["monthly", null],
    ]);
    const alerts = budgetAlerts({
      limits: limits({ weekly_max: 100 }),
      rows: [e("spend", 95, "2026-11-17")],
      today: "2026-11-18",
      campaign: { start_date: null, end_date: null, budget_eur: 0 },
    });
    expect(alerts).toEqual([
      { kind: "threshold", limit: "weekly", threshold: 90, used: 95, max: 100 },
    ]);
  });

  it("forecasts from actual spending only, labelled low confidence on little data, and null without data", () => {
    const c = { start_date: "2026-11-01", end_date: "2026-11-30" };
    expect(
      spendForecast(
        c,
        [e("spend", 999, "2026-11-02", { data_class: "simulated" })],
        "EUR",
        500,
        "2026-11-10",
      ),
    ).toBeNull();
    const f = spendForecast(
      c,
      [e("spend", 100, "2026-11-02"), e("spend", 100, "2026-11-09")],
      "EUR",
      500,
      "2026-11-10",
    );
    expect(f).toMatchObject({
      spent: 200,
      perDay: 20,
      projected: 600,
      overspend: 100,
      basisDays: 10,
      confidence: "low",
    });
    const a = budgetAlerts({
      limits: null,
      rows: [e("spend", 100, "2026-11-02"), e("spend", 100, "2026-11-09")],
      today: "2026-11-10",
      campaign: { ...c, budget_eur: 500 },
    });
    expect(a.map((x) => x.kind)).toEqual(["forecast_overspend"]);
  });

  it("warns when reservations exceed the room left", () => {
    const a = budgetAlerts({
      limits: null,
      rows: [e("spend", 300, "2026-11-02"), e("commitment", 250, "2026-11-20")],
      today: "2026-11-03",
      campaign: { start_date: null, end_date: null, budget_eur: 500 },
    });
    expect(a).toEqual([{ kind: "reservations_exceed", reserved: 250, room: 200 }]);
  });
});
