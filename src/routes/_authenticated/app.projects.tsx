import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/page-head";
import { ExecutionWorkspace } from "@/components/execution/workspace";
export const Route = createFileRoute("/_authenticated/app/projects")({
  validateSearch: (s: Record<string, unknown>): { item?: string | undefined } => ({
    item: typeof s["item"] === "string" ? s["item"] : undefined,
  }),
  head: () => pageHead("Projects", "Workspace projects, milestones, teams and execution progress."),
  component: Projects,
});
function Projects() {
  const { item } = Route.useSearch();
  return <ExecutionWorkspace kind="projects" itemId={item} />;
}
