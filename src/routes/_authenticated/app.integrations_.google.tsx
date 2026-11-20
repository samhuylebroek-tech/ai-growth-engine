import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { pageHead } from "@/lib/page-head";
import { PageHeader } from "@/components/app/status";
import { Button } from "@/components/ui/button";
import { completeGoogleIntegration } from "@/lib/integrations.functions";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/app/integrations_/google")({
  validateSearch: z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() }),
  head: () => pageHead("Connecting Google data source", "Finishing a read-only Google Analytics or Search Console connection."),
  component: GoogleReturn,
});

function GoogleReturn() {
  const { code, state, error } = Route.useSearch();
  const complete = useServerFn(completeGoogleIntegration); const { t: tx } = useI18n();
  const [result, setResult] = useState<string | null>(error ? tx("pages.int.g.cancelled") : null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !code || !state || error) return; started.current = true;
    complete({ data: { code, state } })
      .then(r => setResult(r.ok ? (r.data.status === "connected" ? tx("pages.int.g.connected") : tx("pages.int.g.noScope")) : r.error))
      .catch(() => setResult(tx("pages.int.g.failed")));
  }, [code, state, error, complete, tx]);
  return <><PageHeader title={tx("pages.int.g.title")} description={tx("pages.int.g.desc")} />
    <p role="status" className="text-sm">{result ?? (code ? tx("pages.int.g.finishing") : tx("pages.int.g.nothing"))}</p>
    <Button variant="link" className="mt-4 px-0" asChild><Link to="/app/integrations">{tx("pages.int.g.back")}</Link></Button></>;
}
