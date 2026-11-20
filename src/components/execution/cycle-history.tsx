import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import type { CycleData } from "@/components/execution/cycle-data";
import { useOrg } from "@/lib/org-context";
import { useQuery } from "@tanstack/react-query";
import { executionOptions } from "@/lib/execution";
import { cn } from "@/lib/utils";

/** Recent scheduler cycles: why each ran, the limits it used and the decision + reason for every task it looked at. */
export function CycleHistory({ data }: { data: CycleData }) {
  const { t, tag } = useI18n(); const o = useOrg();
  const exec = useQuery(executionOptions(o.org?.id, o.workspace?.id, o.userId));
  const title = (id: string) => exec.data?.tasks.find((x) => x.id === id)?.title ?? t("orch.unknownTask");
  return <details className="mt-2 text-xs">
    <summary className="cursor-pointer text-muted-foreground">{t("orch.cyclesTitle")} ({data.cycles.length})</summary>
    {!data.cycles.length ? <p className="mt-1 text-muted-foreground">{t("orch.noCycles")}</p> :
      <ol className="mt-2 grid gap-2">{data.cycles.map((c) => {
        const sm = (c.summary ?? {}) as Record<string, number>;
        return <li key={c.id} className="rounded-md border p-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium">{new Date(c.created_at).toLocaleString(tag, { dateStyle: "medium", timeStyle: "short" })}</span>
            <span>{t(`orch.trigger.${c.trigger}` as MessageKey)}</span>
            <span className={cn("rounded border px-1", c.status === "completed" ? "border-success/50 text-success" : c.status === "stopped" ? "border-warning/50 text-warning" : "")}>{t(`orch.status.${c.status}` as MessageKey)}{c.stop_reason ? ` · ${t(`orch.stop.${c.stop_reason}` as MessageKey)}` : ""}</span>
            <span className="text-muted-foreground">{t("orch.cycleCounts", { q: c.queued, a: c.awaiting, s: c.skipped })}</span>
            {c.summary && "credits" in sm && <span className="text-muted-foreground">{t("orch.cycleSummary", { ok: sm["succeeded"] ?? 0, failed: (sm["failed"] ?? 0) + (sm["uncertain"] ?? 0), credits: sm["credits"] ?? 0 })}</span>}
          </div>
          <ul className="mt-1 grid gap-0.5">{data.items.filter((i) => i.cycle_id === c.id).map((i) => <li key={i.task_id} className="flex flex-wrap justify-between gap-x-3">
            <span className="min-w-0 break-words">#{i.rank} {title(i.task_id)}</span>
            <span className="text-muted-foreground">{t(`orch.decision.${i.decision}` as MessageKey)} · {t(`orch.reason.${i.reason}` as MessageKey)} · {t("orch.score", { n: i.score })}</span>
          </li>)}</ul>
        </li>;
      })}</ol>}
  </details>;
}
