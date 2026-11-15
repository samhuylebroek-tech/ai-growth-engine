import { pageHead } from "@/lib/page-head";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, ArrowUpRight, CheckSquare, FileText, Target, Plug } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { PageHeader, StatusChip } from "@/components/app/status";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/app/")({ head: () => pageHead("Overview", "Your objectives, approvals, credits and growth activity."), component: Overview });

function Overview() {
 const o = useOrg(); const orgId = o.org?.id; const wsId = o.workspace?.id;
 const q = useQuery({ queryKey: ["overview", orgId, wsId], enabled: !!orgId && !!wsId, queryFn: async () => {
  if (!orgId || !wsId) throw new Error("No workspace selected.");
  if (o.role !== "viewer") { const grant = await supabase.rpc("ensure_monthly_credit_grant", { _org: orgId }); if (grant.error) throw grant.error; }
  const [bal, sub, approvals, bp, facts, runs, docs] = await Promise.all([
   supabase.rpc("credit_balance", { _org: orgId }),
   supabase.from("subscriptions").select("plan_key,status,trial_ends_at").eq("org_id", orgId).maybeSingle(),
   supabase.from("approvals").select("id,title,reasoning,expected_impact,risk,status").eq("org_id", orgId).eq("workspace_id", wsId).eq("status", "pending").order("created_at", { ascending: false }).limit(4),
   supabase.from("business_profiles").select("onboarding_completed_at,objectives").eq("org_id",orgId).eq("workspace_id",wsId).maybeSingle(),
   supabase.from("business_facts").select("id,verified").eq("org_id",orgId).eq("workspace_id",wsId),
   supabase.from("agent_runs").select("id,agent_key,status,summary,created_at").eq("org_id",orgId).eq("workspace_id",wsId).order("created_at", { ascending: false }).limit(5),
   supabase.from("documents").select("id,status").eq("org_id",orgId).eq("workspace_id",wsId),
  ]);
  for (const result of [bal,sub,approvals,bp,facts,runs,docs]) if (result.error) throw result.error;
  return { balance: bal.data, sub: sub.data, approvals: approvals.data ?? [], bp: bp.data, facts: facts.data ?? [], runs: runs.data ?? [], docs: docs.data ?? [] };
 } });
 const d = q.data; const objectives = Array.isArray(d?.bp?.objectives) ? d.bp.objectives.filter((x): x is string => typeof x === "string") : [];
 const confirmed = d?.facts.filter(f => f.verified).length ?? 0; const unconfirmed = d?.facts.filter(f => !f.verified).length ?? 0;
 const failedDocs = d?.docs.filter(doc => doc.status === "failed").length ?? 0;
 const days = d?.sub?.trial_ends_at ? Math.max(0,Math.ceil((new Date(d.sub.trial_ends_at).getTime()-Date.now())/864e5)) : null;
 return <>
  <PageHeader title="Your growth overview" description={`${o.workspace?.name ?? "Workspace"} · ${o.org?.name ?? ""}`} actions={<Button asChild><Link to="/app/growth-officer"><Sparkles /> Ask Growth Officer</Link></Button>} />
  {q.isLoading && <div role="status" className="py-10 text-sm text-muted-foreground">Loading your business overview…</div>}
  {q.isError && <div role="alert" className="mb-6 flex flex-wrap items-center gap-3 text-sm text-destructive">Your overview could not load.<Button variant="outline" size="sm" onClick={() => q.refetch()}>Retry</Button></div>}
  {d && <>
   <div className="grid grid-cols-2 gap-x-6 gap-y-5 border-y border-border py-5 lg:grid-cols-4">
    <Metric label="Organization credits" value={d.balance === null ? "Unavailable" : d.balance.toLocaleString()} note="Credit ledger · available balance" to="/app/billing" />
    <Metric label="Confirmed facts" value={String(confirmed)} note="Knowledge base · user-confirmed" to="/app/profile" />
    <Metric label="Needs review" value={String(unconfirmed)} note="Knowledge base · unconfirmed claims" to="/app/profile" />
    <Metric label="Current plan" value={d.sub?.plan_key === "trial" ? "Free trial" : d.sub?.plan_key ?? "Not configured"} note={days !== null && d.sub?.status === "trialing" ? `${days} trial days remaining` : d.sub?.status ?? "No active subscription"} to="/app/billing" />
   </div>
   <div className="mt-8 grid gap-9 lg:grid-cols-[1.4fr_1fr]">
    <section className="min-w-0"><div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">Your next moves</h2><Button variant="ghost" size="sm" asChild><Link to="/app/approvals">All approvals <ArrowUpRight /></Link></Button></div>
     {!d.bp?.onboarding_completed_at && <Action icon={<Target />} title="Complete your business profile" detail="Start with your website and confirm the findings." to="/app/onboarding" />}
     {unconfirmed > 0 && <Action icon={<CheckSquare />} title={`Review ${unconfirmed} business claims`} detail="Confirm the information you want your Growth Officer to rely on." to="/app/profile" />}
     {failedDocs > 0 && <Action icon={<FileText />} title={`${failedDocs} document${failedDocs===1?"":"s"} need attention`} detail="Review failed processing and retry." to="/app/documents" />}
     {d.approvals.map(a => <article key={a.id} className="border-b border-border py-4"><div className="flex items-start justify-between gap-3"><Link to="/app/approvals" className="text-sm font-semibold hover:text-primary">{a.title}</Link><StatusChip status={a.risk}>{a.risk} risk</StatusChip></div>{a.reasoning && <p className="mt-2 text-sm text-muted-foreground">{a.reasoning}</p>}{a.expected_impact && <p className="mt-2 text-xs text-muted-foreground">Expected impact (estimate): {a.expected_impact}</p>}</article>)}
     {!d.approvals.length && <div className="mt-4 border-l-2 border-primary pl-4"><p className="text-sm font-semibold">What should you focus on next?</p><p className="mt-1 text-sm text-muted-foreground">No growth recommendations are waiting for review.</p><Button variant="link" className="mt-2 h-auto p-0" asChild><Link to="/app/growth-officer">Discuss your next priority <ArrowUpRight /></Link></Button></div>}
    </section>
    <section className="min-w-0"><h2 className="mb-4 font-semibold">Business objectives</h2>{objectives.length ? <ul className="space-y-3">{objectives.map(x => <li key={x} className="flex items-start gap-3 text-sm"><Target className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{x}</li>)}</ul> : <p className="text-sm text-muted-foreground">No objectives confirmed yet.</p>}<Button variant="link" className="mt-3 h-auto p-0" asChild><Link to="/app/onboarding">Review objectives <ArrowUpRight /></Link></Button>
     <h2 className="mb-3 mt-8 font-semibold">Recent AI activity</h2>{d.runs.length ? <ul className="divide-y divide-border">{d.runs.map(r => <li key={r.id} className="py-3"><div className="flex items-start justify-between gap-3"><p className="min-w-0 text-sm">{r.summary ?? r.agent_key.replace(/_/g," ")}</p><StatusChip status={r.status} /></div><time className="mt-1 block text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</time></li>)}</ul> : <p className="text-sm text-muted-foreground">No AI runs in this workspace yet.</p>}<Button variant="link" className="mt-3 h-auto p-0" asChild><Link to="/app/activity">View activity <ArrowUpRight /></Link></Button>
    </section>
   </div>
   <section className="mt-9 border-t border-border pt-6"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Business performance</h2><Button variant="ghost" size="sm" asChild><Link to="/app/integrations"><Plug /> Data sources</Link></Button></div><div className="mt-4 grid gap-4 sm:grid-cols-3">{["Revenue","Customer acquisition","Customer retention"].map(label => <div key={label}><p className="text-sm">{label}</p><p className="mt-1 text-xs text-muted-foreground">Not configured</p></div>)}</div></section>
  </>}
 </>;
}
function Metric({label,value,note,to}:{label:string;value:string;note:string;to:"/app/billing"|"/app/profile"}) { return <Link to={to} className="min-w-0"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 break-words text-xl font-semibold capitalize">{value}</p><p className="mt-1 text-xs text-muted-foreground">{note}</p></Link>; }
function Action({icon,title,detail,to}:{icon:React.ReactNode;title:string;detail:string;to:"/app/onboarding"|"/app/profile"|"/app/documents"}) { return <Link to={to} className="flex items-start gap-3 border-b border-border py-4 hover:text-primary"><span className="mt-0.5 shrink-0 text-primary [&_svg]:h-4 [&_svg]:w-4">{icon}</span><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{title}</p><p className="mt-1 text-sm text-muted-foreground">{detail}</p></div><ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" /></Link>; }
