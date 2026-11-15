import { pageHead } from "@/lib/page-head";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDown, ArrowUpRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { AGENTS } from "@/lib/registry/agents";
import { PageHeader, StatusChip, EmptyState } from "@/components/app/status";

export const Route = createFileRoute("/_authenticated/app/activity")({ head: () => pageHead("Activity and audit", "Recorded AI runs and audit history."), component: ActivityPage });

function ActivityPage() {
  const o = useOrg(); const orgId = o.org?.id; const [filter,setFilter] = useState("all"); const [search,setSearch] = useState(""); const [expanded,setExpanded] = useState<string | null>(null);
  const runs = useQuery({ queryKey: ["runs", orgId, o.workspace?.id], enabled: !!orgId && !!o.workspace, queryFn: async () => {
    if (!orgId || !o.workspace) return [];
    const result = await supabase.from("agent_runs").select("*").eq("org_id", orgId).eq("workspace_id", o.workspace.id).order("created_at", { ascending: false }).limit(100);
    if (result.error) throw result.error; return result.data ?? [];
  } });
  const audit = useQuery({ queryKey: ["audit", orgId], enabled: !!orgId && can(o.role, "audit.read"), queryFn: async () => (await supabase.from("audit_logs").select("*").eq("org_id", orgId!).order("created_at", { ascending: false }).limit(100)).data ?? [] });
  const visible = runs.data?.filter(r => (filter === "all" || r.status === filter) && `${r.agent_key} ${r.summary ?? ""}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  const agentName = (k: string) => AGENTS.find((a) => a.key === k)?.name ?? k;
  return (
    <>
      <PageHeader title="Activity & results" description="Recorded work and its outcomes." actions={<Button variant="outline" asChild><Link to="/app/growth-officer">Open saved conversations <ArrowUpRight /></Link></Button>} /><div className="mb-5 flex flex-wrap gap-3"><Input aria-label="Search activity" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search recorded work…" className="max-w-sm" /><select aria-label="Activity status" value={filter} onChange={e => setFilter(e.target.value)} className="rounded-md border border-border bg-card px-3 text-xs"><option value="all">All statuses</option><option value="succeeded">Succeeded</option><option value="failed">Failed</option><option value="running">Running</option></select></div>
      {runs.isLoading && <p role="status" className="py-6 text-sm text-muted-foreground">Loading activity…</p>}
      {runs.isError && <p role="alert" className="text-sm text-destructive">Activity could not load.</p>}
      {visible.length ? <div className="divide-y divide-border border-y border-border">{visible.map(r => <article key={r.id} className="py-4"><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><h2 className="text-sm font-medium">{agentName(r.agent_key)}</h2><time className="mt-1 block text-[10px] text-muted-foreground">{new Date(r.created_at).toLocaleString()}</time></div><StatusChip status={r.status} /><Button variant="ghost" size="icon" aria-label="View run details" title="View run details" aria-expanded={expanded === r.id} onClick={() => setExpanded(expanded === r.id ? null : r.id)}><ChevronDown /></Button></div>{expanded === r.id && <div className="mt-4 whitespace-pre-wrap break-words border-l-2 border-border pl-4 text-sm leading-relaxed text-muted-foreground">{r.error ?? r.summary ?? "No result summary was recorded."}</div>}</article>)}</div> : !runs.isLoading && !runs.isError ? <EmptyState title={runs.data?.length ? "No matching work" : "No AI work recorded yet"} text={runs.data?.length ? "No activity matches these filters." : "Your Growth Officer conversations and document research will be recorded here."} /> : null}
      {can(o.role, "audit.read") && (
        <>
          <h2 className="mb-3 mt-10 font-semibold">Audit log</h2>
          {audit.data?.length ? <div className="divide-y divide-border rounded-lg border border-border text-sm">{audit.data.map((a) => (
            <div key={a.id} className="flex flex-wrap justify-between gap-2 px-4 py-2.5"><span className="font-mono text-xs">{a.action}</span><span className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString()}</span></div>
          ))}</div> : <p className="text-sm text-muted-foreground">No audit entries.</p>}
        </>
      )}
    </>
  );
}
