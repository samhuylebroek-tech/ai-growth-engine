// Observations and lifecycle history for the business's experiments (proposal 0079), read under caller RLS and
// keyed by organization and business so a switch never shows another business's results.
import { queryOptions } from "@tanstack/react-query";
import { growthDb, isNotInstalled, type ExperimentEventRow, type ExperimentObservationRow } from "@/lib/pending-schema";

export type ExperimentDetail = {
  observations: Record<string, ExperimentObservationRow[]>;
  events: Record<string, ExperimentEventRow[]>;
  installed: boolean;
  truncated: boolean;
};

const LIMIT = 1000;
export const experimentDetailKey = (org: string | undefined, ws: string | undefined) => ["experiment-detail", org ?? "", ws ?? ""] as const;

export function experimentDetailOptions(org: string | undefined, ws: string | undefined) {
  return queryOptions({
    queryKey: experimentDetailKey(org, ws),
    enabled: !!org && !!ws,
    queryFn: async (): Promise<ExperimentDetail> => {
      const [o, e] = await Promise.all([
        growthDb.from("experiment_observations").select("*").eq("org_id", org!).eq("workspace_id", ws!).order("created_at", { ascending: false }).limit(LIMIT),
        growthDb.from("experiment_events").select("*").eq("org_id", org!).eq("workspace_id", ws!).order("created_at", { ascending: true }).limit(LIMIT),
      ]);
      if ((o.error && isNotInstalled(o.error)) || (e.error && isNotInstalled(e.error))) return { observations: {}, events: {}, installed: false, truncated: false };
      if (o.error) throw o.error;
      if (e.error) throw e.error;
      const group = <T extends { experiment_id: string }>(rows: T[]) =>
        rows.reduce<Record<string, T[]>>((m, r) => ((m[r.experiment_id] ??= []).push(r), m), {});
      return { observations: group(o.data ?? []), events: group(e.data ?? []), installed: true, truncated: (o.data?.length ?? 0) >= LIMIT || (e.data?.length ?? 0) >= LIMIT };
    },
  });
}
