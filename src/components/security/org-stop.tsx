import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { OctagonX, Play } from "lucide-react";
import { growthDb, isNotInstalled, retryUnlessNotInstalled } from "@/lib/pending-schema";
import { Panel } from "@/components/app/status";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";

/**
 * Organization-wide emergency stop (proposal 0088). Everyone in the organization sees an active stop; organization
 * admins start or lift it. The database applies it to every business and refuses a business admin's resume.
 */
export function OrgStop({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const { t, tag } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["execution-stops", orgId],
    retry: retryUnlessNotInstalled,
    queryFn: async () => {
      const r = await growthDb
        .from("execution_stops")
        .select("*")
        .is("ended_at", null)
        .or(`org_id.eq.${orgId},scope.eq.platform`);
      if (r.error) throw r.error;
      return r.data;
    },
  });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  if (q.isError && isNotInstalled(q.error)) return null;
  if (!q.data) return null;
  const orgStop = q.data.find((s) => s.scope === "organization");
  const platform = q.data.find((s) => s.scope === "platform");
  const when = (iso: string) =>
    new Date(iso).toLocaleString(tag, { dateStyle: "medium", timeStyle: "short" });
  if (!canManage && !orgStop && !platform) return null;
  async function toggle(stop: boolean) {
    if (stop && !window.confirm(t("sec.org.confirm"))) return;
    setBusy(true);
    const r = await growthDb.rpc("set_org_execution_stop", {
      _org: orgId,
      _stop: stop,
      _reason: reason,
    });
    setBusy(false);
    if (r.error) {
      toast.error(t("sec.org.failed"));
      return;
    }
    toast.success(t(stop ? "sec.org.stopped" : "sec.org.resumed"));
    setReason("");
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["execution-stops", orgId] }),
      qc.invalidateQueries({ queryKey: ["task-execution"] }),
    ]);
  }
  return (
    <Panel className="mb-6">
      <div className="flex items-center gap-2 text-sm font-medium">
        <OctagonX className="h-4 w-4" />
        {t("sec.org.title")}
      </div>
      {platform && (
        <p role="status" className="mt-2 text-sm text-destructive">
          {t("sec.org.platformActive", {
            reason: platform.reason,
            when: when(platform.started_at),
          })}
        </p>
      )}
      {orgStop ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p role="status" className="text-sm text-destructive">
            {t("sec.org.active", {
              reason: orgStop.reason,
              when: when(orgStop.started_at),
              n: orgStop.workspaces,
            })}
          </p>
          {canManage && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => toggle(false)}>
              <Play />
              {t("sec.org.resume")}
            </Button>
          )}
        </div>
      ) : (
        canManage && (
          <div className="mt-2 space-y-2">
            <p className="text-xs text-muted-foreground">{t("sec.org.desc")}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Textarea
                aria-label={t("sec.org.reason")}
                placeholder={t("sec.org.reason")}
                rows={1}
                maxLength={300}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <Button
                variant="destructive"
                disabled={busy || reason.trim().length < 3}
                onClick={() => toggle(true)}
              >
                <OctagonX />
                {t("sec.org.stop")}
              </Button>
            </div>
          </div>
        )
      )}
    </Panel>
  );
}
