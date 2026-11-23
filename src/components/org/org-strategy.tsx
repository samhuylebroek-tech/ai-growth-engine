import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { planOrganizationStrategy, recoverOrgStrategy, acceptUncertainAIOutcome } from "@/lib/ai.functions";
import { useI18n } from "@/lib/i18n";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { supabase } from "@/integrations/supabase/client";
import { growthDb, type OrgStrategyRow } from "@/lib/pending-schema";
import { orgStrategyBodySchema } from "@/lib/org/strategy";
import { CREDIT_RULES } from "@/lib/credits";
import { Section, sel, useFmt } from "@/components/bi/parts";
import { Panel, StatusChip } from "@/components/app/status";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { tk, useRefNamer, newKey, useNames, Empty, type OrgModel } from "@/components/org/org-model";
import { EvidenceLabel, EvidenceScopeProvider } from "@/components/ai/evidence";
import { claimScope, orgClaim, SECTION_KIND } from "@/lib/org/claims";

export const INITIATIVE_DRAFT_KEY = (org: string) => `ogo-initiative-draft:${org}`;
export type InitiativeDraft = { title: string; shared: string; businesses: string[]; objectives: Record<string, string>; opportunityId?: string; strategyId?: string };

export function StrategyTab({ m }: { m: OrgModel }) {
  const o = useOrg(); const { t } = useI18n();
  if (m.intel.data && !m.intel.data.installed) return <Empty>{t("ogo.off")}</Empty>;
  return <>
    {can(o.role, "org.strategy") ? <Officer m={m} /> : <Panel><p className="text-sm text-muted-foreground">{t("ogo.officer.adminsOnly")}</p></Panel>}
    <Recovery />
    <Section title={t("ogo.strat.title")} intro={t("ogo.strat.intro")}>
      {m.intel.isLoading ? <Empty>{t("org.loading")}</Empty> : (m.intel.data?.strategies ?? []).length ? <div className="space-y-3">{m.intel.data!.strategies.map((s) => <StrategyCard key={s.id} s={s} />)}</div> : <Empty>{t("ogo.strat.none")}</Empty>}
    </Section>
  </>;
}

