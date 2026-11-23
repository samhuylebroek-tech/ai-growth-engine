import { describe, expect, it } from "vitest";
import {
  businessRow,
  byAttention,
  convertMoney,
  findRate,
  orgTotals,
  revenueByUnit,
  specialistLoad,
  type BusinessInput,
  type Rate,
} from "@/lib/org/consolidation";
import {
  coordinate,
  nextOrgActions,
  sameAudience,
  type CoordBusiness,
} from "@/lib/org/coordination";

const rates: Rate[] = [
  {
    id: "r1",
    base_currency: "USD",
    quote_currency: "EUR",
    rate: 0.9,
    rate_date: "2026-03-01",
    source: "ECB",
  },
  {
    id: "r2",
    base_currency: "USD",
    quote_currency: "EUR",
    rate: 0.8,
    rate_date: "2026-05-01",
    source: "ECB",
  },
  {
    id: "r3",
    base_currency: "EUR",
    quote_currency: "GBP",
    rate: 0.5,
    rate_date: "2026-04-20",
    source: "Bank",
  },
];
const sale = (
  id: string,
  amount: number,
  currency: string,
  extra: Partial<BusinessInput["revenue"][number]> = {},
) => ({
  id,
  kind: "sale",
  amount,
  currency,
  occurred_at: "2026-04-10T10:00:00Z",
  data_class: "manual",
  source: "manual",
  source_ref: "",
  customer_ref: "",
  relates_to: null,
  unit_id: null,
  ...extra,
});
const base = (over: Partial<BusinessInput>): BusinessInput => ({
  id: "w1",
  name: "Bakery",
  reportingCurrency: "EUR",
  revenue: [],
  goals: [],
  tasks: [],
  budget: [],
  runs: [],
  pendingApprovals: 0,
  truncated: false,
  ...over,
});

describe("exchange rates are explicit and dated", () => {
  it("uses the latest rate on or before the reporting date, never a later one", () => {
    expect(findRate(rates, "USD", "EUR", "2026-04-30")?.rate).toBe(0.9);
    expect(findRate(rates, "USD", "EUR", "2026-05-02")?.rate).toBe(0.8);
    expect(findRate(rates, "USD", "EUR", "2026-02-01")).toBeNull();
  });
  it("uses an inverse rate but never routes through a third currency", () => {
    expect(findRate(rates, "GBP", "EUR", "2026-04-30")?.rate).toBe(2);
    expect(findRate(rates, "GBP", "USD", "2026-04-30")).toBeNull();
  });
  it("withholds the converted total when any currency has no rate", () => {
    const c = convertMoney({ EUR: 100, USD: 200, CHF: 10 }, "EUR", rates, "2026-04-30");
    expect(c.total).toBeNull();
    expect(c.missing).toEqual(["CHF→EUR"]);
  });
  it("converts with the stated rate and flags rates older than 31 days", () => {
    const c = convertMoney({ EUR: 100, USD: 200 }, "EUR", rates, "2026-04-30");
    expect(c.total).toBe(280);
    expect(c.stale).toEqual(["USD→EUR"]);
  });
});

