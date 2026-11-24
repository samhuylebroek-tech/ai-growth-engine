import { useMemo, useState, type ReactNode } from "react";
import { PageHeader } from "@/components/app/status";
import { evidenceQuality, fromClassified } from "@/lib/evidence";
import { QualityBadge } from "@/components/bi/evidence";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronUp, Lightbulb, Loader2, Sparkles, Target } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { useOrg } from "@/lib/org-context";
import { can, hasRole } from "@/lib/permissions";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { discoverOpportunities } from "@/lib/ai.functions";
import {
  growthDb,
  isNotInstalled,
  retryUnlessNotInstalled,
  type OpportunityRow,
} from "@/lib/pending-schema";
import {
  OPPORTUNITY_DOMAINS,
  OPPORTUNITY_HORIZONS,
  priorityScore,
  type EvidenceClass,
} from "@/lib/opportunities";
import { requestAttemptKey } from "@/lib/single-ai-request";
import { growthDraftKey } from "@/lib/growth-draft";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { SingleAIRecovery } from "@/components/app/single-ai-recovery";

const sel = "h-9 rounded-md border border-input bg-background px-2 text-sm";
const SCORES = ["impact", "feasibility", "cost", "time_to_value", "risk"] as const;
// For cost, time and risk a high score is unfavourable; the bar colour follows that.
const FAVOURABLE_HIGH: Record<(typeof SCORES)[number], boolean> = {
  impact: true,
  feasibility: true,
  cost: false,
  time_to_value: false,
  risk: false,
};
const evidenceSchema = z
  .array(z.object({ statement: z.string(), class: z.enum(["fact", "estimate", "hypothesis"]) }))
  .catch([]);
const kpiSchema = z.array(z.object({ metric: z.string(), target: z.string() })).catch([]);
type StatusFilter = "active" | "shortlisted" | "dismissed" | "converted" | "all";

export function opportunitiesQueryKey(orgId: string, wsId: string) {
  return ["growth-opportunities", orgId, wsId] as const;
}

export function OpportunitiesWorkspace() {
  const o = useOrg();
  const { t } = useI18n();
  if (o.loading)
    return (
      <p role="status" className="p-6 text-muted-foreground">
        …
      </p>
    );
  if (!o.workspace || !o.org)
    return <p className="p-6 text-muted-foreground">{t("shell.noWorkspace")}</p>;
  return (
    <Opportunities
      key={o.workspace.id}
      orgId={o.org.id}
      wsId={o.workspace.id}
      canEdit={hasRole(o.workspaceRole, "member")}
      canAsk={can(o.workspaceRole, "ai.use")}
    />
  );
}

