// Server actions for the external action workflow. Execution, outcomes and verification are written only here,
// through server-attested database functions, as the signed-in user (RLS and role checks apply). In this phase only
// simulated providers can execute; the database refuses real connections as well.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { isNotInstalled, INTEGRATION_HUB_NOT_INSTALLED, type PendingDatabase } from "@/lib/pending-schema";
import { SCENARIOS, simulatedAdapter, type SimBackend } from "@/lib/integrations/simulated";

type DB = SupabaseClient<PendingDatabase>;
type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const db = (sb: unknown) => sb as DB;
function proof() { const p = process.env["AI_ACCOUNTING_SECRET"]; if (!p) throw new Error("Server verification is not configured."); return p; }
const msg = (e: unknown) => (e as { message?: string })?.message?.slice(0, 200) || "Something went wrong.";
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: isNotInstalled(e) ? INTEGRATION_HUB_NOT_INSTALLED : msg(e) });

function backend(sb: DB, connection: string): SimBackend {
  return {
    async write(key, type, state, payload) {
      const r = await sb.rpc("sim_provider_write_verified", { _connection: connection, _key: key, _type: type, _state: state, _payload: payload as Json, _proof: proof() });
      if (r.error) throw r.error;
      return r.data as { external_ref: string; state: string; existing: boolean };
    },
    async lookup(key) {
      const r = await sb.rpc("sim_provider_lookup_verified", { _connection: connection, _key: key, _proof: proof() });
      if (r.error) throw r.error;
      return r.data as { found: boolean; external_ref?: string; state?: string; created_at?: string };
    },
  };
}

export const executeExternalAction = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ actionId: z.string().uuid(), key: z.string().uuid(), scenario: z.enum(SCENARIOS).default("success") }).parse(d))
  .handler(async ({ data, context }): Promise<Result<{ stage: string; error: string | null }>> => {
    const sb = db(context.supabase);
    try {
      const begun = await sb.rpc("begin_external_action_verified", { _action: data.actionId, _key: data.key, _proof: proof() });
      if (begun.error) return fail(begun.error);
      const b = begun.data as { provider: string; connection_id: string; type: string; payload: Record<string, unknown> };
      if (!b.provider.startsWith("sim.")) return { ok: false, error: "gate:real_execution_disabled" };
      let out;
      try { out = await simulatedAdapter(backend(sb, b.connection_id)).execute({ key: data.key, type: b.type, payload: b.payload ?? {}, scenario: data.scenario }); }
      catch (e) { out = { outcome: "uncertain" as const, error: `No definite answer: ${msg(e)}` }; }
      const fin = await sb.rpc("finish_external_action_verified", {
        _action: data.actionId, _key: data.key, _outcome: out.outcome, _ref: out.outcome === "executed" ? out.ref : null,
        _error: out.outcome === "executed" ? null : out.error, _health: out.outcome === "failed" ? out.health : null, _proof: proof() });
      if (fin.error) return fail(fin.error);
      return { ok: true, data: { stage: (fin.data as { stage: string }).stage, error: out.outcome === "executed" ? null : out.error } };
    } catch (e) { return fail(e); }
  });

export const verifyExternalAction = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ actionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<Result<{ stage: string; verification: string }>> => {
    const sb = db(context.supabase);
    try {
      const a = await sb.from("external_actions").select("id,stage,exec_key,connection_id,action_type,simulated").eq("id", data.actionId).maybeSingle();
      if (a.error) return fail(a.error);
      if (!a.data || !a.data.exec_key) return { ok: false, error: "This action has not been executed." };
      const v = a.data.simulated
        ? await simulatedAdapter(backend(sb, a.data.connection_id)).verify({ key: a.data.exec_key, type: a.data.action_type })
        : { status: "unavailable" as const, found: false, ref: null, evidence: { reason: "This provider offers no verification yet" } };
      const r = await sb.rpc("record_external_verification_verified", { _action: data.actionId, _status: v.status, _found: v.found, _ref: v.ref, _evidence: v.evidence as Json, _proof: proof() });
      if (r.error) return fail(r.error);
      return { ok: true, data: r.data as { stage: string; verification: string } };
    } catch (e) { return fail(e); }
  });

/** Simulated synchronisation: records a sync run in the normal import history, imports nothing and says so. */
export const syncSimulatedIntegration = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ workspaceId: z.string().uuid(), connector: z.string().regex(/^sim\.[a-z_]+$/), request: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<Result<{ status: string }>> => {
    const sb = db(context.supabase);
    try {
      const begun = await sb.rpc("begin_connector_import_verified", { _workspace: data.workspaceId, _connector: data.connector, _request: data.request, _months: 1, _proof: proof() });
      if (begun.error) return fail(begun.error);
      const run = begun.data as { run_id: string; existing: boolean; status: string };
      if (run.existing) return { ok: true, data: { status: run.status } };
      const fin = await sb.rpc("finish_connector_import_verified", { _run: run.run_id, _status: "succeeded", _created: 0, _corrected: 0, _unchanged: 0, _skipped: 0, _error: "Simulated: no data imported", _proof: proof() });
      if (fin.error) return fail(fin.error);
      return { ok: true, data: { status: "succeeded" } };
    } catch (e) { return fail(e); }
  });
