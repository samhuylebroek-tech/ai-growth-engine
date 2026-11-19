import { describe, it, expect } from "vitest";
import { fetchStripe, fetchHubspot, probeToken, googleAccessToken, ProviderError, type Fetch } from "@/lib/integrations/providers";
import { completeMonths, planImports, importRequestKey } from "@/lib/integrations/plan";
import { runSync, type SyncDeps } from "@/lib/integrations/sync";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const oct = Date.UTC(2026, 9, 10) / 1000;

describe("read-only provider calls", () => {
  it("only reads from Stripe and follows pages up to the limit", async () => {
    const seen: { url: string; method: string }[] = [];
    const f: Fetch = async (url, init) => { seen.push({ url, method: init?.method ?? "GET" });
      return url.includes("starting_after") ? json({ data: [{ id: "t2", amount: 500, currency: "eur", type: "charge", created: oct }], has_more: false })
        : json({ data: [{ id: "t1", amount: 1000, currency: "eur", type: "charge", created: oct }], has_more: true }); };
    const r = await fetchStripe(f, "rk_test_abcdefghijk", { startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(seen.every(s => s.method === "GET")).toBe(true);
    expect(r.values).toEqual([expect.objectContaining({ metricKey: "stripe_net_revenue_eur", value: 15 })]);
    expect(r.truncated).toBe(false);
  });
  it("classifies 401 as expired and 403 as missing permission", async () => {
    await expect(fetchHubspot(async () => json({}, 401), "pat-eu1-xxxxxxxxxxxx", { startDate: "2026-10-01", endDate: "2026-10-31" }, "EUR")).rejects.toMatchObject({ health: "expired" });
    await expect(fetchHubspot(async () => json({}, 403), "pat-eu1-xxxxxxxxxxxx", { startDate: "2026-10-01", endDate: "2026-10-31" }, "EUR")).rejects.toMatchObject({ health: "insufficient_scope" });
    await expect(googleAccessToken(async () => json({ error: "invalid_grant" }, 400), "r", "c", "s")).rejects.toMatchObject({ health: "expired" });
  });
  it("refuses full Stripe secret keys and malformed tokens before any network call", async () => {
    let calls = 0; const f: Fetch = async () => { calls++; return json({}); };
    await expect(probeToken(f, "stripe", "sk_live_abcdefghijklmnop")).rejects.toBeInstanceOf(ProviderError);
    await expect(probeToken(f, "hubspot", "not-a-token")).rejects.toBeInstanceOf(ProviderError);
    expect(calls).toBe(0);
    expect(await probeToken(f, "stripe", "rk_live_abcdefghijklmnop")).toEqual({ scopes: ["read_only_restricted_key"] });
    expect(await probeToken(async () => json({}, 403), "hubspot", "pat-eu1-abcdefghijklmn")).toEqual({ scopes: [] });
  });
});

describe("import planning", () => {
  it("uses complete months only", () => {
    expect(completeMonths(new Date("2026-11-19T08:00:00Z"), 2)).toEqual([{ month: "2026-09", start: "2026-09-01", end: "2026-09-30" }, { month: "2026-10", start: "2026-10-01", end: "2026-10-31" }]);
  });
  it("imports only into metrics with the same key, unit and currency", () => {
    const months = completeMonths(new Date("2026-11-19T08:00:00Z"), 1);
    const plan = planImports([
      { metricKey: "stripe_net_revenue_eur", month: "2026-10", value: 10, unit: "currency", currency: "EUR", sourceRef: "s" },
      { metricKey: "stripe_net_revenue_usd", month: "2026-10", value: 5, unit: "currency", currency: "USD", sourceRef: "s" },
      { metricKey: "ga4_sessions", month: "2026-10", value: 9, unit: "count", currency: null, sourceRef: "g" },
      { metricKey: "stripe_net_revenue_eur", month: "2026-09", value: 7, unit: "currency", currency: "EUR", sourceRef: "s" },
    ], [{ id: "m1", key: "stripe_net_revenue_eur", unit: "currency", currency: "EUR", archived: false }, { id: "m2", key: "stripe_net_revenue_usd", unit: "currency", currency: "EUR", archived: false }], months);
    expect(plan.imports.map(i => [i.metricId, i.month, i.value])).toEqual([["m1", "2026-10", 10]]);
    expect(plan.mismatched).toEqual(["stripe_net_revenue_usd"]);
    expect(plan.untracked).toEqual(["ga4_sessions"]);
  });
  it("derives the same request key for the same run, metric and month", async () => {
    const a = await importRequestKey("run", "m1", "2026-10");
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await importRequestKey("run", "m1", "2026-10")).toBe(a);
    expect(await importRequestKey("run", "m1", "2026-09")).not.toBe(a);
  });
});

function deps(over: Partial<SyncDeps> = {}) {
  const log: string[] = [];
  const d: SyncDeps = {
    beginRun: async () => ({ runId: "r1", existing: false, status: "running" }),
    fetchValues: async () => ({ values: [{ metricKey: "ga4_sessions", month: "2026-10", value: 100, unit: "count", currency: null, sourceRef: "ga4:202610" }], truncated: false }),
    listMetrics: async () => [{ id: "m1", key: "ga4_sessions", unit: "count", currency: null, archived: false }],
    importValue: async (i) => { log.push(`import ${i.metricId} ${i.periodStart} ${i.value} ${i.sourceRef}`); return "created"; },
    reportHealth: async (s) => { log.push(`health ${s}`); },
    finishRun: async (r) => { log.push(`finish ${r.status} ${r.created}/${r.skipped}`); },
    ...over,
  };
  return { d, log };
}

describe("import run", () => {
  const now = new Date("2026-11-19T08:00:00Z");
  it("imports matched values, records health and finishes the run", async () => {
    const { d, log } = deps();
    const r = await runSync(d, 1, now);
    expect(r).toMatchObject({ status: "succeeded", created: 1 });
    expect(log).toEqual(["health connected", "import m1 2026-10-01 100 ga4:202610#run=r1", "finish succeeded 1/0"]);
  });
  it("marks an expired connection and fails the run without importing", async () => {
    const { d, log } = deps({ fetchValues: async () => { throw new ProviderError("expired", "Reconnect it."); } });
    const r = await runSync(d, 1, now);
    expect(r.status).toBe("failed");
    expect(log).toEqual(["health expired", "finish failed 0/0"]);
  });
  it("is partial when a value is rejected, and never repeats a finished run", async () => {
    const { d } = deps({ importValue: async () => { throw new Error("Metric unavailable"); } });
    expect((await runSync(d, 1, now)).status).toBe("partial");
    const again = deps({ beginRun: async () => ({ runId: "r1", existing: true, status: "succeeded" }) });
    const r = await runSync(again.d, 1, now);
    expect(r.status).toBe("succeeded"); expect(again.log).toEqual([]);
  });
});
