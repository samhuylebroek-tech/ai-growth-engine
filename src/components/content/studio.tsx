import { useEffect, useMemo, useRef, useState } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const sel = "h-9 rounded-md border border-input bg-background px-2 text-sm";

export function ContentStudio() {
  const { workspace, org, workspaceRole, loading } = useOrg();
  if (loading) return <p className="p-6 text-muted-foreground">Loading…</p>;
  if (!workspace || !org) return <p className="p-6 text-muted-foreground">Choose a workspace to use the Content Studio.</p>;
  return <Studio key={workspace.id} orgId={org.id} wsId={workspace.id} role={workspaceRole} />;
}

function Studio({ orgId, wsId, role }: { orgId: string; wsId: string; role: ReturnType<typeof useOrg>["workspaceRole"] }) {
  const canEdit = hasRole(role, "member");
  const [selected, setSelected] = useState<string | null>(null);
  const qc = useQueryClient();
  const assets = useQuery({ queryKey: ["content-assets", wsId], queryFn: async () => {
    const r = await supabase.from("content_assets").select("id,title,channel,status,planned_date,updated_at,campaign_id").eq("workspace_id", wsId).order("updated_at", { ascending: false }).limit(100);
    if (r.error) throw r.error; return r.data; } });
  const create = async () => {
    const r = await supabase.from("content_assets").insert({ org_id: orgId, workspace_id: wsId, title: "Untitled content" }).select("id").single();
    if (r.error) return void toast.error("Could not create content.");
    await qc.invalidateQueries({ queryKey: ["content-assets", wsId] }); setSelected(r.data.id);
  };
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Content Studio</h1>
          <p className="text-sm text-muted-foreground">Write, version and approve each exact version before it is used anywhere. Nothing is published from here.</p></div>
        {canEdit && <Button onClick={create}><Plus className="mr-1 h-4 w-4" />New content</Button>}
      </div>
      <Tabs defaultValue="library">
        <TabsList><TabsTrigger value="library">Library</TabsTrigger><TabsTrigger value="profiles">Writing profiles</TabsTrigger></TabsList>
        <TabsContent value="library" className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <aside className="space-y-1 rounded-lg border bg-card p-2">
            {assets.isError && <p className="p-2 text-sm text-destructive">Could not load content. <button className="underline" onClick={() => assets.refetch()}>Retry</button></p>}
            {assets.data?.length === 0 && <p className="p-3 text-sm text-muted-foreground">No content yet. {canEdit ? "Create your first piece." : "Ask a member to create one."}</p>}
            {assets.data?.map((a) => (
              <button key={a.id} onClick={() => setSelected(a.id)} className={`w-full rounded-md px-3 py-2 text-left text-sm hover:bg-accent ${selected === a.id ? "bg-accent" : ""}`}>
                <div className="truncate font-medium">{a.title}</div>
                <div className="text-xs text-muted-foreground">{a.channel} · {a.status}{a.planned_date ? ` · ${a.planned_date}` : ""}</div>
              </button>))}
          </aside>
          {selected ? <Editor key={selected} id={selected} wsId={wsId} orgId={orgId} canEdit={canEdit} canDecide={hasRole(role, "admin")} />
            : <div className="grid place-items-center rounded-lg border border-dashed p-10 text-sm text-muted-foreground">Select content to edit.</div>}
        </TabsContent>
        <TabsContent value="profiles"><Profiles orgId={orgId} wsId={wsId} canEdit={canEdit} /></TabsContent>
      </Tabs>
    </div>);
}

