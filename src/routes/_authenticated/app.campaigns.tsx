import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/page-head";
import { ExecutionWorkspace } from "@/components/execution/workspace";
export const Route = createFileRoute("/_authenticated/app/campaigns")({
  validateSearch: (s: Record<string, unknown>): { item?: string | undefined } => ({
    item: typeof s["item"] === "string" ? s["item"] : undefined,
  }),
  head: () =>
    pageHead("Campaigns", "Internal campaign planning, audiences, budgets, content and approvals."),
  component: Campaigns,
});
function Campaigns() {
  const { item } = Route.useSearch();
  return <ExecutionWorkspace kind="campaigns" itemId={item} />;
}
