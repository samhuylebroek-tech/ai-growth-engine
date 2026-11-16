import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { hasRole } from "@/lib/permissions";
import { supabase } from "@/integrations/supabase/client";
import { STAGES, STAGE_LABELS, pipelineSummary, nextStage } from "@/lib/pipeline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const sel = "h-9 rounded-md border border-input bg-background px-2 text-sm";
const money = (n: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

export function Pipeline() {
  const { workspace, org, workspaceRole, loading } = useOrg();
  if (loading) return <p className="p-6 text-muted-foreground">Loading…</p>;
  if (!workspace || !org) return <p className="p-6 text-muted-foreground">Choose a workspace to manage your pipeline.</p>;
  return <Board key={workspace.id} orgId={org.id} wsId={workspace.id} canEdit={hasRole(workspaceRole, "member")} />;
}

function Board({ orgId, wsId, canEdit }: { orgId: string; wsId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ["pipeline", wsId], queryFn: async () => {
    const [c, d, g] = await Promise.all([
      supabase.from("crm_contacts").select("*").eq("workspace_id", wsId).eq("status", "active").order("name").limit(500),
      supabase.from("crm_deals").select("*").eq("workspace_id", wsId).order("updated_at", { ascending: false }).limit(500),
      supabase.from("growth_goals").select("id,title").eq("workspace_id", wsId).neq("status", "archived").limit(100),
    ]);
    if (c.error || d.error || g.error) throw c.error ?? d.error ?? g.error;
    return { contacts: c.data, deals: d.data, goals: g.data };
  } });
  const refresh = () => qc.invalidateQueries({ queryKey: ["pipeline", wsId] });
  const [tab, setTab] = useState<"deals" | "contacts">("deals");
  const [c, setC] = useState({ name: "", company: "", email: "", phone: "", source: "" });
  const [d, setD] = useState({ title: "", contact: "", value: "", close: "", goal: "" });

  const addContact = async () => {
    if (!c.name.trim()) return void toast.error("Give the contact a name.");
    const r = await supabase.from("crm_contacts").insert({ org_id: orgId, workspace_id: wsId, name: c.name.trim(), company: c.company.trim(), email: c.email.trim(), phone: c.phone.trim(), source: c.source.trim() });
    if (r.error) return void toast.error("Could not save the contact.");
    setC({ name: "", company: "", email: "", phone: "", source: "" }); await refresh();
  };
  const addDeal = async () => {
    if (!d.title.trim()) return void toast.error("Give the deal a name.");
    const value = d.value.trim() === "" ? 0 : Number(d.value);
    if (!Number.isFinite(value) || value < 0) return void toast.error("Enter a valid value.");
    const r = await supabase.from("crm_deals").insert({ org_id: orgId, workspace_id: wsId, title: d.title.trim(), contact_id: d.contact || null, goal_id: d.goal || null, value, expected_close: d.close || null });
    if (r.error) return void toast.error("Could not save the deal.");
    setD({ title: "", contact: "", value: "", close: "", goal: "" }); await refresh();
  };
  const setStage = async (id: string, stage: string) => {
    let lost_reason = "";
    if (stage === "lost") lost_reason = (window.prompt("Why was this deal lost? (optional)") ?? "").slice(0, 500);
    const r = await supabase.from("crm_deals").update({ stage, lost_reason }).eq("id", id).eq("workspace_id", wsId);
    if (r.error) toast.error("Could not update the deal."); await refresh();
  };
  const archiveContact = async (id: string) => {
    const r = await supabase.from("crm_contacts").update({ status: "archived" }).eq("id", id).eq("workspace_id", wsId);
    if (r.error) toast.error("Could not archive."); await refresh();
  };

  if (data.isLoading) return <p className="p-6 text-muted-foreground">Loading pipeline…</p>;
  if (data.error || !data.data) return <p className="p-6 text-destructive">Could not load the pipeline.</p>;
  const { contacts, deals, goals } = data.data;
  const s = pipelineSummary(deals);
  const contactName = (id: string | null) => contacts.find(x => x.id === id)?.name;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold">Sales pipeline</h1>
        <p className="text-sm text-muted-foreground">Contacts and deals you enter yourself. No CRM is connected, so nothing is imported or sent.</p>
      </header>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[["Open value", money(s.open), `${s.openCount} open deals`], ["Won value", money(s.won), `${s.wonCount} won`], ["Lost", String(s.lostCount), "deals"], ["Win rate", s.winRate === null ? "—" : `${s.winRate}%`, "of closed deals"]].map(([l, v, h]) => (
          <div key={l} className="rounded-lg border bg-card p-3"><p className="text-xs text-muted-foreground">{l}</p><p className="text-xl font-semibold">{v}</p><p className="text-xs text-muted-foreground">{h}</p></div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant={tab === "deals" ? "default" : "outline"} size="sm" onClick={() => setTab("deals")}>Deals</Button>
        <Button variant={tab === "contacts" ? "default" : "outline"} size="sm" onClick={() => setTab("contacts")}>Contacts ({contacts.length})</Button>
      </div>

      {tab === "deals" ? (<>
        {canEdit && <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-3">
          <Input aria-label="Deal name" placeholder="Deal name" className="w-full sm:w-56" value={d.title} onChange={e => setD({ ...d, title: e.target.value })} />
          <select aria-label="Contact" className={sel} value={d.contact} onChange={e => setD({ ...d, contact: e.target.value })}><option value="">No contact</option>{contacts.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          <Input aria-label="Value" placeholder="Value (EUR)" inputMode="decimal" className="w-32" value={d.value} onChange={e => setD({ ...d, value: e.target.value })} />
          <Input aria-label="Expected close" type="date" className="w-40" value={d.close} onChange={e => setD({ ...d, close: e.target.value })} />
          <select aria-label="Goal" className={sel} value={d.goal} onChange={e => setD({ ...d, goal: e.target.value })}><option value="">No goal</option>{goals.map(x => <option key={x.id} value={x.id}>{x.title}</option>)}</select>
          <Button size="sm" onClick={addDeal}><Plus className="mr-1 h-4 w-4" />Add deal</Button>
        </div>}
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {STAGES.map(stage => {
            const list = deals.filter(x => x.stage === stage);
            return (
              <section key={stage} className="min-w-0 rounded-lg border bg-muted/40 p-2">
                <h2 className="mb-2 flex items-center justify-between text-sm font-medium">{STAGE_LABELS[stage]}<Badge variant="secondary">{list.length}</Badge></h2>
                <div className="space-y-2">
                  {list.length === 0 && <p className="px-1 text-xs text-muted-foreground">No deals</p>}
                  {list.map(x => { const n = nextStage(x.stage); return (
                    <article key={x.id} className="space-y-1 rounded-md border bg-card p-2 text-sm">
                      <p className="break-words font-medium">{x.title}</p>
                      <p className="text-xs text-muted-foreground">{money(Number(x.value))}{contactName(x.contact_id) ? ` · ${contactName(x.contact_id)}` : ""}{x.expected_close ? ` · close ${x.expected_close}` : ""}</p>
                      {x.stage === "lost" && x.lost_reason && <p className="text-xs text-muted-foreground">Reason: {x.lost_reason}</p>}
                      {canEdit && <div className="flex flex-wrap gap-1 pt-1">
                        {n && <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setStage(x.id, n)}>→ {STAGE_LABELS[n]}</Button>}
                        {x.stage !== "won" && x.stage !== "lost" ? <>
                          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setStage(x.id, "won")}>Won</Button>
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setStage(x.id, "lost")}>Lost</Button>
                        </> : <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setStage(x.id, "negotiation")}>Reopen</Button>}
                      </div>}
                    </article>); })}
                </div>
              </section>
            );
          })}
        </div>
      </>) : (<>
        {canEdit && <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-card p-3">
          <Input aria-label="Contact name" placeholder="Name" className="w-full sm:w-44" value={c.name} onChange={e => setC({ ...c, name: e.target.value })} />
          <Input aria-label="Company" placeholder="Company" className="w-full sm:w-44" value={c.company} onChange={e => setC({ ...c, company: e.target.value })} />
          <Input aria-label="Email" placeholder="Email" type="email" className="w-full sm:w-52" value={c.email} onChange={e => setC({ ...c, email: e.target.value })} />
          <Input aria-label="Phone" placeholder="Phone" className="w-full sm:w-36" value={c.phone} onChange={e => setC({ ...c, phone: e.target.value })} />
          <Input aria-label="Source" placeholder="Source (e.g. website)" className="w-full sm:w-44" value={c.source} onChange={e => setC({ ...c, source: e.target.value })} />
          <Button size="sm" onClick={addContact}><Plus className="mr-1 h-4 w-4" />Add contact</Button>
        </div>}
        {contacts.length === 0 ? <p className="text-sm text-muted-foreground">No contacts yet.</p> :
          <ul className="divide-y rounded-lg border bg-card">
            {contacts.map(x => { const open = deals.filter(y => y.contact_id === x.id && y.stage !== "won" && y.stage !== "lost").length; return (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <div className="min-w-0"><p className="font-medium">{x.name}{x.company ? <span className="text-muted-foreground"> · {x.company}</span> : null}</p>
                  <p className="break-all text-xs text-muted-foreground">{[x.email, x.phone, x.source].filter(Boolean).join(" · ") || "No details"}</p></div>
                <div className="flex items-center gap-2"><Badge variant="outline">{open} open deals</Badge>{canEdit && <Button size="sm" variant="ghost" onClick={() => archiveContact(x.id)}>Archive</Button>}</div>
              </li>); })}
          </ul>}
      </>)}
    </div>
  );
}
