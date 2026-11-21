import { useMemo, useState } from "react";
import { kpiQuality, type KpiQuality } from "@/lib/kpi-periods";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Archive, ArchiveRestore, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { hasRole } from "@/lib/permissions";
import { growthDb as db, isNotInstalled, PERFORMANCE_NOT_INSTALLED } from "@/lib/pending-schema";
import { correctionHistory, effectiveMeasurements, formatMetricValue, KIND_LABEL, metricStatus, monthlySeries, summarizeMetric, USER_KINDS, type MeasurementKind } from "@/lib/performance";
import { SOURCE_LABEL } from "@/lib/integrations/read-only";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { goalLinksOptions, initiativeLinksOptions, invalidatePerformance, measurementsOptions, metricsOptions, UNITS, type Metric } from "./data";
import { MetricChart, RecordValueForm, Reliability, sel, statusClass } from "./parts";
import { PerformanceShell } from "./performance-board";

export function MetricDetail({ metricId }: { metricId: string }) {
  const { workspace, org, workspaceRole, loading } = useOrg();
  const { t } = useI18n();
  if (loading) return <p className="p-6 text-muted-foreground">{t("performance.loading")}</p>;
  if (!workspace || !org) return <p className="p-6 text-muted-foreground">{t("performance.chooseWsShort")}</p>;
  return <Detail key={`${org.id}:${workspace.id}:${metricId}`} wsId={workspace.id} metricId={metricId} canEdit={hasRole(workspaceRole, "member")} />;
}

type Correcting = { id: string; month: string; kind: MeasurementKind; value: number } | null;

