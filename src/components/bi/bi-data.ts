// Caller-RLS reads for business performance intelligence. One shared query per workspace; fails closed when a
// required read fails, so partial data is never shown as a complete overview.
import { supabase } from "@/integrations/supabase/client";
import { growthDb, isNotInstalled, retryUnlessNotInstalled } from "@/lib/pending-schema";
import type { BiData } from "@/lib/bi/view";

const LIMIT = 3000;
export const biKey = (orgId?: string, wsId?: string) =>
  ["business-intelligence", orgId, wsId] as const;

type R = { data: unknown; error: unknown; count?: number | null };
const rows = <T>(r: R) => (r.data ?? []) as T[];

export function biOptions(orgId: string | undefined, wsId: string | undefined) {
  return {
    queryKey: biKey(orgId, wsId),
    enabled: !!orgId && !!wsId,
    staleTime: 20_000,
    retry: retryUnlessNotInstalled,
    queryFn: async (): Promise<BiData> => {
      if (!orgId || !wsId) throw new Error("Choose a workspace");
      const sc = <Q extends { eq(c: string, v: string): Q }>(q: Q) =>
        q.eq("org_id", orgId).eq("workspace_id", wsId);
      const [
        metrics,
        revenue,
        touches,
        units,
        goals,
        plans,
        initiatives,
        campaigns,
        budget,
        deals,
        tasks,
        runs,
        experiments,
        proposals,
        profile,
        facts,
        connections,
      ] = await Promise.all([
        sc(
          growthDb
            .from("metric_definitions")
            .select(
              "id,key,label,unit,currency,direction,goal_id,initiative_id,campaign_id,unit_id,channel,category,archived",
            ),
        ).limit(500),
        sc(growthDb.from("revenue_events").select("*", { count: "exact" }))
          .order("occurred_at", { ascending: false })
          .limit(LIMIT),
        sc(
          growthDb
            .from("attribution_touchpoints")
            .select(
              "id,revenue_event_id,campaign_id,initiative_id,channel,touched_at,evidence,retracted_at",
              { count: "exact" },
            ),
        ).limit(LIMIT * 2),
        sc(growthDb.from("business_units").select("id,kind,name,parent_id,archived")).limit(200),
        sc(
          supabase
            .from("growth_goals")
            .select(
              "id,title,objective,metric,baseline,target,current_value,due_date,priority,status,created_at",
            ),
        ).limit(500),
        sc(
          growthDb
            .from("growth_plan_versions")
            .select("id,goal_id,title,version,status,approved_at,created_at"),
        ).limit(500),
        sc(
          growthDb
            .from("growth_initiatives")
            .select("id,plan_version_id,title,channel,project_id,created_at"),
        ).limit(1000),
        sc(
          supabase
            .from("campaigns")
            .select("id,title,objective,goal_id,budget_eur,start_date,end_date,created_at,status"),
        )
          .neq("status", "archived")
          .limit(500),
        sc(
          growthDb
            .from("budget_lines")
            .select("goal_id,initiative_id,channel,period_month,planned,actual,currency"),
        ).limit(LIMIT),
        sc(
          supabase.from("crm_deals").select("stage,value,currency,created_at,closed_at,goal_id"),
        ).limit(LIMIT),
        sc(
          supabase
            .from("tasks")
            .select("id,title,project_id,campaign_id,status,updated_at,created_at"),
        ).limit(LIMIT),
        sc(
          growthDb
            .from("task_runs")
            .select("task_id,specialist_key,status,credits_charged,created_at,finished_at"),
        )
          .order("created_at", { ascending: false })
          .limit(LIMIT),
        sc(growthDb.from("growth_experiments").select("*"))
          .order("created_at", { ascending: false })
          .limit(300),
        sc(growthDb.from("optimization_proposals").select("*"))
          .order("created_at", { ascending: false })
          .limit(300),
        sc(
          supabase
            .from("business_profiles")
            .select(
              "business_model,description,industry,offerings,audiences,objectives,monthly_budget_eur",
            ),
        ).maybeSingle(),
        sc(supabase.from("business_facts").select("key,value,verified")).limit(200),
        sc(
          growthDb.from("connector_connections").select("connector_key,status,granted_levels"),
        ).limit(200),
      ]);
      const required = [
        metrics,
        revenue,
        touches,
        units,
        goals,
        plans,
        initiatives,
        campaigns,
        budget,
        deals,
        tasks,
        runs,
        experiments,
        proposals,
        profile,
        facts,
        connections,
      ] as R[];
      for (const r of required) if (r.error) throw r.error;
      if ((revenue as R).count && (revenue as R).count! > LIMIT) throw new Error("too_many");
      if ((touches as R).count && (touches as R).count! > LIMIT * 2) throw new Error("too_many");
      const ids = rows<{ id: string }>(initiatives as R).map((i) => i.id);
      const ops = ids.length
        ? await growthDb
            .from("growth_initiative_operations")
            .select(
              "initiative_id,success_metric,baseline_value,target_value,current_value,due_date",
            )
            .in("initiative_id", ids.slice(0, 500))
        : { data: [], error: null };
      if (ops.error) throw ops.error;
      const metricIds = rows<{ id: string }>(metrics as R).map((m) => m.id);
      const meas = metricIds.length
        ? await growthDb
            .from("performance_measurements")
            .select("id,metric_id,kind,period_start,period_end,value,corrects_id,created_at,source")
            .eq("workspace_id", wsId)
            .in("metric_id", metricIds)
            .order("period_start", { ascending: false })
            .limit(5000)
        : { data: [], error: null };
      if (meas.error) throw meas.error;
      // Optional: opportunities and the credit balance never block the overview.
      const opp = await growthDb
        .from("growth_opportunities")
        .select("id,title,status,impact,feasibility,risk,time_to_value,confidence")
        .eq("org_id", orgId)
        .eq("workspace_id", wsId)
        .in("status", ["open", "shortlisted"])
        .limit(50);
      if (opp.error && !isNotInstalled(opp.error)) throw opp.error;
      const bal = await supabase.rpc("credit_balance", { _org: orgId });
      return {
        metrics: rows(metrics as R),
        measurements: rows(meas as R),
        revenue: rows(revenue as R),
        touches: rows(touches as R),
        units: rows(units as R),
        goals: rows(goals as R),
        plans: rows(plans as R),
        initiatives: rows(initiatives as R),
        operations: rows(ops as R),
        campaigns: rows(campaigns as R),
        budget: rows(budget as R),
        deals: rows(deals as R),
        tasks: rows(tasks as R),
        runs: rows(runs as R),
        experiments: rows(experiments as R),
        proposals: rows(proposals as R),
        opportunities: opp.error ? [] : rows(opp as R),
        profile: ((profile as R).data ?? null) as BiData["profile"],
        facts: rows(facts as R),
        connections: rows(connections as R),
        creditBalance: bal.error ? null : (bal.data as number),
      };
    },
  };
}
