// KPI progress (pure): baseline, target and history for one metric, from recorded rows only.
// * Current baseline/target = the newest row not superseded by another; a withdrawn target means "no target".
// * Change from the baseline is computed only against an actual result for a comparable period (same length, no
//   overlap: kpi-periods `comparable`); percentage change only when the baseline is not zero and the unit is not a
//   percentage (percent metrics change in points).
// * Progress toward the target = (current − baseline) ÷ (target − baseline); null when either is missing or the
//   target equals the baseline. Never clamped, so overshooting or moving away stays visible.
// * Missing months = calendar months between the baseline and the latest result without an actual value.
import { comparable } from "@/lib/kpi-periods";
import { effectiveMeasurements, isActual, monthlySeries, type Measurement } from "@/lib/performance";

export type BaselineRow = {
  id: string; metric_id: string; basis: "manual" | "measured" | string; measurement_kind: string | null;
  value: number | string; period_start: string; period_end: string; source: string; note: string;
  supersedes_id: string | null; created_by: string; created_at: string;
};
export type TargetRow = {
  id: string; metric_id: string; withdrawn: boolean; value: number | string | null; target_date: string | null;
  period_kind: "month" | "quarter" | "year" | string | null; owner_id: string | null; note: string;
  supersedes_id: string | null; created_by: string; created_at: string;
};

export function currentRow<T extends { id: string; supersedes_id: string | null; created_at: string }>(rows: readonly T[]): T | null {
  const superseded = new Set(rows.map((r) => r.supersedes_id).filter((x): x is string => !!x));
  return [...rows].filter((r) => !superseded.has(r.id)).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] ?? null;
}

/** Oldest first; the chain the current row descends from plus any parallel history, by time. */
export const history = <T extends { created_at: string }>(rows: readonly T[]) => [...rows].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));

export type Trend = "up" | "down" | "flat" | "unknown";
export type KpiProgress = {
  baseline: BaselineRow | null;
  target: TargetRow | null;
  current: { value: number; period_start: string; period_end: string; kind: string } | null;
  previous: { value: number; period_start: string } | null;
  change: number | null;
  changePct: number | null;
  /** Why no change from the baseline is shown, when it is not. */
  changeBlocked: "no_baseline" | "no_result" | "different_length" | "overlap" | null;
  progress: number | null;
  /** Whether the latest change moves in the metric's good direction. */
  improving: boolean | null;
  trend: Trend;
  missingMonths: string[];
  daysLeft: number | null;
};

const DAY = 86_400_000;
const ym = (s: string) => s.slice(0, 7);
const nextMonth = (m: string) => { const [y, mo] = m.split("-").map(Number) as [number, number]; return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`; };

export function kpiProgress(i: {
  metricId: string; direction: string; unit: string; rows: readonly Measurement[];
  baselines: readonly BaselineRow[]; targets: readonly TargetRow[]; today: string;
}): KpiProgress {
  const baseline = currentRow(i.baselines.filter((b) => b.metric_id === i.metricId));
  const t = currentRow(i.targets.filter((x) => x.metric_id === i.metricId));
  const target = t && !t.withdrawn ? t : null;
  const actuals = effectiveMeasurements(i.rows.filter((r) => r.metric_id === i.metricId && isActual(r.kind)))
    .sort((a, b) => (a.period_start < b.period_start ? 1 : a.period_start > b.period_start ? -1 : 0));
  const latest = actuals[0];
  const current = latest ? { value: Number(latest.value), period_start: latest.period_start, period_end: latest.period_end, kind: latest.kind } : null;
  const prevRow = latest ? actuals.find((r) => r.period_end < latest.period_start) : undefined;
  const previous = prevRow ? { value: Number(prevRow.value), period_start: prevRow.period_start } : null;
  const better = (d: number) => (i.direction === "decrease" ? d < 0 : d > 0);

  let change: number | null = null, changePct: number | null = null, changeBlocked: KpiProgress["changeBlocked"] = null;
  if (!baseline) changeBlocked = "no_baseline";
  else if (!latest) changeBlocked = "no_result";
  else if (baseline.basis === "measured" && latest.period_start === baseline.period_start) changeBlocked = "no_result";
  else {
    const asMeasurement = { id: baseline.id, metric_id: i.metricId, kind: "manual_actual", period_start: baseline.period_start, period_end: baseline.period_end, value: baseline.value, corrects_id: null, created_at: baseline.created_at } as Measurement;
    const c = comparable(asMeasurement, latest);
    if (!c.ok) changeBlocked = c.reason === "overlap" ? "overlap" : "different_length";
    else {
      const b = Number(baseline.value);
      change = round(current!.value - b);
      changePct = b !== 0 && i.unit !== "percent" ? round(((current!.value - b) / Math.abs(b)) * 100) : null;
    }
  }
  const tv = target?.value != null ? Number(target.value) : null;
  const bv = baseline ? Number(baseline.value) : null;
  const progress = change !== null && tv !== null && bv !== null && tv !== bv ? round(((current!.value - bv) / (tv - bv)) * 100) : null;

  const series = monthlySeries(i.rows.filter((r) => r.metric_id === i.metricId)).filter((p) => p.actual !== null).slice(-3);
  let trend: Trend = "unknown";
  if (series.length >= 3) {
    const d1 = series[1]!.actual! - series[0]!.actual!, d2 = series[2]!.actual! - series[1]!.actual!;
    trend = d1 > 0 && d2 > 0 ? "up" : d1 < 0 && d2 < 0 ? "down" : d1 === 0 && d2 === 0 ? "flat" : "unknown";
  }

  const missingMonths: string[] = [];
  if (latest) {
    const have = new Set(actuals.map((r) => ym(r.period_start)));
    const start = baseline ? nextMonth(ym(baseline.period_end)) : ym(actuals[actuals.length - 1]!.period_start);
    for (let m = start, n = 0; m < ym(latest.period_start) && n < 60; m = nextMonth(m), n++) if (!have.has(m)) missingMonths.push(m);
  }
  const daysLeft = target?.target_date ? Math.round((Date.parse(`${target.target_date}T00:00:00Z`) - Date.parse(`${i.today}T00:00:00Z`)) / DAY) : null;
  return {
    baseline, target, current, previous, change, changePct, changeBlocked, progress,
    improving: change === null || change === 0 ? null : better(change),
    trend, missingMonths, daysLeft,
  };
}
const round = (n: number) => Math.round(n * 100) / 100;
