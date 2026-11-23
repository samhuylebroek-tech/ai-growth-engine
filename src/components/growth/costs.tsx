import { useState } from "react";
import { PageHeader } from "@/components/app/status";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { executionOptions } from "@/lib/execution";
import { growthDb, isNotInstalled } from "@/lib/pending-schema";
import { rollUpCosts, type Credits, type Level } from "@/lib/cost-rollup";
import { SectionHeading } from "@/components/app/section-heading";

const LEVELS: Level[] = ["goal", "plan", "initiative", "campaign", "project", "task", "specialist"];
const RUN_LIMIT = 2000;

export function Costs() {
  const o = useOrg();
  const { t } = useI18n();
  if (o.loading) return <p className="p-6 text-muted-foreground">{t("cost.loading")}</p>;
  if (!o.org || !o.workspace)
    return <p className="p-6 text-muted-foreground">{t("cost.chooseWs")}</p>;
  return (
    <Report
      key={o.workspace.id}
      orgId={o.org.id}
      wsId={o.workspace.id}
      userId={o.userId ?? undefined}
    />
  );
}

function Report({
  orgId,
  wsId,
  userId,
}: {
  orgId: string;
  wsId: string;
  userId: string | undefined;
}) {
  const { t, tag } = useI18n();
  const [level, setLevel] = useState<Level>("goal");
  const work = useQuery(executionOptions(orgId, wsId, userId));
  const q = useQuery({
    queryKey: ["cost-report", orgId, wsId],
    staleTime: 30_000,
    queryFn: async () => {
      const month = new Date();
      month.setUTCDate(1);
      month.setUTCHours(0, 0, 0, 0);
      const [runs, inits, plans, goals, budget, balance, usage] = await Promise.all([
        growthDb
          .from("task_runs")
          .select("task_id,status,estimated_credits,credits_charged,specialist_key", {
            count: "exact",
          })
          .eq("org_id", orgId)
          .eq("workspace_id", wsId)
          .limit(RUN_LIMIT),
        growthDb
          .from("growth_initiatives")
          .select("id,title,project_id,plan_version_id")
          .eq("org_id", orgId)
          .eq("workspace_id", wsId)
          .limit(2000),
        growthDb
          .from("growth_plan_versions")
          .select("id,title,version,goal_id,strategy_id,status")
          .eq("org_id", orgId)
          .eq("workspace_id", wsId)
          .limit(500),
        supabase
          .from("growth_goals")
          .select("id,title")
          .eq("org_id", orgId)
          .eq("workspace_id", wsId)
          .neq("status", "archived")
          .limit(200),
        supabase
          .from("budget_lines")
          .select("goal_id,planned,actual,currency")
          .eq("org_id", orgId)
          .eq("workspace_id", wsId)
          .limit(5000),
        supabase.rpc("credit_balance", { _org: orgId }),
        supabase
          .from("ai_usage_events")
          .select("credits_charged", { count: "exact" })
          .eq("org_id", orgId)
          .gte("created_at", month.toISOString())
          .limit(5000),
      ]);
      for (const r of [runs, goals, budget]) if (r.error) throw r.error;
      // Fail closed rather than show undercounted totals.
      if ((runs.count ?? 0) > RUN_LIMIT) throw new Error("too_many");
      const plansOn = !inits.error && !plans.error;
      if (!plansOn && !isNotInstalled(inits.error ?? plans.error)) throw inits.error ?? plans.error;
      return {
        runs: runs.data ?? [],
        initiatives: plansOn ? (inits.data ?? []) : [],
        plans: plansOn ? (plans.data ?? []).filter((p) => p.status === "approved") : [],
        plansOn,
        goals: goals.data ?? [],
        budget: budget.data ?? [],
        balance: balance.error ? null : (balance.data as number),
        orgUsed:
          usage.error || (usage.count ?? 0) > 5000
            ? null
            : (usage.data ?? []).reduce((n, e) => n + Number(e.credits_charged), 0),
      };
    },
  });
  if (q.isError && isNotInstalled(q.error))
    return <p className="p-6 text-muted-foreground">{t("cost.notInstalled")}</p>;
  if (q.isLoading || work.isLoading)
    return (
      <p role="status" className="p-6 text-muted-foreground">
        {t("cost.loading")}
      </p>
    );
  if (q.isError || work.isError || !q.data || !work.data)
    return (
      <p role="alert" className="p-6 text-destructive">
        {t("cost.failed")}
      </p>
    );
  const d = q.data;
  const r = rollUpCosts({
    runs: d.runs,
    tasks: work.data.tasks,
    projects: work.data.projects,
    campaigns: work.data.campaigns,
    initiatives: d.initiatives,
    plans: d.plans,
    goals: d.goals,
    budget: d.budget,
  });
  const n = (x: number) => x.toLocaleString(tag);
  const cur = (x: number, c: string) =>
    new Intl.NumberFormat(tag, { style: "currency", currency: c, maximumFractionDigits: 0 }).format(
      x,
    );
  const nodes = r[level].filter(
    (x) =>
      x.credits.runs > 0 ||
      (x.budget && Object.keys(x.budget).length > 0) ||
      (x.campaignBudgetEur ?? 0) > 0,
  );
  const Cell = ({ c }: { c: Credits }) => (
    <>
      <td className="px-2 py-1.5 text-right tabular-nums">{n(c.runs)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{n(c.consumed)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{n(c.reserved)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{n(c.released)}</td>
    </>
  );
  const Stat = ({ k, v, note }: { k: string; v: string; note: string }) => (
    <div className="min-w-0 rounded-lg border bg-card p-3">
      <p className="text-[11px] font-medium text-muted-foreground">{k}</p>
      <p className="mt-1 break-words text-xl font-semibold tabular-nums">{v}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{note}</p>
    </div>
  );
  return (
    <div className="max-w-6xl">
      <PageHeader
        eyebrow={t("cost.eyebrow")}
        title={t("cost.title")}
        description={t("cost.intro")}
      />

      <section aria-label={t("cost.creditsTitle")} className="mt-6">
        <SectionHeading eyebrow={t("cost.creditsEyebrow")} title={t("cost.creditsTitle")} />
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <Stat
            k={t("cost.available")}
            v={d.balance == null ? t("cost.na") : n(d.balance)}
            note={t("cost.availableNote")}
          />
          <Stat
            k={t("cost.orgUsed")}
            v={d.orgUsed == null ? t("cost.na") : n(d.orgUsed)}
            note={t("cost.orgUsedNote")}
          />
          <Stat
            k={t("cost.wsConsumed")}
            v={n(r.workspace.consumed)}
            note={t("cost.wsConsumedNote")}
          />
          <Stat
            k={t("cost.wsReserved")}
            v={n(r.workspace.reserved)}
            note={t("cost.wsReservedNote")}
          />
          <Stat
            k={t("cost.wsReleased")}
            v={n(r.workspace.released)}
            note={t("cost.wsReleasedNote", { n: r.workspace.releasedRuns })}
          />
        </div>
      </section>

      <section aria-label={t("cost.levelsTitle")} className="mt-8">
        <SectionHeading eyebrow={t("cost.levelsEyebrow")} title={t("cost.levelsTitle")} />
        <div role="tablist" className="mb-3 flex flex-wrap gap-1">
          {LEVELS.map((l) => (
            <button
              key={l}
              role="tab"
              aria-selected={level === l}
              onClick={() => setLevel(l)}
              className={`rounded-md border px-2.5 py-1 text-xs ${level === l ? "border-primary bg-primary/10 font-medium" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t(`cost.level.${l}` as MessageKey)}
            </button>
          ))}
        </div>
        {(level === "plan" || level === "initiative") && !d.plansOn ? (
          <p className="text-sm text-muted-foreground">{t("cost.plansOff")}</p>
        ) : !nodes.length ? (
          <p className="text-sm text-muted-foreground">{t("cost.empty")}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">
                    {t(`cost.level.${level}` as MessageKey)}
                  </th>
                  <th className="px-2 py-1.5 text-right font-medium">{t("cost.col.runs")}</th>
                  <th className="px-2 py-1.5 text-right font-medium">{t("cost.col.consumed")}</th>
                  <th className="px-2 py-1.5 text-right font-medium">{t("cost.col.reserved")}</th>
                  <th className="px-2 py-1.5 text-right font-medium">{t("cost.col.released")}</th>
                  {(level === "goal" || level === "campaign") && (
                    <th className="px-2 py-1.5 text-left font-medium">
                      {t(level === "goal" ? "cost.col.budget" : "cost.col.campaignBudget")}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {nodes.map((x) => (
                  <tr key={x.id} className="border-t">
                    <td className="max-w-[18rem] break-words px-2 py-1.5">
                      {level === "specialist" ? t(`run.sp.${x.id}` as MessageKey) : x.title}
                    </td>
                    <Cell c={x.credits} />
                    {level === "goal" && (
                      <td className="px-2 py-1.5 text-xs">
                        {Object.keys(x.budget ?? {}).length ? (
                          Object.entries(x.budget!).map(([c, v]) => (
                            <span key={c} className="block">
                              {t("cost.budgetLine", {
                                planned: cur(v.planned, c),
                                actual: cur(v.actual, c),
                              })}
                            </span>
                          ))
                        ) : (
                          <span className="text-muted-foreground">{t("cost.noBudget")}</span>
                        )}
                      </td>
                    )}
                    {level === "campaign" && (
                      <td className="px-2 py-1.5 text-xs">
                        {(x.campaignBudgetEur ?? 0) > 0 ? (
                          t("cost.campaignBudget", { v: cur(x.campaignBudgetEur!, "EUR") })
                        ) : (
                          <span className="text-muted-foreground">{t("cost.noBudget")}</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          {t("cost.levelsNote")}
          {r.unlinkedTasks ? ` ${t("cost.unlinked", { n: r.unlinkedTasks })}` : ""}
        </p>
      </section>

      <section aria-label={t("cost.catTitle")} className="mt-8">
        <SectionHeading eyebrow={t("cost.catEyebrow")} title={t("cost.catTitle")} />
        <dl className="grid gap-2 md:grid-cols-2">
          {(
            ["subscription", "aiCredits", "adSpend", "software", "other", "revenue", "roi"] as const
          ).map((k) => (
            <div key={k} className="rounded-lg border bg-card p-3">
              <dt className="text-sm font-medium">{t(`cost.cat.${k}` as MessageKey)}</dt>
              <dd className="mt-1 text-xs text-muted-foreground">
                {t(`cost.catNote.${k}` as MessageKey)}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
