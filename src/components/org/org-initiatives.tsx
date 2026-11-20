import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { TASK_SPECIALISTS } from "@/lib/task-execution";
import { REPORTING_CURRENCIES } from "@/lib/org/consolidation";
import { growthDb, type OrgCommitmentRow, type OrgInitiativeRow } from "@/lib/pending-schema";
import { Section, sel, useFmt } from "@/components/bi/parts";
import { Panel, StatusChip } from "@/components/app/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { tk, newKey, useNames, Empty, type OrgModel } from "@/components/org/org-model";
import { INITIATIVE_DRAFT_KEY, type InitiativeDraft } from "@/components/org/org-strategy";
import { parseMetricLines, parseTaskLines } from "@/lib/org/initiative-input";

type Part = { on: boolean; objective: string; budget: string; currency: string; tasks: string };
export function InitiativesTab({ m }: { m: OrgModel }) {
  const o = useOrg(); const { t } = useI18n();
  if (m.intel.data && !m.intel.data.installed) return <Empty>{t("ogo.off")}</Empty>;
  const list = m.intel.data?.initiatives ?? [];
  return <>
    <p className="mb-4 max-w-3xl text-xs text-muted-foreground">{t("ogo.ini.rule")}</p>
    {can(o.role, "org.coordinate") && m.businesses.length >= 2 && <NewInitiative m={m} />}
    <Section title={t("ogo.ini.title")} intro={t("ogo.ini.intro")}>
      {list.length ? <div className="space-y-3">{list.map((i) => <InitiativeCard key={i.id} i={i} commitments={(m.intel.data?.commitments ?? []).filter((c) => c.initiative_id === i.id)} m={m} />)}</div> : <Empty>{t("ogo.ini.none")}</Empty>}
    </Section>
  </>;
}

