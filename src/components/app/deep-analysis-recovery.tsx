import { useState } from "react";
import { useI18n } from "@/lib/i18n";
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
  const { t, tag } = useI18n();
  const [busyId, setBusyId] = useState<string | null>(null);
  const history = useQuery({
    queryKey: ["officer-deep-analysis-recovery", o.org?.id, o.workspace?.id, o.userId],
    enabled: !!o.org?.id && !!o.workspace?.id && !!o.userId,
    queryFn: async () => {
      if (!o.org || !o.workspace) return [];
      const r = await supabase
        .from("coordinated_analyses")
        .select("id,input,status,error,created_at,lease_expires_at")
        .eq("org_id", o.org.id)
        .eq("workspace_id", o.workspace.id)
        .eq("user_id", o.userId)
        .neq("status", "succeeded")
        .order("created_at", { ascending: false })
        .limit(20);
      if (r.error) throw r.error;
      return (r.data ?? [])
        .filter((row) => {
          const savedInput = row.input;
          return (
            typeof savedInput === "object" &&
            savedInput !== null &&
            !Array.isArray(savedInput) &&
            savedInput["mode"] === "auto"
          );
        })
        .slice(0, 5);
    },
    refetchInterval: 30_000,
  });
  async function recoverRow(row: NonNullable<typeof history.data>[number]) {
    if (!o.org || !o.workspace || busyId) return;
    setBusyId(row.id);
    try {
      const result = await recover({
        data: {
          orgId: o.org.id,
          workspaceId: o.workspace.id,
          analysisId: row.id,
          close: new Date(row.lease_expires_at).getTime() <= Date.now(),
        },
      });
      if (!result.ok) toast.error(result.error);
      else if (result.data.status === "succeeded") toast.success(t("officer.deep.recovered"));
      else if (result.data.pending > 0) toast.info(t("officer.deep.reconciling"));
      else toast.success(t("officer.deep.checked"));
    } catch {
      toast.error(t("officer.deep.unconfirmed"));
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
  return (
    <section className="mt-5 rounded-lg border border-border p-3">
      <h2 className="text-sm font-semibold">{t("officer.deep.title")}</h2>
      {history.isError ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-destructive">
          <p role="alert">{t("officer.deep.statusFailed")}</p>
          <Button size="sm" variant="outline" onClick={() => history.refetch()}>
            {t("officer.deep.retryStatus")}
          </Button>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          {pending.map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-2"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium">
                  {row.status === "running" && new Date(row.lease_expires_at).getTime() > Date.now()
                    ? t("officer.deep.running")
                    : t("officer.deep.needsRecon")}
                </p>
                <p className="mt-1 text-2xs text-muted-foreground">
                  {new Date(row.created_at).toLocaleString(tag)}
                  {row.error ? ` · ${row.error}` : ""}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  !!busyId ||
                  (row.status === "running" &&
                    new Date(row.lease_expires_at).getTime() > Date.now())
                }
                onClick={() => recoverRow(row)}
              >
                <RotateCcw className="mr-1 h-3.5 w-3.5" />
                {busyId === row.id
                  ? t("officer.deep.checking")
                  : row.status === "running" &&
                      new Date(row.lease_expires_at).getTime() > Date.now()
                    ? t("officer.deep.waiting")
                    : t("officer.recover")}
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
