// Business performance: executive overview, indicators, next best growth actions, comparisons and what the
// Growth Officer knows. Every figure shows its source, period and data class; missing data says why.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { useI18n } from "@/lib/i18n";
import { can } from "@/lib/permissions";
import { growthDb, isNotInstalled } from "@/lib/pending-schema";
import { attribute, type Model } from "@/lib/bi/attribution";
import { buildView, NO_FILTERS, type BiData, type Filters, type View } from "@/lib/bi/view";
import {
  ASSUMPTIONS,
  DIMENSIONS,
  buildRows,
  budgetUse,
  compare,
  type Dimension,
} from "@/lib/bi/comparison";
import { KPI_CATEGORY, periodRange, type Kpi } from "@/lib/bi/kpis";
import type { GrowthAction } from "@/lib/bi/growth-actions";
import { AREAS } from "@/lib/bi/understanding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { biKey, biOptions } from "./bi-data";
import { QualityBadge } from "./evidence";
import {
  Badge,
  ClassBadge,
  FilterBar,
  Figure,
  Section,
  sel,
  targetLabel,
  tk,
  useFmt,
} from "./parts";

export function useBi() {
  const o = useOrg();
  return useQuery(biOptions(o.org?.id, o.workspace?.id));
}

export function BiState({
  q,
  children,
}: {
  q: ReturnType<typeof useBi>;
  children: (d: BiData) => React.ReactNode;
}) {
  const o = useOrg();
  const { t } = useI18n();
  if (!o.workspace) return <p className="text-sm text-muted-foreground">{t("bi.chooseWs")}</p>;
  if (q.isError && isNotInstalled(q.error))
    return <p className="text-sm text-muted-foreground">{t("bi.notInstalled")}</p>;
  if (q.isLoading)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t("bi.loading")}
      </p>
    );
  if (q.isError || !q.data)
    return (
      <p role="alert" className="text-sm text-destructive">
        {(q.error as Error | null)?.message === "too_many" ? t("bi.tooMany") : t("bi.loadFailed")}
      </p>
    );
  return <>{children(q.data)}</>;
}

export function BusinessOverview({ initialUnit = null }: { initialUnit?: string | null } = {}) {
  const q = useBi();
  // A brand/unit chosen in the context switcher opens the overview filtered to it.
  const [filters, setFilters] = useState<Filters>(initialUnit ? { ...NO_FILTERS, unit: initialUnit } : NO_FILTERS);
  const [model, setModel] = useState<Model>("last_touch");
  return (
    <BiState q={q}>
      {(d) => (
        <OverviewBody
          d={d}
          filters={filters}
          setFilters={setFilters}
          model={model}
          setModel={setModel}
        />
      )}
    </BiState>
  );
}

function OverviewBody({
  d,
  filters,
  setFilters,
  model,
  setModel,
}: {
  d: BiData;
  filters: Filters;
  setFilters: (f: Filters) => void;
  model: Model;
  setModel: (m: Model) => void;
}) {
  const { t } = useI18n();
  const v = useMemo(() => buildView(d, filters, model), [d, filters, model]);
  return (
    <>
      <FilterBar
        data={d}
        filters={filters}
        onChange={setFilters}
        model={model}
        onModel={setModel}
      />
      {v.scopeLabel !== "all" && (
        <p className="mt-2 text-[11px] text-muted-foreground">{t("bi.scopeNote")}</p>
      )}
      <ExecutiveFigures d={d} v={v} model={model} />
      <GrowthActions actions={v.actions} />
      <Indicators v={v} />
      <Comparison d={d} model={model} />
      <Understanding v={v} />
      <Units d={d} />
    </>
  );
}

export function periodText(v: Pick<View, "range">, date: (iso: string) => string) {
  return `${date(v.range.from)} – ${date(v.range.to)}`;
}

