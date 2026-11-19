// Pure helpers for the performance measurement layer (migration 0056). No I/O.

export type MetricUnit = "count" | "currency" | "percent" | "ratio" | "days";
export type MeasurementKind = "planned" | "forecast" | "manual_actual" | "imported_actual" | "verified_actual";
export type MetricDef = { id: string; key: string; label: string; unit: MetricUnit | string; currency: string | null; direction: string; goal_id: string | null; archived: boolean };
export type Measurement = { id: string; metric_id: string; kind: MeasurementKind | string; period_start: string; period_end: string; value: number | string; corrects_id: string | null; created_at: string; note?: string; source?: string };

export const USER_KINDS: MeasurementKind[] = ["planned", "forecast", "manual_actual"];
const ACTUAL_RANK: Record<string, number> = { verified_actual: 3, imported_actual: 2, manual_actual: 1 };

export const KIND_LABEL: Record<MeasurementKind, string> = {
  planned: "Planned",
  forecast: "Forecast",
  manual_actual: "Entered result",
  imported_actual: "Imported result",
  verified_actual: "Verified result",
};
/** How much the AI and dashboard may trust a value. Only verified values count as measured fact. */
export const EVIDENCE: Record<MeasurementKind, "expectation" | "estimate" | "user_entered" | "imported" | "verified"> = {
  planned: "expectation",
  forecast: "estimate",
  manual_actual: "user_entered",
  imported_actual: "imported",
  verified_actual: "verified",
};

export const isActual = (kind: string) => kind in ACTUAL_RANK;

/** Rows still in force: a row replaced by a correction is history, not a current value. */
export function effectiveMeasurements<T extends Measurement>(rows: readonly T[]): T[] {
  const corrected = new Set(rows.map(r => r.corrects_id).filter((x): x is string => !!x));
  return rows.filter(r => !corrected.has(r.id));
}

/** Correction chain for one value, oldest first. */
export function correctionHistory<T extends Measurement>(rows: readonly T[], id: string): T[] {
  const byId = new Map(rows.map(r => [r.id, r] as const));
  const chain: T[] = [];
  let cur = byId.get(id);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) { seen.add(cur.id); chain.unshift(cur); cur = cur.corrects_id ? byId.get(cur.corrects_id) : undefined; }
  return chain;
}

const periodKey = (m: Pick<Measurement, "period_start" | "period_end">) => `${m.period_start}|${m.period_end}`;

export type MetricSummary = {
  period: { start: string; end: string } | null;
  actual: { value: number; kind: MeasurementKind } | null;
  planned: number | null;
  forecast: number | null;
  /** actual − planned for the same period, only when both exist. */
  variance: number | null;
  /** Whether the actual is on the good side of the plan, given the metric's direction. */
  onTrack: boolean | null;
  previousActual: number | null;
};

/** Latest period with an actual result; plan/forecast compared only for the exact same period. */
export function summarizeMetric(def: Pick<MetricDef, "id" | "direction">, rows: readonly Measurement[]): MetricSummary {
  const live = effectiveMeasurements(rows.filter(r => r.metric_id === def.id));
  const byPeriod = new Map<string, Measurement[]>();
  for (const r of live) byPeriod.set(periodKey(r), [...(byPeriod.get(periodKey(r)) ?? []), r]);
  const bestActual = (list: Measurement[]) => list.filter(r => isActual(r.kind)).sort((a, b) => (ACTUAL_RANK[b.kind] ?? 0) - (ACTUAL_RANK[a.kind] ?? 0))[0];
  const periods = [...byPeriod.keys()].sort((a, b) => (a < b ? 1 : -1));
  const withActual = periods.filter(p => bestActual(byPeriod.get(p) ?? []));
  const latest = withActual[0] ?? periods[0];
  if (!latest) return { period: null, actual: null, planned: null, forecast: null, variance: null, onTrack: null, previousActual: null };
  const list = byPeriod.get(latest) ?? [];
  const a = bestActual(list);
  const planned = list.find(r => r.kind === "planned");
  const forecast = list.find(r => r.kind === "forecast");
  const prev = withActual[1] ? bestActual(byPeriod.get(withActual[1]) ?? []) : undefined;
  const actualValue = a ? Number(a.value) : null;
  const plannedValue = planned ? Number(planned.value) : null;
  const variance = actualValue != null && plannedValue != null ? actualValue - plannedValue : null;
  const [start = "", end = ""] = latest.split("|");
  return {
    period: { start, end },
    actual: a && actualValue != null ? { value: actualValue, kind: a.kind as MeasurementKind } : null,
    planned: plannedValue,
    forecast: forecast ? Number(forecast.value) : null,
    variance,
    onTrack: variance == null ? null : def.direction === "decrease" ? variance <= 0 : variance >= 0,
    previousActual: prev ? Number(prev.value) : null,
  };
}

