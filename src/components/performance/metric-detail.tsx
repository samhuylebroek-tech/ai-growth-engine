import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Archive, ArchiveRestore, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { hasRole } from "@/lib/permissions";
import { growthDb as db, isNotInstalled, PERFORMANCE_NOT_INSTALLED } from "@/lib/pending-schema";
import { correctionHistory, effectiveMeasurements, formatMetricValue, KIND_LABEL, metricStatus, monthlySeries, STATUS_LABEL, summarizeMetric, type MeasurementKind } from "@/lib/performance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { goalLinksOptions, initiativeLinksOptions, invalidatePerformance, measurementsOptions, metricsOptions, UNITS, type Metric } from "./data";
import { MetricChart, RecordValueForm, Reliability, sel, statusClass } from "./parts";
import { PerformanceShell } from "./performance-board";

export function MetricDetail({ metricId }: { metricId: string }) {
  const { workspace, org, workspaceRole, loading } = useOrg();
  if (loading) return <p className="p-6 text-muted-foreground">Loading…</p>;
  if (!workspace || !org) return <p className="p-6 text-muted-foreground">Choose a workspace.</p>;
  return <Detail key={`${org.id}:${workspace.id}:${metricId}`} wsId={workspace.id} metricId={metricId} canEdit={hasRole(workspaceRole, "member")} />;
}

type Correcting = { id: string; month: string; kind: MeasurementKind; value: number } | null;

