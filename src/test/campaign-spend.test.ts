import { describe, expect, it } from "vitest";
import { openAmount, spendSummary } from "@/lib/campaign-spend";
import { campaignHealth } from "@/lib/campaign-health";

const e = (kind: "spend" | "commitment" | "release" | "correction", amount: number, currency = "EUR", data_class: "manual" | "simulated" = "manual") => ({ kind, amount, currency, data_class });

describe("campaign spend", () => {
  it("remaining budget = budget − spent − committed, with corrections and releases netted", () => {
    const s = spendSummary(500, [e("spend", 100), e("correction", -30), e("commitment", 50), e("release", -50), e("commitment", 40), e("spend", 100, "EUR", "simulated")]);
    expect(s.eur).toEqual({ spent: 70, committed: 40, released: 50, entries: 5 });
    expect(s.simulatedEur).toEqual({ spent: 100, committed: 0, released: 0, entries: 1 });
    expect(s.remaining).toBe(390);
    expect(s.warnings).toEqual([]);
  });

  it("warns at 80% of the budget, when commitments exceed it, and when spend exceeds it", () => {
    expect(spendSummary(500, [e("spend", 400)]).warnings).toEqual(["budget_near"]);
    expect(spendSummary(500, [e("spend", 300), e("commitment", 250)]).warnings).toEqual(["committed_over"]);
    const over = spendSummary(500, [e("spend", 520.5)]);
    expect(over.warnings).toEqual(["budget_over"]);
    expect(over.remaining).toBe(-20.5);
  });

  it("never compares other currencies with the EUR budget", () => {
    const s = spendSummary(100, [e("spend", 900, "USD")]);
    expect(s.eur.spent).toBe(0);
    expect(s.warnings).toEqual(["other_currency"]);
  });

  it("spend without a budget is flagged instead of a percentage", () => {
    const s = spendSummary(0, [e("spend", 10)]);
    expect(s.usedPct).toBeNull();
    expect(s.warnings).toEqual(["spend_without_budget"]);
  });

  it("open amount of an entry subtracts its corrections", () => {
    expect(openAmount({ id: "s", amount: 100 }, [{ relates_to: "s", amount: -30 }, { relates_to: "x", amount: -5 }])).toBe(70);
  });

  it("a budget overrun makes an active campaign need attention and counts as serious", () => {
    const c = { status: "active", start_date: "2026-11-01", end_date: "2026-12-31", goal_id: "g", results: "" };
    const tasks = [{ status: "done", due_date: "2026-11-05" }, { status: "todo", due_date: "2026-11-10" }];
    expect(campaignHealth(c, tasks, "2026-11-20", spendSummary(500, [e("spend", 600)])).warnings).toEqual(["overdue_tasks", "budget_over"]);
    expect(campaignHealth(c, tasks, "2026-11-20", spendSummary(500, [e("spend", 600)])).state).toBe("at_risk");
    expect(campaignHealth(c, [{ status: "done", due_date: "2026-11-05" }, { status: "todo", due_date: "2026-12-10" }], "2026-11-20", spendSummary(500, [e("spend", 450)])).warnings).toEqual(["budget_near"]);
    expect(campaignHealth(c, [{ status: "done", due_date: "2026-11-05" }, { status: "todo", due_date: "2026-12-10" }], "2026-11-20", spendSummary(500, [e("spend", 501)])).state).toBe("at_risk");
  });
});
