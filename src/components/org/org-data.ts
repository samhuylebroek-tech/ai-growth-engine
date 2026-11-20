// Reads for the Organization overview: every query runs as the signed-in user (RLS), filtered to the organization
// and to the businesses the user can open, so totals only ever cover visible businesses. Bounded reads fail closed
// (an incomplete read is an error, never a silently smaller total). The same reader serves the server-side
// Organization Growth Officer with the caller's own client, so the AI never sees more than the caller can open.
import { queryOptions } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { growthDb, isNotInstalled, retryUnlessNotInstalled, type PendingDatabase } from "@/lib/pending-schema";

export const ORG_LIMIT = 2000;
const OPEN_RUNS = ["awaiting_approval", "queued", "paused", "running", "uncertain"] as const;
export const monthStartIso = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);

function complete<T>(r: { data: T[] | null; error: unknown; count?: number | null }, what: string): T[] {
  if (r.error) throw r.error;
  if ((r.count ?? 0) > ORG_LIMIT) throw new Error(`too_many:${what}`);
  return r.data ?? [];
}
function optional<T>(r: { data: T[] | null; error: unknown; count?: number | null }, what: string): T[] | null {
  if (r.error && isNotInstalled(r.error)) return null;
  return complete(r, what);
}

export function orgOverviewOptions(orgId: string | undefined, ids: readonly string[], from: string) {
  const month = monthStartIso();
  return queryOptions({
    queryKey: ["org-overview", orgId, [...ids].sort().join(","), from, month],
    enabled: !!orgId && ids.length > 0,
    staleTime: 30_000,
    retry: retryUnlessNotInstalled,
    queryFn: () => fetchOrgOverview(orgId!, ids, from, month),
  });
}

export async function fetchOrgOverview(org: string, ids: readonly string[], from: string, month: string, db: SupabaseClient<PendingDatabase> = growthDb) {
      const ws = [...ids];
      const c = { count: "exact" as const };
      const [profiles, goals, campaigns, tasks, budget, openRuns, monthRuns, approvals, initiatives, revenue, units, allocations, rates, settings, experiments, plans] = await Promise.all([
        db.from("business_profiles").select("*").eq("org_id", org).in("workspace_id", ws),
        db.from("growth_goals").select("*", c).eq("org_id", org).in("workspace_id", ws).neq("status", "archived").limit(ORG_LIMIT),
        db.from("campaigns").select("*", c).eq("org_id", org).in("workspace_id", ws).neq("status", "archived").limit(ORG_LIMIT),
        db.from("tasks").select("id,workspace_id,title,status,due_date", c).eq("org_id", org).in("workspace_id", ws).not("status", "in", "(done,cancelled)").limit(ORG_LIMIT),
        db.from("budget_lines").select("*", c).eq("org_id", org).in("workspace_id", ws).eq("period_month", month).limit(ORG_LIMIT),
        db.from("task_runs").select("id,workspace_id,status,specialist_key,estimated_credits,credits_charged,created_at", c).eq("org_id", org).in("workspace_id", ws).in("status", OPEN_RUNS).limit(ORG_LIMIT),
        db.from("task_runs").select("id,workspace_id,status,specialist_key,estimated_credits,credits_charged,created_at", c).eq("org_id", org).in("workspace_id", ws).gte("created_at", `${month}T00:00:00Z`).limit(ORG_LIMIT),
        db.from("approvals").select("id,workspace_id", c).eq("org_id", org).in("workspace_id", ws).eq("status", "pending").limit(ORG_LIMIT),
        db.from("growth_initiatives").select("id,workspace_id,status", c).eq("org_id", org).in("workspace_id", ws).eq("status", "in_progress").limit(ORG_LIMIT),
        db.from("revenue_events").select("*", c).eq("org_id", org).in("workspace_id", ws).gte("occurred_at", `${from}T00:00:00Z`).limit(ORG_LIMIT),
        db.from("business_units").select("*").eq("org_id", org).in("workspace_id", ws).eq("archived", false).limit(500),
        db.from("specialist_allocations").select("*").eq("org_id", org).in("workspace_id", ws).limit(1000),
        db.from("exchange_rates").select("*").eq("org_id", org).order("rate_date", { ascending: false }).limit(500),
        db.from("execution_settings").select("workspace_id,mode,paused,monthly_credit_cap,max_parallel").eq("org_id", org).in("workspace_id", ws).limit(500),
        db.from("growth_experiments").select("id,workspace_id,title,objective,status,conclusion,evidence_strength,ended_at", c).eq("org_id", org).in("workspace_id", ws).eq("status", "completed").order("ended_at", { ascending: false }).limit(ORG_LIMIT),
        db.from("growth_plan_versions").select("id,workspace_id,status", c).eq("org_id", org).in("workspace_id", ws).eq("status", "approved").limit(ORG_LIMIT),
      ]);
      if (profiles.error) throw profiles.error;
      const runs = new Map<string, NonNullable<typeof openRuns.data>[number]>();
      for (const r of [...complete(openRuns, "runs"), ...complete(monthRuns, "runs")]) runs.set(r.id, r);
      return {
        profiles: profiles.data ?? [],
        goals: complete(goals, "goals"), campaigns: complete(campaigns, "campaigns"), tasks: complete(tasks, "tasks"),
        budget: complete(budget, "budget"), runs: [...runs.values()], approvals: complete(approvals, "approvals"),
        initiatives: optional(initiatives, "initiatives") ?? [],
        revenue: optional(revenue, "revenue"), units: optional(units, "units"),
        allocations: optional(allocations, "allocations"), rates: optional(rates, "rates"),
        settings: optional(settings, "settings") ?? [], experiments: optional(experiments, "experiments") ?? [],
        approvedPlans: optional(plans, "plans") ?? [],
      };
}
export type OrgOverviewData = Awaited<ReturnType<typeof fetchOrgOverview>>;

