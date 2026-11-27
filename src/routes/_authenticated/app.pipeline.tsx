import { createFileRoute } from "@tanstack/react-router";
import { localHead } from "@/lib/page-head";
import { Pipeline } from "@/components/crm/pipeline";
import { z } from "zod";
export const Route = createFileRoute("/_authenticated/app/pipeline")({
  validateSearch: (search: Record<string, unknown>) => {
    const contact = z.guid().safeParse(search["contact"]);
    return contact.success ? { contact: contact.data } : {};
  },
  head: () => localHead("pipeline"),
  component: PipelinePage,
});
function PipelinePage() {
  const { contact } = Route.useSearch();
  return <Pipeline key={contact ?? "all"} initialContact={contact} />;
}
