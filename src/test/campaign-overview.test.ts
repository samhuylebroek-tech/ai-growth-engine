import { describe, expect, it } from "vitest";
import {
  matchesCampaignFilter,
  campaignWorkProgress,
  campaignOverviewMoney,
} from "@/lib/campaign-overview";
describe("campaign overview", () => {
  it("separates running, preparing, planned and awaiting decisions without changing lifecycle statuses", () => {
    expect(matchesCampaignFilter("draft", "preparing")).toBe(true);
    expect(matchesCampaignFilter("draft", "active")).toBe(false);
    expect(matchesCampaignFilter("scheduled", "planned")).toBe(true);
    expect(matchesCampaignFilter("awaiting_approval", "awaiting")).toBe(true);
    expect(matchesCampaignFilter("needs_attention", "active")).toBe(true);
    expect(matchesCampaignFilter("needs_attention", "at_risk")).toBe(true);
    expect(matchesCampaignFilter("paused", "paused")).toBe(true);
    expect(matchesCampaignFilter("completed", "completed")).toBe(true);
    expect(matchesCampaignFilter("active", "at_risk", true)).toBe(true);
  });
  it("never invents progress for campaigns with no recorded work", () => {
    expect(campaignWorkProgress([])).toBeNull();
    expect(campaignWorkProgress([{ status: "cancelled" }])).toBeNull();
    expect(campaignWorkProgress([{ status: "done" }, { status: "todo" }])).toBe(50);
  });
  it("keeps an unavailable spending ledger unknown instead of showing zero spending", () => {
    expect(campaignOverviewMoney(200, undefined)).toBeNull();
    expect(campaignOverviewMoney(200, [])?.eur.spent).toBe(0);
    expect(campaignOverviewMoney(200, [])?.remaining).toBe(200);
  });
  it("excludes explicitly simulated spending and never subtracts USD from the EUR budget", () => {
    const summary = campaignOverviewMoney(200, [
      { kind: "spend", amount: 100, currency: "EUR", data_class: "manual" },
      { kind: "commitment", amount: 50, currency: "EUR", data_class: "manual" },
      { kind: "spend", amount: 500, currency: "EUR", data_class: "simulated" },
      { kind: "spend", amount: 30, currency: "USD", data_class: "manual" },
    ]);
    expect(summary?.eur.spent).toBe(100);
    expect(summary?.eur.committed).toBe(50);
    expect(summary?.remaining).toBe(50);
    expect(summary?.byCurrency["USD"]?.spent).toBe(30);
    expect(summary?.warnings).not.toContain("budget_over");
  });
});
