// Read-only integration mappers: provider API responses → monthly imported values.
// Pure and provider-agnostic so they can be tested without credentials. Values produced here are
// stored only through the server-attested import function (docs/proposals/0057) as imported_actual.

export type ReadOnlyConnector = "google_analytics" | "search_console" | "stripe" | "hubspot";
export const SOURCE_LABEL: Record<string, string> = { google_analytics: "Google Analytics", search_console: "Search Console", stripe: "Stripe", hubspot: "HubSpot" };

export type ImportedValue = { metricKey: string; month: string; value: number; unit: "count" | "currency" | "percent" | "ratio"; currency: string | null; sourceRef: string };

/** What each connector would provide; shown in the interface before anything is connected. */
export const READ_ONLY_METRICS: Record<ReadOnlyConnector, { key: string; label: string; unit: ImportedValue["unit"] }[]> = {
  google_analytics: [{ key: "ga4_sessions", label: "Website sessions", unit: "count" }, { key: "ga4_key_events", label: "Key events (conversions)", unit: "count" }],
  search_console: [{ key: "gsc_clicks", label: "Search clicks", unit: "count" }, { key: "gsc_impressions", label: "Search impressions", unit: "count" }, { key: "gsc_ctr", label: "Search click-through rate", unit: "percent" }, { key: "gsc_position", label: "Average search position", unit: "ratio" }],
  stripe: [{ key: "stripe_net_revenue", label: "Net revenue (per currency)", unit: "currency" }],
  hubspot: [{ key: "hubspot_deals_won", label: "Deals won", unit: "count" }, { key: "hubspot_won_amount", label: "Won deal value (per currency)", unit: "currency" }],
};

const monthOf = (d: Date) => d.toISOString().slice(0, 7);
const finite = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/** GA4 Data API runReport with dimension yearMonth and metrics [sessions, keyEvents]. */
export function mapGa4Report(report: { rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[] }): ImportedValue[] {
  const out: ImportedValue[] = [];
  for (const r of report.rows ?? []) {
    const ym = r.dimensionValues?.[0]?.value ?? "";
    if (!/^\d{6}$/.test(ym)) continue;
    const month = `${ym.slice(0, 4)}-${ym.slice(4)}`;
    const [sessions, keyEvents] = (r.metricValues ?? []).map(m => finite(m.value));
    if (sessions != null) out.push({ metricKey: "ga4_sessions", month, value: sessions, unit: "count", currency: null, sourceRef: `ga4:yearMonth=${ym}` });
    if (keyEvents != null) out.push({ metricKey: "ga4_key_events", month, value: keyEvents, unit: "count", currency: null, sourceRef: `ga4:yearMonth=${ym}` });
  }
  return out;
}

/** Search Console searchAnalytics.query with dimension date, aggregated per month. CTR and position are recomputed, never averaged. */
export function mapSearchConsole(resp: { rows?: { keys?: string[]; clicks?: number; impressions?: number; position?: number }[] }): ImportedValue[] {
  const by = new Map<string, { clicks: number; impressions: number; weighted: number }>();
  for (const r of resp.rows ?? []) {
    const day = r.keys?.[0] ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const a = by.get(day.slice(0, 7)) ?? { clicks: 0, impressions: 0, weighted: 0 };
    const imp = finite(r.impressions) ?? 0;
    a.clicks += finite(r.clicks) ?? 0; a.impressions += imp; a.weighted += (finite(r.position) ?? 0) * imp;
    by.set(day.slice(0, 7), a);
  }
  return [...by.entries()].sort().flatMap(([month, a]) => {
    const ref = `gsc:${month}`;
    const rows: ImportedValue[] = [
      { metricKey: "gsc_clicks", month, value: a.clicks, unit: "count", currency: null, sourceRef: ref },
      { metricKey: "gsc_impressions", month, value: a.impressions, unit: "count", currency: null, sourceRef: ref },
    ];
    if (a.impressions > 0) {
      rows.push({ metricKey: "gsc_ctr", month, value: Math.round((a.clicks / a.impressions) * 10000) / 100, unit: "percent", currency: null, sourceRef: ref });
      rows.push({ metricKey: "gsc_position", month, value: Math.round((a.weighted / a.impressions) * 10) / 10, unit: "ratio", currency: null, sourceRef: ref });
    }
    return rows;
  });
}

const ZERO_DECIMAL = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);
/** Stripe balance transactions → net revenue per month and currency (charges and payments minus refunds), in major units. */
export function mapStripeBalance(txs: { amount: number; currency: string; type: string; created: number }[]): ImportedValue[] {
  const by = new Map<string, number>();
  for (const t of txs) {
    if (!["charge", "payment", "refund", "payment_refund"].includes(t.type) || !Number.isFinite(t.amount)) continue;
    const cur = String(t.currency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(cur)) continue;
    const key = `${monthOf(new Date(t.created * 1000))}|${cur}`;
    by.set(key, (by.get(key) ?? 0) + t.amount);
  }
  return [...by.entries()].sort().map(([key, minor]) => {
    const [month = "", currency = ""] = key.split("|");
    return { metricKey: `stripe_net_revenue_${currency.toLowerCase()}`, month, value: ZERO_DECIMAL.has(currency) ? minor : minor / 100, unit: "currency", currency, sourceRef: `stripe:balance_transactions:${month}` };
  });
}

/** HubSpot closed-won deals → count per month, and won value per month and currency. */
export function mapHubspotDeals(deals: { properties: { closedate?: string | null; amount?: string | null; hs_is_closed_won?: string | null; deal_currency_code?: string | null } }[], defaultCurrency: string): ImportedValue[] {
  const count = new Map<string, number>(); const value = new Map<string, number>();
  for (const d of deals) {
    const p = d.properties;
    if (p.hs_is_closed_won !== "true" || !p.closedate) continue;
    const date = new Date(p.closedate); if (Number.isNaN(date.getTime())) continue;
    const month = monthOf(date);
    count.set(month, (count.get(month) ?? 0) + 1);
    const amount = finite(p.amount);
    const cur = (p.deal_currency_code || defaultCurrency).toUpperCase();
    if (amount != null && /^[A-Z]{3}$/.test(cur)) value.set(`${month}|${cur}`, (value.get(`${month}|${cur}`) ?? 0) + amount);
  }
  return [
    ...[...count.entries()].sort().map(([month, n]) => ({ metricKey: "hubspot_deals_won", month, value: n, unit: "count" as const, currency: null, sourceRef: `hubspot:deals:${month}` })),
    ...[...value.entries()].sort().map(([key, v]) => { const [month = "", currency = ""] = key.split("|"); return { metricKey: `hubspot_won_amount_${currency.toLowerCase()}`, month, value: v, unit: "currency" as const, currency, sourceRef: `hubspot:deals:${month}` }; }),
  ];
}
