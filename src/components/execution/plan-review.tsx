import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, FolderKanban, CheckSquare, Megaphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useOrg } from "@/lib/org-context";
import { supabase } from "@/integrations/supabase/client";
import { draftExecutionPlan, executionOptions, planSchema } from "@/lib/execution";

export function PlanReview({ sourceId, content }: { sourceId: string; content: string }) {
  const o = useOrg();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"project" | "tasks" | "campaign">("project");
  const [plan, setPlan] = useState(() => draftExecutionPlan(content));
  const [busy, setBusy] = useState(false);
  const [request, setRequest] = useState("");
  const [goalId, setGoalId] = useState("");
  const q = useQuery(executionOptions(o.org?.id, o.workspace?.id, o.userId));
  const goals = useQuery({
    queryKey: ["growth-goals-for-execution", o.org?.id, o.workspace?.id],
    enabled: open && !!o.org?.id && !!o.workspace?.id,
    queryFn: async () => {
      if (!o.org || !o.workspace) return [];
      const r = await supabase.from("growth_goals")
        .select("id,title,status")
        .eq("org_id", o.org.id)
        .eq("workspace_id", o.workspace.id)
        .in("status", ["active", "draft"])
        .order("priority", { ascending: true })
        .order("updated_at", { ascending: false });
      if (r.error) throw r.error;
      return r.data ?? [];
    },
  });
  const selectedGoalId = goalId || goals.data?.[0]?.id || "";
  async function create() {
    if (!o.workspace || busy) return;
    const valid = planSchema.safeParse(plan);
    if (!valid.success) {
      toast.error(valid.error.issues[0]?.message ?? "Check your plan");
      return;
    }
    setBusy(true);
    try {
      const r = await supabase.rpc("convert_execution_plan", {
        _workspace: o.workspace.id,
        _source: sourceId,
        _kind: kind,
        _request: request,
        _plan: valid.data,
        _goal: kind === "tasks" || !selectedGoalId ? null : selectedGoalId,
      });
      if (r.error) throw r.error;
      await qc.invalidateQueries({ queryKey: ["execution"] });
      toast.success("Reviewed plan saved. Repeated requests reuse the same work.");
      setOpen(false);
      const data = r.data as { parent_id?: string };
      if (kind === "project")
        await navigate({ to: "/app/projects", search: { item: data.parent_id } });
      else if (kind === "campaign")
        await navigate({ to: "/app/campaigns", search: { item: data.parent_id } });
      else await navigate({ to: "/app/tasks", search: { item: undefined } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the plan");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setRequest(crypto.randomUUID());
          setGoalId("");
          setOpen(true);
        }}
      >
        <FolderKanban />
        Turn into work
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!busy) setOpen(v);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Review execution plan</DialogTitle>
            <DialogDescription>
              Nothing is created until you confirm. No external publishing.
            </DialogDescription>
          </DialogHeader>
          {kind !== "tasks" && (
            <label className="block space-y-1 text-xs">
              Link to growth goal
              <select
                aria-label="Link to growth goal"
                className="w-full rounded-md border border-border bg-background p-2"
                value={selectedGoalId}
                onChange={(e) => setGoalId(e.target.value)}
                disabled={goals.isLoading || goals.isError}
              >
                <option value="">No growth goal</option>
                {goals.data?.map((goal) => (
                  <option key={goal.id} value={goal.id}>{goal.title}</option>
                ))}
              </select>
              {goals.isError && <span role="alert" className="block text-destructive">Growth goals could not load. Retry by closing and reopening this review.</span>}
            </label>
          )}
          <div className="flex flex-wrap gap-1">
            {(
              [
                { key: "project", label: "Project", icon: FolderKanban },
                { key: "tasks", label: "Tasks", icon: CheckSquare },
                { key: "campaign", label: "Campaign", icon: Megaphone },
              ] as const
            ).map((k) => (
              <Button
                key={k.key}
                size="sm"
                variant={kind === k.key ? "secondary" : "ghost"}
                onClick={() => setKind(k.key)}
              >
                <k.icon />
                {k.label}
              </Button>
            ))}
          </div>
          <label className="space-y-1 text-xs">
            Title
            <Input
              aria-label="Plan title"
              value={plan.title}
              onChange={(e) => setPlan({ ...plan, title: e.target.value })}
            />
          </label>
          <label className="space-y-1 text-xs">
            Objective
            <Input
              aria-label="Plan objective"
              value={plan.objective}
              onChange={(e) => setPlan({ ...plan, objective: e.target.value })}
            />
          </label>
          <label className="space-y-1 text-xs">
            Description
            <Textarea
              aria-label="Plan description"
              rows={3}
              value={plan.description}
              onChange={(e) => setPlan({ ...plan, description: e.target.value })}
            />
          </label>
          {kind === "campaign" && (
            <label className="space-y-1 text-xs">
              Campaign type
              <select
                aria-label="Plan campaign type"
                className="w-full rounded-md border border-border bg-background p-2"
                value={plan.category}
                onChange={(e) =>
                  setPlan({
                    ...plan,
                    category: planSchema.innerType().shape.category.parse(e.target.value),
                  })
                }
              >
                {planSchema.innerType().shape.category.options.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          )}
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Proposed tasks · {plan.tasks.length}</h3>
            <Button
              variant="ghost"
              size="sm"
              disabled={plan.tasks.length >= 40}
              onClick={() =>
                setPlan({
                  ...plan,
                  tasks: [
                    ...plan.tasks,
                    { title: "", description: "", due_date: "", priority: "medium", owner_id: "" },
                  ],
                })
              }
            >
              <Plus />
              Add task
            </Button>
          </div>
          <div className="divide-y divide-border">
            {plan.tasks.map((t, i) => (
              <div key={i} className="space-y-2 py-3">
                <div className="flex gap-2">
                  <Input
                    aria-label={`Proposed task ${i + 1}`}
                    value={t.title}
                    onChange={(e) =>
                      setPlan({
                        ...plan,
                        tasks: plan.tasks.map((x, j) =>
                          j === i ? { ...x, title: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove proposed task ${i + 1}`}
                    onClick={() =>
                      setPlan({ ...plan, tasks: plan.tasks.filter((_, j) => j !== i) })
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Input
                    aria-label={`Proposed deadline ${i + 1}`}
                    type="date"
                    value={t.due_date}
                    onChange={(e) =>
                      setPlan({
                        ...plan,
                        tasks: plan.tasks.map((x, j) =>
                          j === i ? { ...x, due_date: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <select
                    aria-label={`Proposed priority ${i + 1}`}
                    className="min-w-0 rounded-md border border-border bg-background px-2 text-xs"
                    value={t.priority}
                    onChange={(e) =>
                      setPlan({
                        ...plan,
                        tasks: plan.tasks.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                priority: planSchema
                                  .innerType()
                                  .shape.tasks.element.shape.priority.parse(e.target.value),
                              }
                            : x,
                        ),
                      })
                    }
                  >
                    {["low", "medium", "high", "urgent"].map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                  <select
                    aria-label={`Proposed owner ${i + 1}`}
                    className="min-w-0 rounded-md border border-border bg-background px-2 text-xs"
                    value={t.owner_id}
                    onChange={(e) =>
                      setPlan({
                        ...plan,
                        tasks: plan.tasks.map((x, j) =>
                          j === i ? { ...x, owner_id: e.target.value } : x,
                        ),
                      })
                    }
                  >
                    <option value="">Unassigned</option>
                    {q.data?.members.map((m) => (
                      <option value={m.user_id} key={m.user_id}>
                        {m.display_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
          <Button disabled={busy || q.isError} onClick={create}>
            {busy ? "Saving reviewed plan…" : "Confirm & create"}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
