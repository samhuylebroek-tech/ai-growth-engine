import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/page-head";
import { ContentStudio } from "@/components/content/studio";
export const Route = createFileRoute("/_authenticated/app/content")({
  head: () => pageHead("Content Studio", "Write, version, compare and approve each exact content version with writing profiles."),
  component: ContentStudio,
});
