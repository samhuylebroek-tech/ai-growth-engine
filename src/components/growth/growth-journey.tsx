// The first growth journey (src/lib/growth-journey.ts) as one connected list of twelve steps. Read-only: every step
// opens an existing page; the journey creates nothing. Counts come from scoped reads under the viewer's permissions.
import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleDashed,
  CircleHelp,
  Clock,
  Eye,
  Route as RouteIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { growthDb } from "@/lib/pending-schema";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n/messages";
import { useOrg } from "@/lib/org-context";
import { growthDraftKey } from "@/lib/growth-draft";
import { overallProgress, understandingSummary } from "@/lib/onboarding/answers";
import { goalMeasurement } from "@/lib/goal-measurement";
import {
  growthJourney,
  STEP_ROLE,
  type JourneyInput,
  type JourneyItem,
  type JourneyState,
  type JourneyStep,
} from "@/lib/growth-journey";
import { useGuidedData } from "@/components/onboarding/guided";
import { conflictEventsOptions, openConflicts } from "@/components/app/business-understanding";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Count = number | "unknown";
const count = (r: { count: number | null; error: unknown }): Count =>
  r.error || r.count === null ? "unknown" : r.count;

/** Workspace counts for the journey; each failed read stays "unknown" on its own. */
export function useJourneyInput(): { input: JourneyInput | null; loading: boolean } {
  const o = useOrg();
  const guided = useGuidedData();
  const org = o.org?.id ?? "",
    ws = o.workspace?.id ?? "",
    user = o.userId ?? "";
  const events = useQuery(conflictEventsOptions(o.org?.id, o.workspace?.id));
  const q = useQuery({
    queryKey: ["growth-journey", org, ws, user],
    enabled: !!org && !!ws && !!user,
    queryFn: async () => {
      const head = { count: "exact" as const, head: true };
      const [conv, opp, goals, strategies, plans, campaigns, budget, approvals] = await Promise.all(
        [
          supabase
            .from("conversations")
            .select("id", head)
            .eq("org_id", org)
            .eq("workspace_id", ws)
            .eq("user_id", user),
          growthDb
            .from("growth_opportunities")
            .select("id", head)
            .eq("org_id", org)
            .eq("workspace_id", ws),
          supabase
            .from("growth_goals")
            .select("id,metric,baseline,target,current_value,due_date,status")
            .eq("org_id", org)
            .eq("workspace_id", ws)
            .eq("status", "active")
            .limit(200),
          supabase
            .from("growth_strategies")
            .select("id", head)
            .eq("org_id", org)
            .eq("workspace_id", ws),
          growthDb
            .from("growth_plan_versions")
            .select("id,status")
            .eq("org_id", org)
            .eq("workspace_id", ws)
            .limit(200),
          supabase
            .from("campaigns")
            .select("id", head)
            .eq("org_id", org)
            .eq("workspace_id", ws)
            .not("status", "in", "(archived,cancelled)"),
          supabase.from("budget_lines").select("id", head).eq("org_id", org).eq("workspace_id", ws),
          supabase
            .from("approvals")
            .select("id", head)
            .eq("org_id", org)
            .eq("workspace_id", ws)
            .eq("status", "pending"),
        ],
      );
      const today = new Date().toISOString().slice(0, 10);
      const goalRows = goals.error ? null : (goals.data ?? []);
      let planInfo: JourneyInput["plans"] = "unknown";
      if (!plans.error) {
        const rows = (plans.data ?? []) as { id: string; status: string }[];
        const approved = rows.filter((p) => p.status === "approved").map((p) => p.id);
        let withInit = 0;
        if (approved.length) {
          const init = await growthDb
            .from("growth_initiatives")
            .select("plan_version_id")
            .eq("org_id", org)
            .eq("workspace_id", ws)
            .in("plan_version_id", approved)
            .neq("status", "cancelled")
            .limit(1000);
          withInit = init.error
            ? -1
            : new Set((init.data ?? []).map((r: { plan_version_id: string }) => r.plan_version_id))
                .size;
        }
        planInfo =
          withInit < 0
            ? "unknown"
            : {
                approvedWithInitiatives: withInit,
                approved: approved.length,
                draft: rows.filter((p) => p.status === "draft").length,
              };
      }
      return {
        conversations: count(conv),
        opportunities: count(opp),
        strategies: count(strategies),
        campaigns: count(campaigns),
        budgetLines: count(budget),
        pendingApprovals: count(approvals),
        plans: planInfo,
        goals: goalRows
          ? {
              active: goalRows.length,
              measurable: goalRows.filter(
                (g) => goalMeasurement({ ...g, metric: g.metric ?? "" }, today).measurable,
              ).length,
            }
          : ("unknown" as const),
      };
    },
  });
  if (guided.isLoading || q.isLoading || events.isLoading) return { input: null, loading: true };
  const g = guided.data;
  const onboarding = g && g.complete ? overallProgress(g.facts) : null;
  const topics = g && g.complete ? understandingSummary(g.profile, g.facts) : null;
  const d = q.data;
  return {
    loading: false,
    input: {
      onboarding: onboarding
        ? { answered: onboarding.answered, total: onboarding.total }
        : "unknown",
      understanding: topics
        ? {
            known: topics.filter((x) => x.items.length).length,
            total: topics.length,
            unconfirmed: topics.reduce(
              (n, x) => n + x.items.filter((i) => i.status !== "confirmed").length,
              0,
            ),
            conflicts: g
              ? openConflicts(
                  g.facts.flatMap((f) => (f.id ? [{ ...f, id: f.id }] : [])),
                  events.data,
                ).length
              : 0,
          }
        : "unknown",
      conversations: d?.conversations ?? "unknown",
      opportunities: d?.opportunities ?? "unknown",
      goals: d?.goals ?? "unknown",
      strategies: d?.strategies ?? "unknown",
      plans: d?.plans ?? "unknown",
      campaigns: d?.campaigns ?? "unknown",
      budgetLines: d?.budgetLines ?? "unknown",
      pendingApprovals: d?.pendingApprovals ?? "unknown",
    },
  };
}

