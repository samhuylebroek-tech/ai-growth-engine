// Starting point (baseline) and target for one KPI (proposal 0089). Values come only from recorded rows; editors set
// them through role-checked database functions, every change is kept as history, and progress is computed by the
// pure kpiProgress rules so no comparison is made between incompatible periods.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Flag, History, Pencil, Target, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { growthDb as db, isNotInstalled } from "@/lib/pending-schema";
import { effectiveMeasurements, formatMetricValue, isActual, type Measurement, type MeasurementKind } from "@/lib/performance";
import { history, kpiProgress, type BaselineRow, type TargetRow } from "@/lib/kpi-progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { invalidatePerformance, kpiGoalsOptions, type Metric } from "./data";
import { Reliability, sel } from "./parts";

const membersOptions = (wsId: string) => ({
  queryKey: ["kpi-goal-members", wsId],
  queryFn: async () => {
    const r = await db.rpc("execution_workspace_members", { _workspace: wsId });
    if (r.error) throw r.error;
    return (r.data ?? []) as { user_id: string; display_name: string }[];
  },
});

export function KpiGoals({ wsId, metric, rows, canEdit }: { wsId: string; metric: Metric; rows: Measurement[]; canEdit: boolean }) {
  const { t, tag } = useI18n();
  const qc = useQueryClient();
  const q = useQuery(kpiGoalsOptions(wsId));
  const members = useQuery(membersOptions(wsId));
  const [editing, setEditing] = useState<null | "baseline" | "target">(null);
  const [showHistory, setShowHistory] = useState(false);
  const fmt = (v: number | string) => formatMetricValue(Number(v), metric.unit, metric.currency, tag);
  const pct = (n: number) => new Intl.NumberFormat(tag, { maximumFractionDigits: 1 }).format(n);
  const who = (id: string | null) => members.data?.find((m) => m.user_id === id)?.display_name ?? t("kg.teammate");
  const day = (d: string) => new Date(d.length === 10 ? `${d}T00:00:00Z` : d).toLocaleDateString(tag, d.length === 10 ? { timeZone: "UTC" } : undefined);

  if (q.isError) return <section className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">{isNotInstalled(q.error) ? t("kg.notInstalled") : t("kg.loadFailed")}</section>;
  if (q.isLoading || !q.data) return null;
  const baselines = q.data.baselines.filter((b) => b.metric_id === metric.id);
  const targets = q.data.targets.filter((x) => x.metric_id === metric.id);
  const p = kpiProgress({ metricId: metric.id, direction: metric.direction, unit: metric.unit, rows, baselines, targets, today: new Date().toISOString().slice(0, 10) });
  const done = async () => { setEditing(null); await invalidatePerformance(qc, wsId); };
  const changeText = p.change === null ? null : metric.unit === "percent"
    ? t("kg.points", { v: `${p.change > 0 ? "+" : ""}${new Intl.NumberFormat(tag, { maximumFractionDigits: 2 }).format(p.change)}` })
    : t("kg.changeValue", { v: `${p.change > 0 ? "+" : ""}${fmt(p.change)}`, p: p.changePct === null ? "—" : `${p.changePct > 0 ? "+" : ""}${new Intl.NumberFormat(tag, { maximumFractionDigits: 1 }).format(p.changePct)}%` });
  const hist = history<{ id: string; created_at: string; kind: "b" | "t"; row: BaselineRow | TargetRow }>([
    ...baselines.map((row) => ({ id: row.id, created_at: row.created_at, kind: "b" as const, row })),
    ...targets.map((row) => ({ id: row.id, created_at: row.created_at, kind: "t" as const, row })),
  ]).reverse();

  return (
    <section aria-labelledby="kg-title" className="space-y-3 rounded-lg border bg-card p-4 text-sm">
      <div>
        <h2 id="kg-title" className="font-medium">{t("kg.title")}</h2>
        <p className="text-muted-foreground">{t("kg.intro")}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="space-y-1 rounded-md border p-3">
          <p className="flex items-center gap-1 text-xs text-muted-foreground"><Flag className="h-3.5 w-3.5" aria-hidden /> {t("kg.baseline")}</p>
          {p.baseline ? <>
            <p className="text-lg font-semibold">{fmt(p.baseline.value)}</p>
            <p className="text-xs text-muted-foreground">{t("kg.period", { s: day(p.baseline.period_start), e: day(p.baseline.period_end) })}</p>
            <p className="text-xs text-muted-foreground">{p.baseline.basis === "measured" ? t("kg.fromResult", { m: p.baseline.period_start.slice(0, 7) }) : t("kg.manual", { who: who(p.baseline.created_by), s: p.baseline.source })}</p>
            {p.baseline.measurement_kind && <Reliability kind={p.baseline.measurement_kind as MeasurementKind} />}
          </> : <p className="text-muted-foreground">{t("kg.noBaseline")}</p>}
        </div>
        <div className="space-y-1 rounded-md border p-3">
          <p className="text-xs text-muted-foreground">{t("kg.current")}</p>
          {p.current ? <>
            <p className="text-lg font-semibold">{fmt(p.current.value)}</p>
            <p className="text-xs text-muted-foreground">{t("kg.period", { s: day(p.current.period_start), e: day(p.current.period_end) })}</p>
            <span className="sr-only">{t("kg.reliability")}</span><Reliability kind={p.current.kind as MeasurementKind} />
            {p.previous && <p className="text-xs text-muted-foreground">{t("kg.previous", { v: fmt(p.previous.value), m: p.previous.period_start.slice(0, 7) })}</p>}
          </> : <p className="text-muted-foreground">{t("kg.noResult")}</p>}
        </div>
        <div className="space-y-1 rounded-md border p-3">
          <p className="flex items-center gap-1 text-xs text-muted-foreground"><Target className="h-3.5 w-3.5" aria-hidden /> {t("kg.target")}</p>
          {p.target && p.target.value != null && p.target.target_date ? <>
            <p className="text-lg font-semibold">{fmt(p.target.value)}</p>
            <p className="text-xs text-muted-foreground">{t("kg.reach", { v: fmt(p.target.value), d: day(p.target.target_date) })} · {t("kg.per", { p: t(`kg.p.${p.target.period_kind}` as MessageKey) })}</p>
            {p.target.owner_id && <p className="text-xs text-muted-foreground">{t("kg.owner", { who: who(p.target.owner_id) })}</p>}
            {p.daysLeft !== null && <p className={`text-xs ${p.daysLeft < 0 ? "text-destructive" : "text-muted-foreground"}`}>{p.daysLeft < 0 ? t("kg.overdue", { n: -p.daysLeft }) : t("kg.daysLeft", { n: p.daysLeft })}</p>}
          </> : <p className="text-muted-foreground">{t("kg.noTarget")}</p>}
        </div>
      </div>

      <div className="space-y-1 rounded-md bg-muted/40 p-3" aria-live="polite">
        <p className="text-xs text-muted-foreground">{t("kg.change")}</p>
        {changeText ? <p className="font-medium">{changeText} · <span className={p.improving === null ? "" : p.improving ? "text-success" : "text-destructive"}>{p.improving === null ? "" : p.improving ? t("kg.improving") : t("kg.worsening")}</span></p>
          : <p className="text-muted-foreground">{t(`kg.blocked.${p.changeBlocked ?? "no_result"}` as MessageKey)}</p>}
        {p.progress !== null && <>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, Math.min(100, p.progress))} aria-label={t("kg.progress", { n: pct(p.progress) })}>
            <div className="h-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, p.progress))}%` }} />
          </div>
          <p className="text-xs">{t("kg.progress", { n: pct(p.progress) })} <span className="text-muted-foreground">— {t("kg.progressExplain")}</span></p>
        </>}
        {p.trend !== "unknown" && <p className="text-xs text-muted-foreground">{t(`kg.trend.${p.trend}` as MessageKey)}</p>}
        {p.missingMonths.length > 0 && <p className="text-xs text-warning">{t("kg.missing", { m: p.missingMonths.slice(0, 6).join(", ") + (p.missingMonths.length > 6 ? "…" : "") })}</p>}
      </div>

      {canEdit && !metric.archived ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={p.baseline ? "outline" : "default"} onClick={() => setEditing("baseline")}><Flag className="h-4 w-4" /> {p.baseline ? t("kg.changeBaseline") : t("kg.setBaseline")}</Button>
          <Button size="sm" variant="outline" onClick={() => setEditing("target")}><Pencil className="h-4 w-4" /> {p.target ? t("kg.changeTarget") : t("kg.setTarget")}</Button>
          {p.target && <WithdrawTarget metricId={metric.id} onDone={done} />}
        </div>
      ) : !canEdit ? <p className="text-xs text-muted-foreground">{t("kg.readOnly")}</p> : null}
      {editing === "baseline" && <BaselineForm metric={metric} rows={rows} onDone={done} onCancel={() => setEditing(null)} />}
      {editing === "target" && <TargetForm metric={metric} members={members.data ?? []} current={p.target} onDone={done} onCancel={() => setEditing(null)} />}

      {hist.length > 0 && (
        <div>
          <Button size="sm" variant="ghost" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}><History className="h-4 w-4" /> {t("kg.history", { n: hist.length })}</Button>
          {showHistory && (
            <ul className="mt-1 divide-y rounded-md border text-xs">
              {hist.map((h) => (
                <li key={h.id} className="flex flex-wrap gap-x-2 p-2">
                  <span className="font-medium">{h.kind === "b" ? t("kg.baseline") : t("kg.target")}</span>
                  <span>{h.kind === "t" && (h.row as TargetRow).withdrawn ? t("kg.withdrawn") : h.row.value != null ? fmt(h.row.value) : "—"}</span>
                  <span className="text-muted-foreground">{t("kg.setOn", { d: day(h.created_at) })} {t("kg.by", { who: who(h.row.created_by) })}</span>
                  {h.row.note && <span className="text-muted-foreground">— {h.row.note}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function errorText(t: (k: MessageKey) => string, e: { code?: string } | null) {
  return e?.code === "42501" ? t("kg.notAllowed") : e?.code === "22023" ? t("kg.invalid") : t("kg.failed");
}

function BaselineForm({ metric, rows, onDone, onCancel }: { metric: Metric; rows: Measurement[]; onDone: () => Promise<void>; onCancel: () => void }) {
  const { t, tag } = useI18n();
  const results = effectiveMeasurements(rows.filter((r) => isActual(r.kind))).sort((a, b) => (a.period_start < b.period_start ? 1 : -1));
  const [mode, setMode] = useState<"result" | "manual">(results.length ? "result" : "manual");
  const [pick, setPick] = useState(results[0]?.id ?? "");
  const [v, setV] = useState({ value: "", from: "", to: "", source: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [request] = useState(() => crypto.randomUUID());
  const save = async () => {
    setBusy(true);
    const r = await db.rpc("set_metric_baseline", mode === "result"
      ? { _metric: metric.id, _request: request, _measurement: pick, _value: null, _period_start: null, _period_end: null, _source: null, _note: v.note }
      : { _metric: metric.id, _request: request, _measurement: null, _value: Number(v.value), _period_start: v.from, _period_end: v.to, _source: v.source, _note: v.note });
    setBusy(false);
    if (r.error) return void toast.error(errorText(t, r.error));
    toast.success(t("kg.saved")); await onDone();
  };
  const manualOk = v.value.trim() !== "" && Number.isFinite(Number(v.value)) && v.from && v.to && v.from <= v.to && v.source.trim();
  return (
    <div className="space-y-3 rounded-md border p-3">
      <fieldset className="space-y-2">
        <legend className="sr-only">{t("kg.setBaseline")}</legend>
        <label className="flex items-start gap-2"><input type="radio" name="kg-mode" className="mt-1" checked={mode === "result"} disabled={!results.length} onChange={() => setMode("result")} /><span><span className="font-medium">{t("kg.useResult")}</span><br /><span className="text-xs text-muted-foreground">{results.length ? t("kg.useResultHelp") : t("kg.noResults")}</span></span></label>
        <label className="flex items-start gap-2"><input type="radio" name="kg-mode" className="mt-1" checked={mode === "manual"} onChange={() => setMode("manual")} /><span><span className="font-medium">{t("kg.enterValue")}</span><br /><span className="text-xs text-muted-foreground">{t("kg.enterHelp")}</span></span></label>
      </fieldset>
      {mode === "result" ? (
        <div className="space-y-1"><Label htmlFor="kg-pick">{t("kg.pickResult")}</Label>
          <select id="kg-pick" className={`${sel} w-full sm:w-auto`} value={pick} onChange={(e) => setPick(e.target.value)}>
            {results.map((r) => <option key={r.id} value={r.id}>{r.period_start.slice(0, 7)} · {formatMetricValue(Number(r.value), metric.unit, metric.currency, tag)}</option>)}
          </select>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1"><Label htmlFor="kg-value">{t("kg.value")}</Label><Input id="kg-value" inputMode="decimal" value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="kg-from">{t("kg.from")}</Label><Input id="kg-from" type="date" value={v.from} onChange={(e) => setV({ ...v, from: e.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="kg-to">{t("kg.to")}</Label><Input id="kg-to" type="date" value={v.to} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setV({ ...v, to: e.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="kg-source">{t("kg.source")}</Label><Input id="kg-source" maxLength={120} placeholder={t("kg.sourcePh")} value={v.source} onChange={(e) => setV({ ...v, source: e.target.value })} /></div>
        </div>
      )}
      <div className="space-y-1"><Label htmlFor="kg-bnote">{t("kg.note")}</Label><Input id="kg-bnote" maxLength={500} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></div>
      <div className="flex gap-2"><Button size="sm" onClick={save} disabled={busy || (mode === "result" ? !pick : !manualOk)}>{busy ? t("kg.saving") : t("kg.save")}</Button><Button size="sm" variant="ghost" onClick={onCancel}>{t("kg.cancel")}</Button></div>
    </div>
  );
}

function TargetForm({ metric, members, current, onDone, onCancel }: { metric: Metric; members: { user_id: string; display_name: string }[]; current: TargetRow | null; onDone: () => Promise<void>; onCancel: () => void }) {
  const { t } = useI18n();
  const [v, setV] = useState({ value: current?.value != null ? String(current.value) : "", date: current?.target_date ?? "", period: current?.period_kind ?? "month", owner: current?.owner_id ?? "", note: "" });
  const [busy, setBusy] = useState(false);
  const [request] = useState(() => crypto.randomUUID());
  const ok = v.value.trim() !== "" && Number.isFinite(Number(v.value)) && v.date >= new Date().toISOString().slice(0, 10);
  const save = async () => {
    setBusy(true);
    const r = await db.rpc("set_metric_target", { _metric: metric.id, _request: request, _value: Number(v.value), _target_date: v.date, _period_kind: v.period, _owner: v.owner || null, _note: v.note });
    setBusy(false);
    if (r.error) return void toast.error(errorText(t, r.error));
    toast.success(t("kg.saved")); await onDone();
  };
  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1"><Label htmlFor="kg-tv">{t("kg.targetValue")}</Label><Input id="kg-tv" inputMode="decimal" value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="kg-td">{t("kg.targetDate")}</Label><Input id="kg-td" type="date" min={new Date().toISOString().slice(0, 10)} value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor="kg-tp">{t("kg.periodKind")}</Label>
          <select id="kg-tp" className={`${sel} w-full`} value={v.period} onChange={(e) => setV({ ...v, period: e.target.value })}>{(["month", "quarter", "year"] as const).map((k) => <option key={k} value={k}>{t(`kg.p.${k}`)}</option>)}</select></div>
        <div className="space-y-1"><Label htmlFor="kg-to2">{t("kg.ownerLabel")}</Label>
          <select id="kg-to2" className={`${sel} w-full`} value={v.owner} onChange={(e) => setV({ ...v, owner: e.target.value })}><option value="">{t("kg.nobody")}</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name}</option>)}</select></div>
      </div>
      <div className="space-y-1"><Label htmlFor="kg-tnote">{t("kg.note")}</Label><Input id="kg-tnote" maxLength={500} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></div>
      <div className="flex gap-2"><Button size="sm" onClick={save} disabled={busy || !ok}>{busy ? t("kg.saving") : t("kg.save")}</Button><Button size="sm" variant="ghost" onClick={onCancel}>{t("kg.cancel")}</Button></div>
    </div>
  );
}

function WithdrawTarget({ metricId, onDone }: { metricId: string; onDone: () => Promise<void> }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!window.confirm(t("kg.withdrawConfirm"))) return;
    setBusy(true);
    const r = await db.rpc("set_metric_target", { _metric: metricId, _request: crypto.randomUUID(), _value: null, _target_date: null, _period_kind: null, _owner: null, _note: "", _withdraw: true });
    setBusy(false);
    if (r.error) return void toast.error(errorText(t, r.error));
    toast.success(t("kg.saved")); await onDone();
  };
  return <Button size="sm" variant="ghost" onClick={go} disabled={busy}><X className="h-4 w-4" /> {t("kg.withdraw")}</Button>;
}
