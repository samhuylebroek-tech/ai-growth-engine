// Growth Situation Analysis on the Intelligence page: ten sections with status, reason, sourced findings,
// confidence, what is missing and a next step, plus up to three priorities. Pure rules over caller-RLS reads
// (src/lib/situation.ts); no credits. Fact conflicts come from the insert-only conflict history and are never decided here.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useOrg } from "@/lib/org-context";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { biOptions } from "@/components/bi/bi-data";
import { executionOptions, localDay } from "@/lib/execution";
import { campaignSpendOptions } from "@/components/execution/replan-data";
import { isRealOverrun, spendSummary } from "@/lib/campaign-spend";
import { campaignHealth } from "@/lib/campaign-health";
import { collectPages } from "@/lib/pagination";
import { growthDb, isNotInstalled } from "@/lib/pending-schema";
import { isActual } from "@/lib/performance";
import { conflictStatus, detectFactConflicts, type ConflictEvent } from "@/lib/fact-conflicts";
import { growthSituation, type Finding, type Situation, type Status } from "@/lib/situation";
import { SituationNarrative } from "@/components/app/situation-narrative";
import { cn } from "@/lib/utils";

const tk = (k: string) => k as MessageKey;
const tone: Record<Status, string> = {
  good: "border-success/40 text-success", attention: "border-warning/50 text-warning", problem: "border-destructive/40 text-destructive",
  conflicting: "border-destructive/40 text-destructive", outdated: "border-warning/50 text-warning", unknown: "text-muted-foreground",
};

function useSituationExtras(org?: string, ws?: string) {
  return useQuery({
    queryKey: ["situation-extras", org ?? "", ws ?? ""],
    enabled: !!org && !!ws,
    queryFn: async () => {
      const watermark = new Date().toISOString();
      let reviews: { verdict: string }[] | null = null;
      try {
        reviews = await collectPages<{ id: string; verdict: string }>(async (cursor, size) => {
          let q = growthDb.from("specialist_reviews").select("id,verdict").eq("org_id", org!).eq("workspace_id", ws!).lte("created_at", watermark).order("id").limit(size);
          if (cursor) q = q.gt("id", cursor);
          return q;
        });
      } catch (e) { if (!isNotInstalled(e)) throw e; }
      // Conflict history: a bounded read; when it is not installed or hits the bound, conflicts count as undetermined.
      const ev = await growthDb.from("fact_conflict_events").select("*").eq("org_id", org!).eq("workspace_id", ws!).order("created_at", { ascending: false }).limit(1000);
      if (ev.error && !isNotInstalled(ev.error)) throw ev.error;
      const events = ev.error || (ev.data ?? []).length >= 1000 ? null : ((ev.data ?? []) as ConflictEvent[]);
      return { reviews, events };
    },
  });
}

export function situationFrom(args: {
  bi: NonNullable<ReturnType<typeof useQuery<import("@/lib/bi/view").BiData>>["data"]>;
  work: { tasks: { status: string; due_date: string | null; updated_at: string; campaign_id: string | null }[]; campaigns: Record<string, unknown>[] };
  ledger: Parameters<typeof spendSummary>[1] extends readonly (infer R)[] ? (R & { campaign_id: string; occurred_on: string })[] | null : never;
  reviews: { verdict: string }[] | null; events: ConflictEvent[] | null; today: string;
}): Situation {
  const { bi, work, ledger, reviews, events, today } = args;
  const campaigns = work.campaigns.filter((c) => "budget_eur" in c).map((raw) => {
    const c = raw as { id: string; status: string; budget_eur: number | string; start_date: string | null; end_date: string | null; goal_id: string | null; results: string };
    const s = ledger ? spendSummary(Number(c.budget_eur), ledger.filter((r) => r.campaign_id === c.id)) : undefined;
    const h = campaignHealth({ status: c.status, start_date: c.start_date, end_date: c.end_date, goal_id: c.goal_id, results: c.results }, work.tasks.filter((x) => x.campaign_id === c.id), today, s);
    return { status: c.status, state: h.state, overBudget: isRealOverrun(s), simulatedOverBudget: !!s?.simulatedWarnings.some((w) => w === "budget_over" || w === "committed_over") };
  });
  // Conflicts need every fact and the full history; otherwise they stay undetermined rather than "none".
  let conflicts: Parameters<typeof growthSituation>[0]["conflicts"] = null;
  if (bi.factsComplete === true && events) {
    const rows = bi.facts.filter((f) => f.id).map((f) => ({ id: f.id!, key: f.key, value: f.value, verified: f.verified, source_type: f.source_type ?? "", source_ref: f.source_ref ?? null, created_at: f.created_at ?? null }));
    conflicts = { open: 0, inReview: 0, resolved: 0, redisputed: 0 };
    for (const c of detectFactConflicts(rows)) {
      const st = conflictStatus(c, events).status;
      if (st === "open") conflicts.open++; else if (st === "in_review") conflicts.inReview++; else if (st === "resolved") conflicts.resolved++; else conflicts.redisputed++;
    }
  }
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 60 * 86_400_000).toISOString().slice(0, 10);
  const actual = bi.measurements.filter((m) => isActual(String(m.kind)));
  return growthSituation({
    today, facts: bi.facts, factsComplete: bi.factsComplete === true, conflicts,
    opportunities: bi.opportunities, revenue: bi.revenue, spend: ledger, deals: bi.deals,
    tasks: work.tasks, runs: bi.runs, campaigns,
    experiments: bi.experiments as unknown as { status: string; outcome?: string | null; result_data_class?: string | null }[],
    reviews, budget: bi.budget, metrics: bi.metrics.filter((m) => !m.archived).length,
    measuredRecently: actual.filter((m) => m.period_end >= since).length, purchaseCostsRecorded: false,
    lastMeasurement: actual.reduce<string | null>((a, m) => (!a || m.period_end > a ? m.period_end : a), null),
    lastBudgetMonth: bi.budget.reduce<string | null>((a, b) => (!a || b.period_month > a ? b.period_month : a), null),
  });
}

