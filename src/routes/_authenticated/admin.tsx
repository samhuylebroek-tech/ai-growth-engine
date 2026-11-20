import { localHead } from "@/lib/page-head";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getOwnerOverview } from "@/lib/admin.functions";
import { PageHeader, Panel, StatusChip } from "@/components/app/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ ...localHead("owner"), meta: [...localHead("owner").meta, { name: "robots", content: "noindex" }] }),
  component: Admin,
});

const eur = (n: number) => `€${n.toFixed(n < 10 ? 2 : 0)}`;

function Admin() {
  const fn = useServerFn(getOwnerOverview); const qc = useQueryClient();
  const q = useQuery({ queryKey: ["owner"], queryFn: () => fn() });
  const [grant, setGrant] = useState<Record<string, string>>({});
  if (q.isLoading) return <div className="p-10 text-sm text-muted-foreground">Loading…</div>;
  if (!q.data?.ok) return <div className="p-10"><p className="text-sm">{q.data?.error ?? "This area requires Platform Owner access."}</p><Link to="/app" className="text-sm text-primary">Back to app</Link></div>;
  const { rows, totals, plans } = q.data;

  async function setPlan(orgId: string, planKey: string) {
    const { error } = await supabase.from("subscriptions").update({ plan_key: planKey, status: planKey === "trial" ? "trialing" : "active" }).eq("org_id", orgId);
    if (error) toast.error("Not allowed"); else { await supabase.rpc("log_audit", { _org: orgId, _action: "subscription.plan_changed", _target_type: "organization", _target_id: orgId, _metadata: { plan: planKey, manual: true } }); toast.success("Plan updated (no payment taken)"); qc.invalidateQueries({ queryKey: ["owner"] }); }
  }
  async function grantCredits(orgId: string) {
    const n = parseInt(grant[orgId] ?? "", 10); if (!n) return;
    const { error } = await supabase.rpc("admin_grant_credits", { _org: orgId, _amount: n, _note: "owner center" });
    if (error) toast.error("Not allowed"); else { toast.success("Credits adjusted"); setGrant({ ...grant, [orgId]: "" }); }
  }
  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <Link to="/app" className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to app</Link>
      <PageHeader title="Owner control center" description="Platform-wide commercial overview. Revenue figures are configured plan prices, not collected payments — billing is not live." />
      <div className="grid gap-4 md:grid-cols-5">
        <Panel><div className="text-xs text-muted-foreground">Organizations</div><div className="mt-1 font-display text-2xl font-bold">{totals.orgs}</div></Panel>
        <Panel><div className="text-xs text-muted-foreground">On trial</div><div className="mt-1 font-display text-2xl font-bold">{totals.trialing}</div></Panel>
        <Panel><div className="text-xs text-muted-foreground">Active paid plans</div><div className="mt-1 font-display text-2xl font-bold">{totals.active}</div></Panel>
        <Panel><div className="text-xs text-muted-foreground">Configured MRR (est.)</div><div className="mt-1 font-display text-2xl font-bold">{eur(totals.configuredMrr)}</div></Panel>
        <Panel><div className="text-xs text-muted-foreground">AI cost, 30d (est.)</div><div className="mt-1 font-display text-2xl font-bold">{eur(totals.aiCost30d)}</div><div className="text-xs text-muted-foreground">{totals.aiCalls30d} calls</div></Panel>
      </div>
      <h2 className="mb-3 mt-10 font-semibold">Organizations</h2>
      <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full text-sm"><thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="px-4 py-2">Organization</th><th className="px-4 py-2">Plan</th><th className="px-4 py-2">Status</th><th className="px-4 py-2 text-right">MRR</th><th className="px-4 py-2 text-right">AI cost 30d</th><th className="px-4 py-2 text-right">Margin</th><th className="px-4 py-2">Credits</th></tr></thead>
        <tbody className="divide-y divide-border">{rows.map((r) => (
          <tr key={r.id}><td className="px-4 py-2.5"><div className="font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</div></td>
            <td className="px-4 py-2.5"><select className="rounded-md border border-input bg-background px-2 py-1 text-xs" value={r.plan ?? ""} onChange={(e) => setPlan(r.id, e.target.value)}>{plans.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</select></td>
            <td className="px-4 py-2.5">{r.subStatus && <StatusChip status={r.subStatus} />}</td>
            <td className="px-4 py-2.5 text-right">{eur(r.configuredMrr)}</td><td className="px-4 py-2.5 text-right">{eur(r.aiCost30d)}</td>
            <td className={`px-4 py-2.5 text-right ${r.margin30d < 0 ? "text-destructive" : ""}`}>{eur(r.margin30d)}</td>
            <td className="px-4 py-2.5"><div className="flex gap-1"><Input className="h-8 w-20" type="number" placeholder="±" value={grant[r.id] ?? ""} onChange={(e) => setGrant({ ...grant, [r.id]: e.target.value })} /><Button size="sm" variant="outline" onClick={() => grantCredits(r.id)}>Apply</Button></div></td></tr>
        ))}</tbody></table></div>
      <p className="mt-4 text-xs text-muted-foreground">Margin = configured plan price − estimated AI provider cost. Platform cost allocation is not yet included.</p>
    </div>
  );
}
