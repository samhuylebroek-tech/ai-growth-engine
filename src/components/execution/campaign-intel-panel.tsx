// Campaign diagnosis on the campaign overview (Campaign Intelligence 2.0): figures with their source, problems from
// fixed rules and suggested improvements a member can turn into an internal task. Costs no credits; nothing outside
// the platform changes.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useOrg } from "@/lib/org-context";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { can } from "@/lib/permissions";
import { localDay } from "@/lib/execution";
import { biOptions } from "@/components/bi/bi-data";
import { campaignSpendOptions } from "@/components/execution/replan-data";
import { spendSummary } from "@/lib/campaign-spend";
import { attribute } from "@/lib/bi/attribution";
import { isNotInstalled } from "@/lib/pending-schema";
import { campaignIntel, type Advice, type Figure, type FigureKey, type Intel } from "@/lib/campaign-intel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type CampaignRow = Database["public"]["Tables"]["campaigns"]["Row"];
type TaskRow = Database["public"]["Tables"]["tasks"]["Row"];
const tk = (k: string) => k as MessageKey;
const SHOWN: FigureKey[] = ["budget", "spent", "reserved", "remaining", "leads", "clicks", "conversions", "revenue", "cpl", "cpa", "conversion_rate", "roas", "roi", "duration", "progress"];

