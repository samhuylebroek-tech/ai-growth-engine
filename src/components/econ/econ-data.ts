// Browser query options for growth economics; the reads themselves are shared in src/lib/econ/read.ts.
import { growthDb, retryUnlessNotInstalled } from "@/lib/pending-schema";
import { econNotInstalled, readEconData } from "@/lib/econ/read";
import type { PriceVersion } from "@/lib/econ/credit-pricing";
export type { EconCampaignRow, EconData } from "@/lib/econ/read";

export const econKey = (orgId?: string, wsId?: string) => ["growth-economics", orgId, wsId] as const;
export function econOptions(orgId: string | undefined, wsId: string | undefined) {
  return {
    queryKey: econKey(orgId, wsId), enabled: !!orgId && !!wsId, staleTime: 20_000, retry: retryUnlessNotInstalled,
    queryFn: () => { if (!orgId || !wsId) throw new Error("Choose a business"); return readEconData(growthDb, orgId, wsId); },
  };
}

/** Credit prices that apply to this organization (platform price and its own plan), for valuing AI credits. */
export function creditPriceOptions(orgId: string | undefined) {
  return {
    queryKey: ["credit-prices-in-effect", orgId] as const, enabled: !!orgId, staleTime: 60_000, retry: retryUnlessNotInstalled,
    queryFn: async () => {
      const db = growthDb as unknown as { rpc(n: string): PromiseLike<{ data: unknown; error: { code?: string } | null }>; from(t: string): { select(c: string): { eq(c: string, v: string): { maybeSingle(): PromiseLike<{ data: unknown; error: unknown }> } } } };
      const [p, sub] = await Promise.all([db.rpc("credit_prices_in_effect"), db.from("subscriptions").select("plan_key").eq("org_id", orgId!).maybeSingle()]);
      if (sub.error) throw sub.error;
      const prices = p.error ? (econNotInstalled(p.error) ? [] : (() => { throw p.error; })()) : ((p.data ?? []) as PriceVersion[]);
      return { prices, planKey: (sub.data as { plan_key?: string } | null)?.plan_key ?? null };
    },
  };
}
