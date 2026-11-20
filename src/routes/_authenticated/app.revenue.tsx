import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/page-head";
import { PageHeader } from "@/components/app/status";
import { RevenueAttribution } from "@/components/bi/revenue";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/app/revenue")({
  head: () =>
    pageHead(
      "Revenue & attribution",
      "Record sales, refunds and corrections, link them to campaigns and channels, and compare attribution models without double counting.",
    ),
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
