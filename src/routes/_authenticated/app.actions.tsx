import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/lib/page-head";
import { PageHeader } from "@/components/app/status";
import { ExternalActions } from "@/components/integrations/external-actions";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/app/actions")({
  head: () => pageHead("External actions", "Prepare, approve, execute and verify actions on connected platforms, each traced from task to verified result."),
  validateSearch: (s: Record<string, unknown>): { task?: string } => (typeof s["task"] === "string" && /^[0-9a-f-]{36}$/.test(s["task"]) ? { task: s["task"] } : {}),
  component: ActionsPage,
});

function ActionsPage() {
  const { t } = useI18n(); const { task } = Route.useSearch();
  return <><PageHeader title={t("xa.page.title")} description={t("xa.page.desc")} /><ExternalActions {...(task ? { initialTask: task } : {})} /></>;
}
