// Organization economics in one reporting currency. Each business's months come from the same canonical reader and
// rules as its own page (src/lib/econ/monthly.ts); every month is converted at that month's own closing rate
// (src/lib/org/period-conversion.ts). Original amounts stay visible; a converted figure is withheld, with the reason,
// when a rate is missing or a business's months do not add up to its period figure.
import { useQuery } from "@tanstack/react-query";
import { growthDb, retryUnlessNotInstalled, isNotInstalled } from "@/lib/pending-schema";
import { monthlyFigures, monthlySum, reconcileMonths, type MonthFigures } from "@/lib/econ/monthly";
import type { EconData } from "@/lib/econ/read";
import type { EconSummary } from "@/lib/econ/summary";
import type { Rate } from "@/lib/org/consolidation";
import {
  convertByMonth,
  MAX_RATE_AGE_DAYS,
  ratesUsed,
  type MonthlyConversion,
} from "@/lib/org/period-conversion";
import { useI18n } from "@/lib/i18n";
import { tk } from "@/components/org/org-model";

type Biz = { id: string; name: string; data: EconData; summary: EconSummary };
const METRICS = ["net", "spent", "costs", "gp"] as const;
type Metric = (typeof METRICS)[number];
const RATE_LIMIT = 5000;

export function periodRatesOptions(orgId: string, from: string, to: string) {
  const since = new Date(Date.parse(`${from}T00:00:00Z`) - (MAX_RATE_AGE_DAYS + 3) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return {
    queryKey: ["org-period-rates", orgId, since, to] as const,
    staleTime: 60_000,
    retry: retryUnlessNotInstalled,
    queryFn: async () => {
      const r = await growthDb
        .from("exchange_rates")
        .select("id,base_currency,quote_currency,rate,rate_date,source,kind", { count: "exact" })
        .eq("org_id", orgId)
        .gte("rate_date", since)
        .lte("rate_date", to)
        .order("rate_date", { ascending: false })
        .limit(RATE_LIMIT);
      if (r.error) {
        if (isNotInstalled(r.error))
          return { rates: [] as Rate[], complete: true, installed: false };
        throw r.error;
      }
      return {
        rates: (r.data ?? []) as Rate[],
        complete: (r.count ?? 0) <= RATE_LIMIT,
        installed: true,
      };
    },
  };
}

export function OrgEconomicsConverted({
  orgId,
  cur,
  from,
  to,
  today,
  rows,
}: {
  orgId: string;
  cur: string;
  from: string;
  to: string;
  today: string;
  rows: readonly Biz[];
}) {
  const { t, tag } = useI18n();
  const q = useQuery(periodRatesOptions(orgId, from, to));
  const money = (n: number, c: string) =>
    new Intl.NumberFormat(tag, { style: "currency", currency: c }).format(n);
  const many = (m: Record<string, number>) =>
    Object.entries(m)
      .filter(([, v]) => v)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([c, v]) => money(v, c))
      .join(" · ") || "—";
  const date = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString(tag, { timeZone: "UTC" });
  const heading = <h3 className="text-sm font-semibold">{t(tk("ogo.cv.title"), { cur })}</h3>;
  if (q.isLoading)
    return (
      <div className="mt-4 space-y-1">
        {heading}
        <p role="status" className="text-xs text-muted-foreground">
          {t(tk("ogo.cv.loading"))}
        </p>
      </div>
    );
  if (q.error || !q.data)
    return (
      <div className="mt-4 space-y-1">
        {heading}
        <p role="alert" className="text-xs text-destructive">
          {t(tk("ogo.cv.failed"))}
        </p>
      </div>
    );
  const rates = q.data.rates;

  const months = rows.map((b) => {
    const ms = monthlyFigures(b.data, from, to);
    return { b, months: ms, ok: reconcileMonths(ms, b.summary) };
  });
  const conv = (ms: readonly MonthFigures[], k: Metric) =>
    convertByMonth(
      ms.map((m) => ({ month: m.month, money: m[k] })),
      cur,
      rates,
      today,
    );
  const total = (k: Metric) => {
    const notAdding = months.filter((x) => !x.ok[k]);
    const all = months.flatMap((x) => x.months);
    return {
      c: conv(all, k),
      original: monthlySum(all, k),
      notAdding: notAdding.map((x) => x.b.name),
    };
  };
  const totals = METRICS.map((k) => ({ k, ...total(k) }));
  const used = ratesUsed(
    totals.reduce<MonthlyConversion>(
      (acc, x) => ({ ...acc, lines: [...acc.lines, ...x.c.lines] }),
      { target: cur, total: 0, original: {}, lines: [], missing: [] },
    ),
  );
  const missing = [
    ...new Map(
      totals.flatMap((x) => x.c.missing).map((m) => [`${m.from}:${m.refDate}`, m]),
    ).values(),
  ];
  const value = (x: { c: MonthlyConversion; notAdding: string[] }, k: Metric) =>
    x.notAdding.length ? (
      <span className="text-muted-foreground">
        {t(tk(k === "gp" ? "ogo.cv.gpWithheld" : "ogo.cv.notAdding"), {
          names: x.notAdding.join(", "),
        })}
      </span>
    ) : x.c.total === null ? (
      <span className="text-muted-foreground">{t(tk("ogo.cv.withheld"))}</span>
    ) : (
      <span className="font-semibold">{money(x.c.total, cur)}</span>
    );

  return (
    <div className="mt-4 space-y-2" aria-label={t(tk("ogo.cv.title"), { cur })}>
      {heading}
      <p className="text-xs text-muted-foreground">
        {t(tk("ogo.cv.method"), { d: String(MAX_RATE_AGE_DAYS) })}
      </p>
      {!q.data.complete && (
        <p role="alert" className="text-xs text-warning">
          {t(tk("ogo.cv.ratesIncomplete"))}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-xs">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1.5 pr-3 font-normal">{t(tk("ogo.cv.col.figure"))}</th>
              <th className="py-1.5 pr-3 font-normal">{t(tk("ogo.cv.col.original"))}</th>
              <th className="py-1.5 pr-3 font-normal">{t(tk("ogo.cv.col.converted"), { cur })}</th>
            </tr>
          </thead>
          <tbody>
            {totals.map((x) => (
              <tr key={x.k} className="border-t border-border tabular-nums">
                <td className="py-1.5 pr-3">{t(tk(`ogo.ec.col.${x.k}`))}</td>
                <td className="py-1.5 pr-3">{x.notAdding.length ? "—" : many(x.original)}</td>
                <td className="py-1.5 pr-3">{value(x, x.k)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 1 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1.5 pr-3 font-normal">{t(tk("ogo.ec.col.business"))}</th>
                {(["net", "spent", "costs"] as const).map((k) => (
                  <th key={k} className="py-1.5 pr-3 font-normal">
                    {t(tk(`ogo.ec.col.${k}`))} ({cur})
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {months.map((x) => (
                <tr key={x.b.id} className="border-t border-border tabular-nums">
                  <td className="py-1.5 pr-3 font-medium">{x.b.name}</td>
                  {(["net", "spent", "costs"] as const).map((k) => {
                    const c = conv(x.months, k);
                    return (
                      <td key={k} className="py-1.5 pr-3">
                        {!x.ok[k]
                          ? t(tk("ogo.cv.short.notAdding"))
                          : c.total === null
                            ? t(tk("ogo.cv.short.withheld"))
                            : money(c.total, cur)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {used.length > 0 && (
        <div className="text-xs text-muted-foreground">
          <p className="font-medium text-foreground">{t(tk("ogo.cv.rates"))}</p>
          <ul className="space-y-0.5">
            {used.map((u) => (
              <li key={`${u.from}:${u.rateDate}:${u.method}`} className="tabular-nums">
                {t(tk(`ogo.cv.rate.${u.method}`), {
                  pair: `1 ${u.from} = ${u.rate.toFixed(4)} ${u.to}`,
                  date: date(u.rateDate),
                  month: date(u.refDate),
                  source: u.source,
                })}
              </li>
            ))}
          </ul>
        </div>
      )}
      {missing.length > 0 && (
        <ul role="alert" className="space-y-0.5 text-xs text-warning">
          {missing.map((m) => (
            <li key={`${m.from}:${m.refDate}`}>
              {t(tk(m.reason === "too_old" ? "ogo.cv.miss.old" : "ogo.cv.miss.none"), {
                pair: `${m.from}→${m.to}`,
                date: date(m.refDate),
                latest: m.latest ? date(m.latest) : "",
                d: String(MAX_RATE_AGE_DAYS),
              })}
            </li>
          ))}
        </ul>
      )}
      {totals.every((x) => Object.keys(x.original).every((c) => c === cur)) && (
        <p className="text-xs text-muted-foreground">{t(tk("ogo.cv.allSame"), { cur })}</p>
      )}
      <p className="text-xs text-muted-foreground">{t(tk("ogo.cv.note"))}</p>
    </div>
  );
}
