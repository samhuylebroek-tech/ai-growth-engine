// Growth indicators for the Growth Officer (pure): the same metric inputs, attribution and KPI formulas as the
// Business performance page (metricInputs + attribute + computeKpis), stated with their canonical formula so the AI
// uses each KPI with the same meaning and never recomputes or estimates one that is not calculable.
import { attribute, type RevenueEvent, type Touch } from "./attribution";
import { computeKpis, metricInputs, type DealLite } from "./kpis";
import { formulaText, KPI_DEFINITIONS } from "./kpi-definitions";
import type { Measurement } from "@/lib/performance";

type MetricLite = { id: string; key?: string; unit: string; currency: string | null };
export type KpiContextInput = {
  metrics: readonly MetricLite[];
  measurements: readonly Measurement[];
  revenue: readonly RevenueEvent[];
  touches: readonly Touch[];
  deals: readonly (Omit<DealLite, "created_at"> & { created_at?: string | null })[];
};

/** The last complete calendar month before `now` (UTC). */
export function lastFullMonth(now: Date) {
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  return { from: new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10), to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
}

export function kpiContextLines(d: KpiContextInput, now: Date): string[] {
  const { from, to } = lastFullMonth(now);
  const metrics = d.metrics.flatMap((m) => (m.key ? [{ id: m.id, key: m.key, unit: m.unit, currency: m.currency }] : []));
  const inputs = metricInputs(metrics, d.measurements, from, to);
  const attributed = new Map(attribute(d.revenue, d.touches, "last_touch", from, to).map((a) => [a.currency, a.attributed]));
  // Deals without a creation date still count for win rate and values; the sales-cycle figure skips them.
  const deals = d.deals.map((x) => ({ ...x, created_at: x.created_at ?? x.closed_at ?? `${from}T00:00:00Z` }));
  const kpis = computeKpis({ inputs, deals, attributed, models: [], from, to });
  const out = [`period ${from} – ${to} (last full month); recorded actual results only, last-touch attribution; per currency`];
  const ok = kpis.filter((k) => k.value !== null);
  for (const k of ok) {
    const def = KPI_DEFINITIONS[k.key];
    const unit = k.unit === "percent" ? "%" : k.unit === "currency" ? ` ${k.currency ?? ""}` : k.unit === "ratio" ? "x" : k.unit === "days" ? " days" : k.unit === "months" ? " months" : "";
    out.push(`- ${k.key} = ${k.value}${unit} [${k.cls ?? "manual"}] — formula: ${formulaText(def)}; ${def.better} is better`);
  }
  const not = kpis.filter((k) => k.value === null && k.reason !== "ok");
  if (not.length) out.push(`not calculable (do not estimate): ${not.map((k) => `${k.key} (${k.reason === "missing_inputs" || k.reason === "no_attribution" ? `missing ${k.missing.join(", ")}` : k.reason})`).join("; ")}`);
  if (!ok.length) out.push("no growth indicator can be calculated for this period");
  return out;
}
