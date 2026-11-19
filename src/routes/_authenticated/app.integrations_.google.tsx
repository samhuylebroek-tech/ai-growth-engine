import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { pageHead } from "@/lib/page-head";
import { PageHeader } from "@/components/app/status";
import { Button } from "@/components/ui/button";
import { completeGoogleIntegration } from "@/lib/integrations.functions";

export const Route = createFileRoute("/_authenticated/app/integrations_/google")({
  validateSearch: z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() }),
  head: () => pageHead("Connecting Google data source", "Finishing a read-only Google Analytics or Search Console connection."),
  component: GoogleReturn,
});

function GoogleReturn() {
  const { code, state, error } = Route.useSearch();
  const complete = useServerFn(completeGoogleIntegration);
  const [result, setResult] = useState<string | null>(error ? "Google sign-in was cancelled. Nothing was connected." : null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !code || !state || error) return; started.current = true;
    complete({ data: { code, state } })
      .then(r => setResult(r.ok ? (r.data.status === "connected" ? "Connected with read-only access." : "Linked, but Google did not grant the read permission. Reconnect and allow access.") : r.error))
      .catch(() => setResult("The connection could not be completed. Nothing was stored."));
  }, [code, state, error, complete]);
  return <><PageHeader title="Google data source" description="Read-only access: nothing is changed in your Google account." />
    <p role="status" className="text-sm">{result ?? (code ? "Finishing the connection…" : "No sign-in to finish.")}</p>
    <Button variant="link" className="mt-4 px-0" asChild><Link to="/app/integrations">Back to data sources</Link></Button></>;
}
