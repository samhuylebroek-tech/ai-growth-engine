import { createFileRoute } from "@tanstack/react-router";
import { localHead } from "@/lib/page-head";
import { Costs } from "@/components/growth/costs";
export const Route = createFileRoute("/_authenticated/app/costs")({
  head: () => localHead("costs"),
  component: Costs,
});
