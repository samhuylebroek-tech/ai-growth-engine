import { describe, expect, it } from "vitest";
import { blockedTasks, unknownTaskIds } from "@/lib/task-blocking";

const T = (id: string, status = "todo", due: string | null = null) => ({
  id,
  title: id.toUpperCase(),
  status,
  due_date: due,
});
const today = "2026-06-10";

describe("blocked tasks", () => {
  it("a task waiting on an open task is blocked; waiting on a finished or cancelled task is not", () => {
    const tasks = [T("a"), T("b", "done"), T("c", "cancelled"), T("d", "in_progress"), T("x")];
    const r = blockedTasks(
      tasks,
      [
        { task_id: "a", depends_on: "d" },
        { task_id: "x", depends_on: "b" },
        { task_id: "x", depends_on: "c" },
      ],
      today,
    );
    expect(r.map((b) => b.task.id)).toEqual(["a"]);
    expect(r[0]?.waitsOn.map((p) => p.id)).toEqual(["d"]);
  });
  it("is late when the prerequisite is overdue or due on/after the waiting task's deadline", () => {
    const tasks = [
      T("a", "todo", "2026-06-20"),
      T("p", "todo", "2026-06-20"),
      T("b", "todo", "2026-06-30"),
      T("q", "todo", "2026-06-01"),
      T("c", "todo", "2026-06-30"),
      T("r", "todo", "2026-06-15"),
    ];
    const r = blockedTasks(
      tasks,
      [
        { task_id: "a", depends_on: "p" },
        { task_id: "b", depends_on: "q" },
        { task_id: "c", depends_on: "r" },
      ],
      today,
    );
    expect(Object.fromEntries(r.map((b) => [b.task.id, b.late]))).toEqual({
      a: true,
      b: true,
      c: false,
    });
  });
  it("closed tasks are never reported as blocked and self-dependencies are ignored", () => {
    expect(
      blockedTasks([T("a", "done"), T("p")], [{ task_id: "a", depends_on: "p" }], today),
    ).toEqual([]);
    expect(blockedTasks([T("a")], [{ task_id: "a", depends_on: "a" }], today)).toEqual([]);
  });
  it("names tasks whose state was not read instead of treating them as finished", () => {
    expect(
      unknownTaskIds(
        [T("a")],
        [
          { task_id: "a", depends_on: "zz" },
          { task_id: "yy", depends_on: "a" },
        ],
      ),
    ).toEqual(["zz", "yy"]);
    expect(blockedTasks([T("a")], [{ task_id: "a", depends_on: "zz" }], today)).toEqual([]);
  });
});

import { blockedWorkLines } from "@/lib/security/business-context";
import type { BusinessDomains } from "@/lib/security/business-context";
describe("Growth Officer blocked work", () => {
  const base = {
    tasks: [
      {
        id: "a",
        project_id: null,
        title: "Launch page",
        status: "todo",
        priority: "high",
        due_date: "2026-06-20",
        owner_id: null,
      },
    ],
  };
  it("names the waiting task and the unfinished prerequisite read separately, marked late", () => {
    const d = {
      ...base,
      dependencies: { status: "ok", rows: [{ task_id: "a", depends_on: "p" }], truncated: false },
      prerequisites: [
        {
          id: "p",
          project_id: null,
          title: "Write copy",
          status: "in_progress",
          priority: "medium",
          due_date: "2026-06-01",
          owner_id: null,
        },
      ],
    } as unknown as BusinessDomains;
    const lines = blockedWorkLines(d, new Date("2026-06-10T00:00:00Z"));
    expect(lines[0]).toBe(
      "- [late] “Launch page” (due 2026-06-20) waits on “Write copy” (in_progress, due 2026-06-01)",
    );
  });
  it("says the dependencies could not be read instead of claiming nothing is blocked", () => {
    const lines = blockedWorkLines(
      { ...base, dependencies: { status: "unavailable" } } as unknown as BusinessDomains,
      new Date(),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("waits on");
  });
});

import { diagnoseBlock } from "@/lib/task-blocking";
describe("block diagnosis", () => {
  const D = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    title: id,
    status: "todo",
    due_date: "2026-06-20",
    owner_id: "u",
    campaign_id: null,
    ...over,
  });
  it("names why the prerequisite holds the task up and suggests matching steps", () => {
    const r = diagnoseBlock("a", {
      tasks: [
        D("a", { due_date: "2026-06-25" }),
        D("p", { due_date: "2026-06-01", owner_id: null }),
      ],
      deps: [{ task_id: "a", depends_on: "p" }],
      runState: new Map([["p", "failed"]]),
      today: "2026-06-10",
    })!;
    expect(r.prerequisites[0]?.causes).toEqual(["overdue", "failed", "unassigned"]);
    expect(r.actions).toEqual(["retry_or_replan", "assign_owner", "finish_prerequisite", "replan"]);
  });
  it("lists later tasks that wait in turn and flags the campaign end date", () => {
    const r = diagnoseBlock("a", {
      tasks: [
        D("a", { campaign_id: "c" }),
        D("p", { due_date: "2026-07-05", status: "in_progress" }),
        D("z"),
        D("y", { status: "done" }),
      ],
      deps: [
        { task_id: "a", depends_on: "p" },
        { task_id: "z", depends_on: "a" },
        { task_id: "y", depends_on: "a" },
      ],
      campaignEnd: new Map([["c", "2026-06-30"]]),
      today: "2026-06-10",
    })!;
    expect(r.downstream.map((t) => t.id)).toEqual(["z"]);
    expect(r.campaignAtRisk).toBe(true);
  });
  it("a prerequisite awaiting approval asks for the approval decision", () => {
    const r = diagnoseBlock("a", {
      tasks: [D("a"), D("p", { status: "in_progress" })],
      deps: [{ task_id: "a", depends_on: "p" }],
      runState: new Map([["p", "awaiting_approval"]]),
      today: "2026-06-10",
    })!;
    expect(r.actions[0]).toBe("decide_approval");
  });
  it("no diagnosis when nothing unfinished holds the task up", () => {
    expect(
      diagnoseBlock("a", {
        tasks: [D("a"), D("p", { status: "done" })],
        deps: [{ task_id: "a", depends_on: "p" }],
        today: "2026-06-10",
      }),
    ).toBeNull();
  });
});