export function CampaignIntelPanel({ campaign, tasks, campaigns }: { campaign: CampaignRow; tasks: readonly TaskRow[]; campaigns: readonly CampaignRow[] }) {
  const o = useOrg();
  const { t, tag } = useI18n();
  const qc = useQueryClient();
  const bi = useQuery(biOptions(o.org?.id, o.workspace?.id));
  const spend = useQuery(campaignSpendOptions(o.org?.id, o.workspace?.id));
  const [busy, setBusy] = useState<string | null>(null);
  const member = can(o.workspaceRole, "profile.edit");
  if (bi.error || (spend.error && !isNotInstalled(spend.error))) return <p className="text-xs text-destructive">{t("ci.failed")}</p>;
  if (!bi.data || (spend.isLoading && !spend.error)) return <p className="text-xs text-muted-foreground">{t("ci.loading")}</p>;

  const mine = tasks.filter((x) => x.campaign_id === campaign.id);
  const ledger = spend.data ? spend.data.filter((r) => r.campaign_id === campaign.id) : null;
  const attribution = attribute(bi.data.revenue, bi.data.touches, "linear");
  const key = `campaign:${campaign.id}`;
  const attributed = attribution.flatMap((a) => a.credits.filter((c) => c.key === key).map((c) => ({ currency: a.currency, amount: c.amount, sales: c.sales })));
  const intel: Intel = campaignIntel({
    campaign: { id: campaign.id, title: campaign.title, status: campaign.status, objective: campaign.objective ?? "", audience: campaign.audience ?? "", channels: campaign.channels ?? [],
      budget_eur: Number(campaign.budget_eur), start_date: campaign.start_date, end_date: campaign.end_date, goal_id: campaign.goal_id, results: campaign.results ?? "" },
    tasks: mine, spend: ledger ? spendSummary(Number(campaign.budget_eur), ledger) : null,
    spendRows: (ledger ?? []).filter((r) => r.currency === "EUR" && (r.kind === "spend" || r.kind === "correction")).map((r) => ({ occurred_on: r.occurred_on, amount: Number(r.amount) })),
    metrics: bi.data.metrics.map((m) => ({ id: m.id, key: m.key, label: m.label, campaign_id: m.campaign_id ?? null, archived: m.archived })),
    measurements: bi.data.measurements, attributed, experiments: [],
    others: campaigns.map((c) => ({ id: c.id, title: c.title, status: c.status, channels: c.channels ?? [], start_date: c.start_date, end_date: c.end_date, audience: c.audience ?? "" })),
    today: localDay(),
  });

  const simShare = ledger && ledger.length ? ledger.filter((r) => r.data_class === "simulated").length / ledger.length : 0;
  const simNote = simShare === 1 ? t("ci.simAll") : simShare > 0 ? t("ci.simSome") : "";
  const money = (n: number) => new Intl.NumberFormat(tag, { style: "currency", currency: "EUR" }).format(n);
  const show = (f: Figure) => {
    if (f.value === null) return t("ci.missing", { r: t(tk(`ci.m.${f.missing ?? "no_actuals"}`)) });
    if (f.key === "conversion_rate") return `${(f.value * 100).toLocaleString(tag, { maximumFractionDigits: 2 })}%`;
    if (f.key === "roas" || f.key === "roi") return f.value.toLocaleString(tag, { maximumFractionDigits: 2 });
    if (f.key === "duration") return t("ci.days", { n: f.value });
    if (f.key === "progress") return `${f.value}%`;
    return f.currency ? money(f.value) : f.value.toLocaleString(tag);
  };
  const exists = (a: Advice) => mine.some((x) => x.status !== "done" && x.status !== "cancelled" && (x.labels ?? []).includes(`advice:${a.kind}`));

  const createTask = async (a: Advice) => {
    if (!o.org || !o.workspace || !o.userId || busy) return;
    setBusy(a.kind);
    const r = await supabase.from("tasks").insert({
      org_id: o.org.id, workspace_id: o.workspace.id, campaign_id: campaign.id, title: `${campaign.title}: ${t(tk(`ci.a.${a.kind}`))}`.slice(0, 200),
      description: `${t("ci.problem", { p: t(tk(`ci.p.${a.problem}`), { list: intel.overlaps.join(", ") }) })}\n${t("ci.rulesNote")}`,
      priority: a.risk === "high" ? "high" : "medium", labels: ["campaign-advice", `advice:${a.kind}`], owner_id: o.userId, created_by: o.userId,
    });
    setBusy(null);
    if (r.error) return void toast.error(t("ci.createFailed"));
    toast.success(t("ci.created"));
    void qc.invalidateQueries({ queryKey: ["execution"] });
  };

  return (
    <section aria-label={t("ci.title")} className="space-y-3 rounded-md border border-border bg-card p-3 text-xs">
      <div>
        <h3 className="text-sm font-semibold">{t("ci.title")}</h3>
        <p className="text-muted-foreground">{t("ci.intro")}</p>
      </div>
      <div>
        <p className="font-medium">{t("ci.figures")}</p>
        <dl className="mt-1 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {SHOWN.map((k) => {
            const f = intel.figures[k];
            return (
              <div key={k} className="min-w-0 rounded border border-border p-2">
                <dt className="text-muted-foreground">{t(tk(`ci.f.${k}`))}</dt>
                <dd className={cn("break-words tabular-nums", f.value === null ? "text-muted-foreground" : "font-semibold")}>{show(f)}</dd>
                <dd className="text-[11px] text-muted-foreground">{t(tk(`ci.s.${f.source}`))}{simNote && ["spent", "reserved", "remaining", "cpl", "cpa", "roas", "roi"].includes(k) ? ` · ${simNote}` : ""}</dd>
              </div>
            );
          })}
        </dl>
        {intel.estimatesExcluded > 0 && <p className="mt-1 text-muted-foreground">{t("ci.estimates", { n: intel.estimatesExcluded })}</p>}
      </div>
      <div>
        <p className="font-medium">{t("ci.problems")}</p>
        {intel.problems.length === 0 ? <p className="text-muted-foreground">{t("ci.noProblems")}</p> : (
          <ul className="mt-1 list-disc pl-5">{intel.problems.map((p) => <li key={p}>{t(tk(`ci.p.${p}`), { list: intel.overlaps.join(", ") })}</li>)}</ul>
        )}
        <p className="mt-1 text-muted-foreground">{t("ci.rulesNote")}</p>
      </div>
      {intel.advice.length > 0 && (
        <div className="space-y-2">
          <p className="font-medium">{t("ci.advice")}</p>
          {intel.advice.map((a) => {
            const kpi = a.kpi ? intel.figures[a.kpi] : null;
            return (
              <div key={a.kind} className="space-y-0.5 rounded-md border border-border p-2">
                <p className="font-medium">{t(tk(`ci.a.${a.kind}`))}</p>
                <p>{t("ci.problem", { p: t(tk(`ci.p.${a.problem}`), { list: intel.overlaps.join(", ") }) })}</p>
                {kpi && <p>{t("ci.situation", { s: `${t(tk(`ci.f.${kpi.key}`))}: ${show(kpi)}` })}</p>}
                {kpi && <p className="text-muted-foreground">{t("ci.evidence", { s: t(tk(`ci.s.${kpi.source}`)) })}</p>}
                <p className="text-muted-foreground">{t("ci.uncertainty")}</p>
                <p>{kpi ? t("ci.impact", { k: t(tk(`ci.f.${kpi.key}`)) }) : t("ci.impactNone")}</p>
                <p>{a.specialist ? t("ci.cost", { s: t(tk(`run.sp.${a.specialist}`)) }) : t("ci.costNone")} · {t("ci.risk", { r: t(tk(`rp.risk.${a.risk}`)) })}</p>
                <p className="text-muted-foreground">{t("ci.approval")}</p>
                {member && (exists(a)
                  ? <p className="text-muted-foreground">{t("ci.taskExists")}</p>
                  : <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => createTask(a)}>{t("ci.createTask")}</Button>)}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
