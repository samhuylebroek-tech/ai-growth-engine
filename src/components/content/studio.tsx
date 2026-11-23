import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/app/status";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Save, History, GitCompare, RotateCcw, Check, X, PenLine } from "lucide-react";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { hasRole } from "@/lib/permissions";
import { supabase } from "@/integrations/supabase/client";
import { CHANNELS, diffLines, versionApproved } from "@/lib/content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { DraftPanel } from "@/components/content/draft-panel";
import { ReviewPanel } from "@/components/content/review-panel";
import { RepurposePanel } from "@/components/content/repurpose-panel";
import { EditorialCalendar } from "@/components/content/calendar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/lib/i18n";
import { MESSAGES, type MessageKey } from "@/lib/i18n/messages";
const csKey = (prefix: string, s: string) => `marketing.cs.${prefix}.${s}`;
const csLabel = (tx: (k: MessageKey) => string, prefix: string, s: string) => (csKey(prefix, s) in MESSAGES.en ? tx(csKey(prefix, s) as MessageKey) : s);

const sel = "h-9 rounded-md border border-input bg-background px-2 text-sm";

export function ContentStudio() {
  const { workspace, org, workspaceRole, loading, userId } = useOrg();
  const { t: tx } = useI18n();
  if (loading) return <p className="p-6 text-muted-foreground">{tx("marketing.cs.loading")}</p>;
  if (!workspace || !org) return <p className="p-6 text-muted-foreground">{tx("marketing.cs.chooseWs")}</p>;
  return <Studio key={workspace.id} orgId={org.id} wsId={workspace.id} role={workspaceRole} userId={userId} />;
}

function Studio({ orgId, wsId, role, userId }: { orgId: string; wsId: string; role: ReturnType<typeof useOrg>["workspaceRole"]; userId: string }) {
  const [tab, setTab] = useState("library");
  const { t: tx, tag } = useI18n();
  const canEdit = hasRole(role, "member");
  const [selected, setSelected] = useState<string | null>(null);
  const qc = useQueryClient();
  const assets = useQuery({ queryKey: ["content-assets", wsId], queryFn: async () => {
    const r = await supabase.from("content_assets").select("id,title,channel,status,planned_date,updated_at,campaign_id").eq("workspace_id", wsId).order("updated_at", { ascending: false }).limit(100);
    if (r.error) throw r.error; return r.data; } });
  const create = async () => {
    const r = await supabase.from("content_assets").insert({ org_id: orgId, workspace_id: wsId, title: tx("marketing.cs.untitled") }).select("id").single();
    if (r.error) return void toast.error(tx("marketing.cs.createFailed"));
    await qc.invalidateQueries({ queryKey: ["content-assets", wsId] }); setSelected(r.data.id);
  };
  return (
    <div className="space-y-6">
      <PageHeader title={tx("ph.content.title")} description={tx("marketing.cs.intro")} actions={canEdit && <Button onClick={create}><Plus className="mr-1 h-4 w-4" />{tx("marketing.cs.new")}</Button>} />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList><TabsTrigger value="library">{tx("marketing.cs.tab.library")}</TabsTrigger><TabsTrigger value="calendar">{tx("marketing.cs.tab.calendar")}</TabsTrigger><TabsTrigger value="profiles">{tx("marketing.cs.tab.profiles")}</TabsTrigger></TabsList>
        <TabsContent value="library" className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <aside className="space-y-1 rounded-lg border bg-card p-2">
            {assets.isError && <p className="p-2 text-sm text-destructive">{tx("marketing.cs.loadFailed")} <button className="underline" onClick={() => assets.refetch()}>{tx("marketing.cs.retry")}</button></p>}
            {assets.data?.length === 0 && <p className="p-3 text-sm text-muted-foreground">{tx("marketing.cs.none")} {canEdit ? tx("marketing.cs.createFirst") : tx("marketing.cs.askMember")}</p>}
            {assets.data?.map((a) => (
              <button key={a.id} onClick={() => setSelected(a.id)} className={`w-full rounded-md px-3 py-2 text-left text-sm hover:bg-accent ${selected === a.id ? "bg-accent" : ""}`}>
                <div className="truncate font-medium">{a.title}</div>
                <div className="text-xs text-muted-foreground">{csLabel(tx, "ch", a.channel)} · {csLabel(tx, "st", a.status)}{a.planned_date ? ` · ${new Date(`${a.planned_date}T12:00:00`).toLocaleDateString(tag)}` : ""}</div>
              </button>))}
          </aside>
          {selected ? <Editor key={selected} id={selected} wsId={wsId} orgId={orgId} canEdit={canEdit} canDecide={hasRole(role, "admin")} userId={userId} />
            : <div className="grid place-items-center rounded-lg border border-dashed p-10 text-sm text-muted-foreground">{tx("marketing.cs.select")}</div>}
        </TabsContent>
        <TabsContent value="calendar"><EditorialCalendar assets={assets.data ?? []} onOpen={(id) => { setSelected(id); setTab("library"); }} /></TabsContent>
        <TabsContent value="profiles"><Profiles orgId={orgId} wsId={wsId} canEdit={canEdit} /></TabsContent>
      </Tabs>
    </div>);
}

