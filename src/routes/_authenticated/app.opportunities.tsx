import { createFileRoute } from "@tanstack/react-router";
import { localHead } from "@/lib/page-head";
import { OpportunitiesWorkspace } from "@/components/growth/opportunities";

export const Route = createFileRoute("/_authenticated/app/opportunities")({
  head: () => localHead("opportunities"),
  component: OpportunitiesWorkspace,
});