export function GrowthSituation() {
  const o = useOrg();
  const { t, tag } = useI18n();
  const bi = useQuery(biOptions(o.org?.id, o.workspace?.id));
  const work = useQuery(executionOptions(o.org?.id, o.workspace?.id, o.userId));
  const spend = useQuery(campaignSpendOptions(o.org?.id, o.workspace?.id));
  const extras = useSituationExtras(o.org?.id, o.workspace?.id);
  if (bi.error || work.error || extras.error || (spend.error && !isNotInstalled(spend.error))) return <p role="alert" className="text-sm text-destructive">{t("sa.failed")}</p>;
  if (!bi.data || !work.data || !extras.data || (spend.isLoading && !spend.error)) return <p role="status" className="text-sm text-muted-foreground">{t("sa.loading")}</p>;
  const s = situationFrom({ bi: bi.data, work: work.data as never, ledger: spend.data ?? null, reviews: extras.data.reviews, events: extras.data.events, today: localDay() });
  const text = (f: Finding) => t(tk(`sa.i.${f.code}`), Object.fromEntries(Object.entries(f.params ?? {}).map(([k, v]) => [k, typeof v === "number" ? v.toLocaleString(tag) : v])));
  const line = (f: Finding) => (
    <li key={`${f.code}-${f.reliability}-${JSON.stringify(f.params ?? {})}`} className="break-words">
      {text(f)}
      <span className="block text-[11px] text-muted-foreground">{t("sa.src", { s: t(tk(`sa.s.${f.source}`)), r: t(tk(`sa.r.${f.reliability}`)) })}</span>
    </li>
  );
  return (
    <section aria-label={t("sa.title")} className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("sa.intro", { d: new Date(`${s.asOf}T12:00:00`).toLocaleDateString(tag) })}</p>
      {s.insufficient && <p role="note" className="rounded border border-warning/50 px-3 py-2 text-sm text-warning">{t("sa.insufficient")}</p>}
      <SituationNarrative situation={s} text={text} />
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold">{t("sa.priorities")}</h3>
        {s.priorities.length ? (
          <ol className="mt-2 list-decimal space-y-3 pl-5 text-sm">
            {s.priorities.map((p) => (
              <li key={`${p.code}-${p.section}`} className="break-words">
                <span className="font-medium">{text(p)}</span>
                <span className="block text-[11px] text-muted-foreground">{t("sa.src", { s: t(tk(`sa.s.${p.source}`)), r: t(tk(`sa.r.${p.reliability}`)) })}</span>
                <span className="block text-xs">{t("sa.p.meta", { i: t(tk(`sa.conf.${p.impact}`)), u: t(tk(`sa.conf.${p.urgency}`)), c: t(tk(`sa.conf.${p.confidence}`)), e: t(tk(`sa.conf.${p.effort}`)), t: t(tk(`sa.t.${p.time}`)) })}</span>
                <span className="block text-xs">{t("sa.p.owner", { o: t(tk(`sa.o.${p.owner}`)), m: t(tk(`sa.ms.${p.measure}`)) })}</span>
                {p.dependsOn && <span className="block text-xs">{t("sa.p.depends", { d: t(tk(`sa.dep.${p.dependsOn}`)) })}</span>}
                <span className="block text-[11px] text-muted-foreground">{t("sa.p.cost")}</span>
                <Link to={p.action.to} className="mt-1 inline-block text-xs font-medium text-primary underline-offset-2 hover:underline">{t(tk(`sa.n.${p.action.code}`))}</Link>
              </li>
            ))}
          </ol>
        ) : <p className="mt-2 text-sm text-muted-foreground">{t("sa.noPriorities")}</p>}
        {s.priorities.length > 0 && <p className="mt-2 text-[11px] text-muted-foreground">{t("sa.p.note")}</p>}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {s.sections.map((sec) => (
          <article key={sec.key} className="min-w-0 rounded-lg border border-border bg-card p-4 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{t(tk(`sa.k.${sec.key}`))}</h3>
              <span className={cn("rounded border px-1.5 py-0.5", tone[sec.status])}>{t(tk(`sa.st.${sec.status}`))}</span>
            </div>
            <p className="mt-1 text-muted-foreground">
              {sec.status === "unknown" ? t("sa.whyUnknown") : sec.reason ? t("sa.why", { r: text(sec.reason) }) : t("sa.whyGood")} · {t("sa.confidence", { c: t(tk(`sa.conf.${sec.confidence}`)) })}
            </p>
            {sec.findings.length > 0 && <ul className="mt-2 space-y-1.5">{sec.findings.map(line)}</ul>}
            {sec.missing.length > 0 && <p className="mt-2 text-muted-foreground">{t("sa.improve", { list: sec.missing.map((m) => t(tk(`sa.m.${m}`))).join("; ") })}</p>}
            {sec.next && <Link to={sec.next.to} className="mt-2 inline-block font-medium text-primary underline-offset-2 hover:underline">{t("sa.nextLabel")}: {t(tk(`sa.n.${sec.next.code}`))}</Link>}
          </article>
        ))}
      </div>
    </section>
  );
}
