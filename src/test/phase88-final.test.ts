// Phase 8.8 final: AI credits valued at their historical price per campaign/initiative, counted once up the
// hierarchy; organization figures converted month by month at each month's own official closing rate; refunds in
// the month of their sale; the ECB 90-day history parsed strictly.
import { describe, expect, it } from "vitest";
import { aiCostBreakdown, taskAiAtoms, type AiAtom } from "@/lib/econ/ai-cost";
import { creditAtoms, rollup } from "@/lib/econ/rollup";
import { economicsSummary, levelAiCost } from "@/lib/econ/summary";
import { monthlyFigures, monthlySum, periodMonths, reconcileMonths } from "@/lib/econ/monthly";
import { closingRate, convertByMonth, ratesUsed } from "@/lib/org/period-conversion";
import { fetchEcbHistory, parseEcbHistory } from "@/lib/org/ecb";
import type { EconData } from "@/lib/econ/read";
import type { PriceVersion } from "@/lib/econ/credit-pricing";
import type { Rate } from "@/lib/org/consolidation";
import type { RevenueEvent } from "@/lib/bi/attribution";

// staging test configuration: €0.05 from 21 Nov 2026 12:10, then €0.08 from 1 Dec
const prices: PriceVersion[] = [
  {
    scope: "platform",
    plan_key: null,
    currency: "EUR",
    price_per_credit: 0.05,
    effective_from: "2026-11-21T12:10:00Z",
  },
  {
    scope: "platform",
    plan_key: null,
    currency: "EUR",
    price_per_credit: 0.08,
    effective_from: "2026-12-01T00:00:00Z",
  },
];
const atom = (credits: number, at: string, extra: Partial<AiAtom> = {}): AiAtom => ({
  credits,
  at,
  state: "charged",
  kind: "run",
  specialist: "seo",
  taskId: "t1",
  runId: `r${at}`,
  ...extra,
});

describe("AI cost at the historical credit price", () => {
  const b = aiCostBreakdown(
    [
      atom(10, "2026-11-20T09:00:00Z"), // before any price: stays credits
      atom(20, "2026-11-22T09:00:00Z"), // €0.05 → €1.00
      atom(10, "2026-12-02T09:00:00Z", { kind: "retry" }), // €0.08 → €0.80
      atom(4, "2026-12-03T09:00:00Z", { kind: "review", specialist: "business_analyst" }), // €0.32
      atom(7, "2026-12-03T09:00:00Z", { state: "pending" }),
      atom(5, "2026-12-03T09:00:00Z", { state: "uncertain" }),
    ],
    prices,
    null,
    "EUR",
  );
  it("values each credit at the price in effect when it was used and keeps earlier usage unpriced", () => {
    expect(b).toMatchObject({
      credits: 44,
      priced: 34,
      unpriced: 10,
      amount: 2.12,
      complete: false,
      priceVersions: 2,
    });
  });
  it("keeps pending charges and unknown outcomes out of cost", () => {
    expect(b.pendingCredits).toBe(7);
    expect(b.uncertainRuns).toBe(1);
  });
  it("splits retries and second reviews and groups by specialist", () => {
    expect(b.retries).toMatchObject({ credits: 10, amount: 0.8 });
    expect(b.reviews).toMatchObject({ credits: 4, amount: 0.32 });
    expect(b.bySpecialist.find((l) => l.key === "seo")).toMatchObject({
      credits: 40,
      amount: 1.8,
      unpriced: 10,
    });
    expect(b.bySpecialist.reduce((t, l) => t + l.credits, 0)).toBe(b.credits);
  });
  it("a later price change never changes the value of earlier usage", () => {
    const before = aiCostBreakdown(
      [atom(20, "2026-11-22T09:00:00Z")],
      prices.slice(0, 1),
      null,
      "EUR",
    );
    const after = aiCostBreakdown([atom(20, "2026-11-22T09:00:00Z")], prices, null, "EUR");
    expect(after.amount).toBe(before.amount);
    expect(after.amount).toBe(1);
  });
  it("a future price is not applied before its effective date", () => {
    const future: PriceVersion[] = [
      {
        scope: "platform",
        plan_key: null,
        currency: "EUR",
        price_per_credit: 0.05,
        effective_from: "2027-01-01T00:00:00Z",
      },
    ];
    expect(aiCostBreakdown([atom(20, "2026-11-22T09:00:00Z")], future, null, "EUR")).toMatchObject({
      priced: 0,
      unpriced: 20,
      amount: 0,
    });
  });
  it("builds atoms from task runs and reviews: retries by attempt, reviews at their own time", () => {
    const atoms = taskAiAtoms(
      new Set(["t1"]),
      [
        {
          id: "r1",
          task_id: "t1",
          specialist_key: "seo",
          status: "succeeded",
          credits_charged: 6,
          estimated_credits: 5,
          created_at: "2026-11-22T09:00:00Z",
          finished_at: "2026-11-22T09:01:00Z",
          attempt: 1,
        },
        {
          id: "r2",
          task_id: "t1",
          specialist_key: "seo",
          status: "succeeded",
          credits_charged: 6,
          estimated_credits: 5,
          created_at: "2026-11-23T09:00:00Z",
          finished_at: null,
          attempt: 2,
        },
        {
          id: "r3",
          task_id: "t1",
          specialist_key: "seo",
          status: "queued",
          credits_charged: null,
          estimated_credits: 4,
          created_at: "2026-11-23T09:00:00Z",
        },
        {
          id: "r9",
          task_id: "other",
          specialist_key: "seo",
          status: "succeeded",
          credits_charged: 50,
          estimated_credits: 5,
          created_at: "2026-11-23T09:00:00Z",
        },
      ],
      [
        {
          task_run_id: "r1",
          reviewer_specialist: "business_analyst",
          credits: 3,
          created_at: "2026-11-24T09:00:00Z",
        },
      ],
    );
    expect(atoms.map((a) => [a.runId, a.kind, a.state, a.credits])).toEqual([
      ["r1", "run", "charged", 6],
      ["r2", "retry", "charged", 6],
      ["r3", "run", "pending", 4],
      ["r1", "review", "charged", 3],
    ]);
    expect(atoms[0]!.at).toBe("2026-11-22T09:01:00Z");
  });
});

