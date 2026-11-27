import { createFileRoute } from "@tanstack/react-router";
import { LeadWorkspace } from "@/components/leads/workspace";
import { leadHead } from "@/lib/lead-head";
export const Route = createFileRoute("/_authenticated/app/leads")({
  head: () => leadHead("inbox"),
  component: LeadWorkspace,
});
