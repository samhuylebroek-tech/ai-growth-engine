import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/page-head";
import { PageHeader } from "@/components/app/status";
import { Improvements } from "@/components/bi/improvements";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/app/improvements")({
  head: () =>
    pageHead(
      "Improvements",
      "Improvement proposals from recorded performance, approved by an administrator and turned into tracked work.",
    ),
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
