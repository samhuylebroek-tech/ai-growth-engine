// Browser query options for growth economics; the reads themselves are shared in src/lib/econ/read.ts.
import { growthDb, retryUnlessNotInstalled } from "@/lib/pending-schema";
import { readEconData } from "@/lib/econ/read";
export type { EconCampaignRow, EconData } from "@/lib/econ/read";

export const econKey = (orgId?: string, wsId?: string) => ["growth-economics", orgId, wsId] as const;
export function econOptions(orgId: string | undefined, wsId: string | undefined) {
  return {
    queryKey: econKey(orgId, wsId), enabled: !!orgId && !!wsId, staleTime: 20_000, retry: retryUnlessNotInstalled,
    queryFn: () => { if (!orgId || !wsId) throw new Error("Choose a business"); return readEconData(growthDb, orgId, wsId); },
  };
}