const econ = (): EconData =>
  ({
    campaigns: [
      {
        id: "A",
        title: "A",
        status: "active",
        goal_id: "G",
        initiative_id: "I",
        strategy_id: "S",
        channels: ["seo"],
      },
      {
        id: "B",
        title: "B",
        status: "active",
        goal_id: "G",
        initiative_id: "I",
        strategy_id: "S",
        channels: ["seo"],
      },
      {
        id: "C",
        title: "C",
        status: "active",
        goal_id: null,
        initiative_id: null,
        strategy_id: null,
        channels: [],
      },
    ],
    budgetLines: [],
    allocations: [],
    spend: [],
    costs: [],
    models: [],
    revenue: [],
    touches: [],
    credits: [
      { campaign_id: "A", credits: 10, state: "charged", at: "2026-11-22T10:00:00Z" },
      { campaign_id: "B", credits: 20, state: "charged", at: "2026-12-02T10:00:00Z" },
      { campaign_id: "B", credits: 5, state: "pending", at: "2026-12-02T10:00:00Z" },
      { campaign_id: "C", credits: 8, state: "charged", at: "2026-11-22T10:00:00Z" },
      { campaign_id: null, credits: 3, state: "charged", at: "2026-11-22T10:00:00Z" },
    ],
    usage: [],
    prices,
    planKey: null,
    initiatives: [{ id: "I", title: "Init" }],
    strategies: [],
    goals: [],
    learnings: [],
    proposals: [],
    requests: [],
    incomplete: [],
    costsInstalled: true,
  }) as unknown as EconData;

describe("AI cost rolls up once: task → campaign → initiative → strategy/goal → business", () => {
  const d = econ();
  it("an initiative takes each linked campaign's credits once, at their own price", () => {
    expect(levelAiCost(d, "campaign", "A")).toMatchObject({ priced: 10, amount: 0.5 });
    expect(levelAiCost(d, "campaign", "B")).toMatchObject({ priced: 20, amount: 1.6 });
    expect(levelAiCost(d, "initiative", "I")).toMatchObject({ priced: 30, amount: 2.1 });
    expect(levelAiCost(d, "strategy", "S").amount).toBe(2.1);
    expect(levelAiCost(d, "goal", "G").amount).toBe(2.1);
  });
  it("the atoms counted match the rollup's credit totals at every level", () => {
    const input = {
      campaigns: d.campaigns,
      allocations: [],
      spend: [],
      costs: [],
      credits: d.credits,
    };
    for (const [level, id] of [
      ["campaign", "A"],
      ["initiative", "I"],
      ["strategy", "S"],
      ["goal", "G"],
      ["business", null],
    ] as const) {
      const charged = creditAtoms(level, id, d.campaigns, d.credits)
        .filter((c) => c.state === "charged")
        .reduce((t, c) => t + c.credits, 0);
      expect(rollup(level, id, input).credits).toBe(charged);
    }
    expect(rollup("business", null, input).credits).toBe(41);
  });
  it("campaign rows in the summary carry the same AI value", () => {
    const s = economicsSummary(d, "2026-11-01", "2026-12-31", "last_touch", "2026-12-05");
    expect(s.campaigns.find((c) => c.id === "B")?.aiCost.amount).toBe(1.6);
  });
});

