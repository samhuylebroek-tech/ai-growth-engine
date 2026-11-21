import { describe, expect, it } from "vitest";
import { needsConversion, periodCurrencies } from "@/components/bi/home-converted";

describe("converted figures on Home", () => {
  it("are shown when the period has money in two currencies", () => {
    const c = periodCurrencies({ revenue: [{ currency: "EUR", occurred_at: "2026-10-03T10:00:00Z" }], spend: [{ currency: "USD", occurred_on: "2026-10-05" }], costs: [] }, "2026-10-01", "2026-10-31");
    expect(c).toEqual(["EUR", "USD"]);
    expect(needsConversion(c, "EUR")).toBe(true);
  });
  it("are not shown when everything is already in the reporting currency", () => {
    expect(needsConversion(["EUR"], "EUR")).toBe(false);
    expect(needsConversion([], "EUR")).toBe(false);
  });
  it("are shown when the only currency differs from the reporting currency", () => {
    expect(needsConversion(["GBP"], "EUR")).toBe(true);
  });
  it("ignore money outside the period", () => {
    expect(periodCurrencies({ revenue: [{ currency: "USD", occurred_at: "2026-09-30T23:00:00Z" }], spend: [], costs: [] }, "2026-10-01", "2026-10-31")).toEqual([]);
  });
});
