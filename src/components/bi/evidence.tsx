// Evidence governance on screen (proposal 0073): quality labels with their reasons, the evidence linked to an
// improvement proposal with accept/reject for editors, and adding evidence from a business record or as a statement.
// The database checks every source and refuses what does not qualify; the screen only explains and offers.
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { useI18n } from "@/lib/i18n";
import { can } from "@/lib/permissions";
import { growthDb, type EvidenceItemRow, type ProposalRow } from "@/lib/pending-schema";
import type { Json } from "@/integrations/supabase/types";
import type { BiData } from "@/lib/bi/view";
import { isActual } from "@/lib/performance";
import {
  evidenceQuality,
  fromEvidenceItem,
  type NormalEvidence,
  type Quality,
  type QualityResult,
} from "@/lib/evidence";
import { evidenceFreshness, isStale, sourceState, type Freshness } from "@/lib/evidence-freshness";
import { knownSources } from "@/lib/bi/view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { biKey } from "./bi-data";
import { Badge, sel, tk, useFmt } from "./parts";

const TONE: Record<Quality, string> = {
  strong: "high",
  some: "medium",
  limited: "low",
  hypothesis: "low",
  missing: "none",
};

/** The label plus, on request, the plain reasons behind it. Never a percentage. */
export function QualityBadge({
  q,
  showReasons = false,
}: {
  q: QualityResult | Quality;
  showReasons?: boolean;
}) {
  const { t } = useI18n();
  const r = typeof q === "string" ? null : q;
  const level = typeof q === "string" ? q : q.level;
  const reasons = r?.reasons.map((x) => t(tk(`ev.qr.${x}`))).join(", ") ?? "";
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge kind={TONE[level]}>
        <span title={reasons || undefined}>
          {t("ev.qTitle")}: {t(tk(`ev.q.${level}`))}
        </span>
      </Badge>
      {showReasons && reasons && (
        <span className="text-2xs text-muted-foreground">{t("ev.qBecause", { r: reasons })}</span>
      )}
    </span>
  );
}

export type Linked = EvidenceItemRow & { role: "supports" | "contradicts" };
export function linkedFor(d: BiData, proposalId: string): Linked[] {
  const byId = new Map((d.evidence ?? []).map((e) => [e.id, e]));
  return (d.proposalEvidence ?? [])
    .filter((l) => l.proposal_id === proposalId)
    .map((l) => {
      const e = byId.get(l.evidence_id);
      return e ? { ...e, role: l.role } : null;
    })
    .filter((x): x is Linked => !!x)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}
export const freshnessOf = (e: Linked, d: BiData) =>
  evidenceFreshness({ ...e, source: sourceState(e, knownSources(d)) });
export const normalLinked = (items: readonly Linked[], d: BiData): NormalEvidence[] =>
  items
    .map((e) => fromEvidenceItem(e, e.role, isStale(freshnessOf(e, d).level)))
    .filter((x): x is NormalEvidence => !!x);
export const qualityOfLinked = (items: readonly Linked[], d: BiData) =>
  evidenceQuality(normalLinked(items, d));

const FRESH_TONE: Record<Freshness, string> = {
  current: "high",
  updated: "medium",
  outdated: "low",
  expired: "low",
  unavailable: "low",
  verify: "low",
};
export function FreshnessBadge({ e, d }: { e: Linked; d: BiData }) {
  const { t } = useI18n();
  const r = freshnessOf(e, d);
  return (
    <Badge kind={FRESH_TONE[r.level]}>
      <span title={t("ev.fr.help")}>
        {r.historical && r.level === "current" ? t("ev.fr.historical") : t(tk(`ev.fr.${r.level}`))}
      </span>
    </Badge>
  );
}