function NewInitiative({ m }: { m: OrgModel }) {
  const o = useOrg(); const { t } = useI18n(); const qc = useQueryClient();
  const cur = (id: string) => m.model?.view.profiles.get(id)?.reportingCurrency ?? "EUR";
  const blank = () => Object.fromEntries(m.businesses.map((b) => [b.id, { on: false, objective: "", budget: "", currency: cur(b.id), tasks: "" }])) as Record<string, Part>;
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(""); const [shared, setShared] = useState(""); const [metrics, setMetrics] = useState("");
  const [specs, setSpecs] = useState<string[]>([]); const [ownMe, setOwnMe] = useState(true);
  const [parts, setParts] = useState<Record<string, Part>>(blank);
  const [links, setLinks] = useState<{ opportunityId?: string; strategyId?: string }>({});
  const [requestKey, setRequestKey] = useState(newKey); const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!o.org) return;
    const raw = sessionStorage.getItem(INITIATIVE_DRAFT_KEY(o.org.id)); if (!raw) return;
    sessionStorage.removeItem(INITIATIVE_DRAFT_KEY(o.org.id));
    try {
      const d = JSON.parse(raw) as InitiativeDraft;
      setTitle(d.title.slice(0, 200)); setShared(d.shared.slice(0, 2000)); setLinks({ ...(d.opportunityId ? { opportunityId: d.opportunityId } : {}), ...(d.strategyId ? { strategyId: d.strategyId } : {}) });
      setParts((p) => { const n = { ...p }; for (const id of d.businesses) if (n[id]) n[id] = { ...n[id]!, on: true, objective: d.objectives[id] ?? "" }; return n; });
      setOpen(true); setRequestKey(newKey());
    } catch { /* an unreadable draft is ignored */ }
  }, [o.org]);
  const set = (id: string, p: Partial<Part>) => setParts((x) => ({ ...x, [id]: { ...x[id]!, ...p } }));
  const chosen = m.businesses.filter((b) => parts[b.id]?.on);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (busy || !o.org) return;
    if (chosen.length < 2) { toast.error(t("ogo.ini.needTwo")); return; }
    if (chosen.some((b) => !parts[b.id]!.objective.trim())) { toast.error(t("ogo.ini.needObjective")); return; }
    setBusy(true);
    try {
      const r = await growthDb.rpc("propose_org_initiative", { _org: o.org.id, _request: requestKey, _p: {
        title, shared_objective: shared, success_metrics: parseMetricLines(metrics), required_specialists: specs, owner_id: ownMe ? o.userId : null,
        opportunity_id: links.opportunityId ?? null, strategy_id: links.strategyId ?? null,
        commitments: chosen.map((b) => ({ workspace_id: b.id, business_objective: parts[b.id]!.objective, budget_amount: Number(parts[b.id]!.budget || 0), currency: parts[b.id]!.currency, tasks: parseTaskLines(parts[b.id]!.tasks) })),
      } });
      if (r.error) { toast.error(r.error.message); return; }
      toast.success(t("ogo.ini.proposed")); setOpen(false); setTitle(""); setShared(""); setMetrics(""); setSpecs([]); setParts(blank()); setLinks({}); setRequestKey(newKey());
      await qc.invalidateQueries({ queryKey: ["org-intel", o.org.id] }); await qc.invalidateQueries({ queryKey: ["org-decisions"] });
    } finally { setBusy(false); }
  }
  if (!open) return <Button className="mb-2" onClick={() => setOpen(true)}>{t("ogo.ini.new")}</Button>;
  return <Panel className="mb-4"><form onSubmit={submit} aria-label={t("ogo.ini.new")} className="space-y-3">
    <p className="font-medium">{t("ogo.ini.new")}</p>
    {links.opportunityId && <p className="text-xs text-muted-foreground">{t("ogo.ini.fromOpp")}</p>}
    <label className="block text-xs"><span className="mb-1 block font-medium">{t("ogo.ini.f.title")}</span><Input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
    <label className="block text-xs"><span className="mb-1 block font-medium">{t("ogo.ini.f.shared")}</span><Textarea required rows={2} maxLength={2000} value={shared} onChange={(e) => setShared(e.target.value)} /></label>
    <label className="block text-xs"><span className="mb-1 block font-medium">{t("ogo.ini.f.metrics")}</span><Textarea rows={2} value={metrics} onChange={(e) => setMetrics(e.target.value)} placeholder={t("ogo.ini.f.metricsPh")} /></label>
    <fieldset><legend className="text-xs font-medium">{t("ogo.ini.f.specialists")}</legend><div className="mt-1 flex flex-wrap gap-2">{Object.keys(TASK_SPECIALISTS).map((s) => <label key={s} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs"><input type="checkbox" checked={specs.includes(s)} onChange={() => setSpecs((x) => x.includes(s) ? x.filter((y) => y !== s) : x.length >= 10 ? x : [...x, s])} />{t(tk(`run.sp.${s}`))}</label>)}</div></fieldset>
    <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={ownMe} onChange={(e) => setOwnMe(e.target.checked)} />{t("ogo.ini.f.ownMe")}</label>
    <fieldset className="space-y-2"><legend className="text-xs font-medium">{t("ogo.ini.f.businesses")}</legend>
      {m.businesses.map((b) => { const p = parts[b.id]!; return <div key={b.id} className="rounded-md border border-border p-3">
        <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={p.on} onChange={(e) => set(b.id, { on: e.target.checked })} />{b.name}</label>
        {p.on && <div className="mt-2 grid gap-2 sm:grid-cols-4">
          <label className="text-xs sm:col-span-4"><span className="mb-1 block">{t("ogo.ini.f.objective")}</span><Input maxLength={1000} value={p.objective} onChange={(e) => set(b.id, { objective: e.target.value })} /></label>
          <label className="text-xs sm:col-span-2"><span className="mb-1 block">{t("ogo.ini.f.budget")}</span><Input type="number" min={0} step="0.01" value={p.budget} onChange={(e) => set(b.id, { budget: e.target.value })} /></label>
          <label className="text-xs sm:col-span-2"><span className="mb-1 block">{t("ogo.ini.f.currency")}</span><select className={sel} value={p.currency} onChange={(e) => set(b.id, { currency: e.target.value })}>{REPORTING_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          <label className="text-xs sm:col-span-4"><span className="mb-1 block">{t("ogo.ini.f.tasks")}</span><Textarea rows={3} value={p.tasks} onChange={(e) => set(b.id, { tasks: e.target.value })} placeholder={t("ogo.ini.f.tasksPh")} /></label>
        </div>}
      </div>; })}
    </fieldset>
    <p className="text-[11px] text-muted-foreground">{t("ogo.ini.f.note")}</p>
    <div className="flex gap-2"><Button type="submit" disabled={busy}>{t("ogo.ini.submit")}</Button><Button type="button" variant="ghost" onClick={() => setOpen(false)}>{t("ogo.cancel")}</Button></div>
  </form></Panel>;
}

const NEXT: Record<string, ("active" | "completed" | "cancelled")[]> = { awaiting_commitments: ["cancelled"], committed: ["active", "cancelled"], active: ["completed", "cancelled"] };
function InitiativeCard({ i, commitments, m }: { i: OrgInitiativeRow; commitments: OrgCommitmentRow[]; m: OrgModel }) {
  const o = useOrg(); const { t } = useI18n(); const qc = useQueryClient(); const name = useNames(); const f = useFmt(); const navigate = useNavigate();
  const [busy, setBusy] = useState(false); const [note, setNote] = useState("");
  const hidden = i.business_ids.filter((id) => !o.workspaces.some((w) => w.id === id)).length;
  const metrics = Array.isArray(i.success_metrics) ? (i.success_metrics as { metric?: string; target?: string }[]) : [];
  const editable = can(o.role, "org.coordinate") && i.business_ids.every((id) => m.rights.data?.[id]?.member);
  async function decide(c: OrgCommitmentRow, approve: boolean) {
    if (busy) return; setBusy(true);
    try {
      const r = await growthDb.rpc("decide_org_commitment", { _id: c.id, _approve: approve, _note: note });
      if (r.error) { toast.error(r.error.message); return; }
      toast.success(approve ? t("ogo.ini.approved", { name: name(c.workspace_id) }) : t("ogo.ini.declined")); setNote("");
      await qc.invalidateQueries({ queryKey: ["org-intel"] }); await qc.invalidateQueries({ queryKey: ["org-decisions"] }); await qc.invalidateQueries({ queryKey: ["org-overview"] });
    } finally { setBusy(false); }
  }
  async function move(s: string) {
    if (busy) return; setBusy(true);
    try {
      const r = await growthDb.rpc("set_org_initiative_status", { _id: i.id, _status: s });
      if (r.error) { toast.error(r.error.message); return; }
      await qc.invalidateQueries({ queryKey: ["org-intel"] }); await qc.invalidateQueries({ queryKey: ["org-decisions"] });
    } finally { setBusy(false); }
  }
  const openProject = (c: OrgCommitmentRow) => { if (!c.project_id) return; o.setWorkspaceId(c.workspace_id); void navigate({ to: "/app/projects", search: { item: c.project_id } }); };
  return <Panel>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0"><p className="font-medium">{i.title}</p><p className="mt-0.5 text-xs text-muted-foreground">{t("ogo.ini.meta", { date: f.date(i.created_at), names: i.business_ids.filter((id) => o.workspaces.some((w) => w.id === id)).map(name).join(" · ") })}{hidden > 0 && ` · ${t("ogo.ini.hidden", { n: String(hidden) })}`}</p></div>
      <StatusChip status={i.status}>{t(tk(`ogo.iniStatus.${i.status}`))}</StatusChip>
    </div>
    <p className="mt-2 text-sm">{i.shared_objective}</p>
    {metrics.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{t("ogo.ini.metrics")}: {metrics.map((x) => `${x.metric ?? ""}${x.target ? ` → ${x.target}` : ""}`).join(" · ")}</p>}
    {i.required_specialists.length > 0 && <p className="mt-1 text-xs text-muted-foreground">{t("ogo.ini.specialists")}: {i.required_specialists.map((s) => t(tk(`run.sp.${s}`))).join(", ")}</p>}
    <ul className="mt-3 divide-y divide-border border-y border-border">{commitments.map((c) => { const tasks = Array.isArray(c.tasks) ? (c.tasks as { title?: string; due_date?: string }[]) : []; const admin = !!m.rights.data?.[c.workspace_id]?.admin;
      return <li key={c.id} className="py-2 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{name(c.workspace_id)}</span><StatusChip status={c.status}>{t(tk(`ogo.comStatus.${c.status}`))}</StatusChip></div>
        <p className="mt-0.5">{c.business_objective}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("ogo.ini.budget", { v: Number(c.budget_amount) > 0 ? f.money(Number(c.budget_amount), c.currency) : t("ogo.ini.noBudget") })} · {t("ogo.ini.tasks", { n: String(tasks.length) })}{tasks.length > 0 && `: ${tasks.map((x) => x.title).join(", ")}`}</p>
        {c.decision_note && <p className="mt-0.5 text-xs text-muted-foreground">{t("ogo.lastNote", { note: c.decision_note })}</p>}
        {c.status === "approved" && c.project_id && <Button size="sm" variant="link" className="h-auto px-0 text-xs" onClick={() => openProject(c)}>{t("ogo.ini.openProject")}</Button>}
        {c.status === "pending" && i.status === "awaiting_commitments" && (admin ? <div className="mt-2 flex flex-wrap items-center gap-2">
          <input aria-label={t("ogo.note")} className={`${sel} w-full sm:w-56`} maxLength={1000} placeholder={t("ogo.notePh")} value={note} onChange={(e) => setNote(e.target.value)} />
          <Button size="sm" disabled={busy} onClick={() => decide(c, true)}>{t("ogo.ini.approve")}</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => decide(c, false)}>{t("ogo.ini.decline")}</Button>
          <p className="w-full text-[11px] text-muted-foreground">{t("ogo.ini.approveNote")}</p>
        </div> : <p className="mt-1 text-xs text-muted-foreground">{t("ogo.ini.waitsFor", { name: name(c.workspace_id) })}</p>)}
      </li>; })}</ul>
    {i.status === "declined" && commitments.some((c) => c.status === "approved") && <p className="mt-2 text-xs text-muted-foreground">{t("ogo.ini.declinedKeep")}</p>}
    {editable && (NEXT[i.status] ?? []).length > 0 && <div className="mt-3 flex flex-wrap gap-2">{NEXT[i.status]!.map((s) => <Button key={s} size="sm" variant={s === "cancelled" ? "ghost" : "outline"} disabled={busy} onClick={() => move(s)}>{t(tk(`ogo.iniMove.${s}`))}</Button>)}</div>}
  </Panel>;
}
