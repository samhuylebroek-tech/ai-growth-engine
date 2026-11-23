import { describe, expect, it } from "vitest";
import { orgEconomics, type BusinessEcon } from "@/lib/org/economics";
import type { EconSummary } from "@/lib/econ/summary";

type Cur = EconSummary["currencies"][number];
const cur = (
  currency: string,
  x: {
    net?: number;
    sales?: number;
    spent?: number;
    simulated?: number;
    costs?: number;
    gp?: number | null;
  },
): Cur =>
  ({
    currency,
    rev: x.sales ? { net: x.net ?? 0, sales: x.sales } : null,
    spent: x.spent ?? 0,
    simulated: x.simulated ?? 0,
    costs: x.costs ?? 0,
    gp:
      x.gp === undefined
        ? null
        : {
            grossProfit: x.gp,
            grossMargin: null,
            missing: x.gp === null ? ["cost_per_month"] : [],
          },
  }) as unknown as Cur;
const biz = (
  id: string,
  currencies: Cur[],
  credits = 0,
  unpriced = 0,
  amount = 0,
): BusinessEcon => ({
  id,
  name: id,
  summary: {
    currencies,
    ai: { total: credits, cost: { amount, unpriced, priced: credits - unpriced, currency: "EUR" } },
    alerts: [],
    incomplete: [],
  } as unknown as EconSummary,
});

describe("organization economics", () => {
  it("adds amounts per currency only, never across currencies, and keeps simulated spending apart", () => {
    const o = orgEconomics([
      biz("A", [
        cur("EUR", { net: 1000, sales: 2, spent: 200, simulated: 50, costs: 100, gp: 600 }),
        cur("USD", { net: 300, sales: 1, gp: 100 }),
      ]),
      biz("B", [cur("EUR", { net: 500, sales: 1, spent: 100, costs: 0, gp: 400 })]),
    ]);
    expect(o.currencies).toEqual([
      {
        currency: "EUR",
        businesses: 2,
        net: 1500,
        spent: 300,
        simulated: 50,
        costs: 100,
        grossProfit: 1000,
        grossProfitMissing: 0,
        margin: 66.67,
      },
      {
        currency: "USD",
        businesses: 1,
        net: 300,
        spent: 0,
        simulated: 0,
        costs: 0,
        grossProfit: 100,
        grossProfitMissing: 0,
        margin: 33.33,
      },
    ]);
  });
  it("withholds total gross profit when any business with sales cannot calculate it", () => {
    const o = orgEconomics([
      biz("A", [cur("EUR", { net: 1000, sales: 2, gp: 600 })]),
      biz("B", [cur("EUR", { net: 500, sales: 1, gp: null })]),
    ]);
    expect(o.currencies[0]).toMatchObject({
      grossProfit: null,
      grossProfitMissing: 1,
      margin: null,
      net: 1500,
    });
  });
  it("adds AI credits but gives a money total only when every credit was priced", () => {
    expect(orgEconomics([biz("A", [], 10, 0, 0.5), biz("B", [], 5, 0, 0.25)])).toMatchObject({
      credits: 15,
      aiCost: 0.75,
      unpriced: 0,
    });
    expect(orgEconomics([biz("A", [], 10, 0, 0.5), biz("B", [], 5, 5, 0)])).toMatchObject({
      credits: 15,
      aiCost: null,
      unpriced: 5,
    });
  });
});
