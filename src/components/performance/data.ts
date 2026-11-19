import { queryOptions } from "@tanstack/react-query";
import { growthDb as db, retryUnlessNotInstalled } from "@/lib/pending-schema";
import type { Measurement } from "@/lib/performance";

export type Metric = { id: string; key: string; label: string; unit: string; currency: string | null; direction: string; goal_id: string | null; initiative_id: string | null; archived: boolean; created_at: string };
export type LinkOption = { id: string; title: string };

export const UNITS: Record<string, string> = { count: "Number", currency: "Money", percent: "Percentage", ratio: "Ratio", days: "Days" };
export const errMsg = (e: unknown) => (typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "");

export const metricsOptions = (wsId: string) => queryOptions({
  queryKey: ["metric-definitions", wsId], retry: retryUnlessNotInstalled,
  queryFn: async () => {
    const r = await db.from("metric_definitions").select("id,key,label,unit,currency,direction,goal_id,initiative_id,archived,created_at").eq("workspace_id", wsId).order("created_at").limit(200);
    if (r.error) throw r.error; return r.data as Metric[];
  },
});
export const measurementsOptions = (wsId: string) => queryOptions({
  queryKey: ["performance-measurements", wsId], retry: retryUnlessNotInstalled,
  queryFn: async () => {
    const r = await db.from("performance_measurements").select("id,metric_id,kind,period_start,period_end,value,corrects_id,created_at,note,source").eq("workspace_id", wsId).order("period_start", { ascending: false }).order("created_at", { ascending: false }).limit(2000);
    if (r.error) throw r.error; return r.data as Measurement[];
  },
});
export const goalLinksOptions = (wsId: string) => queryOptions({
  queryKey: ["performance-goal-links", wsId],
  queryFn: async () => {
    const r = await db.from("growth_goals").select("id,title").eq("workspace_id", wsId).neq("status", "archived").order("created_at").limit(100);
    if (r.error) throw r.error; return r.data as LinkOption[];
  },
});
/** Initiatives of approved plans only: drafts and superseded versions are not commitments to measure. */
export const initiativeLinksOptions = (wsId: string) => queryOptions({
  queryKey: ["performance-initiative-links", wsId], retry: retryUnlessNotInstalled,
  queryFn: async () => {
    const r = await db.from("growth_initiatives").select("id,title,status,growth_plan_versions!inner(status)").eq("workspace_id", wsId).eq("growth_plan_versions.status", "approved").neq("status", "cancelled").order("created_at").limit(200);
    if (r.error) throw r.error; return (r.data ?? []).map(i => ({ id: i.id, title: i.title })) as LinkOption[];
  },
});
export const invalidatePerformance = (qc: { invalidateQueries: (f: { queryKey: unknown[] }) => Promise<unknown> }, wsId: string) =>
  Promise.all([qc.invalidateQueries({ queryKey: ["metric-definitions", wsId] }), qc.invalidateQueries({ queryKey: ["performance-measurements", wsId] }), qc.invalidateQueries({ queryKey: ["home-performance", wsId] })]);
