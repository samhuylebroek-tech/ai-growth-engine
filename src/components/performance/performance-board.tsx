import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LineChart, Plus, History, Archive } from "lucide-react";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { hasRole } from "@/lib/permissions";
import { growthDb as db, isNotInstalled, retryUnlessNotInstalled, PERFORMANCE_NOT_INSTALLED } from "@/lib/pending-schema";
import { summarizeMetric, effectiveMeasurements, metricKey, monthPeriod, formatMetricValue, KIND_LABEL, USER_KINDS, type MeasurementKind, type Measurement } from "@/lib/performance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const sel = "h-9 rounded-md border border-input bg-background px-2 text-sm";
const UNITS: Record<string, string> = { count: "Number", currency: "Money", percent: "Percentage", ratio: "Ratio", days: "Days" };
const thisMonth = () => new Date().toISOString().slice(0, 7);
const errMsg = (e: unknown) => (typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "");

type Metric = { id: string; key: string; label: string; unit: string; currency: string | null; direction: string; goal_id: string | null; archived: boolean };

export function PerformanceBoard() {
  const { workspace, org, workspaceRole, loading } = useOrg();
  if (loading) return <p className="p-6 text-muted-foreground">Loading…</p>;
  if (!workspace || !org) return <p className="p-6 text-muted-foreground">Choose a workspace to track performance.</p>;
  return <Board key={`${org.id}:${workspace.id}`} wsId={workspace.id} canEdit={hasRole(workspaceRole, "member")} />;
}

