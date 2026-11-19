import { describe, it, expect } from "vitest";
import { mapGa4Report, mapSearchConsole, mapStripeBalance, mapHubspotDeals } from "@/lib/integrations/read-only";

describe("read-only integration mappers", () => {
  it("maps GA4 yearMonth rows to sessions and key events", () => {
    expect(mapGa4Report({ rows: [{ dimensionValues: [{ value: "202610" }], metricValues: [{ value: "1200" }, { value: "37" }] }, { dimensionValues: [{ value: "bad" }], metricValues: [{ value: "1" }] }] })).toEqual([
      { metricKey: "ga4_sessions", month: "2026-10", value: 1200, unit: "count", currency: null, sourceRef: "ga4:yearMonth=202610" },
      { metricKey: "ga4_key_events", month: "2026-10", value: 37, unit: "count", currency: null, sourceRef: "ga4:yearMonth=202610" },
    ]);
  });
  it("aggregates Search Console days per month and recomputes CTR and weighted position", () => {
    const r = mapSearchConsole({ rows: [{ keys: ["2026-10-01"], clicks: 10, impressions: 100, position: 4 }, { keys: ["2026-10-02"], clicks: 30, impressions: 300, position: 8 }] });
    expect(r.map(x => [x.metricKey, x.value])).toEqual([["gsc_clicks", 40], ["gsc_impressions", 400], ["gsc_ctr", 10], ["gsc_position", 7]]);
  });
  it("nets Stripe charges and refunds per month and keeps currencies separate", () => {
    const oct = Date.UTC(2026, 9, 5) / 1000;
    const r = mapStripeBalance([{ amount: 10000, currency: "eur", type: "charge", created: oct }, { amount: -2500, currency: "eur", type: "refund", created: oct }, { amount: 5000, currency: "usd", type: "charge", created: oct }, { amount: 900, currency: "jpy", type: "charge", created: oct }, { amount: -300, currency: "eur", type: "stripe_fee", created: oct }]);
    expect(r.map(x => [x.metricKey, x.currency, x.value])).toEqual([["stripe_net_revenue_eur", "EUR", 75], ["stripe_net_revenue_jpy", "JPY", 900], ["stripe_net_revenue_usd", "USD", 50]]);
  });
  it("counts HubSpot closed-won deals per month and sums value per currency", () => {
    const r = mapHubspotDeals([
      { properties: { closedate: "2026-10-03T10:00:00Z", amount: "1000", hs_is_closed_won: "true", deal_currency_code: "EUR" } },
      { properties: { closedate: "2026-10-20T10:00:00Z", amount: "500", hs_is_closed_won: "true", deal_currency_code: null } },
      { properties: { closedate: "2026-10-21T10:00:00Z", amount: "900", hs_is_closed_won: "false" } },
    ], "USD");
    expect(r.map(x => [x.metricKey, x.month, x.value])).toEqual([["hubspot_deals_won", "2026-10", 2], ["hubspot_won_amount_eur", "2026-10", 1000], ["hubspot_won_amount_usd", "2026-10", 500]]);
  });
});