/** Add values only when they share one unit (and currency). Never converts or mixes. */
export function sumSameUnit(items: readonly { value: number; unit: string; currency: string | null }[]): { total: number; unit: string; currency: string | null } | null {
  if (!items.length) return null;
  const first = items[0]!;
  if (items.some(i => i.unit !== first.unit || (i.currency ?? null) !== (first.currency ?? null))) throw new Error("Values with different units or currencies cannot be added together");
  if (first.unit === "percent" || first.unit === "ratio") throw new Error("Percentages and ratios cannot be added together");
  return { total: items.reduce((s, i) => s + i.value, 0), unit: first.unit, currency: first.currency ?? null };
}

/** Stable metric key from a label: lowercase, underscores, 2–60 chars, starts with a letter. */
export function metricKey(label: string): string {
  const k = label.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  const withLetter = /^[a-z]/.test(k) ? k : `m_${k}`.slice(0, 60);
  return withLetter.length >= 2 ? withLetter : "metric";
}

/** First and last day of a calendar month given as YYYY-MM. */
export function monthPeriod(month: string): { start: string; end: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new Error("Use a YYYY-MM month");
  const y = Number(m[1]), mo = Number(m[2]);
  if (mo < 1 || mo > 12) throw new Error("Use a YYYY-MM month");
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { start: `${m[1]}-${m[2]}-01`, end: `${m[1]}-${m[2]}-${String(last).padStart(2, "0")}` };
}

export function formatMetricValue(value: number, unit: string, currency: string | null, locale?: string): string {
  if (unit === "currency" && currency) return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
  if (unit === "percent") return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)}%`;
  if (unit === "days") return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} d`;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: unit === "ratio" ? 3 : 2 }).format(value);
}

/** Plain-language reliability label shown next to every value. */
export const RELIABILITY: Record<MeasurementKind, { label: string; tone: "muted" | "warning" | "info" | "success" }> = {
  planned: { label: "Plan", tone: "muted" },
  forecast: { label: "Estimate", tone: "muted" },
  manual_actual: { label: "Entered by team · not verified", tone: "warning" },
  imported_actual: { label: "Imported from a connected source", tone: "info" },
  verified_actual: { label: "Verified", tone: "success" },
};

export type MonthPoint = { month: string; planned: number | null; forecast: number | null; actual: number | null; actualKind: MeasurementKind | null };

/** One point per calendar month (YYYY-MM), oldest first, using only values still in force. */
export function monthlySeries(rows: readonly Measurement[]): MonthPoint[] {
  const live = effectiveMeasurements(rows);
  const byMonth = new Map<string, MonthPoint>();
  for (const r of live) {
    const month = r.period_start.slice(0, 7);
    const p = byMonth.get(month) ?? { month, planned: null, forecast: null, actual: null, actualKind: null };
    const v = Number(r.value);
    if (r.kind === "planned") p.planned = v;
    else if (r.kind === "forecast") p.forecast = v;
    else if (isActual(r.kind) && (ACTUAL_RANK[r.kind] ?? 0) > (p.actualKind ? ACTUAL_RANK[p.actualKind] ?? 0 : 0)) { p.actual = v; p.actualKind = r.kind as MeasurementKind; }
    byMonth.set(month, p);
  }
  return [...byMonth.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
}

export type MetricStatus = "on_track" | "behind" | "no_plan" | "no_result" | "no_data";
export function metricStatus(s: MetricSummary): MetricStatus {
  if (!s.period) return "no_data";
  if (!s.actual) return "no_result";
  if (s.onTrack == null) return "no_plan";
  return s.onTrack ? "on_track" : "behind";
}
export const STATUS_LABEL: Record<MetricStatus, string> = { on_track: "On track", behind: "Behind plan", no_plan: "No plan to compare", no_result: "No result yet", no_data: "No values yet" };

/** Months where both a forecast and a result exist: result − forecast, oldest first. */
export function forecastDeviations(rows: readonly Measurement[]): { month: string; forecast: number; actual: number; deviation: number }[] {
  return monthlySeries(rows).flatMap(p => (p.forecast != null && p.actual != null ? [{ month: p.month, forecast: p.forecast, actual: p.actual, deviation: p.actual - p.forecast }] : []));
}
