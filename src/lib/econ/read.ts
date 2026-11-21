// Caller-RLS reads for growth economics, scoped to one organization and business. Shared by the Growth economics
// page, the Growth Officer context, Home signals and reports, so every screen and the AI read the same records.
// Every read reports whether it was complete (row count within the read limit); an incomplete read is listed, never
// silently totalled. AI credits come from the usage ledger (every chargeable AI call, once); campaign credits come
// from the task runs and reviews that name a campaign's task.
import type { BusinessCostModelRow, BusinessCostRow, CampaignBudgetAllocationRow, CampaignSpendRow, PendingDatabase, RecommendationLearningRow } from "@/lib/pending-schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RevenueEvent, Touch } from "@/lib/bi/attribution";
import type { EconCredit } from "@/lib/econ/rollup";
import type { PriceVersion } from "@/lib/econ/credit-pricing";

export const ECON_LIMIT = 5000;
const MISSING = new Set(["42P01", "42703", "PGRST200", "PGRST202", "PGRST204", "PGRST205"]);
export const econNotInstalled = (e: unknown) => typeof e === "object" && e !== null && MISSING.has(String((e as { code?: unknown }).code ?? ""));

export type EconCampaignRow = { id: string; title: string; status: string; goal_id: string | null; initiative_id: string | null; strategy_id: string | null; channels: string[]; end_date?: string | null };
export type EconBudgetLine = { id: string; channel: string; period_month: string; planned: number | string; currency: string; goal_id: string | null; initiative_id: string | null; note?: string | null; created_at?: string | null };
export type EconUsage = { at: string; credits: number; agent_key: string };
export type EconProposal = { id: string; title: string; status: string; outcome: string | null; measure_after: string | null; campaign_id: string | null; category: string; created_at: string; decided_at: string | null; task_id: string | null; metric_id: string | null; success_measure?: string };
export type EconRequest = { id: string; status: string; kind: string; campaign_id: string; decided_at: string | null; created_at: string };
export type EconData = {
  campaigns: EconCampaignRow[]; budgetLines: EconBudgetLine[]; allocations: CampaignBudgetAllocationRow[]; spend: (CampaignSpendRow & { category?: string })[];
  costs: BusinessCostRow[]; models: BusinessCostModelRow[]; revenue: RevenueEvent[]; touches: Touch[];
  /** Credits of campaign work (task runs and their reviews), by campaign. */
  credits: (EconCredit & { at: string })[];
  /** Every charged AI call of this business (usage ledger). */
  usage: EconUsage[];
  prices: PriceVersion[]; planKey: string | null;
  initiatives: { id: string; title: string }[]; strategies: { id: string; summary: string }[]; goals: { id: string; title: string }[];
  learnings: RecommendationLearningRow[]; proposals: EconProposal[]; requests: EconRequest[];
  incomplete: string[]; costsInstalled: boolean;
};
type R = { data: unknown; error: { code?: string; message?: string } | null; count?: number | null };
const rows = <T>(r: R) => (r.data ?? []) as T[];
type Q = { eq(c: string, v: string): Q; limit(n: number): Q; order(c: string, o?: { ascending: boolean }): Q } & PromiseLike<R>;

