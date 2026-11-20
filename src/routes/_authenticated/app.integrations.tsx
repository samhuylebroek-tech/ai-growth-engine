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
import { growthDb, isNotInstalled, retryUnlessNotInstalled } from "@/lib/pending-schema";
import { can } from "@/lib/permissions";
import { useServerFn } from "@tanstack/react-start";
import { integrationsAvailability } from "@/lib/integrations.functions";
import { useI18n } from "@/lib/i18n";
import { MESSAGES, type MessageKey } from "@/lib/i18n/messages";
import { ReadOnlyConnection, type ConnectionInfo, type ImportRun } from "@/components/integrations/read-only-connection";
export const Route = createFileRoute("/_authenticated/app/integrations")({ head: () => pageHead("Data sources", "Available research sources and integration configuration."), component: Integrations });
function Integrations() {
 const [filter,setFilter] = useState("all"); const [search,setSearch] = useState("");
 const o = useOrg(); const { t: tx } = useI18n();
 const opt = (k: string, fallback: string) => (k in MESSAGES.en ? tx(k as MessageKey) : fallback);
 const catLabel = (c: string) => opt(`pages.int.cat.${c.toLowerCase().replace(/[^a-z]+/g, "_")}`, c);
 const nameOf = (c: { key: string; name: string }) => opt(`pages.int.n.${c.key}`, c.name);
 const descOf = (c: { key: string; description: string }) => opt(`pages.int.c.${c.key}`, c.description);
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
 const items = CONNECTORS.filter(c => (filter === "all" || c.category === filter) && `${c.name} ${c.description} ${nameOf(c)} ${descOf(c)}`.toLowerCase().includes(search.toLowerCase()));
 return <><PageHeader title={tx("pages.int.title")} description={tx("pages.int.desc")} /><div className="mb-8 grid gap-6 border-y border-border py-6 md:grid-cols-2">{CONNECTORS.filter(c => c.status === "implemented").map(c => <div key={c.key} className="flex items-start gap-3">{c.key === "website" ? <Globe2 className="h-5 w-5 shrink-0 text-primary" /> : <FileText className="h-5 w-5 shrink-0 text-chart-2" />}<div><h2 className="text-sm font-semibold">{nameOf(c)}</h2><p className="mt-1 text-xs text-muted-foreground">{descOf(c)}</p><Button variant="link" size="sm" className="mt-2 px-0" asChild><Link to={c.key === "website" ? "/app/onboarding" : "/app/documents"}>{c.key === "website" ? tx("pages.int.researchWebsite") : tx("pages.int.manageDocs")}<ArrowUpRight /></Link></Button></div></div>)}</div><div className="mb-6 flex flex-wrap items-center gap-3"><div className="flex items-center gap-2"><Search className="h-4 w-4 text-muted-foreground" /><Input aria-label={tx("pages.int.search")} value={search} onChange={e => setSearch(e.target.value)} placeholder={tx("pages.int.searchPh")} className="max-w-xs" /></div><select aria-label={tx("pages.int.category")} className="rounded-md border border-border bg-card px-3 text-xs" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">{tx("pages.int.allCategories")}</option>{categories.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}</select></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{items.map(c => <article key={c.key} className="rounded-lg border border-border bg-card p-5"><div className="mb-4 flex items-center justify-between gap-3"><Plug className="h-5 w-5 text-muted-foreground" /><StatusChip status={statusOf(c.key, c.status === "implemented")} /></div><h3 className="text-sm font-semibold">{nameOf(c)}</h3><p className="mt-1 text-[10px] text-muted-foreground">{catLabel(c.category)}</p><p className="mt-3 text-xs leading-relaxed text-muted-foreground">{descOf(c)}</p>{c.key in READ_ONLY_METRICS && (connections.data?.installed && o.workspace
  ? <ReadOnlyConnection connector={c.key as ReadOnlyConnector} name={nameOf(c)} workspaceId={o.workspace.id} connection={connections.data.rows.get(c.key) ?? null} runs={(runs.data ?? []).filter(r => r.connector_key === c.key)} trackedKeys={tracked.data ?? new Set()} canManage={manage} canImport={importer} googleReady={google.data?.google === true} />
  : <div className="mt-4 border-t border-border pt-3 text-[11px] text-muted-foreground"><p className="font-medium text-foreground">{tx("pages.int.readOnlyWould")}</p><p className="mt-1">{READ_ONLY_METRICS[c.key as ReadOnlyConnector].map(m => opt(`pages.int.m.${m.key}`, m.label)).join(" · ")}</p><p className="mt-1">{tx("pages.int.nothingChanged", { name: nameOf(c), req: c.requires ?? "" })}</p>{connections.data && !connections.data.installed && <p className="mt-1">{tx("pages.int.notInstalled")}</p>}</div>)}{c.status === "planned" && !(c.key in READ_ONLY_METRICS) && <p className="mt-4 border-t border-border pt-3 text-[11px] text-muted-foreground">{tx("pages.int.notAvailable")}</p>}{c.status === "implemented" && <Button variant="link" size="sm" className="mt-3 px-0" asChild><Link to={c.key === "website" ? "/app/onboarding" : "/app/documents"}>{tx("pages.int.openSource")} <ArrowUpRight /></Link></Button>}</article>)}</div>{!items.length && <p className="py-10 text-sm text-muted-foreground">{tx("pages.int.noMatch")}</p>}</>;
}
