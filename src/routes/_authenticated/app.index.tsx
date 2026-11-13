import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, CheckSquare, Coins, Building2, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { PageHeader, Panel, StatusChip } from "@/components/app/status";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/app/")({ component: Overview });

function Overview() {
  const o = useOrg(); const orgId = o.org?.id; const wsId = o.workspace?.id;
  const q = useQuery({
    queryKey: ["overview", orgId, wsId], enabled: !!orgId && !!wsId,
    queryFn: async () => {
      const [bal, sub, pend, bp, facts, runs] = await Promise.all([
        supabase.rpc("credit_balance", { _org: orgId! }),
        supabase.from("subscriptions").select("plan_key,status,trial_ends_at").eq("org_id", orgId!).maybeSingle(),
        supabase.from("approvals").select("id", { count: "exact", head: true }).eq("org_id", orgId!).eq("status", "pending"),
        supabase.from("business_profiles").select("onboarding_completed_at,description,objectives").eq("workspace_id", wsId!).maybeSingle(),
        supabase.from("business_facts").select("id", { count: "exact", head: true }).eq("workspace_id", wsId!),
        supabase.from("agent_runs").select("id,agent_key,status,summary,created_at").eq("org_id", orgId!).order("created_at", { ascending: false }).limit(5),
      ]);
      return { balance: bal.data ?? 0, sub: sub.data, pending: pend.count ?? 0, bp: bp.data, facts: facts.count ?? 0, runs: runs.data ?? [] };
    },
  });
  const d = q.data;
  const objectives = (d?.bp?.objectives as string[] | undefined) ?? [];
  const trialDays = d?.sub?.trial_ends_at ? Math.max(0, Math.ceil((new Date(d.sub.trial_ends_at).getTime() - Date.now()) / 864e5)) : null;

  return (
    <>
      <PageHeader title={`Good to see you`} description={`${o.org?.name} · ${o.workspace?.name}`}
        actions={<Button asChild><Link to="/app/growth-officer"><Sparkles className="mr-1.5 h-4 w-4" /> Ask the Growth Officer</Link></Button>} />
      {d && !d.bp?.onboarding_completed_at && (
        <Panel className="mb-6 flex flex-wrap items-center justify-between gap-4 border-primary/30 bg-primary/5">
          <div><div className="font-semibold">Finish setting up your business profile</div><p className="text-sm text-muted-foreground">The Growth Officer gives far better advice once it knows your business.</p></div>
          <Button asChild variant="outline"><Link to="/app/onboarding">Continue setup <ArrowRight className="ml-1 h-4 w-4" /></Link></Button>
        </Panel>
      )}
      <div className="grid gap-4 md:grid-cols-4">
        <Stat icon={<Coins className="h-4 w-4" />} label="AI credits left" value={d ? d.balance.toLocaleString() : "—"} />
        <Stat icon={<CheckSquare className="h-4 w-4" />} label="Pending approvals" value={d ? String(d.pending) : "—"} to="/app/approvals" />
        <Stat icon={<Building2 className="h-4 w-4" />} label="Business facts" value={d ? String(d.facts) : "—"} to="/app/profile" />
        <Stat label="Plan" value={d?.sub ? (d.sub.plan_key === "trial" ? "Free trial" : d.sub.plan_key) : "—"} sub={trialDays !== null && d?.sub?.status === "trialing" ? `${trialDays} days left` : undefined} to="/app/billing" />
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Panel>
          <h2 className="font-semibold">Objectives</h2>
          {objectives.length ? <ul className="mt-3 space-y-2 text-sm">{objectives.map((x) => <li key={x} className="flex gap-2"><span className="text-primary">•</span>{x}</li>)}</ul>
            : <p className="mt-2 text-sm text-muted-foreground">No objectives yet. Add them in your business profile.</p>}
        </Panel>
        <Panel>
          <h2 className="font-semibold">Recent AI activity</h2>
          {d?.runs.length ? <ul className="mt-3 divide-y divide-border text-sm">{d.runs.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2"><span className="truncate text-muted-foreground">{r.summary ?? r.agent_key}</span><StatusChip status={r.status} /></li>
          ))}</ul> : <p className="mt-2 text-sm text-muted-foreground">Nothing yet. Ask the Growth Officer a question to get started.</p>}
        </Panel>
      </div>
      <p className="mt-8 text-xs text-muted-foreground">Performance metrics (revenue, traffic, leads) appear here once you connect data sources. No sample numbers are shown.</p>
    </>
  );
}

function Stat({ icon, label, value, sub, to }: { icon?: React.ReactNode; label: string; value: string; sub?: string | undefined; to?: "/app/approvals" | "/app/profile" | "/app/billing" }) {
  const body = (
    <Panel className="h-full transition-colors hover:border-primary/30">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
      <div className="mt-2 font-display text-2xl font-bold capitalize">{value}</div>
      {sub && <div className="text-xs text-warning">{sub}</div>}
    </Panel>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}