describe("business rows", () => {
  it("excludes estimated revenue and subtracts refunds from their sale", () => {
    const r = businessRow(
      base({
        revenue: [
          sale("s1", 100, "EUR"),
          sale("s2", 50, "EUR", { data_class: "estimated" }),
          { ...sale("f1", -30, "EUR"), kind: "refund", relates_to: "s1" },
        ],
      }),
      "2026-04-01",
      "2026-04-15",
    );
    expect(r.revenue).toEqual({ EUR: 70 });
    expect(r.estimated).toEqual({ EUR: 50 });
  });
  it("counts budget per currency for the month and flags lines over their hard cap", () => {
    const r = businessRow(
      base({
        budget: [
          {
            channel: "search",
            period_month: "2026-04-01",
            planned: 200,
            actual: 250,
            hard_cap: 220,
            currency: "EUR",
          },
          {
            channel: "social",
            period_month: "2026-04-01",
            planned: 100,
            actual: 50,
            hard_cap: null,
            currency: "USD",
          },
          {
            channel: "search",
            period_month: "2026-03-01",
            planned: 999,
            actual: 999,
            hard_cap: null,
            currency: "EUR",
          },
        ],
      }),
      "2026-04-01",
      "2026-04-15",
    );
    expect(r.planned).toEqual({ EUR: 200, USD: 100 });
    expect(r.utilization).toEqual({ EUR: 125, USD: 50 });
    expect(r.overCap).toBe(1);
    expect(r.reasons).toContain("over_cap");
  });
  it("never adds currencies together at organization level", () => {
    const a = businessRow(
      base({ id: "a", revenue: [sale("s1", 100, "EUR")] }),
      "2026-04-01",
      "2026-04-15",
    );
    const b = businessRow(
      base({ id: "b", revenue: [sale("s2", 40, "USD"), sale("s3", 10, "EUR")] }),
      "2026-04-01",
      "2026-04-15",
    );
    expect(orgTotals([a, b]).revenue).toEqual({ EUR: 110, USD: 40 });
  });
  it("orders businesses by attention: overdue work and failed runs outrank a quiet business", () => {
    const quiet = businessRow(base({ id: "q", name: "Alpha" }), "2026-04-01", "2026-04-15");
    const busy = businessRow(
      base({
        id: "b",
        name: "Zulu",
        tasks: [{ id: "t", title: "x", status: "todo", due_date: "2026-04-01" }],
        runs: [
          {
            status: "failed",
            specialist_key: "seo",
            estimated_credits: 5,
            credits_charged: 0,
            created_at: "2026-04-02",
          },
        ],
      }),
      "2026-04-01",
      "2026-04-15",
    );
    expect(busy.attention).toBe(5);
    expect(byAttention([quiet, busy]).map((r) => r.id)).toEqual(["b", "q"]);
  });
  it("splits revenue per brand, keeping unlinked sales separate", () => {
    const u = revenueByUnit([
      sale("s1", 100, "EUR", { unit_id: "brand-1" }),
      sale("s2", 20, "EUR"),
    ]);
    expect(u).toEqual([
      { unitId: "brand-1", revenue: { EUR: 100 }, sales: 1 },
      { unitId: null, revenue: { EUR: 20 }, sales: 1 },
    ]);
  });
});

describe("shared specialist capacity", () => {
  it("counts charged credits, open reservations at estimate, and nothing for failed runs", () => {
    const l = specialistLoad(
      [
        {
          id: "a",
          runs: [
            {
              status: "succeeded",
              specialist_key: "seo",
              estimated_credits: 6,
              credits_charged: 4,
              created_at: "2026-04-03",
            },
            {
              status: "queued",
              specialist_key: "seo",
              estimated_credits: 5,
              credits_charged: null,
              created_at: "2026-04-04",
            },
          ],
        },
        {
          id: "b",
          runs: [
            {
              status: "failed",
              specialist_key: "seo",
              estimated_credits: 9,
              credits_charged: null,
              created_at: "2026-04-04",
            },
          ],
        },
      ],
      [{ workspace_id: "a", specialist_key: "seo", enabled: true, monthly_credit_cap: 10 }],
      "2026-04-01",
    );
    expect(l[0]?.used).toBe(9);
    expect(l[0]?.businesses.find((b) => b.id === "a")).toMatchObject({ used: 9, open: 1, cap: 10 });
  });
});

