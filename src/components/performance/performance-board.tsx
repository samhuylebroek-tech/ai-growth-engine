import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { LineChart, Plus, ArrowUpRight, Search } from "lucide-react";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { hasRole } from "@/lib/permissions";
import { growthDb as db, isNotInstalled, PERFORMANCE_NOT_INSTALLED } from "@/lib/pending-schema";
import { summarizeMetric, metricKey, formatMetricValue, monthlySeries, metricStatus, STATUS_LABEL, type MetricStatus, type Measurement } from "@/lib/performance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { metricsOptions, measurementsOptions, goalLinksOptions, initiativeLinksOptions, invalidatePerformance, UNITS, errMsg, type Metric } from "./data";
import { MetricChart, Reliability, RecordValueForm, sel, statusClass } from "./parts";

export function PerformanceBoard() {
  const { workspace, org, workspaceRole, loading } = useOrg();
  if (loading) return <p className="p-6 text-muted-foreground">Loading…</p>;
  if (!workspace || !org) return <p className="p-6 text-muted-foreground">Choose a workspace to track performance.</p>;
  return <Board key={`${org.id}:${workspace.id}`} wsId={workspace.id} canEdit={hasRole(workspaceRole, "member")} />;
}

export function PerformanceShell({ children, title = "Performance", back }: { children: React.ReactNode; title?: string; back?: boolean }) {
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        {back && <Link to="/app/performance" className="text-xs text-muted-foreground hover:text-foreground">← All metrics</Link>}
        <h1 className="flex items-center gap-2 text-2xl font-semibold"><LineChart className="h-6 w-6 shrink-0" /> <span className="min-w-0 break-words">{title}</span></h1>
        {!back && <p className="text-sm text-muted-foreground">Define the numbers that matter, then record plans, estimates and results per month. Values here are entered by your team; no analytics, ad or payment source is connected, so nothing is marked as verified. Corrections never overwrite history.</p>}
      </header>
      {children}
    </div>
  );
}

type Filters = { q: string; goal: string; initiative: string; status: MetricStatus | "all"; archived: boolean };

