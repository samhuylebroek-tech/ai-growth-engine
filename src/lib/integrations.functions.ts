// Server functions for read-only data connections (GA4, Search Console, Stripe, HubSpot).
// Credentials go straight from the request into encrypted storage through server-attested functions;
// they are never returned to the browser. Imports run on the server as the signed-in user.
import { createServerFn } from "@tanstack/react-start";
import { noteFailure, takeLimit } from "@/lib/rate-limit-server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { isNotInstalled, CONNECTORS_NOT_INSTALLED, type PendingDatabase } from "@/lib/pending-schema";
import { fetchGa4, fetchHubspot, fetchSearchConsole, fetchStripe, googleAccessToken, probeToken, ProviderError, type FetchResult } from "@/lib/integrations/providers";
import { runSync, type SyncOutcome } from "@/lib/integrations/sync";
import { getCookie, setCookie, deleteCookie } from "@tanstack/react-start/server";
import { allowedRedirectOrigin, pkcePair, safeEqual, signState, verifyState } from "@/lib/integrations/oauth";

type DB = SupabaseClient<PendingDatabase>;
type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const CONNECTOR = z.enum(["google_analytics", "search_console", "stripe", "hubspot"]);
const GOOGLE_SCOPES = { google_analytics: "https://www.googleapis.com/auth/analytics.readonly", search_console: "https://www.googleapis.com/auth/webmasters.readonly" } as const;

function proof() { const p = process.env["AI_ACCOUNTING_SECRET"]; if (!p) throw new Error("Server verification is not configured."); return p; }
function googleConfig() {
  const id = process.env["GOOGLE_OAUTH_CLIENT_ID"], secret = process.env["GOOGLE_OAUTH_CLIENT_SECRET"], state = process.env["INTEGRATIONS_STATE_SECRET"], origins = process.env["APP_PUBLIC_ORIGINS"];
  return id && secret && state && state.length >= 32 && origins ? { id, secret, state, origins } : null;
}
const PKCE_COOKIE = "ago_oauth_pkce";
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: isNotInstalled(e) ? CONNECTORS_NOT_INSTALLED : e instanceof ProviderError ? e.message : (e as { message?: string })?.message?.slice(0, 200) || "Something went wrong." });
const db = (sb: unknown) => sb as DB;


export const integrationsAvailability = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async (): Promise<{ google: boolean }> => ({ google: !!googleConfig() }));

export const connectTokenIntegration = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspaceId: z.string().uuid(), connector: z.enum(["stripe", "hubspot"]), token: z.string().trim().min(10).max(500), currency: z.string().regex(/^[A-Z]{3}$/).default("EUR") }).parse(d))
  .handler(async ({ data, context }): Promise<Result<{ status: string; missing: string[] }>> => {
    try {
      const sb = db(context.supabase);
      const admin = await sb.rpc("has_workspace_role", { _workspace: data.workspaceId, _min: "admin" });
      if (admin.error || !admin.data) { await noteFailure(sb, "connect", data.workspaceId); return { ok: false, error: "Only workspace administrators can connect data sources." }; }
      // Counted before the provider is contacted (proposal 0090); a rejected token counts as a failed attempt.
      const limited = await takeLimit(sb, "connect", data.workspaceId);
      if (limited) return { ok: false, error: limited };
      const probed = await probeToken(fetch, data.connector, data.token).catch(async (e: unknown) => {
        if (e instanceof ProviderError && (e.health === "expired" || e.health === "insufficient_scope")) await noteFailure(sb, "connect", data.workspaceId); // rejected token, not an outage
        throw e;
      });
      const { scopes } = probed;
      const r = await sb.rpc("store_connector_credential_verified", { _workspace: data.workspaceId, _connector: data.connector, _secret: data.token, _scopes: scopes, _expires: null, _account_label: data.connector === "stripe" ? `Restricted key …${data.token.slice(-4)}` : `Private app …${data.token.slice(-4)}`, _config: { currency: data.currency } as Json, _proof: proof() });
      if (r.error) return fail(r.error);
      const out = r.data as { status: string; missing_scopes: string[] };
      return { ok: true, data: { status: out.status, missing: out.missing_scopes ?? [] } };
    } catch (e) { return fail(e); }
  });