export function EvidenceList({
  items,
  canAdd,
  p,
  d,
}: {
  items: Linked[];
  canAdd: boolean;
  p: ProposalRow;
  d: BiData;
}) {
  const { t } = useI18n();
  const f = useFmt();
  const o = useOrg();
  const qc = useQueryClient();
  const editor = can(o.workspaceRole, "evidence.decide");
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  async function decide(id: string, action: "accept" | "reject") {
    setBusy(id);
    const r = await growthDb.rpc("advance_evidence", {
      _evidence: id,
      _action: action,
      _data: {} as Json,
    });
    setBusy(null);
    if (r.error) {
      toast.error(t("bi.failed", { e: r.error.message }));
      return;
    }
    toast.success(
      t("ev.decided", {
        s: t(tk(`ev.status.${action === "accept" ? "accepted" : "rejected"}`)).toLowerCase(),
      }),
    );
    void qc.invalidateQueries({ queryKey: biKey(o.org?.id, o.workspace?.id) });
  }
  return (
    <div className="mt-3 rounded-md border border-border bg-muted/30 p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-2xs font-semibold">{t("ev.panel")}</span>
        {canAdd && !adding && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-2xs"
            onClick={() => setAdding(true)}
          >
            {t("ev.add")}
          </Button>
        )}
      </div>
      {!items.length ? (
        <p className="mt-1 text-2xs text-muted-foreground">{t("ev.none")}</p>
      ) : (
        <ul className="mt-1.5 space-y-1.5" aria-label={t("ev.panel")}>
          {items.map((e) => (
            <li key={e.id} className="min-w-0 rounded border border-border bg-card p-2 text-2xs">
              <div className="flex flex-wrap items-center gap-1">
                {e.evidence_type && (
                  <Badge
                    kind={
                      e.evidence_type === "verified_fact" ||
                      e.evidence_type === "measured_observation"
                        ? "actual"
                        : e.evidence_type === "estimate"
                          ? "estimated"
                          : "none"
                    }
                  >
                    {t(tk(`ev.type.${e.evidence_type}`))}
                  </Badge>
                )}
                {e.role === "contradicts" && <Badge kind="low">{t("ev.contradicts")}</Badge>}
                <Badge
                  kind={
                    e.status === "accepted" || e.status === "used_in_decision"
                      ? "high"
                      : e.status === "rejected"
                        ? "low"
                        : "none"
                  }
                >
                  {t(tk(`ev.status.${e.status}`))}
                </Badge>
                <Badge kind={e.origin === "ai" ? "low" : "none"}>
                  {t(tk(`ev.origin.${e.origin}`))}
                </Badge>
                {e.version_no > 1 && (
                  <Badge kind="none">{t("ev.version", { n: e.version_no })}</Badge>
                )}
                <FreshnessBadge e={e} d={d} />
              </div>
              <p className="mt-1 break-words">{e.description}</p>
              <p className="mt-0.5 text-muted-foreground">
                {t(tk(`ev.src.${e.source_kind}`))}
                {e.period_start && e.period_end
                  ? ` · ${t("ev.period", { a: f.date(e.period_start), b: f.date(e.period_end) })}`
                  : ""}
                {e.reliability ? ` · ${t("ev.rel", { r: t(tk(`ev.rel.${e.reliability}`)) })}` : ""}
                {e.source_ref && !/^[0-9a-f-]{36}$/.test(e.source_ref) ? ` · ${e.source_ref}` : ""}
              </p>
              {editor && (e.status === "classified" || e.status === "reviewed") && (
                <div className="mt-1.5 flex gap-1.5">
                  <Button
                    size="sm"
                    className="h-7 text-2xs"
                    disabled={busy === e.id}
                    onClick={() => decide(e.id, "accept")}
                  >
                    {t("ev.accept")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-2xs"
                    disabled={busy === e.id}
                    onClick={() => decide(e.id, "reject")}
                  >
                    {t("ev.reject")}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding && <AddEvidence p={p} d={d} onDone={() => setAdding(false)} />}
    </div>
  );
}

type RecordOption = { value: string; label: string; payload: Record<string, string> };
function useRecordOptions(d: BiData): RecordOption[] {
  const { t } = useI18n();
  const f = useFmt();
  return useMemo(() => {
    const out: RecordOption[] = [];
    for (const x of d.facts)
      if (x.verified && x.id)
        out.push({
          value: `fact:${x.id}`,
          label: t("ev.rec.fact", { k: x.key, v: x.value.slice(0, 60) }),
          payload: {
            type: "verified_fact",
            source_kind: "business_fact",
            source_ref: x.id,
            description: `${x.key}: ${x.value}`.slice(0, 1000),
          },
        });
    const label = new Map(d.metrics.map((m) => [m.id, m]));
    for (const m of d.measurements.filter((r) => isActual(r.kind)).slice(0, 60)) {
      const def = label.get(m.metric_id);
      if (!def) continue;
      const strong = m.kind === "verified_actual" || m.kind === "imported_actual";
      out.push({
        value: `m:${m.id}`,
        label: t("ev.rec.measurement", {
          m: def.label,
          v: f.num(Number(m.value), def.unit, def.currency),
          a: m.period_start,
          b: m.period_end,
          k: m.kind,
        }),
        payload: {
          type: strong ? "verified_fact" : "measured_observation",
          source_kind: "measurement",
          source_ref: m.id,
          description: `${def.label}: ${Number(m.value)} (${m.period_start} – ${m.period_end})`,
          period_start: m.period_start.slice(0, 10),
          period_end: m.period_end.slice(0, 10),
        },
      });
    }
    for (const r of d.revenue.filter((x) => x.data_class !== "estimated").slice(0, 40)) {
      const day = r.occurred_at.slice(0, 10);
      out.push({
        value: `r:${r.id}`,
        label: t("ev.rec.revenue", {
          kind: r.kind,
          amount: f.money(Number(r.amount), r.currency),
          d: f.date(r.occurred_at),
          cls: r.data_class,
        }),
        payload: {
          type: r.data_class === "imported" ? "verified_fact" : "measured_observation",
          source_kind: "revenue_event",
          source_ref: r.id,
          description: `${r.kind} ${Number(r.amount)} ${r.currency} on ${day} (${r.data_class})`,
          ...(r.data_class === "imported" ? {} : { period_start: day, period_end: day }),
        },
      });
    }
    return out;
  }, [d, t, f]);
}

const STATEMENT_TYPES = ["estimate", "assumption", "hypothesis", "missing_information"] as const;
function AddEvidence({ p, d, onDone }: { p: ProposalRow; d: BiData; onDone: () => void }) {
  const { t } = useI18n();
  const o = useOrg();
  const qc = useQueryClient();
  const options = useRecordOptions(d);
  const [mode, setMode] = useState<"record" | "statement">(options.length ? "record" : "statement");
  const [record, setRecord] = useState("");
  const [type, setType] = useState<(typeof STATEMENT_TYPES)[number]>("estimate");
  const [description, setDescription] = useState("");
  const [sourceRef, setSourceRef] = useState("");
  const [role, setRole] = useState<"supports" | "contradicts">("supports");
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!o.workspace) return;
    const opt = options.find((x) => x.value === record);
    const payload =
      mode === "record"
        ? opt
          ? { ...opt.payload, origin: "user" }
          : null
        : {
            type,
            description,
            source_kind: "user_statement",
            source_ref: sourceRef,
            origin: "user",
          };
    if (!payload) return;
    setBusy(true);
    const r = await growthDb.rpc("record_evidence", {
      _workspace: o.workspace.id,
      _request: key,
      _p: payload as Json,
    });
    const id = (r.data as { evidence_id?: string } | null)?.evidence_id;
    const l =
      !r.error && id
        ? await growthDb.rpc("link_proposal_evidence", {
            _proposal: p.id,
            _evidence: id,
            _role: role,
          })
        : null;
    setBusy(false);
    const err = r.error ?? l?.error;
    if (err) {
      toast.error(t("bi.failed", { e: err.message }));
      return;
    }
    toast.success(t("ev.saved"));
    void qc.invalidateQueries({ queryKey: biKey(o.org?.id, o.workspace?.id) });
    onDone();
  }
  return (
    <form
      onSubmit={submit}
      aria-label={t("ev.addTitle")}
      className="mt-2 space-y-2 rounded border border-border bg-card p-2.5 text-2xs"
    >
      <p className="font-medium">{t("ev.addTitle")}</p>
      <div role="radiogroup" className="flex flex-wrap gap-1">
        {(["record", "statement"] as const).map((m) => (
          <button
            type="button"
            key={m}
            role="radio"
            aria-checked={mode === m}
            onClick={() => setMode(m)}
            className={cn(
              "rounded-md px-2.5 py-1",
              mode === m ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/50",
            )}
          >
            {t(tk(`ev.mode.${m}`))}
          </button>
        ))}
      </div>
      {mode === "record" ? (
        options.length ? (
          <label className="block">
            <span className="mb-1 block font-medium">{t("ev.record")}</span>
            <select
              className={sel}
              value={record}
              onChange={(e) => setRecord(e.target.value)}
              required
            >
              <option value="">{t("ev.recordPh")}</option>
              {options.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-muted-foreground">{t("ev.noRecords")}</p>
        )
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <label>
            <span className="mb-1 block font-medium">{t("ev.type")}</span>
            <select
              className={sel}
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
            >
              {STATEMENT_TYPES.map((x) => (
                <option key={x} value={x}>
                  {t(tk(`ev.type.${x}`))}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block font-medium">{t("ev.sourceRef")}</span>
            <Input
              value={sourceRef}
              onChange={(e) => setSourceRef(e.target.value)}
              maxLength={500}
              className="h-8"
            />
          </label>
          <label className="sm:col-span-2">
            <span className="mb-1 block font-medium">{t("ev.description")} *</span>
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1000}
              required
            />
          </label>
        </div>
      )}
      <label className="block">
        <span className="mb-1 block font-medium">{t("ev.role")}</span>
        <select
          className={sel}
          value={role}
          onChange={(e) => setRole(e.target.value as typeof role)}
        >
          <option value="supports">{t("ev.role.supports")}</option>
          <option value="contradicts">{t("ev.role.contradicts")}</option>
        </select>
      </label>
      <div className="flex gap-2">
        <Button size="sm" type="submit" disabled={busy || (mode === "record" && !record)}>
          {t("ev.save")}
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={onDone}>
          {t("ev.cancel")}
        </Button>
      </div>
    </form>
  );
}