function Board({ wsId, canEdit }: { wsId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const metrics = useQuery({
    queryKey: ["metric-definitions", wsId], retry: retryUnlessNotInstalled,
    queryFn: async () => {
      const r = await db.from("metric_definitions").select("id,key,label,unit,currency,direction,goal_id,archived").eq("workspace_id", wsId).eq("archived", false).order("created_at").limit(100);
      if (r.error) throw r.error; return r.data as Metric[];
    },
  });
  const values = useQuery({
    queryKey: ["performance-measurements", wsId], retry: retryUnlessNotInstalled, enabled: metrics.isSuccess,
    queryFn: async () => {
      const r = await db.from("performance_measurements").select("id,metric_id,kind,period_start,period_end,value,corrects_id,created_at,note,source").eq("workspace_id", wsId).order("period_start", { ascending: false }).order("created_at", { ascending: false }).limit(1000);
      if (r.error) throw r.error; return r.data as Measurement[];
    },
  });
  const goals = useQuery({
    queryKey: ["growth-goals-lite", wsId],
    queryFn: async () => {
      const r = await db.from("growth_goals").select("id,title").eq("workspace_id", wsId).neq("status", "archived").order("created_at").limit(100);
      if (r.error) throw r.error; return r.data;
    },
  });
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["metric-definitions", wsId] }), qc.invalidateQueries({ queryKey: ["performance-measurements", wsId] })]);
  const goalTitle = useMemo(() => new Map((goals.data ?? []).map(g => [g.id, g.title] as const)), [goals.data]);

  const [m, setM] = useState({ label: "", unit: "count", currency: "EUR", direction: "increase", goal: "" });
  const [savingMetric, setSavingMetric] = useState(false);
  const addMetric = async () => {
    if (!m.label.trim()) return void toast.error("Name what you want to measure.");
    if (m.unit === "currency" && !/^[A-Za-z]{3}$/.test(m.currency.trim())) return void toast.error("Use a three-letter currency code, for example EUR.");
    setSavingMetric(true);
    const r = await db.rpc("define_metric", { _workspace: wsId, _key: metricKey(m.label), _label: m.label.trim(), _unit: m.unit, _currency: m.unit === "currency" ? m.currency.trim().toUpperCase() : null, _direction: m.direction, _goal: m.goal || null, _initiative: null });
    setSavingMetric(false);
    if (r.error) return void toast.error(/different unit or currency/.test(errMsg(r.error)) ? "A metric with this name already exists with another unit or currency." : "Could not save the metric.");
    toast.success((r.data as { status?: string } | null)?.status === "existing" ? "This metric already exists." : "Metric added.");
    setM({ label: "", unit: "count", currency: "EUR", direction: "increase", goal: "" }); await refresh();
  };

  if (metrics.isError && isNotInstalled(metrics.error)) {
    return (
      <Shell>
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-4 text-sm">{PERFORMANCE_NOT_INSTALLED}</div>
      </Shell>
    );
  }
  return (
    <Shell>
      {canEdit && (
        <section className="space-y-3 rounded-lg border bg-card p-4">
          <h2 className="flex items-center gap-2 font-medium"><Plus className="h-4 w-4" /> Add a metric</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <Input aria-label="Metric name" placeholder="e.g. Qualified leads" value={m.label} onChange={e => setM({ ...m, label: e.target.value })} className="lg:col-span-2" />
            <select aria-label="Unit" className={sel} value={m.unit} onChange={e => setM({ ...m, unit: e.target.value })}>{Object.entries(UNITS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            {m.unit === "currency" ? <Input aria-label="Currency" maxLength={3} value={m.currency} onChange={e => setM({ ...m, currency: e.target.value })} /> :
              <select aria-label="Better when" className={sel} value={m.direction} onChange={e => setM({ ...m, direction: e.target.value })}><option value="increase">Higher is better</option><option value="decrease">Lower is better</option></select>}
            <select aria-label="Linked goal" className={sel} value={m.goal} onChange={e => setM({ ...m, goal: e.target.value })}><option value="">No goal</option>{(goals.data ?? []).map(g => <option key={g.id} value={g.id}>{g.title}</option>)}</select>
          </div>
          <Button size="sm" onClick={addMetric} disabled={savingMetric}>{savingMetric ? "Saving…" : "Add metric"}</Button>
        </section>
      )}
      {metrics.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
        : metrics.isError ? <p className="text-sm text-destructive">Metrics could not be loaded. Try again in a moment.</p>
        : (metrics.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No metrics yet. Add the numbers that show whether your goals are being reached — for example revenue, leads or conversion rate.</p>
        : <div className="grid gap-3 md:grid-cols-2">{(metrics.data ?? []).map(x => <MetricCard key={x.id} metric={x} rows={(values.data ?? []).filter(v => v.metric_id === x.id)} goal={x.goal_id ? goalTitle.get(x.goal_id) ?? null : null} canEdit={canEdit} onChange={refresh} />)}</div>}
      {values.isError && !isNotInstalled(values.error) && <p className="text-sm text-destructive">Recorded values could not be loaded. Try again in a moment.</p>}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold"><LineChart className="h-6 w-6" /> Performance</h1>
        <p className="text-sm text-muted-foreground">Define the numbers that matter, then record plans, forecasts and results per month. Values here are entered by your team; no analytics, ad or payment source is connected, so nothing is marked as verified. Corrections never overwrite history.</p>
      </header>
      {children}
    </div>
  );
}

function MetricCard({ metric, rows, goal, canEdit, onChange }: { metric: Metric; rows: Measurement[]; goal: string | null; canEdit: boolean; onChange: () => Promise<unknown> }) {
  const s = summarizeMetric(metric, rows);
  const fmt = (v: number) => formatMetricValue(v, metric.unit, metric.currency);
  const [open, setOpen] = useState<null | "record" | "history">(null);
  const [form, setForm] = useState<{ month: string; kind: MeasurementKind; value: string; note: string; corrects: string | null; key: string }>(() => ({ month: thisMonth(), kind: "manual_actual", value: "", note: "", corrects: null, key: crypto.randomUUID() }));
  const [busy, setBusy] = useState(false);
  const live = new Set(effectiveMeasurements(rows).map(r => r.id));

  const save = async () => {
    const value = Number(form.value.replace(",", "."));
    if (form.value.trim() === "" || !Number.isFinite(value)) return void toast.error("Enter a number.");
    let period: { start: string; end: string };
    try { period = monthPeriod(form.month); } catch { return void toast.error("Choose a month."); }
    setBusy(true);
    const r = await db.rpc("record_measurement", { _metric: metric.id, _kind: form.kind, _period_start: period.start, _period_end: period.end, _value: value, _note: form.note.trim(), _source_ref: "", _request: form.key, _corrects: form.corrects });
    setBusy(false);
    if (r.error) {
      const msg = errMsg(r.error);
      if (/already exists for this period/.test(msg)) return void toast.error("A value already exists for this month. Open the history and choose Correct.");
      if (/not valid for this metric/.test(msg)) return void toast.error("This value is not valid for this metric.");
      if (/already corrected/.test(msg)) return void toast.error("That value was already corrected. Correct the latest one.");
      return void toast.error("Could not save the value. Your entry is kept; try again.");
    }
    toast.success(form.corrects ? "Correction saved. The earlier value stays in the history." : "Value saved.");
    setForm({ month: form.month, kind: form.kind, value: "", note: "", corrects: null, key: crypto.randomUUID() });
    setOpen(null); await onChange();
  };
  const correct = (row: Measurement) => {
    setForm({ month: row.period_start.slice(0, 7), kind: row.kind as MeasurementKind, value: String(row.value), note: "", corrects: row.id, key: crypto.randomUUID() });
    setOpen("record");
  };
  const archive = async () => {
    const r = await db.rpc("update_metric_definition", { _metric: metric.id, _patch: { archived: true } });
    if (r.error) return void toast.error("Could not archive the metric.");
    toast.success("Metric archived. Its history is kept."); await onChange();
  };

  return (
    <div className="min-w-0 space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{metric.label}</span>
        <Badge variant="outline">{UNITS[metric.unit] ?? metric.unit}{metric.currency ? ` · ${metric.currency}` : ""}</Badge>
        {goal && <Badge variant="secondary">Goal: {goal}</Badge>}
      </div>
      {!s.period ? <p className="text-sm text-muted-foreground">No values yet.</p> : (
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          <div><dt className="text-xs text-muted-foreground">Period</dt><dd>{s.period.start.slice(0, 7)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Result</dt><dd>{s.actual ? <>{fmt(s.actual.value)} <span className="text-xs text-muted-foreground">({KIND_LABEL[s.actual.kind]})</span></> : "Not entered"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Planned</dt><dd>{s.planned != null ? fmt(s.planned) : "—"}</dd></div>
          {s.forecast != null && <div><dt className="text-xs text-muted-foreground">Forecast</dt><dd>{fmt(s.forecast)}</dd></div>}
          {s.variance != null && <div><dt className="text-xs text-muted-foreground">Versus plan</dt><dd className={s.onTrack ? "text-success" : "text-destructive"}>{s.variance > 0 ? "+" : ""}{fmt(s.variance)} · {s.onTrack ? "on track" : "behind plan"}</dd></div>}
          {s.previousActual != null && <div><dt className="text-xs text-muted-foreground">Previous result</dt><dd>{fmt(s.previousActual)}</dd></div>}
        </dl>
      )}
      <div className="flex flex-wrap gap-2">
        {canEdit && <Button size="sm" variant={open === "record" ? "secondary" : "outline"} onClick={() => setOpen(open === "record" ? null : "record")}><Plus className="h-4 w-4" /> Record value</Button>}
        {rows.length > 0 && <Button size="sm" variant={open === "history" ? "secondary" : "ghost"} onClick={() => setOpen(open === "history" ? null : "history")}><History className="h-4 w-4" /> History ({rows.length})</Button>}
        {canEdit && <Button size="sm" variant="ghost" onClick={archive}><Archive className="h-4 w-4" /> Archive</Button>}
      </div>
      {open === "record" && (
        <div className="space-y-2 rounded-md border p-3">
          {form.corrects && <p className="text-xs text-muted-foreground">Correcting an earlier value. Month and type stay the same; the earlier value remains in the history.</p>}
          <div className="grid gap-2 sm:grid-cols-3">
            <Input aria-label="Month" type="month" value={form.month} disabled={!!form.corrects} onChange={e => setForm({ ...form, month: e.target.value })} />
            <select aria-label="Type of value" className={sel} value={form.kind} disabled={!!form.corrects} onChange={e => setForm({ ...form, kind: e.target.value as MeasurementKind })}>{USER_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select>
            <Input aria-label="Value" inputMode="decimal" placeholder="Value" value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} />
          </div>
          <Input aria-label="Note" placeholder="Note (optional) — where does this number come from?" maxLength={500} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : form.corrects ? "Save correction" : "Save value"}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setForm({ ...form, corrects: null, key: crypto.randomUUID() }); setOpen(null); }}>Cancel</Button>
          </div>
        </div>
      )}
      {open === "history" && (
        <ul className="divide-y rounded-md border text-sm">
          {rows.map(r => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
              <span className={live.has(r.id) ? "" : "text-muted-foreground line-through"}>{r.period_start.slice(0, 7)} · {KIND_LABEL[r.kind as MeasurementKind] ?? r.kind} · {fmt(Number(r.value))}{r.note ? ` — ${r.note}` : ""}</span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                {r.corrects_id && <Badge variant="outline">Correction</Badge>}
                {!live.has(r.id) && <span>Replaced</span>}
                {canEdit && live.has(r.id) && <Button size="sm" variant="ghost" onClick={() => correct(r)}>Correct</Button>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