const rate = (
  id: string,
  quote: string,
  value: number,
  date: string,
  kind = "official",
  base = "EUR",
): Rate => ({
  id,
  base_currency: base,
  quote_currency: quote,
  rate: value,
  rate_date: date,
  source: kind === "official" ? "ECB euro foreign exchange reference rate" : "Bank statement",
  kind,
});
const rates: Rate[] = [
  rate("o30", "USD", 1.16, "2026-10-30"),
  rate("o30g", "GBP", 0.87, "2026-10-30"), // Fri 30 Oct (31 Oct is a Saturday)
  rate("n20", "USD", 1.1, "2026-11-20"),
  rate("n20g", "GBP", 0.84, "2026-11-20"),
  rate("d24", "USD", 1.05, "2026-12-24"), // 25–26 Dec are TARGET holidays
  rate("m20", "USD", 1.2, "2026-11-20", "manual"),
];

describe("closing rates for historical months", () => {
  it("weekend month end uses the last publication day", () => {
    expect(closingRate(rates, "USD", "EUR", "2026-10-31")).toMatchObject({
      ok: true,
      rateDate: "2026-10-30",
      method: "inverse",
    });
  });
  it("holidays fall back to the last publication day", () => {
    expect(closingRate(rates, "EUR", "USD", "2026-12-27")).toMatchObject({
      ok: true,
      rateDate: "2026-12-24",
      rate: 1.05,
      method: "direct",
    });
  });
  it("an official rate wins over a manual rate of the same day", () => {
    expect(closingRate(rates, "EUR", "USD", "2026-11-21")).toMatchObject({ rate: 1.1 });
  });
  it("a rate more than 7 days old is not used, and a missing pair is named", () => {
    expect(closingRate(rates, "USD", "EUR", "2026-12-10")).toMatchObject({
      ok: false,
      reason: "too_old",
      latest: "2026-11-20",
    });
    expect(closingRate(rates, "CHF", "EUR", "2026-11-21")).toMatchObject({
      ok: false,
      reason: "no_rate",
    });
  });
  it("two official euro rates of the same day give the labelled ECB cross rate", () => {
    const c = closingRate(rates, "USD", "GBP", "2026-11-21");
    expect(c).toMatchObject({ ok: true, method: "ecb_cross", rateDate: "2026-11-20" });
    expect(c.ok && Math.round(c.rate * 1e6) / 1e6).toBe(Math.round((0.84 / 1.1) * 1e6) / 1e6);
  });
  it("reverse conversion returns the original amount within a cent", () => {
    const there = closingRate(rates, "EUR", "USD", "2026-11-21"),
      back = closingRate(rates, "USD", "EUR", "2026-11-21");
    expect(
      there.ok &&
        back.ok &&
        Math.abs(
          Math.round((Math.round(1234.56 * there.rate * 100) / 100) * back.rate * 100) / 100 -
            1234.56,
        ),
    ).toBeLessThanOrEqual(0.01);
  });
});

describe("month-by-month conversion", () => {
  it("each month converts at its own closing rate, never today's rate for every month", () => {
    const c = convertByMonth(
      [
        { month: "2026-10", money: { USD: 116 } },
        { month: "2026-11", money: { USD: 110 } },
      ],
      "EUR",
      rates,
      "2026-11-21",
    );
    expect(c.lines.map((l) => [l.month, l.converted])).toEqual([
      ["2026-10", 100],
      ["2026-11", 100],
    ]);
    expect(c.total).toBe(200);
    expect(ratesUsed(c).map((u) => u.rateDate)).toEqual(["2026-10-30", "2026-11-20"]);
  });
  it("a month without a usable rate keeps its original amount and withholds the total", () => {
    const c = convertByMonth(
      [
        { month: "2026-09", money: { USD: 50 } },
        { month: "2026-11", money: { USD: 110, EUR: 10 } },
      ],
      "EUR",
      rates,
      "2026-11-21",
    );
    expect(c.total).toBeNull();
    expect(c.original).toEqual({ USD: 160, EUR: 10 });
    expect(c.missing).toEqual([
      expect.objectContaining({ from: "USD", refDate: "2026-09-30", reason: "no_rate" }),
    ]);
  });
  it("lines are rounded to cents and add up exactly to the total", () => {
    const c = convertByMonth(
      [{ month: "2026-11", money: { USD: 33.33, GBP: 10.01 } }],
      "EUR",
      rates,
      "2026-11-21",
    );
    expect(c.total).toBe(
      c.lines.reduce((t, l) => Math.round((t + (l.converted ?? 0)) * 100) / 100, 0),
    );
  });
});

