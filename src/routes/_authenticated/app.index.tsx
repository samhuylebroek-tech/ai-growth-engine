import { createFileRoute } from "@tanstack/react-router";
import { localHead } from "@/lib/page-head";
import { ExecutionWorkspace } from "@/components/execution/workspace";
export const Route = createFileRoute("/_authenticated/app/")({
  head: () => localHead("campaignHome"),
  component: CampaignHome,
});
function CampaignHome() {
  return <ExecutionWorkspace kind="campaigns" />;
}
