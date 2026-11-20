// Continuous improvement: findings from recorded performance, improvement proposals, approval, conversion into
// work and outcome measurement. Approved proposals become tasks; nothing changes strategies, budgets or campaigns.
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { useI18n } from "@/lib/i18n";
import { can } from "@/lib/permissions";
import { growthDb, type ProposalRow } from "@/lib/pending-schema";
import type { Json } from "@/integrations/supabase/types";
import { effectiveMeasurements, isActual } from "@/lib/performance";
import { buildView, NO_FILTERS, type BiData } from "@/lib/bi/view";
import { observedOutcome, type Candidate } from "@/lib/bi/optimization";
import {
  approvalGates,
  evidenceQuality,
  fromDrafts,
  isUnverifiedHypothesis,
  proposalStage,
  type ProposalLevel,
  type EvidenceDraft,
} from "@/lib/evidence";
import { EvidenceList, QualityBadge, linkedFor, qualityOfLinked } from "./evidence";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { biKey } from "./bi-data";
import { BiState, useBi } from "./business-overview";
import { Badge, Section, sel, tk, useFmt } from "./parts";

const FILTERS = {
  open: ["proposed", "approved"],
  work: ["converted"],
  done: ["measured"],
  closed: ["rejected", "withdrawn"],
  all: [],
} as const;
type Filter = keyof typeof FILTERS;
const LEVELS = ["none", "read", "draft", "modify", "execute", "publish", "budget"] as const;
const CATS = ["immediate", "strategic", "opportunity", "problem", "experiment"] as const;
// Field limits mirror the database checks (0066 / 0073).
const MAXLEN: Record<string, number> = {
  title: 160,
  objective: 500,
  method: 400,
  approvalReq: 300,
};

export function Improvements() {
  const q = useBi();
  return <BiState q={q}>{(d) => <Body d={d} />}</BiState>;
}

