import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/page-head";
import { OpportunitiesWorkspace } from "@/components/growth/opportunities";

export const Route = createFileRoute("/_authenticated/app/opportunities")({
  head: () => pageHead("Growth opportunities", "Revenue opportunities across marketing, sales, retention, partnerships, events, pricing and product, scored and evidence-labelled for your decision."),
  component: OpportunitiesWorkspace,
});
