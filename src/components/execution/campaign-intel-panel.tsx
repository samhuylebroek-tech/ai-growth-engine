// Campaign diagnosis on the campaign overview (Campaign Intelligence 2.0): figures with their source, problems from
// fixed rules and suggested improvements a member can turn into an internal task. Costs no credits; nothing outside
// the platform changes.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
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
import { isExpenditure, isSimulatedSpend, spendSummary } from "@/lib/campaign-spend";
import { AiExplanation } from "@/components/app/situation-narrative";
import type { NarrativeFinding } from "@/lib/situation-narrative";
import { attribute } from "@/lib/bi/attribution";
import { isNotInstalled } from "@/lib/pending-schema";
import {
  campaignIntel,
  type Advice,
  type Figure,
  type FigureKey,
  type Intel,
} from "@/lib/campaign-intel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CampaignGuidance } from "@/components/execution/campaign-guidance";

type CampaignRow = Database["public"]["Tables"]["campaigns"]["Row"];
type TaskRow = Database["public"]["Tables"]["tasks"]["Row"];
const tk = (k: string) => k as MessageKey;
const SHOWN: FigureKey[] = [
  "budget",
  "spent",
  "reserved",
  "remaining",
  "leads",
  "clicks",
  "conversions",
  "revenue",
  "cpl",
  "cpa",
  "conversion_rate",
  "roas",
  "roi",
  "duration",
  "progress",
];

