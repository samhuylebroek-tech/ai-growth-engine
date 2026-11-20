import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/page-head";
import { Organization, ORG_TABS, type OrgTab } from "@/components/org/organization";

export const Route = createFileRoute("/_authenticated/app/organization")({
  validateSearch: (s: Record<string, unknown>): { tab?: OrgTab } =>
    typeof s["tab"] === "string" && (ORG_TABS as readonly string[]).includes(s["tab"]) ? { tab: s["tab"] as OrgTab } : {},
  head: () => pageHead("Organization command center", "The Organization Growth Officer, cross-business opportunities, shared initiatives, resource allocation, risks and decisions across all your businesses."),
  component: Page,
});

function Page() {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  return <Organization tab={tab ?? "overview"} onTab={(t) => void navigate({ search: t === "overview" ? {} : { tab: t }, replace: true })} />;
}
