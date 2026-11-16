import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Search, ListPlus, Plug } from "lucide-react";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { hasRole } from "@/lib/permissions";
import { supabase } from "@/integrations/supabase/client";
import { runSeoAudit } from "@/lib/seo.functions";
import { severityRank, type SeoFinding, type SeoPage } from "@/lib/seo-audit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export function SeoWorkspace() {
  const o = useOrg();
  if (o.loading) return <p className="p-6 text-muted-foreground">Loading…</p>;
  if (!o.workspace || !o.org) return <p className="p-6 text-muted-foreground">Choose a workspace to check your website.</p>;
  return <Seo key={o.workspace.id} orgId={o.org.id} wsId={o.workspace.id} userId={o.userId} canEdit={hasRole(o.workspaceRole, "member")} />;
}

const sevVariant = { high: "destructive", medium: "default", low: "secondary" } as const;

function Seo({ orgId, wsId, userId, canEdit }: { orgId: string; wsId: string; userId: string; canEdit: boolean }) {
  const qc = useQueryClient(); const run = useServerFn(runSeoAudit);
  const site = useQuery({ queryKey: ["seo-site", wsId], queryFn: async () => (await supabase.from("business_profiles").select("website").eq("workspace_id", wsId).maybeSingle()).data?.website ?? "" });
  const audits = useQuery({ queryKey: ["seo-audits", wsId], queryFn: async () => {
    const r = await supabase.from("seo_audits").select("id,site_url,page_count,created_at,robots,sitemap,pages,findings").eq("workspace_id", wsId).order("created_at", { ascending: false }).limit(10);
    if (r.error) throw r.error; return r.data;
  } });
  const [url, setUrl] = useState(""); const [busy, setBusy] = useState(false); const [picked, setPicked] = useState<string | null>(null);
  const [sev, setSev] = useState<"all" | SeoFinding["severity"]>("all"); const [made, setMade] = useState<Set<string>>(new Set());
  const existing = useQuery({ queryKey: ["seo-tasks", wsId], queryFn: async () => {
    const r = await supabase.from("tasks").select("title,description").eq("workspace_id", wsId).contains("labels", ["seo"]).limit(500);
    return new Set((r.data ?? []).map(t => `${t.title}|${t.description.split("\n")[0]}`));
  } });
  const taskKey = (f: SeoFinding) => `${`SEO: ${f.message}`.slice(0, 200)}|Page: ${f.url}`;
  const target = url || site.data || "";
  const current = audits.data?.find(a => a.id === picked) ?? audits.data?.[0];
  const findings = ((current?.findings ?? []) as SeoFinding[]).slice().sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  const pages = (current?.pages ?? []) as SeoPage[];
  const robots = (current?.robots ?? {}) as { found?: boolean; blocksAll?: boolean };
  const sitemap = (current?.sitemap ?? {}) as { found?: boolean; urls?: number };
  const count = (s: SeoFinding["severity"]) => findings.filter(f => f.severity === s).length;

  const start = async (e: React.FormEvent) => {
    e.preventDefault(); if (!target.trim() || busy) return; setBusy(true);
    try { const r = await run({ data: { workspaceId: wsId, url: target } });
      if (!r.ok) return void toast.error(r.error);
      setPicked(r.id); await qc.invalidateQueries({ queryKey: ["seo-audits", wsId] }); toast.success("Website check complete");
    } catch { toast.error("The check could not finish. Try again."); } finally { setBusy(false); }
  };
  const toTask = async (f: SeoFinding) => {
    const key = taskKey(f);
    if (existing.data?.has(key)) return;
    const r = await supabase.from("tasks").insert({ org_id: orgId, workspace_id: wsId, title: `SEO: ${f.message}`.slice(0, 200), description: `Page: ${f.url}\nFound by the website check on ${new Date(current?.created_at ?? Date.now()).toLocaleDateString()}.`, priority: f.severity === "high" ? "high" : f.severity === "medium" ? "medium" : "low", labels: ["seo", f.code], owner_id: userId, created_by: userId });
    if (r.error) return void toast.error("Could not create the task.");
    setMade(s => new Set(s).add(key)); toast.success("Task added under Tasks"); qc.invalidateQueries({ queryKey: ["execution"] });
  };

  return <div className="mx-auto max-w-6xl space-y-8">
    <header><h1 className="text-2xl font-semibold">SEO</h1><p className="mt-1 text-sm text-muted-foreground">Checks your public website pages for search basics. Results come only from your live pages; no rankings or traffic are estimated.</p></header>
    <form onSubmit={start} className="flex flex-col gap-3 sm:flex-row">
      <Input aria-label="Website to check" inputMode="url" placeholder="https://yourbusiness.com" value={target} onChange={e => setUrl(e.target.value)} maxLength={500} className="min-h-11 flex-1" />
      <Button disabled={!canEdit || busy || !target.trim()} className="min-h-11">{busy ? <Loader2 className="animate-spin" /> : <Search />}{busy ? "Checking pages…" : "Check website"}</Button>
    </form>
    {!canEdit && <p className="text-sm text-muted-foreground">Member access is needed to run a check.</p>}
    <p className="text-xs text-muted-foreground">Reads up to 15 public pages, robots.txt and the sitemap. No AI credits are used.</p>

    {audits.isLoading ? <p className="text-muted-foreground">Loading…</p> : !current ? <p className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">No website checks yet.</p> : <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Pages checked" value={String(current.page_count)} />
        <Stat label="High issues" value={String(count("high"))} />
        <Stat label="Medium issues" value={String(count("medium"))} />
        <Stat label="robots.txt" value={!robots.found ? "Not found" : robots.blocksAll ? "Blocks all" : "Found"} />
        <Stat label="Sitemap" value={sitemap.found ? `${sitemap.urls ?? 0} URLs` : "Not found"} />
      </section>
      {(audits.data?.length ?? 0) > 1 && <div className="flex flex-wrap items-center gap-2 text-sm"><span className="text-muted-foreground">Earlier checks:</span>{audits.data!.map(a => <Button key={a.id} size="sm" variant={a.id === current.id ? "default" : "outline"} onClick={() => setPicked(a.id)}>{new Date(a.created_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })} · {(a.findings as SeoFinding[]).length}</Button>)}</div>}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">Findings · {current.site_url}</h2>
          <div className="flex gap-1">{(["all", "high", "medium", "low"] as const).map(s => <Button key={s} size="sm" variant={sev === s ? "default" : "ghost"} onClick={() => setSev(s)}>{s === "all" ? "All" : s[0]!.toUpperCase() + s.slice(1)}</Button>)}</div></div>
        {findings.length === 0 ? <p className="text-sm text-muted-foreground">No issues found on the checked pages.</p> :
        <ul className="divide-y divide-border rounded-md border border-border">{findings.filter(f => sev === "all" || f.severity === sev).slice(0, 150).map((f, i) => { const key = taskKey(f); const done = made.has(key) || !!existing.data?.has(key); return <li key={i} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
          <Badge variant={sevVariant[f.severity]} className="w-fit">{f.severity}</Badge>
          <div className="min-w-0 flex-1"><p className="text-sm">{f.message}</p><p className="truncate text-xs text-muted-foreground">{f.url}</p></div>
          {canEdit && <Button size="sm" variant="outline" disabled={done} onClick={() => toTask(f)}><ListPlus />{done ? "Task added" : "Create task"}</Button>}
        </li>; })}</ul>}
      </section>
      <section className="space-y-3"><h2 className="text-lg font-semibold">Pages</h2>
        <div className="overflow-x-auto rounded-md border border-border"><table className="w-full min-w-[640px] text-sm"><thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="p-2">Page</th><th className="p-2">Title</th><th className="p-2">H1</th><th className="p-2">Words</th><th className="p-2">Links in/out</th><th className="p-2">Status</th></tr></thead>
          <tbody>{pages.map(p => <tr key={p.url} className="border-t border-border"><td className="max-w-[220px] truncate p-2">{new URL(p.url).pathname}</td><td className="max-w-[240px] truncate p-2">{p.title || "—"}</td><td className="p-2">{p.h1.length}</td><td className="p-2">{p.words}</td><td className="p-2">{p.internalLinks}/{p.externalLinks}</td><td className="p-2">{p.noindex ? "noindex" : p.status}</td></tr>)}</tbody></table></div>
      </section>
    </>}
    <section className="rounded-md border border-border p-4"><div className="flex items-center gap-2"><Plug className="h-4 w-4" /><h2 className="font-semibold">Search performance and keywords</h2><Badge variant="outline">Not configured</Badge></div>
      <p className="mt-2 text-sm text-muted-foreground">Clicks, impressions, positions and keyword data appear here only after Google Search Console is connected. Nothing is estimated in the meantime.</p></section>
  </div>;
}
function Stat({ label, value }: { label: string; value: string }) { return <div className="rounded-md border border-border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold">{value}</p></div>; }