function Detail({ wsId, metricId, canEdit }: { wsId: string; metricId: string; canEdit: boolean }) {
  const qc = useQueryClient();
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
  if (metrics.isLoading) return <PerformanceShell back><p className="text-sm text-muted-foreground">Loading…</p></PerformanceShell>;
  if (metrics.isError) return <PerformanceShell back><p className="text-sm text-destructive">This metric could not be loaded. Try again in a moment.</p></PerformanceShell>;
  if (!metric) return <PerformanceShell back title="Metric not found"><p className="text-sm text-muted-foreground">This metric does not exist in this workspace, or you no longer have access to it.</p></PerformanceShell>;

  const fmt = (v: number) => formatMetricValue(v, metric.unit, metric.currency);
  const s = summarizeMetric(metric, rows);
  const status = metricStatus(s);
  const points = monthlySeries(rows);
  const live = new Set(effectiveMeasurements(rows).map(r => r.id));
  const current = effectiveMeasurements(rows).filter(r => kindFilter === "all" || r.kind === kindFilter).sort((a, b) => (a.period_start < b.period_start ? 1 : -1));
  const goal = goals.data?.find(g => g.id === metric.goal_id);
  const initiative = initiatives.data?.find(g => g.id === metric.initiative_id);

  const setArchived = async (archived: boolean) => {
    const r = await db.rpc("update_metric_definition", { _metric: metric.id, _patch: { archived } });
    if (r.error) return void toast.error("Could not update the metric.");
    toast.success(archived ? "Metric archived. Its history is kept." : "Metric restored."); await refresh();
  };

  return (
    <PerformanceShell back title={metric.label}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="outline">{UNITS[metric.unit] ?? metric.unit}{metric.currency ? ` · ${metric.currency}` : ""}</Badge>
        <Badge variant="outline">{metric.direction === "decrease" ? "Lower is better" : "Higher is better"}</Badge>
        {metric.archived && <Badge variant="secondary">Archived</Badge>}
        {goal ? <Link to="/app/goals" className="text-xs underline-offset-2 hover:underline">Goal: {goal.title}</Link> : metric.goal_id ? <span className="text-xs text-muted-foreground">Linked goal is archived</span> : null}
        {initiative && <Link to="/app/goals" className="text-xs underline-offset-2 hover:underline">Initiative: {initiative.title}</Link>}
        <span className={`ml-auto text-sm font-medium ${statusClass(status)}`}>{STATUS_LABEL[status]}</span>
      </div>

      {canEdit && (
        <div className="flex flex-wrap gap-2">
          {!metric.archived && <Button size="sm" onClick={() => setRecording(null)}><Plus className="h-4 w-4" /> Record value</Button>}
          <Button size="sm" variant="outline" onClick={() => setEditing(!editing)}><Pencil className="h-4 w-4" /> Edit details</Button>
          {metric.archived ? <Button size="sm" variant="ghost" onClick={() => setArchived(false)}><ArchiveRestore className="h-4 w-4" /> Restore</Button> : <Button size="sm" variant="ghost" onClick={() => setArchived(true)}><Archive className="h-4 w-4" /> Archive</Button>}
        </div>
      )}
      {editing && <EditMetric metric={metric} goals={goals.data ?? []} initiatives={initiatives.data ?? []} onDone={async saved => { setEditing(false); if (saved) await refresh(); }} />}
      {recording !== false && <RecordValueForm key={recording?.id ?? "new"} metric={metric} correcting={recording} onDone={async saved => { setRecording(false); if (saved) await refresh(); }} />}

      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 font-medium">Month by month</h2>
        {points.length === 0 ? <p className="text-sm text-muted-foreground">No values yet.</p> : <>
          <MetricChart points={points.slice(-24)} metric={metric} />
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 font-normal">Month</th><th className="font-normal">Plan</th><th className="font-normal">Estimate</th><th className="font-normal">Result</th><th className="font-normal">Versus plan</th><th className="font-normal">Reliability</th></tr></thead>
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
          <h2 className="font-medium">Values and corrections</h2>
          <select aria-label="Filter values by type" className={`${sel} ml-auto`} value={kindFilter} onChange={e => setKindFilter(e.target.value as typeof kindFilter)}>
            <option value="all">All types</option>{(Object.keys(KIND_LABEL) as MeasurementKind[]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </div>
        {current.length === 0 ? <p className="text-sm text-muted-foreground">No values of this type.</p> : (
          <ul className="divide-y rounded-md border text-sm">
            {current.map(r => {
              const chain = correctionHistory(rows, r.id);
              return (
                <li key={r.id} className="space-y-1 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.period_start.slice(0, 7)}</span>
                    <span>{KIND_LABEL[r.kind as MeasurementKind] ?? r.kind}</span>
                    <span>{fmt(Number(r.value))}</span>
                    <Reliability kind={r.kind as MeasurementKind} />
                    {chain.length > 1 && <Badge variant="outline">Corrected {chain.length - 1}×</Badge>}
                    {canEdit && !metric.archived && live.has(r.id) && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setRecording({ id: r.id, month: r.period_start.slice(0, 7), kind: r.kind as MeasurementKind, value: Number(r.value) })}>Correct</Button>}
                  </div>
                  {r.note && <p className="text-xs text-muted-foreground">{r.note}</p>}
                  {chain.length > 1 && (
                    <ol className="ml-3 border-l pl-3 text-xs text-muted-foreground" aria-label="Earlier values">
                      {chain.slice(0, -1).map(c => <li key={c.id}><span className="line-through">{fmt(Number(c.value))}</span> · recorded {new Date(c.created_at).toLocaleDateString()}{c.note ? ` — ${c.note}` : ""}</li>)}
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
  const save = async () => {
    if (!v.label.trim()) return void toast.error("A metric needs a name.");
    setBusy(true);
    const r = await db.rpc("update_metric_definition", { _metric: metric.id, _patch: { label: v.label.trim(), direction: v.direction, goal_id: v.goal, initiative_id: v.initiative } });
    setBusy(false);
    if (r.error) return void toast.error("Could not save the changes.");
    toast.success("Metric updated."); await onDone(true);
  };
  return (
    <div className="space-y-2 rounded-md border bg-card p-3">
      <p className="text-xs text-muted-foreground">Unit and currency stay fixed so earlier values keep their meaning. Define a new metric to measure in another unit.</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Input aria-label="Metric name" value={v.label} maxLength={120} onChange={e => setV({ ...v, label: e.target.value })} />
        <select aria-label="Better when" className={sel} value={v.direction} onChange={e => setV({ ...v, direction: e.target.value })}><option value="increase">Higher is better</option><option value="decrease">Lower is better</option></select>
        <select aria-label="Linked goal" className={sel} value={v.goal} onChange={e => setV({ ...v, goal: e.target.value })}><option value="">No goal</option>{goals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}</select>
        <select aria-label="Linked initiative" className={sel} value={v.initiative} onChange={e => setV({ ...v, initiative: e.target.value })}><option value="">No initiative</option>{initiatives.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}</select>
      </div>
      <div className="flex gap-2"><Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button><Button size="sm" variant="ghost" onClick={() => onDone(false)}>Cancel</Button></div>
    </div>
  );
}
