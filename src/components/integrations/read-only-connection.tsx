// Read-only connection panel for one data source: health, connect/disconnect (admins), import (members),
// which provided values are tracked as metrics, and the import history.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/app/status";
import { growthDb } from "@/lib/pending-schema";
import { READ_ONLY_METRICS, type ReadOnlyConnector } from "@/lib/integrations/read-only";
import { connectTokenIntegration, disconnectIntegration, startGoogleIntegration, syncIntegration } from "@/lib/integrations.functions";

export type ConnectionInfo = { connector_key: string; status: string; account_label: string | null; last_sync_at: string | null; last_error: string | null; last_checked_at: string | null };
export type ImportRun = { id: string; connector_key: string; status: string; created_count: number; corrected_count: number; unchanged_count: number; skipped_count: number; error: string | null; started_at: string };
type Props = { connector: ReadOnlyConnector; name: string; workspaceId: string; connection: ConnectionInfo | null; runs: ImportRun[]; trackedKeys: Set<string>; canManage: boolean; canImport: boolean; googleReady: boolean };

const when = (v: string | null) => v ? new Date(v).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "never";
const isGoogle = (c: ReadOnlyConnector) => c === "google_analytics" || c === "search_console";

export function ReadOnlyConnection({ connector, name, workspaceId, connection, runs, trackedKeys, canManage, canImport, googleReady }: Props) {
  const qc = useQueryClient();
  const connectToken = useServerFn(connectTokenIntegration), startGoogle = useServerFn(startGoogleIntegration), sync = useServerFn(syncIntegration), disconnect = useServerFn(disconnectIntegration);
  const [open, setOpen] = useState(false); const [secret, setSecret] = useState(""); const [extra, setExtra] = useState(connector === "hubspot" ? "EUR" : ""); const [busy, setBusy] = useState(false); const [months, setMonths] = useState(3);
  const [currency, setCurrency] = useState("EUR");
  const status = connection?.status ?? "not_configured";
  const linked = status !== "not_configured" && status !== "disabled";
  const refresh = () => { qc.invalidateQueries({ queryKey: ["connector-status"] }); qc.invalidateQueries({ queryKey: ["connector-runs"] }); qc.invalidateQueries({ queryKey: ["performance"] }); qc.invalidateQueries({ queryKey: ["tracked-metric-keys"] }); };
  async function run<T>(fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, done: (d: T) => void) {
    setBusy(true);
    try { const r = await fn(); if (r.ok) done(r.data); else toast.error(r.error); } catch { toast.error("The request did not complete. Nothing was changed."); } finally { setBusy(false); refresh(); }
  }
  async function connect(e: React.FormEvent) {
    e.preventDefault();
    if (isGoogle(connector)) return run(() => startGoogle({ data: { workspaceId, connector: connector as "google_analytics" | "search_console", origin: window.location.origin, property: extra.trim() } }), d => { window.location.assign(d.url); });
    return run(() => connectToken({ data: { workspaceId, connector: connector as "stripe" | "hubspot", token: secret.trim(), currency: (extra || "EUR").toUpperCase() } }), d => {
      setSecret(""); setOpen(false);
      if (d.status === "connected") toast.success(`${name} connected with read-only access.`); else toast.error(`${name} is linked but lacks read permission: ${d.missing.join(", ")}.`);
    });
  }
  async function track(key: string, label: string, unit: string) {
    const metricKey = unit === "currency" ? `${key}_${currency.toLowerCase()}` : key;
    setBusy(true);
    const r = await growthDb.rpc("define_metric", { _workspace: workspaceId, _key: metricKey, _label: unit === "currency" ? `${label.replace(" (per currency)", "")} (${currency})` : label, _unit: unit, _currency: unit === "currency" ? currency : null, _direction: key === "gsc_position" ? "decrease" : "increase", _goal: null, _initiative: null });
    setBusy(false);
    if (r.error) toast.error(r.error.message.includes("exists") ? "This value is already tracked." : "The metric could not be created."); else toast.success(`${label} is now tracked in Performance.`);
    refresh();
  }
  const provided = READ_ONLY_METRICS[connector];
  const tracked = (key: string, unit: string) => unit === "currency" ? [...trackedKeys].some(k => k.startsWith(`${key}_`)) : trackedKeys.has(key);
  return (
    <div className="mt-4 space-y-3 border-t border-border pt-3 text-[11px] text-muted-foreground">
      {connection?.account_label && <p>{connection.account_label}</p>}
      <p className="font-medium text-foreground">Read-only · imported results are labelled "imported from {name}"</p>
      {linked && <p>Last import {when(connection?.last_sync_at ?? null)} · last check {when(connection?.last_checked_at ?? null)}</p>}
      {connection?.last_error && <p role="alert" className="text-destructive">{connection.last_error}</p>}
      <ul className="space-y-1">{provided.map(m => <li key={m.key} className="flex items-center justify-between gap-2"><span>{m.label}</span>{tracked(m.key, m.unit) ? <span className="text-success">Tracked</span> : canImport ? <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" disabled={busy} onClick={() => track(m.key, m.label, m.unit)}>Track</Button> : <span>Not tracked</span>}</li>)}</ul>
      {provided.some(m => m.unit === "currency") && canImport && <label className="flex items-center gap-2">Currency for new revenue metrics <Input aria-label={`${name} currency`} value={currency} maxLength={3} onChange={e => setCurrency(e.target.value.toUpperCase())} className="h-7 w-16 text-[11px]" /></label>}
      <div className="flex flex-wrap gap-2">
        {status === "connected" && canImport && <><select aria-label={`${name} months to import`} value={months} onChange={e => setMonths(Number(e.target.value))} className="h-8 rounded-md border border-border bg-background px-2">{[1, 3, 6, 12].map(n => <option key={n} value={n}>Last {n} complete month{n > 1 ? "s" : ""}</option>)}</select>
          <Button size="sm" disabled={busy} onClick={() => run(() => sync({ data: { workspaceId, connector, months, requestKey: crypto.randomUUID() } }), d => { const t = `${name}: ${d.created} new, ${d.corrected} corrected, ${d.unchanged} unchanged${d.skipped ? `, ${d.skipped} skipped` : ""}.`; if (d.status === "failed") toast.error(d.message ?? "Import failed."); else toast.success(d.untracked.length ? `${t} Not tracked: ${d.untracked.length} value types.` : t); })}>Import now</Button></>}
        {canManage && (!linked || status !== "connected") && <Button size="sm" variant="outline" disabled={busy || (isGoogle(connector) && !googleReady)} onClick={() => setOpen(v => !v)}>{linked ? "Reconnect" : "Connect"}</Button>}
        {canManage && linked && <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => disconnect({ data: { workspaceId, connector } }), () => toast.success(`${name} disconnected. Imported history is kept.`))}>Disconnect</Button>}
      </div>
      {isGoogle(connector) && !googleReady && canManage && <p>Google sign-in for data sources is not configured for this environment.</p>}
      {open && <form onSubmit={connect} className="space-y-2 rounded-md border border-border p-3">
        {isGoogle(connector)
          ? <label className="block">{connector === "google_analytics" ? "Property ID (numbers only)" : "Search Console property (https://… or sc-domain:…)"}<Input value={extra} onChange={e => setExtra(e.target.value)} required className="mt-1 h-8 text-xs" /></label>
          : <><label className="block">{connector === "stripe" ? "Restricted key with read-only access (rk_…)" : "Private app token with deal read access (pat-…)"}<Input type="password" autoComplete="off" value={secret} onChange={e => setSecret(e.target.value)} required className="mt-1 h-8 text-xs" /></label>
            {connector === "hubspot" && <label className="block">Currency for deals without one<Input value={extra} maxLength={3} onChange={e => setExtra(e.target.value.toUpperCase())} className="mt-1 h-8 w-20 text-xs" /></label>}
            <p>The key is checked with one read-only request, stored encrypted and never shown again.</p></>}
        <Button size="sm" type="submit" disabled={busy}>{isGoogle(connector) ? "Continue to Google" : "Check and connect"}</Button>
      </form>}
      {runs.length > 0 && <div><p className="font-medium text-foreground">Import history</p><ul className="mt-1 space-y-1">{runs.slice(0, 5).map(r => <li key={r.id} className="flex flex-wrap items-center gap-2"><StatusChip status={r.status} /><span>{when(r.started_at)}</span><span>{r.created_count} new · {r.corrected_count} corrected · {r.unchanged_count} unchanged{r.skipped_count ? ` · ${r.skipped_count} skipped` : ""}</span>{r.error && <span className="w-full text-muted-foreground">{r.error}</span>}</li>)}</ul></div>}
    </div>
  );
}