function Body({ d }: { d: BiData }) {
  const { t } = useI18n();
  const v = useMemo(() => buildView(d, NO_FILTERS, "last_touch"), [d]);
  const [filter, setFilter] = useState<Filter>("open");
  const proposals = (d.proposals as unknown as ProposalRow[]).filter(
    (p) => filter === "all" || (FILTERS[filter] as readonly string[]).includes(p.status),
  );
  return (
    <>
      <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        {t("bi.imp.rules")}
      </p>
      <Section title={t("bi.imp.findings")} intro={t("bi.imp.findingsIntro")}>
        {!v.candidates.length ? (
          <p className="text-xs text-muted-foreground">{t("bi.imp.noFindings")}</p>
        ) : (
          <ul className="space-y-2">
            {v.candidates.map((c) => (
              <FindingCard key={c.sourceKey} c={c} governed={d.evidence != null} />
            ))}
          </ul>
        )}
      </Section>
      <TeamProposal governed={d.evidence != null} />
      <Section title={t("bi.imp.proposals")}>
        <div role="tablist" aria-label={t("bi.imp.filter")} className="mb-3 flex flex-wrap gap-1">
          {(Object.keys(FILTERS) as Filter[]).map((x) => (
            <button
              key={x}
              role="tab"
              aria-selected={filter === x}
              onClick={() => setFilter(x)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs",
                filter === x ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/50",
              )}
            >
              {t(tk(`bi.imp.f.${x}`))}
            </button>
          ))}
        </div>
        {!proposals.length ? (
          <p className="text-xs text-muted-foreground">{t("bi.imp.none")}</p>
        ) : (
          <ul className="space-y-3">
            {proposals.map((p) => (
              <ProposalCard key={p.id} p={p} d={d} />
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function FindingCard({ c, governed }: { c: Candidate; governed: boolean }) {
  const o = useOrg();
  const { t } = useI18n();
  const qc = useQueryClient();
  const member = can(o.workspaceRole, "ai.use");
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  // One stable request key per evidence item, so a retried save never records the same evidence twice.
  const [evKeys] = useState(() => c.records.map(() => crypto.randomUUID()));
  const quality = evidenceQuality(fromDrafts(c.records));
  const T = (part: string) => t(tk(`bi.cand.${c.code}.${part}`), c.vars);
  const desc = (r: EvidenceDraft) =>
    (r.text ? t(tk(r.text.key), r.text.vars) : r.description).slice(0, 1000);
  async function save() {
    if (!o.workspace) return;
    setBusy(true);
    const evidenceIds: string[] = [];
    if (governed)
      for (const [i, r] of c.records.entries()) {
        const e = await growthDb.rpc("record_evidence", {
          _workspace: o.workspace.id,
          _request: evKeys[i]!,
          _p: { ...withoutText(r), description: desc(r), origin: "rule" } as Json,
        });
        if (e.error) {
          setBusy(false);
          toast.error(t("bi.failed", { e: e.error.message }));
          return;
        }
        const id = (e.data as { evidence_id?: string } | null)?.evidence_id;
        if (id) evidenceIds.push(id);
      }
    const measureAfter = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const r = await growthDb.rpc("create_optimization_proposal", {
      _workspace: o.workspace.id,
      _request: key,
      _p: {
        source_key: `rule:${c.sourceKey}`,
        origin: "rule",
        category: c.category,
        title: T("title"),
        change: T("change"),
        reason: T("reason"),
        uncertainty: T("uncertainty"),
        expected_impact: T("impact"),
        success_measure: T("measure"),
        required_level: c.requiredLevel,
        measure_after: measureAfter,
        evidence: c.evidence as unknown as Json,
        ...(governed ? { level: "formal", evidence_ids: evidenceIds } : {}),
        ...(c.metricId ? { metric_id: c.metricId } : {}),
        ...(c.goalId ? { goal_id: c.goalId } : {}),
        ...(c.campaignId ? { campaign_id: c.campaignId } : {}),
        ...(c.initiativeId ? { initiative_id: c.initiativeId } : {}),
      } as Json,
    });
    setBusy(false);
    if (r.error) {
      toast.error(t("bi.failed", { e: r.error.message }));
      return;
    }
    toast.success(t("bi.imp.saved"));
    void qc.invalidateQueries({ queryKey: biKey(o.org?.id, o.workspace?.id) });
  }
  return (
    <li className="rounded-lg border border-border bg-card p-3 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="text-sm font-medium">{T("title")}</span>
        <Badge kind={c.category === "problem" || c.category === "immediate" ? "low" : "medium"}>
          {t(tk(`bi.catAct.${c.category}`))}
        </Badge>
      </div>
      <p className="mt-1">{T("reason")}</p>
      <p className="mt-1 text-muted-foreground">
        {t("bi.imp.suggested")} {T("change")}
      </p>
      <div className="mt-1.5">
        <QualityBadge q={quality} showReasons />
      </div>
      {c.records.length > 0 && (
        <div className="mt-1.5 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">{t("ev.findingEvidence")}:</span>
          <ul className="mt-0.5 list-disc pl-4">
            {c.records.map((r, i) => (
              <li key={i} className="break-words">
                {t(tk(`ev.type.${r.type}`))} · {desc(r)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {member && (
        <Button size="sm" variant="outline" className="mt-2" disabled={busy} onClick={save}>
          {t("bi.imp.save")}
        </Button>
      )}
    </li>
  );
}

function TeamProposal({ governed }: { governed: boolean }) {
  const o = useOrg();
  const { t } = useI18n();
  const qc = useQueryClient();
  const member = can(o.workspaceRole, "ai.use");
  const empty = {
    title: "",
    change: "",
    reason: "",
    uncertainty: "",
    impact: "",
    measure: "",
    cost: "",
    objective: "",
    risk: "",
    method: "",
    approvalReq: "",
    context: "",
    gap: "",
  };
  const [v, setV] = useState(empty);
  const [plevel, setPlevel] = useState<ProposalLevel>("formal");
  const [category, setCategory] = useState<(typeof CATS)[number]>("strategic");
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("none");
  const [currency, setCurrency] = useState("EUR");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  if (!member) return null;
  const set =
    (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setV((x) => ({ ...x, [k]: e.target.value }));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!o.workspace) return;
    if (v.cost && !/^\d+(\.\d{1,2})?$/.test(v.cost)) {
      toast.error(t("bi.rev.badAmount"));
      return;
    }
    setBusy(true);
    const r = await growthDb.rpc("create_optimization_proposal", {
      _workspace: o.workspace.id,
      _request: key,
      _p: {
        origin: "team",
        category,
        title: v.title,
        change: v.change,
        reason: v.reason,
        uncertainty: v.uncertainty,
        expected_impact: v.impact,
        success_measure: v.measure,
        required_level: level,
        ...(v.cost ? { est_cost: v.cost, currency } : {}),
        ...(governed
          ? {
              level: plevel,
              ...(plevel !== "observation" && v.gap.trim() ? { evidence_gap_reason: v.gap } : {}),
              ...(plevel === "execution"
                ? {
                    objective: v.objective,
                    risk: v.risk,
                    measurement_method: v.method,
                    approval_requirement: v.approvalReq,
                    business_context: v.context,
                  }
                : {}),
            }
          : {}),
      } as Json,
    });
    setBusy(false);
    if (r.error) {
      toast.error(t("bi.failed", { e: r.error.message }));
      return;
    }
    toast.success(t("bi.imp.saved"));
    setV(empty);
    setKey(crypto.randomUUID());
    setOpen(false);
    void qc.invalidateQueries({ queryKey: biKey(o.org?.id, o.workspace?.id) });
  }
  const field = (k: keyof typeof empty, label: string, area = false) => (
    <label className={cn("text-[11px]", area && "sm:col-span-2")}>
      <span className="mb-1 block font-medium">{label} *</span>
      {area ? (
        <Textarea rows={2} value={v[k]} onChange={set(k)} maxLength={1000} required />
      ) : (
        <Input value={v[k]} onChange={set(k)} maxLength={MAXLEN[k] ?? 600} required />
      )}
    </label>
  );
  return (
    <div className="mt-6">
      {!open ? (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          {t("bi.imp.new")}
        </Button>
      ) : (
        <form
          onSubmit={submit}
          className="rounded-lg border border-border bg-card p-4"
          aria-label={t("bi.imp.new")}
        >
          <h2 className="text-sm font-semibold">{t("bi.imp.new")}</h2>
          {governed && (
            <fieldset className="mt-3">
              <legend className="mb-1 text-[11px] font-medium">{t("ev.levelLabel")}</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {(["observation", "formal", "execution"] as const).map((l) => (
                  <label
                    key={l}
                    className={cn(
                      "cursor-pointer rounded-md border p-2 text-[11px]",
                      plevel === l ? "border-primary bg-primary/5" : "border-border",
                    )}
                  >
                    <input
                      type="radio"
                      name="proposal-level"
                      className="mr-1.5"
                      checked={plevel === l}
                      onChange={() => setPlevel(l)}
                    />
                    <span className="font-medium">{t(tk(`ev.level.${l}`))}</span>
                    <span className="mt-0.5 block text-muted-foreground">
                      {t(tk(`ev.levelHelp.${l}`))}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {field("title", t("bi.imp.title"))}
            <label className="text-[11px]">
              <span className="mb-1 block font-medium">{t("bi.imp.category")}</span>
              <select
                className={sel}
                value={category}
                onChange={(e) => setCategory(e.target.value as typeof category)}
              >
                {CATS.map((c) => (
                  <option key={c} value={c}>
                    {t(tk(`bi.catAct.${c}`))}
                  </option>
                ))}
              </select>
            </label>
            {field("change", t("bi.imp.change"), true)}
            {field("reason", t("bi.imp.reason"), true)}
            {field("uncertainty", t("bi.imp.uncertainty"))}
            {field("impact", t("bi.imp.impact"))}
            {field("measure", t("bi.imp.measure"))}
            <label className="text-[11px]">
              <span className="mb-1 block font-medium">{t("bi.imp.level")}</span>
              <select
                className={sel}
                value={level}
                onChange={(e) => setLevel(e.target.value as typeof level)}
              >
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {t(tk(`bi.level.${l}`))}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end gap-2 text-[11px]">
              <label className="flex-1">
                <span className="mb-1 block font-medium">{t("bi.imp.cost")}</span>
                <Input inputMode="decimal" value={v.cost} onChange={set("cost")} />
              </label>
              <label>
                <span className="mb-1 block font-medium">{t("bi.rev.currency")}</span>
                <select
                  className="rounded-md border border-border bg-card px-2 py-2 text-xs"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  {["EUR", "USD", "GBP"].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            </div>
            {governed && plevel === "execution" && (
              <>
                {field("objective", t("ev.objective"))}
                {field("risk", t("ev.risk"))}
                {field("method", t("ev.method"))}
                {field("approvalReq", t("ev.approvalReq"))}
                {field("context", t("ev.context"), true)}
              </>
            )}
            {governed && plevel === "formal" && (
              <label className="text-[11px] sm:col-span-2">
                <span className="mb-1 block font-medium">{t("ev.gapReason")}</span>
                <Input value={v.gap} onChange={set("gap")} maxLength={500} />
              </label>
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {t("bi.imp.submit")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              {t("bi.cancel")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function ProposalCard({ p, d }: { p: ProposalRow; d: BiData }) {
  const o = useOrg();
  const { t } = useI18n();
  const f = useFmt();
  const qc = useQueryClient();
  const member = can(o.workspaceRole, "ai.use");
  const admin = can(o.workspaceRole, "approvals.decide");
  const editor = can(o.workspaceRole, "evidence.decide");
  const governed = d.evidence != null;
  const [note, setNote] = useState("");
  const [gap, setGap] = useState("");
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);
  const linked = useMemo(() => linkedFor(d, p.id), [d, p.id]);
  const quality = qualityOfLinked(linked, d);
  const level = p.level ?? "formal";
  const gateInput = {
    level,
    status: p.status,
    reviewed: !!p.reviewed_at,
    gapReason: p.evidence_gap_reason ?? "",
    linked: linked.map((e) => ({
      type: e.evidence_type,
      origin: e.origin,
      status: e.status,
      role: e.role,
      source_ref: e.source_ref,
    })),
  };
  const gates = governed ? approvalGates(gateInput) : [];
  // The approver states exactly what they inspected; the database refuses if the list changed meanwhile.
  const seen = linked.map((e) => e.id).sort();
  const metric = p.metric_id ? d.metrics.find((m) => m.id === p.metric_id) : undefined;
  const observed = useMemo(() => {
    if (!metric || p.status !== "converted") return null;
    const rows = effectiveMeasurements(d.measurements)
      .filter((r) => r.metric_id === metric.id && isActual(r.kind))
      .sort((a, b) => a.period_start.localeCompare(b.period_start));
    const before = [...rows].reverse().find((r) => r.period_end < p.created_at.slice(0, 10));
    const after = rows.filter((r) => r.period_start >= p.created_at.slice(0, 10)).at(-1);
    return before && after
      ? {
          o: observedOutcome(metric.direction, Number(before.value), Number(after.value)),
          before: Number(before.value),
          after: Number(after.value),
        }
      : { o: "inconclusive" as const, before: null, after: null };
  }, [metric, d.measurements, p.status, p.created_at]);
  async function act(
    action: "review" | "promote" | "approve" | "reject" | "convert" | "measure" | "withdraw",
    data: Record<string, string | string[]> = {},
  ) {
    setBusy(true);
    const r = await growthDb.rpc("advance_optimization_proposal", {
      _proposal: p.id,
      _action: action,
      _data: data as Json,
    });
    setBusy(false);
    if (r.error) {
      toast.error(t("bi.failed", { e: r.error.message }));
      return;
    }
    toast.success(
      action === "review"
        ? t("ev.reviewDone")
        : action === "promote"
          ? t("ev.promoted")
          : t(tk(`bi.imp.done.${action}`)),
    );
    setNote("");
    void qc.invalidateQueries({ queryKey: biKey(o.org?.id, o.workspace?.id) });
  }
  const evidence = Array.isArray(p.evidence)
    ? (p.evidence as { label?: string }[])
        .map((e) => e.label)
        .filter(Boolean)
        .join(", ")
    : "";
  return (
    <li className="rounded-lg border border-border bg-card p-3 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="min-w-0 text-sm font-medium">{p.title}</span>
        <span className="flex flex-wrap gap-1">
          <Badge kind="medium">{t(tk(`bi.catAct.${p.category}`))}</Badge>
          <Badge
            kind={
              p.status === "measured" || p.status === "converted"
                ? "high"
                : p.status === "rejected" || p.status === "withdrawn"
                  ? "none"
                  : "low"
            }
          >
            {t(tk(`bi.pstatus.${p.status}`))}
          </Badge>
          <Badge kind="none">{t(tk(`bi.origin.${p.origin}`))}</Badge>
          {governed && (
            <Badge kind={level === "observation" ? "none" : "medium"}>
              {t(tk(`ev.level.${level}`))}
            </Badge>
          )}
          {governed && (
            <Badge kind="none">{t("ev.stage", { s: t(tk(`ev.stage.${proposalStage(p)}`)) })}</Badge>
          )}
        </span>
      </div>
      {governed && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <QualityBadge q={quality} showReasons />
          {level !== "observation" &&
            ["approved", "converted", "measured"].includes(p.status) &&
            isUnverifiedHypothesis(gateInput) && <Badge kind="low">{t("ev.unverified")}</Badge>}
        </div>
      )}
      <dl className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {(
          [
            ["change", p.change],
            ["reason", p.reason],
            ["uncertainty", p.uncertainty],
            ["impact", p.expected_impact],
            ["measure", p.success_measure],
          ] as const
        ).map(([k, val]) => (
          <div key={k} className="min-w-0">
            <dt className="text-[11px] text-muted-foreground">{t(tk(`bi.imp.${k}`))}</dt>
            <dd className="break-words">{val}</dd>
          </div>
        ))}
        <div>
          <dt className="text-[11px] text-muted-foreground">{t("bi.imp.cost")}</dt>
          <dd>
            {p.est_cost !== null && p.currency
              ? f.money(Number(p.est_cost), p.currency)
              : t("bi.imp.noCost")}
            {p.est_credits ? ` · ${t("bi.imp.credits", { n: p.est_credits })}` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted-foreground">{t("bi.imp.level")}</dt>
          <dd>{t(tk(`bi.level.${p.required_level}`))}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted-foreground">{t("bi.imp.approval")}</dt>
          <dd>
            {p.required_level === "budget" || p.required_level === "publish"
              ? t("bi.imp.approvalExternal")
              : t("bi.imp.approvalAdmin")}
          </dd>
        </div>
        {(
          [
            ["objective", p.objective],
            ["risk", p.risk],
            ["method", p.measurement_method],
            ["approvalReq", p.approval_requirement],
            ["context", p.business_context],
          ] as const
        )
          .filter(([, val]) => !!val)
          .map(([k, val]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[11px] text-muted-foreground">{t(tk(`ev.${k}`))}</dt>
              <dd className="break-words">{val}</dd>
            </div>
          ))}
        {evidence && !governed && (
          <div className="sm:col-span-2">
            <dt className="text-[11px] text-muted-foreground">{t("bi.imp.evidence")}</dt>
            <dd>{evidence}</dd>
          </div>
        )}
      </dl>
      {governed && p.evidence_gap_reason && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {t("ev.gapShown", { r: p.evidence_gap_reason })}
        </p>
      )}
      {governed && (
        <EvidenceList items={linked} canAdd={member && p.status === "proposed"} p={p} d={d} />
      )}
      {gates.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11px] text-warning" aria-label={t("ev.qTitle")}>
          {gates.map((g) => (
            <li key={g}>• {t(tk(`ev.gate.${g}`))}</li>
          ))}
        </ul>
      )}
      {governed && p.reviewed_at && p.status === "proposed" && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t("ev.reviewedAt")} · {f.date(p.reviewed_at)}
          {p.review_note ? ` · ${p.review_note}` : ""}
        </p>
      )}
      {p.decision_note && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {t("bi.imp.decisionNote")}: {p.decision_note}
        </p>
      )}
      {p.task_id && (
        <p className="mt-2">
          <Link to="/app/tasks" className="text-[11px] text-primary hover:underline">
            {t("bi.imp.openTask")}
          </Link>
        </p>
      )}
      {p.status === "measured" && (
        <p className="mt-2">
          <Badge kind={p.outcome === "improved" ? "high" : p.outcome === "worse" ? "low" : "none"}>
            {t(tk(`bi.outcome.${p.outcome}`))}
          </Badge>{" "}
          <span className="text-[11px] text-muted-foreground">
            {p.outcome_note} · {t("bi.imp.notCause")}
          </span>
        </p>
      )}
      {member && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          {governed && p.status === "proposed" && level === "observation" && (
            <>
              <Input
                value={gap}
                onChange={(e) => setGap(e.target.value)}
                maxLength={500}
                placeholder={t("ev.gapReason")}
                className="h-8 w-56"
                aria-label={t("ev.gapReason")}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => act("promote", gap ? { evidence_gap_reason: gap } : {})}
              >
                {t("ev.promote")}
              </Button>
            </>
          )}
          {governed &&
            p.status === "proposed" &&
            level !== "observation" &&
            editor &&
            !p.reviewed_at && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => act("review", { note })}
              >
                {t("ev.markReviewed")}
              </Button>
            )}
          {p.status === "proposed" && admin && (
            <>
              {governed && level !== "observation" && (
                <p className="w-full text-[11px] text-muted-foreground">
                  {t("ev.inspect", { n: seen.length })}
                </p>
              )}
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
                placeholder={t("bi.imp.notePh")}
                className="h-8 w-56"
                aria-label={t("bi.imp.decisionNote")}
              />
              {level !== "observation" && (
                <Button
                  size="sm"
                  disabled={busy || gates.length > 0}
                  onClick={() =>
                    act("approve", governed ? { note, seen_evidence: seen } : { note })
                  }
                >
                  {t("bi.imp.approve")}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => act("reject", { note })}
              >
                {t("bi.imp.reject")}
              </Button>
            </>
          )}
          {p.status === "proposed" && !admin && (
            <p className="text-[11px] text-muted-foreground">{t("bi.imp.awaitAdmin")}</p>
          )}
          {p.status === "approved" && (
            <Button size="sm" disabled={busy} onClick={() => act("convert")}>
              {t("bi.imp.convert")}
            </Button>
          )}
          {(p.status === "proposed" || p.status === "approved") && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => act("withdraw")}>
              {t("bi.imp.withdraw")}
            </Button>
          )}
          {p.status === "converted" && (
            <>
              {observed && (
                <p className="w-full text-[11px] text-muted-foreground">
                  {observed.before !== null
                    ? t("bi.imp.observed", {
                        b: observed.before,
                        a: observed.after!,
                        o: t(tk(`bi.outcome.${observed.o}`)),
                      })
                    : t("bi.imp.observedNone")}
                </p>
              )}
              <select
                className={cn(sel, "w-auto")}
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
                aria-label={t("bi.imp.outcome")}
              >
                <option value="">{t("bi.imp.outcome")}</option>
                {["improved", "no_change", "worse", "inconclusive"].map((x) => (
                  <option key={x} value={x}>
                    {t(tk(`bi.outcome.${x}`))}
                  </option>
                ))}
              </select>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={600}
                placeholder={t("bi.imp.outcomeNote")}
                className="h-8 w-56"
                aria-label={t("bi.imp.outcomeNote")}
              />
              <Button
                size="sm"
                disabled={busy || !outcome}
                onClick={() => act("measure", { outcome, note })}
              >
                {t("bi.imp.record")}
              </Button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

const withoutText = ({ text: _text, ...rest }: EvidenceDraft) => rest;
