// Business reports screen: choose a report type and period; every figure comes from recorded rows read under the
// caller's RLS (revenue ledger, campaign spending, tasks, AI runs, experiments) and is labelled with its source.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "@/lib/org-context";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { biOptions } from "@/components/bi/bi-data";
import { executionOptions, localDay } from "@/lib/execution";
import { campaignSpendOptions, replanOptions } from "@/components/execution/replan-data";
import { replanStatus } from "@/lib/task-replan";
import { growthDb, isNotInstalled } from "@/lib/pending-schema";
import { collectPages } from "@/lib/pagination";
import { buildReport, DEFAULT_PERIOD, PERIOD_KEYS, REPORT_TYPES, periods, type Delta, type PeriodKey, type Quality, type ReportType } from "@/lib/reports";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ReportEconomics } from "@/components/reports/report-economics";
import { GrowthReportSection } from "@/components/reports/growth-report-sections";
import { FigureLabel } from "@/components/ai/evidence";
import type { FigureId } from "@/lib/report-claims";

const tk = (k: string) => k as MessageKey;
type QReview = Quality["reviews"][number] & { id: string };
type QDecision = Quality["decisions"][number] & { id: string };

/** Every second review and decision of the business (ID keyset pages under a creation watermark, so nothing is
 * silently cut off); "not installed" means unavailable, any other error fails closed. */
function useQuality(org?: string, ws?: string) {
  return useQuery({
    queryKey: ["report-quality", org ?? "", ws ?? ""],
    enabled: !!org && !!ws,
    queryFn: async (): Promise<Quality | null> => {
      const watermark = new Date().toISOString();
      try {
        const [reviews, decisions] = await Promise.all([
          collectPages<QReview>(async (cursor, size) => {
            let q = growthDb.from("specialist_reviews").select("id,task_run_id,original_specialist,score,verdict,independence_warning,created_at,credits").eq("org_id", org!).eq("workspace_id", ws!).lte("created_at", watermark).order("id").limit(size);
            if (cursor) q = q.gt("id", cursor);
            return q;
          }),
          collectPages<QDecision>(async (cursor, size) => {
            let q = growthDb.from("specialist_result_decisions").select("id,task_run_id,decision,created_at").eq("org_id", org!).eq("workspace_id", ws!).lte("created_at", watermark).order("id").limit(size);
            if (cursor) q = q.gt("id", cursor);
            return q;
          }),
        ]);
        return { reviews, decisions };
      } catch (e) {
        if (isNotInstalled(e)) return null;
        throw e;
      }
    },
  });
}

const sel = "min-w-0 rounded-md border border-border bg-background px-2 py-2 text-sm";

