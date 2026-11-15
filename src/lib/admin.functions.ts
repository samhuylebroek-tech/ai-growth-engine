import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformOwner } from "@/lib/security/owner";

// Owner control center data. Authorization: platform owner only; all reads go through RLS
// policies that grant platform staff read access (no service-role client used).
export const getOwnerOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase;
    try { await requirePlatformOwner(sb); }
    catch { return { ok: false as const, error: "Platform Owner access required." }; }
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const [orgs, subs, plans, usage] = await Promise.all([
      sb.from("organizations").select("id,name,type,status,created_at").order("created_at", { ascending: false }).limit(1000),
      sb.from("subscriptions").select("org_id,plan_key,status,trial_ends_at,billing_cycle"),
      sb.from("plans").select("*").order("tier"),
      sb.from("ai_usage_events").select("org_id,cost_estimate_eur,credits_charged,input_tokens,output_tokens,model").gte("created_at", since).limit(10000),
    ]);
    for (const result of [orgs, subs, plans, usage]) if (result.error) return { ok: false as const, error: "The owner overview could not load." };
    const planMap = new Map((plans.data ?? []).map((p) => [p.key, p]));
    const costByOrg = new Map<string, { cost: number; credits: number; calls: number }>();
    for (const u of usage.data ?? []) {
      const c = costByOrg.get(u.org_id) ?? { cost: 0, credits: 0, calls: 0 };
      c.cost += Number(u.cost_estimate_eur); c.credits += u.credits_charged; c.calls += 1; costByOrg.set(u.org_id, c);
    }
    const subMap = new Map((subs.data ?? []).map((s) => [s.org_id, s]));
    const rows = (orgs.data ?? []).map((o) => {
      const s = subMap.get(o.id); const p = s ? planMap.get(s.plan_key) : undefined;
      const configuredMrr = s && s.status === "active" && p?.price_monthly_eur ? (s.billing_cycle === "yearly" ? Number(p.price_yearly_eur ?? 0) / 12 : Number(p.price_monthly_eur)) : 0;
      const u = costByOrg.get(o.id) ?? { cost: 0, credits: 0, calls: 0 };
      return { ...o, plan: s?.plan_key ?? null, subStatus: s?.status ?? null, trialEndsAt: s?.trial_ends_at ?? null, configuredMrr, aiCost30d: u.cost, aiCalls30d: u.calls, credits30d: u.credits, margin30d: configuredMrr - u.cost };
    });
    const totals = {
      orgs: rows.length,
      trialing: rows.filter((r) => r.subStatus === "trialing").length,
      active: rows.filter((r) => r.subStatus === "active").length,
      configuredMrr: rows.reduce((a, r) => a + r.configuredMrr, 0),
      aiCost30d: rows.reduce((a, r) => a + r.aiCost30d, 0),
      aiCalls30d: rows.reduce((a, r) => a + r.aiCalls30d, 0),
    };
    return { ok: true as const, rows, totals, plans: plans.data ?? [] };
  });
