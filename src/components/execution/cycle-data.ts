import {
  growthDb,
  retryUnlessNotInstalled,
  type ExecutionCycleItemRow,
  type ExecutionCycleRow,
} from "@/lib/pending-schema";

export type CycleDue = {
  schedule: "off" | "daily" | "weekdays";
  due: boolean;
  slot?: string;
  last_scheduled?: string | null;
};
export type CycleData = {
  cycles: ExecutionCycleRow[];
  items: ExecutionCycleItemRow[];
  due: CycleDue;
};

/** The last five scheduler cycles with their per-task decisions, and whether a scheduled cycle is due. */
export function cycleOptions(orgId: string | undefined, wsId: string | undefined) {
  return {
    queryKey: ["execution-cycles", orgId, wsId],
    enabled: !!orgId && !!wsId,
    retry: retryUnlessNotInstalled,
    staleTime: 15_000,
    queryFn: async (): Promise<CycleData> => {
      if (!orgId || !wsId) throw new Error("Choose a workspace");
      const [c, d] = await Promise.all([
        growthDb
          .from("execution_cycles")
          .select("*")
          .eq("org_id", orgId)
          .eq("workspace_id", wsId)
          .order("created_at", { ascending: false })
          .limit(5),
        growthDb.rpc("execution_cycle_due", { _workspace: wsId }),
      ]);
      if (c.error) throw c.error;
      if (d.error) throw d.error;
      const ids = (c.data ?? []).map((x) => x.id);
      const items = ids.length
        ? await growthDb
            .from("execution_cycle_items")
            .select("*")
            .eq("workspace_id", wsId)
            .in("cycle_id", ids)
            .order("rank")
            .limit(150)
        : { data: [], error: null };
      if (items.error) throw items.error;
      return { cycles: c.data ?? [], items: items.data ?? [], due: d.data as unknown as CycleDue };
    },
  };
}
