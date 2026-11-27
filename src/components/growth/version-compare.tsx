// Side-by-side differences between two saved versions of a goal's growth plan (Phase 9). Read-only: it reads both
// versions' initiatives under the caller's RLS and shows only what the snapshots record; it never changes a plan.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import {
  COMPARED_LISTS,
  compareVersions,
  type Budget,
  type ComparableVersion,
  type ListDiff,
} from "@/lib/strategy-compare";

type PlanRow = {
  id: string;
  version: number;
  status: string;
  title: string;
  summary: string;
  strategic_thesis?: string | null;
  plan_snapshot: unknown;
};
const tk = (k: string) => k as MessageKey;

export function VersionCompare({
  orgId,
  wsId,
  base,
  target,
}: {
  orgId: string;
  wsId: string;
  base: PlanRow;
  target: PlanRow;
}) {
  const { t, tag } = useI18n();
  const [open, setOpen] = useState(false);
  const inits = useQuery({
    queryKey: ["growth-plan-compare", orgId, wsId, base.id, target.id],
    enabled: open,
    queryFn: async () => {
      const r = await supabase
        .from("growth_initiatives")
        .select("plan_version_id,title,channel,status")
        .eq("org_id", orgId)
        .eq("workspace_id", wsId)
        .in("plan_version_id", [base.id, target.id])
        .order("sort_order");
      if (r.error) throw r.error;
      return r.data ?? [];
    },
  });
  const asVersion = (p: PlanRow): ComparableVersion => ({
    ...p,
    initiatives: (inits.data ?? [])
      .filter((n) => n.plan_version_id === p.id)
      .map((n) => ({ title: n.title, channel: n.channel ?? "", status: n.status })),
  });
  const budget = (b: Budget) =>
    !b || b.amount === null
      ? t("grp.cmp.noBudget")
      : b.currency
        ? new Intl.NumberFormat(tag, { style: "currency", currency: b.currency }).format(b.amount)
        : String(b.amount);
  const diffLine = (label: string, d: ListDiff) =>
    d.added.length || d.removed.length ? (
      <div key={label}>
        <p className="font-medium">
          {label}{" "}
          <span className="font-normal text-muted-foreground">
            · {t("grp.cmp.kept", { n: d.kept })}
          </span>
        </p>
        <ul className="pl-4">
          {d.added.map((x) => (
            <li key={`a${x}`}>
              <span className="text-success">+ {t("grp.cmp.added")}:</span> {x}
            </li>
          ))}
          {d.removed.map((x) => (
            <li key={`r${x}`}>
              <span className="text-destructive">− {t("grp.cmp.removed")}:</span> {x}
            </li>
          ))}
        </ul>
      </div>
    ) : null;
  const c = inits.data ? compareVersions(asVersion(base), asVersion(target)) : null;
  const changed = c
    ? ([
        c.titleChanged && "title",
        c.summaryChanged && "summary",
        c.thesisChanged && "thesis",
        c.outcomeChanged && "outcome",
      ].filter(Boolean) as string[])
    : [];
  return (
    <div className="border-t pt-2 text-xs">
      <Button
        size="sm"
        variant="link"
        className="h-auto px-0"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? t("grp.cmp.close") : t("grp.cmp.open", { v: base.version })}
      </Button>
      {open &&
        (inits.isError ? (
          <p role="alert" className="text-destructive">
            {t("grp.cmp.failed")}
          </p>
        ) : !c ? (
          <p role="status" className="text-muted-foreground">
            {t("grp.loading")}
          </p>
        ) : (
          <div
            className="mt-2 space-y-2 rounded-md border bg-muted/30 p-3"
            aria-label={t("grp.cmp.title", { a: c.from, b: c.to })}
          >
            <p className="text-sm font-medium">{t("grp.cmp.title", { a: c.from, b: c.to })}</p>
            {c.unchanged ? (
              <p>{t("grp.cmp.unchanged")}</p>
            ) : (
              <>
                {changed.length > 0 && (
                  <p>
                    {t("grp.cmp.changedText", {
                      list: changed.map((k) => t(tk(`grp.cmp.f.${k}`))).join(", "),
                    })}
                  </p>
                )}
                {c.outcomeChanged && (
                  <p className="text-muted-foreground">
                    {c.outcome.before || t("grp.cmp.noBudget")} →{" "}
                    {c.outcome.after || t("grp.cmp.noBudget")}
                  </p>
                )}
                {diffLine(t("grp.cmp.initiatives"), c.initiatives)}
                {COMPARED_LISTS.map((k) => diffLine(t(tk(`grp.cmp.l.${k}`)), c.lists[k]))}
                {c.budget.changed && (
                  <p>
                    {t("grp.cmp.budget", { a: budget(c.budget.before), b: budget(c.budget.after) })}
                  </p>
                )}
              </>
            )}
            <p>
              {Object.keys(c.previousInitiatives).length
                ? t("grp.cmp.prevResults", {
                    v: c.from,
                    list: Object.entries(c.previousInitiatives)
                      .map(([s, n]) => `${n} ${t(tk(`grp.is.${s}`)).toLowerCase()}`)
                      .join(", "),
                  })
                : t("grp.cmp.prevNone", { v: c.from })}
            </p>
            <p className="text-muted-foreground">{t("grp.cmp.note")}</p>
          </div>
        ))}
    </div>
  );
}
