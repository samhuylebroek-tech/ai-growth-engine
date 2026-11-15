import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/page-head";
import { ExecutionWorkspace } from "@/components/execution/workspace";
export const Route = createFileRoute("/_authenticated/app/tasks")({
  validateSearch: (s: Record<string, unknown>): { item?: string | undefined } => ({
    item: typeof s["item"] === "string" ? s["item"] : undefined,
  }),
  head: () =>
    pageHead("Tasks", "Personal and team tasks, deadlines, dependencies and calendar planning."),
  component: Tasks,
});
function Tasks() {
  const { item } = Route.useSearch();
  return <ExecutionWorkspace kind="tasks" itemId={item} />;
}
