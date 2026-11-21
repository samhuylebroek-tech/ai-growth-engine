// Growth Situation Analysis on the Intelligence page: ten sections with status, sourced findings and what is
// missing, plus up to three priorities. Pure rules over caller-RLS reads (src/lib/situation.ts); no credits.
import { useQuery } from "@tanstack/react-query";
import { useOrg } from "@/lib/org-context";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { biOptions } from "@/components/bi/bi-data";
import { executionOptions, localDay } from "@/lib/execution";
import { campaignSpendOptions } from "@/components/execution/replan-data";
import { spendSummary } from "@/lib/campaign-spend";
import { campaignHealth } from "@/lib/campaign-health";
import { collectPages } from "@/lib/pagination";
import { growthDb, isNotInstalled } from "@/lib/pending-schema";
import { isActual } from "@/lib/performance";
import { growthSituation, type Finding, type Status } from "@/lib/situation";
import { cn } from "@/lib/utils";

const tk = (k: string) => k as MessageKey;
const tone: Record<Status, string> = { good: "border-success/40 text-success", attention: "border-warning/50 text-warning", problem: "border-destructive/40 text-destructive", unknown: "text-muted-foreground" };

function useReviewVerdicts(org?: string, ws?: string) {
  return useQuery({
    queryKey: ["situation-reviews", org ?? "", ws ?? ""],
    enabled: !!org && !!ws,
    queryFn: async (): Promise<{ verdict: string }[] | null> => {
      const watermark = new Date().toISOString();
      try {
        return await collectPages<{ id: string; verdict: string }>(async (cursor, size) => {
          let q = growthDb.from("specialist_reviews").select("id,verdict").eq("org_id", org!).eq("workspace_id", ws!).lte("created_at", watermark).order("id").limit(size);
          if (cursor) q = q.gt("id", cursor);
          return q;
        });
      } catch (e) {
        if (isNotInstalled(e)) return null;
        throw e;
      }
    },
  });
}

export function GrowthSituation() {
  const o = useOrg();
  const { t, tag } = useI18n();
  const bi = useQuery(biOptions(o.org?.id, o.workspace?.id));
  const work = useQuery(executionOptions(o.org?.id, o.workspace?.id, o.userId));
  const spend = useQuery(campaignSpendOptions(o.org?.id, o.workspace?.id));
  const reviews = useReviewVerdicts(o.org?.id, o.workspace?.id);
  if (bi.error || work.error || reviews.error || (spend.error && !isNotInstalled(spend.error))) return <p role="alert" className="text-sm text-destructive">{t("sa.failed")}</p>;
  if (!bi.data || !work.data || reviews.isLoading || (spend.isLoading && !spend.error)) return <p role="status" className="text-sm text-muted-foreground">{t("sa.loading")}</p>;
  const today = localDay();
  const ledger = spend.data ?? null;
  // A campaign whose spending is only simulated is judged without that spending, so a test overrun never reads as real.
  const campaigns = work.data.campaigns.filter((c) => "budget_eur" in c).map((c) => {
    const own = ledger?.filter((r) => r.campaign_id === c.id) ?? [];
    const simulatedOnly = own.length > 0 && own.every((r) => r.data_class === "simulated");
    const s = ledger ? spendSummary(Number(c.budget_eur), own) : undefined;
    const h = campaignHealth({ status: c.status, start_date: c.start_date, end_date: c.end_date, goal_id: c.goal_id, results: c.results }, work.data.tasks.filter((x) => x.campaign_id === c.id), today, simulatedOnly ? undefined : s);
    return { status: c.status, state: h.state, overBudget: !!s?.warnings.includes("budget_over"), overBudgetSimulated: simulatedOnly };
  });
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 60 * 86_400_000).toISOString().slice(0, 10);
  const s = growthSituation({
    today, facts: bi.data.facts, factsComplete: bi.data.factsComplete === true, conflicts: null,
    opportunities: bi.data.opportunities, revenue: bi.data.revenue, spend: ledger, deals: bi.data.deals,
    tasks: work.data.tasks, runs: bi.data.runs, campaigns,
    experiments: bi.data.experiments as unknown as { status: string; outcome?: string | null; result_data_class?: string | null }[],
    reviews: reviews.data ?? null, budget: bi.data.budget, metrics: bi.data.metrics.filter((m) => !m.archived).length,
    measuredRecently: bi.data.measurements.filter((m) => isActual(String(m.kind)) && m.period_end >= since).length, purchaseCostsRecorded: false,
  });
  const line = (f: Finding) => (
    <li key={`${f.code}-${JSON.stringify(f.params ?? {})}`} className="break-words">
      {t(tk(`sa.i.${f.code}`), Object.fromEntries(Object.entries(f.params ?? {}).map(([k, v]) => [k, typeof v === "number" ? v.toLocaleString(tag) : v])))}
      <span className="block text-[11px] text-muted-foreground">{t("sa.src", { s: t(tk(`sa.s.${f.source}`)), r: t(tk(`sa.r.${f.reliability}`)) })}</span>
    </li>
  );
  return (
    <section aria-label={t("sa.title")} className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("sa.intro", { d: new Date(`${s.asOf}T12:00:00`).toLocaleDateString(tag) })}</p>
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold">{t("sa.priorities")}</h3>
        {s.priorities.length ? <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">{s.priorities.map(line)}</ol> : <p className="mt-2 text-sm text-muted-foreground">{t("sa.noPriorities")}</p>}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {s.sections.map((sec) => (
          <article key={sec.key} className="min-w-0 rounded-lg border border-border bg-card p-4 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{t(tk(`sa.k.${sec.key}`))}</h3>
              <span className={cn("rounded border px-1.5 py-0.5", tone[sec.status])}>{t(tk(`sa.st.${sec.status}`))}</span>
            </div>
            {sec.findings.length > 0 && <ul className="mt-2 space-y-1.5">{sec.findings.map(line)}</ul>}
            {sec.missing.length > 0 && <p className="mt-2 text-muted-foreground">{t("sa.missing", { list: sec.missing.map((m) => t(tk(`sa.m.${m}`))).join("; ") })}</p>}
          </article>
        ))}
      </div>
    </section>
  );
}
