import { createFileRoute } from "@tanstack/react-router";
import { localHead } from "@/lib/page-head";
import { CompetitorsWorkspace } from "@/components/competitors/competitors";
export const Route = createFileRoute("/_authenticated/app/competitors")({
  head: () => localHead("competitors"),
  component: CompetitorsWorkspace,
});
