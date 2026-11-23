import { describe, expect, it } from "vitest";
import {
  draftProblems,
  impactPreview,
  priceHistory,
  versionAt,
  type PriceDraft,
} from "@/lib/econ/price-admin";
import type { CreditPriceVersionRow } from "@/lib/pending-schema";

const v = (
  id: string,
  from: string,
  price: number,
  extra: Partial<CreditPriceVersionRow> = {},
): CreditPriceVersionRow => ({
  id,
  scope: "platform",
  plan_key: null,
  currency: "EUR",
  price_per_credit: price,
  effective_from: from,
  methodology: "m",
  created_by: "u",
  created_at: from,
  ...extra,
});
const NOW = new Date("2026-11-20T12:00:00Z");

describe("credit price history", () => {
  const rows = [
    v("a", "2026-10-01T00:00:00Z", 0.04),
    v("b", "2026-11-01T00:00:00Z", 0.05),
    v("c", "2026-12-01T00:00:00Z", 0.06),
    v("p", "2026-11-05T00:00:00Z", 0.03, { scope: "plan", plan_key: "pro" }),
  ];
  it("derives replaced, in-effect and scheduled versions with an end time from the next version", () => {
    const h = Object.fromEntries(priceHistory(rows, NOW).map((r) => [r.id, r]));
    expect(h["a"]).toMatchObject({ status: "superseded", effective_to: "2026-11-01T00:00:00Z" });
    expect(h["b"]).toMatchObject({ status: "active", effective_to: "2026-12-01T00:00:00Z" });
    expect(h["c"]).toMatchObject({ status: "scheduled", effective_to: null });
    // a plan price is its own line of history and never ends a platform price
    expect(h["p"]).toMatchObject({ status: "active", effective_to: null });
  });
  it("finds the version in effect at a moment for a scope", () => {
    expect(versionAt(rows, "platform", null, "EUR", NOW)?.id).toBe("b");
    expect(versionAt(rows, "plan", "pro", "EUR", NOW)?.id).toBe("p");
    expect(versionAt(rows, "platform", null, "USD", NOW)).toBeNull();
  });
});

describe("new price checks (same rules as the database)", () => {
  const ok: PriceDraft = {
    scope: "platform",
    plan: null,
    currency: "EUR",
    price: 0.05,
    effectiveFrom: "2026-11-20T12:10:00Z",
    methodology: "provider cost",
  };
  it("accepts a valid platform price", () => expect(draftProblems(ok, NOW)).toEqual([]));
  it("refuses a back-dated start, beyond five minutes", () => {
    expect(draftProblems({ ...ok, effectiveFrom: "2026-11-20T11:54:00Z" }, NOW)).toContain(
      "backdated",
    );
    expect(draftProblems({ ...ok, effectiveFrom: "2026-11-20T11:56:00Z" }, NOW)).not.toContain(
      "backdated",
    );
  });
  it("refuses zero, negative and too-high prices", () => {
    for (const price of [0, -1, 1000, Number.NaN])
      expect(draftProblems({ ...ok, price }, NOW)).toContain("price");
  });
  it("requires a plan for a plan price and refuses one for a platform price", () => {
    expect(draftProblems({ ...ok, scope: "plan", plan: null }, NOW)).toContain("plan_required");
    expect(draftProblems({ ...ok, plan: "pro" }, NOW)).toContain("plan_not_allowed");
  });
  it("requires a three-letter currency and a methodology", () => {
    expect(draftProblems({ ...ok, currency: "EU" }, NOW)).toContain("currency");
    expect(draftProblems({ ...ok, methodology: "  " }, NOW)).toContain("methodology");
  });
});

describe("impact preview", () => {
  it("values the last 30 days of credits at the current and new price", () => {
    expect(impactPreview(1000, 0.05, 0.06)).toEqual({
      credits30d: 1000,
      currentMonthly: 50,
      nextMonthly: 60,
      change: 10,
    });
  });
  it("has no comparison when no price applies yet", () => {
    expect(impactPreview(200, null, 0.05)).toEqual({
      credits30d: 200,
      currentMonthly: null,
      nextMonthly: 10,
      change: null,
    });
  });
});
