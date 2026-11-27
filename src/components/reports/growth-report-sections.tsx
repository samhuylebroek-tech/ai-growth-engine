// Initiative, strategy and recommendation-learning report sections (Phase 9). Reads under the caller's RLS; money comes
// from the shared Growth economics data and rollup, so these sections show the same amounts as that page. A required
// read that fails hides the section instead of showing partial figures as complete.
import { FigureLabel } from "@/components/ai/evidence";
import type { FigureId } from "@/lib/report-claims";
import { useQuery } from "@tanstack/react-query";
import { econOptions } from "@/components/econ/econ-data";
import { growthDb, isNotInstalled } from "@/lib/pending-schema";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import type { Money } from "@/lib/econ/rollup";
import type { Learning } from "@/lib/econ/learning";
import {
  initiativeLines,
  learningReport,
  strategyLines,
  type EconInput,
  type GCampaign,
  type GGoal,
  type GInitiative,
  type GOperation,
  type GPlan,
  type GTask,
  type LProposal,
} from "@/lib/growth-reports";
import type { Period } from "@/lib/reports";
import { cn } from "@/lib/utils";

const tk = (k: string) => k as MessageKey;
type Shared = {
  orgId: string;
  wsId: string;
  period: Period;
  today: string;
  tasks: readonly GTask[];
  campaigns: readonly GCampaign[];
  goals: readonly GGoal[];
  operations: readonly GOperation[];
};

export function growthPlanOptions(orgId: string, wsId: string) {
  return {
    queryKey: ["growth-report-plans", orgId, wsId],
    queryFn: async () => {
      const [i, p] = await Promise.all([
        growthDb
          .from("growth_initiatives")
          .select("id,title,status,plan_version_id,goal_id,project_id,channel")
          .eq("org_id", orgId)
          .eq("workspace_id", wsId)
          .limit(2000),
        growthDb
          .from("growth_plan_versions")
          .select(
            "id,goal_id,strategy_id,version,status,title,approved_at,created_at,plan_snapshot",
          )
          .eq("org_id", orgId)
          .eq("workspace_id", wsId)
          .limit(500),
      ]);
      if (i.error) throw i.error;
      if (p.error) throw p.error;
      return { initiatives: (i.data ?? []) as GInitiative[], plans: (p.data ?? []) as GPlan[] };
    },
  };
}

function useMoney() {
  const { t, tag } = useI18n();
  return (m: Money | undefined) => {
    const e = Object.entries(m ?? {}).filter(([, v]) => v !== 0);
    return e.length
      ? e
          .map(([c, v]) => new Intl.NumberFormat(tag, { style: "currency", currency: c }).format(v))
          .join(" · ")
      : t("rep.none");
  };
}
const econInput = (
  d:
    | {
        campaigns: EconInput["campaigns"];
        allocations: EconInput["allocations"];
        spend: EconInput["spend"];
        costs: EconInput["costs"];
        credits: EconInput["credits"];
      }
    | undefined,
): EconInput | null =>
  d
    ? {
        campaigns: d.campaigns,
        allocations: d.allocations,
        spend: d.spend,
        costs: d.costs,
        credits: d.credits,
      }
    : null;

export function GrowthReportSection({
  type,
  ...s
}: Shared & { type: "initiative" | "strategy" | "learning" }) {
  if (type === "learning") return <LearningSection {...s} />;
  return type === "initiative" ? <InitiativeSection {...s} /> : <StrategySection {...s} />;
}