function Detail({ wsId, metricId, canEdit }: { wsId: string; metricId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const { t, tag } = useI18n();
  const metrics = useQuery(metricsOptions(wsId));
  const values = useQuery({ ...measurementsOptions(wsId), enabled: metrics.isSuccess });
  const goals = useQuery({ ...goalLinksOptions(wsId), enabled: metrics.isSuccess });
  const initiatives = useQuery({ ...initiativeLinksOptions(wsId), enabled: metrics.isSuccess });
  const metric = metrics.data?.find(m => m.id === metricId);
  const rows = useMemo(() => (values.data ?? []).filter(v => v.metric_id === metricId), [values.data, metricId]);
  const [recording, setRecording] = useState<false | Correcting>(false);
  const [editing, setEditing] = useState(false);
  const [kindFilter, setKindFilter] = useState<"all" | MeasurementKind>("all");
  const refresh = () => invalidatePerformance(qc, wsId);

  if (metrics.isError && isNotInstalled(metrics.error)) return <PerformanceShell back><div className="rounded-lg border border-warning/30 bg-warning/5 p-4 text-sm">{PERFORMANCE_NOT_INSTALLED}</div></PerformanceShell>;
  if (metrics.isLoading) return <PerformanceShell back><p className="text-sm text-muted-foreground">{t("performance.loading")}</p></PerformanceShell>;
  if (metrics.isError) return <PerformanceShell back><p className="text-sm text-destructive">{t("performance.loadOne")}</p></PerformanceShell>;
  if (!metric) return <PerformanceShell back title={t("performance.notFound")}><p className="text-sm text-muted-foreground">{t("performance.notFoundBody")}</p></PerformanceShell>;

  const fmt = (v: number) => formatMetricValue(v, metric.unit, metric.currency, tag);
  const s = summarizeMetric(metric, rows);
  const status = metricStatus(s);
  const points = monthlySeries(rows);
  const live = new Set(effectiveMeasurements(rows).map(r => r.id));
  const current = effectiveMeasurements(rows).filter(r => kindFilter === "all" || r.kind === kindFilter).sort((a, b) => (a.period_start < b.period_start ? 1 : -1));
  const goal = goals.data?.find(g => g.id === metric.goal_id);
  const initiative = initiatives.data?.find(g => g.id === metric.initiative_id);

  const setArchived = async (archived: boolean) => {
    const r = await db.rpc("update_metric_definition", { _metric: metric.id, _patch: { archived } });
    if (r.error) return void toast.error(t("performance.updateFailed"));
    toast.success(archived ? t("performance.archivedOk") : t("performance.restoredOk")); await refresh();
  };

  return (
    <PerformanceShell back title={metric.label}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="outline">{UNITS[metric.unit] ? t(`performance.unit.${metric.unit}` as MessageKey) : metric.unit}{metric.currency ? ` · ${metric.currency}` : ""}</Badge>
        <Badge variant="outline">{metric.direction === "decrease" ? t("performance.lower") : t("performance.higher")}</Badge>
        {metric.archived && <Badge variant="secondary">{t("performance.archived")}</Badge>}
        {goal ? <Link to="/app/goals" className="text-xs underline-offset-2 hover:underline">{t("performance.goalX", { t: goal.title })}</Link> : metric.goal_id ? <span className="text-xs text-muted-foreground">{t("performance.goalArchived")}</span> : null}
        {initiative && <Link to="/app/goals" className="text-xs underline-offset-2 hover:underline">{t("performance.initiativeX", { t: initiative.title })}</Link>}
        <span className={`ml-auto text-sm font-medium ${statusClass(status)}`}>{t(`performance.status.${status}`)}</span>
      </div>

      {canEdit && (
        <div className="flex flex-wrap gap-2">
          {!metric.archived && <Button size="sm" onClick={() => setRecording(null)}><Plus className="h-4 w-4" /> {t("performance.record")}</Button>}
          <Button size="sm" variant="outline" onClick={() => setEditing(!editing)}><Pencil className="h-4 w-4" /> {t("performance.edit")}</Button>
          {metric.archived ? <Button size="sm" variant="ghost" onClick={() => setArchived(false)}><ArchiveRestore className="h-4 w-4" /> {t("performance.restore")}</Button> : <Button size="sm" variant="ghost" onClick={() => setArchived(true)}><Archive className="h-4 w-4" /> {t("performance.archive")}</Button>}
        </div>
      )}
      {editing && <EditMetric metric={metric} goals={goals.data ?? []} initiatives={initiatives.data ?? []} onDone={async saved => { setEditing(false); if (saved) await refresh(); }} />}
      {recording !== false && <RecordValueForm key={recording?.id ?? "new"} metric={metric} correcting={recording} onDone={async saved => { setRecording(false); if (saved) await refresh(); }} />}

      <MeasurementQuality q={kpiQuality(rows, metric.id, new Date().toISOString().slice(0, 10))} />
      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 font-medium">{t("performance.monthByMonth")}</h2>
        {points.length === 0 ? <p className="text-sm text-muted-foreground">{t("performance.noValues")}</p> : <>
          <MetricChart points={points.slice(-24)} metric={metric} />
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 font-normal">{t("performance.month")}</th><th className="font-normal">{t("performance.plan")}</th><th className="font-normal">{t("performance.estimate")}</th><th className="font-normal">{t("performance.result")}</th><th className="font-normal">{t("performance.vsPlan")}</th><th className="font-normal">{t("performance.reliability")}</th></tr></thead>
              <tbody>{[...points].reverse().map(p => {
                const variance = p.actual != null && p.planned != null ? p.actual - p.planned : null;
                const good = variance == null ? null : metric.direction === "decrease" ? variance <= 0 : variance >= 0;
                return <tr key={p.month} className="border-b last:border-0"><td className="py-2">{p.month}</td><td>{p.planned != null ? fmt(p.planned) : "—"}</td><td>{p.forecast != null ? fmt(p.forecast) : "—"}</td><td>{p.actual != null ? fmt(p.actual) : "—"}</td><td className={good == null ? "text-muted-foreground" : good ? "text-success" : "text-destructive"}>{variance == null ? "—" : `${variance > 0 ? "+" : ""}${fmt(variance)}`}</td><td><Reliability kind={p.actualKind} /></td></tr>;
              })}</tbody>
            </table>
          </div>
        </>}
      </section>

      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="font-medium">{t("performance.valuesCorrections")}</h2>
          <select aria-label={t("performance.filterType")} className={`${sel} ml-auto`} value={kindFilter} onChange={e => setKindFilter(e.target.value as typeof kindFilter)}>
            <option value="all">{t("performance.allTypes")}</option>{(Object.keys(KIND_LABEL) as MeasurementKind[]).map(k => <option key={k} value={k}>{t(`performance.kind.${k}`)}</option>)}
          </select>
        </div>
        {current.length === 0 ? <p className="text-sm text-muted-foreground">{t("performance.noType")}</p> : (
          <ul className="divide-y rounded-md border text-sm">
            {current.map(r => {
              const chain = correctionHistory(rows, r.id);
              return (
                <li key={r.id} className="space-y-1 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.period_start.slice(0, 7)}</span>
                    <span>{KIND_LABEL[r.kind as MeasurementKind] ? t(`performance.kind.${r.kind as MeasurementKind}`) : r.kind}</span>
                    <span>{fmt(Number(r.value))}</span>
                    <Reliability kind={r.kind as MeasurementKind} />
                    {chain.length > 1 && <Badge variant="outline">{t("performance.correctedN", { n: chain.length - 1 })}</Badge>}
                    {r.kind === "imported_actual" && r.source && <span className="text-xs text-muted-foreground">{t("performance.fromSource", { s: SOURCE_LABEL[r.source] ?? r.source })}</span>}
                    {canEdit && !metric.archived && live.has(r.id) && (USER_KINDS as readonly string[]).includes(r.kind) && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setRecording({ id: r.id, month: r.period_start.slice(0, 7), kind: r.kind as MeasurementKind, value: Number(r.value) })}>{t("performance.correct")}</Button>}
                  </div>
                  {r.note && <p className="text-xs text-muted-foreground">{r.note}</p>}
                  {chain.length > 1 && (
                    <ol className="ml-3 border-l pl-3 text-xs text-muted-foreground" aria-label={t("performance.earlier")}>
                      {chain.slice(0, -1).map(c => <li key={c.id}><span className="line-through">{fmt(Number(c.value))}</span> · {t("performance.recorded", { d: new Date(c.created_at).toLocaleDateString(tag) })}{c.note ? ` — ${c.note}` : ""}</li>)}
                    </ol>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </PerformanceShell>
  );
}

function EditMetric({ metric, goals, initiatives, onDone }: { metric: Metric; goals: { id: string; title: string }[]; initiatives: { id: string; title: string }[]; onDone: (saved: boolean) => Promise<void> }) {
  const [v, setV] = useState({ label: metric.label, direction: metric.direction, goal: metric.goal_id ?? "", initiative: metric.initiative_id ?? "" });
  const [busy, setBusy] = useState(false);
  const { t } = useI18n();
  const save = async () => {
    if (!v.label.trim()) return void toast.error(t("performance.needsName"));
    setBusy(true);
    const r = await db.rpc("update_metric_definition", { _metric: metric.id, _patch: { label: v.label.trim(), direction: v.direction, goal_id: v.goal, initiative_id: v.initiative } });
    setBusy(false);
    if (r.error) return void toast.error(t("performance.changesFailed"));
    toast.success(t("performance.updated")); await onDone(true);
  };
  return (
    <div className="space-y-2 rounded-md border bg-card p-3">
      <p className="text-xs text-muted-foreground">{t("performance.fixedUnit")}</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Input aria-label={t("performance.name")} value={v.label} maxLength={120} onChange={e => setV({ ...v, label: e.target.value })} />
        <select aria-label={t("performance.betterWhen")} className={sel} value={v.direction} onChange={e => setV({ ...v, direction: e.target.value })}><option value="increase">{t("performance.higher")}</option><option value="decrease">{t("performance.lower")}</option></select>
        <select aria-label={t("performance.linkedGoal")} className={sel} value={v.goal} onChange={e => setV({ ...v, goal: e.target.value })}><option value="">{t("performance.noGoal")}</option>{goals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}</select>
        <select aria-label={t("performance.linkedInitiative")} className={sel} value={v.initiative} onChange={e => setV({ ...v, initiative: e.target.value })}><option value="">{t("performance.noInitiative")}</option>{initiatives.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}</select>
      </div>
      <div className="flex gap-2"><Button size="sm" onClick={save} disabled={busy}>{busy ? t("performance.saving") : t("performance.saveChanges")}</Button><Button size="sm" variant="ghost" onClick={() => onDone(false)}>{t("performance.cancel")}</Button></div>
    </div>
  );
}

/** Whether this metric's results can be compared over time: period lengths, gaps, overlaps, corrections and age. */
function MeasurementQuality({ q }: { q: KpiQuality }) {
  const { t } = useI18n();
  const issues = [
    q.mixedLengths && t("kp.mixed"),
    q.gaps > 0 && t("kp.gaps", { n: q.gaps }),
    q.overlaps > 0 && t("kp.overlaps", { n: q.overlaps }),
    q.corrections > 0 && t("kp.corrections", { n: q.corrections }),
    q.staleDays !== null && q.staleDays > 45 && t("kp.stale", { n: q.staleDays }),
  ].filter((x): x is string => !!x);
  return (
    <section aria-label={t("kp.title")} className="rounded-lg border bg-card p-4 text-sm">
      <h2 className="mb-1 font-medium">{t("kp.title")}</h2>
      {q.periods === 0 ? <p className="text-muted-foreground">{t("kp.none")}</p> : <>
        <p className="text-muted-foreground">{t("kp.periods", { n: q.periods, d: q.lastPeriodEnd ?? "" })}</p>
        {issues.length === 0 ? <p>{t("kp.clean")}</p> : <ul className="mt-1 list-disc pl-5 text-warning">{issues.map((x) => <li key={x}>{x}</li>)}</ul>}
      </>}
    </section>
  );
}
