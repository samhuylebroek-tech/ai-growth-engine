import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Sparkles, Radar } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { growthDraftKey } from "@/lib/growth-draft";
import { readBusinessDomains } from "@/lib/security/business-context";
import { detectSignals, HOME_DUPLICATES, type Signal, type SignalKind } from "@/lib/signals";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/app/section-heading";
import { cn } from "@/lib/utils";

const TONE: Record<SignalKind, string> = {
  conflict: "border-destructive/30 bg-destructive/10 text-destructive",
  risk: "border-warning/30 bg-warning/10 text-warning",
  missing: "border-warning/30 bg-warning/10 text-warning",
  stale: "border-border bg-muted text-muted-foreground",
  opportunity: "border-success/30 bg-success/10 text-success",
};

/** Same scoped records and rules as the Growth Officer context; reads run as the signed-in user. */
export function growthSignalsOptions(
  orgId: string | undefined,
  workspace: { id: string; name: string } | null | undefined,
) {
  return {
    queryKey: ["growth-signals", orgId, workspace?.id],
    enabled: !!orgId && !!workspace,
    staleTime: 60_000,
    queryFn: async (): Promise<Signal[]> =>
      detectSignals(
        await readBusinessDomains(
          supabase,
          { orgId: orgId!, workspaceId: workspace!.id },
          { id: workspace!.id, name: workspace!.name },
        ),
      ),
  };
}

export function GrowthSignals() {
  const o = useOrg();
  const { t } = useI18n();
  const navigate = useNavigate();
  const q = useQuery(growthSignalsOptions(o.org?.id, o.workspace));
  const [all, setAll] = useState(false);
  const ai = can(o.workspaceRole, "ai.use");
  const items = (q.data ?? []).filter((s) => !HOME_DUPLICATES.has(s.code));
  const shown = all ? items : items.slice(0, 4);
  const ask = (s: Signal) => {
    if (!o.org || !o.workspace) return;
    sessionStorage.setItem(
      growthDraftKey(o.org.id, o.workspace.id),
      t(`signal.${s.code}.question` as MessageKey, s.vars),
    );
    navigate({ to: "/app/growth-officer" });
  };
  const level = (l: string) => t(`signals.level.${l}` as MessageKey);
  return (
    <section aria-label={t("signals.title")}>
      <SectionHeading eyebrow={t("signals.eyebrow")} title={t("signals.title")} />
      {q.isLoading && (
        <div role="status" aria-label={t("signals.title")} className="space-y-2">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-md bg-muted motion-reduce:animate-none"
            />
          ))}
        </div>
      )}
      {q.isError && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground"
        >
          {t("signals.unavailable")}
          <Button variant="outline" size="sm" onClick={() => q.refetch()}>
            {t("home.retry")}
          </Button>
        </div>
      )}
      {q.isSuccess && !items.length && (
        <p className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <Radar className="h-4 w-4" />
          {t("signals.empty")}
        </p>
      )}
      {!!shown.length && (
        <ol className="divide-y divide-border border-y border-border">
          {shown.map((s) => (
            <li
              key={s.id}
              className="flex min-w-0 flex-col gap-2 py-3 sm:flex-row sm:items-start sm:gap-4"
            >
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium",
                      TONE[s.kind],
                    )}
                  >
                    {t(`signals.kind.${s.kind}` as MessageKey)}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {t("signals.impact", {
                      impact: level(s.impact),
                      urgency: t(`signals.urgency.${s.urgency}` as MessageKey),
                    })}
                  </span>
                </div>
                <p className="break-words text-sm font-medium">
                  {t(`signal.${s.code}.title` as MessageKey, s.vars)}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {t(`signal.basis.${s.basis}` as MessageKey)}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-1">
                {ai && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => ask(s)}
                  >
                    <Sparkles />
                    {t("signals.ask")}
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="h-8 text-xs" asChild>
                  <Link to={s.to}>
                    {t("signals.open")}
                    <ArrowUpRight />
                  </Link>
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {items.length > 4 && (
        <Button
          variant="link"
          size="sm"
          className="mt-2 px-0"
          aria-expanded={all}
          onClick={() => setAll((v) => !v)}
        >
          {all ? t("signals.less") : t("signals.more", { n: items.length - 4 })}
        </Button>
      )}
    </section>
  );
}