function ExecutiveFigures({ d, v, model }: { d: BiData; v: View; model: Model }) {
  const { t } = useI18n();
  const f = useFmt();
  const period = periodText(v, f.date);
  const per = (sel: (x: View["totals"][number]) => number) =>
    f.moneyList(
      v.totals.map((x) => ({ currency: x.currency, amount: sel(x) })).filter((x) => x.amount !== 0),
    );
  const kpi = (k: string) => v.kpis.find((x) => x.key === k);
  const kpiFigure = (k: string) => {
    const x = kpi(k);
    return x ? (
      <Figure
        key={k}
        label={t(tk(`bi.kpi.${k}`))}
        value={x.value === null ? null : kpiValue(x, f)}
        cls={x.cls}
        source={t("bi.src.derived")}
        period={period}
        missing={missingText(x, t)}
      />
    ) : null;
  };
  const unattributed = f.moneyList(
    v.attribution
      .map((a) => ({ currency: a.currency, amount: a.unattributed }))
      .filter((x) => x.amount > 0),
  );
  const progress = v.goals.filter((g) => g.progress !== null);
  const leads = v.inputs.get("leads");
  const sources = v.importedSources
    .map((s) => t(tk(`bi.source.${s.replace(/^sim\./, "sim_")}`)))
    .join(", ");
  return (
    <Section title={t("bi.exec.title")} intro={t("bi.exec.intro")}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Figure
          label={t("bi.fig.revenueImported")}
          value={per((x) => x.imported)}
          cls="actual"
          source={sources || t("bi.src.noSource")}
          period={period}
          missing={t("bi.miss.noImported")}
        />
        <Figure
          label={t("bi.fig.revenueManual")}
          value={per((x) => x.manual)}
          cls="manual"
          source={t("bi.src.team")}
          period={period}
          missing={t("bi.miss.noManual")}
        />
        <Figure
          label={t("bi.fig.attributed")}
          value={f.moneyList(v.scopedAttributed)}
          cls="manual"
          source={t("bi.src.attribution", { m: t(tk(`bi.model.${model}`)) })}
          period={period}
          missing={t("bi.miss.noAttribution")}
          note={
            v.scopeLabel === "all" && unattributed
              ? t("bi.note.unattributed", { v: unattributed })
              : undefined
          }
        />
        <Figure
          label={t("bi.fig.estimated")}
          value={per((x) => x.estimated)}
          cls="estimated"
          source={t("bi.src.team")}
          period={period}
          missing={t("bi.miss.none")}
          note={t("bi.note.estimated")}
        />
        <Figure
          label={t("bi.fig.refunds")}
          value={per((x) => Math.abs(x.refunds))}
          cls="manual"
          source={t("bi.src.ledger")}
          period={period}
          missing={t("bi.miss.none")}
        />
        <Figure
          label={t("bi.fig.closedWon")}
          value={f.moneyList(v.closedWon)}
          cls="manual"
          source={t("bi.src.pipeline")}
          period={period}
          missing={t("bi.miss.noWon")}
          note={t("bi.note.dealsNotRevenue")}
        />
        <Figure
          label={t("bi.fig.pipeline")}
          value={f.moneyList(v.pipeline)}
          cls="estimated"
          source={t("bi.src.pipeline")}
          period={t("bi.period.now")}
          missing={t("bi.miss.noPipeline")}
        />
        <Figure
          label={t("bi.fig.spend")}
          value={f.moneyList(v.spend)}
          cls="manual"
          source={t("bi.src.budget")}
          period={period}
          missing={t("bi.miss.noSpend")}
          note={
            v.plannedSpend.length
              ? t("bi.note.planned", { v: f.moneyList(v.plannedSpend)! })
              : undefined
          }
        />
        <Figure
          label={t("bi.fig.leads")}
          value={
            leads
              ? f.num(leads.value, "count")
              : v.leadsFromPipeline
                ? f.num(v.leadsFromPipeline, "count")
                : null
          }
          cls={leads?.cls ?? "manual"}
          source={leads ? t("bi.src.metric", { s: leads.source }) : t("bi.src.pipeline")}
          period={period}
          missing={t("bi.miss.noLeads")}
        />
        <Figure
          label={t("bi.fig.goalProgress")}
          value={
            progress.length
              ? `${f.num(progress.reduce((s, g) => s + g.progress!, 0) / progress.length, "percent")}`
              : null
          }
          cls="manual"
          source={t("bi.src.goals")}
          period={t("bi.period.now")}
          missing={t("bi.miss.noGoalTargets")}
          note={
            progress.length
              ? t("bi.note.goals", { n: progress.length, total: v.goals.length })
              : undefined
          }
        />
        <Figure
          label={t("bi.fig.aiCredits")}
          value={f.num(v.credits, "count")}
          cls="actual"
          source={t("bi.src.runs")}
          period={period}
        />
        {kpiFigure("cac")}
        {kpiFigure("roas")}
        {kpiFigure("roi")}
        {kpiFigure("retention_rate")}
      </div>
      {!d.revenue.length && (
        <p className="mt-3 text-xs text-muted-foreground">
          {t("bi.noRevenueYet")}{" "}
          <Link to="/app/revenue" className="text-primary hover:underline">
            {t("bi.openRevenue")}
          </Link>
        </p>
      )}
    </Section>
  );
}

