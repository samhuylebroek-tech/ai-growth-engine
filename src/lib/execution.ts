import { z } from "zod";
import { collectPages } from "@/lib/pagination";
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
          owner_id: z.guid().or(z.literal("")),
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
const CLAIM_TAG = /^\[(?:fact|calc|calculation|estimate|hypothesis|recommendation|missing)\]:?\s*/i;
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\*\*/g, "").trim().replace(CLAIM_TAG, "").slice(0, n) : "");
/** Saved structured answers (strategies, specialist analyses) are JSON; draft from their fields instead of raw braces. */
function draftFromStructured(content: string): ExecutionPlan | null {
  if (!content.trimStart().startsWith("{")) return null;
  let d: unknown;
  try { d = JSON.parse(content); } catch { return null; }
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  const o = d as Record<string, unknown>;
  const summary = clip(o["summary"], 12000);
  const title = clip(o["title"], 200) || clip(summary.split(/(?<=[.!?])\s/)[0], 200) || "Growth action plan";
  const list = ["next_steps", "actions", "steps", "tasks"].map((k) => o[k]).find(Array.isArray) as unknown[] | undefined;
  const steps = (list ?? []).map((x) => {
    if (typeof x === "string") return { title: clip(x, 200), description: "" };
    const r = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    return { title: clip(r["title"] ?? r["action"] ?? r["step"] ?? r["name"], 200), description: clip(r["detail"] ?? r["description"], 12000) };
  }).filter((t) => t.title);
  const unique = [...new Map(steps.map((t) => [t.title.toLowerCase(), t])).values()].slice(0, 40);
  return {
    title,
    description: summary,
    objective: "",
    category: "marketing",
    tasks: (unique.length ? unique : [{ title, description: "" }]).map((t) => ({
      ...t,
      due_date: "",
      priority: "medium",
      owner_id: "",
    })),
  };
}
export function draftExecutionPlan(content: string): ExecutionPlan {
  const structured = draftFromStructured(content);
  if (structured) return structured;
  const lines = content.split("\n");
  const steps = lines
    .filter((l) => /^\s*(?:[-*]|\d+[.)])\s+/.test(l))
    .map((l) =>
      l
        .replace(/^\s*(?:[-*]|\d+[.)])\s+/, "")
        .replace(/\*\*/g, "")
        // Information labels from AI answers (src/lib/claims.ts) are not part of a task title.
        .replace(CLAIM_TAG, "")
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
    active: [...projects, ...campaigns].filter((p) => ["active", "needs_attention", "optimizing"].includes(p.status)),
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
    queryKey: ["execution", "v2", orgId, workspaceId, userId],
    enabled: !!orgId && !!workspaceId,
    refetchInterval: 30000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      if (!orgId || !workspaceId) throw new Error("Choose a workspace");
      const watermark = new Date().toISOString();
      function all<K extends "projects" | "tasks" | "campaigns" | "execution_notes" | "approvals">(table: K) {
        // Build predicates with concrete table types; the client generic cannot narrow shared columns.
        return collectPages<Database["public"]["Tables"][K]["Row"]>(async (cursor, size) => {
          const build = () => {
            if (table === "projects") return supabase.from("projects").select("*").eq("org_id", orgId ?? "").eq("workspace_id", workspaceId ?? "").lte("created_at", watermark).order("id").limit(size);
            if (table === "tasks") return supabase.from("tasks").select("*").eq("org_id", orgId ?? "").eq("workspace_id", workspaceId ?? "").lte("created_at", watermark).order("id").limit(size);
            if (table === "campaigns") return supabase.from("campaigns").select("*").eq("org_id", orgId ?? "").eq("workspace_id", workspaceId ?? "").lte("created_at", watermark).order("id").limit(size);
            if (table === "execution_notes") return supabase.from("execution_notes").select("*").eq("org_id", orgId ?? "").eq("workspace_id", workspaceId ?? "").lte("created_at", watermark).order("id").limit(size);
            return supabase.from("approvals").select("*").eq("org_id", orgId ?? "").eq("workspace_id", workspaceId ?? "").lte("created_at", watermark).order("id").limit(size);
          };
          const query = build();
          const result = await (cursor ? query.gt("id", cursor) : query);
          return { data: result.data as Database["public"]["Tables"][K]["Row"][] | null, error: result.error };
        });
      }
      const [projectRows, taskRows, campaignRows, noteRows, events, members, approvalRows] = await Promise.all([
        all("projects"), all("tasks"), all("campaigns"), all("execution_notes"),
        supabase.from("activity_events").select("*").eq("org_id", orgId).eq("workspace_id", workspaceId).order("created_at", { ascending: false }).order("id").limit(200),
        supabase.rpc("execution_workspace_members", { _workspace: workspaceId }), all("approvals"),
      ]);
      for (const result of [events, members]) if (result.error) throw result.error;
      const projects = { data: projectRows.sort((a,b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id)) };
      const tasks = { data: taskRows.sort((a,b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id)) };
      const campaigns = { data: campaignRows.sort((a,b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id)) };
      const notes = { data: noteRows.sort((a,b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)) };
      const approvals = { data: approvalRows };
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

/**
 * Goal used when converting a recommendation: an explicit choice wins, including "" for "no growth goal";
 * only when nothing was chosen yet is the top-priority goal preselected.
 */
export function pickConversionGoal(chosen: string | null, goals: readonly { id: string }[] | undefined): string {
  return chosen ?? goals?.[0]?.id ?? "";
}
