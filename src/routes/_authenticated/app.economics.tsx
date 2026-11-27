import { createFileRoute } from "@tanstack/react-router";
import { localHead } from "@/lib/page-head";
import { GrowthEconomics } from "@/components/econ/growth-economics";
export const Route = createFileRoute("/_authenticated/app/economics")({
  head: () => localHead("economics"),
  component: GrowthEconomics,
});