function Officer({ m }: { m: OrgModel }) {
  const o = useOrg(); const { t, locale } = useI18n(); const qc = useQueryClient();
  const run = useServerFn(planOrganizationStrategy);
  const [chosen, setChosen] = useState<string[]>(() => m.ids.slice(0, 12));
  const [anchor, setAnchor] = useState<string>(m.ids[0] ?? "");
  const [horizon, setHorizon] = useState(6);
  const [focus, setFocus] = useState("");
  const [requestKey, setRequestKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const anchorOk = chosen.includes(anchor) ? anchor : chosen[0] ?? "";
  const toggle = (id: string) => { setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= 12 ? c : [...c, id])); setRequestKey(newKey()); };
  async function start() {
    if (busy || chosen.length < 2 || !o.org) return; setBusy(true);
    try {
      const r = await run({ data: { orgId: o.org.id, anchorWorkspaceId: anchorOk, businessIds: chosen, requestKey, horizonMonths: horizon, focus, locale } });
      if (!r.ok) { toast.error(r.error); return; }
      toast.success(r.data.structured ? t("ogo.officer.done", { v: String(r.data.version), credits: String(r.data.credits), n: String(r.data.opportunities) }) : t("ogo.officer.doneUnstructured", { v: String(r.data.version), credits: String(r.data.credits) }));
      setRequestKey(newKey());
      await qc.invalidateQueries({ queryKey: ["org-intel", o.org.id] });
    } finally { setBusy(false); await qc.invalidateQueries({ queryKey: ["org-ai-recovery"] }); }
  }
  return <Panel>
    <div className="flex items-start gap-3"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0"><p className="font-medium">{t("ogo.officer.runTitle")}</p><p className="mt-0.5 max-w-3xl text-xs text-muted-foreground">{t("ogo.officer.runIntro")}</p></div></div>
    <fieldset className="mt-4"><legend className="text-xs font-medium">{t("ogo.officer.businesses")}</legend>
      <div className="mt-2 flex flex-wrap gap-2">{m.businesses.map((b) => <label key={b.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
        <input type="checkbox" checked={chosen.includes(b.id)} onChange={() => toggle(b.id)} />{b.name}</label>)}</div>
    </fieldset>
    <div className="mt-3 grid gap-3 sm:grid-cols-3">
      <label className="text-xs"><span className="mb-1 block font-medium">{t("ogo.officer.horizon")}</span>
        <select className={sel} value={horizon} onChange={(e) => { setHorizon(Number(e.target.value)); setRequestKey(newKey()); }}>{[3, 6, 12, 24].map((h) => <option key={h} value={h}>{t("ogo.officer.months", { n: String(h) })}</option>)}</select></label>
      <label className="text-xs sm:col-span-2"><span className="mb-1 block font-medium">{t("ogo.officer.anchor")}</span>
        <select className={sel} value={anchorOk} onChange={(e) => { setAnchor(e.target.value); setRequestKey(newKey()); }}>{m.businesses.filter((b) => chosen.includes(b.id)).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        <span className="mt-1 block text-[11px] text-muted-foreground">{t("ogo.officer.anchorHint")}</span></label>
    </div>
    <label className="mt-3 block text-xs"><span className="mb-1 block font-medium">{t("ogo.officer.focus")}</span>
      <Textarea rows={2} maxLength={1000} value={focus} onChange={(e) => { setFocus(e.target.value); setRequestKey(newKey()); }} placeholder={t("ogo.officer.focusPh")} /></label>
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <Button onClick={start} disabled={busy || chosen.length < 2}>{busy ? t("ogo.officer.running") : t("ogo.officer.run")}</Button>
      <p className="text-xs text-muted-foreground">{chosen.length < 2 ? t("ogo.officer.needTwo") : t("ogo.officer.cost", { n: String(CREDIT_RULES.reserveOrganization) })}</p>
    </div>
    <p className="mt-3 text-[11px] text-muted-foreground">{t("ogo.officer.limits")}</p>
  </Panel>;
}

function Recovery() {
  const o = useOrg(); const { t } = useI18n(); const qc = useQueryClient(); const f = useFmt();
  const recover = useServerFn(recoverOrgStrategy); const accept = useServerFn(acceptUncertainAIOutcome);
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["org-ai-recovery", o.org?.id, o.userId], enabled: !!o.org, queryFn: async () => {
    const r = await supabase.from("single_ai_requests").select("id,status,created_at,workspace_id").eq("org_id", o.org!.id).eq("user_id", o.userId).eq("kind", "organization").eq("status", "running").limit(10);
    if (r.error) throw r.error; return r.data ?? [];
  } });
  const [uncertain, setUncertain] = useState<{ id: string; ws: string } | null>(null);
  if (!q.data?.length) return null;
  async function go(id: string, ws: string) {
    if (busy || !o.org) return; setBusy(id);
    try {
      const r = await recover({ data: { orgId: o.org.id, requestId: id } });
      if (!r.ok) { toast.error(r.error); return; }
      if (r.data.status === "uncertain") { setUncertain({ id, ws }); return; }
      toast.success(t(tk(`ogo.recover.${r.data.status}`)));
      await Promise.all([qc.invalidateQueries({ queryKey: ["org-ai-recovery"] }), qc.invalidateQueries({ queryKey: ["org-intel", o.org.id] })]);
    } finally { setBusy(null); }
  }
  async function close() {
    if (!uncertain || !o.org) return; setBusy(uncertain.id);
    try {
      const r = await accept({ data: { orgId: o.org.id, workspaceId: uncertain.ws, requestId: uncertain.id } });
      if (!r.ok) { toast.error(r.error); return; }
      toast.success(t("recovery.accepted", { credits: String(r.data.credits) })); setUncertain(null);
      await qc.invalidateQueries({ queryKey: ["org-ai-recovery"] });
    } finally { setBusy(null); }
  }
  return <Section title={t("ogo.recover.title")} intro={t("ogo.recover.intro")}>
    <ul className="divide-y divide-border border-y border-border">{q.data.map((r) => <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
      <span>{t("ogo.recover.item", { date: f.date(r.created_at) })}</span>
      <Button size="sm" variant="outline" disabled={!!busy} onClick={() => go(r.id, r.workspace_id)}>{busy === r.id ? t("recovery.busy") : t("recovery.recover")}</Button>
    </li>)}</ul>
    {uncertain && <Panel className="mt-3"><p className="text-sm font-medium">{t("recovery.uncertain.title")}</p><p className="mt-1 text-xs text-muted-foreground">{t("recovery.uncertain.body")}</p>
      <div className="mt-3 flex gap-2"><Button size="sm" onClick={close} disabled={!!busy}>{t("recovery.uncertain.accept")}</Button><Button size="sm" variant="ghost" onClick={() => setUncertain(null)}>{t("recovery.uncertain.later")}</Button></div></Panel>}
  </Section>;
}

