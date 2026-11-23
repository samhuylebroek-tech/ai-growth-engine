import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight, ArrowUpRight, Compass } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { nextSteps, type NextStep as Step } from "@/lib/next-step";
import { growthSignalsOptions } from "@/components/app/growth-signals";
import { HOME_DUPLICATES } from "@/lib/signals";
import { ANSWER_SOURCE } from "@/lib/onboarding/questions";
import { overallProgress } from "@/lib/onboarding/answers";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type NextStepCounts = {
  onboardingDone: boolean;
  confirmedFacts: number;
  unconfirmedFacts: number;
  pendingApprovals: number;
  highRiskApprovals: number;
  overdueTasks: number;
};

/** One recommended action at the top of Home; same records and warnings as the rest of the page. */
export function NextStep({ counts }: { counts: NextStepCounts }) {
  const o = useOrg();
  const { t } = useI18n();
  const signals = useQuery(growthSignalsOptions(o.org?.id, o.workspace));
  const goal = useQuery({
    queryKey: ["next-step-goal", o.org?.id, o.workspace?.id],
    enabled: !!o.org && !!o.workspace,
    queryFn: async () => {
      const r = await supabase
        .from("growth_goals")
        .select("id", { count: "exact", head: true })
        .eq("org_id", o.org!.id)
        .eq("workspace_id", o.workspace!.id)
        .eq("status", "active");
      if (r.error) throw r.error;
      return (r.count ?? 0) > 0;
    },
  });
  const answers = useQuery({
    queryKey: ["next-step-answers", o.org?.id, o.workspace?.id],
    enabled: !!o.org && !!o.workspace && counts.onboardingDone,
    queryFn: async () => {
      const r = await supabase
        .from("business_facts")
        .select("key")
        .eq("org_id", o.org!.id)
        .eq("workspace_id", o.workspace!.id)
        .eq("source_ref", ANSWER_SOURCE)
        .eq("verified", true)
        .limit(200);
      if (r.error) throw r.error;
      return overallProgress(
        (r.data ?? []).map((f) => ({
          key: f.key,
          value: "",
          verified: true,
          source_type: "user",
          source_ref: ANSWER_SOURCE,
        })),
      );
    },
  });
  if (signals.isLoading || goal.isLoading)
    return (
      <p
        role="status"
        className="mb-6 rounded-xl border border-border p-5 text-sm text-muted-foreground"
      >
        {t("gx.next.loading")}
      </p>
    );
  const { primary, alternatives } = nextSteps({
    ...counts,
    canEdit: can(o.workspaceRole, "profile.edit"),
    canConfirm: can(o.workspaceRole, "profile.confirm"),
    canDecide: can(o.workspaceRole, "approvals.decide"),
    canUseAi: can(o.workspaceRole, "ai.use"),
    // A failed read is unknown, never "no goal" or "no warnings".
    hasActiveGoal: goal.isSuccess ? goal.data : null,
    understanding: answers.isSuccess ? answers.data : null,
    signals: (signals.data ?? []).filter((s) => !HOME_DUPLICATES.has(s.code)),
  });
  const title = (s: Step) =>
    s.signal
      ? t(`signal.${s.signal.code}.title` as MessageKey, s.vars)
      : t(`gx.step.${s.code}.title` as MessageKey, s.vars);
  const why = (s: Step) =>
    s.signal
      ? `${t(`sx.${s.signal.code}.why` as MessageKey)} ${t(`sx.${s.signal.code}.do` as MessageKey)}`
      : t(`gx.step.${s.code}.why` as MessageKey);
  const cta = (s: Step) =>
    s.signal ? t("gx.step.signal.cta") : t(`gx.step.${s.code}.cta` as MessageKey);
  return (
    <section
      aria-labelledby="next-step-title"
      className={cn(
        "mb-6 rounded-xl border bg-card p-5 sm:p-6",
        primary.urgent ? "border-warning/50" : "border-primary/30",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
            primary.urgent ? "bg-warning/10 text-warning" : "bg-primary/10 text-primary",
          )}
        >
          <Compass className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="section-label mb-1">
            {t("gx.next.label")}
            {primary.urgent && (
              <span className="ml-2 font-medium text-warning">· {t("gx.next.urgent")}</span>
            )}
          </p>
          <h2 id="next-step-title" className="text-lg font-semibold leading-snug">
            {title(primary)}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            <span className="sr-only">{t("gx.next.why")} </span>
            {why(primary)}
          </p>
          <Button className="mt-4 min-h-11" asChild>
            <Link to={primary.to}>
              {cta(primary)} <ArrowRight />
            </Link>
          </Button>
        </div>
      </div>
      {!!alternatives.length && (
        <div className="mt-5 border-t border-border pt-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">{t("gx.next.or")}</p>
          <ul className="space-y-1">
            {alternatives.map((s, i) => (
              <li key={`${s.code}-${s.signal?.id ?? i}`}>
                <Link
                  to={s.to}
                  className="group flex min-h-10 items-center justify-between gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted"
                >
                  <span className="min-w-0 break-words">{title(s)}</span>
                  <ArrowUpRight
                    className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-4 text-[11px] text-muted-foreground">{t("gx.next.basis")}</p>
    </section>
  );
}
