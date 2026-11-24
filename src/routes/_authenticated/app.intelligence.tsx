import { createFileRoute, Link } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { useQuery } from "@tanstack/react-query";
import { Compass, ArrowUpRight, Target, CheckSquare } from "lucide-react";
import { localHead } from "@/lib/page-head";
import { useOrg } from "@/lib/org-context";
import { growthSummaryOptions } from "@/lib/growth-summary";
import { PageHeader, StatusChip } from "@/components/app/status";
import { SectionHeading } from "@/components/app/section-heading";
import { GrowthQuestion } from "@/components/app/growth-question";
import { GrowthSituation } from "@/components/app/growth-situation";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/app/intelligence")({
  head: () => localHead("intelligence"),
  component: Intelligence,
});
function Intelligence() {
  const o = useOrg();
  const q = useQuery(growthSummaryOptions(o.org?.id, o.workspace?.id, o.role));
  const d = q.data;
  const { t } = useI18n();
  const opportunities = d?.facts.filter((f) => /^opportunity:/i.test(f.key)) ?? [];
  const verified = d?.facts.filter((f) => f.verified) ?? [];
  const goals = Array.isArray(d?.profile?.objectives)
    ? d.profile.objectives.filter((x): x is string => typeof x === "string")
    : [];
  return (
    <>
      <PageHeader
        title={t("performance.i.title")}
        description={o.workspace?.name ?? t("performance.i.workspace")}
        actions={
          <Button variant="outline" asChild>
            <Link to="/app/onboarding">
              <Compass />
              {t("performance.i.discover")}
            </Link>
          </Button>
        }
      />
      {q.isLoading && (
        <p role="status" className="py-8 text-sm text-muted-foreground">
          {t("performance.i.loading")}
        </p>
      )}
      {q.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t("performance.i.failed")}{" "}
          <Button variant="link" onClick={() => q.refetch()}>
            {t("performance.i.retry")}
          </Button>
        </p>
      )}
      {d && (
        <>
          <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
            <section>
              <SectionHeading
                eyebrow={t("performance.i.foundation")}
                title={t("performance.i.whatWeKnow")}
              />
              {verified.length ? (
                <dl className="divide-y divide-border">
                  {verified.slice(0, 5).map((f) => (
                    <div key={f.id} className="py-4">
                      <dt className="text-xs font-semibold">{f.key}</dt>
                      <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">
                        {f.value}
                      </dd>
                      <p className="mt-2 text-2xs text-muted-foreground">
                        {t("performance.i.confirmed", { s: f.source_type })}
                      </p>
                    </div>
                  ))}
                </dl>
              ) : (
                <div className="border-y border-border py-6">
                  <p className="text-sm font-medium">{t("performance.i.needsFoundation")}</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t("performance.i.awaiting", { n: d.facts.length })}
                  </p>
                </div>
              )}
              <Button variant="link" className="mt-3 px-0" asChild>
                <Link to="/app/profile">
                  {t("performance.i.reviewAll")} <ArrowUpRight />
                </Link>
              </Button>
            </section>
            <section>
              <SectionHeading
                eyebrow={t("performance.i.direction")}
                title={t("performance.i.objectives")}
              />
              {goals.length ? (
                <ul className="space-y-4">
                  {goals.map((g) => (
                    <li key={g} className="flex gap-3 text-sm">
                      <Target className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      {g}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{t("performance.i.noObjectives")}</p>
              )}
              <Button variant="link" className="mt-3 px-0" asChild>
                <Link to="/app/onboarding">
                  {t("performance.i.setDirection")} <ArrowUpRight />
                </Link>
              </Button>
              <h2 className="mb-4 mt-8 text-sm font-semibold">{t("performance.i.nextMove")}</h2>
              <GrowthQuestion compact />
            </section>
          </div>
          <section className="mt-10 border-t border-border pt-7">
            <SectionHeading title={t("sa.title")} />
            <GrowthSituation />
          </section>
          <section className="mt-10 border-t border-border pt-7">
            <SectionHeading
              eyebrow={t("performance.i.research")}
              title={t("performance.i.potential")}
            />
            {opportunities.length ? (
              <div className="grid gap-4 md:grid-cols-2">
                {opportunities.map((f) => (
                  <article key={f.id} className="rounded-lg border border-border bg-card p-5">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-sm font-semibold">
                        {f.key.replace(/^opportunity:\s*/i, "")}
                      </h3>
                      <StatusChip status={f.verified ? "approved" : "pending"}>
                        {f.verified
                          ? t("performance.i.userConfirmed")
                          : t("performance.i.hypothesis")}
                      </StatusChip>
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{f.value}</p>
                    {f.source_ref && (
                      <p className="mt-3 break-all text-2xs text-muted-foreground">
                        {t("performance.i.source", { s: f.source_ref })}
                      </p>
                    )}
                    <Button variant="link" size="sm" className="mt-3 px-0" asChild>
                      <Link to="/app/profile">
                        {t("performance.i.reviewEvidence")} <ArrowUpRight />
                      </Link>
                    </Button>
                  </article>
                ))}
              </div>
            ) : (
              <div className="border-y border-dashed border-border py-7">
                <p className="text-sm font-medium">{t("performance.i.noResearch")}</p>
                <Button variant="link" className="mt-2 px-0" asChild>
                  <Link to="/app/onboarding">
                    {t("performance.i.analyze")} <ArrowUpRight />
                  </Link>
                </Button>
              </div>
            )}
          </section>
          <section className="mt-10 border-t border-border pt-7">
            <SectionHeading
              title={t("performance.i.recommended")}
              action={
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/app/approvals">
                    {t("performance.i.queue")} <ArrowUpRight />
                  </Link>
                </Button>
              }
            />
            {d.approvals.length ? (
              d.approvals.map((a) => (
                <Link
                  key={a.id}
                  to="/app/approvals"
                  className="flex items-start gap-3 border-b border-border py-4"
                >
                  <CheckSquare className="mt-1 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{a.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{a.reasoning}</p>
                  </div>
                </Link>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">{t("performance.i.noRecs")}</p>
            )}
          </section>
        </>
      )}
    </>
  );
}
