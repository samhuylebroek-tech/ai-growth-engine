// Reads for the Organization overview: every query runs as the signed-in user (RLS), filtered to the organization
// and to the businesses the user can open, so totals only ever cover visible businesses. Bounded reads fail closed
// (an incomplete read is an error, never a silently smaller total).
import { queryOptions } from "@tanstack/react-query";
import { growthDb, isNotInstalled, retryUnlessNotInstalled } from "@/lib/pending-schema";

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

export async function fetchOrgOverview(org: string, ids: readonly string[], from: string, month: string) {
      const ws = [...ids];
      const c = { count: "exact" as const };
      const [profiles, goals, campaigns, tasks, budget, openRuns, monthRuns, approvals, initiatives, revenue, units, allocations, rates] = await Promise.all([
        growthDb.from("business_profiles").select("*").eq("org_id", org).in("workspace_id", ws),
        growthDb.from("growth_goals").select("*", c).eq("org_id", org).in("workspace_id", ws).neq("status", "archived").limit(ORG_LIMIT),
        growthDb.from("campaigns").select("*", c).eq("org_id", org).in("workspace_id", ws).neq("status", "archived").limit(ORG_LIMIT),
        growthDb.from("tasks").select("id,workspace_id,title,status,due_date", c).eq("org_id", org).in("workspace_id", ws).not("status", "in", "(done,cancelled)").limit(ORG_LIMIT),
        growthDb.from("budget_lines").select("*", c).eq("org_id", org).in("workspace_id", ws).eq("period_month", month).limit(ORG_LIMIT),
        growthDb.from("task_runs").select("id,workspace_id,status,specialist_key,estimated_credits,credits_charged,created_at", c).eq("org_id", org).in("workspace_id", ws).in("status", OPEN_RUNS).limit(ORG_LIMIT),
        growthDb.from("task_runs").select("id,workspace_id,status,specialist_key,estimated_credits,credits_charged,created_at", c).eq("org_id", org).in("workspace_id", ws).gte("created_at", `${month}T00:00:00Z`).limit(ORG_LIMIT),
        growthDb.from("approvals").select("id,workspace_id", c).eq("org_id", org).in("workspace_id", ws).eq("status", "pending").limit(ORG_LIMIT),
        growthDb.from("growth_initiatives").select("id,workspace_id,status", c).eq("org_id", org).in("workspace_id", ws).eq("status", "in_progress").limit(ORG_LIMIT),
        growthDb.from("revenue_events").select("*", c).eq("org_id", org).in("workspace_id", ws).gte("occurred_at", `${from}T00:00:00Z`).limit(ORG_LIMIT),
        growthDb.from("business_units").select("*").eq("org_id", org).in("workspace_id", ws).eq("archived", false).limit(500),
        growthDb.from("specialist_allocations").select("*").eq("org_id", org).in("workspace_id", ws).limit(1000),
        growthDb.from("exchange_rates").select("*").eq("org_id", org).order("rate_date", { ascending: false }).limit(500),
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
      };
}
export type OrgOverviewData = Awaited<ReturnType<typeof fetchOrgOverview>>;
