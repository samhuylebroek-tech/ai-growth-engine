import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/page-head";
import { MetricDetail } from "@/components/performance/metric-detail";

export const Route = createFileRoute("/_authenticated/app/performance_/$metricId")({
  head: () => pageHead("Metric details", "Monthly plan, estimate and result for one metric, with its full correction history and links to goals and initiatives."),
  component: MetricDetailPage,
});

function MetricDetailPage() {
  const { metricId } = Route.useParams();
  return <MetricDetail metricId={metricId} />;
}