export function BusinessReports() {
  const o = useOrg();
  const { t, tag } = useI18n();
  const [type, setType] = useState<ReportType>("weekly");
  const [key, setKey] = useState<PeriodKey>(DEFAULT_PERIOD.weekly);
  const bi = useQuery(biOptions(o.org?.id, o.workspace?.id));
  const work = useQuery(executionOptions(o.org?.id, o.workspace?.id, o.userId));
  const spend = useQuery(campaignSpendOptions(o.org?.id, o.workspace?.id));
  const rp = useQuery(replanOptions(o.org?.id, o.workspace?.id));
  const quality = useQuality(o.org?.id, o.workspace?.id);
  const today = localDay();
  const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(tag);
  const money = (n: number, c: string) => new Intl.NumberFormat(tag, { style: "currency", currency: c }).format(n);
  const pct = (d: Delta) => (d.pct === null ? t("rep.none") : `${d.pct > 0 ? "+" : ""}${d.pct}%`);

  // Spending and re-planning are optional (not installed means "not available"); any other failure fails closed.
  const optionalFailed = (e: unknown) => !!e && !isNotInstalled(e);
  if (bi.error || work.error || quality.error || optionalFailed(spend.error) || optionalFailed(rp.error)) return <p className="text-sm text-destructive">{t("rep.failed")}</p>;
  if (!bi.data || !work.data || quality.isLoading || (spend.isLoading && !spend.error)) return <p className="text-sm text-muted-foreground">{t("rep.loading")}</p>;

  const decisions = rp.data?.decisions ?? [];
  const cur = periods(key, today).current;
  const approvedInPeriod = decisions.filter((d) => d.decision === "approved" && d.created_at.slice(0, 10) >= cur.from && d.created_at.slice(0, 10) <= cur.to).length;
  const r = buildReport(type, key, {
    revenue: bi.data.revenue, spend: spend.data ?? null,
    tasks: work.data.tasks.map((x) => ({ id: x.id, status: x.status, due_date: x.due_date, created_at: x.created_at, updated_at: x.updated_at, campaign_id: x.campaign_id })),
    runs: bi.data.runs, experiments: bi.data.experiments,
    campaigns: work.data.campaigns.map((c) => ({ id: c.id, title: c.title, status: c.status, budget_eur: "budget_eur" in c ? c.budget_eur : 0, start_date: "start_date" in c ? c.start_date : null, end_date: "end_date" in c ? c.end_date : null, goal_id: "goal_id" in c ? c.goal_id : null, results: "results" in c ? c.results : "" })),
    replans: rp.data ? { pending: rp.data.proposals.filter((p) => ["pending", "postponed"].includes(replanStatus(p, decisions))).length, approvedInPeriod } : undefined,
    quality: quality.data ?? null,
  }, today);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <label className="flex flex-col gap-1 text-xs">{t("rep.type")}
          <select className={sel} value={type} onChange={(e) => { const v = e.target.value as ReportType; setType(v); setKey(DEFAULT_PERIOD[v]); }}>
            {REPORT_TYPES.map((x) => <option key={x} value={x}>{t(`rep.t.${x}` as MessageKey)}</option>)}
          </select></label>
        <label className="flex flex-col gap-1 text-xs">{t("rep.period")}
          <select className={sel} value={key} onChange={(e) => setKey(e.target.value as PeriodKey)}>
            {PERIOD_KEYS.map((x) => <option key={x} value={x}>{t(`rep.p.${x}` as MessageKey)}</option>)}
          </select></label>
        <Button variant="outline" onClick={() => window.print()}>{t("rep.print")}</Button>
      </div>

      <article aria-label={t(`rep.t.${type}` as MessageKey)} className="space-y-5 rounded-lg border border-border bg-card p-4">
        <header>
          <h2 className="text-lg font-semibold">{t(`rep.t.${type}` as MessageKey)} · {o.workspace?.name}</h2>
          <p className="text-xs text-muted-foreground">{t("rep.range", { a: fmtDay(r.current.from), b: fmtDay(r.current.to), c: fmtDay(r.previous.from), d: fmtDay(r.previous.to) })}</p>
        </header>

        {r.missing.length > 0 && (
          <div className="rounded-md border border-warning/50 p-3 text-xs">
            <p className="font-medium">{t("rep.missingTitle")}<FigureLabel id="missing" period={r.current} /></p>
            <ul className="mt-1 list-disc pl-5">{r.missing.map((m) => <li key={m}>{t(`rep.m.${m}` as MessageKey)}</li>)}</ul>
          </div>
        )}

        {r.show.finance && r.finance.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">{t("rep.finance")}</h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-xs">
                <thead className="text-left text-muted-foreground"><tr>{([["rep.currency"], ["rep.sales", "fin.sales"], ["rep.refunds", "fin.refunds"], ["rep.net", "fin.net"], ["rep.prev", "fin.prev", true], ["rep.change", "fin.change"], ["rep.spent", "fin.spent"], ["rep.perSpend", "fin.perSpend"]] as [string, FigureId?, boolean?][]).map(([h, id, prev]) => <th key={h} className={cn("py-1 pr-3 align-top font-normal", !id && "whitespace-nowrap")}>{t(h as MessageKey)}{id && <FigureLabel stack id={id} period={prev ? r.previous : r.current} />}</th>)}</tr></thead>
                <tbody>
                  {r.finance.map((f) => (
                    <tr key={f.currency} className="border-t border-border tabular-nums">
                      <td className="whitespace-nowrap py-1 pr-3">{f.currency}</td>
                      <td className="py-1 pr-3">{f.now ? money(f.now.sales, f.currency) : t("rep.none")}</td>
                      <td className="py-1 pr-3">{money(f.refunds, f.currency)}</td>
                      <td className="py-1 pr-3 font-semibold">{money(f.net.now, f.currency)}</td>
                      <td className="py-1 pr-3">{money(f.net.before, f.currency)}</td>
                      <td className={cn("py-1 pr-3", f.net.change < 0 && "text-destructive")}>{pct(f.net)}</td>
                      <td className="py-1 pr-3">{f.spent === null ? t("rep.none") : money(f.spent, f.currency)}</td>
                      <td className="py-1 pr-3">{f.perSpend === null ? t("rep.none") : f.perSpend.toLocaleString(tag)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {r.finance.some((f) => f.estimated) && <p className="text-xs text-muted-foreground">{t("rep.estimated")}<FigureLabel id="fin.estimated" period={r.current} />: {r.finance.filter((f) => f.estimated).map((f) => money(f.estimated!, f.currency)).join(", ")}</p>}
            <p className="text-xs text-muted-foreground">{t("rep.src.revenue", { n: r.finance.reduce((n, f) => n + (f.now?.entries ?? 0), 0) })}</p>
            {r.finance.some((f) => f.perSpend !== null) && <p className="text-xs text-muted-foreground">{t("rep.perSpendNote")}</p>}
          </section>
        )}

        {(type === "initiative" || type === "strategy" || type === "learning") && o.org && o.workspace && (
          <GrowthReportSection type={type} orgId={o.org.id} wsId={o.workspace.id} period={r.current} today={today}
            tasks={work.data.tasks.map((x) => ({ id: x.id, status: x.status, project_id: x.project_id, campaign_id: x.campaign_id, due_date: x.due_date }))}
            campaigns={work.data.campaigns.map((c) => ({ id: c.id, title: c.title, status: c.status, goal_id: "goal_id" in c ? c.goal_id : null, initiative_id: "initiative_id" in c ? (c.initiative_id as string | null) : null, strategy_id: "strategy_id" in c ? (c.strategy_id as string | null) : null, budget_eur: "budget_eur" in c ? c.budget_eur : 0 }))}
            goals={bi.data.goals.map((g) => ({ id: g.id, title: g.title, status: g.status, metric: g.metric ?? "", baseline: g.baseline === null ? null : Number(g.baseline), target: g.target === null ? null : Number(g.target), current_value: g.current_value === null ? null : Number(g.current_value), due_date: g.due_date, created_at: g.created_at }))}
            operations={bi.data.operations.map((x) => ({ initiative_id: x.initiative_id, success_metric: x.success_metric ?? "", baseline_value: x.baseline_value === null ? null : Number(x.baseline_value), target_value: x.target_value === null ? null : Number(x.target_value), current_value: x.current_value === null ? null : Number(x.current_value), due_date: x.due_date ?? null }))} />
        )}

        {r.show.finance && <ReportEconomics orgId={o.org?.id} wsId={o.workspace?.id} from={r.current.from} to={r.current.to} today={today} />}

        {r.show.spend && r.spend && (r.spend.entries > 0 || r.spend.simulated > 0) && (
          <section className="space-y-1 text-xs">
            <h3 className="text-sm font-semibold">{t("rep.spent")}<FigureLabel id="spend.total" period={r.current} /></h3>
            <p className="tabular-nums">{Object.entries(r.spend.spent).map(([c, n]) => t("rep.spendPrev", { a: money(n, c), b: money(r.spend!.before[c] ?? 0, c) })).join(" · ")}</p>
            {r.spend.simulated > 0 && <p className="text-warning">{t("rep.simSpent", { list: Object.entries(r.spend.simulatedSpent).map(([c, n]) => money(n, c)).join(" · ") })}</p>}
            <p className="text-muted-foreground">{t("rep.src.spend", { n: r.spend.entries + r.spend.simulated, s: r.spend.simulated })}</p>
          </section>
        )}

        {r.show.campaigns && r.campaigns.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">{t("rep.campaigns")}</h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-xs">
                <thead className="text-left text-muted-foreground"><tr>{([["rep.campaign"], ["rep.state", "camp.state"], ["rep.budget", "camp.budget"], ["rep.spentEur", "camp.spent"], ["rep.remaining", "camp.remaining"], ["rep.tasks", "camp.tasks"]] as [string, FigureId?][]).map(([h, id]) => <th key={h} className={cn("py-1 pr-3 align-top font-normal", !id && "whitespace-nowrap")}>{t(h as MessageKey)}{id && <FigureLabel stack id={id} />}</th>)}</tr></thead>
                <tbody>
                  {r.campaigns.map((c) => (
                    <tr key={c.id} className="border-t border-border tabular-nums">
                      <td className="py-1 pr-3">{c.title}</td>
                      <td className="py-1 pr-3">{t(`work.health.${c.state}` as MessageKey)}</td>
                      <td className="py-1 pr-3">{c.budget > 0 ? money(c.budget, "EUR") : t("rep.none")}</td>
                      <td className="py-1 pr-3">{c.spentEur === null ? t("rep.none") : money(c.spentEur, "EUR")}{c.simulatedEur ? ` (+${money(c.simulatedEur, "EUR")} ${t("rep.simShort")})` : ""}</td>
                      <td className={cn("py-1 pr-3", c.over && "text-destructive")}>{c.remaining === null ? t("rep.none") : `${money(c.remaining, "EUR")}${c.over ? ` · ${t("rep.overBudget")}` : ""}`}</td>
                      <td className="py-1 pr-3">{c.done}/{c.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {r.show.tasks && (
          <section className="space-y-1 text-xs">
            <h3 className="text-sm font-semibold">{t("rep.work")}</h3>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([["rep.done", `${r.tasks.done.now} (${pct(r.tasks.done)})`, "task.done"], ["rep.created", `${r.tasks.created.now} (${pct(r.tasks.created)})`, "task.created"], ["rep.open", String(r.tasks.open), "task.open"], ["rep.overdue", String(r.tasks.overdue), "task.overdue"]] as [string, string, FigureId][]).map(([k, v, id]) => (
                <div key={k} className="rounded border border-border p-2"><dt className="text-muted-foreground">{t(k as MessageKey)}<FigureLabel id={id} period={r.current} /></dt><dd className="font-semibold tabular-nums">{v}</dd></div>
              ))}
            </dl>
            <p className="text-muted-foreground">{t("rep.changeNote")}<FigureLabel id="task.change" period={r.current} /></p>
            {r.replans && r.replans.pending > 0 && <p>{t("rep.replans", { n: r.replans.pending })}</p>}
            {r.replans && r.replans.approvedInPeriod > 0 && <p>{t("rep.replansApproved", { n: r.replans.approvedInPeriod })}</p>}
          </section>
        )}

        {r.show.runs && r.runs.total > 0 && (
          <section className="space-y-2 text-xs">
            <h3 className="text-sm font-semibold">{t("rep.ai")}</h3>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {([["rep.runs", `${r.runs.total} (${pct(r.runs.totalDelta)})`, "run.count"], ["rep.succeeded", String(r.runs.succeeded), "run.count"], ["rep.failedRuns", String(r.runs.failed + r.runs.uncertain), "run.count"], ["rep.waiting", String(r.runs.waiting), "run.count"], ["rep.credits", String(r.runs.credits), "run.credits"]] as [string, string, FigureId][]).map(([k, v, id]) => (
                <div key={k} className="rounded border border-border p-2"><dt className="text-muted-foreground">{t(k as MessageKey)}<FigureLabel id={id} period={r.current} /></dt><dd className="font-semibold tabular-nums">{v}</dd></div>
              ))}
            </dl>
            {r.show.specialists && (
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground"><tr>{([["rep.specialist"], ["rep.runs", "sp.counts"], ["rep.succeeded", "sp.counts"], ["rep.failedRuns", "sp.counts"], ["rep.credits", "run.credits"]] as [string, FigureId?][]).map(([h, id]) => <th key={h} className={cn("py-1 pr-3 align-top font-normal", !id && "whitespace-nowrap")}>{t(h as MessageKey)}{id && <FigureLabel stack id={id} period={r.current} />}</th>)}</tr></thead>
                <tbody>{Object.entries(r.runs.perSpecialist).map(([k, v]) => (
                  <tr key={k} className="border-t border-border tabular-nums"><td className="py-1 pr-3">{k.replace(/_/g, " ")}</td><td className="py-1 pr-3">{v.runs}</td><td className="py-1 pr-3">{v.succeeded}</td><td className="py-1 pr-3">{v.failed}</td><td className="py-1 pr-3">{v.credits}</td></tr>
                ))}</tbody>
              </table>
            )}
          </section>
        )}

        {r.show.performance && r.specialists.length > 0 && (
          <section className="space-y-2 text-xs">
            <h3 className="text-sm font-semibold">{t("rep.performance")}</h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-xs">
                <thead className="text-left text-muted-foreground"><tr>{([["rep.specialist"], ["rep.runs", "sp.counts"], ["rep.succeeded", "sp.counts"], ["rep.failedRuns", "sp.counts"], ["rep.credits", "run.credits"], ["rep.perSuccess", "sp.perSuccess"], ["rep.reviews", "sp.reviews"], ["rep.reviewCredits", "sp.reviews"], ["rep.avgScore", "sp.avgScore"], ["rep.unreliable", "sp.reviews"], ["rep.accepted", "sp.decisions"], ["rep.corrected", "sp.decisions"], ["rep.rework", "sp.decisions"], ["rep.rejected", "sp.decisions"]] as [string, FigureId?][]).map(([h, id]) => <th key={h} className={cn("py-1 pr-3 align-top font-normal", !id && "whitespace-nowrap")}>{t(tk(h))}{id && <FigureLabel stack id={id} period={r.current} />}</th>)}</tr></thead>
                <tbody>{r.specialists.map((l) => (
                  <tr key={l.specialist} className="border-t border-border tabular-nums">
                    <td className="py-1 pr-3">{l.specialist === "growth_officer" ? "Growth Officer" : t(tk(`run.sp.${l.specialist}`))}</td>
                    <td className="py-1 pr-3">{l.runs}</td><td className="py-1 pr-3">{l.succeeded}</td><td className="py-1 pr-3">{l.failed}</td><td className="py-1 pr-3">{l.credits}</td>
                    <td className="py-1 pr-3">{l.creditsPerSuccess === null ? t("rep.none") : l.creditsPerSuccess.toLocaleString(tag)}</td>
                    <td className="py-1 pr-3">{l.reviews}</td><td className="py-1 pr-3">{l.reviews === 0 ? t("rep.none") : `${l.reviewCredits}${l.reviewCreditsUnknown ? ` · ${t("rep.unknownCost", { n: l.reviewCreditsUnknown })}` : ""}`}</td><td className="py-1 pr-3">{l.avgScore === null ? t("rep.none") : `${l.avgScore}/100`}</td>
                    <td className={cn("py-1 pr-3", l.unreliable > 0 && "text-destructive")}>{l.unreliable}</td>
                    <td className="py-1 pr-3">{l.accepted}</td><td className="py-1 pr-3">{l.corrected}</td><td className="py-1 pr-3">{l.rework}</td><td className="py-1 pr-3">{l.rejected}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <p className="text-muted-foreground">{t("rep.qualityNote")}</p>
            <p className="text-muted-foreground">{t("rep.qualityAll", { r: quality.data?.reviews.length ?? 0, d: quality.data?.decisions.length ?? 0 })}</p>
          </section>
        )}

        {r.show.experiments && (type === "experiments" || r.experiments.running + r.experiments.concluded > 0) && (
          <section className="space-y-1 text-xs">
            <h3 className="text-sm font-semibold">{t("rep.experiments")}<FigureLabel id="exp.counts" period={r.current} /></h3>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-6">
              {[["rep.running", r.experiments.running], ["rep.proposed", r.experiments.proposed], ["rep.concluded", r.experiments.concluded], ["rep.controlled", r.experiments.controlled], ["rep.correlational", r.experiments.correlational], ["rep.inconclusive", r.experiments.inconclusive]].map(([k, v]) => (
                <div key={k as string} className="rounded border border-border p-2"><dt className="text-muted-foreground">{t(k as MessageKey)}</dt><dd className="font-semibold tabular-nums">{v}</dd></div>
              ))}
            </dl>
            <p className="text-muted-foreground">{t("rep.expNote")}</p>
          </section>
        )}
      </article>
    </div>
  );
}
