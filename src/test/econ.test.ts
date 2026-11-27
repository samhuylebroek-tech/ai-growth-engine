import { describe, expect, it } from "vitest";
import { rollup, unlinkedCredits, completeness } from "@/lib/econ/rollup";
import { creditCost, priceAt } from "@/lib/econ/credit-pricing";
import {
  cac,
  campaignRoas,
  grossProfit,
  observedCustomerValue,
  modelFor,
} from "@/lib/econ/profitability";
import { duplicateGroups, wouldDuplicate, lineLabel } from "@/lib/econ/budget-duplicates";
import type { RevenueEvent, Touch } from "@/lib/bi/attribution";

const campaigns = [
  { id: "A", title: "A", status: "active", initiative_id: "I", strategy_id: "S", goal_id: "G" },
  { id: "B", title: "B", status: "active", initiative_id: "I", strategy_id: "S", goal_id: "G" },
  { id: "C", title: "C", status: "active", initiative_id: null, strategy_id: "S", goal_id: null },
];
const allocations = [
  { campaign_id: "A", amount: 400, status: "active", currency: "EUR" },
  { campaign_id: "B", amount: 300, status: "active", currency: "EUR" },
  { campaign_id: "C", amount: 100, status: "cancelled", currency: "EUR" },
];
const spend = [
  {
    campaign_id: "A",
    kind: "spend",
    amount: 100,
    currency: "EUR",
    data_class: "manual",
    category: "marketing",
  },
  {
    campaign_id: "A",
    kind: "spend",
    amount: 50,
    currency: "EUR",
    data_class: "manual",
    category: "production",
  },
  {
    campaign_id: "A",
    kind: "correction",
    amount: -10,
    currency: "EUR",
    data_class: "manual",
    category: "marketing",
  },
  {
    campaign_id: "B",
    kind: "commitment",
    amount: 80,
    currency: "EUR",
    data_class: "manual",
    category: "marketing",
  },
  {
    campaign_id: "B",
    kind: "spend",
    amount: 999,
    currency: "EUR",
    data_class: "simulated",
    category: "marketing",
  },
  {
    campaign_id: "C",
    kind: "spend",
    amount: 20,
    currency: "USD",
    data_class: "manual",
    category: "marketing",
  },
];
const costs = [
  {
    kind: "cost",
    category: "agency",
    amount: 70,
    currency: "EUR",
    data_class: "manual",
    initiative_id: "I",
    period_start: "2026-11-01",
    period_end: "2026-11-30",
  },
  {
    kind: "cost",
    category: "software",
    amount: 30,
    currency: "EUR",
    data_class: "manual",
    initiative_id: null,
    period_start: "2026-11-01",
    period_end: "2026-11-30",
  },
  {
    kind: "cost",
    category: "cogs",
    amount: 25,
    currency: "EUR",
    data_class: "estimated",
    initiative_id: null,
    period_start: "2026-11-01",
    period_end: "2026-11-30",
  },
];
const credits = [
  { campaign_id: "A", credits: 6, state: "charged" as const },
  { campaign_id: "B", credits: 4, state: "pending" as const },
  { campaign_id: null, credits: 5, state: "charged" as const },
  { campaign_id: "A", credits: 0, state: "uncertain" as const },
];
const input = { campaigns, allocations, spend, costs, credits };

describe("canonical rollup", () => {
  it("counts a campaign's money once at its campaign", () => {
    const a = rollup("campaign", "A", input);
    expect(a).toMatchObject({
      allocated: { EUR: 400 },
      spent: { EUR: 140 },
      credits: 6,
      uncertainRuns: 1,
    });
    expect(a.spentByCategory).toEqual({ marketing: { EUR: 90 }, production: { EUR: 50 } });
  });
  it("adds each linked campaign once plus the initiative's own costs, never twice", () => {
    const i = rollup("initiative", "I", input);
    expect(i).toMatchObject({
      campaigns: 2,
      allocated: { EUR: 700 },
      spent: { EUR: 140 },
      reserved: { EUR: 80 },
      simulatedSpent: { EUR: 999 },
      directCosts: { EUR: 70 },
      credits: 6,
      pendingCredits: 4,
    });
  });
  it("strategy totals do not add the initiative's direct costs again and keep currencies apart", () => {
    const s = rollup("strategy", "S", input);
    expect(s).toMatchObject({ campaigns: 3, spent: { EUR: 140, USD: 20 } });
    expect(s.directCosts).toEqual({});
  });
  it("business = every campaign once + every business cost once + AI not linked to a campaign", () => {
    const b = rollup("business", null, input);
    expect(b).toMatchObject({
      campaigns: 3,
      spent: { EUR: 140, USD: 20 },
      directCosts: { EUR: 100 },
      estimatedCosts: { EUR: 25 },
      credits: 11,
    });
    expect(unlinkedCredits(credits, campaigns)).toBe(5);
  });
  it("reports inputs as recorded, missing, estimated or simulated only", () => {
    expect(
      completeness(rollup("campaign", "B", input), { attributedRevenue: false, priced: false }),
    ).toMatchObject({
      budget: "recorded",
      spend: "simulated_only",
      revenue: "missing",
      ai: "missing",
    });
  });
});

