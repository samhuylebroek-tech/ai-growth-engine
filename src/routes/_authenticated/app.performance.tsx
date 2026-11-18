import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/page-head";
import { PerformanceBoard } from "@/components/performance/performance-board";

export const Route = createFileRoute("/_authenticated/app/performance")({
  head: () => pageHead("Performance", "Track planned, forecast and actual results per metric and month, with permanent correction history."),
  component: PerformanceBoard,
});
