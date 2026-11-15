import { z } from "zod";
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
export type WorkKind = "projects" | "tasks" | "campaigns";
export type WorkItem =
  | Database["public"]["Tables"]["tasks"]["Row"]
  | Database["public"]["Tables"]["projects"]["Row"]
  | Database["public"]["Tables"]["campaigns"]["Row"];
export type Task = Database["public"]["Tables"]["tasks"]["Row"];
export type Note = Database["public"]["Tables"]["execution_notes"]["Row"];
export const STATUSES = {
  projects: ["planned", "active", "paused", "completed", "archived"],
  tasks: ["todo", "in_progress", "review", "done", "cancelled"],
  campaigns: ["planned", "active", "paused", "completed", "archived"],
};
export const PRIORITIES = ["low", "medium", "high", "urgent"];
export const dateInput = z
  .string()
  .refine(
    (v) =>
      !v ||
      (/^\d{4}-\d{2}-\d{2}$/.test(v) &&
        !Number.isNaN(Date.parse(v)) &&
        new Date(v).toISOString().slice(0, 10) === v),
    "Invalid date",
  );
export const planSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(12000),
    objective: z.string().max(3000),
    category: z.enum(["marketing", "seo", "content", "social", "advertising", "email", "sales"]),
    tasks: z
      .array(
        z.object({
          title: z.string().trim().min(1).max(200),
          description: z.string().max(12000),
          due_date: dateInput,
          priority: z.enum(["low", "medium", "high", "urgent"]),
          owner_id: z.string().uuid().or(z.literal("")),
        }),
      )
      .min(1)
      .max(40),
  })
  .superRefine((p, ctx) => {
    const titles = p.tasks.map((t) => t.title.toLocaleLowerCase());
    if (new Set(titles).size !== titles.length)
      ctx.addIssue({ code: "custom", message: "Duplicate task titles", path: ["tasks"] });
  });
export type ExecutionPlan = z.infer<typeof planSchema>;
/** Extract only explicit bullet/numbered steps. This is a local editable draft, not a second AI call. */
export function draftExecutionPlan(content: string): ExecutionPlan {
  const lines = content.split("\n");
  const steps = lines
    .filter((l) => /^\s*(?:[-*]|\d+[.)])\s+/.test(l))
    .map((l) =>
      l
        .replace(/^\s*(?:[-*]|\d+[.)])\s+/, "")
        .replace(/\*\*/g, "")
        .trim(),
    )
    .filter(Boolean);
  const unique = [...new Map(steps.map((t) => [t.toLowerCase(), t])).values()].slice(0, 40);
  const title = (lines.find((l) => l.trim()) ?? "Growth action plan")
    .replace(/^#+\s*/, "")
    .replace(/\*\*/g, "")
    .slice(0, 200);
  return {
    title,
    description: content.slice(0, 12000),
    objective: "",
    category: "marketing",
    tasks: (unique.length ? unique : [title]).map((t) => ({
      title: t.slice(0, 200),
      description: "",
      due_date: "",
      priority: "medium",
      owner_id: "",
    })),
  };
}
export function localDay(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
export function executionSummary(
  tasks: Task[],
  projects: WorkItem[],
  campaigns: WorkItem[],
  userId: string,
  today = localDay(),
) {
  const open = tasks.filter((t) => !["done", "cancelled"].includes(t.status));
  return {
    overdue: open.filter((t) => t.due_date && t.due_date < today),
    today: open.filter((t) => t.due_date === today),
    upcoming: open
      .filter((t) => t.due_date && t.due_date > today)
      .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "")),
    mine: open.filter((t) => t.owner_id === userId),
    active: [...projects, ...campaigns].filter((p) => p.status === "active"),
    review: open.filter((t) => t.status === "review"),
  };
}
export function taskProgress(tasks: Task[]) {
  return tasks.length
    ? Math.round((tasks.filter((t) => t.status === "done").length / tasks.length) * 100)
    : 0;
}
export function executionOptions(orgId?: string, workspaceId?: string, userId?: string) {
  return queryOptions({
    queryKey: ["execution", "v1", orgId, workspaceId, userId],
    enabled: !!orgId && !!workspaceId,
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      if (!orgId || !workspaceId) throw new Error("Choose a workspace");
      const [projects, tasks, campaigns, notes, events, members, approvals] = await Promise.all([
        supabase
          .from("projects")
          .select("*")
          .eq("org_id", orgId)
          .eq("workspace_id", workspaceId)
          .order("updated_at", { ascending: false }),
        supabase
          .from("tasks")
          .select("*")
          .eq("org_id", orgId)
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false }),
        supabase
          .from("campaigns")
          .select("*")
          .eq("org_id", orgId)
          .eq("workspace_id", workspaceId)
          .order("updated_at", { ascending: false }),
        supabase
          .from("execution_notes")
          .select("*")
          .eq("org_id", orgId)
          .eq("workspace_id", workspaceId)
          .order("created_at"),
        supabase
          .from("activity_events")
          .select("*")
          .eq("org_id", orgId)
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .limit(200),
        supabase.rpc("execution_workspace_members", { _workspace: workspaceId }),
        supabase
          .from("approvals")
          .select("id,title,status")
          .eq("org_id", orgId)
          .eq("workspace_id", workspaceId),
      ]);
      for (const r of [projects, tasks, campaigns, notes, events, members, approvals])
        if (r.error) throw r.error;
      return {
        projects: projects.data ?? [],
        tasks: tasks.data ?? [],
        campaigns: campaigns.data ?? [],
        notes: notes.data ?? [],
        events: events.data ?? [],
        members: members.data ?? [],
        approvals: approvals.data ?? [],
      };
    },
  });
}
export function nextOccurrence(due: string, recurrence: string) {
  const d = new Date(`${due}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error("A due date is required");
  if (recurrence === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (recurrence === "monthly") {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + 1);
    d.setUTCDate(
      Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()),
    );
  } else throw new Error("Task is not recurring");
  return d.toISOString().slice(0, 10);
}
