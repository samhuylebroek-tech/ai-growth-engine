// "Why is this task waiting?" — plain-language block diagnosis (pure diagnoseBlock) at the top of a task. It only
// points to existing permission-checked actions (open the prerequisite, re-plan, approvals); it changes nothing.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { useOrg } from "@/lib/org-context";
import { diagnoseBlock, type DiagTask } from "@/lib/task-blocking";
import { Button } from "@/components/ui/button";
import { runsByTask, taskExecutionOptions } from "./task-runs-data";

type Note = { kind: string; entity_type: string; entity_id: string; related_id: string | null; user_id?: string | null };
export function BlockedExplanation({ taskId, tasks, notes, campaigns, onOpen, onReplan }: {
  taskId: string; tasks: readonly DiagTask[]; notes: readonly Note[]; campaigns: readonly { id: string; end_date: string | null }[];
  onOpen: (id: string) => void; onReplan: () => void;
}) {
  const o = useOrg();
  const { t, tag } = useI18n();
  const exec = useQuery({ ...taskExecutionOptions(o.org?.id, o.workspace?.id, o.workspaceRole !== "viewer" && o.workspaceRole !== null) });
  const runs = runsByTask(exec.data?.runs ?? []);
  const today = new Date().toISOString().slice(0, 10);
  const d = diagnoseBlock(taskId, {
    tasks,
    deps: notes.filter((n) => n.kind === "dependency" && n.entity_type === "tasks" && n.related_id).map((n) => ({ task_id: n.entity_id, depends_on: n.related_id! })),
    runState: new Map([...runs].map(([id, r]) => [id, r.latest.status])),
    assigned: new Set(notes.filter((n) => n.kind === "member" && n.entity_type === "tasks").map((n) => n.entity_id)),
    campaignEnd: new Map(campaigns.map((c) => [c.id, c.end_date])),
    today,
  });
  if (!d) return null;
  const day = (s: string | null) => (s ? new Date(`${s}T00:00:00Z`).toLocaleDateString(tag, { timeZone: "UTC" }) : t("bk.noDate"));
  return (
    <section role="status" aria-labelledby={`bk-${taskId}`} className="space-y-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
      <h3 id={`bk-${taskId}`} className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4 text-warning" aria-hidden /> {t("bk.title")}</h3>
      <p className="text-muted-foreground">{d.prerequisites.length === 1 ? t("bk.why1") : t("bk.why", { n: d.prerequisites.length })}</p>
      <ul className="space-y-1.5">
        {d.prerequisites.map((p) => (
          <li key={p.id} className="rounded-md border bg-card p-2">
            <button type="button" className="text-left font-medium underline-offset-2 hover:underline" onClick={() => onOpen(p.id)}>{p.title}</button>
            <span className="text-xs text-muted-foreground"> · {t("bk.due", { d: day(p.due_date) })}</span>
            <ul className="mt-1 flex flex-wrap gap-1">{p.causes.map((c) => <li key={c} className="rounded border px-1.5 py-0.5 text-xs">{t(`bk.cause.${c}` as MessageKey)}</li>)}</ul>
          </li>
        ))}
      </ul>
      {d.downstream.length > 0 && <p className="text-xs">{t(d.downstream.length === 1 ? "bk.downstream1" : "bk.downstream", { n: d.downstream.length, list: d.downstream.slice(0, 4).map((x) => x.title).join(", ") })}</p>}
      {d.campaignAtRisk && <p className="text-xs text-destructive">{t("bk.campaign")}</p>}
      <div>
        <p className="text-xs font-medium">{t("bk.next")}</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">{d.actions.map((a) => <li key={a}>{t(`bk.a.${a}` as MessageKey)}</li>)}</ul>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => onOpen(d.prerequisites[0]!.id)}>{t("bk.openPre")}</Button>
        {d.actions.includes("replan") && <Button size="sm" variant="outline" onClick={onReplan}>{t("bk.replan")}</Button>}
        {d.actions.includes("decide_approval") && <Button size="sm" variant="outline" asChild><Link to="/app/approvals">{t("bk.approvals")}</Link></Button>}
      </div>
      <p className="text-[11px] text-muted-foreground">{t("bk.nothingChanges")}</p>
    </section>
  );
}