function Editor({ id, wsId, orgId, canEdit, canDecide }: { id: string; wsId: string; orgId: string; canEdit: boolean; canDecide: boolean }) {
  const qc = useQueryClient();
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
      const r = await supabase.from("content_assets").update({ title: form.title.trim() || "Untitled content", draft_body: form.draft_body, channel: form.channel, planned_date: form.planned_date || null, campaign_id: form.campaign_id || null, writing_profile_id: form.writing_profile_id || null }).eq("id", id).eq("workspace_id", wsId);
      setSaveState(r.error ? "error" : "saved"); if (!r.error) qc.invalidateQueries({ queryKey: ["content-assets", wsId] });
    }, 800); return () => clearTimeout(t); }, [form, saveState, canEdit, id, wsId, qc]);
  const set = (k: keyof NonNullable<typeof form>, v: string) => { setForm((f) => f && { ...f, [k]: v }); setSaveState("pending"); };
  const refresh = () => qc.invalidateQueries({ queryKey: ["content-asset", id] });
  const saveVersion = async (restore?: string) => {
    if (saveState === "pending") return void toast.info("Autosave in progress — try again in a second.");
    const r = await supabase.rpc("save_content_version", { _asset: id, _note: note, ...(restore ? { _restore_from: restore } : {}) });
    if (r.error) return void toast.error(r.error.message.includes("empty") ? "Write something before saving a version." : "Could not save version.");
    setNote(""); toast.success(restore ? "Restored as a new version." : "Version saved.");
    if (restore) { loaded.current = false; setForm(null); } await refresh();
  };
  const decide = async (vid: string, decision: "approved" | "rejected") => {
    const r = await supabase.rpc("decide_content_version", { _version: vid, _decision: decision });
    if (r.error) return void toast.error(r.error.message.includes("duplicate") ? "This version already has a decision." : "Could not record decision.");
    toast.success(decision === "approved" ? "This exact version is approved." : "Version rejected."); refresh();
  };
  const versions = data.data?.versions ?? []; const decisions = data.data?.decisions ?? [];
  const cmp = versions.find((v) => v.id === compare);
  const diff = useMemo(() => (cmp && form ? diffLines(cmp.body, form.draft_body) : null), [cmp, form]);
  if (data.isError) return <p className="text-sm text-destructive">Could not load this content. <button className="underline" onClick={() => data.refetch()}>Retry</button></p>;
  if (!form || !data.data) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const draftChanged = versions[0] ? versions[0].body !== form.draft_body || versions[0].title !== form.title : true;
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <section className="space-y-3 rounded-lg border bg-card p-4">
        <div className="flex items-center gap-2"><Input aria-label="Title" value={form.title} disabled={!canEdit} onChange={(e) => set("title", e.target.value)} className="text-lg font-medium" />
          <span className="whitespace-nowrap text-xs text-muted-foreground" aria-live="polite">{saveState === "pending" ? "Saving…" : saveState === "error" ? "Not saved" : "Draft saved"}</span></div>
        <div className="flex flex-wrap gap-2">
          <select aria-label="Channel" className={sel} value={form.channel} disabled={!canEdit} onChange={(e) => set("channel", e.target.value)}>{CHANNELS.map((c) => <option key={c}>{c}</option>)}</select>
          <Input aria-label="Planned date" type="date" className="w-40" value={form.planned_date} disabled={!canEdit} onChange={(e) => set("planned_date", e.target.value)} />
          <select aria-label="Campaign" className={sel} value={form.campaign_id} disabled={!canEdit} onChange={(e) => set("campaign_id", e.target.value)}><option value="">No campaign</option>{(data.data.campaigns ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select>
          <select aria-label="Writing profile" className={sel} value={form.writing_profile_id} disabled={!canEdit} onChange={(e) => set("writing_profile_id", e.target.value)}><option value="">No writing profile</option>{(data.data.profiles ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </div>
        {canEdit && <DraftPanel orgId={orgId} wsId={wsId} assetId={id} hasDraft={!!form.draft_body.trim()} onUse={(t, m) => set("draft_body", m === "replace" ? t : `${form.draft_body}${form.draft_body ? "\n\n" : ""}${t}`)} />}
        <Textarea aria-label="Content" value={form.draft_body} disabled={!canEdit} onChange={(e) => set("draft_body", e.target.value)} className="min-h-[360px] font-[inherit] leading-relaxed" placeholder="Write your content…" />
        {canEdit && <div className="flex flex-wrap gap-2"><Input aria-label="Version note" placeholder="Version note (optional)" value={note} onChange={(e) => setNote(e.target.value)} className="max-w-xs" />
          <Button onClick={() => saveVersion()} disabled={!draftChanged || !form.draft_body.trim()}><Save className="mr-1 h-4 w-4" />Save version</Button></div>}
        {diff && cmp && <div className="rounded-md border"><div className="flex items-center justify-between border-b px-3 py-2 text-sm"><span>Comparing v{cmp.version_no} → current draft</span><Button size="sm" variant="ghost" onClick={() => setCompare(null)}><X className="h-4 w-4" /></Button></div>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap p-3 text-sm">{diff.map((l, i) => <div key={i} className={l.kind === "added" ? "bg-primary/15" : l.kind === "removed" ? "bg-destructive/15 line-through" : ""}>{l.kind === "added" ? "+ " : l.kind === "removed" ? "− " : "  "}{l.text}</div>)}</pre></div>}
      </section>
      <aside className="space-y-2 rounded-lg border bg-card p-3">
        <h2 className="flex items-center gap-1 text-sm font-semibold"><History className="h-4 w-4" />Versions</h2>
        {versions.length === 0 && <p className="text-sm text-muted-foreground">No saved versions. Save one to request approval.</p>}
        {versions.map((v) => { const d = decisions.find((x) => x.version_id === v.id);
          return (<div key={v.id} className="space-y-1 rounded-md border p-2 text-sm">
            <div className="flex items-center justify-between"><span className="font-medium">v{v.version_no}</span>
              {d ? <Badge variant={versionApproved(v.id, decisions) ? "default" : "destructive"}>{d.decision}</Badge> : <Badge variant="outline">awaiting review</Badge>}</div>
            <div className="text-xs text-muted-foreground">{new Date(v.created_at).toLocaleString()}{v.restored_from ? " · restored" : ""}{v.note ? ` · ${v.note}` : ""}</div>
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="ghost" onClick={() => setCompare(v.id)}><GitCompare className="mr-1 h-3 w-3" />Compare</Button>
              {canEdit && <Button size="sm" variant="ghost" onClick={() => saveVersion(v.id)}><RotateCcw className="mr-1 h-3 w-3" />Restore</Button>}
              {canDecide && !d && <><Button size="sm" variant="ghost" onClick={() => decide(v.id, "approved")}><Check className="mr-1 h-3 w-3" />Approve</Button><Button size="sm" variant="ghost" onClick={() => decide(v.id, "rejected")}><X className="mr-1 h-3 w-3" />Reject</Button></>}
            </div></div>); })}
        <p className="pt-2 text-xs text-muted-foreground">Approval covers only that exact version. Editing creates new versions that need their own approval.</p>
      </aside>
    </div>);
}

function Profiles({ orgId, wsId, canEdit }: { orgId: string; wsId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["writing-profiles", wsId], queryFn: async () => {
    const r = await supabase.from("writing_profiles").select("*").eq("workspace_id", wsId).order("name"); if (r.error) throw r.error; return r.data; } });
  const empty = { name: "", tone: "", style: "", audience: "", channels: "", examples: "", examples_authorized: false };
  const [f, setF] = useState(empty); const [editing, setEditing] = useState<string | null>(null);
  const submit = async () => {
    if (!f.name.trim()) return void toast.error("Give the profile a name.");
    if (f.examples.trim() && !f.examples_authorized) return void toast.error("Confirm you are authorized to use these writing examples.");
    const row = { name: f.name.trim(), tone: f.tone, style: f.style, audience: f.audience, channels: f.channels.split(",").map((s) => s.trim()).filter(Boolean), examples: f.examples, examples_authorized: f.examples_authorized };
    const r = editing ? await supabase.from("writing_profiles").update(row).eq("id", editing).eq("workspace_id", wsId) : await supabase.from("writing_profiles").insert({ ...row, org_id: orgId, workspace_id: wsId });
    if (r.error) return void toast.error("Could not save profile.");
    toast.success("Writing profile saved."); setF(empty); setEditing(null); qc.invalidateQueries({ queryKey: ["writing-profiles", wsId] });
  };
  return (<div className="grid gap-4 lg:grid-cols-2">
    <div className="space-y-2">{list.isError && <p className="text-sm text-destructive">Could not load profiles.</p>}
      {list.data?.length === 0 && <p className="text-sm text-muted-foreground">No writing profiles yet.</p>}
      {list.data?.map((p) => (<div key={p.id} className="rounded-lg border bg-card p-3 text-sm">
        <div className="flex items-center justify-between"><span className="font-medium">{p.name}</span>{canEdit && <Button size="sm" variant="ghost" onClick={() => { setEditing(p.id); setF({ name: p.name, tone: p.tone, style: p.style, audience: p.audience, channels: p.channels.join(", "), examples: p.examples, examples_authorized: p.examples_authorized }); }}><PenLine className="h-3 w-3" /></Button>}</div>
        <p className="text-muted-foreground">{[p.tone, p.audience, p.channels.join(", ")].filter(Boolean).join(" · ") || "No details"}</p></div>))}</div>
    {canEdit && <div className="space-y-2 rounded-lg border bg-card p-4">
      <h2 className="font-semibold">{editing ? "Edit profile" : "New writing profile"}</h2>
      <Input placeholder="Name" aria-label="Profile name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <Input placeholder="Tone (e.g. warm, direct)" aria-label="Tone" value={f.tone} onChange={(e) => setF({ ...f, tone: e.target.value })} />
      <Input placeholder="Audience" aria-label="Audience" value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })} />
      <Input placeholder="Channels, comma separated" aria-label="Channels" value={f.channels} onChange={(e) => setF({ ...f, channels: e.target.value })} />
      <Textarea placeholder="Style guidance" aria-label="Style" value={f.style} onChange={(e) => setF({ ...f, style: e.target.value })} />
      <Textarea placeholder="Writing examples you own or may use" aria-label="Examples" value={f.examples} onChange={(e) => setF({ ...f, examples: e.target.value })} />
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.examples_authorized} onCheckedChange={(v) => setF({ ...f, examples_authorized: v === true })} />I am authorized to use these examples</label>
      <div className="flex gap-2"><Button onClick={submit}>Save profile</Button>{editing && <Button variant="ghost" onClick={() => { setEditing(null); setF(empty); }}>Cancel</Button>}</div>
    </div>}
  </div>);
}
