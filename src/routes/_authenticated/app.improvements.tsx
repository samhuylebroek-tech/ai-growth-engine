import { createFileRoute } from "@tanstack/react-router";
import { localHead } from "@/lib/page-head";
import { PageHeader } from "@/components/app/status";
import { Improvements } from "@/components/bi/improvements";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/app/improvements")({
  head: () => localHead("improvements"),
  component: Page,
});

function Page() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader
        title={t("bi.page.improvements.title")}
        description={t("bi.page.improvements.desc")}
      />
      <Improvements />
    </>
  );
}
