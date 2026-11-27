import { collectPages } from "@/lib/pagination";
import {
  growthDb,
  retryUnlessNotInstalled,
  type CampaignSpendRow,
  type TaskReplanDecisionRow,
  type TaskReplanProposalRow,
} from "@/lib/pending-schema";

export type ReplanData = { proposals: TaskReplanProposalRow[]; decisions: TaskReplanDecisionRow[] };

/** Re-planning proposals (newest 200) and their decisions for one business, under the caller's RLS. */
export function replanOptions(orgId: string | undefined, wsId: string | undefined) {
  return {
    queryKey: ["task-replan", orgId, wsId],
    enabled: !!orgId && !!wsId,
    retry: retryUnlessNotInstalled,
    queryFn: async (): Promise<ReplanData> => {
      if (!orgId || !wsId) throw new Error("Choose a workspace");
      const p = await growthDb
        .from("task_replan_proposals")
        .select("*")
        .eq("org_id", orgId)
        .eq("workspace_id", wsId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (p.error) throw p.error;
      const ids = (p.data ?? []).map((x) => x.id);
      if (!ids.length) return { proposals: [], decisions: [] };
      const d = await growthDb
        .from("task_replan_decisions")
        .select("*")
        .eq("org_id", orgId)
        .eq("workspace_id", wsId)
        .in("proposal_id", ids)
        .order("created_at", { ascending: true })
        .limit(1000);
      if (d.error) throw d.error;
      return { proposals: p.data ?? [], decisions: d.data ?? [] };
    },
  };
}

/** Every campaign spend entry of one business (ID keyset pages, fails closed). */
export function campaignSpendOptions(orgId: string | undefined, wsId: string | undefined) {
  return {
    queryKey: ["campaign-spend", orgId, wsId],
    enabled: !!orgId && !!wsId,
    retry: retryUnlessNotInstalled,
    queryFn: async (): Promise<CampaignSpendRow[]> => {
      if (!orgId || !wsId) throw new Error("Choose a workspace");
      const watermark = new Date().toISOString();
      return collectPages<CampaignSpendRow>(async (cursor, size) => {
        let q = growthDb
          .from("campaign_spend_entries")
          .select("*")
          .eq("org_id", orgId)
          .eq("workspace_id", wsId)
          .lte("created_at", watermark)
          .order("id")
          .limit(size);
        if (cursor) q = q.gt("id", cursor);
        return q;
      });
    },
  };
}