let k = 0;
const sale = (amount: number, at: string, currency = "EUR"): RevenueEvent =>
  ({
    id: `s${++k}`,
    kind: "sale",
    amount,
    currency,
    occurred_at: `${at}T10:00:00Z`,
    data_class: "manual",
    source: "manual",
    source_ref: "",
    customer_ref: "c1",
    relates_to: null,
    unit_id: null,
  }) as RevenueEvent;

describe("monthly figures reconcile with the period and keep refunds in the sale month", () => {
  const d = econ();
  const oct = sale(300, "2026-10-12");
  const nov = sale(200, "2026-11-05");
  d.revenue = [
    oct,
    nov,
    { ...sale(-100, "2026-11-20"), kind: "refund", relates_to: oct.id } as RevenueEvent,
  ];
  d.spend = [
    {
      id: "p1",
      campaign_id: "A",
      kind: "spend",
      amount: 40,
      currency: "EUR",
      data_class: "manual",
      occurred_on: "2026-10-30",
      category: "marketing",
    },
    {
      id: "p2",
      campaign_id: "A",
      kind: "spend",
      amount: 60,
      currency: "EUR",
      data_class: "manual",
      occurred_on: "2026-11-02",
      category: "marketing",
    },
    {
      id: "p3",
      campaign_id: "A",
      kind: "spend",
      amount: 999,
      currency: "EUR",
      data_class: "simulated",
      occurred_on: "2026-11-02",
      category: "marketing",
    },
  ] as never;
  d.costs = [
    {
      id: "k1",
      kind: "cost",
      category: "software",
      amount: 30,
      currency: "EUR",
      data_class: "manual",
      period_start: "2026-10-15",
      period_end: "2026-11-14",
      revenue_event_id: null,
      relates_to: null,
      initiative_id: null,
    },
  ] as never;
  const months = monthlyFigures(d, "2026-10-01", "2026-11-30");
  it("a refund issued in November lowers October, the month of its sale", () => {
    expect(months.map((m) => [m.month, m.net["EUR"]])).toEqual([
      ["2026-10", 200],
      ["2026-11", 200],
    ]);
  });
  it("simulated spending is left out and a cost spanning two months lands in the month its period ends", () => {
    expect(months.map((m) => m.spent["EUR"] ?? 0)).toEqual([40, 60]);
    expect(months.map((m) => m.costs["EUR"] ?? 0)).toEqual([0, 30]);
  });
  it("the months add up to the period summary", () => {
    const s = economicsSummary(d, "2026-10-01", "2026-11-30", "last_touch", "2026-12-05");
    expect(reconcileMonths(months, s)).toMatchObject({ net: true, spent: true, costs: true });
    expect(monthlySum(months, "net")).toEqual({ EUR: 400 });
  });
  it("periods split into calendar months clipped to the period", () => {
    expect(periodMonths("2026-10-15", "2026-12-03")).toEqual([
      { month: "2026-10", from: "2026-10-15", to: "2026-10-31" },
      { month: "2026-11", from: "2026-11-01", to: "2026-11-30" },
      { month: "2026-12", from: "2026-12-01", to: "2026-12-03" },
    ]);
  });
});

const hist = (days: [string, string][]) =>
  `<?xml version="1.0"?><gesmes:Envelope><Cube>${days.map(([d, usd]) => `<Cube time="${d}"><Cube currency="USD" rate="${usd}"/><Cube currency="GBP" rate="0.84"/></Cube>`).join("")}</Cube></gesmes:Envelope>`;
describe("ECB 90-day history", () => {
  it("parses every publication day, oldest first", () => {
    const d = parseEcbHistory(
      hist([
        ["2026-11-20", "1.099"],
        ["2026-11-19", "1.1"],
      ]),
    );
    expect(d.map((x) => x.date)).toEqual(["2026-11-19", "2026-11-20"]);
    expect(d[1]!.rates).toEqual([
      { currency: "USD", rate: "1.099" },
      { currency: "GBP", rate: "0.84" },
    ]);
  });
  it("rejects repeated days, entity declarations and invalid rates", () => {
    expect(() =>
      parseEcbHistory(
        hist([
          ["2026-11-20", "1.1"],
          ["2026-11-20", "1.1"],
        ]),
      ),
    ).toThrow();
    expect(() => parseEcbHistory(`<!DOCTYPE x>${hist([["2026-11-20", "1.1"]])}`)).toThrow();
    expect(() => parseEcbHistory(hist([["2026-11-20", "-1"]]))).toThrow();
  });
  it("refuses a history containing a future publication date", async () => {
    const res = (body: string) =>
      (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;
    expect(await fetchEcbHistory(res(hist([["2026-11-25", "1.1"]])), "2026-11-21")).toEqual({
      ok: false,
      reason: "future_date",
    });
    expect(await fetchEcbHistory(res(hist([["2026-11-20", "1.1"]])), "2026-11-21")).toMatchObject({
      ok: true,
    });
  });
});
