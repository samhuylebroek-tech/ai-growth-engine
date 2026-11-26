import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TaskAIWork } from "@/components/execution/task-ai-work";
import { growthDb } from "@/lib/pending-schema";
import { useOrg } from "@/lib/org-context";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import type { Task } from "@/lib/execution";
import { campaignWorkStage } from "@/lib/campaign-work";

/** Latest recorded run and its exact human decision; no done-task counter masquerading as execution. */
export function CampaignWork({
  tasks,
  blocked,
}: {
  tasks: readonly Task[];
  blocked: ReadonlySet<string>;
}) {
  const o = useOrg();
  const { t } = useI18n();
  const [open, setOpen] = useState<string | null>(null);
  const ids = tasks.map((task) => task.id).sort();
  const q = useQuery({
    queryKey: ["campaign-work", o.org?.id, o.workspace?.id, ids],
    enabled: !!o.org && !!o.workspace && ids.length > 0,
    refetchInterval: (query) =>
      query.state.data?.runs.some((run) => run?.status === "running" || run?.status === "queued")
        ? 5000
        : false,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      if (!o.org || !o.workspace) throw new Error("Choose a business");
      const profiles = await growthDb
        .from("task_execution_profiles")
        .select("*")
        .eq("org_id", o.org.id)
        .eq("workspace_id", o.workspace.id)
        .in("task_id", ids)
        .limit(ids.length);
      if (profiles.error) throw profiles.error;
      const runs = await Promise.all(
        ids.map(async (id) => {
          const r = await growthDb
            .from("task_runs")
            .select("*")
            .eq("org_id", o.org?.id ?? "")
            .eq("workspace_id", o.workspace?.id ?? "")
            .eq("task_id", id)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (r.error) throw r.error;
          return r.data;
        }),
      );
      const runIds = runs.flatMap((r) => (r ? [r.id] : []));
      const decisions = runIds.length
        ? await growthDb
            .from("specialist_result_decisions")
            .select("*")
            .eq("org_id", o.org.id)
            .eq("workspace_id", o.workspace.id)
            .in("task_run_id", runIds)
            .limit(runIds.length)
        : { data: [], error: null };
      if (decisions.error) throw decisions.error;
      return { profiles: profiles.data ?? [], runs, decisions: decisions.data ?? [] };
    },
  });
  if (!tasks.length) return null;
  return (
    <section className="space-y-3 border-t border-border pt-4" aria-label={t("ch.work.title")}>
      <h4 className="font-semibold">{t("ch.work.title")}</h4>
      <p className="text-xs text-muted-foreground">{t("ch.work.separation")}</p>
      {q.isError ? (
        <div role="alert" className="space-y-2 text-sm text-destructive">
          <p>{t("ch.work.unavailable")}</p>
          <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
            {t("ch.work.retry")}
          </Button>
        </div>
      ) : !q.data ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("ch.work.loading")}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {tasks.map((task) => {
            const profile = q.data.profiles.find((p) => p.task_id === task.id);
            const run = q.data.runs.find((r) => r?.task_id === task.id) ?? undefined;
            const decision = q.data.decisions.find((d) => d.task_run_id === run?.id);
            const stage = campaignWorkStage(profile, run, decision);
            const expanded = open === task.id;
            return (
              <li key={task.id} className="min-w-0 space-y-3 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="break-words text-sm font-medium">{task.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {profile
                        ? t(`run.sp.${profile.specialist_key}` as MessageKey)
                        : t("ch.work.unassigned")}
                    </p>
                    <Badge variant="outline">{t(`ch.work.stage.${stage}` as MessageKey)}</Badge>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-expanded={expanded}
                    onClick={() => setOpen(expanded ? null : task.id)}
                  >
                    {expanded ? <ChevronUp /> : <ChevronDown />}
                    {t("ch.work.open")}
                  </Button>
                </div>
                {stage === "reviewed" && (
                  <Link
                    className="inline-flex min-h-9 items-center text-sm text-primary underline underline-offset-4"
                    to="/app/actions"
                    search={{ task: task.id }}
                  >
                    {t("ch.work.next")}
                  </Link>
                )}
                {expanded && (
                  <TaskAIWork
                    key={`${o.org?.id}/${o.workspace?.id}/${task.id}`}
                    task={task}
                    blocked={blocked.has(task.id)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
