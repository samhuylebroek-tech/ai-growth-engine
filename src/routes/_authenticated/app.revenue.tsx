import { createFileRoute } from "@tanstack/react-router";
import { localHead } from "@/lib/page-head";
import { PageHeader } from "@/components/app/status";
import { RevenueAttribution } from "@/components/bi/revenue";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/app/revenue")({
  head: () =>
    localHead("revenue"),
  component: Page,
});

function Page() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t("bi.page.revenue.title")} description={t("bi.page.revenue.desc")} />
      <RevenueAttribution />
    </>
  );
}