export const startGoogleIntegration = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspaceId: z.string().uuid(), connector: z.enum(["google_analytics", "search_console"]), origin: z.string().url().max(200), property: z.string().trim().min(3).max(200) }).parse(d))
  .handler(async ({ data, context }): Promise<Result<{ url: string }>> => {
    const g = googleConfig();
    if (!g) return { ok: false, error: "Google sign-in for data sources is not configured for this environment." };
    const admin = await db(context.supabase).rpc("has_workspace_role", { _workspace: data.workspaceId, _min: "admin" });
    if (admin.error || !admin.data) return { ok: false, error: "Only workspace administrators can connect data sources." };
    if (data.connector === "google_analytics" && !/^\d{4,20}$/.test(data.property)) return { ok: false, error: "Enter the numeric Google Analytics property ID." };
    if (data.connector === "search_console" && !/^(https:\/\/|sc-domain:)/.test(data.property)) return { ok: false, error: "Enter the Search Console property, e.g. https://example.com/ or sc-domain:example.com." };
    const origin = allowedRedirectOrigin(data.origin, g.origins);
    if (!origin) return { ok: false, error: "Google sign-in is not allowed from this address." };
    const redirect = `${origin}/app/integrations/google`;
    const nonce = crypto.randomUUID(); const { verifier, challenge } = await pkcePair();
    const state = await signState(g.state, { u: context.userId, w: data.workspaceId, c: data.connector, p: data.property, r: redirect, e: Date.now() + 10 * 60_000, n: nonce });
    setCookie(PKCE_COOKIE, `${nonce}.${verifier}`, { httpOnly: true, secure: origin.startsWith("https://"), sameSite: "lax", path: "/", maxAge: 600 });
    const qs = new URLSearchParams({ client_id: g.id, redirect_uri: redirect, response_type: "code", scope: GOOGLE_SCOPES[data.connector], access_type: "offline", prompt: "consent", include_granted_scopes: "false", state, code_challenge: challenge, code_challenge_method: "S256" });
    return { ok: true, data: { url: `https://accounts.google.com/o/oauth2/v2/auth?${qs}` } };
  });

export const completeGoogleIntegration = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ code: z.string().min(4).max(2000), state: z.string().min(10).max(2000) }).parse(d))
  .handler(async ({ data, context }): Promise<Result<{ status: string; connector: string }>> => {
    try {
      const g = googleConfig(); if (!g) return { ok: false, error: "Google sign-in for data sources is not configured for this environment." };
      const s = await verifyState(g.state, data.state);
      if (!s) return { ok: false, error: "This sign-in link is not valid or has expired. Start the connection again." };
      if (!safeEqual(s.u, context.userId)) return { ok: false, error: "This sign-in was started by another account." };
      if (!allowedRedirectOrigin(s.r, g.origins)) return { ok: false, error: "Google sign-in is not allowed from this address." };
      // PKCE: only the browser that started the sign-in holds the verifier; it is used once.
      const [cookieNonce, verifier] = (getCookie(PKCE_COOKIE) ?? "").split(".");
      deleteCookie(PKCE_COOKIE, { path: "/" });
      if (!cookieNonce || !verifier || !safeEqual(cookieNonce, s.n)) return { ok: false, error: "Start the connection again from this browser." };
      const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code: data.code, client_id: g.id, client_secret: g.secret, redirect_uri: s.r, code_verifier: verifier }), signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return { ok: false, error: "Google did not accept the sign-in. Start the connection again." };
      const t = await res.json() as { refresh_token?: string; scope?: string };
      if (!t.refresh_token) return { ok: false, error: "Google did not grant lasting read access. Remove the app's access in your Google account and connect again." };
      const r = await db(context.supabase).rpc("store_connector_credential_verified", { _workspace: s.w, _connector: s.c, _secret: JSON.stringify({ refresh_token: t.refresh_token }), _scopes: (t.scope ?? "").split(" ").filter(Boolean), _expires: null, _account_label: s.p, _config: (s.c === "google_analytics" ? { property_id: s.p } : { site_url: s.p }) as Json, _proof: proof() });
      if (r.error) return fail(r.error);
      return { ok: true, data: { status: (r.data as { status: string }).status, connector: s.c } };
    } catch (e) { return fail(e); }
  });

