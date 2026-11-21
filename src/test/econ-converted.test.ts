// Growth Officer converted totals: same monthly closing-rate conversion as Home and the organization view.
import { describe, expect, it } from "vitest";
import { convertedEconomicsLine } from "@/lib/econ/converted";
import { economicsSummary } from "@/lib/econ/summary";
import type { EconData } from "@/lib/econ/read";
import type { Rate } from "@/lib/org/consolidation";

const base = (): EconData => ({
  campaigns: [], budgetLines: [], allocations: [], spend: [], costs: [], models: [], revenue: [], touches: [], credits: [],
  usage: [], prices: [], planKey: null, initiatives: [], strategies: [], goals: [], learnings: [], proposals: [], requests: [], incomplete: [], costsInstalled: true,
} as unknown as EconData);
const sale = (id: string, amount: number, currency: string, at: string) => ({ id, kind: "sale", amount, currency, occurred_at: `${at}T12:00:00Z`, data_class: "manual", source: "manual", source_ref: "", customer_ref: "c", relates_to: null, unit_id: null, deal_id: null, created_at: `${at}T12:00:00Z` });
const usd = (date: string, rate: number): Rate => ({ id: date, base_currency: "EUR", quote_currency: "USD", rate, rate_date: date, source: "ECB", kind: "official" });
const line = (d: EconData, rates: Rate[]) =>
  convertedEconomicsLine(d, economicsSummary(d, "2026-10-01", "2026-10-31", "last_touch", "2026-11-21"), "2026-10-01", "2026-10-31", "2026-11-21", "EUR", rates);

describe("Growth Officer converted economics", () => {
  it("converts US$250 at the October closing rate and adds it to euro revenue", () => {
    const d = base(); d.revenue = [sale("a", 250, "USD", "2026-10-15"), sale("b", 100, "EUR", "2026-10-16")] as never;
    const l = line(d, [usd("2026-10-30", 1.1172)]);
    expect(l).toContain("net revenue (recorded) 323.77 EUR");
    expect(l).toContain("1 USD = 0.8951 EUR (ECB, 2026-10-30)");
  });
  it("withholds the total when no rate is usable instead of guessing", () => {
    const d = base(); d.revenue = [sale("a", 250, "USD", "2026-10-15")] as never;
    expect(line(d, [usd("2026-10-10", 1.1)])).toContain("net revenue (recorded): not converted (no usable rate for USD on 2026-10-31)");
  });
  it("adds nothing when every amount is already in the reporting currency", () => {
    const d = base(); d.revenue = [sale("b", 100, "EUR", "2026-10-16")] as never;
    expect(line(d, [])).toBeNull();
  });
});