describe("cross-business coordination", () => {
  const camp = (id: string, audience: string, channels: string[], start: string, end: string) => ({
    id,
    title: id,
    status: "active",
    audience,
    channels,
    start_date: start,
    end_date: end,
  });
  const biz = (id: string, over: Partial<CoordBusiness>): CoordBusiness => ({
    id,
    name: id,
    audiences: [],
    campaigns: [],
    openWork: [],
    budgetChannels: [],
    goals: [],
    ...over,
  });
  it("matches audiences by meaning words, not by one common word", () => {
    expect(sameAudience("Young families in Ghent", "young families ghent")).toBe(true);
    expect(sameAudience("Young families", "Young professionals")).toBe(false);
  });
  it("flags a conflict only for the same audience, a shared channel and overlapping dates", () => {
    const a = biz("A", {
      campaigns: [camp("a1", "Office managers", ["LinkedIn"], "2026-04-01", "2026-04-30")],
    });
    const b = biz("B", {
      campaigns: [
        camp("b1", "office managers", ["linkedin", "email"], "2026-04-20", "2026-05-20"),
        camp("b2", "office managers", ["email"], "2026-04-01", "2026-04-30"),
      ],
    });
    const c = biz("C", {
      campaigns: [camp("c1", "Office managers", ["LinkedIn"], "2026-06-01", "2026-06-30")],
    });
    expect(
      coordinate([a, b, c], [], [])
        .filter((f) => f.code === "campaign_conflict")
        .map((f) => f.key),
    ).toEqual(["cc:a1|b1"]);
  });
  it("flags a budget overlap only when the businesses share an audience", () => {
    const line = { channel: "Google Ads", month: "2026-04-01", planned: 100, currency: "EUR" };
    const withAud = coordinate(
      [
        biz("A", { audiences: ["Office managers"], budgetChannels: [line] }),
        biz("B", { audiences: ["office managers"], budgetChannels: [line] }),
      ],
      [],
      [],
    );
    const without = coordinate(
      [
        biz("A", { audiences: ["Office managers"], budgetChannels: [line] }),
        biz("B", { audiences: ["Students"], budgetChannels: [line] }),
      ],
      [],
      [],
    );
    expect(withAud.some((f) => f.code === "budget_overlap")).toBe(true);
    expect(without.some((f) => f.code === "budget_overlap")).toBe(false);
  });
  it("suggests reusing an achieved goal's approach for the same objective elsewhere", () => {
    const f = coordinate(
      [
        biz("A", {
          goals: [
            {
              id: "g1",
              title: "More leads",
              objective: "leads",
              status: "achieved",
              achieved: true,
            },
          ],
        }),
        biz("B", {
          goals: [
            { id: "g2", title: "Leads Q3", objective: "leads", status: "active", achieved: false },
          ],
        }),
      ],
      [],
      [],
    );
    expect(f.map((x) => x.code)).toEqual(["strategy_reuse"]);
  });
  it("puts businesses that need attention before coordination findings", () => {
    const row = businessRow(
      base({ id: "A", tasks: [{ id: "t", title: "x", status: "todo", due_date: "2026-01-01" }] }),
      "2026-04-01",
      "2026-04-15",
    );
    const acts = nextOrgActions(
      [row],
      [
        { code: "shared_audience", key: "sa", businesses: ["A", "B"], subject: "x", evidence: [] },
        {
          code: "campaign_conflict",
          key: "cc",
          businesses: ["A", "B"],
          subject: "y",
          evidence: [],
        },
      ],
    );
    expect(acts.map((a) => a.code)).toEqual([
      "attend_business",
      "campaign_conflict",
      "shared_audience",
    ]);
  });
});

import { parseEcbDaily } from "@/lib/org/ecb";
describe("official ECB rates", () => {
  const xml = `<?xml version="1.0"?><gesmes:Envelope><Cube><Cube time='2026-11-20'><Cube currency='USD' rate='1.0990'/><Cube currency='GBP' rate='0.83735'/></Cube></Cube></gesmes:Envelope>`;
  it("reads the publication date and every currency rate", () => {
    expect(parseEcbDaily(xml)).toEqual({
      date: "2026-11-20",
      rates: [
        { currency: "USD", rate: "1.0990" },
        { currency: "GBP", rate: "0.83735" },
      ],
    });
  });
  it("rejects entity declarations, bad rates and missing dates", () => {
    expect(() => parseEcbDaily(`<!DOCTYPE x [<!ENTITY a "b">]>${xml}`)).toThrow();
    expect(() => parseEcbDaily(xml.replace("1.0990", "-1"))).toThrow();
    expect(() => parseEcbDaily(xml.replace("time='2026-11-20'", "x='1'"))).toThrow();
  });
  it("converts USD to EUR with the inverse of the ECB EUR→USD rate", () => {
    const official = [
      {
        id: "o",
        base_currency: "EUR",
        quote_currency: "USD",
        rate: "1.25",
        rate_date: "2026-11-20",
        source: "ECB",
        kind: "official",
      },
    ];
    expect(convertMoney({ USD: 100 }, "EUR", official, "2026-11-20").total).toBe(80);
  });
  it("prefers the official rate over a manual one on the same date", () => {
    const both = [
      {
        id: "m",
        base_currency: "EUR",
        quote_currency: "USD",
        rate: "2",
        rate_date: "2026-11-20",
        source: "Bank",
        kind: "manual",
      },
      {
        id: "o",
        base_currency: "EUR",
        quote_currency: "USD",
        rate: "1.25",
        rate_date: "2026-11-20",
        source: "ECB",
        kind: "official",
      },
    ];
    expect(findRate(both, "EUR", "USD", "2026-11-20")?.rateId).toBe("o");
  });
});
