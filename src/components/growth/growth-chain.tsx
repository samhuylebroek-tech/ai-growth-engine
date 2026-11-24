import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight, CircleAlert, GitBranch } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { growthDb, isNotInstalled } from "@/lib/pending-schema";
import { buildGrowthChain, type ChainStep } from "@/lib/growth-chain";
import { performanceOverview } from "@/lib/performance";
import { metricsOptions, measurementsOptions } from "@/components/performance/data";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const off = <T,>(r: { data: T | null; error: unknown }): T | "off" => {
  if (r.error) {
    if (isNotInstalled(r.error)) return "off";
    throw r.error;
  }
  return r.data as T;
};
const LINK: Partial<
  Record<
    ChainStep["stage"],
    "/app/opportunities" | "/app/projects" | "/app/tasks" | "/app/performance"
  >
> = {
  opportunity: "/app/opportunities",
  work: "/app/projects",
  tasks: "/app/tasks",
  results: "/app/performance",
};

/** Read-only view of how one goal connects to its opportunity, strategy, approved plan, work and results. */
export function GrowthChain({
  orgId,
  wsId,
  goalId,
}: {
  orgId: string;
  wsId: string;
  goalId: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const metrics = useQuery({ ...metricsOptions(wsId), enabled: open });
  const values = useQuery({ ...measurementsOptions(wsId), enabled: open && metrics.isSuccess });
  const q = useQuery({
    queryKey: ["growth-chain", orgId, wsId, goalId],
    enabled: open,
    queryFn: async () => {
      const scope = <Q extends { eq: (c: string, v: string) => Q }>(x: Q) =>
        x.eq("org_id", orgId).eq("workspace_id", wsId);
      const [opp, strategies, plans, projects, campaigns] = await Promise.all([
        scope(growthDb.from("growth_opportunities").select("title,status"))
          .eq("goal_id", goalId)
          .limit(1)
          .maybeSingle(),
        scope(supabase.from("growth_strategies").select("id", { count: "exact", head: true })).eq(
          "goal_id",
          goalId,
        ),
        scope(growthDb.from("growth_plan_versions").select("id,version,status"))
          .eq("goal_id", goalId)
          .order("version", { ascending: false })
          .limit(20),
        scope(supabase.from("projects").select("id,title,status")).eq("goal_id", goalId).limit(100),
        scope(supabase.from("campaigns").select("id,title,status"))
          .eq("goal_id", goalId)
          .limit(100),
      ]);
      if (strategies.error) throw strategies.error;
      if (projects.error) throw projects.error;
      if (campaigns.error) throw campaigns.error;
      const planRows = off(plans);
      const approved =
        planRows === "off" ? undefined : planRows.find((p) => p.status === "approved");
      const init = approved
        ? await scope(growthDb.from("growth_initiatives").select("id,status,project_id"))
            .eq("plan_version_id", approved.id)
            .limit(100)
        : { data: [], error: null };
      if (init.error) throw init.error;
      const initRows = init.data ?? [];
      // Work created from initiatives belongs to the chain even when it was not linked to the goal by hand.
      const extra = initRows
        .map((i) => i.project_id)
        .filter((id): id is string => !!id && !(projects.data ?? []).some((p) => p.id === id));
      const extraProjects = extra.length
        ? await scope(supabase.from("projects").select("id,title,status")).in("id", extra)
        : { data: [], error: null };
      if (extraProjects.error) throw extraProjects.error;
      const projectRows = [...(projects.data ?? []), ...(extraProjects.data ?? [])];
      const campaignRows = campaigns.data ?? [];
      const filters = [
        projectRows.length ? `project_id.in.(${projectRows.map((p) => p.id).join(",")})` : "",
        campaignRows.length ? `campaign_id.in.(${campaignRows.map((c) => c.id).join(",")})` : "",
      ]
        .filter(Boolean)
        .join(",");
      const tasks = filters
        ? await scope(supabase.from("tasks").select("status")).or(filters).limit(1000)
        : { data: [], error: null };
      if (tasks.error) throw tasks.error;
      return {
        opportunity: off(opp),
        strategies: strategies.count ?? 0,
        plans: planRows === "off" ? ("off" as const) : planRows,
        initiatives: initRows,
        initiativeIds: initRows.map((i) => i.id),
        work: [
          ...projectRows.map((p) => ({
            kind: "projects" as const,
            title: p.title,
            status: p.status,
          })),
          ...campaignRows.map((c) => ({
            kind: "campaigns" as const,
            title: c.title,
            status: c.status,
          })),
        ],
        tasks: tasks.data ?? [],
      };
    },
  });
  const results = (() => {
    if (metrics.isError && isNotInstalled(metrics.error)) return "off" as const;
    if (!metrics.data || !values.data || !q.data) return { withActual: 0, total: 0 };
    const ids = new Set(q.data.initiativeIds);
    const linked = performanceOverview(
      metrics.data.filter(
        (m) => m.goal_id === goalId || (m.initiative_id && ids.has(m.initiative_id)),
      ),
      values.data,
    ).items;
    return { withActual: linked.filter((l) => l.summary.actual).length, total: linked.length };
  })();
  const chain = q.data ? buildGrowthChain({ ...q.data, results }) : null;
  return (
    <div className="rounded-lg border p-3">
      <Button
        size="sm"
        variant="ghost"
        className="h-auto px-0 text-sm font-medium"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <GitBranch className="h-4 w-4" />
        {t("goals.chain.title")}
        <ChevronRight className={cn("h-4 w-4 transition-transform", open && "rotate-90")} />
      </Button>
      {open &&
        (q.isLoading ? (
          <p role="status" className="mt-2 text-xs text-muted-foreground">
            {t("goals.chain.loading")}
          </p>
        ) : q.isError || !chain ? (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {t("goals.chain.failed")}
          </p>
        ) : (
          <>
            <ol className="mt-3 space-y-1.5">
              {chain.steps.map((s, i) => {
                const to = LINK[s.stage];
                const body = (
                  <>
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-2xs",
                        s.state === "done"
                          ? "border-success/50 bg-success/10 text-success"
                          : s.state === "in_progress" || s.state === "waiting"
                            ? "border-warning/50 bg-warning/10 text-warning"
                            : "border-border text-muted-foreground",
                      )}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{t(`goals.chain.s.${s.stage}`)}</span>
                      {s.label && <span className="text-muted-foreground"> · {s.label}</span>}
                      <span className="block text-muted-foreground">
                        {t(`goals.chain.st.${s.state}`)}
                        {s.total != null
                          ? ` · ${t(s.stage === "results" ? "goals.chain.measured" : "goals.chain.of", { n: s.count, total: s.total })}`
                          : s.count > 1
                            ? ` · ${s.count}`
                            : ""}
                      </span>
                    </span>
                  </>
                );
                return (
                  <li
                    key={s.stage}
                    className={cn(
                      "text-xs",
                      chain.next === s.stage && "rounded-md bg-muted/50 p-1",
                    )}
                  >
                    {to ? (
                      <Link to={to} className="flex items-start gap-2 hover:text-primary">
                        {body}
                      </Link>
                    ) : (
                      <div className="flex items-start gap-2">{body}</div>
                    )}
                  </li>
                );
              })}
            </ol>
            {chain.next && (
              <p className="mt-2 text-xs">
                <span className="font-medium">{t("goals.chain.next")}</span>{" "}
                {t(`goals.chain.n.${chain.next}`)}
              </p>
            )}
            {chain.duplicates.length > 0 && (
              <p role="note" className="mt-2 flex items-start gap-1.5 text-xs text-warning">
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {t("goals.chain.duplicates", { list: chain.duplicates.join(", ") })}
              </p>
            )}
          </>
        ))}
    </div>
  );
}