export const syncIntegration = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspaceId: z.string().uuid(), connector: CONNECTOR, months: z.number().int().min(1).max(24), requestKey: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<Result<SyncOutcome>> => {
    const sb = db(context.supabase); const ws = data.workspaceId, c = data.connector; let runId = "";
    try {
      const P = proof();
      const outcome = await runSync({
        beginRun: async (months) => {
          const r = await sb.rpc("begin_connector_import_verified", { _workspace: ws, _connector: c, _request: data.requestKey, _months: months, _proof: P });
          if (r.error) throw r.error; const v = r.data as { run_id: string; existing: boolean; status: string }; runId = v.run_id;
          return { runId: v.run_id, existing: v.existing, status: v.status };
        },
        fetchValues: async (range): Promise<FetchResult> => {
          const r = await sb.rpc("read_connector_credential_verified", { _workspace: ws, _connector: c, _proof: P });
          if (r.error) throw new ProviderError("error", "The saved access could not be read.");
          const cred = r.data as { secret: string; config: Record<string, string> };
          if (c === "stripe") return fetchStripe(fetch, cred.secret, range);
          if (c === "hubspot") return fetchHubspot(fetch, cred.secret, range, cred.config["currency"] ?? "EUR");
          const g = googleConfig(); if (!g) throw new ProviderError("error", "Google sign-in for data sources is not configured for this environment.");
          let refresh = ""; try { refresh = (JSON.parse(cred.secret) as { refresh_token: string }).refresh_token; } catch { throw new ProviderError("expired", "The saved Google access is unreadable. Reconnect it."); }
          const token = await googleAccessToken(fetch, refresh, g.id, g.secret);
          return c === "google_analytics" ? fetchGa4(fetch, token, cred.config["property_id"] ?? "", range) : fetchSearchConsole(fetch, token, cred.config["site_url"] ?? "", range);
        },
        listMetrics: async () => {
          const r = await sb.from("metric_definitions").select("id,key,unit,currency,archived").eq("workspace_id", ws).limit(500);
          if (r.error) throw r.error; return r.data ?? [];
        },
        importValue: async (i) => {
          const r = await sb.rpc("import_measurement_verified", { _metric: i.metricId, _connector: c, _period_start: i.periodStart, _period_end: i.periodEnd, _value: i.value, _source_ref: i.sourceRef, _request: i.requestKey, _proof: P });
          if (r.error) throw new Error(r.error.message); return (r.data as { status: string }).status;
        },
        reportHealth: async (status, error) => { await sb.rpc("report_connector_health_verified", { _workspace: ws, _connector: c, _status: status, _error: error, _proof: P }); },
        finishRun: async (f) => {
          const r = await sb.rpc("finish_connector_import_verified", { _run: runId, _status: f.status, _created: f.created, _corrected: f.corrected, _unchanged: f.unchanged, _skipped: f.skipped, _error: f.error, _proof: P });
          if (r.error) throw r.error;
        },
      }, data.months);
      return { ok: true, data: outcome };
    } catch (e) { return fail(e); }
  });

export const disconnectIntegration = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspaceId: z.string().uuid(), connector: CONNECTOR }).parse(d))
  .handler(async ({ data, context }): Promise<Result<null>> => {
    try {
      const r = await db(context.supabase).rpc("disconnect_connector_verified", { _workspace: data.workspaceId, _connector: data.connector, _proof: proof() });
      return r.error ? fail(r.error) : { ok: true, data: null };
    } catch (e) { return fail(e); }
  });
