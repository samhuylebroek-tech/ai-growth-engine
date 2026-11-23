// Historical currency conversion for reports (pure). Methodology: each calendar month is converted at the closing
// rate of that month — the latest rate published on or before the month's last day (or today for the current
// month), so weekends and public holidays fall back to the last publication day. A rate older than
// MAX_RATE_AGE_DAYS before that day is not used. Rates are explicit stored rows (official ECB or recorded manual
// rates; an official rate wins on the same day); two official ECB euro rates of the same day give the ECB cross
// rate between two other currencies, labelled as such. Nothing is invented: when a month lacks a rate, its original
// amount stays visible and the converted total is withheld with the reason.
import { findRate, type Rate } from "@/lib/org/consolidation";

export const MAX_RATE_AGE_DAYS = 7;
export type RateMethod = "same" | "direct" | "inverse" | "ecb_cross";
export type RateUse = {
  ok: true;
  from: string;
  to: string;
  rate: number;
  rateDate: string;
  source: string;
  method: RateMethod;
  refDate: string;
};
export type RateMiss = {
  ok: false;
  from: string;
  to: string;
  refDate: string;
  reason: "no_rate" | "too_old";
  latest: string | null;
};

const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Last day of a YYYY-MM month. */
export const monthEnd = (month: string) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

function ecbCross(
  rates: readonly Rate[],
  from: string,
  to: string,
  refDate: string,
): RateUse | null {
  if (from === "EUR" || to === "EUR") return null;
  const off = (cur: string) =>
    new Map(
      rates
        .filter(
          (r) =>
            r.kind === "official" &&
            r.base_currency === "EUR" &&
            r.quote_currency === cur &&
            r.rate_date <= refDate &&
            Number(r.rate) > 0,
        )
        .map((r) => [r.rate_date, r]),
    );
  const a = off(from),
    b = off(to);
  const common = [...a.keys()]
    .filter((d) => b.has(d))
    .sort()
    .at(-1);
  if (!common) return null;
  const fa = a.get(common)!,
    fb = b.get(common)!;
  return {
    ok: true,
    from,
    to,
    rate: Number(fb.rate) / Number(fa.rate),
    rateDate: common,
    source: fa.source,
    method: "ecb_cross",
    refDate,
  };
}

/** The closing rate for converting `from` into `to` on `refDate`, or the reason there is none. */
export function closingRate(
  rates: readonly Rate[],
  from: string,
  to: string,
  refDate: string,
  maxAge = MAX_RATE_AGE_DAYS,
): RateUse | RateMiss {
  if (from === to)
    return {
      ok: true,
      from,
      to,
      rate: 1,
      rateDate: refDate,
      source: "same currency",
      method: "same",
      refDate,
    };
  const d = findRate(rates, from, to, refDate);
  const direct: RateUse | null = d
    ? {
        ok: true,
        from,
        to,
        rate: d.rate,
        rateDate: d.rateDate,
        source: d.source,
        method: d.inverted ? "inverse" : "direct",
        refDate,
      }
    : null;
  const cross = ecbCross(rates, from, to, refDate);
  const best = direct && (!cross || direct.rateDate >= cross.rateDate) ? direct : cross;
  if (!best) return { ok: false, from, to, refDate, reason: "no_rate", latest: null };
  if (days(best.rateDate, refDate) > maxAge)
    return { ok: false, from, to, refDate, reason: "too_old", latest: best.rateDate };
  return best;
}

export type MonthMoney = { month: string; money: Record<string, number> };
export type ConvertedLine = {
  month: string;
  currency: string;
  amount: number;
  converted: number | null;
  use: RateUse | RateMiss;
};
export type MonthlyConversion = {
  target: string;
  total: number | null;
  original: Record<string, number>;
  lines: ConvertedLine[];
  missing: RateMiss[];
};

/** Converts month-by-month amounts, each month at its own closing rate; the total is withheld if any rate is missing.
 *  Each line is rounded to cents and the total is the sum of the rounded lines, so lines always add up. */
export function convertByMonth(
  months: readonly MonthMoney[],
  target: string,
  rates: readonly Rate[],
  today: string,
): MonthlyConversion {
  const lines: ConvertedLine[] = [];
  const missing: RateMiss[] = [];
  const original: Record<string, number> = {};
  for (const m of months) {
    const end = monthEnd(m.month);
    const ref = end < today ? end : today;
    for (const [currency, amount] of Object.entries(m.money).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      if (!amount) continue;
      original[currency] = r2((original[currency] ?? 0) + amount);
      const use = closingRate(rates, currency, target, ref);
      lines.push({
        month: m.month,
        currency,
        amount,
        converted: use.ok ? r2(amount * use.rate) : null,
        use,
      });
      if (!use.ok && !missing.some((x) => x.from === use.from && x.refDate === use.refDate))
        missing.push(use);
    }
  }
  const total = missing.length ? null : r2(lines.reduce((t, l) => t + (l.converted ?? 0), 0));
  return { target, total, original, lines, missing };
}

/** Distinct rates used, for showing source, date and rate next to a converted figure. */
export function ratesUsed(c: MonthlyConversion): RateUse[] {
  const seen = new Map<string, RateUse>();
  for (const l of c.lines)
    if (l.use.ok && l.use.method !== "same")
      seen.set(`${l.use.from}:${l.use.rateDate}:${l.use.method}`, l.use);
  return [...seen.values()].sort(
    (a, b) => a.rateDate.localeCompare(b.rateDate) || a.from.localeCompare(b.from),
  );
}
