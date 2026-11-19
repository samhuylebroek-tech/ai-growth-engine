import { useState } from "react";
import { toast } from "sonner";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { growthDb as db } from "@/lib/pending-schema";
import { formatMetricValue, KIND_LABEL, monthPeriod, RELIABILITY, USER_KINDS, type MeasurementKind, type MetricStatus, type MonthPoint } from "@/lib/performance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { errMsg, type Metric } from "./data";

export const sel = "h-9 min-w-0 rounded-md border border-input bg-background px-2 text-sm";
const thisMonth = () => new Date().toISOString().slice(0, 7);

const TONE = { muted: "border-border text-muted-foreground", warning: "border-warning/40 bg-warning/10 text-foreground", info: "border-primary/30 bg-primary/5 text-foreground", success: "border-success/40 bg-success/10 text-foreground" } as const;
export function Reliability({ kind }: { kind: MeasurementKind | null }) {
  if (!kind) return null;
  const r = RELIABILITY[kind];
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]", TONE[r.tone])}>{r.label}</span>;
}
const STATUS_TONE: Record<MetricStatus, string> = { on_track: "text-success", behind: "text-destructive", no_plan: "text-muted-foreground", no_result: "text-muted-foreground", no_data: "text-muted-foreground" };
export const statusClass = (s: MetricStatus) => STATUS_TONE[s];

export function MetricChart({ points, metric, height = 220 }: { points: MonthPoint[]; metric: Pick<Metric, "unit" | "currency">; height?: number }) {
  if (points.length === 0) return null;
  const fmt = (v: number) => formatMetricValue(v, metric.unit, metric.currency);
  return (
    <div style={{ height }} className="w-full" role="img" aria-label={`Chart of ${points.length} months: results as bars, plan as a line, estimates dashed`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
          <YAxis width={56} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} tickFormatter={v => fmt(Number(v))} />
          <Tooltip formatter={(v: unknown, n: unknown) => [v == null ? "—" : fmt(Number(v)), String(n)]} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--popover-foreground)" }} />
          <Bar dataKey="actual" name="Result" fill="var(--chart-1)" radius={[3, 3, 0, 0]} maxBarSize={28} />
          <Line dataKey="planned" name="Plan" stroke="var(--chart-2)" strokeWidth={2} dot={{ r: 2 }} connectNulls />
          <Line dataKey="forecast" name="Estimate" stroke="var(--chart-3)" strokeWidth={2} strokeDasharray="4 3" dot={{ r: 2 }} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

type Correction = { id: string; month: string; kind: MeasurementKind; value: number } | null;
export function RecordValueForm({ metric, correcting, onDone }: { metric: Metric; correcting: Correction; onDone: (saved: boolean) => void | Promise<void> }) {
  const [form, setForm] = useState(() => ({ month: correcting?.month ?? thisMonth(), kind: (correcting?.kind ?? "manual_actual") as MeasurementKind, value: correcting ? String(correcting.value) : "", note: "", key: crypto.randomUUID() }));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const value = Number(form.value.replace(",", "."));
    if (form.value.trim() === "" || !Number.isFinite(value)) return void toast.error("Enter a number.");
    let period: { start: string; end: string };
    try { period = monthPeriod(form.month); } catch { return void toast.error("Choose a month."); }
    setBusy(true);
    const r = await db.rpc("record_measurement", { _metric: metric.id, _kind: form.kind, _period_start: period.start, _period_end: period.end, _value: value, _note: form.note.trim(), _source_ref: "", _request: form.key, _corrects: correcting?.id ?? null });
    setBusy(false);
    if (r.error) {
      const msg = errMsg(r.error);
      if (/already exists for this period/.test(msg)) return void toast.error("A value already exists for this month. Open the history and choose Correct.");
      if (/not valid for this metric/.test(msg)) return void toast.error("This value is not valid for this metric.");
      if (/already corrected/.test(msg)) return void toast.error("That value was already corrected. Correct the latest one.");
      if (/Archived/.test(msg)) return void toast.error("This metric is archived. Restore it to record values.");
      return void toast.error("Could not save the value. Your entry is kept; try again.");
    }
    toast.success(correcting ? "Correction saved. The earlier value stays in the history." : "Value saved.");
    await onDone(true);
  };
  return (
    <div className="space-y-2 rounded-md border bg-background p-3">
      {correcting && <p className="text-xs text-muted-foreground">Correcting {KIND_LABEL[correcting.kind].toLowerCase()} for {correcting.month}. Month and type stay the same; the earlier value remains in the history.</p>}
      <div className="grid gap-2 sm:grid-cols-3">
        <Input aria-label="Month" type="month" value={form.month} disabled={!!correcting} onChange={e => setForm({ ...form, month: e.target.value })} />
        <select aria-label="Type of value" className={sel} value={form.kind} disabled={!!correcting} onChange={e => setForm({ ...form, kind: e.target.value as MeasurementKind })}>{USER_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select>
        <Input aria-label="Value" inputMode="decimal" placeholder={metric.unit === "currency" ? `Amount in ${metric.currency}` : "Value"} value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} />
      </div>
      <Input aria-label="Note" placeholder="Note (optional) — where does this number come from?" maxLength={500} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : correcting ? "Save correction" : "Save value"}</Button>
        <Button size="sm" variant="ghost" onClick={() => onDone(false)}>Cancel</Button>
      </div>
    </div>
  );
}
