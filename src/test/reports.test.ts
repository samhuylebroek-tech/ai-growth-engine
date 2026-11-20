import { describe, expect, it } from "vitest";
import { buildReport, periods, revenueFigures, spendFigures, taskFigures } from "@/lib/reports";

const today = "2026-11-20";
const rev = (kind: string, amount: number, occurred_at: string, data_class = "manual", currency = "EUR") => ({ kind, amount, currency, occurred_at, data_class });
const spend = (amount: number, occurred_on: string, kind = "spend", currency = "EUR") => ({ campaign_id: "c", kind, amount, currency, occurred_on, data_class: "simulated" });
const empty = { revenue: [], spend: [], tasks: [], runs: [], experiments: [], campaigns: [] };

describe("reports", () => {
  it("periods: last complete month and the month before; rolling windows of equal length", () => {
    expect(periods("last_month", today)).toEqual({ current: { from: "2026-10-01", to: "2026-10-31" }, previous: { from: "2026-09-01", to: "2026-09-30" } });
    expect(periods("7d", today)).toEqual({ current: { from: "2026-11-14", to: "2026-11-20" }, previous: { from: "2026-11-07", to: "2026-11-13" } });
    expect(periods("last_month", "2026-01-05").current).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("net revenue = sales + refunds + corrections in the period; estimates stay separate", () => {
    const p = { from: "2026-10-01", to: "2026-10-31" };
    const f = revenueFigures([rev("sale", 1000, "2026-10-03T10:00:00Z"), rev("refund", -150, "2026-10-09T10:00:00Z"), rev("correction", -20, "2026-10-10T00:00:00Z"),
      rev("sale", 500, "2026-10-12T00:00:00Z", "estimated"), rev("sale", 99, "2026-11-01T00:00:00Z")], p);
    expect(f.recorded["EUR"]).toEqual({ sales: 1000, refunds: -150, corrections: -20, net: 830, entries: 3 });
    expect(f.estimated["EUR"]).toBe(500);
  });

  it("campaign spend in the period counts spending and corrections, not reservations", () => {
    const f = spendFigures([spend(200, "2026-10-02"), spend(-10, "2026-10-05", "correction"), spend(50, "2026-10-06", "commitment"), spend(70, "2026-11-02")], { from: "2026-10-01", to: "2026-10-31" });
    expect(f.spent).toEqual({ EUR: 190 });
    expect(f.simulated).toBe(2);
  });

  it("financial report compares with the previous month and computes revenue per recorded spend only in one currency", () => {
    const r = buildReport("financial", "last_month", { ...empty,
      revenue: [rev("sale", 1000, "2026-10-03T00:00:00Z"), rev("refund", -100, "2026-10-04T00:00:00Z"), rev("sale", 600, "2026-09-10T00:00:00Z"), rev("sale", 300, "2026-10-05T00:00:00Z", "manual", "USD")],
      spend: [spend(300, "2026-10-10")] }, today);
    const eur = r.finance.find((f) => f.currency === "EUR")!;
    expect(eur.net).toEqual({ now: 900, before: 600, change: 300, pct: 50 });
    expect(eur.perSpend).toBe(3);
    expect(r.finance.find((f) => f.currency === "USD")!.perSpend).toBeNull();
    expect(r.missing).toEqual([]);
  });

  it("names what is missing instead of showing zeros as results", () => {
    const r = buildReport("monthly", "last_month", { ...empty, spend: null }, today);
    expect(r.missing).toEqual(["revenue", "spend_unavailable", "runs"]);
    expect(buildReport("campaign", "30d", empty, today).missing).toEqual(["spend", "campaigns"]);
  });

  it("task figures: open and overdue now, done counted by last change in the period", () => {
    const t = (id: string, status: string, due: string | null, updated: string) => ({ id, status, due_date: due, created_at: "2026-11-01T00:00:00Z", updated_at: updated, campaign_id: null });
    const f = taskFigures([t("a", "done", null, "2026-11-18T00:00:00Z"), t("b", "todo", "2026-11-10", "x"), t("c", "todo", "2026-12-01", "x"), t("d", "done", null, "2026-10-01T00:00:00Z")], periods("7d", today).current, today);
    expect(f).toEqual({ created: 0, doneLastChanged: 1, open: 2, overdue: 1 });
  });
});
