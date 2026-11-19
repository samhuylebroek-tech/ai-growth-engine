import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, CircleAlert, LineChart, Plug, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { isNotInstalled } from "@/lib/pending-schema";
import { formatMetricValue, lastCompleteMonth, missingLastMonth, performanceOverview, STATUS_LABEL } from "@/lib/performance";
import { budgetByCurrency } from "@/lib/growth-plan";
import { SectionHeading } from "@/components/app/section-heading";
import { Button } from "@/components/ui/button";
import { metricsOptions, measurementsOptions } from "@/components/performance/data";
import { Reliability, statusClass } from "@/components/performance/parts";

function usePerformance() {
  const { workspace } = useOrg();
  const ws = workspace?.id ?? "none";
  const metrics = useQuery({ ...metricsOptions(ws), enabled: !!workspace });
  const values = useQuery({ ...measurementsOptions(ws), enabled: !!workspace && metrics.isSuccess });
  const overview = metrics.data && values.data ? performanceOverview(metrics.data, values.data) : null;
  const missing = metrics.data && values.data ? missingLastMonth(metrics.data, values.data) : [];
  return { metrics, values, overview, missing, notInstalled: metrics.isError && isNotInstalled(metrics.error) };
}

/** Command-center section: team-tracked metrics with status and reliability. Never shows invented figures. */
export function HomePerformance() {
  const { metrics, overview, missing, notInstalled, values } = usePerformance();
  return <>
    <SectionHeading eyebrow="Team-tracked results, not synced data" title="Performance overview" action={<Button variant="ghost" size="sm" asChild><Link to="/app/performance">Performance <ArrowUpRight /></Link></Button>} />
    {notInstalled ? <p className="py-3 text-xs text-muted-foreground">Performance tracking is not switched on for this workspace yet.</p>
      : metrics.isLoading || values.isLoading ? <p role="status" className="py-3 text-xs text-muted-foreground">Loading metrics…</p>
      : metrics.isError || values.isError ? <p className="py-3 text-xs text-destructive">Metrics could not be loaded.</p>
      : !overview || overview.items.length === 0 ? <div className="py-3 text-xs"><p className="font-medium">No metrics defined yet</p><p className="mt-1 text-muted-foreground">Add the numbers that show whether your goals are being reached.</p><Button variant="link" size="sm" className="px-0" asChild><Link to="/app/performance">Define a metric <ArrowUpRight /></Link></Button></div>
      : <>
        <dl className="mb-3 grid grid-cols-3 gap-2 text-xs"><div><dt className="text-muted-foreground">On track</dt><dd className="text-lg font-semibold text-success">{overview.onTrack}</dd></div><div><dt className="text-muted-foreground">Behind plan</dt><dd className="text-lg font-semibold text-destructive">{overview.behind.length}</dd></div><div><dt className="text-muted-foreground">Waiting for a result</dt><dd className="text-lg font-semibold">{overview.waiting}</dd></div></dl>
        <div className="divide-y divide-border">{overview.items.slice(0, 5).map(({ metric, summary, status }) => (
          <Link key={metric.id} to="/app/performance/$metricId" params={{ metricId: metric.id }} className="group flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-xs">
            <span className="min-w-0 flex-1 font-medium group-hover:text-primary">{metric.label}</span>
            <span>{summary.actual ? formatMetricValue(summary.actual.value, metric.unit, metric.currency) : "—"}{summary.planned != null && <span className="text-muted-foreground"> / plan {formatMetricValue(summary.planned, metric.unit, metric.currency)}</span>}</span>
            <span className={statusClass(status)}>{STATUS_LABEL[status]}</span>
            {summary.actual && <span className="basis-full"><Reliability kind={summary.actual.kind} /></span>}
          </Link>))}</div>
        {missing.length > 0 && <p className="mt-3 text-[11px] text-muted-foreground">Next step: record the {lastCompleteMonth()} result for {missing.slice(0, 3).map(m => m.label).join(", ")}{missing.length > 3 ? ` and ${missing.length - 3} more` : ""}.</p>}
      </>}
    <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground"><Plug className="h-3 w-3" />Analytics, ads and payments: Not configured</p>
  </>;
}

