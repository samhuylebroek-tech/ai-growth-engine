import { createFileRoute } from "@tanstack/react-router";
import { localHead } from "@/lib/page-head";
import { MetricDetail } from "@/components/performance/metric-detail";

export const Route = createFileRoute("/_authenticated/app/performance_/$metricId")({
  head: () => localHead("metric"),
  component: MetricDetailPage,
});

function MetricDetailPage() {
  const { metricId } = Route.useParams();
  return <MetricDetail metricId={metricId} />;
}
