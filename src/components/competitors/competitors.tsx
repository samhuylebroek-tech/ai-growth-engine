import { useState } from "react";
import { PageHeader } from "@/components/app/status";
import { Field } from "@/components/app/field";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Archive, ListPlus, Loader2, PenSquare, Plus, RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { hasRole } from "@/lib/permissions";
import { supabase } from "@/integrations/supabase/client";
import { checkCompetitor } from "@/lib/competitor.functions";
import { competitorBriefText } from "@/lib/competitor-intel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/lib/i18n";
import { MESSAGES, type MessageKey } from "@/lib/i18n/messages";

export function CompetitorsWorkspace() {
  const o = useOrg();
  const { t: tx } = useI18n();
  if (o.loading) return <p className="p-6 text-muted-foreground">{tx("marketing.comp.loading")}</p>;
  if (!o.workspace || !o.org) return <p className="p-6 text-muted-foreground">{tx("marketing.comp.chooseWs")}</p>;
  return <Competitors key={o.workspace.id} orgId={o.org.id} wsId={o.workspace.id} userId={o.userId} canEdit={hasRole(o.workspaceRole, "member")} />;
}

type Form = { name: string; website: string; market: string; location: string; category: string; notes: string };
const empty: Form = { name: "", website: "", market: "", location: "", category: "", notes: "" };
const REVIEW = { needs_review: "Needs review", relevant: "Relevant", irrelevant: "Irrelevant" } as const;
type Review = keyof typeof REVIEW;

function Competitors({ orgId, wsId, userId, canEdit }: { orgId: string; wsId: string; userId: string; canEdit: boolean }) {
  const qc = useQueryClient(); const check = useServerFn(checkCompetitor); const { t: tx } = useI18n();
  const [showArchived, setShowArchived] = useState(false);
  const list = useQuery({ queryKey: ["competitors", wsId], queryFn: async () => {
    const r = await supabase.from("competitors").select("*").eq("workspace_id", wsId).order("created_at"); if (r.error) throw r.error; return r.data;
  } });
  const [sel, setSel] = useState<string | null>(null); const [form, setForm] = useState<Form | null>(null); const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const visible = (list.data ?? []).filter(c => showArchived || c.status === "active");
  const current = (list.data ?? []).find(c => c.id === sel) ?? visible[0];

  const save = async () => {
    if (!form || !form.name.trim() || busy) return; setBusy(true);
    const values = { name: form.name.trim(), website: form.website.trim(), market: form.market.trim(), location: form.location.trim(), category: form.category.trim(), notes: form.notes.trim() };
    const r = editId ? await supabase.from("competitors").update(values).eq("id", editId).select("id").single()
      : await supabase.from("competitors").insert({ ...values, org_id: orgId, workspace_id: wsId, created_by: userId }).select("id").single();
    setBusy(false);
    if (r.error) return void toast.error(tx("marketing.comp.saveFailed"));
    setSel(r.data.id); setForm(null); setEditId(null); toast.success(tx("marketing.comp.saved")); qc.invalidateQueries({ queryKey: ["competitors", wsId] });
  };
  const setStatus = async (id: string, status: "active" | "archived") => {
    const r = await supabase.from("competitors").update({ status }).eq("id", id);
    if (r.error) return void toast.error(tx("marketing.comp.updateFailed")); qc.invalidateQueries({ queryKey: ["competitors", wsId] });
  };

  return <div className="max-w-6xl space-y-6">
    <PageHeader title={tx("marketing.comp.title")} description={tx("marketing.comp.intro")} />
    <div className="flex flex-wrap items-center gap-2">
      {canEdit && <Button onClick={() => { setForm(empty); setEditId(null); }}><Plus />{tx("marketing.comp.add")}</Button>}
      <Button variant="ghost" size="sm" onClick={() => setShowArchived(s => !s)}>{showArchived ? tx("marketing.comp.hideArchived") : tx("marketing.comp.showArchived")}</Button>
    </div>
    {form && <section className="grid gap-3 rounded-md border border-border p-4 sm:grid-cols-2">
      {(["name", "website", "market", "location", "category"] as const).map(k => <Field key={k} label={tx(`marketing.comp.f.${k}`)}><Input aria-label={tx(`marketing.comp.f.${k}`)} value={form[k]} maxLength={k === "website" ? 500 : 200} onChange={e => setForm({ ...form, [k]: e.target.value })} /></Field>)}
      <Field label={tx("marketing.comp.f.notes")} className="sm:col-span-2"><Textarea aria-label={tx("marketing.comp.f.notes")} maxLength={4000} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
      <div className="flex gap-2 sm:col-span-2"><Button disabled={busy || !form.name.trim()} onClick={save}><Save />{tx("marketing.comp.save")}</Button><Button variant="ghost" onClick={() => setForm(null)}>{tx("marketing.comp.cancel")}</Button></div>
    </section>}
    {list.isLoading ? <p className="text-muted-foreground">{tx("marketing.comp.loading")}</p> : list.error ? <p className="text-destructive">{tx("marketing.comp.loadFailed")}</p> : visible.length === 0 ? <p className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">{tx("marketing.comp.none")}</p> :
    <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
      <ul className="space-y-1">{visible.map(c => <li key={c.id}><button onClick={() => setSel(c.id)} className={`w-full rounded-md border p-3 text-left text-sm ${current?.id === c.id ? "border-primary bg-accent" : "border-border"}`}><span className="block truncate font-medium">{c.name}</span><span className="block truncate text-xs text-muted-foreground">{c.website || tx("marketing.comp.noWebsite")}{c.status === "archived" ? tx("marketing.comp.archivedTag") : ""}</span></button></li>)}</ul>
      {current && <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h2 className="text-lg font-semibold">{current.name}</h2>
          <p className="text-sm text-muted-foreground">{[current.category, current.market, current.location].filter(Boolean).join(" · ") || tx("marketing.comp.noDetails")}</p>{current.notes && <p className="mt-1 whitespace-pre-wrap text-sm">{current.notes}</p>}</div>
          {canEdit && <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy || current.status !== "active" || !current.website} onClick={async () => { setBusy(true); try { const r = await check({ data: { competitorId: current.id } }); if (!r.ok) toast.error(r.error); else { toast.success(r.changes || r.added ? tx("marketing.comp.newObs", { n: r.added }) : tx("marketing.comp.noChanges")); qc.invalidateQueries({ queryKey: ["competitor-obs", current.id] }); } } catch { toast.error(tx("marketing.comp.checkFailed")); } finally { setBusy(false); } }}>{busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}{tx("marketing.comp.check")}</Button>
            <Button size="sm" variant="outline" onClick={() => { setEditId(current.id); setForm({ name: current.name, website: current.website, market: current.market, location: current.location, category: current.category, notes: current.notes }); }}>{tx("marketing.comp.edit")}</Button>
            <Button size="sm" variant="ghost" onClick={() => setStatus(current.id, current.status === "active" ? "archived" : "active")}><Archive />{current.status === "active" ? tx("marketing.comp.archive") : tx("marketing.comp.restore")}</Button>
          </div>}
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">{(["traffic", "revenue", "ads", "rankings"] as const).map(l => <div key={l} className="rounded-md border border-border p-2"><p className="text-muted-foreground">{tx(`marketing.comp.m.${l}`)}</p><p className="font-medium">{tx("marketing.comp.unavailable")}</p></div>)}</div>
        <Observations key={current.id} orgId={orgId} wsId={wsId} userId={userId} canEdit={canEdit} competitor={current} />
      </div>}
    </div>}
  </div>;
}