/** Organization-level records (proposal 0070). Each list is null when the feature is not installed in this environment. */
export function orgIntelOptions(orgId: string | undefined) {
  return queryOptions({
    queryKey: ["org-intel", orgId],
    enabled: !!orgId,
    staleTime: 15_000,
    retry: retryUnlessNotInstalled,
    queryFn: () => fetchOrgIntel(orgId!),
  });
}
export async function fetchOrgIntel(org: string, db: SupabaseClient<PendingDatabase> = growthDb) {
  const c = { count: "exact" as const };
  const [strategies, opportunities, initiatives, commitments, proposals] = await Promise.all([
    db.from("org_strategies").select("*").eq("org_id", org).order("version", { ascending: false }).limit(20),
    db.from("org_opportunities").select("*", c).eq("org_id", org).order("created_at", { ascending: false }).limit(300),
    db.from("org_initiatives").select("*", c).eq("org_id", org).order("created_at", { ascending: false }).limit(200),
    db.from("org_initiative_commitments").select("*", c).eq("org_id", org).limit(1000),
    db.from("org_allocation_proposals").select("*", c).eq("org_id", org).order("created_at", { ascending: false }).limit(200),
  ]);
  const strat = optional(strategies, "strategies");
  return {
    installed: strat !== null,
    strategies: strat ?? [], opportunities: optional(opportunities, "opportunities") ?? [], initiatives: optional(initiatives, "initiatives") ?? [],
    commitments: optional(commitments, "commitments") ?? [], proposals: optional(proposals, "proposals") ?? [],
  };
}
export type OrgIntelData = Awaited<ReturnType<typeof fetchOrgIntel>>;

/** Organization-level decision history from the append-only audit log (organization admins only, by RLS). */
export function orgDecisionsOptions(orgId: string | undefined, enabled: boolean) {
  return queryOptions({
    queryKey: ["org-decisions", orgId],
    enabled: !!orgId && enabled,
    staleTime: 15_000,
    queryFn: async () => {
      const r = await growthDb.from("audit_logs").select("id,action,actor_id,target_type,target_id,metadata,created_at").eq("org_id", orgId!).like("action", "org.%").order("created_at", { ascending: false }).limit(60);
      if (r.error) throw r.error;
      return r.data ?? [];
    },
  });
}
