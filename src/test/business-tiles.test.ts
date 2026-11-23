import { describe, expect, it } from "vitest";
import { buildBusinessTiles, perCurrency, type TileInput } from "@/lib/business-tiles";

const ok = <T>(data: T) => ({ ok: true as const, data });
const base: TileInput = {
  now: new Date("2026-11-20T10:00:00Z"),
  openOpportunities: ok(3),
  activeGoals: ok(2),
  activeCampaigns: ok(1),
  tasksDone: ok(7),
  pendingApprovals: ok(4),
  aiRunsThisMonth: ok(5),
  aiCreditsThisMonth: ok(26),
  deals: ok([
    { stage: "lead", value: 1000, currency: "EUR", closed_at: null },
    { stage: "qualified", value: 500, currency: "USD", closed_at: null },
    { stage: "won", value: 2000, currency: "EUR", closed_at: "2026-11-03T09:00:00Z" },
    { stage: "won", value: 9000, currency: "EUR", closed_at: "2026-10-30T09:00:00Z" },
  ]),
  budget: ok([
    { planned: 1000, actual: 400, currency: "EUR" },
    { planned: 300, actual: 350, currency: "USD" },
  ]),
  revenue: ok([]),
};
const get = (input: TileInput, key: string) =>
  buildBusinessTiles(input).find((t) => t.key === key)!;

describe("Command Center number tiles", () => {
  it("never shows revenue from manually entered deals: without a connected source revenue is unavailable", () => {
    const t = get(base, "revenue");
    expect(t.unavailable).toBe("no_source");
    expect(t.values).toEqual([]);
    expect(get(base, "revenueVsTarget").unavailable).toBe("no_source");
  });
  it("shows imported revenue per currency for the latest month as an actual result", () => {
    const summary = {
      period: { start: "2026-10-01", end: "2026-10-31" },
      actual: { value: 12000, kind: "imported_actual" as const },
      planned: 15000,
      forecast: null,
      variance: -3000,
      onTrack: false,
      previousActual: null,
    };
    const input = { ...base, revenue: ok([{ currency: "EUR", summary }]) };
    const r = get(input, "revenue");
    expect(r.kind).toBe("actual");
    expect(r.values).toEqual([{ amount: 12000, unit: "currency", currency: "EUR" }]);
    expect(r.periodStart).toBe("2026-10-01");
    expect(get(input, "revenueVsTarget").values).toEqual([
      { amount: 80, unit: "percent", currency: "EUR" },
    ]);
  });
  it("a manually entered or corrected result on a revenue metric is never shown as revenue", () => {
    const summary = {
      period: { start: "2026-10-01", end: "2026-10-31" },
      actual: { value: 9000, kind: "manual_actual" as const },
      planned: 15000,
      forecast: null,
      variance: null,
      onTrack: null,
      previousActual: null,
    };
    const input = { ...base, revenue: ok([{ currency: "EUR", summary }]) };
    expect(get(input, "revenue").unavailable).toBe("no_source");
    expect(get(input, "revenue").values).toEqual([]);
  });
  it("revenue against plan is unavailable when no plan exists for that month", () => {
    const summary = {
      period: { start: "2026-10-01", end: "2026-10-31" },
      actual: { value: 12000, kind: "imported_actual" as const },
      planned: null,
      forecast: null,
      variance: null,
      onTrack: null,
      previousActual: null,
    };
    expect(
      get({ ...base, revenue: ok([{ currency: "EUR", summary }]) }, "revenueVsTarget").unavailable,
    ).toBe("no_target");
  });
  it("counts leads and qualified leads by pipeline stage and labels them as entered", () => {
    expect(get(base, "leads").values[0]?.amount).toBe(1);
    expect(get(base, "qualified").values[0]?.amount).toBe(1);
    expect(get(base, "leads").kind).toBe("entered");
  });
  it("open deal value is an estimate kept per currency, never added across currencies", () => {
    const t = get(base, "openDeals");
    expect(t.kind).toBe("estimate");
    expect(t.values).toEqual([
      { amount: 2, unit: "count" },
      { amount: 1000, unit: "currency", currency: "EUR" },
      { amount: 500, unit: "currency", currency: "USD" },
    ]);
  });
  it("won deals count only those closed in the current month", () => {
    expect(get(base, "wonDeals").values).toEqual([
      { amount: 1, unit: "count" },
      { amount: 2000, unit: "currency", currency: "EUR" },
    ]);
  });
  it("remaining budget is planned minus entered spend per currency, negative when over plan", () => {
    expect(get(base, "remaining").values).toEqual([
      { amount: 600, unit: "currency", currency: "EUR" },
      { amount: -50, unit: "currency", currency: "USD" },
    ]);
    expect(get(base, "spend").values).toEqual([
      { amount: 400, unit: "currency", currency: "EUR" },
      { amount: 350, unit: "currency", currency: "USD" },
    ]);
  });
  it("marks budget tiles unavailable when nothing was entered this month", () => {
    expect(get({ ...base, budget: ok([]) }, "spend").unavailable).toBe("no_data");
  });
  it("withholds figures whose source is not switched on, failed or too large", () => {
    expect(
      get({ ...base, openOpportunities: { ok: false, reason: "not_switched_on" } }, "opportunities")
        .unavailable,
    ).toBe("not_switched_on");
    expect(get({ ...base, deals: { ok: false, reason: "too_many" } }, "leads").unavailable).toBe(
      "too_many",
    );
    expect(
      get({ ...base, aiCreditsThisMonth: { ok: false, reason: "load_failed" } }, "aiCredits")
        .values,
    ).toEqual([]);
  });
  it("sums per currency without mixing", () => {
    expect(
      perCurrency([
        { amount: 1, currency: "USD" },
        { amount: 2, currency: "EUR" },
        { amount: 3, currency: "EUR" },
      ]),
    ).toEqual([
      { amount: 5, unit: "currency", currency: "EUR" },
      { amount: 1, unit: "currency", currency: "USD" },
    ]);
  });
});
