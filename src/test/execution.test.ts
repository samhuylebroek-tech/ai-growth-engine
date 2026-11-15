import { describe, it, expect } from "vitest";
import {
  draftExecutionPlan,
  planSchema,
  dateInput,
  executionSummary,
  taskProgress,
  nextOccurrence,
  executionOptions,
  type Task,
} from "@/lib/execution";
const task = (id: string, date: string | null, status = "todo", owner = "me"): Task => ({
  id,
  title: id,
  description: "",
  org_id: "org",
  workspace_id: "ws",
  status,
  priority: "medium",
  due_date: date,
  start_date: null,
  project_id: null,
  campaign_id: null,
  parent_task_id: null,
  owner_id: owner,
  agent_key: null,
  labels: [],
  recurrence: "none",
  recurrence_source_id: null,
  source_message_id: null,
  created_by: "me",
  created_at: "2026-11-15T00:00:00Z",
  updated_at: "2026-11-15T00:00:00Z",
});
describe("execution rules", () => {
  it("converts numbered and bullet recommendations into editable tasks without repeated titles", () => {
    const p = draftExecutionPlan("# SEO plan\n1. Audit pages\n- Write content\n- Audit pages");
    expect(p.tasks.map((t) => t.title)).toEqual(["Audit pages", "Write content"]);
    expect(p.tasks[0]?.due_date).toBe("");
  });
  it("rejects duplicate task titles regardless of case or surrounding whitespace", () => {
    const p = draftExecutionPlan("Plan\n- Audit");
    p.tasks.push({
      ...p.tasks[0],
      title: " AUDIT ",
      description: "",
      priority: "medium",
      owner_id: "",
      due_date: "",
    });
    expect(planSchema.safeParse(p).success).toBe(false);
  });
  it("requires at least one task before confirmation", () => {
    expect(planSchema.safeParse({ ...draftExecutionPlan("Plan"), tasks: [] }).success).toBe(false);
  });
  it("validates actual deadline dates", () => {
    expect(dateInput.safeParse("2026-02-30").success).toBe(false);
    expect(dateInput.safeParse("2026-11-15").success).toBe(true);
  });
  it("keeps overdue, today and upcoming mutually exclusive and excludes completed work", () => {
    const s = executionSummary(
      [
        task("late", "2026-11-14"),
        task("today", "2026-11-15"),
        task("future", "2026-11-16"),
        task("done", "2026-11-14", "done"),
      ],
      [],
      [],
      "me",
      "2026-11-15",
    );
    expect(s.overdue.map((t) => t.id)).toEqual(["late"]);
    expect(s.today.map((t) => t.id)).toEqual(["today"]);
    expect(s.upcoming.map((t) => t.id)).toEqual(["future"]);
  });
  it("personal tasks are scoped to the assigned user", () => {
    expect(
      executionSummary(
        [task("mine", null), task("other", null, "todo", "them")],
        [],
        [],
        "me",
      ).mine.map((t) => t.id),
    ).toEqual(["mine"]);
  });
  it("progress reflects completed persisted tasks", () => {
    expect(taskProgress([task("a", null, "done"), task("b", null)])).toBe(50);
    expect(taskProgress([])).toBe(0);
  });
  it("weekly recurrence advances seven days", () => {
    expect(nextOccurrence("2026-11-15", "weekly")).toBe("2026-11-22");
  });
  it("monthly recurrence clamps to the last day of a shorter month", () => {
    expect(nextOccurrence("2026-01-31", "monthly")).toBe("2026-02-28");
  });
  it("cache identities separate organizations workspaces and users", () => {
    expect(executionOptions("a", "w", "u").queryKey).not.toEqual(
      executionOptions("b", "w", "u").queryKey,
    );
    expect(executionOptions("a", "w", "u").queryKey).not.toEqual(
      executionOptions("a", "x", "u").queryKey,
    );
    expect(executionOptions("a", "w", "u").queryKey).not.toEqual(
      executionOptions("a", "w", "v").queryKey,
    );
  });
});
