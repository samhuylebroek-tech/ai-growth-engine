import { createFileRoute } from "@tanstack/react-router";
import { localHead } from "@/lib/page-head";
import { GoalsAndBudget } from "@/components/growth/goals-budget";
export const Route = createFileRoute("/_authenticated/app/goals")({
  head: () => localHead("goals"),
  component: GoalsAndBudget,
});