const ICON: Record<JourneyState, typeof Check> = {
  done: Check,
  attention: CircleAlert,
  todo: CircleDashed,
  waiting: Clock,
  ready: Eye,
  unknown: CircleHelp,
};
const TONE: Record<JourneyState, string> = {
  done: "border-success/30 bg-success/10 text-success",
  attention: "border-warning/30 bg-warning/10 text-warning",
  todo: "border-border bg-muted text-muted-foreground",
  waiting: "border-border bg-muted text-muted-foreground",
  ready: "border-primary/30 bg-primary/10 text-primary",
  unknown: "border-border bg-muted text-muted-foreground",
};
type Dest =
  | "/app/onboarding"
  | "/app/profile"
  | "/app/intelligence"
  | "/app/growth-officer"
  | "/app/opportunities"
  | "/app/goals"
  | "/app/campaigns"
  | "/app/approvals"
  | "/app";

function StepAction({ item, input }: { item: JourneyItem; input: JourneyInput }) {
  const { t } = useI18n();
  const o = useOrg();
  const navigate = useNavigate();
  if (!item.canAct)
    return (
      <p className="text-xs text-muted-foreground">
        {t(`gj.who.${STEP_ROLE[item.step]}` as MessageKey)}
      </p>
    );
  if (item.state === "waiting" || item.state === "unknown") return null;
  const label = t(`gj.${item.step}.cta` as MessageKey);
  const variant = item.current ? "default" : "outline";
  if (item.step === "ask") {
    const ask = () => {
      if (o.org && o.workspace) {
        try {
          sessionStorage.setItem(
            growthDraftKey(o.org.id, o.workspace.id),
            t("ob.path.ask.question"),
          );
        } catch {
          /* private mode: no prepared question */
        }
      }
      navigate({ to: "/app/growth-officer" });
    };
    return (
      <Button size="sm" variant={variant} onClick={ask}>
        {label}
        <ArrowRight />
      </Button>
    );
  }
  if (item.step === "onboarding")
    return (
      <Button size="sm" variant={variant} asChild>
        <Link to="/app/onboarding">{label}</Link>
      </Button>
    );
  if (item.step === "review")
    return (
      <Button size="sm" variant={variant} asChild>
        <Link to="/app/onboarding" search={{ section: "summary" }}>
          {label}
        </Link>
      </Button>
    );
  const pending = input.pendingApprovals !== "unknown" && input.pendingApprovals > 0;
  const to: Record<Exclude<JourneyStep, "ask" | "onboarding" | "review">, Dest> = {
    confirm: "/app/profile",
    situation: "/app/intelligence",
    opportunity: "/app/opportunities",
    goal: "/app/goals",
    strategy: "/app/goals",
    initiatives: "/app/goals",
    campaign: "/app/campaigns",
    resources: pending ? "/app/approvals" : "/app/goals",
    next: "/app",
  };
  return (
    <Button size="sm" variant={variant} asChild>
      <Link to={to[item.step]}>
        {item.step === "resources" && pending ? t("gj.resources.ctaApprovals") : label}
      </Link>
    </Button>
  );
}

