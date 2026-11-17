import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { useOrg } from "@/lib/org-context";
import { supabase } from "@/integrations/supabase/client";
import { recoverCoordinatedAnalysis } from "@/lib/ai.functions";
import { Button } from "@/components/ui/button";

export function DeepAnalysisRecovery() {
  const o = useOrg();
  const qc = useQueryClient();
  const recover = useServerFn(recoverCoordinatedAnalysis);
  const [busyId, setBusyId] = useState<string | null>(null);
  const history = useQuery({
    queryKey: ["officer-deep-analysis-recovery", o.org?.id, o.workspace?.id, o.userId],
    enabled: !!o.org?.id && !!o.workspace?.id && !!o.userId,
    queryFn: async () => {
      if (!o.org || !o.workspace) return [];
      const r = await supabase.from("coordinated_analyses")
        .select("id,status,error,created_at,lease_expires_at")
        .eq("org_id", o.org.id).eq("workspace_id", o.workspace.id).eq("user_id", o.userId)
        .neq("status", "succeeded").order("created_at", { ascending: false }).limit(5);
      if (r.error) throw r.error;
      return r.data ?? [];
    },
    refetchInterval: 30_000,
  });
  async function recoverRow(row: NonNullable<typeof history.data>[number]) {
    if (!o.org || !o.workspace || busyId) return;
    setBusyId(row.id);
    try {
      const result = await recover({ data: {
        orgId: o.org.id, workspaceId: o.workspace.id, analysisId: row.id,
        close: new Date(row.lease_expires_at).getTime() <= Date.now(),
      } });
      if (!result.ok) toast.error(result.error);
      else if (result.data.status === "succeeded") toast.success("Saved Growth Officer analysis recovered. Open it from conversation history.");
      else if (result.data.pending > 0) toast.info("The analysis is still reconciling. No new AI request was started.");
      else toast.success("Saved analysis checked. No duplicate AI request was started.");
    } catch {
      toast.error("Recovery could not be confirmed. No new AI request was started.");
    } finally {
      setBusyId(null);
      await history.refetch();
      await qc.invalidateQueries({ queryKey: ["convs"] });
      await qc.invalidateQueries({ queryKey: ["msgs"] });
      await qc.invalidateQueries({ queryKey: ["billing"] });
      await qc.invalidateQueries({ queryKey: ["coordination"] });
      await qc.invalidateQueries({ queryKey: ["overview"] });
      await qc.invalidateQueries({ queryKey: ["command-center"] });
      await qc.invalidateQueries({ queryKey: ["notification-center"] });
    }
  }
  const pending = (history.data ?? []).slice(0, 3);
  if (history.isLoading || (!pending.length && !history.isError)) return null;
  return <section className="mt-5 rounded-lg border border-border p-3">
    <h2 className="text-sm font-semibold">Saved deep analysis</h2>
    {history.isError
      ? <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-destructive"><p role="alert">Recovery status could not be checked. Avoid repeating a request until its saved status is clear.</p><Button size="sm" variant="outline" onClick={() => history.refetch()}>Retry status check</Button></div>
      : <div className="mt-2 space-y-2">{pending.map(row => <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-2">
          <div className="min-w-0"><p className="text-xs font-medium">{row.status === "running" && new Date(row.lease_expires_at).getTime() > Date.now() ? "Deep analysis is still running" : "Analysis needs reconciliation"}</p><p className="mt-1 text-[10px] text-muted-foreground">{new Date(row.created_at).toLocaleString()}{row.error ? ` · ${row.error}` : ""}</p></div>
          <Button size="sm" variant="outline" disabled={!!busyId || (row.status === "running" && new Date(row.lease_expires_at).getTime() > Date.now())} onClick={() => recoverRow(row)}><RotateCcw className="mr-1 h-3.5 w-3.5" />{busyId === row.id ? "Checking…" : row.status === "running" && new Date(row.lease_expires_at).getTime() > Date.now() ? "Waiting for safe recovery" : "Recover saved work"}</Button>
        </div>)}</div>}
  </section>;
}