function Observations({ orgId, wsId, userId, canEdit, competitor }: { orgId: string; wsId: string; userId: string; canEdit: boolean; competitor: { id: string; name: string } }) {
  const qc = useQueryClient(); const key = ["competitor-obs", competitor.id]; const { t: tx, tag } = useI18n();
  const cat = (s: string) => (`marketing.comp.cat.${s}` in MESSAGES.en ? tx(`marketing.comp.cat.${s}` as MessageKey) : s);
  const obs = useQuery({ queryKey: key, queryFn: async () => { const r = await supabase.from("competitor_observations").select("*").eq("competitor_id", competitor.id).order("observed_at", { ascending: false }).limit(300); if (r.error) throw r.error; return r.data; } });
  const goals = useQuery({ queryKey: ["competitor-goals", wsId], queryFn: async () => (await supabase.from("growth_goals").select("id,title").eq("workspace_id", wsId).neq("status", "archived").limit(100)).data ?? [] });
  const tasks = useQuery({ queryKey: ["competitor-tasks", wsId], queryFn: async () => new Set(((await supabase.from("tasks").select("labels").eq("workspace_id", wsId).contains("labels", ["competitor"]).limit(1000)).data ?? []).flatMap(t => t.labels)) });
  const [filter, setFilter] = useState<"all" | Review>("all"); const [picked, setPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState(""); const [noteBusy, setNoteBusy] = useState(false); const [briefBusy, setBriefBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const rows = (obs.data ?? []).filter(o => filter === "all" || o.review_status === filter);
  const update = async (id: string, patch: { review_status?: Review; goal_id?: string | null }) => { const r = await supabase.from("competitor_observations").update(patch).eq("id", id); if (r.error) toast.error(tx("marketing.comp.updateFailed")); refresh(); };
  const toTask = async (o: NonNullable<typeof obs.data>[number]) => {
    if (tasks.data?.has(`obs:${o.id}`)) return;
    const r = await supabase.from("tasks").insert({ org_id: orgId, workspace_id: wsId, title: `Competitor ${competitor.name}: ${o.statement}`.slice(0, 200), description: `${o.kind === "verified_fact" ? "Verified fact" : "Interpretation"} observed ${new Date(o.observed_at).toLocaleDateString()}${o.source_url ? `\nSource: ${o.source_url}` : ""}`, priority: "medium", labels: ["competitor", `obs:${o.id}`], owner_id: userId, created_by: userId });
    if (r.error) return void toast.error(tx("marketing.comp.taskFailed"));
    toast.success(tx("marketing.comp.taskAdded")); qc.invalidateQueries({ queryKey: ["competitor-tasks", wsId] }); qc.invalidateQueries({ queryKey: ["execution"] });
  };
  const addNote = async () => {
    if (!note.trim() || noteBusy) return; setNoteBusy(true);
    const r = await supabase.from("competitor_observations").insert({ org_id: orgId, workspace_id: wsId, competitor_id: competitor.id, kind: "interpretation", category: "opportunity", statement: note.trim().slice(0, 1000), created_by: userId });
    setNoteBusy(false); if (r.error) return void toast.error(tx("marketing.comp.noteFailed")); setNote(""); refresh();
  };
  const brief = async () => {
    const chosen = (obs.data ?? []).filter(o => picked.has(o.id)); if (!chosen.length || briefBusy) return; setBriefBusy(true);
    const r = await supabase.from("content_assets").insert({ org_id: orgId, workspace_id: wsId, title: `Brief: angle vs ${competitor.name}`.slice(0, 200), channel: "blog", draft_body: competitorBriefText(competitor.name, chosen) });
    setBriefBusy(false); if (r.error) return void toast.error(tx("marketing.comp.briefFailed"));
    setPicked(new Set()); toast.success(tx("marketing.comp.briefAdded"));
  };

  return <section className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{tx("marketing.comp.observations")}</h3>
      <div className="flex flex-wrap gap-1">{(["all", "needs_review", "relevant", "irrelevant"] as const).map(s => <Button key={s} size="sm" variant={filter === s ? "default" : "ghost"} onClick={() => setFilter(s)}>{s === "all" ? tx("marketing.comp.all") : tx(`marketing.comp.rv.${s}`)}</Button>)}</div></div>
    {canEdit && <div className="flex flex-col gap-2 sm:flex-row"><Input aria-label={tx("marketing.comp.interp")} placeholder={tx("marketing.comp.interpPh")} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} /><Button variant="outline" disabled={!note.trim() || noteBusy} onClick={addNote}>{tx("marketing.comp.addNote")}</Button></div>}
    {canEdit && picked.size > 0 && <Button size="sm" disabled={briefBusy} onClick={brief}><PenSquare />{tx("marketing.comp.brief", { n: picked.size })}</Button>}
    {obs.isLoading ? <p className="text-sm text-muted-foreground">{tx("marketing.comp.loading")}</p> : obs.error ? <p className="text-sm text-destructive">{tx("marketing.comp.obsFailed")}</p> : rows.length === 0 ? <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">{tx("marketing.comp.noObs")}</p> :
    <ul className="divide-y divide-border rounded-md border border-border">{rows.map(o => { const done = !!tasks.data?.has(`obs:${o.id}`); return <li key={o.id} className="space-y-2 p-3">
      <div className="flex items-start gap-2">
        {canEdit && <input type="checkbox" aria-label={tx("marketing.comp.selectBrief")} className="mt-1" checked={picked.has(o.id)} onChange={e => setPicked(s => { const n = new Set(s); if (e.target.checked) n.add(o.id); else n.delete(o.id); return n; })} />}
        <div className="min-w-0 flex-1"><div className="flex flex-wrap gap-1"><Badge variant={o.kind === "verified_fact" ? "default" : "secondary"}>{o.kind === "verified_fact" ? tx("marketing.comp.fact") : tx("marketing.comp.interpretation")}</Badge><Badge variant="outline">{cat(o.category)}</Badge><Badge variant="outline">{o.review_status in REVIEW ? tx(`marketing.comp.rv.${o.review_status as Review}`) : o.review_status}</Badge></div>
          <p className="mt-1 break-words text-sm">{o.statement}</p>
          <p className="truncate text-xs text-muted-foreground">{new Date(o.observed_at).toLocaleString(tag, { dateStyle: "medium", timeStyle: "short" })}{o.source_url ? ` · ${o.source_url}` : tx("marketing.comp.ownNote")}</p></div>
      </div>
      {canEdit && <div className="flex flex-wrap items-center gap-1 pl-6">
        {(["relevant", "irrelevant", "needs_review"] as const).filter(s => s !== o.review_status).map(s => <Button key={s} size="sm" variant="ghost" onClick={() => update(o.id, { review_status: s })}>{tx(`marketing.comp.rv.${s}`)}</Button>)}
        <select aria-label={tx("marketing.comp.linkGoal")} className="h-8 max-w-full rounded-md border border-input bg-background px-2 text-xs" value={o.goal_id ?? ""} onChange={e => update(o.id, { goal_id: e.target.value || null })}><option value="">{tx("marketing.comp.noGoal")}</option>{(goals.data ?? []).map(g => <option key={g.id} value={g.id}>{g.title}</option>)}</select>
        <Button size="sm" variant="outline" disabled={done} onClick={() => toTask(o)}><ListPlus />{done ? tx("marketing.comp.taskDone") : tx("marketing.comp.createTask")}</Button>
      </div>}
    </li>; })}</ul>}
  </section>;
}