function Board({ wsId, canEdit }: { wsId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const metrics = useQuery(metricsOptions(wsId));
  const values = useQuery({ ...measurementsOptions(wsId), enabled: metrics.isSuccess });
  const goals = useQuery({ ...goalLinksOptions(wsId), enabled: metrics.isSuccess });
  const initiatives = useQuery({ ...initiativeLinksOptions(wsId), enabled: metrics.isSuccess });
  const goalTitle = useMemo(() => new Map((goals.data ?? []).map(g => [g.id, g.title] as const)), [goals.data]);
  const initiativeTitle = useMemo(() => new Map((initiatives.data ?? []).map(g => [g.id, g.title] as const)), [initiatives.data]);
  const [f, setF] = useState<Filters>({ q: "", goal: "", initiative: "", status: "all", archived: false });

  const rowsBy = useMemo(() => {
    const m = new Map<string, Measurement[]>();
    for (const v of values.data ?? []) m.set(v.metric_id, [...(m.get(v.metric_id) ?? []), v]);
    return m;
  }, [values.data]);
  const enriched = useMemo(() => (metrics.data ?? []).map(x => {
    const rows = rowsBy.get(x.id) ?? [];
    const summary = summarizeMetric(x, rows);
    return { metric: x, rows, summary, status: metricStatus(summary) };
  }), [metrics.data, rowsBy]);
  const visible = enriched.filter(e => (f.archived || !e.metric.archived)
    && (!f.q || e.metric.label.toLowerCase().includes(f.q.toLowerCase()))
    && (!f.goal || e.metric.goal_id === f.goal)
    && (!f.initiative || e.metric.initiative_id === f.initiative)
    && (f.status === "all" || e.status === f.status));
  const active = enriched.filter(e => !e.metric.archived);
  const counts = { on_track: active.filter(e => e.status === "on_track").length, behind: active.filter(e => e.status === "behind").length, open: active.filter(e => e.status === "no_result" || e.status === "no_data").length };

  if (metrics.isError && isNotInstalled(metrics.error)) {
    return <PerformanceShell><div className="rounded-lg border border-warning/30 bg-warning/5 p-4 text-sm">{PERFORMANCE_NOT_INSTALLED}</div></PerformanceShell>;
  }
  return (
    <PerformanceShell>
      {active.length > 0 && (
        <dl className="grid grid-cols-3 gap-3 rounded-lg border bg-card p-4 text-sm">
          <div><dt className="text-xs text-muted-foreground">On track</dt><dd className="text-xl font-semibold text-success">{counts.on_track}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Behind plan</dt><dd className="text-xl font-semibold text-destructive">{counts.behind}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Waiting for a result</dt><dd className="text-xl font-semibold">{counts.open}</dd></div>
        </dl>
      )}
      {canEdit && <AddMetric wsId={wsId} goals={goals.data ?? []} initiatives={initiatives.data ?? []} onSaved={() => invalidatePerformance(qc, wsId)} />}
      {(metrics.data ?? []).length > 0 && (
        <section aria-label="Filter metrics" className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[12rem] flex-1"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search metrics" placeholder="Search metrics" className="pl-8" value={f.q} onChange={e => setF({ ...f, q: e.target.value })} /></div>
          <select aria-label="Filter by status" className={sel} value={f.status} onChange={e => setF({ ...f, status: e.target.value as Filters["status"] })}><option value="all">All statuses</option>{(Object.keys(STATUS_LABEL) as MetricStatus[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
          <select aria-label="Filter by goal" className={sel} value={f.goal} onChange={e => setF({ ...f, goal: e.target.value })}><option value="">All goals</option>{(goals.data ?? []).map(g => <option key={g.id} value={g.id}>{g.title}</option>)}</select>
          {(initiatives.data ?? []).length > 0 && <select aria-label="Filter by initiative" className={sel} value={f.initiative} onChange={e => setF({ ...f, initiative: e.target.value })}><option value="">All initiatives</option>{(initiatives.data ?? []).map(g => <option key={g.id} value={g.id}>{g.title}</option>)}</select>}
          <label className="flex items-center gap-2 text-xs text-muted-foreground"><Checkbox checked={f.archived} onCheckedChange={v => setF({ ...f, archived: v === true })} />Show archived</label>
        </section>
      )}
      {metrics.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
        : metrics.isError ? <p className="text-sm text-destructive">Metrics could not be loaded. Try again in a moment.</p>
        : (metrics.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No metrics yet. Add the numbers that show whether your goals are being reached — for example revenue, leads or conversion rate.</p>
        : visible.length === 0 ? <p className="text-sm text-muted-foreground">No metrics match these filters.</p>
        : <div className="grid gap-3 md:grid-cols-2">{visible.map(e => <MetricCard key={e.metric.id} {...e} goal={e.metric.goal_id ? goalTitle.get(e.metric.goal_id) ?? null : null} initiative={e.metric.initiative_id ? initiativeTitle.get(e.metric.initiative_id) ?? null : null} canEdit={canEdit} onChange={() => invalidatePerformance(qc, wsId)} />)}</div>}
      {values.isError && !isNotInstalled(values.error) && <p className="text-sm text-destructive">Recorded values could not be loaded. Try again in a moment.</p>}
    </PerformanceShell>
  );
}

function AddMetric({ wsId, goals, initiatives, onSaved }: { wsId: string; goals: { id: string; title: string }[]; initiatives: { id: string; title: string }[]; onSaved: () => Promise<unknown> }) {
  const blank = { label: "", unit: "count", currency: "EUR", direction: "increase", goal: "", initiative: "" };
  const [m, setM] = useState(blank);
  const [saving, setSaving] = useState(false);
  const add = async () => {
    if (!m.label.trim()) return void toast.error("Name what you want to measure.");
    if (m.unit === "currency" && !/^[A-Za-z]{3}$/.test(m.currency.trim())) return void toast.error("Use a three-letter currency code, for example EUR.");
    setSaving(true);
    const r = await db.rpc("define_metric", { _workspace: wsId, _key: metricKey(m.label), _label: m.label.trim(), _unit: m.unit, _currency: m.unit === "currency" ? m.currency.trim().toUpperCase() : null, _direction: m.direction, _goal: m.goal || null, _initiative: m.initiative || null });
    setSaving(false);
    if (r.error) return void toast.error(/different unit or currency/.test(errMsg(r.error)) ? "A metric with this name already exists with another unit or currency." : "Could not save the metric.");
    toast.success((r.data as { status?: string } | null)?.status === "existing" ? "This metric already exists." : "Metric added.");
    setM(blank); await onSaved();
  };
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <h2 className="flex items-center gap-2 font-medium"><Plus className="h-4 w-4" /> Add a metric</h2>
      <fieldset disabled={saving} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <Input aria-label="Metric name" placeholder="e.g. Qualified leads" value={m.label} onChange={e => setM({ ...m, label: e.target.value })} className="lg:col-span-2" />
        <select aria-label="Unit" className={sel} value={m.unit} onChange={e => setM({ ...m, unit: e.target.value })}>{Object.entries(UNITS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        {m.unit === "currency" ? <Input aria-label="Currency" maxLength={3} value={m.currency} onChange={e => setM({ ...m, currency: e.target.value })} />
          : <select aria-label="Better when" className={sel} value={m.direction} onChange={e => setM({ ...m, direction: e.target.value })}><option value="increase">Higher is better</option><option value="decrease">Lower is better</option></select>}
        <select aria-label="Linked goal" className={sel} value={m.goal} onChange={e => setM({ ...m, goal: e.target.value })}><option value="">No goal</option>{goals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}</select>
        <select aria-label="Linked initiative" className={sel} value={m.initiative} onChange={e => setM({ ...m, initiative: e.target.value })} disabled={!initiatives.length}><option value="">{initiatives.length ? "No initiative" : "No approved initiatives"}</option>{initiatives.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}</select>
      </fieldset>
      <Button size="sm" onClick={add} disabled={saving}>{saving ? "Saving…" : "Add metric"}</Button>
    </section>
  );
}

function MetricCard({ metric, rows, summary: s, status, goal, initiative, canEdit, onChange }: { metric: Metric; rows: Measurement[]; summary: ReturnType<typeof summarizeMetric>; status: MetricStatus; goal: string | null; initiative: string | null; canEdit: boolean; onChange: () => Promise<unknown> }) {
  const fmt = (v: number) => formatMetricValue(v, metric.unit, metric.currency);
  const [recording, setRecording] = useState(false);
  const points = monthlySeries(rows).slice(-12);
  return (
    <article className="min-w-0 space-y-3 rounded-lg border bg-card p-4" aria-label={metric.label}>
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/app/performance/$metricId" params={{ metricId: metric.id }} className="min-w-0 break-words font-medium hover:text-primary">{metric.label}</Link>
        <Badge variant="outline">{UNITS[metric.unit] ?? metric.unit}{metric.currency ? ` · ${metric.currency}` : ""}</Badge>
        {metric.archived && <Badge variant="secondary">Archived</Badge>}
        <span className={`ml-auto text-xs font-medium ${statusClass(status)}`}>{STATUS_LABEL[status]}</span>
      </div>
      {(goal || initiative) && <div className="flex flex-wrap gap-1.5 text-xs">{goal && <Badge variant="secondary">Goal: {goal}</Badge>}{initiative && <Badge variant="secondary">Initiative: {initiative}</Badge>}</div>}
      {!s.period ? <p className="text-sm text-muted-foreground">No values yet.</p> : (
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          <div><dt className="text-xs text-muted-foreground">Month</dt><dd>{s.period.start.slice(0, 7)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Result</dt><dd>{s.actual ? fmt(s.actual.value) : "Not entered"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Plan</dt><dd>{s.planned != null ? fmt(s.planned) : "—"}</dd></div>
          {s.forecast != null && <div><dt className="text-xs text-muted-foreground">Estimate</dt><dd>{fmt(s.forecast)}</dd></div>}
          {s.variance != null && <div><dt className="text-xs text-muted-foreground">Versus plan</dt><dd className={s.onTrack ? "text-success" : "text-destructive"}>{s.variance > 0 ? "+" : ""}{fmt(s.variance)}</dd></div>}
          {s.previousActual != null && <div><dt className="text-xs text-muted-foreground">Previous result</dt><dd>{fmt(s.previousActual)}</dd></div>}
        </dl>
      )}
      {s.actual && <Reliability kind={s.actual.kind} />}
      {points.length > 1 && <MetricChart points={points} metric={metric} height={120} />}
      <div className="flex flex-wrap gap-2">
        {canEdit && !metric.archived && <Button size="sm" variant={recording ? "secondary" : "outline"} onClick={() => setRecording(!recording)}><Plus className="h-4 w-4" /> Record value</Button>}
        <Button size="sm" variant="ghost" asChild><Link to="/app/performance/$metricId" params={{ metricId: metric.id }}>Details & history <ArrowUpRight className="h-4 w-4" /></Link></Button>
      </div>
      {recording && <RecordValueForm metric={metric} correcting={null} onDone={async saved => { setRecording(false); if (saved) await onChange(); }} />}
    </article>
  );
}
