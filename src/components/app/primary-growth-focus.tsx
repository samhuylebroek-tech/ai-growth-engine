import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Target } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/org-context";
import { GrowthQuestion } from "@/components/app/growth-question";
import { goalProgress } from "@/lib/growth-plan";
import { Button } from "@/components/ui/button";

export function PrimaryGrowthFocus() {
  const { org, workspace } = useOrg();
  const goals = useQuery({
    queryKey: ["growth-goals-focus", org?.id, workspace?.id],
    enabled: !!org?.id && !!workspace?.id,
    queryFn: async () => {
      if (!org || !workspace) throw new Error("Choose a workspace.");
      const { data, error } = await supabase
        .from("growth_goals")
        .select("id,title,objective,metric,baseline,target,current_value,due_date,priority,status")
        .eq("org_id", org.id)
        .eq("workspace_id", workspace.id)
        .eq("status", "active")
        .order("priority", { ascending: true })
        .order("updated_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });
  const goal = goals.data;
  const progress = goal ? goalProgress(goal.baseline, goal.target, goal.current_value) : null;

  return (
    <section aria-labelledby="growth-focus-title" className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Target className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="section-label mb-1">The outcome we are working towards</p>
            <h2 id="growth-focus-title" className="text-base font-semibold">Your primary growth goal</h2>
          </div>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/app/goals">Goals & budget <ArrowUpRight /></Link>
        </Button>
      </div>

      {goals.isLoading ? (
        <p role="status" className="mt-4 text-sm text-muted-foreground">Loading your active growth goal…</p>
      ) : goals.isError ? (
        <div role="alert" className="mt-4 text-sm text-destructive">
          Your growth goal could not be loaded. <button className="underline" onClick={() => goals.refetch()}>Retry</button>
        </div>
      ) : goal ? (
        <div className="mt-4">
          <p className="text-lg font-semibold leading-snug">{goal.title}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {goal.metric && <span>Metric: {goal.metric}</span>}
            {goal.due_date && <span>Target date: {new Date(goal.due_date + "T12:00:00").toLocaleDateString()}</span>}
          </div>
          {progress !== null && (
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                <span className="text-muted-foreground">Progress from baseline</span>
                <strong className="tabular-nums">{goal.current_value} / {goal.target} {goal.metric}</strong>
              </div>
              <div
                className="h-2 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-label="Recorded growth goal progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
              >
                <div className="h-full rounded-full bg-primary" style={{ width: progress + "%" }} />
              </div>
            </div>
          )}
          {progress === null && <p className="mt-2 text-xs text-muted-foreground">Progress is not measured yet. No performance value is assumed.</p>}
        </div>
      ) : (
        <div className="mt-4 rounded-lg bg-muted/40 p-3">
          <p className="text-sm font-medium">No active growth goal has been set.</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Start with one measurable business outcome. The Growth Officer can then help turn it into a strategy and concrete work.</p>
          <Button size="sm" className="mt-3" asChild><Link to="/app/goals">Set your first growth goal <ArrowUpRight /></Link></Button>
        </div>
      )}

      <div className="mt-4 border-t border-border pt-4">
        <p className="mb-2 text-xs font-medium">Move this goal forward with your Growth Officer</p>
        <GrowthQuestion compact />
      </div>
    </section>
  );
}
