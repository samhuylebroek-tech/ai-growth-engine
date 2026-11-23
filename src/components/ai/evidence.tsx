// One evidence interaction for every labelled AI statement: the label is a button that opens what the statement rests
// on — records it cites (read now, under the viewer's own permissions), what the answer itself states about source,
// formula, period, basis and uncertainty, and a plain support verdict from src/lib/evidence-refs.ts. Nothing is
// invented: an uncited statement says so, and a stored confidence is shown only when someone recorded it.
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { growthDb } from "@/lib/pending-schema";
import { readFactPages } from "@/lib/facts-read";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { useOrg } from "@/lib/org-context";
import { statedEvidence, type ClaimKind } from "@/lib/claims";
import { resolveRefs, support, type EvidenceRecord, type ResolvedRef } from "@/lib/evidence-refs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { QUESTIONS } from "@/lib/onboarding/questions";

/** Where cited records are looked up; workspaceId null = every business of the organization the viewer may read. */
export type EvidenceScope = { orgId: string; workspaceId: string | null; asOf?: string | null };
const ScopeCtx = createContext<EvidenceScope | null>(null);
export function EvidenceScopeProvider({ value, children }: { value: EvidenceScope; children: ReactNode }) {
  return <ScopeCtx.Provider value={value}>{children}</ScopeCtx.Provider>;
}
function useScope(): EvidenceScope | null {
  const explicit = useContext(ScopeCtx);
  const o = useOrg();
  if (explicit) return explicit;
  return o.org && o.workspace ? { orgId: o.org.id, workspaceId: o.workspace.id } : null;
}

/** Records a statement can cite, read once per scope when the first evidence panel opens. */
export function useEvidenceRecords(scope: EvidenceScope | null, enabled: boolean) {
  return useQuery({
    queryKey: ["evidence-records", scope?.orgId, scope?.workspaceId ?? "org"],
    enabled: enabled && !!scope,
    staleTime: 60_000,
    queryFn: async (): Promise<{ records: EvidenceRecord[]; complete: boolean }> => {
      const org = scope!.orgId, ws = scope!.workspaceId;
      const sc = <Q extends { eq: (c: string, v: string) => Q }>(q: Q) => (ws ? q.eq("org_id", org).eq("workspace_id", ws) : q.eq("org_id", org));
      const facts = await readFactPages<{ id: string; key: string; value: string; source_type: string; verified: boolean; confidence: number | null; created_at: string }>((cursor, size) => {
        let q = sc(supabase.from("business_facts").select("id,key,value,source_type,verified,confidence,created_at")).order("id").limit(size);
        if (cursor) q = q.gt("id", cursor);
        return q;
      });
      const [goals, inits, camps, metrics] = await Promise.all([
        sc(supabase.from("growth_goals").select("id,title,metric,baseline,target,status,created_at,updated_at")).limit(500),
        sc(growthDb.from("growth_initiatives").select("id,title,channel,status,created_at")).limit(1000),
        sc(supabase.from("campaigns").select("id,title,status,start_date,end_date,created_at,updated_at")).limit(1000),
        sc(growthDb.from("metric_definitions").select("id,label,unit,created_at,updated_at")).limit(1000),
      ]);
      for (const r of [goals, inits, camps, metrics]) if (r.error) throw r.error;
      const records: EvidenceRecord[] = [
        ...facts.rows.map((f) => ({ type: "fact" as const, id: f.id, title: f.key, detail: f.value, source: f.source_type, verified: f.verified, confidence: f.confidence, date: f.created_at })),
        ...(goals.data ?? []).map((g) => ({ type: "goal" as const, id: g.id, title: g.title, detail: [g.metric, g.baseline != null || g.target != null ? `${g.baseline ?? "?"} → ${g.target ?? "?"}` : ""].filter(Boolean).join(": "), date: g.created_at, updatedAt: g.updated_at })),
        ...((inits.data ?? []) as { id: string; title: string; channel: string; status: string; created_at: string }[]).map((i) => ({ type: "initiative" as const, id: i.id, title: i.title, detail: i.channel, date: i.created_at })),
        ...(camps.data ?? []).map((c) => ({ type: "campaign" as const, id: c.id, title: c.title, detail: [c.start_date, c.end_date].filter(Boolean).join(" – "), date: c.created_at, updatedAt: c.updated_at })),
        ...((metrics.data ?? []) as { id: string; label: string; unit: string; created_at: string; updated_at: string }[]).map((m) => ({ type: "metric" as const, id: m.id, title: m.label, detail: m.unit, date: m.created_at, updatedAt: m.updated_at })),
      ];
      return { records, complete: facts.complete };
    },
  });
}

export const CLAIM_TONE: Record<ClaimKind, string> = {
  fact: "border-success/30 bg-success/10 text-success",
  calc: "border-primary/30 bg-primary/10 text-primary",
  estimate: "border-warning/30 bg-warning/10 text-warning",
  hypothesis: "border-warning/30 bg-warning/10 text-warning",
  recommendation: "border-border bg-secondary text-secondary-foreground",
  missing: "border-destructive/30 bg-destructive/10 text-destructive",
};
const LABEL = "mr-1 inline-flex items-center whitespace-nowrap rounded-full border px-1.5 py-px align-baseline text-[10px] font-medium not-italic";