function Opportunities({
  orgId,
  wsId,
  canEdit,
  canAsk,
}: {
  orgId: string;
  wsId: string;
  canEdit: boolean;
  canAsk: boolean;
}) {
  const { t, tag, locale } = useI18n();
  const qc = useQueryClient();
  const run = useServerFn(discoverOpportunities);
  const navigate = useNavigate();
  const [horizon, setHorizon] = useState<(typeof OPPORTUNITY_HORIZONS)[number]>(90);
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<StatusFilter>("active");
  const [domain, setDomain] = useState<string>("all");
  const [acting, setActing] = useState<string | null>(null);

  const list = useQuery({
    queryKey: opportunitiesQueryKey(orgId, wsId),
    retry: retryUnlessNotInstalled,
    queryFn: async () => {
      const r = await growthDb
        .from("growth_opportunities")
        .select("*")
        .eq("org_id", orgId)
        .eq("workspace_id", wsId)
        .order("created_at", { ascending: false })
        .limit(60);
      if (r.error) throw r.error;
      return r.data;
    },
  });
  const notInstalled = isNotInstalled(list.error);

  const visible = useMemo(() => {
    const rows = (list.data ?? []).filter(
      (r) =>
        (status === "all" ||
          (status === "active"
            ? r.status === "open" || r.status === "shortlisted"
            : r.status === status)) &&
        (domain === "all" || r.domain === domain),
    );
    return rows.sort(
      (a, b) =>
        (a.status === "shortlisted" ? 0 : 1) - (b.status === "shortlisted" ? 0 : 1) ||
        priorityScore(b) - priorityScore(a),
    );
  }, [list.data, status, domain]);

  const generate = async () => {
    if (busy) return;
    setBusy(true);
    const scope = `opportunities/${orgId}/${wsId}`;
    // The same inputs keep the same request key until success, so a retry never pays twice.
    const requestKey = requestAttemptKey(
      sessionStorage,
      scope,
      JSON.stringify({ horizon, focus: focus.trim(), locale }),
      () => crypto.randomUUID(),
    );
    try {
      const r = await run({
        data: {
          orgId,
          workspaceId: wsId,
          requestKey,
          horizonDays: horizon,
          focus: focus.trim(),
          locale,
        },
      });
      if (!r.ok) return void toast.error(r.error);
      if (!r.data.saved) return void toast.error(t("opp.generate.notSaved"));
      sessionStorage.removeItem(`single-ai-attempt:${scope}`);
      toast.success(t("opp.generate.done", { n: r.data.count, credits: r.data.credits }));
      setStatus("active");
      setDomain("all");
      setFocus("");
      await qc.invalidateQueries({ queryKey: opportunitiesQueryKey(orgId, wsId) });
      void qc.invalidateQueries({ queryKey: ["credits"] });
    } catch {
      toast.error(t("opp.generate.unconfirmed"));
    } finally {
      setBusy(false);
    }
  };

  const decide = async (row: OpportunityRow, next: "open" | "shortlisted" | "dismissed") => {
    setActing(row.id);
    const r = await growthDb.rpc("set_growth_opportunity_status", {
      _opportunity: row.id,
      _status: next,
    });
    setActing(null);
    if (r.error) return void toast.error(t("opp.toast.failed"));
    toast.success(t("opp.toast.updated"));
    await qc.invalidateQueries({ queryKey: opportunitiesQueryKey(orgId, wsId) });
  };
  const convert = async (row: OpportunityRow) => {
    setActing(row.id);
    const r = await growthDb.rpc("convert_growth_opportunity", { _opportunity: row.id });
    setActing(null);
    const receipt = z.object({ goal_id: z.guid(), created: z.boolean() }).safeParse(r.data);
    if (r.error || !receipt.success) return void toast.error(t("opp.toast.failed"));
    toast.success(
      receipt.data.created ? t("opp.toast.converted") : t("opp.toast.alreadyConverted"),
    );
    await qc.invalidateQueries({ queryKey: opportunitiesQueryKey(orgId, wsId) });
    void qc.invalidateQueries({ queryKey: ["growth-goals"] });
  };
  const ask = (row: OpportunityRow) => {
    sessionStorage.setItem(
      growthDraftKey(orgId, wsId),
      t("opp.ask.question", { title: row.title }),
    );
    void navigate({ to: "/app/growth-officer" });
  };

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        icon={<Lightbulb className="h-6 w-6 shrink-0 text-primary" aria-hidden />}
        title={t("opp.title")}
        description={t("opp.intro")}
      />

      {notInstalled ? (
        <p
          role="status"
          className="rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground"
        >
          {t("opp.notInstalled")}
        </p>
      ) : (
        <>
          {canEdit ? (
            <section
              aria-label={t("opp.generate.title")}
              className="space-y-3 rounded-lg border border-border bg-card p-4"
            >
              <h2 className="text-base font-semibold">{t("opp.generate.title")}</h2>
              <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
                <label className="space-y-1 text-sm">
                  <span className="block text-muted-foreground">{t("opp.generate.horizon")}</span>
                  <select
                    className={cn(sel, "w-full sm:w-40")}
                    value={horizon}
                    onChange={(e) => setHorizon(Number(e.target.value) as typeof horizon)}
                  >
                    {OPPORTUNITY_HORIZONS.map((h) => (
                      <option key={h} value={h}>
                        {t("opp.generate.days", { n: h })}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-sm">
                  <span className="block text-muted-foreground">{t("opp.generate.focus")}</span>
                  <Textarea
                    rows={2}
                    maxLength={500}
                    value={focus}
                    placeholder={t("opp.generate.focusPlaceholder")}
                    onChange={(e) => setFocus(e.target.value)}
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={generate} disabled={busy}>
                  {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
                  {busy ? t("opp.generate.busy") : t("opp.generate.button")}
                </Button>
                <p className="text-xs text-muted-foreground">{t("opp.generate.cost")}</p>
              </div>
            </section>
          ) : (
            <p className="text-sm text-muted-foreground">{t("opp.viewerNote")}</p>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-sm">
              <span className="block text-muted-foreground">{t("opp.filter.status")}</span>
              <select
                className={sel}
                value={status}
                onChange={(e) => setStatus(e.target.value as StatusFilter)}
              >
                <option value="active">{t("opp.filter.active")}</option>
                <option value="shortlisted">{t("opp.status.shortlisted")}</option>
                <option value="converted">{t("opp.status.converted")}</option>
                <option value="dismissed">{t("opp.status.dismissed")}</option>
                <option value="all">{t("opp.filter.all")}</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="block text-muted-foreground">{t("opp.filter.domain")}</span>
              <select className={sel} value={domain} onChange={(e) => setDomain(e.target.value)}>
                <option value="all">{t("opp.filter.allDomains")}</option>
                {OPPORTUNITY_DOMAINS.map((d) => (
                  <option key={d} value={d}>
                    {t(`opp.domain.${d}` as MessageKey)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {list.isLoading && (
            <div
              role="status"
              className="h-32 animate-pulse rounded-lg bg-muted"
              aria-label={t("opp.title")}
            />
          )}
          {list.error && !notInstalled && (
            <p role="alert" className="text-sm text-destructive">
              {t("opp.loadError")}
            </p>
          )}
          {list.data &&
            (list.data.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                {t("opp.empty")}
              </p>
            ) : visible.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("opp.emptyFilter")}</p>
            ) : (
              <ul className="space-y-4">
                {visible.map((row) => (
                  <OpportunityCard
                    key={row.id}
                    row={row}
                    tag={tag}
                    canEdit={canEdit}
                    canAsk={canAsk}
                    busy={acting === row.id}
                    onDecide={(s) => decide(row, s)}
                    onConvert={() => convert(row)}
                    onAsk={() => ask(row)}
                  />
                ))}
              </ul>
            ))}
          {canEdit && <SingleAIRecovery pendingOnly />}
        </>
      )}
    </div>
  );
}

function OpportunityCard({
  row,
  tag,
  canEdit,
  canAsk,
  busy,
  onDecide,
  onConvert,
  onAsk,
}: {
  row: OpportunityRow;
  tag: string;
  canEdit: boolean;
  canAsk: boolean;
  busy: boolean;
  onDecide: (s: "open" | "shortlisted" | "dismissed") => void;
  onConvert: () => void;
  onAsk: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const evidence = evidenceSchema.parse(row.evidence);
  // Discovered by the AI: what it calls a fact stays an unverified claim until a person confirms the record behind it.
  const quality = evidenceQuality(evidence.map((e) => fromClassified(e.class, "ai")));
  const kpis = kpiSchema.parse(row.kpis);
  const money = (n: number) =>
    new Intl.NumberFormat(tag, {
      style: "currency",
      currency: row.currency,
      maximumFractionDigits: 0,
    }).format(n);
  const budget =
    row.budget_min == null && row.budget_max == null
      ? t("opp.budgetUnknown")
      : row.budget_min != null && row.budget_max != null && row.budget_min !== row.budget_max
        ? `${money(Number(row.budget_min))} – ${money(Number(row.budget_max))}`
        : money(Number(row.budget_max ?? row.budget_min));
  const level = (l: string) => t(`opp.level.${l}` as MessageKey);
  const final = row.status === "converted";
  return (
    <li
      className={cn(
        "rounded-lg border border-border bg-card p-4",
        row.status === "dismissed" && "opacity-70",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{t(`opp.domain.${row.domain}` as MessageKey)}</Badge>
            <Badge variant={row.status === "shortlisted" ? "default" : "outline"}>
              {t(`opp.status.${row.status}` as MessageKey)}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {t("opp.priority", { n: priorityScore(row) })} ·{" "}
              {t("opp.confidence", { level: level(row.confidence) })}
            </span>
          </div>
          <h3 className="text-base font-semibold leading-snug">{row.title}</h3>
        </div>
        <span className="text-xs text-muted-foreground">
          {t("opp.found", { date: new Date(row.created_at).toLocaleDateString(tag) })}
        </span>
      </div>
      <p className="mt-2 text-sm">{row.summary}</p>

      <dl
        className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-5"
        aria-label={t("opp.disclaimer")}
      >
        {SCORES.map((k) => {
          const v = row[k];
          const good = FAVOURABLE_HIGH[k] ? v >= 4 : v <= 2;
          const bad = FAVOURABLE_HIGH[k] ? v <= 2 : v >= 4;
          return (
            <div key={k}>
              <dt className="text-xs text-muted-foreground">{t(`opp.score.${k}` as MessageKey)}</dt>
              <dd className="flex items-center gap-2">
                <span className="font-medium tabular-nums">{v}/5</span>
                <span className="h-1.5 flex-1 rounded-full bg-muted" aria-hidden>
                  <span
                    className={cn(
                      "block h-full rounded-full",
                      good ? "bg-success" : bad ? "bg-warning" : "bg-primary",
                    )}
                    style={{ width: `${v * 20}%` }}
                  />
                </span>
              </dd>
            </div>
          );
        })}
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span>
          {t("opp.budget")}: <span className="text-foreground">{budget}</span>
        </span>
        <span>
          {t("opp.horizon")}:{" "}
          <span className="text-foreground">{t("opp.generate.days", { n: row.horizon_days })}</span>
        </span>
        <span>{t("opp.complexity", { level: level(row.complexity) })}</span>
        <Badge variant="outline" className="font-normal">
          {t("opp.disclaimer")}
        </Badge>
        <QualityBadge q={quality} />
      </div>

      {open && (
        <div className="mt-4 space-y-3 border-t border-border pt-3 text-sm">
          {row.analysis && (
            <Block title={t("opp.analysis")}>
              <p className="whitespace-pre-line">{row.analysis}</p>
            </Block>
          )}
          {row.audience && (
            <Block title={t("opp.audience")}>
              <p>{row.audience}</p>
            </Block>
          )}
          {row.expected_impact && (
            <Block title={t("opp.expectedImpact")}>
              <p>{row.expected_impact}</p>
            </Block>
          )}
          {evidence.length > 0 && (
            <Block title={t("opp.evidence")}>
              <ul className="space-y-1">
                {evidence.map((e, i) => (
                  <li key={i} className="flex flex-wrap items-start gap-2">
                    <EvidenceBadge kind={e.class} />
                    <span className="min-w-0 flex-1">
                      {e.statement}
                      {e.class === "fact" && (
                        <span className="block text-2xs text-muted-foreground">
                          {t("ev.claimed")}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </Block>
          )}
          {kpis.length > 0 && (
            <Block title={t("opp.kpis")}>
              <ul className="list-disc pl-5">
                {kpis.map((k, i) => (
                  <li key={i}>
                    {k.metric}: {k.target}
                  </li>
                ))}
              </ul>
            </Block>
          )}
          {row.resources.length > 0 && (
            <Block title={t("opp.resources")}>
              <ul className="list-disc pl-5">
                {row.resources.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </Block>
          )}
          {row.integrations.length > 0 && (
            <Block title={t("opp.integrations")}>
              <p>{row.integrations.join(", ")}</p>
            </Block>
          )}
          {row.risks.length > 0 && (
            <Block title={t("opp.risks")}>
              <ul className="list-disc pl-5">
                {row.risks.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </Block>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? <ChevronUp /> : <ChevronDown />}
          {open ? t("opp.details.hide") : t("opp.details.show")}
        </Button>
        {canEdit && !final && row.status !== "dismissed" && (
          <Button size="sm" disabled={busy} onClick={onConvert}>
            <Target />
            {t("opp.action.convert")}
          </Button>
        )}
        {final && (
          <Button size="sm" variant="outline" asChild>
            <Link to="/app/goals">
              <Target />
              {t("opp.action.openGoal")}
            </Link>
          </Button>
        )}
        {canEdit && !final && row.status === "open" && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onDecide("shortlisted")}
          >
            {t("opp.action.shortlist")}
          </Button>
        )}
        {canEdit && !final && row.status === "shortlisted" && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onDecide("open")}>
            {t("opp.action.unshortlist")}
          </Button>
        )}
        {canEdit && !final && row.status !== "dismissed" && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide("dismissed")}>
            {t("opp.action.dismiss")}
          </Button>
        )}
        {canEdit && row.status === "dismissed" && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onDecide("open")}>
            {t("opp.action.reopen")}
          </Button>
        )}
        {canAsk && row.status !== "dismissed" && (
          <Button size="sm" variant="ghost" onClick={onAsk}>
            <Sparkles />
            {t("opp.action.ask")}
          </Button>
        )}
      </div>
    </li>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="font-medium">{title}</p>
      <div className="text-muted-foreground">{children}</div>
    </div>
  );
}

function EvidenceBadge({ kind }: { kind: EvidenceClass }) {
  const { t } = useI18n();
  return (
    <Badge
      variant={kind === "fact" ? "secondary" : "outline"}
      className={cn(
        "shrink-0 font-normal",
        kind === "hypothesis" && "border-warning/50 text-warning",
      )}
    >
      {t(`opp.evidence.${kind}` as MessageKey)}
    </Badge>
  );
}
