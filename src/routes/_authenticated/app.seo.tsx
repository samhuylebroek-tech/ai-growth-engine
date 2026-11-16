import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/page-head";
import { SeoWorkspace } from "@/components/seo/seo-workspace";
export const Route = createFileRoute("/_authenticated/app/seo")({
  head: () => pageHead("SEO", "Check your public website pages for search basics and turn findings into tasks."),
  component: SeoWorkspace,
});
