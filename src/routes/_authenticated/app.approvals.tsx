import { pageHead } from "@/lib/page-head";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { CheckSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { capabilityByKey } from "@/lib/registry/capabilities";
import { PageHeader, Panel, StatusChip, EmptyState } from "@/components/app/status";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/app/approvals")({ head: () => pageHead("Approvals", "Review growth actions and track decisions."), component: Approvals });

function Approvals() {
  const o = useOrg(); const qc = useQueryClient(); const [tab, setTab] = useState<"pending" | "decided">("pending");
  const q = useQuery({ queryKey: ["approvals", o.org?.id, tab], enabled: !!o.org, queryFn: async () => {
    let s = supabase.from("approvals").select("*").eq("org_id", o.org!.id).order("created_at", { ascending: false }).limit(100);
    s = tab === "pending" ? s.eq("status", "pending") : s.neq("status", "pending");
    return (await s).data ?? [];
  } });
  async function decide(id: string, approve: boolean) {
    const { error } = await supabase.rpc("decide_approval", { _id: id, _approve: approve, _note: "" });
    if (error) toast.error(error.message.includes("forbidden") ? "Only admins can decide." : error.message);
    else toast.success(approve ? "Approved" : "Rejected");
    qc.invalidateQueries({ queryKey: ["approvals"] });
  }
  const canDecide = can(o.role, "approvals.decide");
  return (
    <>
      <PageHeader title="Approvals" description="Nothing that affects the outside world happens without a person saying yes." />
      <div className="mb-5 flex gap-1 rounded-lg bg-muted p-1 text-sm w-fit">{(["pending", "decided"] as const).map((t) => <Button key={t} variant={tab === t ? "secondary" : "ghost"} size="sm" onClick={() => setTab(t)} aria-pressed={tab === t} className="capitalize">{t}</Button>)}</div>
      {q.data?.length ? <div className="space-y-3">{q.data.map((a) => {
        const cap = capabilityByKey(a.capability_key);
        return (
          <Panel key={a.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0"><div className="font-semibold">{a.title}</div><div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{cap?.name ?? a.capability_key}</span><StatusChip status={a.risk}>{a.risk} risk</StatusChip><StatusChip status={a.status} />{cap?.status === "planned" && <StatusChip status="planned">Execution not available yet</StatusChip>}</div></div>
              {a.status === "pending" && canDecide && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => decide(a.id, false)}>Reject</Button><Button size="sm" onClick={() => decide(a.id, true)}>Approve</Button></div>}
            </div>
            {a.reasoning && <p className="mt-3 text-sm"><span className="text-muted-foreground">Why: </span>{a.reasoning}</p>}
            {a.expected_impact && <p className="mt-1 text-sm"><span className="text-muted-foreground">Expected impact: </span>{a.expected_impact}</p>}
            {a.status !== "pending" && a.decided_at && <p className="mt-2 text-xs text-muted-foreground">Decided {new Date(a.decided_at).toLocaleString()}</p>}
          </Panel>
        );
      })}</div> : <EmptyState icon={<CheckSquare className="h-5 w-5" />} title={tab === "pending" ? "Nothing waiting" : "No decisions yet"} text="When the Growth Officer recommends an action, it appears here for review." />}
      {!canDecide && <p className="mt-6 text-xs text-muted-foreground">Only admins and owners can approve or reject.</p>}
      <p className="mt-6 text-xs text-muted-foreground">Approving records your decision. Automatic execution through connected tools will arrive with each integration; until then, approved actions are carried out by your team.</p>
    </>
  );
}
