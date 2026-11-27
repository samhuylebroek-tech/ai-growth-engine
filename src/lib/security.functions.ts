import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { platformOwnerGate } from "@/lib/security/owner";
import {
  isNotInstalled,
  type AuditChainStatus,
  type PendingDatabase,
  type SecurityOverview,
} from "@/lib/pending-schema";

// Platform security overview (Platform Owner with a verified second factor). Reads go through role-checked SQL
// functions as the caller; no service-role client. Before proposal 0088 the functions do not exist: "not_installed".

type Denied = { ok: false; error: "forbidden" | "mfa_required" | "not_installed" | "load_failed" };

export const getSecurityOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{ ok: true; chain: AuditChainStatus; overview: SecurityOverview } | Denied> => {
      const gate = await platformOwnerGate(context.supabase, context.claims, "security_overview");
      if (gate !== "ok") return { ok: false, error: gate };
      const sb = context.supabase as unknown as SupabaseClient<PendingDatabase>;
      const [chain, overview] = await Promise.all([
        sb.rpc("verify_audit_chain"),
        sb.rpc("security_overview", { _days: 7 }),
      ]);
      for (const r of [chain, overview]) {
        if (r.error)
          return { ok: false, error: isNotInstalled(r.error) ? "not_installed" : "load_failed" };
      }
      return {
        ok: true,
        chain: chain.data as unknown as AuditChainStatus,
        overview: overview.data as unknown as SecurityOverview,
      };
    },
  );

export const setPlatformStop = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ stop: z.boolean(), reason: z.string().trim().max(300) }).parse(d),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<
      | { ok: true }
      | { ok: false; error: "forbidden" | "mfa_required" | "not_installed" | "reason" | "failed" }
    > => {
      const gate = await platformOwnerGate(context.supabase, context.claims, "platform_stop");
      if (gate !== "ok") return { ok: false, error: gate };
      if (data.stop && data.reason.length < 3) return { ok: false, error: "reason" };
      const sb = context.supabase as unknown as SupabaseClient<PendingDatabase>;
      const r = await sb.rpc("set_platform_execution_stop", {
        _stop: data.stop,
        _reason: data.reason,
      });
      if (r.error) {
        if (isNotInstalled(r.error)) return { ok: false, error: "not_installed" };
        if (/mfa_required/.test(r.error.message)) return { ok: false, error: "mfa_required" };
        if (r.error.code === "42501") return { ok: false, error: "forbidden" };
        return { ok: false, error: "failed" };
      }
      return { ok: true };
    },
  );
