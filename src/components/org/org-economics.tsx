// Organization economics tab: every business the caller can open, each through the same reader and summary as its
// own Growth economics page. Nothing crosses businesses in the database; the table keeps every currency apart and the
// converted view below converts month by month at each month's own official rate (or withholds the figure).
import { useQueries } from "@tanstack/react-query";
import { econOptions } from "@/components/econ/econ-data";
import { econNotInstalled } from "@/lib/econ/read";
import { economicsSummary } from "@/lib/econ/summary";
import { orgEconomics, type BusinessEcon } from "@/lib/org/economics";
import { useI18n } from "@/lib/i18n";
import { Section } from "@/components/bi/parts";
import { tk, todayIso, type Period, periodFrom } from "@/components/org/org-model";
import { Button } from "@/components/ui/button";
import { OrgEconomicsConverted } from "@/components/org/org-economics-converted";

const MAX_BUSINESSES = 25;

export function OrgEconomics({ orgId, businesses, period, cur, open }: { orgId: string; businesses: { id: string; name: string }[]; period: Period; cur: string; open: (id: string) => void }) {
  const { t, tag } = useI18n();
  const list = businesses.slice(0, MAX_BUSINESSES);
  const qs = useQueries({ queries: list.map((b) => econOptions(orgId, b.id)) });
  const money = (n: number, c: string) => new Intl.NumberFormat(tag, { style: "currency", currency: c }).format(n);
  const title = t(tk("ogo.ec.title"));
  if (qs.some((q) => q.isLoading)) return <Section title={title}><p role="status" className="text-sm text-muted-foreground">{t(tk("ogo.ec.loading"))}</p></Section>;
  if (qs.some((q) => q.error && !econNotInstalled(q.error))) return <Section title={title}><p role="alert" className="text-sm text-destructive">{t(tk("ogo.ec.failed"))}</p></Section>;
  if (qs.every((q) => q.error)) return <Section title={title}><p className="text-sm text-muted-foreground">{t(tk("ogo.ec.off"))}</p></Section>;
  // The period runs to the end of the current month, so monthly costs of this month stay inside it (as on each
  // business's own page); later days simply have no records yet.
  const today = todayIso();
  const [y, mo] = today.split("-").map(Number) as [number, number];
  const from = periodFrom(period), to = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
  const rows: (BusinessEcon & { data: NonNullable<(typeof qs)[number]["data"]> })[] = list.flatMap((b, i) => { const d = qs[i]?.data; return d ? [{ id: b.id, name: b.name, data: d, summary: economicsSummary(d, from, to, "last_touch", today) }] : []; });
  const o = orgEconomics(rows);
  const name = (id: string) => rows.find((r) => r.id === id)?.name ?? "";
  return (
    <Section title={title} intro={t(tk("ogo.ec.intro"))}>
      {businesses.length > MAX_BUSINESSES && <p role="alert" className="mb-2 text-xs text-warning">{t(tk("ogo.ec.capped"), { n: String(MAX_BUSINESSES) })}</p>}
      {o.incomplete.length > 0 && <p role="alert" className="mb-2 text-xs text-warning">{t(tk("ogo.ec.incomplete"), { names: o.incomplete.map(name).join(", ") })}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-xs">
          <thead className="text-left text-muted-foreground"><tr>{["business", "currency", "net", "spent", "costs", "gp", "credits"].map((h) => <th key={h} className="py-1.5 pr-3 font-normal">{t(tk(`ogo.ec.col.${h}`))}</th>)}<th /></tr></thead>
          <tbody>
            {rows.flatMap((b) => {
              const cs = b.summary.currencies;
              const credits = <td className="py-1.5 pr-3">{b.summary.ai.total}{b.summary.ai.cost.priced > 0 ? ` · ${money(b.summary.ai.cost.amount, b.summary.ai.cost.currency)}` : ""}</td>;
              const action = <td className="py-1.5"><Button size="sm" variant="ghost" onClick={() => open(b.id)}>{t(tk("ogo.ec.open"))}</Button></td>;
              if (!cs.length) return [<tr key={b.id} className="border-t border-border"><td className="py-1.5 pr-3 font-medium">{b.name}</td><td colSpan={5} className="py-1.5 pr-3 text-muted-foreground">{t(tk("ogo.ec.nothing"))}</td>{credits}{action}</tr>];
              return cs.map((c, i) => (
                <tr key={`${b.id}:${c.currency}`} className="border-t border-border tabular-nums">
                  <td className="py-1.5 pr-3 font-medium">{i === 0 ? b.name : ""}</td>
                  <td className="py-1.5 pr-3">{c.currency}</td>
                  <td className="py-1.5 pr-3">{c.rev ? money(c.rev.net, c.currency) : "—"}</td>
                  <td className="py-1.5 pr-3">{money(c.spent, c.currency)}{c.simulated > 0 ? ` (${t(tk("ogo.ec.sim"))} ${money(c.simulated, c.currency)})` : ""}</td>
                  <td className="py-1.5 pr-3">{money(c.costs, c.currency)}</td>
                  <td className="py-1.5 pr-3">{c.gp?.grossProfit != null ? `${money(c.gp.grossProfit, c.currency)}${c.gp.grossMargin != null ? ` · ${c.gp.grossMargin}%` : ""}` : (c.rev?.sales ? t(tk("ogo.ec.notCalc")) : "—")}</td>
                  {i === 0 ? credits : <td />}
                  {i === 0 ? action : <td />}
                </tr>));
            })}
            {o.currencies.map((c, ci) => (
              <tr key={`total:${c.currency}`} className="border-t-2 border-border font-semibold tabular-nums">
                <td className="py-1.5 pr-3">{t(tk("ogo.ec.total"), { n: String(c.businesses) })}</td>
                <td className="py-1.5 pr-3">{c.currency}</td>
                <td className="py-1.5 pr-3">{money(c.net, c.currency)}</td>
                <td className="py-1.5 pr-3">{money(c.spent, c.currency)}</td>
                <td className="py-1.5 pr-3">{money(c.costs, c.currency)}</td>
                <td className="py-1.5 pr-3 font-normal">{c.grossProfit !== null ? `${money(c.grossProfit, c.currency)}${c.margin !== null ? ` · ${c.margin}%` : ""}` : t(tk("ogo.ec.gpMissing"), { n: String(c.grossProfitMissing) })}</td>
                <td className="py-1.5 pr-3">{ci === 0 ? `${o.credits}${o.aiCost !== null ? ` · ${money(o.aiCost, "EUR")}` : ""}` : ""}</td><td />
              </tr>))}
          </tbody>
        </table>
      </div>
      {o.unpriced > 0 && <p className="mt-2 text-xs text-muted-foreground">{t(tk("ogo.ec.unpriced"), { n: String(o.unpriced) })}</p>}
      {o.alerts.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs">{o.alerts.map((a) => <li key={`${a.business}:${a.id}`}><span className="font-medium">{name(a.business)}</span> — {t(tk(`signal.${a.code}.title`), a.vars)}</li>)}</ul>
      )}
      <p className="mt-3 text-xs text-muted-foreground">{t(tk("ogo.ec.note"))}</p>
      {rows.length > 0 && <OrgEconomicsConverted orgId={orgId} cur={cur} from={from} to={to} today={today} rows={rows} />}
    </Section>
  );
}
