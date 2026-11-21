// Hard spending limits (proposal 0083) reach the shared risk signals and the Growth Officer context with the same
// rules as the campaign page: actual entries only, an emergency stop always shows, simulated entries never trigger.
import { describe, expect, it } from "vitest";
import { detectSignals } from "@/lib/signals";
import type { BusinessDomains, LimitLine, SpendLine } from "@/lib/security/business-context";

const TODAY = "2026-11-20"; // Friday; the week started on Monday 16 November
const camp = { id: "c1", title: "Autumn", status: "active", category: "advertising", budget_eur: 0, results: "", start_date: "2026-11-16", end_date: "2026-11-30" };
const ok = <T,>(rows: T[]) => ({ status: "ok" as const, rows, truncated: false });
const limit = (p: Partial<LimitLine> = {}): LimitLine => ({ campaign_id: "c1", currency: "EUR", daily_max: null, weekly_max: 100, monthly_max: null, lifetime_max: null, reserve_amount: null, alert_thresholds: [50, 80, 90, 100], emergency_stop: false, stop_reason: "", ...p });
let n = 0;
const spend = (amount: number, data_class: "manual" | "simulated" = "manual", occurred_on = "2026-11-18"): SpendLine => ({ id: `s${++n}`, campaign_id: "c1", kind: "spend", amount, currency: "EUR", data_class, occurred_on, relates_to: null });
function codes(limits: LimitLine[], ledger: SpendLine[]) {
  const d = { workspace: { id: "w", name: "Main" }, objectives: null, facts: [], goals: [], recommendations: [], plans: ok([]), initiatives: [], operations: [], projects: [], tasks: [],
    budget: ok([]), deals: ok([]), competitors: ok([]), observations: [], seo: ok([]), content: ok([]), versions: [], decisions: [], campaigns: ok([camp]), connections: ok([]), metrics: ok([]), measurements: [],
    campaignSpend: ok(ledger), campaignLimits: ok(limits) } as unknown as BusinessDomains;
  return detectSignals(d, new Date(`${TODAY}T08:00:00Z`)).map((x) => x.code);
}

describe("campaign spending limit signals", () => {
  it("a limit used for 90% or more by actual spending is a risk", () => {
    expect(codes([limit()], [spend(95)])).toContain("campaign_limit_reached");
    expect(codes([limit()], [spend(70)])).not.toContain("campaign_limit_reached");
  });
  it("simulated spending never reaches a real limit", () => {
    expect(codes([limit()], [spend(500, "simulated")])).not.toContain("campaign_limit_reached");
  });
  it("an emergency stop is always reported", () => {
    expect(codes([limit({ emergency_stop: true, stop_reason: "Unexpected invoice" })], [])).toContain("campaign_emergency_stop");
  });
  it("a straight-line forecast above the campaign total is reported as an estimate", () => {
    // 100 spent over 5 days (16–20 Nov) → 20/day → about 300 by 30 Nov, above a total of 250.
    expect(codes([limit({ weekly_max: null, lifetime_max: 250 })], [spend(100, "manual", "2026-11-17")])).toContain("campaign_spend_forecast");
    expect(codes([limit({ weekly_max: null, lifetime_max: 400 })], [spend(100, "manual", "2026-11-17")])).not.toContain("campaign_spend_forecast");
  });
  it("without limits nothing is claimed", () => {
    expect(codes([], [spend(5000)]).filter((c) => c.startsWith("campaign_limit") || c === "campaign_emergency_stop" || c === "campaign_spend_forecast")).toEqual([]);
  });
});
