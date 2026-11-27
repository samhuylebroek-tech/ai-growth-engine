import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { platformOwnerGate } from "@/lib/security/owner";
import type { CreditPriceVersionRow, PendingDatabase } from "@/lib/pending-schema";

// Credit price administration. Platform Owner only: the server checks the exact role before every read and
// write, RLS limits the full history to the Platform Owner, and the only writer is the role-checked
// `set_credit_price` function (insert-only, never back-dated, audited).

export const getCreditPriceAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    const gate = await platformOwnerGate(sb, context.claims, "credit_prices");
    if (gate !== "ok")
      return {
        ok: false as const,
        error: gate === "mfa_required" ? ("mfa_required" as const) : ("forbidden" as const),
      };
    const pending = sb as unknown as SupabaseClient<PendingDatabase>;
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const [history, plans, usage, subs] = await Promise.all([
      pending
        .from("credit_price_versions")
        .select("*")
        .order("effective_from", { ascending: false })
        .limit(1000),
      sb.from("plans").select("key,name").order("tier"),
      sb
        .from("ai_usage_events")
        .select("org_id,credits_charged")
        .gte("created_at", since)
        .limit(20000),
      sb.from("subscriptions").select("org_id,plan_key"),
    ]);
    if (history.error && ["PGRST205", "42P01"].includes(history.error.code))
      return { ok: false as const, error: "not_installed" as const };
    for (const r of [history, plans, usage, subs])
      if (r.error) return { ok: false as const, error: "load_failed" as const };
    const planOf = new Map((subs.data ?? []).map((s) => [s.org_id, s.plan_key]));
    const creditsByPlan: Record<string, number> = {};
    let credits30d = 0;
    for (const u of usage.data ?? []) {
      credits30d += u.credits_charged;
      const p = planOf.get(u.org_id) ?? "none";
      creditsByPlan[p] = (creditsByPlan[p] ?? 0) + u.credits_charged;
    }
    return {
      ok: true as const,
      history: (history.data ?? []) as CreditPriceVersionRow[],
      plans: plans.data ?? [],
      credits30d,
      creditsByPlan,
      usageTruncated: (usage.data ?? []).length >= 20000,
    };
  });

export const setCreditPrice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        scope: z.enum(["platform", "plan"]),
        plan: z.string().trim().min(1).max(60).nullable(),
        currency: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z]{3}$/),
        price: z.number().positive().lt(1000),
        effectiveFrom: z.string().datetime({ offset: true }),
        methodology: z.string().trim().min(3).max(500),
      })
      .parse(d),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<
      | { ok: true; id: string }
      | { ok: false; error: "forbidden" | "mfa_required" | "backdated" | "invalid" | "failed" }
    > => {
      const sb = context.supabase;
      const gate = await platformOwnerGate(sb, context.claims, "credit_prices");
      if (gate !== "ok") return { ok: false, error: gate };
      const pending = sb as unknown as SupabaseClient<PendingDatabase>;
      const { data: id, error } = await pending.rpc("set_credit_price", {
        _scope: data.scope,
        _plan: data.scope === "plan" ? data.plan : null,
        _currency: data.currency,
        _price: data.price,
        _effective_from: data.effectiveFrom,
        _methodology: data.methodology,
      });
      if (error) {
        if (/mfa_required/.test(error.message)) return { ok: false, error: "mfa_required" };
        if (error.code === "42501") return { ok: false, error: "forbidden" };
        if (/credit_price_backdated/.test(error.message)) return { ok: false, error: "backdated" };
        if (error.code === "22023" || error.code === "23505")
          return { ok: false, error: "invalid" };
        return { ok: false, error: "failed" };
      }
      return { ok: true, id: String(id) };
    },
  );