function StrategyCard({ s }: { s: OrgStrategyRow }) {
  const o = useOrg(); const { t } = useI18n(); const f = useFmt(); const qc = useQueryClient(); const name = useNames(); const navigate = useNavigate();
  const [openBody, setOpenBody] = useState(s.status === "draft" || s.status === "approved");
  const [note, setNote] = useState(""); const [busy, setBusy] = useState(false);
  const { named, reconstructed } = useRefNamer()(s.body, s.business_ids);
  // Stored text keeps the model's B1/B2 references; names are filled in here, so renames and every language show current names.
  const parsed = orgStrategyBodySchema.safeParse(s.body); const b = parsed.success ? named(parsed.data) : null;
  const unstructured = !!(s.body && typeof s.body === "object" && (s.body as Record<string, unknown>)["unstructured"]);
  const admin = can(o.role, "org.strategy");
  async function decide(d: "approve" | "reject" | "retire") {
    if (busy) return; setBusy(true);
    try {
      const r = await growthDb.rpc("decide_org_strategy", { _id: s.id, _decision: d, _note: note });
      if (r.error) { toast.error(r.error.message); return; }
      toast.success(t(tk(`ogo.strat.decided.${d}`))); setNote("");
      await qc.invalidateQueries({ queryKey: ["org-intel"] }); await qc.invalidateQueries({ queryKey: ["org-decisions"] });
    } finally { setBusy(false); }
  }
  function prepare(i: NonNullable<typeof b>["initiatives"][number]) {
    if (!o.org) return;
    const draft: InitiativeDraft = { title: i.title, shared: i.shared_objective, businesses: i.businesses, objectives: Object.fromEntries(i.business_objectives.map((x) => [x.business_id, x.objective])), strategyId: s.id };
    sessionStorage.setItem(INITIATIVE_DRAFT_KEY(o.org.id), JSON.stringify(draft));
    void navigate({ to: "/app/organization", search: { tab: "initiatives" } });
  }
  return <EvidenceScopeProvider value={{ orgId: s.org_id, workspaceId: null, asOf: s.created_at }}><Panel>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0"><p className="text-xs text-muted-foreground">{t("ogo.strat.meta", { v: String(s.version), date: f.date(s.created_at), months: String(s.horizon_months), n: String(s.business_ids.length) })}</p>
        <p className="mt-1 font-medium">{named(s.title)}</p></div>
      <StatusChip status={s.status}>{t(tk(`ogo.strat.status.${s.status}`))}</StatusChip>
    </div>
    <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{named(s.summary)}</p>
    {reconstructed && /\bB\d{1,2}\b/.test(JSON.stringify(s.body ?? "") + s.summary) && <p className="mt-1 text-[11px] text-muted-foreground">{t("ogo.strat.namesReconstructed")}</p>}
    <p className="mt-2 text-xs text-muted-foreground">{t("ogo.strat.covers", { names: s.business_ids.map(name).join(" · ") })}</p>
    {unstructured && <p className="mt-2 text-xs text-warning">{t("ogo.strat.unstructured")}</p>}
    {b && !unstructured && <Button size="sm" variant="ghost" className="mt-2 px-0" onClick={() => setOpenBody((x) => !x)}>{openBody ? t("ogo.strat.hide") : t("ogo.strat.show")}</Button>}
    {b && !unstructured && openBody && <div className="mt-2 grid gap-4 text-sm md:grid-cols-2">
      {b.objectives.length > 0 && <Block title={t("ogo.strat.objectives")}>{b.objectives.map((x, i) => { const c = orgClaim(x.basis, "ai", `${x.objective} ${x.kpi} ${x.target}`); return <li key={i}><EvidenceLabel kind={c.kind} downgraded={c.downgraded} text={`${x.objective} (${x.kpi}${x.target ? ` → ${x.target}` : ""})`} />{x.objective}{x.kpi && <span className="text-muted-foreground"> · {x.kpi}{x.target ? ` → ${x.target}` : ""}</span>} <Scope ids={[]} /></li>; })}</Block>}
      {b.business_priorities.length > 0 && <Block title={t("ogo.strat.priorities")}>{[...b.business_priorities].sort((x, y) => x.priority - y.priority).map((x, i) => <li key={i}><EvidenceLabel kind={SECTION_KIND.priorities} text={`${x.focus} ${x.rationale}`} /><span className="font-medium">{name(x.business_id)}</span> ({t(tk(`ogo.prio.${x.priority}`))}): {x.focus} <Scope ids={[x.business_id]} />{x.rationale && <span className="block text-xs text-muted-foreground">{x.rationale}</span>}</li>)}</Block>}
      {b.collaboration.length > 0 && <Block title={t("ogo.strat.collaboration")}>{b.collaboration.map((x, i) => <li key={i}><EvidenceLabel kind={SECTION_KIND.collaboration} text={x} />{x}</li>)}</Block>}
      {b.resource_recommendations.length > 0 && <Block title={t("ogo.strat.resources")}>{b.resource_recommendations.map((x, i) => <li key={i}><EvidenceLabel kind={SECTION_KIND.resources} text={`${x.recommendation} ${x.reason}`} /><Scope ids={x.businesses} /> <span className="text-xs text-muted-foreground">{t(tk(`ogo.resType.${x.type}`))} · {x.businesses.map(name).join(" · ")}</span><br />{x.recommendation}{x.reason && <span className="block text-xs text-muted-foreground">{x.reason}</span>}</li>)}</Block>}
      {b.specialist_needs.length > 0 && <Block title={t("ogo.strat.specialists")}>{b.specialist_needs.map((x, i) => <li key={i}><EvidenceLabel kind={SECTION_KIND.specialists} text={x.reason} /><span className="font-medium">{x.specialist}</span> · {x.businesses.map(name).join(" · ")}{x.reason && <span className="block text-xs text-muted-foreground">{x.reason}</span>}</li>)}</Block>}
      {b.initiatives.length > 0 && <Block title={t("ogo.strat.initiatives")}>{b.initiatives.map((x, i) => <li key={i}><EvidenceLabel kind={SECTION_KIND.initiatives} text={`${x.title}: ${x.shared_objective}`} /><span className="font-medium">{x.title}</span> · {x.businesses.map(name).join(" · ")}<span className="block text-xs text-muted-foreground">{x.shared_objective}</span>
        {can(o.role, "org.coordinate") && x.businesses.every((id) => o.workspaces.some((w) => w.id === id)) && <Button size="sm" variant="link" className="h-auto px-0 text-xs" onClick={() => prepare(x)}>{t("ogo.strat.prepare")}</Button>}</li>)}</Block>}
      {b.risks.length > 0 && <Block title={t("ogo.strat.risks")}>{b.risks.map((x, i) => <li key={i}><EvidenceLabel kind={SECTION_KIND.risks} text={`${x.risk} ${x.mitigation}`} />{x.risk}{x.businesses.length > 0 && <span className="text-xs text-muted-foreground"> · {x.businesses.map(name).join(" · ")}</span>}{x.mitigation && <span className="block text-xs text-muted-foreground">{t("ogo.strat.mitigation", { m: x.mitigation })}</span>}</li>)}</Block>}
      {b.kpis.length > 0 && <Block title={t("ogo.strat.kpis")}>{b.kpis.map((x, i) => <li key={i}><EvidenceLabel kind={SECTION_KIND.kpis} text={`${x.name} → ${x.target}`} />{x.name}{x.target && ` → ${x.target}`}{x.business_id && <span className="text-xs text-muted-foreground"> · {name(x.business_id)}</span>} <Scope ids={[x.business_id]} /></li>)}</Block>}
      {b.data_gaps.length > 0 && <Block title={t("ogo.strat.gaps")}>{b.data_gaps.map((x, i) => <li key={i}><EvidenceLabel kind={SECTION_KIND.gaps} text={x} />{x}</li>)}</Block>}
    </div>}
    {s.decided_at && <p className="mt-3 text-xs text-muted-foreground">{t("ogo.strat.decidedOn", { date: f.date(s.decided_at) })}{s.decision_note && ` · ${s.decision_note}`}</p>}
    {admin && (s.status === "draft" || s.status === "approved") && <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
      <input aria-label={t("ogo.note")} className={`${sel} w-full sm:w-64`} maxLength={1000} placeholder={t("ogo.notePh")} value={note} onChange={(e) => setNote(e.target.value)} />
      {s.status === "draft" && <><Button size="sm" onClick={() => decide("approve")} disabled={busy}>{t("ogo.strat.approve")}</Button><Button size="sm" variant="outline" onClick={() => decide("reject")} disabled={busy}>{t("ogo.strat.reject")}</Button></>}
      {s.status === "approved" && <Button size="sm" variant="outline" onClick={() => decide("retire")} disabled={busy}>{t("ogo.strat.retire")}</Button>}
      <p className="w-full text-[11px] text-muted-foreground">{t("ogo.strat.approveNote")}</p>
    </div>}
  </Panel></EvidenceScopeProvider>;
}
function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="min-w-0"><p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p><ul className="space-y-1.5">{children}</ul></div>;
}

/** Business-level or organization-level, so business facts never read as organization results. */
function Scope({ ids }: { ids: readonly (string | null | undefined)[] }) {
  const { t } = useI18n();
  return <span className="whitespace-nowrap rounded border border-border px-1 py-px text-[10px] text-muted-foreground">{t(claimScope(ids) === "business" ? "evd.scope.business" : "evd.scope.organization")}</span>;
}
