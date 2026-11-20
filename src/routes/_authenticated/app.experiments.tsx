import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/page-head";
import { PageHeader } from "@/components/app/status";
import { Experiments } from "@/components/bi/experiments";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/app/experiments")({
  head: () =>
    pageHead(
      "Experiments",
      "Plan, approve, run and conclude growth experiments, with evidence strength that separates correlation from cause.",
    ),
  component: Page,
});

function Page() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader
        title={t("bi.page.experiments.title")}
        description={t("bi.page.experiments.desc")}
      />
      <Experiments />
    </>
  );
}
