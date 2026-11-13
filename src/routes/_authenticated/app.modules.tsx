import { createFileRoute } from "@tanstack/react-router";
import { EXTENSIONS } from "@/lib/registry/extensions";
import { PageHeader, Panel, StatusChip } from "@/components/app/status";

export const Route = createFileRoute("/_authenticated/app/modules")({ component: Modules });

function Modules() {
  return (
    <>
      <PageHeader title="Modules" description="AI Growth OS grows with you. Each module plugs into the same foundation." />
      <div className="grid gap-3 md:grid-cols-3">{EXTENSIONS.map((e) => (
        <Panel key={e.key}><div className="flex items-start justify-between gap-2"><div className="font-semibold">{e.name}</div><StatusChip status={e.status} /></div><p className="mt-1 text-sm text-muted-foreground">{e.description}</p></Panel>
      ))}</div>
    </>
  );
}
