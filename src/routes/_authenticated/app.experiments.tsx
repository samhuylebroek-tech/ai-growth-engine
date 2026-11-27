import { createFileRoute } from "@tanstack/react-router";
import { localHead } from "@/lib/page-head";
import { PageHeader } from "@/components/app/status";
import { Experiments } from "@/components/bi/experiments";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/app/experiments")({
  head: () => localHead("experiments"),
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
