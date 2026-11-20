import { describe, expect, it } from "vitest";
import {
  attribute,
  netSales,
  revenueTotals,
  weights,
  type RevenueEvent,
  type Touch,
} from "@/lib/bi/attribution";
import { freshness, measurementClass, reliability, revenueClass } from "@/lib/bi/provenance";

const ev = (
  id: string,
  kind: string,
  amount: number,
  extra: Partial<RevenueEvent> = {},
): RevenueEvent => ({
  id,
  kind,
  amount,
  currency: "EUR",
  occurred_at: "2026-10-15T12:00:00Z",
  data_class: "manual",
  source: "manual",
  source_ref: "",
  customer_ref: "",
  relates_to: null,
  unit_id: null,
  ...extra,
});
const tp = (id: string, sale: string, at: string, extra: Partial<Touch> = {}): Touch => ({
  id,
  revenue_event_id: sale,
  campaign_id: null,
  initiative_id: null,
  channel: "search",
  touched_at: at,
  evidence: "manual",
  retracted_at: null,
  ...extra,
});

describe("revenue ledger", () => {
  it("subtracts refunds, cancellations and corrections from their own sale", () => {
    const n = netSales([
      ev("s", "sale", 100),
      ev("r", "refund", -30, { relates_to: "s" }),
      ev("c", "correction", -5, { relates_to: "s" }),
    ]);
    expect(n[0]!.net).toBe(65);
    expect(n[0]!.refunded).toBe(-30);
  });
  it("keeps currencies apart and estimated revenue outside the actual total", () => {
    const t = revenueTotals([
      ev("a", "sale", 100),
      ev("b", "sale", 50, { currency: "USD" }),
      ev("c", "sale", 500, { data_class: "estimated" }),
      ev("d", "sale", 40, { data_class: "imported", source: "stripe" }),
    ]);
    expect(t.map((x) => [x.currency, x.net, x.estimated, x.imported, x.manual])).toEqual([
      ["EUR", 140, 500, 40, 100],
      ["USD", 50, 0, 0, 50],
    ]);
  });
  it("only counts sales inside the period", () => {
    expect(
      revenueTotals(
        [ev("a", "sale", 100), ev("b", "sale", 70, { occurred_at: "2026-08-01T00:00:00Z" })],
        "2026-10-01",
        "2026-10-31",
      )[0]!.net,
    ).toBe(100);
  });
});

describe("attribution models", () => {
  const ts = [
    tp("1", "s", "2026-10-01T00:00:00Z", { channel: "social" }),
    tp("2", "s", "2026-10-08T00:00:00Z", { channel: "email" }),
    tp("3", "s", "2026-10-14T00:00:00Z", { channel: "search" }),
  ];
  it("first touch, last touch, linear and position based weights", () => {
    expect(weights("first_touch", ts, "2026-10-15T00:00:00Z")).toEqual([1, 0, 0]);
    expect(weights("last_touch", ts, "2026-10-15T00:00:00Z")).toEqual([0, 0, 1]);
    expect(weights("position_based", ts, "2026-10-15T00:00:00Z")).toEqual([0.4, 0.2, 0.4]);
    const td = weights("time_decay", ts, "2026-10-15T00:00:00Z");
    expect(td[2]!).toBeGreaterThan(td[1]!);
    expect(td[1]!).toBeGreaterThan(td[0]!);
  });
  it("splits a sale so the credited parts add up exactly to its net amount", () => {
    const a = attribute(
      [ev("s", "sale", 100), ev("r", "refund", -0.01, { relates_to: "s" })],
      ts,
      "linear",
    )[0]!;
    expect(a.attributed).toBe(99.99);
    expect(Math.round(a.credits.reduce((s, c) => s + c.amount, 0) * 100)).toBe(9999);
  });
  it("leaves a sale without touchpoints unattributed instead of forcing a split", () => {
    const a = attribute([ev("s", "sale", 100), ev("t", "sale", 60)], ts, "last_touch")[0]!;
    expect([a.total, a.attributed, a.unattributed, a.unattributedSales]).toEqual([160, 100, 60, 1]);
  });
  it("direct attribution uses only verified links", () => {
    const a = attribute([ev("s", "sale", 100)], ts, "direct")[0]!;
    expect(a.unattributed).toBe(100);
    const b = attribute(
      [ev("s", "sale", 100)],
      [
        ...ts,
        tp("4", "s", "2026-10-10T00:00:00Z", { campaign_id: "c1", evidence: "verified_link" }),
      ],
      "direct",
    )[0]!;
    expect(b.credits).toEqual([
      {
        key: "campaign:c1",
        amount: 100,
        sales: 1,
        confidence: "high",
        evidence: { verified_link: 1 },
      },
    ]);
  });
  it("ignores retracted touchpoints and touches after the sale", () => {
    const a = attribute(
      [ev("s", "sale", 100)],
      [
        tp("x", "s", "2026-10-10T00:00:00Z", { retracted_at: "2026-10-20T00:00:00Z" }),
        tp("y", "s", "2026-10-20T00:00:00Z"),
      ],
      "last_touch",
    )[0]!;
    expect(a.unattributed).toBe(100);
  });
  it("never attributes estimated sales", () => {
    const a = attribute(
      [ev("s", "sale", 100, { data_class: "estimated" })],
      [tp("1", "s", "2026-10-01T00:00:00Z")],
      "linear",
    )[0]!;
    expect([a.total, a.attributed, a.estimatedExcluded]).toEqual([0, 0, 100]);
  });
  it("marks manual evidence as low confidence", () => {
    expect(attribute([ev("s", "sale", 10)], ts, "last_touch")[0]!.credits[0]!.confidence).toBe(
      "low",
    );
  });
});

describe("provenance", () => {
  it("classifies data and its reliability", () => {
    expect(measurementClass("imported_actual")).toEqual({
      cls: "actual",
      verification: "source_reported",
    });
    expect(measurementClass("forecast").cls).toBe("estimated");
    expect(revenueClass("manual").verification).toBe("unverified");
    const now = new Date("2026-11-20T00:00:00Z");
    expect([
      freshness("2026-10-31", now),
      freshness("2026-09-30", now),
      freshness("2026-06-30", now),
      freshness(null, now),
    ]).toEqual(["current", "aging", "stale", "unknown"]);
    expect(reliability("actual", "source_reported", "current")).toBe("high");
    expect(reliability("manual", "unverified", "current")).toBe("medium");
    expect(reliability("estimated", "not_applicable", "current")).toBe("low");
  });
});
