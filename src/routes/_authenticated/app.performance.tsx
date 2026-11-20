import { createFileRoute } from "@tanstack/react-router";
import { localHead } from "@/lib/page-head";
import { PerformanceBoard } from "@/components/performance/performance-board";

export const Route = createFileRoute("/_authenticated/app/performance")({
  head: () => localHead("performance"),
  component: PerformanceBoard,
});