function why(t: ReturnType<typeof useI18n>["t"], item: JourneyItem): string {
  if (item.state === "unknown") return t("gj.unknown");
  const k = `gj.${item.step}.${item.state}` as MessageKey;
  return t(k, { n: item.n ?? 0, total: item.total ?? 0 });
}

/** compact: Home card with the current step and a toggle for all steps; full: the whole list. */
export function GrowthJourney({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const o = useOrg();
  const { input, loading } = useJourneyInput();
  const [open, setOpen] = useState(!compact);
  if (loading || !input)
    return compact ? null : (
      <p className="mt-8 text-sm text-muted-foreground" role="status">
        {t("gj.loading")}
      </p>
    );
  const j = growthJourney(input, o.workspaceRole);
  const currentItem = j.items.find((x) => x.current);
  const index = currentItem ? j.items.indexOf(currentItem) + 1 : null;
  return (
    <section
      aria-labelledby="gj-title"
      className={cn("rounded-xl border border-border bg-card p-5", !compact && "mt-8")}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="gj-title" className="flex items-center gap-2 text-base font-semibold">
            <RouteIcon className="h-4 w-4 text-primary" aria-hidden />
            {t("gj.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("gj.intro")}</p>
        </div>
        <p className="text-sm font-medium tabular-nums">
          {t("gj.progress", { done: j.done, total: j.total })}
        </p>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${Math.round((j.done / Math.max(1, j.total)) * 100)}%` }}
        />
      </div>
      {compact && currentItem && index && (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("gj.now", { n: index, total: j.items.length })}
            </p>
            <p className="mt-0.5 text-sm font-medium">
              {t(`gj.${currentItem.step}.title` as MessageKey)}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">{why(t, currentItem)}</p>
          </div>
          <div className="shrink-0">
            <StepAction item={currentItem} input={input} />
          </div>
        </div>
      )}
      {compact && !currentItem && (
        <p className="mt-4 text-sm text-muted-foreground">{t("gj.allDone")}</p>
      )}
      {compact && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-3 -ml-2"
          aria-expanded={open}
          aria-controls="gj-steps"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronUp /> : <ChevronDown />}
          {open ? t("gj.hide") : t("gj.show")}
        </Button>
      )}
      {open && (
        <ol id="gj-steps" className="mt-4 space-y-1">
          {j.items.map((item, i) => {
            const Icon = ICON[item.state];
            return (
              <li
                key={item.step}
                aria-current={item.current ? "step" : undefined}
                className={cn(
                  "flex flex-col gap-2 rounded-lg p-3 sm:flex-row sm:items-start sm:gap-4",
                  item.current && "bg-primary/5 ring-1 ring-primary/30",
                )}
              >
                <span
                  aria-hidden
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums"
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {t(`gj.${item.step}.title` as MessageKey)}
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                        TONE[item.state],
                      )}
                    >
                      <Icon className="h-3 w-3" aria-hidden />
                      {t(`gj.state.${item.state}` as MessageKey)}
                    </span>
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{why(t, item)}</p>
                </div>
                <div className="shrink-0 sm:pt-0.5">
                  <StepAction item={item} input={input} />
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