export async function readEconData(client: unknown, orgId: string, wsId: string): Promise<EconData> {
  const db = client as SupabaseClient<PendingDatabase>;
  const from = (t: string, cols: string) => (db as unknown as { from(t: string): { select(c: string, o?: { count: "exact" }): Q } }).from(t).select(cols, { count: "exact" });
  const sc = (t: string, cols: string) => from(t, cols).eq("org_id", orgId).eq("workspace_id", wsId);
  const L = ECON_LIMIT;
  const [campaigns, lines, allocations, spend, costs, models, revenue, touches, runs, tasks, reviews, usage, prices, sub, initiatives, strategies, goals, learnings, proposals, requests] = await Promise.all([
    sc("campaigns", "id,title,status,goal_id,initiative_id,strategy_id,channels,end_date").limit(L),
    sc("budget_lines", "id,channel,period_month,planned,currency,goal_id,initiative_id,note,created_at").limit(L),
    sc("campaign_budget_allocations", "*").limit(L),
    sc("campaign_spend_entries", "*").limit(L),
    sc("business_cost_entries", "*").order("created_at", { ascending: false }).limit(L),
    sc("business_cost_models", "*").order("effective_from").limit(200),
    sc("revenue_events", "*").limit(L),
    sc("attribution_touchpoints", "id,revenue_event_id,campaign_id,initiative_id,channel,touched_at,evidence,retracted_at").limit(L * 2),
    sc("task_runs", "id,task_id,status,estimated_credits,credits_charged,agent_run_id,created_at,finished_at").limit(L),
    sc("tasks", "id,campaign_id").limit(L),
    sc("specialist_reviews", "task_run_id,credits,created_at").limit(L),
    from("ai_usage_events", "credits_charged,created_at,run_id,agent_runs!inner(workspace_id,agent_key)").eq("org_id", orgId).eq("agent_runs.workspace_id", wsId).limit(L),
    (db as unknown as { rpc(n: string): PromiseLike<R> }).rpc("credit_prices_in_effect"),
    (db as unknown as { from(t: string): { select(c: string): { eq(c: string, v: string): { maybeSingle(): PromiseLike<R> } } } }).from("subscriptions").select("plan_key").eq("org_id", orgId).maybeSingle(),
    sc("growth_initiatives", "id,title").limit(2000),
    sc("growth_strategies", "id,summary").limit(500),
    sc("growth_goals", "id,title").limit(500),
    sc("recommendation_learnings", "*").limit(L),
    sc("optimization_proposals", "id,title,status,outcome,measure_after,campaign_id,category,created_at,decided_at,task_id,metric_id,success_measure").order("created_at", { ascending: false }).limit(L),
    sc("budget_change_requests", "id,status,kind,campaign_id,decided_at,created_at").order("created_at", { ascending: false }).limit(500),
  ]) as unknown as R[];
  // proposal 0085/0086 tables are optional: an environment without them shows campaign figures only
  const optional = [costs, models, learnings];
  const costsInstalled = !optional.some((r) => r!.error && econNotInstalled(r!.error));
  for (const r of [campaigns, lines, allocations, spend, revenue, touches, runs, tasks, reviews, usage, sub, initiatives, strategies, goals, proposals, requests]) if (r!.error) throw r!.error;
  for (const r of optional) if (r!.error && !econNotInstalled(r!.error)) throw r!.error;
  if (prices!.error && !econNotInstalled(prices!.error)) throw prices!.error;
  const incomplete: string[] = [];
  const check = (name: string, r: R, limit = L) => { if ((r.count ?? 0) > limit) incomplete.push(name); };
  check("campaigns", campaigns!); check("budget", lines!); check("allocations", allocations!); check("spend", spend!); check("costs", costs!); check("revenue", revenue!);
  check("touches", touches!, L * 2); check("runs", runs!); check("tasks", tasks!); check("reviews", reviews!); check("usage", usage!); check("learnings", learnings!); check("proposals", proposals!);
  const campaignOf = new Map(rows<{ id: string; campaign_id: string | null }>(tasks!).map((t) => [t.id, t.campaign_id]));
  const runRows = rows<{ id: string; task_id: string; status: string; estimated_credits: number; credits_charged: number | null; created_at: string; finished_at: string | null }>(runs!);
  const runCampaign = new Map(runRows.map((r) => [r.id, campaignOf.get(r.task_id) ?? null]));
  const NOCHARGE = ["failed", "cancelled", "rejected"];
  const credits: EconData["credits"] = [
    ...runRows.map((r) => ({
      campaign_id: campaignOf.get(r.task_id) ?? null, at: r.finished_at ?? r.created_at,
      credits: r.credits_charged ?? (NOCHARGE.includes(r.status) ? 0 : r.estimated_credits),
      state: (r.credits_charged !== null || NOCHARGE.includes(r.status) ? "charged" : r.status === "uncertain" ? "uncertain" : "pending") as EconCredit["state"],
    })),
    ...rows<{ task_run_id: string; credits: number | null; created_at: string }>(reviews!).map((v) => ({ campaign_id: runCampaign.get(v.task_run_id) ?? null, at: v.created_at, credits: v.credits ?? 0, state: "charged" as const })),
  ];
  const usageRows = rows<{ credits_charged: number; created_at: string; agent_runs: { agent_key: string } | null }>(usage!)
    .map((u) => ({ at: u.created_at, credits: Number(u.credits_charged) || 0, agent_key: u.agent_runs?.agent_key ?? "unknown" }));
  const priceRows = prices!.error ? [] : rows<PriceVersion>(prices!);
  return {
    campaigns: rows(campaigns!), budgetLines: rows(lines!), allocations: rows(allocations!), spend: rows(spend!),
    costs: costsInstalled ? rows(costs!) : [], models: costsInstalled ? rows(models!) : [],
    revenue: rows(revenue!), touches: rows(touches!), credits, usage: usageRows, prices: priceRows,
    planKey: (sub!.data as { plan_key?: string } | null)?.plan_key ?? null,
    initiatives: rows(initiatives!), strategies: rows(strategies!), goals: rows(goals!), learnings: costsInstalled ? rows(learnings!) : [],
    proposals: rows(proposals!), requests: rows(requests!), incomplete, costsInstalled,
  };
}