function InitiativeSection(s: Shared) {
  const { t, tag } = useI18n();
  const money = useMoney();
  const plans = useQuery(growthPlanOptions(s.orgId, s.wsId));
  const econ = useQuery(econOptions(s.orgId, s.wsId));
  if (plans.error) return <p className="text-sm text-destructive">{t("grp.failed")}</p>;
  if (!plans.data || econ.isLoading)
    return <p className="text-sm text-muted-foreground">{t("grp.loading")}</p>;
  const archived = new Set(s.goals.filter((g) => g.status === "archived").map((g) => g.id));
  const approved = new Set(
    plans.data.plans
      .filter((p) => p.status === "approved" && !archived.has(p.goal_id))
      .map((p) => p.id),
  );
  const lines = initiativeLines(
    {
      initiatives: plans.data.initiatives.filter((n) => approved.has(n.plan_version_id)),
      campaigns: s.campaigns,
      tasks: s.tasks,
      operations: s.operations,
      econ: econInput(econ.data),
    },
    s.period,
    s.today,
  );
  return (
    <section className="space-y-2" aria-label={t("grp.init.title")}>
      <h3 className="text-sm font-semibold">{t("grp.init.title")}</h3>
      {lines.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("grp.init.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                {(
                  [
                    ["grp.col.initiative"],
                    ["grp.col.status", "init.status"],
                    ["grp.col.work", "init.work"],
                    ["grp.col.overdue", "init.overdue"],
                    ["grp.col.campaigns", "init.campaigns"],
                    ["grp.col.spent", "init.spent"],
                    ["grp.col.reserved", "init.reserved"],
                    ["grp.col.credits", "init.credits"],
                    ["grp.col.kpi", "init.kpi"],
                  ] as [string, FigureId?][]
                ).map(([h, id]) => (
                  <th
                    key={h}
                    className={cn("py-1 pr-3 align-top font-normal", !id && "whitespace-nowrap")}
                  >
                    {t(tk(h))}
                    {id && <FigureLabel stack id={id} period={s.period} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-t border-border align-top tabular-nums">
                  <td className="py-1 pr-3">
                    <span className="font-medium">{l.title}</span>
                    {l.missing.length > 0 && (
                      <span className="block text-muted-foreground">
                        {t("grp.missing", {
                          list: l.missing.map((m) => t(tk(`grp.miss.${m}`))).join(", "),
                        })}
                      </span>
                    )}
                  </td>
                  <td className="py-1 pr-3">{t(tk(`grp.is.${l.status}`))}</td>
                  <td className="py-1 pr-3">
                    {l.work.done}/{l.work.tasks}
                  </td>
                  <td className={cn("py-1 pr-3", l.work.overdue > 0 && "text-destructive")}>
                    {l.work.overdue}
                  </td>
                  <td className="py-1 pr-3">{l.work.campaigns}</td>
                  <td className="py-1 pr-3">
                    {l.money ? money(l.money.spent) : t("rep.none")}
                    {l.money && Object.keys(l.money.simulatedSpent).length > 0 && (
                      <span className="block text-warning">
                        {t("grp.sim", { a: money(l.money.simulatedSpent) })}
                      </span>
                    )}
                  </td>
                  <td className="py-1 pr-3">{l.money ? money(l.money.reserved) : t("rep.none")}</td>
                  <td className="py-1 pr-3">
                    {l.money ? l.money.credits.toLocaleString(tag) : t("rep.none")}
                  </td>
                  <td className="py-1 pr-3">
                    {l.kpi ? (
                      <>
                        {t("grp.kpi", {
                          m: l.kpi.metric,
                          c: l.kpi.current ?? t("rep.none"),
                          b: l.kpi.baseline ?? t("rep.none"),
                          t: l.kpi.target ?? t("rep.none"),
                        })}
                        {l.kpi.progress !== null && (
                          <span className="block">
                            {t("grp.kpiProgress", { p: l.kpi.progress })}
                          </span>
                        )}
                      </>
                    ) : (
                      t("rep.none")
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t("grp.init.note")}</p>
    </section>
  );
}

function StrategySection(s: Shared) {
  const { t, tag } = useI18n();
  const money = useMoney();
  const plans = useQuery(growthPlanOptions(s.orgId, s.wsId));
  const econ = useQuery(econOptions(s.orgId, s.wsId));
  if (plans.error) return <p className="text-sm text-destructive">{t("grp.failed")}</p>;
  if (!plans.data || econ.isLoading)
    return <p className="text-sm text-muted-foreground">{t("grp.loading")}</p>;
  const lines = strategyLines(
    {
      ...plans.data,
      campaigns: s.campaigns,
      tasks: s.tasks,
      operations: s.operations,
      goals: s.goals,
      econ: econInput(econ.data),
      budget: econ.data?.budgetLines ?? [],
    },
    s.period,
    s.today,
  );
  const fmtDay = (d: string) => new Date(d).toLocaleDateString(tag);
  return (
    <section className="space-y-3" aria-label={t("grp.st.title")}>
      <h3 className="text-sm font-semibold">{t("grp.st.title")}</h3>
      {lines.length === 0 && <p className="text-xs text-muted-foreground">{t("grp.st.empty")}</p>}
      {lines.map((l) => (
        <div key={l.id} className="space-y-1 rounded-md border border-border p-3 text-xs">
          <p className="line-clamp-2 text-sm font-medium">
            {t("grp.st.head", { title: l.title.replace(/^Growth plan · /, ""), v: l.version })}{" "}
            <span className="font-normal text-muted-foreground">
              · {l.status === "approved" ? t("grp.st.current") : t("grp.st.superseded")}
              {l.approvedAt ? ` · ${fmtDay(l.approvedAt)}` : ""}
            </span>
          </p>
          {l.goalTitle && <p>{t("grp.st.goal", { g: l.goalTitle })}</p>}
          {l.goal && l.goal.progress !== null && (
            <p className="tabular-nums">
              <FigureLabel id="goal.progress" />{" "}
              {t("grp.st.progress", {
                p: l.goal.progress,
                c: l.goal.current ?? t("rep.none"),
                b: l.goal.baseline ?? t("rep.none"),
                t: l.goal.target ?? t("rep.none"),
              })}
              {l.goal.pace ? ` · ${t(tk(`grp.st.pace.${l.goal.pace}`))}` : ""}
            </p>
          )}
          <p>
            {t("grp.st.initiatives", {
              list:
                Object.entries(l.initiatives)
                  .map(([k, n]) => `${n} ${t(tk(`grp.is.${k}`)).toLowerCase()}`)
                  .join(", ") || t("rep.none"),
            })}
          </p>
          {l.initiativesWithoutWork > 0 && (
            <p className="text-warning">
              {t("grp.st.withoutWork", { n: l.initiativesWithoutWork })}
            </p>
          )}
          <p className="tabular-nums">
            {t("grp.st.work", {
              d: l.work.done,
              n: l.work.tasks,
              o: l.work.overdue,
              c: l.work.campaigns,
            })}
          </p>
          {l.money && (
            <p className="tabular-nums">
              {t("grp.st.money", {
                s: money(l.money.spent),
                r: money(l.money.reserved),
                k: l.money.credits.toLocaleString(tag),
              })}
              {Object.keys(l.money.simulatedSpent).length > 0 && (
                <span className="text-warning">
                  {" "}
                  {t("grp.sim", { a: money(l.money.simulatedSpent) })}
                </span>
              )}
            </p>
          )}
          {Object.keys(l.budget).length > 0 && (
            <p className="tabular-nums">{t("grp.st.budget", { list: money(l.budget) })}</p>
          )}
          {l.unlinkedGoalCampaigns > 0 && (
            <p className="text-muted-foreground">
              {t("grp.st.unlinked", { n: l.unlinkedGoalCampaigns })}
            </p>
          )}
          <p className="text-muted-foreground">
            {t("grp.st.recorded", { a: l.assumptions, r: l.risks })}
          </p>
          {l.pendingDraft && <p className="font-medium text-warning">{t("grp.st.pending")}</p>}
          {l.missing.length > 0 && (
            <p className="text-muted-foreground">
              {t("grp.missing", { list: l.missing.map((m) => t(tk(`grp.miss.${m}`))).join(", ") })}
            </p>
          )}
        </div>
      ))}
      <p className="text-xs text-muted-foreground">{t("grp.st.note")}</p>
    </section>
  );
}

function LearningSection(s: Shared) {
  const { t } = useI18n();
  const econ = useQuery(econOptions(s.orgId, s.wsId));
  const props = useQuery({
    queryKey: ["growth-report-proposals", s.orgId, s.wsId],
    queryFn: async () => {
      const r = await growthDb
        .from("optimization_proposals")
        .select("id,status,outcome,created_at,decided_at,measured_at,campaign_id,category", {
          count: "exact",
        })
        .eq("org_id", s.orgId)
        .eq("workspace_id", s.wsId)
        .limit(5000);
      if (r.error) throw r.error;
      if ((r.count ?? 0) > 5000) throw new Error("too_many");
      return (r.data ?? []) as LProposal[];
    },
  });
  if (props.error && isNotInstalled(props.error))
    return <p className="text-sm text-muted-foreground">{t("grp.l.unavailable")}</p>;
  if (props.error || econ.error)
    return <p className="text-sm text-destructive">{t("grp.failed")}</p>;
  if (!props.data || !econ.data)
    return <p className="text-sm text-muted-foreground">{t("grp.loading")}</p>;
  if (!econ.data.costsInstalled)
    return <p className="text-sm text-muted-foreground">{t("grp.l.unavailable")}</p>;
  const r = learningReport(props.data, econ.data.learnings as unknown as Learning[], s.period);
  const tiles: [string, number][] = [
    ["grp.l.created", r.created],
    ["grp.l.converted", r.converted],
    ["grp.l.measured", r.measured],
    ["grp.l.rejected", r.rejected],
    ["grp.l.awaiting", r.awaitingMeasurement],
  ];
  const outs: [string, number][] = [
    ["grp.l.improved", r.outcomes.improved],
    ["grp.l.no_change", r.outcomes.no_change],
    ["grp.l.worse", r.outcomes.worse],
    ["grp.l.inconclusive", r.outcomes.inconclusive],
  ];
  const lessons = Object.entries(r.learnings);
  return (
    <section className="space-y-3 text-xs" aria-label={t("grp.l.title")}>
      <h3 className="text-sm font-semibold">
        {t("grp.l.title")}
        <FigureLabel id="learn.counts" period={s.period} />
      </h3>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {tiles.map(([k, v]) => (
          <div key={k} className="rounded border border-border p-2">
            <dt className="text-muted-foreground">{t(tk(k))}</dt>
            <dd className="font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <h4 className="font-medium">{t("grp.l.outcomes")}</h4>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {outs.map(([k, v]) => (
          <div key={k} className="rounded border border-border p-2">
            <dt className="text-muted-foreground">{t(tk(k))}</dt>
            <dd className="font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <p>
        {lessons.length
          ? t("grp.l.lessons", {
              list: lessons
                .map(([k, n]) => `${n} ${t(tk(`rl.out.${k}`)).toLowerCase()}`)
                .join(", "),
            })
          : t("grp.l.noLessons")}
      </p>
      {Object.keys(r.evidence).length > 0 && (
        <p>
          {t("grp.l.evidence", {
            list: Object.entries(r.evidence)
              .map(([k, n]) => `${n} ${t(tk(`rl.ev.${k}`)).toLowerCase()}`)
              .join(", "),
          })}
        </p>
      )}
      <h4 className="font-medium">
        {t("grp.l.patterns")}
        <FigureLabel id="learn.patterns" period={s.period} />
      </h4>
      {r.patterns.length === 0 ? (
        <p className="text-muted-foreground">{t("grp.l.noPatterns")}</p>
      ) : (
        <ul className="list-disc space-y-1 pl-5">
          {r.patterns.map((p) => (
            <li key={p.key}>
              {p.lever.replace(/_/g, " ")}
              {p.channel ? ` · ${p.channel}` : ""}:{" "}
              {t("rl.patternLine", {
                n: p.observations,
                c: p.campaigns,
                pos: p.positive,
                neg: p.negative,
                nc: p.noChange,
                f: p.from,
                to: p.to,
              })}{" "}
              · {t(tk(`rl.conf.${p.confidence}`))}
            </li>
          ))}
        </ul>
      )}
      <p className="text-muted-foreground">{t("grp.l.note")}</p>
    </section>
  );
}
