// Campaign specialists and AI costs: the team working on this campaign (from task specialist assignments and runs)
// and the credits recorded for their runs and second reviews. Read-only; credits become money only through the credit
// price that was in effect when each one was used (src/lib/econ/ai-cost.ts); otherwise they stay credits.
import { useQuery } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import { useOrg } from "@/lib/org-context";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { growthDb, isNotInstalled, retryUnlessNotInstalled } from "@/lib/pending-schema";
import { campaignAiEconomics } from "@/lib/campaign-ai-cost";
import { taskExecutionOptions } from "@/components/execution/task-runs-data";
import { creditPriceOptions } from "@/components/econ/econ-data";
import { aiCostBreakdown, taskAiAtoms } from "@/lib/econ/ai-cost";
import { PRICE_CURRENCY } from "@/lib/econ/summary";

type TaskLite = {
  id: string;
  campaign_id: string | null;
  agent_key: string | null;
  status: string;
  title?: string | null;
};
const RUN_LIMIT = 1000,
  PROFILE_LIMIT = 2000;

export function CampaignAiTeam({
  campaignId,
  tasks,
}: {
  campaignId: string;
  tasks: readonly TaskLite[];
}) {
  const o = useOrg();
  const { t, tag } = useI18n();
  const ex = useQuery(taskExecutionOptions(o.org?.id, o.workspace?.id, false));
  const prices = useQuery(creditPriceOptions(o.org?.id));
  const mine = tasks.filter((x) => x.campaign_id === campaignId);
  const runIds = (ex.data?.runs ?? [])
    .filter((r) => mine.some((x) => x.id === r.task_id))
    .map((r) => r.id);
  const reviews = useQuery({
    queryKey: ["campaign-reviews", o.workspace?.id, runIds.join()],
    enabled: runIds.length > 0,
    retry: retryUnlessNotInstalled,
    queryFn: async () => {
      const r = await growthDb
        .from("specialist_reviews")
        .select("task_run_id,reviewer_specialist,credits,score,created_at")
        .eq("workspace_id", o.workspace!.id)
        .in("task_run_id", runIds)
        .limit(500);
      if (r.error) {
        if (isNotInstalled(r.error)) return [];
        throw r.error;
      }
      return r.data ?? [];
    },
  });
  if (ex.error)
    return (
      <p className="text-xs text-muted-foreground">
        {t(isNotInstalled(ex.error) ? "ae.notInstalled" : "ae.loadFailed")}
      </p>
    );
  if (!ex.data) return null;
  const spec = new Map((ex.data.profiles ?? []).map((p) => [p.task_id, p.specialist_key]));
  const assigned = mine.map((x) => ({ ...x, agent_key: spec.get(x.id) ?? x.agent_key }));
  const complete =
    ex.data.runs.length < RUN_LIMIT && ex.data.profiles.length < PROFILE_LIMIT && !reviews.error;
  const e = campaignAiEconomics(campaignId, assigned, ex.data.runs, reviews.data ?? [], complete);
  const cost = prices.data
    ? aiCostBreakdown(
        taskAiAtoms(new Set(mine.map((x) => x.id)), ex.data.runs, reviews.data ?? []),
        prices.data.prices,
        prices.data.planKey,
        PRICE_CURRENCY,
      )
    : null;
  const money = (n: number) =>
    new Intl.NumberFormat(tag, { style: "currency", currency: PRICE_CURRENCY }).format(n);
  const amt = (l: { amount: number; credits: number; unpriced: number }) =>
    cost && l.credits > l.unpriced ? ` (${money(l.amount)})` : "";
  const specCost = new Map((cost?.bySpecialist ?? []).map((l) => [l.key, l]));
  const title = new Map(mine.map((x) => [x.id, x.title || t("ae.unnamedTask")]));
  const name = (k: string) => {
    const v = t(`run.sp.${k}` as MessageKey);
    return v === `run.sp.${k}` ? k : v;
  };
  return (
    <section
      aria-label={t("ae.title")}
      className="space-y-2 rounded-md border border-border bg-card p-3 text-xs"
    >
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Bot className="h-4 w-4" />
        {t("ae.title")}
      </h3>
      <p className="text-muted-foreground">{t("ae.intro")}</p>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(
          [
            ["ae.tasks", e.tasks],
            ["ae.runs", e.runs],
            ["ae.charged", e.chargedCredits],
            ["ae.reviews", e.reviewCredits],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="rounded border border-border p-2">
            <dt className="text-muted-foreground">{t(k)}</dt>
            <dd className="font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <p>{t("ae.total", { n: e.totalCredits })}</p>
      {e.pendingRuns > 0 && (
        <p className="text-muted-foreground">
          {t("ae.pending", { n: e.pendingRuns, c: e.pendingEstimate })}
        </p>
      )}
      {e.uncertainRuns > 0 && (
        <p className="text-warning">{t("ae.uncertain", { n: e.uncertainRuns })}</p>
      )}
      {!e.complete && <p className="text-warning">{t("ae.incomplete")}</p>}
      {cost && cost.priced > 0 && (
        <p className="font-medium">{t("ae.money", { a: money(cost.amount), p: cost.priced })}</p>
      )}
      {cost && cost.priced > 0 && cost.unpriced > 0 && (
        <p className="text-muted-foreground">{t("ae.moneyPartial", { n: cost.unpriced })}</p>
      )}
      {(!cost || cost.priced === 0) && e.totalCredits > 0 && (
        <p className="text-muted-foreground">{t("ae.noMoney")}</p>
      )}
      {cost && (cost.retries.credits > 0 || cost.reviews.credits > 0) && (
        <p className="text-muted-foreground">
          {t("ae.split", {
            r: cost.retries.credits,
            ra: amt(cost.retries),
            v: cost.reviews.credits,
            va: amt(cost.reviews),
          })}
        </p>
      )}
      {cost && cost.byTask.length > 0 && (
        <div>
          <p className="font-medium">{t("ae.byTask")}</p>
          <ul className="text-muted-foreground">
            {cost.byTask.slice(0, 5).map((l) => (
              <li key={l.key} className="flex justify-between gap-2">
                <span className="truncate">{title.get(l.key) ?? l.key}</span>
                <span className="shrink-0 tabular-nums">
                  {l.credits}
                  {amt(l)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {cost && cost.priced > 0 && <p className="text-muted-foreground">{t("ae.priceNote")}</p>}
      {e.team.length === 0 ? (
        <p className="text-muted-foreground">{t("ae.noTeam")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {e.team.map((s) => (
            <li key={s.specialist} className="py-1.5">
              <span className="font-medium">{name(s.specialist)}</span>
              <span className="block text-muted-foreground">
                {t("ae.row", {
                  tasks: s.tasks,
                  open: s.openTasks,
                  runs: s.runs,
                  ok: s.succeeded,
                  c: s.credits + s.reviewCredits,
                })}
                {specCost.get(s.specialist) ? amt(specCost.get(s.specialist)!) : ""}
                {s.avgReviewScore !== null
                  ? ` · ${t("ae.score", { s: s.avgReviewScore, n: s.reviewsReceived })}`
                  : ""}
                {s.lastRunAt
                  ? ` · ${t("ae.last", { d: new Date(s.lastRunAt).toLocaleDateString(tag) })}`
                  : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      {e.unassignedOpenTasks > 0 && (
        <p className="text-muted-foreground">{t("ae.unassigned", { n: e.unassignedOpenTasks })}</p>
      )}
    </section>
  );
}
