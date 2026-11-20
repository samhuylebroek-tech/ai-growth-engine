import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { growthDb as db } from "@/lib/pending-schema";
import { formatMetricValue, monthPeriod, RELIABILITY, USER_KINDS, type MeasurementKind, type MetricStatus, type MonthPoint } from "@/lib/performance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { errMsg, type Metric } from "./data";

export const sel = "h-9 min-w-0 rounded-md border border-input bg-background px-2 text-sm";
const thisMonth = () => new Date().toISOString().slice(0, 7);

const TONE = { muted: "border-border text-muted-foreground", warning: "border-warning/40 bg-warning/10 text-foreground", info: "border-primary/30 bg-primary/5 text-foreground", success: "border-success/40 bg-success/10 text-foreground" } as const;
export function Reliability({ kind }: { kind: MeasurementKind | null }) {
  const { t } = useI18n();
  if (!kind) return null;
  const r = RELIABILITY[kind];
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]", TONE[r.tone])}>{t(`performance.rel.${kind}`)}</span>;
}
const STATUS_TONE: Record<MetricStatus, string> = { on_track: "text-success", behind: "text-destructive", no_plan: "text-muted-foreground", no_result: "text-muted-foreground", no_data: "text-muted-foreground" };
export const statusClass = (s: MetricStatus) => STATUS_TONE[s];

export function MetricChart({ points, metric, height = 220 }: { points: MonthPoint[]; metric: Pick<Metric, "unit" | "currency">; height?: number }) {
  const { t, tag } = useI18n();
  if (points.length === 0) return null;
  const fmt = (v: number) => formatMetricValue(v, metric.unit, metric.currency, tag);
  return (
    <div style={{ height }} className="w-full" role="img" aria-label={t("performance.chartLabel", { n: points.length })}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
          <YAxis width={56} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} tickFormatter={v => fmt(Number(v))} />
          <Tooltip formatter={(v: unknown, n: unknown) => [v == null ? "—" : fmt(Number(v)), String(n)]} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--popover-foreground)" }} />
          <Bar dataKey="actual" name={t("performance.result")} fill="var(--chart-1)" radius={[3, 3, 0, 0]} maxBarSize={28} />
          <Line dataKey="planned" name={t("performance.plan")} stroke="var(--chart-2)" strokeWidth={2} dot={{ r: 2 }} connectNulls />
          <Line dataKey="forecast" name={t("performance.estimate")} stroke="var(--chart-3)" strokeWidth={2} strokeDasharray="4 3" dot={{ r: 2 }} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

type Correction = { id: string; month: string; kind: MeasurementKind; value: number } | null;
export function RecordValueForm({ metric, correcting, onDone }: { metric: Metric; correcting: Correction; onDone: (saved: boolean) => void | Promise<void> }) {
  const [form, setForm] = useState(() => ({ month: correcting?.month ?? thisMonth(), kind: (correcting?.kind ?? "manual_actual") as MeasurementKind, value: correcting ? String(correcting.value) : "", note: "", key: crypto.randomUUID() }));
  const [busy, setBusy] = useState(false);
  const { t } = useI18n();
  const save = async () => {
    const value = Number(form.value.replace(",", "."));
    if (form.value.trim() === "" || !Number.isFinite(value)) return void toast.error(t("performance.enterNumber"));
    let period: { start: string; end: string };
    try { period = monthPeriod(form.month); } catch { return void toast.error(t("performance.chooseMonth")); }
    setBusy(true);
    const r = await db.rpc("record_measurement", { _metric: metric.id, _kind: form.kind, _period_start: period.start, _period_end: period.end, _value: value, _note: form.note.trim(), _source_ref: "", _request: form.key, _corrects: correcting?.id ?? null });
    setBusy(false);
    if (r.error) {
      const msg = errMsg(r.error);
      if (/already exists for this period/.test(msg)) return void toast.error(t("performance.dupMonth"));
      if (/not valid for this metric/.test(msg)) return void toast.error(t("performance.invalid"));
      if (/already corrected/.test(msg)) return void toast.error(t("performance.alreadyCorrected"));
      if (/Archived/.test(msg)) return void toast.error(t("performance.archivedMetric"));
      return void toast.error(t("performance.valueFailed"));
    }
    toast.success(correcting ? t("performance.correctionSaved") : t("performance.valueSaved"));
    await onDone(true);
  };
  return (
    <div className="space-y-2 rounded-md border bg-background p-3">
      {correcting && <p className="text-xs text-muted-foreground">{t("performance.correcting", { kind: t(`performance.kind.${correcting.kind}`).toLowerCase(), month: correcting.month })}</p>}
      <div className="grid gap-2 sm:grid-cols-3">
        <Input aria-label={t("performance.month")} type="month" value={form.month} disabled={!!correcting} onChange={e => setForm({ ...form, month: e.target.value })} />
        <select aria-label={t("performance.type")} className={sel} value={form.kind} disabled={!!correcting} onChange={e => setForm({ ...form, kind: e.target.value as MeasurementKind })}>{USER_KINDS.map(k => <option key={k} value={k}>{t(`performance.kind.${k}`)}</option>)}</select>
        <Input aria-label={t("performance.value")} inputMode="decimal" placeholder={metric.unit === "currency" ? t("performance.amountIn", { c: metric.currency ?? "" }) : t("performance.value")} value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} />
      </div>
      <Input aria-label={t("performance.note")} placeholder={t("performance.notePh")} maxLength={500} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={busy}>{busy ? t("performance.saving") : correcting ? t("performance.saveCorrection") : t("performance.saveValue")}</Button>
        <Button size="sm" variant="ghost" onClick={() => onDone(false)}>{t("performance.cancel")}</Button>
      </div>
    </div>
  );
}
