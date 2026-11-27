import { createFileRoute } from "@tanstack/react-router";
import { localHead } from "@/lib/page-head";
import { SeoWorkspace } from "@/components/seo/seo-workspace";
export const Route = createFileRoute("/_authenticated/app/seo")({
  head: () => localHead("seo"),
  component: SeoWorkspace,
});
