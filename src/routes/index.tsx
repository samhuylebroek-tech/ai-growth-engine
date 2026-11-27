import { createFileRoute } from "@tanstack/react-router";
import { localHead } from "@/lib/page-head";
import { PublicExperience } from "@/components/public/experience";
export const Route = createFileRoute("/")({
  head: () => localHead("home"),
  component: PublicExperience,
});
