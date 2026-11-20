import { createFileRoute } from "@tanstack/react-router";
import { localHead } from "@/lib/page-head";
import { ContentStudio } from "@/components/content/studio";
export const Route = createFileRoute("/_authenticated/app/content")({
  head: () => localHead("content"),
  component: ContentStudio,
});
