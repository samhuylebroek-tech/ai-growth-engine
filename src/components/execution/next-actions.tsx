import { useQuery } from "@tanstack/react-query";
import { Compass } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { growthDb, isNotInstalled, type TaskProfileRow, type TaskRunRow } from "@/lib/pending-schema";
import { bottlenecks, nextBestActions, possibleDuplicates, type OrchTask } from "@/lib/orchestration";
import { localDay } from "@/lib/execution";
import { Button } from "@/components/ui/button";

type Data = { tasks: OrchTask[]; projects: { id: string; goal_id: string | null }[]; campaigns: { id: string; goal_id: string | null }[]; notes: { kind: string; entity_type: string; entity_id: string; related_id: string | null }[] };

function goalLinksOptions(orgId?: string, wsId?: string) {
  return {
    queryKey: ["orchestration-links", orgId, wsId], enabled: !!orgId && !!wsId, staleTime: 60_000,
    queryFn: async () => {
      const [g, i] = await Promise.all([
        supabase.from("growth_goals").select("id,priority,status").eq("org_id", orgId!).eq("workspace_id", wsId!).limit(500),
        growthDb.from("growth_initiatives").select("project_id").eq("org_id", orgId!).eq("workspace_id", wsId!).not("project_id", "is", null).limit(2000),
      ]);
      if (g.error) throw g.error;
      if (i.error && !isNotInstalled(i.error)) throw i.error;
      return { goals: g.data ?? [], initiativeProjects: new Set((i.data ?? []).map((x) => x.project_id!).filter(Boolean)) };
    },
  };
}

/** Growth Officer's next best actions for this workspace, with the evidence for each; no AI and no credits. */
export function NextActions({ data, runs, profiles, onOpen }: { data: Data; runs: readonly TaskRunRow[]; profiles: ReadonlyMap<string, TaskProfileRow>; onOpen: (taskId: string) => void }) {
  const o = useOrg(); const { t } = useI18n();
  const links = useQuery(goalLinksOptions(o.org?.id, o.workspace?.id));
  const latest = new Map<string, { status: string; failed: number }>();
  for (const r of runs) { const e = latest.get(r.task_id); if (!e) latest.set(r.task_id, { status: r.status, failed: r.status === "failed" ? 1 : 0 }); else if (r.status === "failed") e.failed += 1; }
  const deps = data.notes.filter((n) => n.entity_type === "tasks" && n.kind === "dependency" && n.related_id).map((n) => ({ task_id: n.entity_id, depends_on: n.related_id! }));
  const goalOf = (rows: { id: string; goal_id: string | null }[]) => new Map(rows.filter((r) => r.goal_id).map((r) => [r.id, r.goal_id!]));
  const actions = nextBestActions({
    today: localDay(), tasks: data.tasks, dependencies: deps, profiles, latestRun: latest, goalOfProject: goalOf(data.projects), goalOfCampaign: goalOf(data.campaigns),
    goals: new Map((links.data?.goals ?? []).map((g) => [g.id, { priority: g.priority as "primary" | "secondary", status: g.status }])), initiativeProjects: links.data?.initiativeProjects ?? new Set(),
  });
  const dups = possibleDuplicates(data.tasks);
  const necks = bottlenecks(data.tasks, deps);
  if (!actions.length && !dups.length && !necks.length) return null;
  return <section aria-label={t("orch.nbaTitle")} className="mb-5 rounded-lg border bg-card p-3 text-sm">
    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("orch.nbaEyebrow")}</p>
    <h2 className="flex items-center gap-2 font-semibold"><Compass className="h-4 w-4" />{t("orch.nbaTitle")}</h2>
    <ol className="mt-2 grid gap-1.5">{actions.map((a) => <li key={a.task.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border p-2">
      <div className="min-w-0 flex-1">
        <p className="break-words font-medium">{a.task.title}</p>
        <p className="text-xs text-muted-foreground">{t(`orch.kind.${a.kind}` as MessageKey, { t: a.blocker?.title ?? "" })}{a.why.length ? ` · ${a.why.map((w) => t(`orch.why.${w}` as MessageKey)).join(", ")}` : ""}</p>
      </div>
      <Button size="sm" variant="outline" onClick={() => onOpen(a.blocker && a.kind === "unblock" ? a.blocker.id : a.task.id)}>{t("orch.open")}</Button>
    </li>)}</ol>
    {(dups.length > 0 || necks.length > 0) && <div className="mt-2 grid gap-1 text-xs">
      {necks.map((n) => <p key={n.task.id}><span className="font-medium">{t("orch.bottlenecks")}:</span> {t("orch.bottleLine", { t: n.task.title, n: n.blocks })}</p>)}
      {dups.map((d) => <p key={`${d.a.id}-${d.b.id}`}><span className="font-medium">{t("orch.duplicates")}:</span> {t("orch.dupLine", { a: d.a.title, b: d.b.title, p: Math.round(d.similarity * 100) })}</p>)}
    </div>}
    <p className="mt-2 text-[11px] text-muted-foreground">{t("orch.nbaNote")}</p>
  </section>;
}
