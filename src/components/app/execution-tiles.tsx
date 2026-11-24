import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useOrg } from "@/lib/org-context";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { supabase } from "@/integrations/supabase/client";
import { growthDb, isNotInstalled, retryUnlessNotInstalled } from "@/lib/pending-schema";
import { buildExecutionTiles } from "@/lib/execution-tiles";
import { SectionHeading } from "@/components/app/section-heading";

const LIMIT = 2000;
function executionTilesOptions(orgId: string | undefined, wsId: string | undefined) {
  return {
    queryKey: ["execution-tiles", orgId, wsId],
    enabled: !!orgId && !!wsId,
    staleTime: 30_000,
    retry: retryUnlessNotInstalled,
    queryFn: async () => {
      if (!orgId || !wsId) throw new Error("Choose a workspace");
      const [tasks, deps, runs, inits] = await Promise.all([
        supabase
          .from("tasks")
          .select("id,status,due_date,updated_at", { count: "exact" })
          .eq("org_id", orgId)
          .eq("workspace_id", wsId)
          .limit(LIMIT),
        supabase
          .from("execution_notes")
          .select("entity_id,related_id")
          .eq("org_id", orgId)
          .eq("workspace_id", wsId)
          .eq("entity_type", "tasks")
          .eq("kind", "dependency")
          .limit(LIMIT),
        growthDb
          .from("task_runs")
          .select("task_id,status,estimated_credits,credits_charged,created_at", { count: "exact" })
          .eq("org_id", orgId)
          .eq("workspace_id", wsId)
          .order("created_at", { ascending: false })
          .limit(LIMIT),
        growthDb
          .from("growth_initiatives")
          .select("id,growth_plan_versions!inner(status)", { count: "exact", head: true })
          .eq("org_id", orgId)
          .eq("workspace_id", wsId)
          .eq("growth_plan_versions.status", "approved")
          .in("status", ["planned", "in_progress"]),
      ]);
      if (runs.error) throw runs.error;
      for (const r of [tasks, deps]) if (r.error) throw r.error;
      if (inits.error && !isNotInstalled(inits.error)) throw inits.error;
      // Fail closed instead of showing undercounted numbers.
      if ((tasks.count ?? 0) > LIMIT || (runs.count ?? 0) > LIMIT) throw new Error("too_many");
      return buildExecutionTiles({
        now: new Date(),
        tasks: tasks.data ?? [],
        runs: runs.data ?? [],
        dependencies: (deps.data ?? [])
          .filter((d) => d.related_id)
          .map((d) => ({ task_id: d.entity_id, depends_on: d.related_id! })),
        activeInitiatives: inits.error ? null : (inits.count ?? 0),
      });
    },
  };
}

/** Home: how execution is going, from task, dependency and AI run records only. */
export function ExecutionTiles() {
  const { org, workspace } = useOrg();
  const { t, tag } = useI18n();
  const q = useQuery(executionTilesOptions(org?.id, workspace?.id));
  if (q.isError && isNotInstalled(q.error)) return null;
  return (
    <section aria-label={t("run.tiles.title")} className="mb-8">
      <SectionHeading eyebrow={t("run.tiles.eyebrow")} title={t("run.tiles.title")} />
      {q.isLoading ? (
        <p role="status" className="py-3 text-xs text-muted-foreground">
          {t("run.loading")}
        </p>
      ) : q.isError || !q.data ? (
        <p role="alert" className="py-3 text-xs text-destructive">
          {t("run.tiles.failed")}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-5">
          {q.data.map((x) => (
            <Link
              key={x.key}
              to={x.to}
              title={t(`run.tiles.d.${x.key}` as MessageKey)}
              className="flex min-w-0 flex-col bg-card p-3 hover:bg-muted/40"
            >
              <span className="break-words text-2xs font-medium text-muted-foreground">
                {t(`run.tiles.k.${x.key}` as MessageKey)}
              </span>
              <span className="mt-1 text-xl font-semibold tabular-nums">
                {x.value.toLocaleString(tag)}
                {x.total != null && (
                  <span className="text-sm font-normal text-muted-foreground">
                    {" "}
                    / {x.total.toLocaleString(tag)}
                  </span>
                )}
              </span>
              <span className="mt-auto pt-2 text-2xs text-muted-foreground">
                {t(`run.tiles.p.${x.period}` as MessageKey)}
              </span>
            </Link>
          ))}
        </div>
      )}
      <p className="mt-2 text-2xs text-muted-foreground">{t("run.tiles.note")}</p>
    </section>
  );
}
