import { describe, it, expect } from "vitest";
import { performanceOverview, missingLastMonth, lastCompleteMonth, type Measurement } from "@/lib/performance";
import { budgetByCurrency } from "@/lib/growth-plan";

const row = (id: string, metric_id: string, kind: string, month: string, value: number): Measurement => ({ id, metric_id, kind, period_start: `${month}-01`, period_end: `${month}-28`, value, corrects_id: null, created_at: "2026-11-01T00:00:00Z" });
const m = (id: string, archived = false) => ({ id, direction: "increase", archived });

describe("home performance overview", () => {
  const rows = [row("1", "a", "planned", "2026-10", 40), row("2", "a", "manual_actual", "2026-10", 31), row("3", "b", "planned", "2026-10", 10), row("4", "b", "manual_actual", "2026-10", 12), row("5", "c", "planned", "2026-10", 5)];
  it("lists behind-plan metrics first and counts on-track and waiting metrics", () => {
    const o = performanceOverview([m("b"), m("c"), m("a"), m("z", true)], rows);
    expect(o.items.map(i => i.metric.id)).toEqual(["a", "c", "b"]);
    expect(o.behind.map(i => i.metric.id)).toEqual(["a"]);
    expect(o.onTrack).toBe(1);
    expect(o.waiting).toBe(1);
  });
  it("asks for last month's result only where none is recorded", () => {
    expect(lastCompleteMonth(new Date("2026-11-19T08:00:00Z"))).toBe("2026-10");
    expect(lastCompleteMonth(new Date("2026-01-05T08:00:00Z"))).toBe("2025-12");
    expect(missingLastMonth([m("a"), m("b"), m("c"), m("z", true)], rows, new Date("2026-11-19T08:00:00Z")).map(x => x.id)).toEqual(["c"]);
  });
});

describe("home budget overview", () => {
  it("keeps currencies apart and flags lines over plan or cap", () => {
    const r = budgetByCurrency([
      { currency: "EUR", planned: 1000, actual: 1200, hard_cap: null },
      { currency: "EUR", planned: 500, actual: 700, hard_cap: 600 },
      { currency: "USD", planned: 300, actual: 100, hard_cap: null },
    ]);
    expect(r).toEqual([
      { currency: "EUR", planned: 1500, actual: 1900, remaining: -400, variance: 400, lines: 2, overCap: 1, overPlan: 1 },
      { currency: "USD", planned: 300, actual: 100, remaining: 200, variance: -200, lines: 1, overCap: 0, overPlan: 0 },
    ]);
  });
});
