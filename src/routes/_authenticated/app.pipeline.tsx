import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/page-head";
import { Pipeline } from "@/components/crm/pipeline";
export const Route = createFileRoute("/_authenticated/app/pipeline")({
  head: () => pageHead("Sales pipeline", "Contacts and deals by stage, with open and won value from the deals you enter."),
  component: Pipeline,
});
