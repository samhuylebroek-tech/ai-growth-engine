import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Info } from "lucide-react";
import { localHead } from "@/lib/page-head";
import { PageHeader, StatusChip } from "@/components/app/status";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";

export const Route = createFileRoute("/_authenticated/app/test-guide")({
  head: () => localHead("testGuide"),
  component: TestGuide,
});

const JOURNEYS = [
  {
    id: "onboarding",
    status: "ok" as const,
    steps: ["/app/onboarding", "/app/profile", "/app/growth-officer"] as const,
  },
  {
    id: "strategy",
    status: "ok" as const,
    steps: ["/app/intelligence", "/app/opportunities", "/app/goals"] as const,
  },
  {
    id: "campaign",
    status: "part" as const,
    steps: ["/app", "/app/campaigns", "/app/tasks", "/app/approvals", "/app/activity"] as const,
  },
  {
    id: "content",
    status: "ok" as const,
    steps: ["/app/content", "/app/approvals", "/app/campaigns"] as const,
  },
  { id: "leads", status: "part" as const, steps: ["/app/leads", "/app/pipeline"] as const },
  { id: "retention", status: "part" as const, steps: ["/app/pipeline", "/app/tasks"] as const },
  {
    id: "impact",
    status: "part" as const,
    steps: ["/app/costs", "/app/revenue", "/app/business", "/app/economics"] as const,
  },
];

function TestGuide() {
  const { t: tx } = useI18n();
  const t = tx as (k: string) => string;
  return (
    <>
      <PageHeader title={t("tg.title")} description={t("tg.intro")} />
      <ol className="grid gap-5 md:grid-cols-2">
        {JOURNEYS.map((j) => (
          <li
            key={j.id}
            className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5"
          >
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
              <h2 className="min-w-0 text-base font-semibold">{t(`tg.${j.id}.t`)}</h2>
              <StatusChip status={j.status === "ok" ? "completed" : "in_progress"}>
                {t(`tg.s.${j.status}`)}
              </StatusChip>
            </div>
            <p className="text-sm text-muted-foreground">{t(`tg.${j.id}.x`)}</p>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">{t("tg.steps")}</p>
              <ul className="flex flex-wrap gap-2">
                {j.steps.map((to) => (
                  <li key={to}>
                    <Link
                      to={to}
                      className="rounded-md text-sm text-primary underline-offset-4 hover:underline"
                    >
                      {to === "/app/onboarding"
                        ? t("tg.onboardingStep")
                        : tx(`nav.${to}` as MessageKey)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <p className="flex gap-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                <span className="font-medium">{t("tg.limit")}: </span>
                {t(`tg.${j.id}.l`)}
              </span>
            </p>
            <Button asChild size="sm" className="mt-auto self-start">
              <Link to={j.steps[0]}>
                {t("tg.start")} <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
          </li>
        ))}
      </ol>
    </>
  );
}
