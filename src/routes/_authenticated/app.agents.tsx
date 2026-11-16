import { pageHead } from "@/lib/page-head";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AGENTS } from "@/lib/registry/agents";
import { CAPABILITIES, capabilityByKey } from "@/lib/registry/capabilities";
import { Button } from "@/components/ui/button";
import { Sparkles, ArrowUpRight } from "lucide-react";
import { PageHeader, Panel, StatusChip } from "@/components/app/status";
import { SpecialistWorkbench } from "@/components/app/specialist-workbench";
import { CoordinationWorkbench } from "@/components/app/coordination-workbench";

export const Route = createFileRoute("/_authenticated/app/agents")({ head: () => pageHead("Agents and capabilities", "Growth specialists and available capabilities."), component: Agents });

const RISK: Record<string, string> = { read: "Reads data", write_internal: "Changes data inside the platform", write_external: "Acts outside the platform — always needs approval" };

function Agents() {
  return (
    <>
      <PageHeader title="Growth specialists" description="Available research and planning, with clear boundaries." actions={<Button variant="outline" asChild><Link to="/app/growth-officer"><Sparkles />Work with Growth Officer</Link></Button>} />
      <SpecialistWorkbench />
      <CoordinationWorkbench />
      <div className="grid gap-4 md:grid-cols-2">{AGENTS.map((a) => (
        <Panel key={a.key}>
          <div className="flex items-start justify-between gap-2"><div className="font-semibold">{a.name}</div><StatusChip status={a.status} /></div>
          <p className="mt-2 text-sm text-muted-foreground">{a.description}</p>{a.status === "implemented" && <Button variant="link" size="sm" className="mt-3 px-0" asChild><Link to={a.key === "growth_officer" ? "/app/growth-officer" : a.key === "business_intelligence" ? "/app/onboarding" : "/app/agents"}>{a.key === "growth_officer" ? "Open conversation" : a.key === "business_intelligence" ? "Research business" : "Open specialist workspace"}<ArrowUpRight /></Link></Button>}{a.status === "planned" && <p className="mt-3 text-[11px] text-muted-foreground">Not operational yet.</p>}
          <div className="mt-3 flex flex-wrap gap-1.5">{a.capabilities.map((k) => <span key={k} className="rounded-md bg-secondary px-2 py-0.5 text-xs">{capabilityByKey(k)?.name ?? k}</span>)}</div>
        </Panel>
      ))}</div>
      <h2 className="mb-3 mt-10 font-semibold">Capabilities</h2>
      <div className="overflow-x-auto rounded-lg border border-border"><table className="mobile-records w-full min-w-[640px] text-sm"><thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="px-4 py-2">Capability</th><th className="px-4 py-2">What it touches</th><th className="px-4 py-2">Min. role</th><th className="px-4 py-2">Credits</th><th className="px-4 py-2">Status</th></tr></thead>
        <tbody className="divide-y divide-border">{CAPABILITIES.map((c) => <tr key={c.key}><td className="px-4 py-2.5"><div className="font-medium">{c.name}</div><div className="text-xs text-muted-foreground">{c.description}</div></td><td className="px-4 py-2.5 text-xs text-muted-foreground">{RISK[c.risk]}</td><td className="px-4 py-2.5 capitalize">{c.minRole}</td><td className="px-4 py-2.5">{c.credits}</td><td className="px-4 py-2.5"><StatusChip status={c.status} /></td></tr>)}</tbody></table></div>
    </>
  );
}
