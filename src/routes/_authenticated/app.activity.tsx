import { pageHead } from "@/lib/page-head";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { AGENTS } from "@/lib/registry/agents";
import { PageHeader, StatusChip, EmptyState } from "@/components/app/status";

export const Route = createFileRoute("/_authenticated/app/activity")({ head: () => pageHead("Activity and audit", "Recorded AI runs and audit history."), component: ActivityPage });

function ActivityPage() {
  const o = useOrg(); const orgId = o.org?.id;
  const runs = useQuery({ queryKey: ["runs", orgId, o.workspace?.id], enabled: !!orgId && !!o.workspace, queryFn: async () => {
    if (!orgId || !o.workspace) return [];
    const result = await supabase.from("agent_runs").select("*").eq("org_id", orgId).eq("workspace_id", o.workspace.id).order("created_at", { ascending: false }).limit(100);
    if (result.error) throw result.error; return result.data ?? [];
  } });
  const audit = useQuery({ queryKey: ["audit", orgId], enabled: !!orgId && can(o.role, "audit.read"), queryFn: async () => (await supabase.from("audit_logs").select("*").eq("org_id", orgId!).order("created_at", { ascending: false }).limit(100)).data ?? [] });
  const agentName = (k: string) => AGENTS.find((a) => a.key === k)?.name ?? k;
  return (
    <>
      <PageHeader title="AI activity" description="Every AI run is recorded: which agent, what it did and whether it succeeded." />
      {runs.isLoading && <p role="status" className="py-6 text-sm text-muted-foreground">Loading activity…</p>}
      {runs.isError && <p role="alert" className="text-sm text-destructive">Activity could not load.</p>}
      {runs.data?.length ? (
        <div className="overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[640px] text-sm"><thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="px-4 py-2">When</th><th className="px-4 py-2">Agent</th><th className="px-4 py-2">Summary</th><th className="px-4 py-2">Status</th></tr></thead>
          <tbody className="divide-y divide-border">{runs.data.map((r) => <tr key={r.id}><td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{new Date(r.created_at).toLocaleString()}</td><td className="px-4 py-2.5">{agentName(r.agent_key)}</td><td className="max-w-md truncate px-4 py-2.5 text-muted-foreground">{r.error ?? r.summary ?? "—"}</td><td className="px-4 py-2.5"><StatusChip status={r.status} /></td></tr>)}</tbody></table></div>
      ) : <EmptyState title="No AI runs yet" text="Runs appear here as soon as you use the Growth Officer or extract facts." />}
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
