import { createFileRoute } from "@tanstack/react-router";
import { localHead } from "@/lib/page-head";
import { Pipeline } from "@/components/crm/pipeline";
export const Route = createFileRoute("/_authenticated/app/pipeline")({
  head: () => localHead("pipeline"),
  component: Pipeline,
});