describe("credit pricing", () => {
  const v = [
    {
      scope: "platform",
      plan_key: null,
      currency: "EUR",
      price_per_credit: 0.05,
      effective_from: "2026-01-01T00:00:00Z",
    },
    {
      scope: "platform",
      plan_key: null,
      currency: "EUR",
      price_per_credit: 0.08,
      effective_from: "2026-06-01T00:00:00Z",
    },
    {
      scope: "plan",
      plan_key: "professional",
      currency: "EUR",
      price_per_credit: 0.04,
      effective_from: "2026-03-01T00:00:00Z",
    },
  ];
  it("uses the price valid when the credits were used, plan before platform", () => {
    expect(priceAt(v, null, "EUR", "2026-05-01T00:00:00Z")?.price_per_credit).toBe(0.05);
    expect(priceAt(v, null, "EUR", "2026-07-01T00:00:00Z")?.price_per_credit).toBe(0.08);
    expect(priceAt(v, "professional", "EUR", "2026-07-01T00:00:00Z")?.price_per_credit).toBe(0.04);
  });
  it("keeps credits without a price unpriced instead of treating a credit as one euro", () => {
    expect(
      creditCost(
        [
          { credits: 10, at: "2025-12-01T00:00:00Z" },
          { credits: 10, at: "2026-02-01T00:00:00Z" },
          { credits: 10, at: "2026-07-01T00:00:00Z" },
        ],
        v,
        null,
        "EUR",
      ),
    ).toEqual({ currency: "EUR", amount: 1.3, priced: 20, unpriced: 10, versions: 2 });
  });
});

let n = 0;
const sale = (
  amount: number,
  at: string,
  customer_ref = "",
  extra: Partial<RevenueEvent> = {},
): RevenueEvent => ({
  id: `s${++n}`,
  kind: "sale",
  amount,
  currency: "EUR",
  occurred_at: `${at}T10:00:00Z`,
  data_class: "manual",
  source: "manual",
  source_ref: "",
  customer_ref,
  relates_to: null,
  unit_id: null,
  ...extra,
});
const cogs = (amount: number, extra: Record<string, unknown> = {}) => ({
  id: `c${++n}`,
  kind: "cost",
  category: "cogs",
  amount,
  currency: "EUR",
  data_class: "manual",
  period_start: "2026-11-01",
  period_end: "2026-11-30",
  revenue_event_id: null,
  relates_to: null,
  ...extra,
});

describe("gross profit", () => {
  const s1 = sale(500, "2026-11-05", "x"),
    s2 = sale(300, "2026-11-20", "y");
  const refund: RevenueEvent = { ...sale(-100, "2026-11-21"), kind: "refund", relates_to: s1.id };
  const events = [s1, s2, refund];
  it("calculates gross profit and margin per period when the month's cost is recorded", () => {
    const [g] = grossProfit(
      events,
      [cogs(280)],
      [{ model: "per_period", margin_rate: null, effective_from: "2026-01-01" }],
      "2026-11-01",
      "2026-11-30",
    );
    expect(g).toMatchObject({
      revenue: 800,
      refunds: 100,
      net: 700,
      cogs: 280,
      grossProfit: 420,
      grossMargin: 60,
      status: "fully_measurable",
    });
  });
  it("marks profit missing instead of treating missing cost as zero", () => {
    const [g] = grossProfit(
      events,
      [],
      [{ model: "per_period", margin_rate: null, effective_from: "2026-01-01" }],
      "2026-11-01",
      "2026-11-30",
    );
    expect(g).toMatchObject({
      grossProfit: null,
      status: "missing_cost_data",
      monthsWithoutCost: ["2026-11"],
    });
    expect(grossProfit(events, [cogs(1)], [], "2026-11-01", "2026-11-30")[0]).toMatchObject({
      status: "missing_cost_data",
      missing: ["cost_model"],
    });
  });
  it("per-sale model needs a cost on every sale", () => {
    const m = [{ model: "per_sale", margin_rate: null, effective_from: "2026-01-01" }];
    expect(
      grossProfit(
        events,
        [cogs(200, { revenue_event_id: s1.id })],
        m,
        "2026-11-01",
        "2026-11-30",
      )[0],
    ).toMatchObject({ status: "partially_measurable", salesWithoutCost: 1, grossProfit: null });
    expect(
      grossProfit(
        events,
        [cogs(200, { revenue_event_id: s1.id }), cogs(100, { revenue_event_id: s2.id })],
        m,
        "2026-11-01",
        "2026-11-30",
      )[0],
    ).toMatchObject({ status: "fully_measurable", grossProfit: 400 });
  });
  it("labels an estimated margin as an estimate and refuses a period with two cost models", () => {
    expect(
      grossProfit(
        events,
        [],
        [{ model: "margin_estimate", margin_rate: 0.4, effective_from: "2026-01-01" }],
        "2026-11-01",
        "2026-11-30",
      )[0],
    ).toMatchObject({ grossProfit: 280, status: "estimated" });
    expect(
      modelFor(
        [
          { model: "per_sale", margin_rate: null, effective_from: "2026-01-01" },
          { model: "per_period", margin_rate: null, effective_from: "2026-11-15" },
        ],
        "2026-11-01",
        "2026-11-30",
      ).mixed,
    ).toBe(true);
  });
  it("a simulated cost never makes profit measurable", () => {
    expect(
      grossProfit(
        events,
        [cogs(100, { data_class: "simulated" })],
        [{ model: "per_period", margin_rate: null, effective_from: "2026-01-01" }],
        "2026-11-01",
        "2026-11-30",
      )[0]?.grossProfit,
    ).toBeNull();
  });
});

