// Shows where a task came from when an approved improvement proposal produced it: the proposal keeps the link
// (optimization_proposals.task_id), its reason and its evidence, so the task stays traceable without copying them.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { useOrg } from "@/lib/org-context";
import { growthDb, isNotInstalled } from "@/lib/pending-schema";

export function TaskOrigin({ taskId }: { taskId: string }) {
  const o = useOrg();
  const { t } = useI18n();
  const org = o.org?.id,
    ws = o.workspace?.id;
  const q = useQuery({
    queryKey: ["task-origin", org, ws, taskId],
    enabled: !!org && !!ws,
    queryFn: async () => {
      const r = await growthDb
        .from("optimization_proposals")
        .select("id,title,reason,evidence,origin,status")
        .eq("org_id", org!)
        .eq("workspace_id", ws!)
        .eq("task_id", taskId)
        .limit(1)
        .maybeSingle();
      if (r.error) {
        if (isNotInstalled(r.error)) return null;
        throw r.error;
      }
      return r.data;
    },
  });
  const p = q.data;
  if (!p) return null;
  const evidence = Array.isArray(p.evidence) ? p.evidence.length : 0;
  return (
    <div className="rounded-md border bg-muted/40 p-3 text-xs">
      <p className="font-medium">{t("work.origin.improvement", { title: p.title })}</p>
      {p.reason && <p className="mt-1 text-muted-foreground">{p.reason}</p>}
      <p className="mt-1 text-muted-foreground">
        {evidence
          ? t("work.origin.evidence", { n: String(evidence) })
          : t("work.origin.noEvidence")}
        {" · "}
        <Link to="/app/improvements" className="underline underline-offset-2">
          {t("work.origin.open")}
        </Link>
      </p>
    </div>
  );
}
