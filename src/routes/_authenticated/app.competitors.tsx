import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/page-head";
import { CompetitorsWorkspace } from "@/components/competitors/competitors";
export const Route = createFileRoute("/_authenticated/app/competitors")({
  head: () => pageHead("Competitors", "Track competitors' public websites with dated, sourced observations and turn them into tasks and briefs."),
  component: CompetitorsWorkspace,
});
