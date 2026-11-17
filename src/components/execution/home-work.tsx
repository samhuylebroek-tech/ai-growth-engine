import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { executionOptions, executionSummary, type Task } from "@/lib/execution";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
export function HomeWork({
  section,
}: {
  section: "priorities" | "attention" | "active" | "upcoming";
}) {
  const o = useOrg();
  const qc = useQueryClient();
  const q = useQuery(executionOptions(o.org?.id, o.workspace?.id, o.userId));
  const goalIds = [...new Set([
    ...(q.data?.projects ?? []).map((p) => p.goal_id),
    ...(q.data?.campaigns ?? []).map((campaign) => campaign.goal_id),
  ].filter((id): id is string => !!id))];
  const goals = useQuery({
    queryKey: ["execution-goal-labels", o.org?.id, o.workspace?.id, goalIds],
    enabled: !!o.org?.id && !!o.workspace?.id && goalIds.length > 0,
    queryFn: async () => {
      if (!o.org || !o.workspace || !goalIds.length) return [];
      const r = await supabase.from("growth_goals").select("id,title")
        .eq("org_id", o.org.id).eq("workspace_id", o.workspace.id).in("id", goalIds);
      if (r.error) throw r.error;
      return r.data ?? [];
    },
  });
  const goalTitle = (id: string | null) => goals.data?.find((g) => g.id === id)?.title;
  if (q.isLoading)
    return (
      <p role="status" className="py-3 text-xs text-muted-foreground">
        Checking planned work…
      </p>
    );
  if (q.isError)
    return (
      <p role="alert" className="py-3 text-xs text-destructive">
        Planned work unavailable.
        <Button variant="link" size="sm" onClick={() => q.refetch()}>
          Retry
        </Button>
      </p>
    );
  if (!q.data) return null;
  const d = executionSummary(q.data.tasks, q.data.projects, q.data.campaigns, o.userId);
  const tasks =
    section === "attention"
      ? [...d.overdue, ...d.review]
      : section === "upcoming"
        ? d.upcoming
        : section === "priorities"
          ? d.today
          : q.data.tasks.filter((t) => t.status === "in_progress");
  async function complete(t: Task) {
    if (!o.org || !o.workspace) return;
    const r = await supabase
      .from("tasks")
      .update({ status: "done" })
      .eq("id", t.id)
      .eq("org_id", o.org.id)
      .eq("workspace_id", o.workspace.id);
    if (r.error) toast.error(r.error.message);
    else await qc.invalidateQueries({ queryKey: ["execution"] });
  }
  return (
    <div>
      {section === "active" &&
        d.active.slice(0, 4).map((p) => (
          <div key={p.id} className="border-b border-border py-3">
            <Link
              to={q.data?.projects.some((x) => x.id === p.id) ? "/app/projects" : "/app/campaigns"}
              search={{ item: p.id }}
              className="text-xs font-medium hover:text-primary"
            >
              {p.title} <ArrowUpRight className="inline h-3 w-3" />
            </Link>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {p.status} · {p.priority}
            </p>
            {"goal_id" in p && p.goal_id && goalTitle(p.goal_id) && (
              <p className="mt-1 text-[11px] text-muted-foreground">Growth goal · {goalTitle(p.goal_id)}</p>
            )}
          </div>
        ))}
      {tasks.slice(0, 5).map((t) => (
        <div key={t.id} className="flex items-start gap-2 border-b border-border py-3">
          {can(o.workspaceRole, "profile.edit") && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              aria-label={`Complete ${t.title}`}
              onClick={() => complete(t)}
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
          )}
          <div className="min-w-0 flex-1">
            <Link
              to="/app/tasks"
              search={{ item: t.id }}
              className="break-words text-xs font-medium hover:text-primary"
            >
              {t.title}
            </Link>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t.due_date ?? "No deadline"} · {t.priority} · {t.status.replace(/_/g, " ")}
            </p>
          </div>
        </div>
      ))}
      {!tasks.length && !(section === "active" && d.active.length) && (
        <p className="py-3 text-xs text-muted-foreground">
          {section === "attention"
            ? "No overdue tasks or tasks awaiting review."
            : section === "priorities"
              ? "No tasks due today."
              : section === "upcoming"
                ? "No upcoming task deadlines."
                : "No projects, campaigns or tasks in progress."}
        </p>
      )}
      {section === "upcoming" &&
        q.data.campaigns
          .filter((c) => c.status === "planned" && c.start_date)
          .slice(0, 3)
          .map((c) => (
            <div key={c.id} className="border-b border-border py-3">
              <Link to="/app/campaigns" search={{ item: c.id }} className="text-xs font-medium">
                {c.title}
              </Link>
              <p className="text-[11px] text-muted-foreground">Starts {c.start_date}</p>
            </div>
          ))}
      <Button variant="link" size="sm" className="mt-2 px-0" asChild>
        <Link to="/app/tasks">
          View tasks <ArrowUpRight />
        </Link>
      </Button>
    </div>
  );
}
