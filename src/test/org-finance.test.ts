import { describe, expect, it } from "vitest";
import {
  convertMoney,
  findRate,
  businessRow,
  orgTotals,
  revenueByUnit,
  type Rate,
} from "@/lib/org/consolidation";
import { fetchEcbDaily } from "@/lib/org/ecb";

const rate = (id: string, quote: string, value: number, date: string, kind = "official"): Rate => ({
  id,
  base_currency: "EUR",
  quote_currency: quote,
  rate: value,
  rate_date: date,
  source: "ECB",
  kind,
});
// 2026-12-24 (Thu) is the last publication before Christmas; 25–26 Dec are TARGET holidays, 26–27 Dec a weekend.
const rates = [
  rate("thu", "USD", 1.1, "2026-12-24"),
  rate("fri20", "USD", 1.05, "2026-11-20"),
  rate("gbp", "GBP", 0.85, "2026-11-20"),
];

describe("official rate dates", () => {
  it("on a weekend uses Friday's publication", () => {
    expect(findRate(rates, "USD", "EUR", "2026-11-22")?.rateId).toBe("fri20");
  });
  it("over Christmas holidays and the weekend uses the last working-day publication", () => {
    const c = findRate(rates, "USD", "EUR", "2026-12-27");
    expect(c?.rateId).toBe("thu");
    expect(c?.rateDate).toBe("2026-12-24");
  });
  it("never uses a publication dated after the reporting date", () => {
    expect(findRate(rates, "USD", "EUR", "2026-12-23")?.rateId).toBe("fri20");
  });
  it("withholds a combined total when one currency has no rate and names the missing pair", () => {
    const c = convertMoney({ EUR: 100, CHF: 50 }, "EUR", rates, "2026-11-22");
    expect(c.total).toBeNull();
    expect(c.missing).toEqual(["CHF→EUR"]);
  });
  it("records which dated rate each converted currency used, for tracing", () => {
    const c = convertMoney({ GBP: 85 }, "EUR", rates, "2026-11-22");
    expect(c.total).toBe(100);
    expect(c.used.map((u) => [u.rateId, u.rateDate])).toEqual([["gbp", "2026-11-20"]]);
  });
});

describe("money and credits stay apart", () => {
  const row = businessRow(
    {
      id: "b",
      name: "Bakery",
      reportingCurrency: "GBP",
      truncated: false,
      revenue: [
        {
          id: "s1",
          kind: "sale",
          amount: 100,
          currency: "GBP",
          occurred_at: "2026-11-02T10:00:00Z",
          data_class: "manual",
          relates_to: null,
          unit_id: null,
        } as never,
      ],
      goals: [],
      tasks: [],
      budget: [
        {
          channel: "Google Ads",
          period_month: "2026-11-01",
          planned: 200,
          actual: 50,
          hard_cap: null,
          currency: "GBP",
        },
      ],
      runs: [
        {
          status: "succeeded",
          specialist_key: "seo",
          estimated_credits: 5,
          credits_charged: 5,
          created_at: "2026-11-03T00:00:00Z",
        },
      ],
      pendingApprovals: 0,
    },
    "2026-11-01",
    "2026-11-20",
  );
  it("keeps each business's own currency for revenue and advertising budget", () => {
    expect(row.revenue).toEqual({ GBP: 100 });
    expect(row.spent).toEqual({ GBP: 50 });
  });
  it("counts AI credits only as credits, never inside revenue or advertising spend", () => {
    expect(row.creditsUsed).toBe(5);
    const t = orgTotals([row]);
    expect(Object.values(t.revenue)).toEqual([100]);
    expect(Object.values(t.spent)).toEqual([50]);
  });
  it("keeps revenue not linked to a brand or unit as its own unattributed line", () => {
    expect(
      revenueByUnit([
        {
          id: "s1",
          kind: "sale",
          amount: 100,
          currency: "GBP",
          occurred_at: "2026-11-02T10:00:00Z",
          data_class: "manual",
          relates_to: null,
          unit_id: null,
        } as never,
      ])[0]?.unitId,
    ).toBeNull();
  });
});

describe("ECB service interruptions", () => {
  const xml = (date: string) =>
    `<gesmes:Envelope><Cube><Cube time='${date}'><Cube currency='USD' rate='1.0950'/></Cube></Cube></gesmes:Envelope>`;
  const res = (body: string, status = 200) =>
    (async () => new Response(body, { status })) as unknown as typeof fetch;
  it("reports an outage without changing anything", async () => {
    expect(await fetchEcbDaily(res("", 503), "2026-11-20")).toEqual({
      ok: false,
      reason: "unreachable",
    });
    expect(
      await fetchEcbDaily(
        (async () => {
          throw new Error("timeout");
        }) as unknown as typeof fetch,
        "2026-11-20",
      ),
    ).toEqual({ ok: false, reason: "unreachable" });
  });
  it("rejects malformed responses and publications dated in the future", async () => {
    expect(await fetchEcbDaily(res("<html>maintenance</html>"), "2026-11-20")).toEqual({
      ok: false,
      reason: "unreadable",
    });
    expect(await fetchEcbDaily(res(xml("2026-11-25")), "2026-11-20")).toEqual({
      ok: false,
      reason: "future_date",
    });
  });
  it("on a weekend accepts Friday's publication", async () => {
    const r = await fetchEcbDaily(res(xml("2026-11-20")), "2026-11-22");
    expect(r.ok && r.daily.date).toBe("2026-11-20");
  });
});
