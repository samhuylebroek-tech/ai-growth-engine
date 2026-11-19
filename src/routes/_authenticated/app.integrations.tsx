import { pageHead } from "@/lib/page-head";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Plug, ArrowUpRight, Globe2, FileText, Search } from "lucide-react";
import { CONNECTORS } from "@/lib/registry/connectors";
import { PageHeader, StatusChip } from "@/components/app/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { READ_ONLY_METRICS, type ReadOnlyConnector } from "@/lib/integrations/read-only";
import { growthDb, isNotInstalled, retryUnlessNotInstalled, CONNECTORS_NOT_INSTALLED } from "@/lib/pending-schema";
import { can } from "@/lib/permissions";
import { useServerFn } from "@tanstack/react-start";
import { integrationsAvailability } from "@/lib/integrations.functions";
import { ReadOnlyConnection, type ConnectionInfo, type ImportRun } from "@/components/integrations/read-only-connection";
export const Route = createFileRoute("/_authenticated/app/integrations")({ head: () => pageHead("Data sources", "Available research sources and integration configuration."), component: Integrations });
function Integrations() {
 const [filter,setFilter] = useState("all"); const [search,setSearch] = useState("");
 const o = useOrg();
 const connections = useQuery({ queryKey: ["connector-status", o.org?.id, o.workspace?.id], enabled: !!o.org && !!o.workspace, queryFn: async () => {
  const full = await growthDb.from("connector_connections").select("connector_key,status,account_label,last_sync_at,last_error,last_checked_at").eq("org_id", o.org!.id).eq("workspace_id", o.workspace!.id);
  if (!full.error) return { installed: true, rows: new Map((full.data ?? []).map(c => [c.connector_key, c as ConnectionInfo] as const)) };
  if (!isNotInstalled(full.error)) throw full.error;
  const r = await supabase.from("connector_connections").select("connector_key,status").eq("org_id", o.org!.id).eq("workspace_id", o.workspace!.id);
  if (r.error) throw r.error;
  return { installed: false, rows: new Map((r.data ?? []).map(c => [c.connector_key, { ...c, account_label: null, last_sync_at: null, last_error: null, last_checked_at: null }] as const)) };
 } });
 const runs = useQuery({ queryKey: ["connector-runs", o.workspace?.id], enabled: !!o.workspace && connections.data?.installed === true, retry: retryUnlessNotInstalled, queryFn: async () => {
  const r = await growthDb.from("connector_import_runs").select("id,connector_key,status,created_count,corrected_count,unchanged_count,skipped_count,error,started_at").eq("workspace_id", o.workspace!.id).order("started_at", { ascending: false }).limit(40);
  if (r.error) throw r.error; return (r.data ?? []) as ImportRun[];
 } });
 const tracked = useQuery({ queryKey: ["tracked-metric-keys", o.workspace?.id], enabled: !!o.workspace && connections.data?.installed === true, retry: retryUnlessNotInstalled, queryFn: async () => {
  const r = await growthDb.from("metric_definitions").select("key").eq("workspace_id", o.workspace!.id).eq("archived", false).limit(500);
  if (r.error) throw r.error; return new Set((r.data ?? []).map(m => m.key));
 } });
 const availability = useServerFn(integrationsAvailability);
 const google = useQuery({ queryKey: ["integrations-availability"], queryFn: () => availability(), staleTime: 300_000 });
 const statusOf = (key: string, implemented: boolean) => implemented ? "implemented" : connections.data?.rows.get(key)?.status ?? "not_configured";
 const manage = can(o.workspaceRole, "integrations.manage"); const importer = can(o.workspaceRole, "ai.use");
 const categories = [...new Set(CONNECTORS.map(c => c.category))];
 const items = CONNECTORS.filter(c => (filter === "all" || c.category === filter) && `${c.name} ${c.description}`.toLowerCase().includes(search.toLowerCase()));
 return <><PageHeader title="Data sources" description="A stronger business picture starts with reliable sources." /><div className="mb-8 grid gap-6 border-y border-border py-6 md:grid-cols-2">{CONNECTORS.filter(c => c.status === "implemented").map(c => <div key={c.key} className="flex items-start gap-3">{c.key === "website" ? <Globe2 className="h-5 w-5 shrink-0 text-primary" /> : <FileText className="h-5 w-5 shrink-0 text-chart-2" />}<div><h2 className="text-sm font-semibold">{c.name}</h2><p className="mt-1 text-xs text-muted-foreground">{c.description}</p><Button variant="link" size="sm" className="mt-2 px-0" asChild><Link to={c.key === "website" ? "/app/onboarding" : "/app/documents"}>{c.key === "website" ? "Research website" : "Manage documents"}<ArrowUpRight /></Link></Button></div></div>)}</div><div className="mb-6 flex flex-wrap items-center gap-3"><div className="flex items-center gap-2"><Search className="h-4 w-4 text-muted-foreground" /><Input aria-label="Search data sources" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search sources…" className="max-w-xs" /></div><select aria-label="Source category" className="rounded-md border border-border bg-card px-3 text-xs" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All categories</option>{categories.map(c => <option key={c}>{c}</option>)}</select></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{items.map(c => <article key={c.key} className="rounded-lg border border-border bg-card p-5"><div className="mb-4 flex items-center justify-between gap-3"><Plug className="h-5 w-5 text-muted-foreground" /><StatusChip status={statusOf(c.key, c.status === "implemented")} /></div><h3 className="text-sm font-semibold">{c.name}</h3><p className="mt-1 text-[10px] text-muted-foreground">{c.category}</p><p className="mt-3 text-xs leading-relaxed text-muted-foreground">{c.description}</p>{c.key in READ_ONLY_METRICS && (connections.data?.installed && o.workspace
  ? <ReadOnlyConnection connector={c.key as ReadOnlyConnector} name={c.name} workspaceId={o.workspace.id} connection={connections.data.rows.get(c.key) ?? null} runs={(runs.data ?? []).filter(r => r.connector_key === c.key)} trackedKeys={tracked.data ?? new Set()} canManage={manage} canImport={importer} googleReady={google.data?.google === true} />
  : <div className="mt-4 border-t border-border pt-3 text-[11px] text-muted-foreground"><p className="font-medium text-foreground">Read-only · would import as "imported" results</p><p className="mt-1">{READ_ONLY_METRICS[c.key as ReadOnlyConnector].map(m => m.label).join(" · ")}</p><p className="mt-1">Nothing is changed in {c.name}. Needs: {c.requires}.</p>{connections.data && !connections.data.installed && <p className="mt-1">{CONNECTORS_NOT_INSTALLED}</p>}</div>)}{c.status === "planned" && !(c.key in READ_ONLY_METRICS) && <p className="mt-4 border-t border-border pt-3 text-[11px] text-muted-foreground">Connection setup is not available yet.</p>}{c.status === "implemented" && <Button variant="link" size="sm" className="mt-3 px-0" asChild><Link to={c.key === "website" ? "/app/onboarding" : "/app/documents"}>Open source <ArrowUpRight /></Link></Button>}</article>)}</div>{!items.length && <p className="py-10 text-sm text-muted-foreground">No sources match these filters.</p>}</>;
}
