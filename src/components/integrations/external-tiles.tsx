import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useOrg } from "@/lib/org-context";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { isNotInstalled } from "@/lib/pending-schema";
import { integrationOverview } from "@/lib/integration-health";
import { SectionHeading } from "@/components/app/section-heading";
import { hubOptions } from "./hub-data";
import { cn } from "@/lib/utils";

/** Home: integration health and external execution, from connection and action records only. */
export function ExternalTiles() {
  const { org, workspace } = useOrg();
  const { t, tag } = useI18n();
  const q = useQuery(hubOptions(org?.id, workspace?.id));
  if (q.isError && isNotInstalled(q.error)) return null;
  if (
    q.data &&
    !q.data.connections.some((c) => c.simulated || c.status !== "not_configured") &&
    !q.data.actions.length
  )
    return null;
  const ov = q.data ? integrationOverview(q.data.connections, q.data.actions, new Date()) : null;
  const simulatedOnly =
    !!q.data &&
    q.data.connections.filter((c) => c.status !== "not_configured").every((c) => c.simulated);
  const tiles: [string, number, string, boolean][] = ov
    ? [
        [
          "health",
          ov.problems.filter((p) => !["failed_actions", "uncertain_actions"].includes(p.kind))
            .length,
          "/app/integrations",
          true,
        ],
        ["inReview", ov.actions.inReview, "/app/actions", false],
        ["inProgress", ov.actions.inProgress, "/app/actions", false],
        ["failed", ov.actions.failed + ov.actions.uncertain, "/app/actions", true],
        ["awaitingVerification", ov.actions.awaitingVerification, "/app/actions", false],
        ["verified", ov.actions.verified, "/app/actions", false],
      ]
    : [];
  const costs = ov ? Object.entries(ov.estimated) : [];
  return (
    <section aria-label={t("xa.home.title")} className="mb-8">
      <SectionHeading
        eyebrow={simulatedOnly ? t("xa.home.eyebrowSim") : t("xa.home.eyebrow")}
        title={t("xa.home.title")}
      />
      {q.isLoading ? (
        <p role="status" className="py-3 text-xs text-muted-foreground">
          {t("xa.loading")}
        </p>
      ) : q.isError || !ov ? (
        <p role="alert" className="py-3 text-xs text-destructive">
          {t("xa.loadFailed")}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-6">
          {tiles.map(([k, v, to, warn]) => (
            <Link key={k} to={to} className="flex min-w-0 flex-col bg-card p-3 hover:bg-muted/40">
              <span className="break-words text-2xs font-medium text-muted-foreground">
                {t(`xa.home.k.${k}` as MessageKey)}
              </span>
              <span
                className={cn(
                  "mt-1 text-xl font-semibold tabular-nums",
                  warn && v > 0 && "text-destructive",
                )}
              >
                {v.toLocaleString(tag)}
              </span>
            </Link>
          ))}
        </div>
      )}
      <p className="mt-2 text-2xs text-muted-foreground">
        {costs.length
          ? t("xa.home.costs", {
              list: costs
                .map(
                  ([c, v]) =>
                    `${(v.simulated + v.real).toLocaleString(tag, { style: "currency", currency: c })}${v.real ? "" : ` (${t("xa.simulated")})`}`,
                )
                .join(" · "),
            })
          : t("xa.home.noCosts")}{" "}
        {t("xa.home.note")}
      </p>
    </section>
  );
}
