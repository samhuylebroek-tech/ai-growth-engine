// KPI measurement periods (pure). Decides whether two measured periods may be compared and what a before/after
// comparison around a decision date may honestly say:
//   * only results in force (corrections applied) and actual kinds count; planned/forecast values never do;
//   * two periods are comparable when they do not overlap and have the same length (whole calendar months count as
//     equal length; otherwise lengths may differ by at most one day);
//   * the change must exceed the metric's own earlier period-to-period fluctuation before confidence is "medium";
//     a single before/after pair is always "low"; nothing here claims a cause.
import { effectiveMeasurements, isActual, type Measurement } from "@/lib/performance";
import { observedOutcome } from "@/lib/bi/optimization";

const DAY = 86_400_000;
const d = (s: string) => Date.parse(`${s.slice(0, 10)}T00:00:00Z`);
export const periodDays = (m: { period_start: string; period_end: string }) =>
  Math.round((d(m.period_end) - d(m.period_start)) / DAY) + 1;
const wholeMonth = (m: { period_start: string; period_end: string }) => {
  const s = new Date(d(m.period_start)),
    e = new Date(d(m.period_end) + DAY);
  return (
    s.getUTCDate() === 1 &&
    e.getUTCDate() === 1 &&
    e.getUTCMonth() - s.getUTCMonth() + 12 * (e.getUTCFullYear() - s.getUTCFullYear()) === 1
  );
};

export type Comparability =
  | { ok: true }
  | { ok: false; reason: "overlap" | "different_length" | "not_actual" | "different_metric" };
export function comparable(a: Measurement, b: Measurement): Comparability {
  if (a.metric_id !== b.metric_id) return { ok: false, reason: "different_metric" };
  if (!isActual(a.kind) || !isActual(b.kind)) return { ok: false, reason: "not_actual" };
  if (!(a.period_end < b.period_start || b.period_end < a.period_start))
    return { ok: false, reason: "overlap" };
  if (wholeMonth(a) && wholeMonth(b)) return { ok: true };
  return Math.abs(periodDays(a) - periodDays(b)) <= 1
    ? { ok: true }
    : { ok: false, reason: "different_length" };
}

export type BeforeAfter = {
  outcome: "improved" | "no_change" | "worse" | "inconclusive";
  reason: "ok" | "no_before" | "no_after" | "no_comparable_after";
  before: { value: number; period_start: string; period_end: string } | null;
  after: { value: number; period_start: string; period_end: string } | null;
  changePct: number | null;
  normalFluctuationPct: number | null;
  confidence: "low" | "medium" | null;
};

/** Before = latest actual period ending before the decision; after = latest comparable actual period starting on/after it. */
export function beforeAfter(
  rows: readonly Measurement[],
  metricId: string,
  direction: string,
  decisionDate: string,
): BeforeAfter {
  const pivot = decisionDate.slice(0, 10);
  const live = effectiveMeasurements(rows)
    .filter((r) => r.metric_id === metricId && isActual(r.kind))
    .sort((a, b) => a.period_start.localeCompare(b.period_start));
  const befores = live.filter((r) => r.period_end < pivot);
  const before = befores.at(-1);
  const empty = {
    before: null,
    after: null,
    changePct: null,
    normalFluctuationPct: null,
    confidence: null,
  } as const;
  if (!before) return { ...empty, outcome: "inconclusive", reason: "no_before" };
  const afters = live.filter((r) => r.period_start >= pivot);
  if (afters.length === 0) return { ...empty, outcome: "inconclusive", reason: "no_after" };
  const after = [...afters].reverse().find((r) => comparable(before, r).ok);
  if (!after) return { ...empty, outcome: "inconclusive", reason: "no_comparable_after" };
  const b = Number(before.value),
    a = Number(after.value);
  const changePct = b === 0 ? null : Math.round(((a - b) / Math.abs(b)) * 1000) / 10;
  // Earlier fluctuation between consecutive comparable before-periods.
  const swings: number[] = [];
  for (let i = 1; i < befores.length; i += 1) {
    const x = befores[i - 1]!,
      y = befores[i]!;
    if (comparable(x, y).ok && Number(x.value) !== 0)
      swings.push(Math.abs((Number(y.value) - Number(x.value)) / Math.abs(Number(x.value))) * 100);
  }
  const normal = swings.length ? Math.round(Math.max(...swings) * 10) / 10 : null;
  const outcome = observedOutcome(direction, b, a);
  const confidence =
    outcome === "inconclusive"
      ? null
      : swings.length >= 2 && changePct !== null && Math.abs(changePct) > (normal ?? Infinity)
        ? "medium"
        : "low";
  return {
    outcome,
    reason: "ok",
    before: { value: b, period_start: before.period_start, period_end: before.period_end },
    after: { value: a, period_start: after.period_start, period_end: after.period_end },
    changePct,
    normalFluctuationPct: normal,
    confidence,
  };
}

export type KpiQuality = {
  periods: number;
  mixedLengths: boolean;
  gaps: number;
  overlaps: number;
  corrections: number;
  lastPeriodEnd: string | null;
  staleDays: number | null;
};
/** Measurement quality of one metric's actual results: mixed period lengths, gaps, overlaps, corrections and age. */
export function kpiQuality(
  rows: readonly Measurement[],
  metricId: string,
  today: string,
): KpiQuality {
  const mine = rows.filter((r) => r.metric_id === metricId);
  const live = effectiveMeasurements(mine)
    .filter((r) => isActual(r.kind))
    .sort((a, b) => a.period_start.localeCompare(b.period_start));
  let gaps = 0,
    overlaps = 0,
    mixed = false;
  for (let i = 1; i < live.length; i += 1) {
    const x = live[i - 1]!,
      y = live[i]!;
    const c = comparable(x, y);
    if (!c.ok && c.reason === "overlap") overlaps += 1;
    if (!c.ok && c.reason === "different_length") mixed = true;
    if (d(y.period_start) - d(x.period_end) > DAY) gaps += 1;
  }
  const last = live.at(-1)?.period_end ?? null;
  return {
    periods: live.length,
    mixedLengths: mixed,
    gaps,
    overlaps,
    corrections: mine.filter((r) => r.corrects_id).length,
    lastPeriodEnd: last,
    staleDays: last ? Math.max(0, Math.round((d(today) - d(last)) / DAY)) : null,
  };
}