/** Attention items for metrics behind plan or missing last month's result; reports how many it shows. */
export function PerformanceAttention({ onCountChange }: { onCountChange: (n: number) => void }) {
  const { overview, missing } = usePerformance();
  const behind = overview?.behind ?? [];
  const count = (behind.length ? 1 : 0) + (missing.length ? 1 : 0);
  useEffect(() => { onCountChange(count); }, [count, onCountChange]);
  return <>
    {behind.length > 0 && <AttentionLink title={`${behind.length} ${behind.length === 1 ? "metric is" : "metrics are"} behind plan`} detail={`${behind.slice(0, 3).map(b => b.metric.label).join(", ")} · team-entered results, not verified`} />}
    {missing.length > 0 && <AttentionLink title={`${missing.length} ${missing.length === 1 ? "metric has" : "metrics have"} no ${lastCompleteMonth()} result`} detail="Record last month's results so plans and progress can be compared." />}
  </>;
}
function AttentionLink({ title, detail }: { title: string; detail: string }) {
  return <Link to="/app/performance" className="group flex items-start gap-3 border-b border-border py-3"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" /><div className="min-w-0 flex-1"><p className="break-words text-xs font-medium group-hover:text-primary">{title}</p><p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{detail}</p></div><ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /></Link>;
}

/** Command-center section: this month's marketing budget per currency (manual entries, not synced spend). */
export function HomeBudget() {
  const { org, workspace } = useOrg();
  const month = `${new Date().toISOString().slice(0, 7)}-01`;
  const q = useQuery({
    queryKey: ["home-budget", org?.id, workspace?.id, month], enabled: !!org && !!workspace,
    queryFn: async () => {
      const r = await supabase.from("budget_lines").select("planned,actual,hard_cap,currency").eq("org_id", org!.id).eq("workspace_id", workspace!.id).eq("period_month", month).limit(200);
      if (r.error) throw r.error;
      return budgetByCurrency((r.data ?? []).map(l => ({ planned: Number(l.planned), actual: Number(l.actual), hard_cap: l.hard_cap == null ? null : Number(l.hard_cap), currency: l.currency })));
    },
  });
  const money = (v: number, c: string) => formatMetricValue(v, "currency", c);
  return <>
    <SectionHeading eyebrow="Manual entries, not synced spend" title="Budget this month" action={<Button variant="ghost" size="sm" asChild><Link to="/app/goals">Goals & budget <ArrowUpRight /></Link></Button>} />
    {q.isLoading ? <p role="status" className="py-3 text-xs text-muted-foreground">Loading budget…</p>
      : q.isError ? <p className="py-3 text-xs text-destructive">Budget could not be loaded.</p>
      : !q.data?.length ? <div className="flex items-start gap-3 py-3 text-xs"><Wallet className="mt-0.5 h-4 w-4 text-muted-foreground" /><div><p className="font-medium">No budget planned for this month</p><p className="mt-1 text-muted-foreground">Plan spend per channel to see it here.</p></div></div>
      : <div className="divide-y divide-border">{q.data.map(b => (
        <div key={b.currency} className="py-3 text-xs">
          <div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{b.currency} · {b.lines} {b.lines === 1 ? "line" : "lines"}</span><span>{money(b.actual, b.currency)} <span className="text-muted-foreground">of {money(b.planned, b.currency)} planned</span></span></div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden><div className={b.actual > b.planned ? "h-full bg-destructive" : "h-full bg-primary"} style={{ width: `${b.planned > 0 ? Math.min(100, Math.round((b.actual / b.planned) * 100)) : 0}%` }} /></div>
          {(b.overCap > 0 || b.overPlan > 0) && <p className="mt-2 text-destructive">{b.overCap > 0 ? `${b.overCap} over hard cap` : ""}{b.overCap > 0 && b.overPlan > 0 ? " · " : ""}{b.overPlan > 0 ? `${b.overPlan} over plan` : ""}</p>}
        </div>))}</div>}
    <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground"><LineChart className="h-3 w-3" />Amounts in different currencies are shown separately.</p>
  </>;
}

/** Metrics the team linked to a goal, with their latest result and reliability. Renders nothing when none. */
export function GoalLinkedMetrics({ goalId }: { goalId: string }) {
  const { overview } = usePerformance();
  const linked = overview?.items.filter(i => i.metric.goal_id === goalId) ?? [];
  if (!linked.length) return null;
  return <div className="mt-3 space-y-1.5 border-t border-border pt-3">
    <p className="text-[11px] text-muted-foreground">Linked metrics</p>
    {linked.slice(0, 3).map(({ metric, summary, status }) => (
      <Link key={metric.id} to="/app/performance/$metricId" params={{ metricId: metric.id }} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs hover:text-primary">
        <span className="font-medium">{metric.label}</span>
        <span>{summary.actual ? formatMetricValue(summary.actual.value, metric.unit, metric.currency) : "no result yet"}{summary.planned != null && <span className="text-muted-foreground"> / plan {formatMetricValue(summary.planned, metric.unit, metric.currency)}</span>}</span>
        <span className={statusClass(status)}>{STATUS_LABEL[status]}</span>
        {summary.actual && <Reliability kind={summary.actual.kind} />}
      </Link>))}
  </div>;
}
