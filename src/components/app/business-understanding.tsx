// "What we know about your business": one line per topic with its state and what to do about it.
// Conflicts already decided (resolve_fact_conflict) do not count as contradicting; when the decision history cannot be
// read, every detected conflict stays contradicting, so nothing looks settled that might not be.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { useOrg } from "@/lib/org-context";
import { growthDb } from "@/lib/pending-schema";
import {
  conflictStatus,
  detectFactConflicts,
  type ConflictEvent,
  type FactRow,
} from "@/lib/fact-conflicts";
import {
  businessUnderstanding,
  GUIDED_AREAS,
  understandingCounts,
  type Area,
  type GuidedArea,
  type ProfileLike,
  type UnderstandingStatus,
} from "@/lib/business-understanding";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TONE: Record<UnderstandingStatus, string> = {
  confirmed: "border-success/30 bg-success/10 text-success",
  inferred: "border-warning/30 bg-warning/10 text-warning",
  estimated: "border-warning/30 bg-warning/10 text-warning",
  conflicting: "border-destructive/30 bg-destructive/10 text-destructive",
  outdated: "border-border bg-muted text-muted-foreground",
  missing: "border-border bg-muted text-muted-foreground",
  unknown: "border-border bg-muted text-muted-foreground",
};

/** Conflict decisions of the business (shared by this list and the growth journey). */
export const conflictEventsOptions = (org: string | undefined, ws: string | undefined) => ({
  queryKey: ["understanding-conflict-events", org, ws] as const,
  enabled: !!org && !!ws,
  queryFn: async () => {
    const r = await growthDb
      .from("fact_conflict_events")
      .select("*")
      .eq("org_id", org!)
      .eq("workspace_id", ws!)
      .order("created_at", { ascending: false })
      .limit(500);
    if (r.error) throw r.error;
    return (r.data ?? []) as ConflictEvent[];
  },
});
/** Detected conflicts not yet decided; when decisions could not be read, every detected conflict stays open. */
export function openConflicts(
  facts: readonly FactRow[],
  decided: readonly ConflictEvent[] | undefined,
) {
  return detectFactConflicts([...facts]).filter(
    (c) => conflictStatus(c, decided ?? []).status !== "resolved",
  );
}

export function BusinessUnderstanding({
  profile,
  facts,
  complete,
  canConfirm,
}: {
  profile: ProfileLike;
  facts: (FactRow & { created_at?: string | null })[];
  complete: boolean;
  canConfirm: boolean;
}) {
  const { t } = useI18n();
  const o = useOrg();
  const [all, setAll] = useState(false);
  const events = useQuery(conflictEventsOptions(o.org?.id, o.workspace?.id));
  const areas = useMemo(
    () => businessUnderstanding(profile, facts, openConflicts(facts, events.data), complete),
    [profile, facts, complete, events.data],
  );
  const counts = understandingCounts(areas);
  const attention = areas.filter((a) => a.status !== "confirmed");
  const shown = all ? areas : attention;
  const guided = (a: Area) => GUIDED_AREAS.includes(a.key as GuidedArea);
  const name = (a: Area) =>
    a.key === "horizon"
      ? t("ob.area.horizon")
      : guided(a)
        ? t(`ob.section.${a.key}.title` as MessageKey)
        : ["website", "objectives", "budget"].includes(a.key)
          ? t(`gx.u.area.${a.key}` as MessageKey)
          : t(`account.field.${a.key}` as MessageKey);
  const how = (a: Area) =>
    !canConfirm && !["confirmed", "unknown"].includes(a.status)
      ? t("gx.u.how.askEditor")
      : a.status === "missing"
        ? t(
            guided(a)
              ? "ob.how.missing"
              : a.discoverable
                ? "gx.u.how.missingAuto"
                : "gx.u.how.missingManual",
          )
        : t(`gx.u.how.${a.status}` as MessageKey);
  return (
    <section
      aria-labelledby="understanding-title"
      className="mb-8 rounded-xl border border-border bg-card p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="understanding-title" className="text-base font-semibold">
            {t("gx.u.title")}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("gx.u.intro")}</p>
        </div>
        <p className="text-sm font-medium tabular-nums">
          {t("gx.u.summary", { confirmed: counts.confirmed, total: areas.length })}
        </p>
      </div>
      <div
        className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={t("gx.u.summary", { confirmed: counts.confirmed, total: areas.length })}
        aria-valuemin={0}
        aria-valuemax={areas.length}
        aria-valuenow={counts.confirmed}
      >
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${Math.round((counts.confirmed / areas.length) * 100)}%` }}
        />
      </div>
      {!complete && (
        <p role="status" className="mt-3 text-xs text-muted-foreground">
          {t("gx.u.incomplete")}
        </p>
      )}
      {shown.length ? (
        <ul className="mt-4 divide-y divide-border border-y border-border">
          {shown.map((a) => (
            <li
              key={a.key}
              className="grid gap-1 py-3 sm:grid-cols-[200px_170px_minmax(0,1fr)] sm:items-center sm:gap-3"
            >
              <span className="text-sm font-medium">{name(a)}</span>
              <span>
                <span
                  className={cn(
                    "inline-flex rounded-full border px-2 py-0.5 text-2xs font-medium",
                    TONE[a.status],
                  )}
                >
                  {t(`gx.u.status.${a.status}` as MessageKey)}
                </span>
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground">{how(a)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">{t("gx.u.allGood")}</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {attention.length > 0 && attention.length < areas.length && (
          <Button
            variant="link"
            size="sm"
            className="px-0"
            aria-expanded={all}
            onClick={() => setAll((v) => !v)}
          >
            {all ? t("gx.u.showLess") : t("gx.u.showAll")}
          </Button>
        )}
        {canConfirm && counts.missing + counts.outdated > 0 && (
          <Button variant="outline" size="sm" className="sm:ml-auto" asChild>
            <Link to="/app/onboarding">
              {t("gx.u.fix")} <ArrowUpRight />
            </Link>
          </Button>
        )}
      </div>
    </section>
  );
}
