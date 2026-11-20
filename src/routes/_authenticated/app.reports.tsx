import { createFileRoute } from "@tanstack/react-router";
import { localHead } from "@/lib/page-head";
import { PageHeader } from "@/components/app/status";
import { BusinessReports } from "@/components/reports/business-reports";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/app/reports")({
  head: () => localHead("reports"),
  component: Page,
});

function Page() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={t("rep.title")} description={t("rep.desc")} />
      <BusinessReports />
    </>
  );
}
