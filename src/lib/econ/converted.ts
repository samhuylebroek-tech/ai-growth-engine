// Converted growth economics for the Growth Officer (pure). Reuses the month-by-month canonical figures
// (src/lib/econ/monthly.ts) and the organization view's closing-rate conversion (src/lib/org/period-conversion.ts), so
// the AI sees the same converted totals as Home and the organization overview. Original per-currency amounts stay the
// authoritative figures; a converted total is withheld with the reason when a rate is missing or the months do not
// add up to the period summary. Gross profit is never converted here (it is per-currency only).
import { monthlyFigures, reconcileMonths } from "@/lib/econ/monthly";
import type { EconData } from "@/lib/econ/read";
import type { EconSummary } from "@/lib/econ/summary";
import type { Rate } from "@/lib/org/consolidation";
import { convertByMonth, ratesUsed } from "@/lib/org/period-conversion";

const METRICS = [
  ["net", "net revenue (recorded)"],
  ["spent", "actual campaign spending"],
  ["costs", "recorded business costs"],
] as const;

/** Currencies with money in the period summary. */
export const summaryCurrencies = (s: EconSummary) =>
  s.currencies
    .filter((c) => c.rev?.net || c.rev?.sales || c.spent || c.costs)
    .map((c) => c.currency)
    .sort();

/** One labelled line, or null when every amount is already in the reporting currency. */
export function convertedEconomicsLine(
  d: EconData,
  s: EconSummary,
  from: string,
  to: string,
  today: string,
  target: string,
  rates: readonly Rate[],
): string | null {
  const cur = summaryCurrencies(s);
  if (!(cur.length > 1 || (cur.length === 1 && cur[0] !== target))) return null;
  const months = monthlyFigures(d, from, to);
  const ok = reconcileMonths(months, s);
  const parts: string[] = [];
  const used = new Map<string, string>();
  for (const [k, label] of METRICS) {
    if (!ok[k]) {
      parts.push(`${label}: not converted (months do not add up to the period figure)`);
      continue;
    }
    const c = convertByMonth(
      months.map((m) => ({ month: m.month, money: m[k] })),
      target,
      rates,
      today,
    );
    if (c.total === null)
      parts.push(
        `${label}: not converted (no usable rate for ${c.missing.map((x) => `${x.from} on ${x.refDate}`).join(", ")})`,
      );
    else parts.push(`${label} ${c.total} ${target}`);
    for (const r of ratesUsed(c))
      if (r.method !== "same")
        used.set(
          `${r.from}:${r.rateDate}`,
          `1 ${r.from} = ${r.rate.toFixed(4)} ${target} (${r.source}, ${r.rateDate})`,
        );
  }
  return `converted to ${target} at each month's closing rate — a reporting view only, the per-currency amounts are authoritative and gross profit is not converted: ${parts.join("; ")}${used.size ? `; rates used: ${[...used.values()].join(", ")}` : ""}`;
}