export function kpiValue(x: Kpi, f: ReturnType<typeof useFmt>) {
  if (x.value === null) return "";
  if (x.unit === "currency")
    return x.currency ? f.money(x.value, x.currency) : f.num(x.value, "count");
  if (x.unit === "ratio") return `${f.num(x.value, "ratio")}×`;
  if (x.unit === "days" || x.unit === "months")
    return `${f.num(x.value, "count")} ${x.unit === "days" ? "d" : "m"}`;
  return f.num(x.value, x.unit);
}
export function missingText(x: Kpi, t: ReturnType<typeof useI18n>["t"]) {
  return t(tk(`bi.reason.${x.reason}`), {
    m: x.missing.map((k) => t(tk(`bi.input.${k}`))).join(", "),
  });
}

function Indicators({ v }: { v: View }) {
  const { t } = useI18n();
  const f = useFmt();
  const cats = ["marketing", "sales", "retention", "financial"] as const;
  return (
    <Section
      title={t("bi.kpis.title")}
      intro={
        v.models.length
          ? t("bi.kpis.models", { m: v.models.map((m) => t(tk(`bi.modelTag.${m}`))).join(", ") })
          : t("bi.kpis.noModel")
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {cats.map((c) => {
          const list = v.kpis.filter((k) => KPI_CATEGORY[k.key] === c);
          if (!list.length) return null;
          return (
            <div key={c} className="rounded-lg border border-border bg-card p-3">
              <h3 className="text-xs font-semibold">{t(tk(`bi.cat.${c}`))}</h3>
              <ul className="mt-2 divide-y divide-border">
                {list.map((k) => (
                  <li
                    key={k.key}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-1.5 text-xs"
                  >
                    <span className="min-w-0">{t(tk(`bi.kpi.${k.key}`))}</span>
                    {k.value !== null ? (
                      <span className="flex items-center gap-2 font-medium">
                        {kpiValue(k, f)}
                        <ClassBadge cls={k.cls} />
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">{missingText(k, t)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {t("bi.kpis.how")}{" "}
        <Link to="/app/performance" className="text-primary hover:underline">
          {t("bi.openPerformance")}
        </Link>
      </p>
    </Section>
  );
}

export function GrowthActions({
  actions,
  compact,
}: {
  actions: GrowthAction[];
  compact?: boolean;
}) {
  const { t } = useI18n();
  const shown = compact ? actions.slice(0, 3) : actions;
  const body = !shown.length ? (
    <p className="text-xs text-muted-foreground">{t("bi.actions.none")}</p>
  ) : (
    <ol className="space-y-2">
      {shown.map((a, i) => (
        <li key={a.id} className="rounded-lg border border-border bg-card p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <span className="mr-2 text-xs font-semibold text-muted-foreground">{i + 1}</span>
              <span className="text-sm font-medium">{actionTitle(a, t)}</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                kind={a.category === "problem" || a.category === "immediate" ? "low" : "medium"}
              >
                {t(tk(`bi.catAct.${a.category}`))}
              </Badge>
              <span className="text-xs font-semibold">{a.score}</span>
            </div>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <QualityBadge q={a.quality} />
            {a.uncertain && <span className="text-[11px] text-muted-foreground">{t("ev.indicative")}</span>}
            {a.alsoSuggested?.length ? (
              <span className="text-[11px] text-muted-foreground">{t("bi.actions.alsoSuggested", { n: a.alsoSuggested.length })}</span>
            ) : null}
          </div>
          {!compact && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t("bi.actions.why", {
                v: a.components.value,
                i: a.components.importance,
                u: a.components.urgency,
                c: a.components.confidence,
                f: a.components.feasibility,
                r: a.components.risk,
              })}
            </p>
          )}
          <p className="mt-1 text-[11px]">
            {t("bi.actions.ifDelayed")} {t(tk(`bi.delay.${a.delay}`))}
          </p>
          {a.blockers.length > 0 && (
            <p className="mt-1 flex flex-wrap gap-1">
              {a.blockers.map((b) => (
                <Badge key={b} kind="low">
                  {t(tk(`bi.blocker.${b}`))}
                </Badge>
              ))}
            </p>
          )}
          <Link to={a.to} className="mt-1 inline-block text-[11px] text-primary hover:underline">
            {t("bi.actions.open")}
          </Link>
        </li>
      ))}
    </ol>
  );
  if (compact) return body;
  return (
    <Section title={t("bi.actions.title")} intro={t("bi.actions.intro")}>
      {body}
    </Section>
  );
}
export function actionTitle(a: GrowthAction, t: ReturnType<typeof useI18n>["t"]) {
  return a.kind === "finding"
    ? t(tk(`bi.cand.${a.code}.title`), a.vars)
    : t(tk(`bi.act.${a.kind}`), a.vars);
}

function Comparison({ d, model }: { d: BiData; model: Model }) {
  const { t } = useI18n();
  const f = useFmt();
  const [dim, setDim] = useState<Dimension>("campaign");
  const groups = useMemo(() => {
    const all = attribute(d.revenue, d.touches, model);
    const byChannel = attribute(d.revenue, d.touches, model, undefined, undefined, "channel");
    const map = new Map<string, Record<string, number>>();
    for (const a of [...all, ...byChannel])
      for (const c of a.credits)
        map.set(c.key, {
          ...(map.get(c.key) ?? {}),
          [a.currency]: (map.get(c.key)?.[a.currency] ?? 0) + c.amount,
        });
    const first = new Map<string, string>();
    for (const m of d.metrics)
      if (m.campaign_id)
        for (const r of d.measurements)
          if (r.metric_id === m.id && r.kind.endsWith("actual")) {
            const cur = first.get(m.campaign_id);
            if (!cur || r.period_end < cur) first.set(m.campaign_id, r.period_end);
          }
    const monthly = new Map<
      string,
      {
        attributed: Record<string, number>;
        spend: Record<string, { planned: number; actual: number }>;
      }
    >();
    for (let i = 1; i <= 6; i++) {
      const now = new Date();
      const r = periodRange(
        "last_month",
        new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (i - 1), 15)),
      );
      const at: Record<string, number> = {};
      for (const a of attribute(d.revenue, d.touches, model, r.from, r.to))
        at[a.currency] = a.attributed;
      const sp: Record<string, { planned: number; actual: number }> = {};
      for (const b of d.budget)
        if (b.period_month >= r.from && b.period_month <= r.to) {
          const e = (sp[b.currency] ??= { planned: 0, actual: 0 });
          e.planned += Number(b.planned);
          e.actual += Number(b.actual);
        }
      monthly.set(r.from.slice(0, 7), { attributed: at, spend: sp });
    }
    return compare(dim, buildRows(dim, { ...d, credits: [], firstResult: first, monthly }, map));
  }, [d, model, dim]);
  const label = (id: string, l: string) =>
    id.startsWith("specialist:") ? t(tk(`run.sp.${l}`)) : l;
  return (
    <Section title={t("bi.cmp.title")} intro={t("bi.cmp.intro")}>
      <div role="tablist" aria-label={t("bi.cmp.dimension")} className="mb-3 flex flex-wrap gap-1">
        {DIMENSIONS.map((x) => (
          <button
            key={x}
            role="tab"
            aria-selected={dim === x}
            onClick={() => setDim(x)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs",
              dim === x ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/50",
            )}
          >
            {t(tk(`bi.dim.${x}`))}
          </button>
        ))}
      </div>
      {!groups.length ? (
        <p className="text-xs text-muted-foreground">{t("bi.cmp.none")}</p>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.key} className="rounded-lg border border-border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2 text-[11px]">
                <span className="font-medium">
                  {g.objective && !["channel", "execution", "period"].includes(g.objective)
                    ? t("bi.cmp.objective", { o: g.objective.replace("|", " · ") })
                    : t(tk(`bi.dim.${dim}`))}
                  {g.horizon !== "n/a" ? ` · ${t(tk(`bi.horizon.${g.horizon}`))}` : ""}
                </span>
                <Badge kind={g.comparable ? "high" : "none"}>
                  {g.comparable
                    ? t("bi.cmp.ranked")
                    : dim === "period"
                      ? t("bi.cmp.timeline")
                      : t("bi.cmp.notRanked")}
                </Badge>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-[11px]">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      {[
                        "rank",
                        "name",
                        "progress",
                        "budget",
                        "credits",
                        "attributed",
                        "first",
                        "tasks",
                        "runs",
                      ].map((h) => (
                        <th key={h} className="px-3 py-1.5 font-medium">
                          {t(tk(`bi.col.${h}`))}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {g.rows.map((r) => (
                      <tr key={r.id} className="align-top">
                        <td className="px-3 py-1.5">{r.rank ?? "—"}</td>
                        <td className="px-3 py-1.5">
                          <div className="font-medium">{label(r.id, r.label)}</div>
                          {r.reasons.length > 0 && (
                            <div className="mt-0.5 text-muted-foreground">
                              {r.reasons.map((x) => t(tk(`bi.why.${x.code}`), x.vars)).join(" · ")}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          {r.progress === null ? "—" : f.num(r.progress, "percent")}
                        </td>
                        <td className="px-3 py-1.5">
                          {budgetUse(r.budget)
                            .map(
                              (b) =>
                                `${f.money(b.actual, b.currency)} / ${f.money(b.planned, b.currency)}`,
                            )
                            .join(" · ") || "—"}
                        </td>
                        <td className="px-3 py-1.5">{r.credits}</td>
                        <td className="px-3 py-1.5">
                          {f.moneyList(
                            Object.entries(r.attributed).map(([currency, amount]) => ({
                              currency,
                              amount,
                            })),
                          ) ?? "—"}
                        </td>
                        <td className="px-3 py-1.5">
                          {r.daysToFirstResult === null ? "—" : `${r.daysToFirstResult} d`}
                        </td>
                        <td className="px-3 py-1.5">
                          {r.tasksTotal ? `${r.tasksDone}/${r.tasksTotal}` : "—"}
                        </td>
                        <td className="px-3 py-1.5">
                          {r.runs.succeeded + r.runs.failed
                            ? `${r.runs.succeeded}✓ ${r.runs.failed}✗`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
      <details className="mt-3 text-[11px] text-muted-foreground">
        <summary className="cursor-pointer">{t("bi.cmp.assumptions")}</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {ASSUMPTIONS.map((a) => (
            <li key={a}>{t(tk(`bi.assume.${a}`), { m: t(tk(`bi.model.${model}`)) })}</li>
          ))}
        </ul>
      </details>
    </Section>
  );
}

function Understanding({ v }: { v: View }) {
  const { t } = useI18n();
  const missing = v.understanding.filter((k) => k.status === "missing").length;
  return (
    <Section
      title={t("bi.und.title")}
      intro={missing ? t("bi.und.gaps", { n: missing }) : t("bi.und.complete")}
      action={
        <Link to="/app/profile" className="text-xs text-primary hover:underline">
          {t("bi.und.open")}
        </Link>
      }
    >
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {AREAS.map((area) => {
          const k = v.understanding.find((x) => x.area === area)!;
          return (
            <li
              key={area}
              className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs"
            >
              <span>{t(tk(`bi.area.${area}`))}</span>
              <Badge
                kind={
                  k.status === "verified" ? "high" : k.status === "indicated" ? "medium" : "low"
                }
              >
                {t(tk(`bi.und.${k.status}`))}
              </Badge>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function Units({ d }: { d: BiData }) {
  const o = useOrg();
  const { t } = useI18n();
  const qc = useQueryClient();
  const admin = can(o.workspaceRole, "approvals.decide");
  const [kind, setKind] = useState("brand");
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [busy, setBusy] = useState(false);
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!o.workspace || !name.trim()) return;
    setBusy(true);
    const r = await growthDb.rpc("create_business_unit", {
      _workspace: o.workspace.id,
      _kind: kind,
      _name: name.trim(),
      _parent: parent || null,
    });
    setBusy(false);
    if (r.error) {
      toast.error(t("bi.failed", { e: r.error.message }));
      return;
    }
    toast.success(t("bi.units.added"));
    setName("");
    void qc.invalidateQueries({ queryKey: biKey(o.org?.id, o.workspace?.id) });
  }
  return (
    <Section title={t("bi.units.title")} intro={t("bi.units.intro")}>
      {d.units.length ? (
        <ul className="flex flex-wrap gap-2">
          {d.units.map((u) => (
            <li key={u.id} className="rounded-md border border-border bg-card px-2.5 py-1 text-xs">
              {u.name}{" "}
              <span className="text-muted-foreground">
                · {t(tk(`bi.unitKind.${u.kind}`))}
                {u.parent_id ? ` · ${d.units.find((x) => x.id === u.parent_id)?.name ?? ""}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{t("bi.units.none")}</p>
      )}
      {admin && (
        <form
          onSubmit={add}
          className="mt-3 flex flex-wrap items-end gap-2"
          aria-label={t("bi.units.add")}
        >
          <label className="text-[11px]">
            <span className="mb-1 block font-medium">{t("bi.units.kind")}</span>
            <select className={sel} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="brand">{t("bi.unitKind.brand")}</option>
              <option value="unit">{t("bi.unitKind.unit")}</option>
            </select>
          </label>
          <label className="text-[11px]">
            <span className="mb-1 block font-medium">{t("bi.units.name")}</span>
            <Input
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              className="h-8 w-48"
            />
          </label>
          <label className="text-[11px]">
            <span className="mb-1 block font-medium">{t("bi.units.parent")}</span>
            <select className={sel} value={parent} onChange={(e) => setParent(e.target.value)}>
              <option value="">{t("bi.units.noParent")}</option>
              {d.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" size="sm" disabled={busy || !name.trim()}>
            {t("bi.units.add")}
          </Button>
        </form>
      )}
    </Section>
  );
}
