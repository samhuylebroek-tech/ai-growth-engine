// Caller-RLS reads for growth economics, scoped to the active organization and business. Every read reports whether
// it was complete (row count within the read limit); an incomplete read is shown, never silently totalled.
import { supabase } from "@/integrations/supabase/client";
import { growthDb, isNotInstalled, retryUnlessNotInstalled, type BusinessCostModelRow, type BusinessCostRow, type CampaignBudgetAllocationRow,
  type CampaignSpendRow, type CreditPriceVersionRow, type RecommendationLearningRow } from "@/lib/pending-schema";
import type { RevenueEvent, Touch } from "@/lib/bi/attribution";
import type { EconCredit } from "@/lib/econ/rollup";

const LIMIT = 5000;
export type EconCampaignRow = { id: string; title: string; status: string; goal_id: string | null; initiative_id: string | null; strategy_id: string | null; channels: string[] };
export type EconData = {
  campaigns: EconCampaignRow[]; allocations: CampaignBudgetAllocationRow[]; spend: (CampaignSpendRow & { category?: string })[];
  costs: BusinessCostRow[]; models: BusinessCostModelRow[]; revenue: RevenueEvent[]; touches: Touch[];
  credits: (EconCredit & { at: string })[]; prices: CreditPriceVersionRow[]; planKey: string | null;
  initiatives: { id: string; title: string }[]; strategies: { id: string; summary: string }[]; goals: { id: string; title: string }[];
  learnings: RecommendationLearningRow[];
  incomplete: string[]; costsInstalled: boolean;
};
type R = { data: unknown; error: { code?: string; message?: string } | null; count?: number | null };
const rows = <T>(r: R) => (r.data ?? []) as T[];

export const econKey = (orgId?: string, wsId?: string) => ["growth-economics", orgId, wsId] as const;
export function econOptions(orgId: string | undefined, wsId: string | undefined) {
  return {
    queryKey: econKey(orgId, wsId), enabled: !!orgId && !!wsId, staleTime: 20_000, retry: retryUnlessNotInstalled,
    queryFn: async (): Promise<EconData> => {
      if (!orgId || !wsId) throw new Error("Choose a business");
      const sc = <Q extends { eq(c: string, v: string): Q }>(q: Q) => q.eq("org_id", orgId).eq("workspace_id", wsId);
      const [campaigns, allocations, spend, costs, models, revenue, touches, runs, tasks, reviews, prices, sub, initiatives, strategies, goals, learnings] = await Promise.all([
        sc(supabase.from("campaigns").select("id,title,status,goal_id,initiative_id,strategy_id,channels", { count: "exact" })).limit(LIMIT),
        sc(growthDb.from("campaign_budget_allocations").select("*", { count: "exact" })).limit(LIMIT),
        sc(growthDb.from("campaign_spend_entries").select("*", { count: "exact" })).limit(LIMIT),
        sc(growthDb.from("business_cost_entries").select("*", { count: "exact" })).order("created_at", { ascending: false }).limit(LIMIT),
        sc(growthDb.from("business_cost_models").select("*")).order("effective_from").limit(200),
        sc(growthDb.from("revenue_events").select("*", { count: "exact" })).limit(LIMIT),
        sc(growthDb.from("attribution_touchpoints").select("id,revenue_event_id,campaign_id,initiative_id,channel,touched_at,evidence,retracted_at", { count: "exact" })).limit(LIMIT * 2),
        sc(growthDb.from("task_runs").select("id,task_id,status,estimated_credits,credits_charged,created_at,finished_at", { count: "exact" })).limit(LIMIT),
        sc(supabase.from("tasks").select("id,campaign_id", { count: "exact" })).limit(LIMIT),
        sc(growthDb.from("specialist_reviews").select("task_run_id,credits,created_at", { count: "exact" })).limit(LIMIT),
        growthDb.from("credit_price_versions").select("*").order("effective_from").limit(500),
        supabase.from("subscriptions").select("plan_key").eq("org_id", orgId).maybeSingle(),
        sc(growthDb.from("growth_initiatives").select("id,title")).limit(2000),
        sc(growthDb.from("growth_strategies").select("id,summary")).limit(500),
        sc(supabase.from("growth_goals").select("id,title")).limit(500),
        sc(growthDb.from("recommendation_learnings").select("*", { count: "exact" })).limit(LIMIT),
      ]) as unknown as R[];
      const optional = [costs, models, prices, learnings];
      const costsInstalled = !optional.some((r) => r!.error && isNotInstalled(r!.error));
      for (const r of [campaigns, allocations, spend, revenue, touches, runs, tasks, reviews, sub, initiatives, strategies, goals]) if (r!.error) throw r!.error;
      for (const r of optional) if (r!.error && !isNotInstalled(r!.error)) throw r!.error;
      const incomplete: string[] = [];
      const check = (name: string, r: R, limit = LIMIT) => { if ((r.count ?? 0) > limit) incomplete.push(name); };
      check("campaigns", campaigns!); check("allocations", allocations!); check("spend", spend!); check("costs", costs!); check("revenue", revenue!);
      check("touches", touches!, LIMIT * 2); check("runs", runs!); check("tasks", tasks!); check("reviews", reviews!); check("learnings", learnings!);
      const campaignOf = new Map(rows<{ id: string; campaign_id: string | null }>(tasks!).map((t) => [t.id, t.campaign_id]));
      const runRows = rows<{ id: string; task_id: string; status: string; estimated_credits: number; credits_charged: number | null; created_at: string; finished_at: string | null }>(runs!);
      const runCampaign = new Map(runRows.map((r) => [r.id, campaignOf.get(r.task_id) ?? null]));
      const credits: EconData["credits"] = [
        ...runRows.map((r) => ({
          campaign_id: campaignOf.get(r.task_id) ?? null, at: r.finished_at ?? r.created_at,
          credits: r.credits_charged ?? (["failed", "cancelled", "rejected", "uncertain"].includes(r.status) ? 0 : r.estimated_credits),
          state: (r.credits_charged !== null ? "charged" : r.status === "uncertain" ? "uncertain" : ["failed", "cancelled", "rejected"].includes(r.status) ? "charged" : "pending") as EconCredit["state"],
        })),
        ...rows<{ task_run_id: string; credits: number | null; created_at: string }>(reviews!).map((v) => ({ campaign_id: runCampaign.get(v.task_run_id) ?? null, at: v.created_at, credits: v.credits ?? 0, state: "charged" as const })),
      ];
      return {
        campaigns: rows(campaigns!), allocations: rows(allocations!), spend: rows(spend!), costs: costsInstalled ? rows(costs!) : [], models: costsInstalled ? rows(models!) : [],
        revenue: rows(revenue!), touches: rows(touches!), credits, prices: costsInstalled ? rows(prices!) : [], planKey: (sub!.data as { plan_key?: string } | null)?.plan_key ?? null,
        initiatives: rows(initiatives!), strategies: rows(strategies!), goals: rows(goals!), learnings: costsInstalled ? rows(learnings!) : [], incomplete, costsInstalled,
      };
    },
  };
}
