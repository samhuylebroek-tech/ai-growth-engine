import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/page-head";
import { GoalsAndBudget } from "@/components/growth/goals-budget";
export const Route = createFileRoute("/_authenticated/app/goals")({
  head: () => pageHead("Goals & budget", "Measurable business goals and the marketing budget planned to reach them."),
  component: GoalsAndBudget,
});