describe("CAC, ROAS and observed customer value", () => {
  const old = sale(100, "2026-09-01", "Returning");
  const events = [
    old,
    sale(50, "2026-11-02", "returning"),
    sale(80, "2026-11-03", "new1"),
    sale(70, "2026-11-04", "new2"),
  ];
  const sp = [
    {
      campaign_id: "A",
      kind: "spend",
      amount: 300,
      currency: "EUR",
      data_class: "manual",
      occurred_on: "2026-11-02",
      category: "marketing",
    },
    {
      campaign_id: "A",
      kind: "spend",
      amount: 900,
      currency: "EUR",
      data_class: "simulated",
      occurred_on: "2026-11-02",
      category: "marketing",
    },
  ];
  it("counts only customers whose first sale is in the period and only actual spending", () => {
    expect(cac(events, sp, [], "2026-11-01", "2026-11-30")[0]).toMatchObject({
      newCustomers: 2,
      spend: 300,
      value: 150,
      simulatedSpend: 900,
      status: "partially_measurable",
    });
  });
  it("gives no CAC when sales lack a customer reference", () => {
    expect(
      cac([...events, sale(10, "2026-11-05")], sp, [], "2026-11-01", "2026-11-30")[0],
    ).toMatchObject({ value: null, status: "missing_customer_data" });
  });
  it("ROAS uses revenue credited to the campaign, never total revenue", () => {
    const s = sale(600, "2026-11-10", "z");
    const touches: Touch[] = [
      {
        id: "t",
        revenue_event_id: s.id,
        campaign_id: "A",
        initiative_id: null,
        channel: "ads",
        touched_at: "2026-11-09T00:00:00Z",
        evidence: "tracked",
        retracted_at: null,
      },
    ];
    expect(
      campaignRoas("A", [...events, s], touches, sp, "last_touch", "2026-11-01", "2026-11-30")[0],
    ).toMatchObject({ revenue: 600, spend: 300, value: 2, status: "fully_measurable" });
    expect(
      campaignRoas("A", events, [], sp, "last_touch", "2026-11-01", "2026-11-30")[0],
    ).toMatchObject({ value: null, status: "missing_attribution" });
  });
  it("observed customer value is historical and flags small samples", () => {
    expect(observedCustomerValue(events)[0]).toMatchObject({
      customers: 3,
      repeatRate: 33.33,
      status: "insufficient_sample",
    });
  });
});

describe("duplicate budget lines", () => {
  const lines = [
    {
      id: "aaaa1111",
      channel: "paid_social",
      period_month: "2026-11-01",
      currency: "EUR",
      planned: 10000,
      created_at: "2026-11-21T09:00:00Z",
    },
    {
      id: "bbbb2222",
      channel: "Paid_Social ",
      period_month: "2026-11-01",
      currency: "EUR",
      planned: 10000,
      created_at: "2026-11-21T09:05:00Z",
      note: "Second approval",
    },
    {
      id: "cccc3333",
      channel: "paid_social",
      period_month: "2026-11-01",
      currency: "USD",
      planned: 10000,
    },
  ];
  it("flags same channel, month, currency and earmarks, keeping both lines", () => {
    const g = duplicateGroups(lines);
    expect(g).toHaveLength(1);
    expect(g[0]!.map((l) => l.id)).toEqual(["aaaa1111", "bbbb2222"]);
    expect(
      wouldDuplicate(lines, {
        channel: "paid social".replace(" ", "_"),
        period_month: "2026-11-01",
        currency: "EUR",
      }),
    ).toHaveLength(2);
  });
  it("labels lines so they can be told apart", () => {
    expect(lineLabel(lines[1]!, "en-GB")).toBe("Second approval · #bbbb");
  });
});