export function CampaignIntelPanel({
  campaign,
  tasks,
  campaigns,
}: {
  campaign: CampaignRow;
  tasks: readonly TaskRow[];
  campaigns: readonly CampaignRow[];
}) {
  const o = useOrg();
  const { t, tag } = useI18n();
  const qc = useQueryClient();
  const bi = useQuery(biOptions(o.org?.id, o.workspace?.id));
  const spend = useQuery(campaignSpendOptions(o.org?.id, o.workspace?.id));
  const [busy, setBusy] = useState<string | null>(null);
  const [allAdvice, setAllAdvice] = useState(false);
  const member = can(o.workspaceRole, "profile.edit");
  if (bi.error || (spend.error && !isNotInstalled(spend.error)))
    return <p className="text-xs text-destructive">{t("ci.failed")}</p>;
  if (!bi.data || (spend.isLoading && !spend.error))
    return <p className="text-xs text-muted-foreground">{t("ci.loading")}</p>;

  const mine = tasks.filter((x) => x.campaign_id === campaign.id);
  const ledger = spend.data ? spend.data.filter((r) => r.campaign_id === campaign.id) : null;
  const attribution = attribute(bi.data.revenue, bi.data.touches, "linear");
  const key = `campaign:${campaign.id}`;
  const attributed = attribution.flatMap((a) =>
    a.credits
      .filter((c) => c.key === key)
      .map((c) => ({ currency: a.currency, amount: c.amount, sales: c.sales })),
  );
  const intel: Intel = campaignIntel({
    campaign: {
      id: campaign.id,
      title: campaign.title,
      status: campaign.status,
      objective: campaign.objective ?? "",
      audience: campaign.audience ?? "",
      channels: campaign.channels ?? [],
      budget_eur: Number(campaign.budget_eur),
      start_date: campaign.start_date,
      end_date: campaign.end_date,
      goal_id: campaign.goal_id,
      results: campaign.results ?? "",
    },
    tasks: mine,
    spend: ledger ? spendSummary(Number(campaign.budget_eur), ledger) : null,
    spendRows: (ledger ?? [])
      .filter((r) => r.currency === "EUR" && isExpenditure(r) && !isSimulatedSpend(r))
      .map((r) => ({ occurred_on: r.occurred_on, amount: Number(r.amount) })),
    metrics: bi.data.metrics.map((m) => ({
      id: m.id,
      key: m.key,
      label: m.label,
      campaign_id: m.campaign_id ?? null,
      archived: m.archived,
    })),
    measurements: bi.data.measurements,
    attributed,
    experiments: bi.data.experiments,
    others: campaigns.map((c) => ({
      id: c.id,
      title: c.title,
      status: c.status,
      channels: c.channels ?? [],
      start_date: c.start_date,
      end_date: c.end_date,
      audience: c.audience ?? "",
    })),
    today: localDay(),
  });

  const money = (n: number) =>
    new Intl.NumberFormat(tag, { style: "currency", currency: "EUR" }).format(n);
  // Findings the AI advice may cite: every figure (value or missing reason), each rule problem and the simulated note.
  const aiFindings = (): NarrativeFinding[] => [
    ...SHOWN.map((k, n) => {
      const f = intel.figures[k];
      return {
        id: `campaign.${k}.${n}`,
        section: "campaign",
        code: k,
        reliability: (f.value === null
          ? "rule"
          : f.source === "computed"
            ? "computed"
            : f.source === "metric" || f.source === "spend_ledger"
              ? "entered"
              : "recorded") as NarrativeFinding["reliability"],
        text: `${t(tk(`ci.f.${k}`))}: ${show(f)}${f.periods?.length ? `; ${f.periods.map((p) => `${p.start}–${p.end}`).join(", ")}` : ""}`.slice(
          0,
          240,
        ),
      };
    }),
    ...intel.problems.map((p, n) => ({
      id: `campaign.${p}.p${n}`,
      section: "campaign",
      code: p,
      reliability: "rule" as const,
      text: t(tk(`ci.p.${p}`), { list: intel.overlaps.join(", ") }).slice(0, 240),
    })),
    ...intel.experimentEvidence.map((e) => ({
      id: `campaign.experiment.${e.id}`,
      section: "campaign",
      code: "experiment",
      reliability:
        e.evidence === "simulated"
          ? ("simulated" as const)
          : e.evidence === "controlled" || e.evidence === "correlational"
            ? ("entered" as const)
            : ("rule" as const),
      text: `${e.title}: ${t(tk(`ci.exp.${e.evidence}`))}`.slice(0, 240),
    })),
    ...(intel.simulated
      ? [
          {
            id: "campaign.simulated.0",
            section: "campaign",
            code: "simulated",
            reliability: "simulated" as const,
            text: t("ci.simLine", {
              n: intel.simulated.entries,
              s: money(intel.simulated.spent),
              r: money(intel.simulated.committed),
            }).slice(0, 240),
          },
        ]
      : []),
  ];
  const show = (f: Figure) => {
    if (f.value === null) return t("ci.missing", { r: t(tk(`ci.m.${f.missing ?? "no_actuals"}`)) });
    if (f.key === "conversion_rate")
      return `${(f.value * 100).toLocaleString(tag, { maximumFractionDigits: 2 })}%`;
    if (f.key === "roas" || f.key === "roi")
      return f.value.toLocaleString(tag, { maximumFractionDigits: 2 });
    if (f.key === "duration") return t("ci.days", { n: f.value });
    if (f.key === "progress") return `${f.value}%`;
    return f.currency ? money(f.value) : f.value.toLocaleString(tag);
  };
  const exists = (a: Advice) =>
    mine.some(
      (x) =>
        x.status !== "done" &&
        x.status !== "cancelled" &&
        (x.labels ?? []).includes(`advice:${a.kind}`),
    );

  const createTask = async (a: Advice) => {
    if (!o.org || !o.workspace || !o.userId || busy) return;
    setBusy(a.kind);
    const r = await supabase.from("tasks").insert({
      org_id: o.org.id,
      workspace_id: o.workspace.id,
      campaign_id: campaign.id,
      title: `${campaign.title}: ${t(tk(`ci.a.${a.kind}`))}`.slice(0, 200),
      description: `${t("ci.problem", { p: t(tk(`ci.p.${a.problem}`), { list: intel.overlaps.join(", ") }) })}\n${t("ci.rulesNote")}`,
      priority: a.risk === "high" ? "high" : "medium",
      labels: ["campaign-advice", `advice:${a.kind}`],
      owner_id: o.userId,
      created_by: o.userId,
    });
    setBusy(null);
    if (r.error) return void toast.error(t("ci.createFailed"));
    toast.success(t("ci.created"));
    void qc.invalidateQueries({ queryKey: ["execution"] });
  };

  return (
    <section aria-label={t("ci.title")} className="space-y-4 text-xs">
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
                <dd
                  className={cn(
                    "break-words tabular-nums",
                    f.value === null ? "text-muted-foreground" : "font-semibold",
                  )}
                >
                  {show(f)}
                </dd>
                <dd className="text-2xs text-muted-foreground">{t(tk(`ci.s.${f.source}`))}</dd>
                {f.periods && f.periods.length > 0 && (
                  <dd className="mt-1 break-words text-2xs text-muted-foreground">
                    {t("ci.period", {
                      period: f.periods.map((p) => `${p.start} – ${p.end}`).join(", "),
                    })}
                  </dd>
                )}
              </div>
            );
          })}
        </dl>
        {intel.simulated && (
          <p className="mt-2 rounded border border-warning/50 px-2 py-1 text-2xs text-warning">
            {t("ci.simLine", {
              n: intel.simulated.entries,
              s: money(intel.simulated.spent),
              r: money(intel.simulated.committed),
            })}
            {intel.simulated.warnings
              .filter((w) => w !== "other_currency")
              .map((w) => ` ${t(tk(`ci.simWarn.${w}`))}`)
              .join("")}
          </p>
        )}
        {intel.estimatesExcluded > 0 && (
          <p className="mt-1 text-muted-foreground">
            {t("ci.estimates", { n: intel.estimatesExcluded })}
          </p>
        )}
      </div>
      <details className="border-y border-border py-3">
        <summary className="min-h-6 cursor-pointer font-medium">
          {t("ci.measurementEvidence")}
        </summary>
        <div className="mt-3 divide-y divide-border">
          {intel.measurementEvidence
            .filter((m) => m.missing !== "no_metric")
            .map((m) => (
              <div key={m.key} className="space-y-1 py-3">
                <p className="font-medium">{m.label ?? m.key}</p>
                {m.missing && (
                  <p className="text-muted-foreground">
                    {t("ci.missing", { r: t(tk(`ci.m.${m.missing}`)) })}
                  </p>
                )}
                {m.kinds.map((kind) => (
                  <p key={kind} className="text-muted-foreground">
                    {t(tk(`ci.kind.${kind}`))}
                  </p>
                ))}
                {m.periods.length > 0 && (
                  <p className="break-words text-muted-foreground">
                    {t("ci.period", {
                      period: m.periods.map((p) => `${p.start} – ${p.end}`).join(", "),
                    })}
                  </p>
                )}
                {m.updatedAt && (
                  <p className="text-muted-foreground">
                    {t("ci.updated", {
                      date: new Date(m.updatedAt).toLocaleDateString(tag, { timeZone: "UTC" }),
                    })}
                  </p>
                )}
                {m.metricId && (
                  <Button asChild variant="link" size="sm" className="h-auto min-h-6 p-0">
                    <Link to="/app/performance/$metricId" params={{ metricId: m.metricId }}>
                      {t("ci.openMetric")}
                    </Link>
                  </Button>
                )}
              </div>
            ))}
          <p className="py-3 leading-relaxed text-muted-foreground">{t("ci.attributionNote")}</p>
        </div>
      </details>
      <details className="border-b border-border pb-3">
        <summary className="min-h-6 cursor-pointer font-medium">
          {t("ci.experiments")} ({intel.experimentEvidence.length})
        </summary>
        <div className="mt-3 space-y-3">
          {intel.experimentEvidence.length === 0 && (
            <p className="text-muted-foreground">{t("ci.noExperiments")}</p>
          )}
          {intel.experimentEvidence.map((e) => (
            <div key={e.id}>
              <p className="break-words font-medium">{e.title}</p>
              <p className="text-muted-foreground">{t(tk(`ci.exp.${e.evidence}`))}</p>
            </div>
          ))}
          <Button asChild variant="link" size="sm" className="h-auto min-h-6 p-0">
            <Link to="/app/experiments">{t("ci.openExperiments")}</Link>
          </Button>
        </div>
      </details>
      <div>
        <p className="font-medium">{t("ci.problems")}</p>
        {intel.problems.length === 0 ? (
          <p className="text-muted-foreground">{t("ci.noProblems")}</p>
        ) : (
          <ul className="mt-1 list-disc pl-5">
            {intel.problems.map((p) => (
              <li key={p}>{t(tk(`ci.p.${p}`), { list: intel.overlaps.join(", ") })}</li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-muted-foreground">{t("ci.rulesNote")}</p>
      </div>
      <AiExplanation
        scope="campaign"
        campaignId={campaign.id}
        prefix="cn"
        findings={aiFindings()}
        unknownSections={0}
      />
      {intel.advice.length > 0 && (
        <div className="space-y-2">
          <p className="font-medium">{t("ci.advice")}</p>
          {(allAdvice ? intel.advice : intel.advice.slice(0, 3)).map((a) => {
            const kpi = a.kpi ? intel.figures[a.kpi] : null;
            return (
              <div key={a.kind} className="space-y-0.5 rounded-md border border-border p-2">
                <p className="font-medium">{t(tk(`ci.a.${a.kind}`))}</p>
                <p>
                  {t("ci.problem", {
                    p: t(tk(`ci.p.${a.problem}`), { list: intel.overlaps.join(", ") }),
                  })}
                </p>
                {kpi && (
                  <p>{t("ci.situation", { s: `${t(tk(`ci.f.${kpi.key}`))}: ${show(kpi)}` })}</p>
                )}
                {kpi && (
                  <p className="text-muted-foreground">
                    {t("ci.evidence", { s: t(tk(`ci.s.${kpi.source}`)) })}
                  </p>
                )}
                <p className="text-muted-foreground">{t("ci.uncertainty")}</p>
                <p>{kpi ? t("ci.impact", { k: t(tk(`ci.f.${kpi.key}`)) }) : t("ci.impactNone")}</p>
                <p>
                  {a.specialist
                    ? t("ci.cost", { s: t(tk(`run.sp.${a.specialist}`)) })
                    : t("ci.costNone")}{" "}
                  · {t("ci.risk", { r: t(tk(`rp.risk.${a.risk}`)) })}
                </p>
                <p className="text-muted-foreground">{t("ci.approval")}</p>
                <CampaignGuidance campaignId={campaign.id} advice={a} />
                {member &&
                  (exists(a) ? (
                    <p className="text-muted-foreground">{t("ci.taskExists")}</p>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => createTask(a)}
                    >
                      {t("ci.createTask")}
                    </Button>
                  ))}
              </div>
            );
          })}
          {intel.advice.length > 3 && (
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={allAdvice}
              onClick={() => setAllAdvice((value) => !value)}
            >
              {t(allAdvice ? "ci.lessAdvice" : "ci.moreAdvice", { n: intel.advice.length - 3 })}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
