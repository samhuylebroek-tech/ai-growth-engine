// Turns provider values into imports for the workspace's own tracked metrics. A value is imported only
// into a metric with the same key, unit and currency; everything else is reported, never guessed.
import type { ImportedValue } from "./read-only";

export type TrackedMetric = { id: string; key: string; unit: string; currency: string | null; archived: boolean };
export type PlannedImport = { metricId: string; metricKey: string; month: string; periodStart: string; periodEnd: string; value: number; sourceRef: string };
export type ImportPlan = { imports: PlannedImport[]; untracked: string[]; mismatched: string[] };

/** The last `months` complete calendar months before `now` (UTC), oldest first. */
export function completeMonths(now: Date, months: number): { month: string; start: string; end: string }[] {
  const out = [];
  for (let i = months; i >= 1; i--) {
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
    out.push({ month: first.toISOString().slice(0, 7), start: first.toISOString().slice(0, 10), end: last.toISOString().slice(0, 10) });
  }
  return out;
}

export function planImports(values: ImportedValue[], metrics: TrackedMetric[], months: { month: string; start: string; end: string }[]): ImportPlan {
  const byKey = new Map(metrics.filter(m => !m.archived).map(m => [m.key, m]));
  const window = new Map(months.map(m => [m.month, m]));
  const imports: PlannedImport[] = []; const untracked = new Set<string>(); const mismatched = new Set<string>();
  for (const v of values) {
    const period = window.get(v.month); if (!period) continue;
    const m = byKey.get(v.metricKey);
    if (!m) { untracked.add(v.metricKey); continue; }
    if (m.unit !== v.unit || (v.unit === "currency" && m.currency !== v.currency)) { mismatched.add(v.metricKey); continue; }
    imports.push({ metricId: m.id, metricKey: v.metricKey, month: v.month, periodStart: period.start, periodEnd: period.end, value: v.value, sourceRef: v.sourceRef });
  }
  return { imports, untracked: [...untracked].sort(), mismatched: [...mismatched].sort() };
}

/** Deterministic request key per run/metric/month, so retrying the same run never duplicates a value. */
export async function importRequestKey(runId: string, metricId: string, month: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${runId}|${metricId}|${month}`))).slice(0, 16);
  d[6] = (d[6]! & 0x0f) | 0x50; d[8] = (d[8]! & 0x3f) | 0x80;
  const h = [...d].map(b => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