function Editor({ id, wsId, orgId, canEdit, canDecide, userId }: { id: string; wsId: string; orgId: string; canEdit: boolean; canDecide: boolean; userId: string }) {
  const qc = useQueryClient();
  const { t: tx, tag } = useI18n();
  const data = useQuery({ queryKey: ["content-asset", id], queryFn: async () => {
    const [a, v, d, c, p] = await Promise.all([
      supabase.from("content_assets").select("*").eq("id", id).eq("workspace_id", wsId).single(),
      supabase.from("content_versions").select("*").eq("asset_id", id).eq("workspace_id", wsId).order("version_no", { ascending: false }).limit(100),
      supabase.from("content_version_decisions").select("version_id,decision,note,decided_at").eq("workspace_id", wsId),
      supabase.from("campaigns").select("id,title").eq("workspace_id", wsId).order("created_at", { ascending: false }).limit(100),
      supabase.from("writing_profiles").select("id,name").eq("workspace_id", wsId).order("name"),
    ]);
    const err = a.error ?? v.error ?? d.error ?? c.error ?? p.error; if (err || !a.data) throw err ?? new Error("missing");
    return { asset: a.data, versions: v.data, decisions: d.data, campaigns: c.data, profiles: p.data }; } });
  const [form, setForm] = useState<{ title: string; draft_body: string; channel: string; planned_date: string; campaign_id: string; writing_profile_id: string } | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "pending" | "error">("saved");
  const [compare, setCompare] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const loaded = useRef(false);
  useEffect(() => { if (data.data && !loaded.current) { const a = data.data.asset; loaded.current = true;
    setForm({ title: a.title, draft_body: a.draft_body, channel: a.channel, planned_date: a.planned_date ?? "", campaign_id: a.campaign_id ?? "", writing_profile_id: a.writing_profile_id ?? "" }); } }, [data.data]);
  // Autosave the working draft 800ms after the last edit.
  useEffect(() => { if (!form || !loaded.current || !canEdit || saveState !== "pending") return;
    const t = setTimeout(async () => {
      const r = await supabase.from("content_assets").update({ title: form.title.trim() || tx("marketing.cs.untitled"), draft_body: form.draft_body, channel: form.channel, planned_date: form.planned_date || null, campaign_id: form.campaign_id || null, writing_profile_id: form.writing_profile_id || null }).eq("id", id).eq("workspace_id", wsId);
      setSaveState(r.error ? "error" : "saved"); if (!r.error) qc.invalidateQueries({ queryKey: ["content-assets", wsId] });
    }, 800); return () => clearTimeout(t); }, [form, saveState, canEdit, id, wsId, qc, tx]);
  const set = (k: keyof NonNullable<typeof form>, v: string) => { setForm((f) => f && { ...f, [k]: v }); setSaveState("pending"); };
  const refresh = () => qc.invalidateQueries({ queryKey: ["content-asset", id] });
  const saveVersion = async (restore?: string) => {
    if (saveState === "pending") return void toast.info(tx("marketing.cs.autosaving"));
    const r = await supabase.rpc("save_content_version", { _asset: id, _note: note, ...(restore ? { _restore_from: restore } : {}) });
    if (r.error) return void toast.error(r.error.message.includes("empty") ? tx("marketing.cs.writeFirst") : tx("marketing.cs.versionFailed"));
    setNote(""); toast.success(restore ? tx("marketing.cs.restored") : tx("marketing.cs.versionSaved"));
    if (restore) { loaded.current = false; setForm(null); } await refresh();
  };
  const decide = async (vid: string, decision: "approved" | "rejected") => {
    const r = await supabase.rpc("decide_content_version", { _version: vid, _decision: decision });
    if (r.error) return void toast.error(r.error.message.includes("duplicate") ? tx("marketing.cs.alreadyDecided") : tx("marketing.cs.decideFailed"));
    toast.success(decision === "approved" ? tx("marketing.cs.approvedOk") : tx("marketing.cs.rejectedOk")); refresh();
  };
  const versions = data.data?.versions ?? []; const decisions = data.data?.decisions ?? [];
  const cmp = versions.find((v) => v.id === compare);
  const diff = useMemo(() => (cmp && form ? diffLines(cmp.body, form.draft_body) : null), [cmp, form]);
  if (data.isError) return <p className="text-sm text-destructive">{tx("marketing.cs.loadOne")} <button className="underline" onClick={() => data.refetch()}>{tx("marketing.cs.retry")}</button></p>;
  if (!form || !data.data) return <p className="text-sm text-muted-foreground">{tx("marketing.cs.loading")}</p>;
  const draftChanged = versions[0] ? versions[0].body !== form.draft_body || versions[0].title !== form.title : true;
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <section className="space-y-3 rounded-lg border bg-card p-4">
        <div className="flex items-center gap-2"><Input aria-label={tx("marketing.cs.title")} value={form.title} disabled={!canEdit} onChange={(e) => set("title", e.target.value)} className="text-lg font-medium" />
          <span className="whitespace-nowrap text-xs text-muted-foreground" aria-live="polite">{saveState === "pending" ? tx("marketing.cs.saving") : saveState === "error" ? tx("marketing.cs.notSaved") : tx("marketing.cs.draftSaved")}</span></div>
        <div className="flex flex-wrap gap-2">
          <select aria-label={tx("marketing.cs.channel")} className={sel} value={form.channel} disabled={!canEdit} onChange={(e) => set("channel", e.target.value)}>{CHANNELS.map((c) => <option key={c} value={c}>{tx(`marketing.cs.ch.${c}`)}</option>)}</select>
          <Input aria-label={tx("marketing.cs.plannedDate")} type="date" className="w-40" value={form.planned_date} disabled={!canEdit} onChange={(e) => set("planned_date", e.target.value)} />
          <select aria-label={tx("marketing.cs.campaign")} className={sel} value={form.campaign_id} disabled={!canEdit} onChange={(e) => set("campaign_id", e.target.value)}><option value="">{tx("marketing.cs.noCampaign")}</option>{(data.data.campaigns ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select>
          <select aria-label={tx("marketing.cs.profile")} className={sel} value={form.writing_profile_id} disabled={!canEdit} onChange={(e) => set("writing_profile_id", e.target.value)}><option value="">{tx("marketing.cs.noProfile")}</option>{(data.data.profiles ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </div>
        {canEdit && <DraftPanel orgId={orgId} wsId={wsId} assetId={id} hasDraft={!!form.draft_body.trim()} onUse={(t, m) => set("draft_body", m === "replace" ? t : `${form.draft_body}${form.draft_body ? "\n\n" : ""}${t}`)} />}
        {canEdit && <ReviewPanel orgId={orgId} wsId={wsId} assetId={id} draft={form.draft_body} versions={versions} onApply={(t) => set("draft_body", t)} />}
        {canEdit && form.draft_body.trim() && <RepurposePanel orgId={orgId} wsId={wsId} assetId={id} source={form.channel} campaignId={form.campaign_id} profileId={form.writing_profile_id} userId={userId} />}
        <Textarea aria-label={tx("marketing.cs.content")} value={form.draft_body} disabled={!canEdit} onChange={(e) => set("draft_body", e.target.value)} className="min-h-[360px] font-[inherit] leading-relaxed" placeholder={tx("marketing.cs.writePh")} />
        {canEdit && <div className="flex flex-wrap gap-2"><Input aria-label={tx("marketing.cs.versionNote")} placeholder={tx("marketing.cs.versionNotePh")} value={note} onChange={(e) => setNote(e.target.value)} className="max-w-xs" />
          <Button onClick={() => saveVersion()} disabled={!draftChanged || !form.draft_body.trim()}><Save className="mr-1 h-4 w-4" />{tx("marketing.cs.saveVersion")}</Button></div>}
        {diff && cmp && <div className="rounded-md border"><div className="flex items-center justify-between border-b px-3 py-2 text-sm"><span>{tx("marketing.cs.comparing", { n: cmp.version_no })}</span><Button size="sm" variant="ghost" onClick={() => setCompare(null)}><X className="h-4 w-4" /></Button></div>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap p-3 text-sm">{diff.map((l, i) => <div key={i} className={l.kind === "added" ? "bg-primary/15" : l.kind === "removed" ? "bg-destructive/15 line-through" : ""}>{l.kind === "added" ? "+ " : l.kind === "removed" ? "− " : "  "}{l.text}</div>)}</pre></div>}
      </section>
      <aside className="space-y-2 rounded-lg border bg-card p-3">
        <h2 className="flex items-center gap-1 text-sm font-semibold"><History className="h-4 w-4" />{tx("marketing.cs.versions")}</h2>
        {versions.length === 0 && <p className="text-sm text-muted-foreground">{tx("marketing.cs.noVersions")}</p>}
        {versions.map((v) => { const d = decisions.find((x) => x.version_id === v.id);
          return (<div key={v.id} className="space-y-1 rounded-md border p-2 text-sm">
            <div className="flex items-center justify-between"><span className="font-medium">v{v.version_no}</span>
              {d ? <Badge variant={versionApproved(v.id, decisions) ? "default" : "destructive"}>{csLabel(tx, "dec", d.decision)}</Badge> : <Badge variant="outline">{tx("marketing.cs.awaiting")}</Badge>}</div>
            <div className="text-xs text-muted-foreground">{new Date(v.created_at).toLocaleString(tag)}{v.restored_from ? tx("marketing.cs.restoredTag") : ""}{v.note ? ` · ${v.note}` : ""}</div>
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="ghost" onClick={() => setCompare(v.id)}><GitCompare className="mr-1 h-3 w-3" />{tx("marketing.cs.compare")}</Button>
              {canEdit && <Button size="sm" variant="ghost" onClick={() => saveVersion(v.id)}><RotateCcw className="mr-1 h-3 w-3" />{tx("marketing.cs.restore")}</Button>}
              {canDecide && !d && <><Button size="sm" variant="ghost" onClick={() => decide(v.id, "approved")}><Check className="mr-1 h-3 w-3" />{tx("marketing.cs.approve")}</Button><Button size="sm" variant="ghost" onClick={() => decide(v.id, "rejected")}><X className="mr-1 h-3 w-3" />{tx("marketing.cs.reject")}</Button></>}
            </div></div>); })}
        <p className="pt-2 text-xs text-muted-foreground">{tx("marketing.cs.approvalNote")}</p>
      </aside>
    </div>);
}

function Profiles({ orgId, wsId, canEdit }: { orgId: string; wsId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const { t: tx } = useI18n();
  const list = useQuery({ queryKey: ["writing-profiles", wsId], queryFn: async () => {
    const r = await supabase.from("writing_profiles").select("*").eq("workspace_id", wsId).order("name"); if (r.error) throw r.error; return r.data; } });
  const empty = { name: "", tone: "", style: "", audience: "", channels: "", examples: "", examples_authorized: false };
  const [f, setF] = useState(empty); const [editing, setEditing] = useState<string | null>(null);
  const submit = async () => {
    if (!f.name.trim()) return void toast.error(tx("marketing.cs.pNameNeeded"));
    if (f.examples.trim() && !f.examples_authorized) return void toast.error(tx("marketing.cs.pAuthNeeded"));
    const row = { name: f.name.trim(), tone: f.tone, style: f.style, audience: f.audience, channels: f.channels.split(",").map((s) => s.trim()).filter(Boolean), examples: f.examples, examples_authorized: f.examples_authorized };
    const r = editing ? await supabase.from("writing_profiles").update(row).eq("id", editing).eq("workspace_id", wsId) : await supabase.from("writing_profiles").insert({ ...row, org_id: orgId, workspace_id: wsId });
    if (r.error) return void toast.error(tx("marketing.cs.pFailed"));
    toast.success(tx("marketing.cs.pSaved")); setF(empty); setEditing(null); qc.invalidateQueries({ queryKey: ["writing-profiles", wsId] });
  };
  return (<div className="grid gap-4 lg:grid-cols-2">
    <div className="space-y-2">{list.isError && <p className="text-sm text-destructive">{tx("marketing.cs.pLoadFailed")}</p>}
      {list.data?.length === 0 && <p className="text-sm text-muted-foreground">{tx("marketing.cs.pNone")}</p>}
      {list.data?.map((p) => (<div key={p.id} className="rounded-lg border bg-card p-3 text-sm">
        <div className="flex items-center justify-between"><span className="font-medium">{p.name}</span>{canEdit && <Button size="sm" variant="ghost" onClick={() => { setEditing(p.id); setF({ name: p.name, tone: p.tone, style: p.style, audience: p.audience, channels: p.channels.join(", "), examples: p.examples, examples_authorized: p.examples_authorized }); }}><PenLine className="h-3 w-3" /></Button>}</div>
        <p className="text-muted-foreground">{[p.tone, p.audience, p.channels.join(", ")].filter(Boolean).join(" · ") || tx("marketing.cs.noDetails")}</p></div>))}</div>
    {canEdit && <div className="space-y-2 rounded-lg border bg-card p-4">
      <h2 className="font-semibold">{editing ? tx("marketing.cs.pEdit") : tx("marketing.cs.pNew")}</h2>
      <Input placeholder={tx("marketing.cs.p.name")} aria-label={tx("marketing.cs.p.nameLabel")} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <Input placeholder={tx("marketing.cs.p.tonePh")} aria-label={tx("marketing.cs.p.tone")} value={f.tone} onChange={(e) => setF({ ...f, tone: e.target.value })} />
      <Input placeholder={tx("marketing.cs.p.audience")} aria-label={tx("marketing.cs.p.audience")} value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })} />
      <Input placeholder={tx("marketing.cs.p.channelsPh")} aria-label={tx("marketing.cs.p.channels")} value={f.channels} onChange={(e) => setF({ ...f, channels: e.target.value })} />
      <Textarea placeholder={tx("marketing.cs.p.stylePh")} aria-label={tx("marketing.cs.p.style")} value={f.style} onChange={(e) => setF({ ...f, style: e.target.value })} />
      <Textarea placeholder={tx("marketing.cs.p.examplesPh")} aria-label={tx("marketing.cs.p.examples")} value={f.examples} onChange={(e) => setF({ ...f, examples: e.target.value })} />
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.examples_authorized} onCheckedChange={(v) => setF({ ...f, examples_authorized: v === true })} />{tx("marketing.cs.p.authorized")}</label>
      <div className="flex gap-2"><Button onClick={submit}>{tx("marketing.cs.p.save")}</Button>{editing && <Button variant="ghost" onClick={() => { setEditing(null); setF(empty); }}>{tx("marketing.cs.cancel")}</Button>}</div>
    </div>}
  </div>);
}
