import { Link } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import { useOrg } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { executionOptions, executionSummary, PRIORITIES, STATUSES, type Task } from "@/lib/execution";
import type { MessageKey } from "@/lib/i18n/messages";
const STATUS_KEYS = new Set<string>([...STATUSES.projects, ...STATUSES.tasks]);
const GOAL_STATUS = new Set(["achieved", "active", "approved", "archived", "blocked", "cancelled", "completed", "draft", "in_progress", "paused", "planned", "rejected", "superseded"]);
import { Button } from "@/components/ui/button";
import { growthDb as supabase, retryUnlessNotInstalled } from "@/lib/pending-schema";
export function HomeWork({
  section,
}: {
  section: "priorities" | "attention" | "active" | "upcoming";
}) {
  const o = useOrg();
  const qc = useQueryClient();
  const { t: tr, tag } = useI18n();
  const ws = (s: string) => (STATUS_KEYS.has(s) ? tr(`work.status.${s}` as MessageKey) : s.replace(/_/g, " "));
  const pr = (p: string) => (PRIORITIES.includes(p) ? tr(`work.priority.${p}` as MessageKey) : p);
  const gs = (s: string) => (GOAL_STATUS.has(s) ? tr(`goals.status.${s}` as MessageKey) : s.replace(/_/g, " "));
  const day = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(tag);
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
  const projectIds = (q.data?.projects ?? []).map((project) => project.id);
  const initiatives = useQuery({
    queryKey: ["execution-growth-initiatives", o.org?.id, o.workspace?.id, projectIds],
    retry: retryUnlessNotInstalled,
    enabled: !!o.org?.id && !!o.workspace?.id && projectIds.length > 0,
    queryFn: async () => {
      if (!o.org || !o.workspace || !projectIds.length) return [];
      const r = await supabase.from("growth_initiatives").select("id,title,status,project_id")
        .eq("org_id", o.org.id).eq("workspace_id", o.workspace.id).in("project_id", projectIds);
      if (r.error) throw r.error;
      return r.data ?? [];
    },
  });
  const initiativeIds = (initiatives.data ?? []).map(item => item.id);
  const initiativeOperations = useQuery({
    queryKey: ["command-center-initiative-operations", o.workspace?.id, initiativeIds],
    enabled: !!o.workspace?.id && initiativeIds.length > 0,
    queryFn: async () => {
      if (!o.org || !o.workspace || !initiativeIds.length) return [];
      const r = await supabase.from("growth_initiative_operations").select("initiative_id,due_date,owner_id,blocker_note,success_metric,current_value,target_value")
        .eq("org_id", o.org.id).eq("workspace_id", o.workspace.id).in("initiative_id", initiativeIds);
      if (r.error) throw r.error;
      return r.data ?? [];
    },
  });
  const initiativeForProject = (id: string) => initiatives.data?.find((item) => item.project_id === id);
  const operationsForInitiative = (id: string) => initiativeOperations.data?.find(item => item.initiative_id === id);

  if (q.isLoading)
    return (
      <p role="status" className="py-3 text-xs text-muted-foreground">
        {tr("work.checking")}
      </p>
    );
  if (q.isError)
    return (
      <p role="alert" className="py-3 text-xs text-destructive">
        {tr("work.unavailable")}
        <Button variant="link" size="sm" onClick={() => q.refetch()}>
          {tr("work.retry")}
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
              {ws(p.status)} · {pr(p.priority)}
            </p>
            {(() => { const initiative = initiativeForProject(p.id); if (!initiative) return null; const ops = operationsForInitiative(initiative.id); return <div className="mt-1 space-y-1 text-[11px] text-muted-foreground"><p>{tr("work.initiative", { t: initiative.title, s: gs(initiative.status) })}</p>{ops?.due_date && <p>{tr("work.due", { d: day(ops.due_date) })}</p>}{ops?.owner_id && <p>{ops.owner_id === o.userId ? tr("work.assignedYou") : tr("work.assignedOther")}</p>}{ops?.blocker_note && <p className="font-medium text-destructive">{tr("work.blocked", { n: ops.blocker_note })}</p>}{ops?.success_metric && ops.target_value != null && <p>{tr("work.outcome", { m: ops.success_metric, c: ops.current_value == null ? tr("work.notMeasured") : String(ops.current_value), t: String(ops.target_value) })}</p>}</div>; })()}
            {"goal_id" in p && p.goal_id && goalTitle(p.goal_id) && (
              <p className="mt-1 text-[11px] text-muted-foreground">{tr("work.goal", { t: goalTitle(p.goal_id) ?? "" })}</p>
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
              aria-label={tr("work.complete", { t: t.title })}
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
              {t.due_date ? day(t.due_date) : tr("work.noDeadline")} · {pr(t.priority)} · {ws(t.status)}
            </p>
          </div>
        </div>
      ))}
      {!tasks.length && !(section === "active" && d.active.length) && (
        <p className="py-3 text-xs text-muted-foreground">
          {section === "attention"
            ? tr("work.noAttention")
            : section === "priorities"
              ? tr("work.noToday")
              : section === "upcoming"
                ? tr("work.noUpcoming")
                : tr("work.noActive")}
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
              <p className="text-[11px] text-muted-foreground">{tr("work.starts", { d: day(c.start_date!) })}</p>
            </div>
          ))}
      <Button variant="link" size="sm" className="mt-2 px-0" asChild>
        <Link to="/app/tasks">
          {tr("work.viewTasks")} <ArrowUpRight />
        </Link>
      </Button>
    </div>
  );
}
