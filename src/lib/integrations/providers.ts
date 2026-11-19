// Read-only provider calls. Only GET/report/search endpoints are used; nothing is written to a provider.
// fetch is injected so the calls can be tested without credentials or network access.
import { mapGa4Report, mapHubspotDeals, mapSearchConsole, mapStripeBalance, type ImportedValue, type ReadOnlyConnector } from "./read-only";

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
export type HealthStatus = "expired" | "insufficient_scope" | "error";
export class ProviderError extends Error {
  constructor(public health: HealthStatus, message: string) { super(message); }
}
export type FetchResult = { values: ImportedValue[]; truncated: boolean };
export type Range = { startDate: string; endDate: string };

const MAX_PAGES = 20;

async function call(f: Fetch, url: string, init: RequestInit, provider: string): Promise<unknown> {
  let res: Response;
  try { res = await f(url, { ...init, signal: AbortSignal.timeout(15_000) }); }
  catch { throw new ProviderError("error", `${provider} could not be reached.`); }
  if (res.status === 401) throw new ProviderError("expired", `${provider} no longer accepts the saved access. Reconnect it.`);
  if (res.status === 403) throw new ProviderError("insufficient_scope", `${provider} refused access: the connection lacks the required read permission.`);
  if (res.status === 429) throw new ProviderError("error", `${provider} is rate limiting requests. Try again later.`);
  if (!res.ok) throw new ProviderError("error", `${provider} responded with status ${res.status}.`);
  try { return await res.json(); } catch { throw new ProviderError("error", `${provider} returned an unreadable response.`); }
}

export async function googleAccessToken(f: Fetch, refreshToken: string, clientId: string, clientSecret: string): Promise<string> {
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret });
  let res: Response;
  try { res = await f("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(15_000) }); }
  catch { throw new ProviderError("error", "Google could not be reached."); }
  if (res.status === 400 || res.status === 401) throw new ProviderError("expired", "Google access was revoked or expired. Reconnect it.");
  if (!res.ok) throw new ProviderError("error", `Google responded with status ${res.status}.`);
  const j = await res.json() as { access_token?: string };
  if (!j.access_token) throw new ProviderError("error", "Google did not return an access token.");
  return j.access_token;
}

export async function fetchGa4(f: Fetch, accessToken: string, propertyId: string, range: Range): Promise<FetchResult> {
  if (!/^\d{4,20}$/.test(propertyId)) throw new ProviderError("error", "The Google Analytics property ID is not valid.");
  const report = await call(f, `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
    method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ dateRanges: [range], dimensions: [{ name: "yearMonth" }], metrics: [{ name: "sessions" }, { name: "keyEvents" }], limit: 100 }),
  }, "Google Analytics");
  return { values: mapGa4Report(report as Parameters<typeof mapGa4Report>[0]), truncated: false };
}

export async function fetchSearchConsole(f: Fetch, accessToken: string, siteUrl: string, range: Range): Promise<FetchResult> {
  if (!/^(https:\/\/|sc-domain:)[^\s]{3,200}$/.test(siteUrl)) throw new ProviderError("error", "The Search Console property is not valid.");
  const resp = await call(f, `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
    method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ ...range, dimensions: ["date"], rowLimit: 25000 }),
  }, "Search Console") as { rows?: unknown[] };
  return { values: mapSearchConsole(resp as Parameters<typeof mapSearchConsole>[0]), truncated: (resp.rows?.length ?? 0) >= 25000 };
}

const unix = (d: string, endOfDay = false) => Math.floor(Date.parse(`${d}T${endOfDay ? "23:59:59" : "00:00:00"}Z`) / 1000);

export async function fetchStripe(f: Fetch, key: string, range: Range): Promise<FetchResult> {
  const txs: Parameters<typeof mapStripeBalance>[0] = []; let after: string | null = null; let more = true; let pages = 0;
  while (more && pages < MAX_PAGES) {
    const qs = new URLSearchParams({ limit: "100", "created[gte]": String(unix(range.startDate)), "created[lte]": String(unix(range.endDate, true)) });
    if (after) qs.set("starting_after", after);
    const page = await call(f, `https://api.stripe.com/v1/balance_transactions?${qs}`, { headers: { authorization: `Bearer ${key}` } }, "Stripe") as { data?: { id: string; amount: number; currency: string; type: string; created: number }[]; has_more?: boolean };
    const data = page.data ?? []; txs.push(...data); more = !!page.has_more && data.length > 0; after = data.at(-1)?.id ?? null; pages++;
  }
  return { values: mapStripeBalance(txs), truncated: more };
}

export async function fetchHubspot(f: Fetch, token: string, range: Range, defaultCurrency: string): Promise<FetchResult> {
  const deals: Parameters<typeof mapHubspotDeals>[0] = []; let after: string | undefined; let pages = 0; let more = true;
  while (more && pages < MAX_PAGES) {
    const page = await call(f, "https://api.hubapi.com/crm/v3/objects/deals/search", {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ filterGroups: [{ filters: [
        { propertyName: "closedate", operator: "BETWEEN", value: String(unix(range.startDate) * 1000), highValue: String(unix(range.endDate, true) * 1000) },
        { propertyName: "hs_is_closed_won", operator: "EQ", value: "true" }] }],
        properties: ["closedate", "amount", "hs_is_closed_won", "deal_currency_code"], limit: 100, ...(after ? { after } : {}) }),
    }, "HubSpot") as { results?: Parameters<typeof mapHubspotDeals>[0]; paging?: { next?: { after?: string } } };
    deals.push(...(page.results ?? [])); after = page.paging?.next?.after; more = !!after; pages++;
  }
  return { values: mapHubspotDeals(deals, defaultCurrency), truncated: more };
}

/** Validates a pasted token before it is stored: format first, then one read-only call. */
export async function probeToken(f: Fetch, connector: Extract<ReadOnlyConnector, "stripe" | "hubspot">, token: string): Promise<{ scopes: string[] }> {
  if (connector === "stripe") {
    if (/^sk_(live|test)_/.test(token)) throw new ProviderError("error", "Use a Stripe restricted key with read-only access (starts with rk_), not a secret key.");
    if (!/^rk_(live|test)_[A-Za-z0-9]{10,}$/.test(token)) throw new ProviderError("error", "This does not look like a Stripe restricted key (rk_…).");
    await call(f, "https://api.stripe.com/v1/balance_transactions?limit=1", { headers: { authorization: `Bearer ${token}` } }, "Stripe");
    return { scopes: ["read_only_restricted_key"] };
  }
  if (!/^pat-[a-z0-9]{2,5}-[A-Za-z0-9-]{10,}$/.test(token)) throw new ProviderError("error", "This does not look like a HubSpot private app token (pat-…).");
  try {
    await call(f, "https://api.hubapi.com/crm/v3/objects/deals/search", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ limit: 1 }) }, "HubSpot");
    return { scopes: ["crm.objects.deals.read"] };
  } catch (e) {
    if (e instanceof ProviderError && e.health === "insufficient_scope") return { scopes: [] };
    throw e;
  }
}
