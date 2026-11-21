import { describe, expect, it } from "vitest";
import { budgetEconomics, groupAllocations, lineEconomics, monthForecast, previewAllocation } from "@/lib/budget-allocation";

const line = { id: "L", channel: "paid_social", period_month: "2026-11-01", planned: 10000, actual: 0, currency: "EUR" };
const alloc = (campaign_id: string, amount: number, budget_line_id = "L") => ({ budget_line_id, campaign_id, amount, status: "active" as const });
const spend = (campaign_id: string, kind: "spend" | "commitment" | "release" | "correction", amount: number, data_class: "manual" | "simulated" = "manual", budget_line_id: string | null = "L") => ({ campaign_id, kind, amount, data_class, budget_line_id });

describe("budget allocation economics", () => {
  it("€10,000 paid social split 4,000 / 3,000 / 2,000 leaves exactly €1,000 unallocated", () => {
    const e = lineEconomics(line, [alloc("A", 4000), alloc("B", 3000), alloc("C", 2000)], []);
    expect(e.allocated).toBe(9000);
    expect(e.unallocated).toBe(1000);
  });
  it("cancelled allocations free their amount", () => {
    expect(lineEconomics(line, [alloc("A", 4000), { ...alloc("B", 3000), status: "cancelled" as const }], []).unallocated).toBe(6000);
  });
  it("reservations are not spending, releases reduce reservations, simulated stays apart", () => {
    const e = lineEconomics(line, [alloc("A", 4000)], [spend("A", "spend", 1000), spend("A", "commitment", 2000), spend("A", "release", -500), spend("A", "spend", 3000, "simulated")]);
    expect(e).toMatchObject({ spent: 1000, reserved: 1500, simulatedSpent: 3000 });
    expect(e.campaigns[0]).toMatchObject({ amount: 4000, available: 1500 });
  });
  it("spending not paid from a line never counts on that line", () => {
    expect(lineEconomics(line, [alloc("A", 4000)], [spend("A", "spend", 999, "manual", null)]).spent).toBe(0);
  });
  it("the older amount recorded on the line is kept apart and flagged when ledger spending exists too", () => {
    const e = lineEconomics({ ...line, actual: 800 }, [alloc("A", 4000)], [spend("A", "spend", 500)]);
    expect(e.spent).toBe(500);
    expect(e.recordedOnLine).toBe(800);
    expect(e.overlap).toBe(true);
  });
  it("keeps currencies separate and computes remaining as total minus spent and reserved", () => {
    const usd = { ...line, id: "U", currency: "USD", planned: 500 };
    const b = budgetEconomics([line, usd], [alloc("A", 4000), alloc("B", 200, "U")], [spend("A", "spend", 1000), spend("A", "commitment", 500), spend("B", "spend", 50, "manual", "U")]);
    expect(b.byCurrency["EUR"]).toMatchObject({ total: 10000, allocated: 4000, unallocated: 6000, spent: 1000, reserved: 500, remaining: 8500 });
    expect(b.byCurrency["USD"]).toMatchObject({ total: 500, allocated: 200, spent: 50, remaining: 450 });
  });
  it("forecast is an estimate from actual spending only and absent without it", () => {
    expect(monthForecast(1000, 0.5)).toBe(2000);
    expect(monthForecast(0, 0.5)).toBeNull();
    expect(monthForecast(1000, 1)).toBeNull();
  });
  it("groups allocations by goal for drill-down", () => {
    const e = lineEconomics(line, [alloc("A", 4000), alloc("B", 3000)], []);
    const g = groupAllocations([e], [{ id: "A", title: "A", status: "active", goal_id: "g1" }, { id: "B", title: "B", status: "active", goal_id: null }], "goal_id");
    expect(g.get("g1")?.["EUR"]?.allocated).toBe(4000);
    expect(g.get(null)?.["EUR"]?.allocated).toBe(3000);
  });
  it("previews the same refusals as the database", () => {
    const e = lineEconomics(line, [alloc("A", 4000), alloc("B", 3000), alloc("C", 2000)], [spend("A", "spend", 1000), spend("A", "commitment", 1500)]);
    const c = (id: string, status = "active", goal_id: string | null = null) => ({ id, title: id, status, goal_id });
    expect(previewAllocation(line, e, c("C"), 3500)).toBe("exceeds_unallocated");
    expect(previewAllocation(line, e, c("C"), 3000)).toBeNull();
    expect(previewAllocation(line, e, c("A"), 2000)).toBe("below_committed");
    expect(previewAllocation(line, e, c("D", "completed"), 100)).toBe("campaign_closed");
    expect(previewAllocation({ ...line, goal_id: "g2" }, e, c("D", "active", "g1"), 100)).toBe("earmark_mismatch");
    expect(previewAllocation(line, e, c("A"), 4000)).toBe("no_change");
  });
});
