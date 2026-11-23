// Growth economics section of a business report: the same shared summary as the Growth economics page, the
// Growth Officer and Home, for the report period. Figures that need missing inputs say so instead of showing 0.
import { useQuery } from "@tanstack/react-query";
import { econOptions } from "@/components/econ/econ-data";
import { econNotInstalled } from "@/lib/econ/read";
import { economicsSummary } from "@/lib/econ/summary";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { cn } from "@/lib/utils";
import { FigureLabel } from "@/components/ai/evidence";
import type { FigureId } from "@/lib/report-claims";

export function ReportEconomics({ orgId, wsId, from, to, today }: { orgId: string | undefined; wsId: string | undefined; from: string; to: string; today: string }) {
  const { t, tag } = useI18n();
  const q = useQuery(econOptions(orgId, wsId));
  if (q.error && econNotInstalled(q.error)) return null;
  if (q.error) return <p role="alert" className="text-xs text-destructive">{t("rep.econ.failed")}</p>;
  if (!q.data) return <p className="text-xs text-muted-foreground">{t("rep.loading")}</p>;
  const s = economicsSummary(q.data, from, to, "last_touch", today);
  const money = (n: number, c: string) => new Intl.NumberFormat(tag, { style: "currency", currency: c }).format(n);
  // Gross profit from a margin-estimate cost model is an estimate, not a calculation from recorded costs.
  const gpEstimated = s.currencies.some((c) => c.gp?.status === "estimated");
  const na = (k: string) => t(`rep.econ.na.${k}` as MessageKey);
  return (
    <section aria-label={t("rep.econ.title")} className="space-y-2 text-xs">
      <h3 className="text-sm font-semibold">{t("rep.econ.title")}</h3>
      {s.incomplete.length > 0 && <p role="alert" className="text-warning">{t("rep.econ.incomplete")}</p>}
      {s.currencies.length > 0 && <div className="overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead className="text-left text-muted-foreground"><tr>{([["rep.currency"], ["rep.econ.costs", "econ.costs"], ["rep.econ.gp", gpEstimated ? "econ.gpEstimated" : "econ.gp"], ["rep.econ.margin", gpEstimated ? "econ.marginEstimated" : "econ.margin"], ["rep.econ.cac", "econ.cac"], ["rep.econ.rpc", "econ.rpc"]] as [string, FigureId?][]).map(([h, id]) => <th key={h} className={cn("py-1 pr-3 align-top font-normal", !id && "whitespace-nowrap")}>{t(h as MessageKey)}{id && <FigureLabel stack id={id} period={{ from, to }} />}</th>)}</tr></thead>
          <tbody>
            {s.currencies.map((c) => (
              <tr key={c.currency} className="border-t border-border tabular-nums">
                <td className="whitespace-nowrap py-1 pr-3">{c.currency}</td>
                <td className="py-1 pr-3">{money(c.costs, c.currency)}{c.estCosts > 0 ? ` (+${money(c.estCosts, c.currency)} ${t("rep.econ.est")})` : ""}</td>
                <td className="py-1 pr-3">{c.gp?.grossProfit != null ? money(c.gp.grossProfit, c.currency) : na(c.gp?.missing.includes("cost_model") ? "model" : "cost")}</td>
                <td className="py-1 pr-3">{c.gp?.grossMargin != null ? `${c.gp.grossMargin.toLocaleString(tag)}%${c.gpPrev?.grossMargin != null ? ` (${t("rep.prev")} ${c.gpPrev.grossMargin.toLocaleString(tag)}%)` : ""}` : "—"}</td>
                <td className="py-1 pr-3">{c.cac?.value != null ? money(c.cac.value, c.currency) : na(c.cac?.salesWithoutCustomer ? "customer" : "spend")}</td>
                <td className="py-1 pr-3">{c.clv?.avgRevenue != null ? money(c.clv.avgRevenue, c.currency) : na("customer")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
      {s.currencies.length === 0 && <p className="text-muted-foreground">{t("rep.econ.none")}</p>}
      {s.budget.map((b) => <p key={b.currency}><FigureLabel id="econ.budget" />{" "}{t("rep.econ.budget", { p: money(b.total, b.currency), a: money(b.allocated, b.currency), u: money(b.unallocated, b.currency), s: money(b.spent, b.currency) })}</p>)}
      <p><FigureLabel id="econ.ai" period={{ from, to }} />{" "}{t("rep.econ.ai", { n: s.ai.total, c: s.ai.onCampaigns, o: s.ai.otherWork })} {s.ai.cost.priced > 0 ? <>{t("rep.econ.aiCost", { a: money(s.ai.cost.amount, s.ai.cost.currency) })}<FigureLabel id="econ.aiCost" period={{ from, to }} /></> : t("rep.econ.aiNoPrice")}</p>
      {s.campaigns.some((c) => c.t.credits > 0) && <p>{t("rep.econ.aiCampaigns", { list: s.campaigns.filter((c) => c.t.credits > 0).sort((a, b) => b.t.credits - a.t.credits).slice(0, 5)
        .map((c) => `${c.title}: ${c.t.credits}${c.aiCost.priced > 0 ? ` (${money(c.aiCost.amount, c.aiCost.currency)})` : ""}`).join(" · ") })}</p>}
      <p>{t("rep.econ.outcomes", { i: s.outcomes.improved, w: s.outcomes.worse, n: s.outcomes.noChange, x: s.outcomes.inconclusive, d: s.measurementDue.length })}</p>
      <p className="text-muted-foreground">{t("rep.econ.note")}</p>
    </section>
  );
}