function RecordLink({ r }: { r: EvidenceRecord }) {
  const { t } = useI18n();
  const cls = "inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline";
  const label = <>{t("evd.openRecord")}<ExternalLink className="h-3 w-3" aria-hidden /></>;
  if (r.type === "metric") return <Link className={cls} to="/app/performance/$metricId" params={{ metricId: r.id }}>{label}</Link>;
  const to = r.type === "fact" ? "/app/profile" : r.type === "campaign" ? "/app/campaigns" : "/app/goals";
  return <Link className={cls} to={to}>{label}</Link>;
}

function RefRow({ x }: { x: ResolvedRef }) {
  const { t, locale } = useI18n();
  const date = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(locale) : "");
  if (x.status !== "found" || !x.record) return <li className="text-xs text-muted-foreground">{t(x.status === "ambiguous" ? "evd.ambiguous" : "evd.notFound", { code: x.ref.code })}</li>;
  const r = x.record;
  // Onboarding answers are stored under stable English keys; show the question as the viewer reads it.
  const question = r.type === "fact" ? QUESTIONS.find((qq) => qq.key === r.title) : undefined;
  const title = question ? t(`ob.q.${question.id}.label` as MessageKey) : r.title;
  return (
    <li className="rounded-md border border-border p-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{t(`evd.type.${r.type}` as MessageKey)} <span className="font-mono normal-case">{x.ref.code}</span></p>
      <p className="mt-0.5 text-sm font-medium break-words">{title}</p>
      {r.detail && <p className="text-xs break-words text-muted-foreground">{r.detail}</p>}
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        {r.type === "fact" && <li className={r.verified ? "text-success" : "text-warning"}>{t(r.verified ? "evd.confirmed" : "evd.unconfirmed")}</li>}
        {r.source && <li>{t("evd.source", { s: t(`account.profile.source.${r.source}` as MessageKey) })}</li>}
        {r.confidence != null && <li>{t("evd.recordedConfidence", { n: Math.round(r.confidence <= 1 ? r.confidence * 100 : r.confidence) })}</li>}
        {r.date && <li>{t("evd.recorded", { date: date(r.date) })}</li>}
        {r.updatedAt && r.updatedAt !== r.date && <li>{t("evd.updated", { date: date(r.updatedAt) })}</li>}
        {x.changedAfter && <li className="font-medium text-warning">{t("evd.changed")}</li>}
      </ul>
      <div className="mt-1"><RecordLink r={r} /></div>
    </li>
  );
}

function EvidenceBody({ kind, downgraded, text }: { kind: ClaimKind; downgraded: boolean; text: string }) {
  const { t } = useI18n();
  const scope = useScope();
  const stated = useMemo(() => statedEvidence(text), [text]);
  const q = useEvidenceRecords(scope, stated.refs.length > 0);
  const resolved = q.data ? resolveRefs(stated.refs, q.data.records, scope?.asOf) : [];
  const verdict = stated.refs.length && !q.data ? null : support(kind, resolved, stated);
  const fields = (["source", "formula", "period", "basis", "uncertainty"] as const).filter((f) => stated[f]);
  return (
    <div className="space-y-3 text-sm">
      <div>
        <span className={cn(LABEL, CLAIM_TONE[kind])}>{t(`cl.${kind}` as MessageKey)}</span>
        <p className="mt-1 text-xs text-muted-foreground">{t(`cl.d.${kind}` as MessageKey)}</p>
        {downgraded && <p className="mt-1 text-xs text-warning">{t("cl.downgraded")}</p>}
      </div>
      {verdict && <p className="rounded-md bg-muted p-2 text-xs" role="status">{t(`evd.s.${verdict}` as MessageKey)}</p>}
      {stated.refs.length > 0 && (
        <section aria-label={t("evd.records")}>
          <h3 className="text-xs font-semibold">{t("evd.records")}</h3>
          {q.isLoading && <p className="mt-1 text-xs text-muted-foreground" role="status">{t("evd.loading")}</p>}
          {q.isError && <p className="mt-1 text-xs text-destructive" role="alert">{t("evd.loadError")}</p>}
          {q.data && <ul className="mt-1 space-y-1.5">{resolved.map((x) => <RefRow key={x.ref.code} x={x} />)}</ul>}
          {q.data && !q.data.complete && <p className="mt-1 text-[11px] text-muted-foreground">{t("evd.incomplete")}</p>}
        </section>
      )}
      {fields.length > 0 && (
        <section aria-label={t("evd.stated")}>
          <h3 className="text-xs font-semibold">{t("evd.stated")}</h3>
          <dl className="mt-1 space-y-1 text-xs">
            {fields.map((f) => <div key={f} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2"><dt className="text-muted-foreground">{t(`evd.f.${f}` as MessageKey)}</dt><dd className="break-words">{stated[f]}</dd></div>)}
          </dl>
        </section>
      )}
    </div>
  );
}

/** The label of one AI statement; opens its evidence. Works with mouse, touch and keyboard. */
export function EvidenceLabel({ kind, downgraded = false, text }: { kind: ClaimKind; downgraded?: boolean; text: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const name = t(`cl.${kind}` as MessageKey);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={t("evd.openFor", { label: name })} className={cn(LABEL, CLAIM_TONE[kind], "cursor-pointer underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>
          {name}{downgraded ? " ?" : ""}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] max-h-[70vh] overflow-y-auto">
        {open && <EvidenceBody kind={kind} downgraded={downgraded} text={text} />}
      </PopoverContent>
    </Popover>
  );
}
