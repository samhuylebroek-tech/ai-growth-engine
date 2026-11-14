import { pageHead } from "@/lib/page-head";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CONNECTORS } from "@/lib/registry/connectors";
import { PageHeader, Panel, StatusChip } from "@/components/app/status";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/app/integrations")({ head: () => pageHead("Integrations", "Business connections and configuration status."), component: Integrations });

function Integrations() {
  const cats = [...new Set(CONNECTORS.map((c) => c.category))];
  return (
    <>
      <PageHeader title="Integrations" description="Connect the tools your business already uses. Only working connections are shown as available — nothing is faked." />
      {cats.map((cat) => (
        <section key={cat} className="mb-8">
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">{cat}</h2>
          <div className="grid gap-3 md:grid-cols-3">{CONNECTORS.filter((c) => c.category === cat).map((c) => (
            <Panel key={c.key}>
              <div className="flex items-start justify-between gap-2"><div className="font-semibold">{c.name}</div><StatusChip status={c.status === "implemented" ? "implemented" : "not_configured"} /></div>
              <p className="mt-1 text-sm text-muted-foreground">{c.description}</p>
              {c.key === "website" && <Button variant="outline" size="sm" className="mt-4" asChild><Link to="/app/onboarding">Discover business</Link></Button>}
              {c.key === "documents" && <Button variant="outline" size="sm" className="mt-4" asChild><Link to="/app/documents">Open documents</Link></Button>}
              {c.requires && <p className="mt-3 text-xs text-muted-foreground">Needs: {c.requires}</p>}
            </Panel>
          ))}</div>
        </section>
      ))}
    </>
  );
}
