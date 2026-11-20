import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/page-head";
import { Costs } from "@/components/growth/costs";
export const Route = createFileRoute("/_authenticated/app/costs")({
  head: () => pageHead("Costs & ROI", "AI credits per goal, plan, initiative, campaign, project, task and specialist, kept separate from marketing budgets and revenue."),
  component: Costs,
});
