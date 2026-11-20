import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/page-head";
import { PageHeader } from "@/components/app/status";
import { BusinessOverview } from "@/components/bi/business-overview";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/app/business")({
  validateSearch: (s: Record<string, unknown>): { unit?: string } =>
    typeof s["unit"] === "string" && /^[0-9a-f-]{36}$/.test(s["unit"]) ? { unit: s["unit"] } : {},
  head: () =>
    pageHead(
      "Business performance",
      "Revenue, attribution, growth indicators, comparisons and next best growth actions, each with its source, period and data quality.",
    ),
  component: Page,
});

function Page() {
  const { t } = useI18n();
  const { unit } = Route.useSearch();
  return (
    <>
      <PageHeader title={t("bi.page.business.title")} description={t("bi.page.business.desc")} />
      <BusinessOverview key={unit ?? "all"} initialUnit={unit ?? null} />
    </>
  );
}
