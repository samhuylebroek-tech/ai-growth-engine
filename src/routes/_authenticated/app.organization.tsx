import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/page-head";
import { Organization } from "@/components/org/organization";
export const Route = createFileRoute("/_authenticated/app/organization")({
  head: () => pageHead("Organization overview", "All your businesses side by side: consolidated results per currency, coordination findings, shared specialists and exchange rates."),
  component: Organization,
});
