import { describe, expect, it } from "vitest";
import { buildReplan, dependents, replanReasons, replanStatus, shiftsFor, type ReplanTask } from "@/lib/task-replan";
import type { TaskReplanDecisionRow } from "@/lib/pending-schema";

const T = (id: string, p: Partial<ReplanTask> = {}): ReplanTask => ({ id, title: id, status: "todo", priority: "medium", due_date: null, start_date: null, owner_id: "u", campaign_id: null, ...p });
const today = "2026-11-20";

describe("task re-planning", () => {
  it("finds every task down the dependency chain, once, even with a cycle", () => {
    const tasks = [T("a"), T("b"), T("c"), T("d", { status: "done" })];
    const deps = [{ task: "b", on: "a" }, { task: "c", on: "b" }, { task: "a", on: "c" }, { task: "d", on: "a" }];
    expect(dependents("a", deps, tasks)).toEqual(["b", "c"]);
  });

  it("an overdue task gets a new deadline after today and its dependent keeps its gap", () => {
    const tasks = [T("a", { due_date: "2026-11-15", start_date: "2026-11-11" }), T("b", { due_date: "2026-11-17" })];
    const plan = buildReplan(tasks[0]!, { tasks, deps: [{ task: "b", on: "a" }], today })!;
    expect(plan.reasons).toEqual(["overdue"]);
    expect(plan.options[0]).toMatchObject({ key: "a", kind: "shift_chain", due_date: "2026-11-24" });
    expect(plan.options[0]!.shifts).toEqual([{ task_id: "b", due_date: "2026-11-26" }]);
    expect(plan.affected).toEqual(["b"]);
  });

  it("does not move a dependent that is already late enough", () => {
    const tasks = [T("a", { due_date: "2026-11-15" }), T("b", { due_date: "2026-12-30" })];
    expect(shiftsFor("a", "2026-11-23", { tasks, deps: [{ task: "b", on: "a" }], today })).toEqual([]);
  });

  it("a blocked task is planned after the task it waits on", () => {
    const tasks = [T("a", { due_date: "2026-11-21" }), T("p", { due_date: "2026-11-28" })];
    const plan = buildReplan(tasks[0]!, { tasks, deps: [{ task: "a", on: "p" }], today })!;
    expect(plan.reasons).toEqual(["blocked", "dependency_late"]);
    expect(plan.options[0]!.due_date).toBe("2026-11-29");
  });

  it("flags a failed AI run, a missing owner and a campaign end that would be exceeded as high risk", () => {
    const tasks = [T("a", { due_date: "2026-11-18", owner_id: null, campaign_id: "c" })];
    const plan = buildReplan(tasks[0]!, { tasks, deps: [], today, runState: new Map([["a", "failed"]]), campaignEnd: new Map([["c", "2026-11-21"]]) })!;
    expect(plan.reasons).toEqual(["overdue", "failed", "no_owner"]);
    expect(plan.campaignEndExceeded).toBe(true);
    expect(plan.risk).toBe("high");
  });

  it("offers a priority raise and a later, lower-priority option; urgent tasks get no raise", () => {
    const tasks = [T("a", { due_date: "2026-11-01" }), T("u", { due_date: "2026-11-01", priority: "urgent" })];
    const plan = buildReplan(tasks[0]!, { tasks, deps: [], today })!;
    expect(plan.options.map((o) => [o.key, o.kind, o.priority ?? null])).toEqual([["a", "new_deadline", null], ["b", "raise_priority", "high"], ["c", "lower_priority", "low"]]);
    expect(plan.options[2]!.due_date).toBe("2026-11-30");
    const urgent = buildReplan(tasks[1]!, { tasks, deps: [], today })!;
    expect(urgent.options.map((o) => o.kind)).toEqual(["new_deadline", "lower_priority"]);
    expect(urgent.options.map((o) => o.key)).toEqual(["a", "b"]);
  });

  it("closed or on-track tasks need no re-planning", () => {
    expect(buildReplan(T("a", { due_date: "2026-11-01", status: "done" }), { tasks: [], deps: [], today })).toBeNull();
    expect(replanReasons(T("a", { due_date: "2026-12-01" }), { tasks: [], deps: [], today })).toEqual([]);
  });

  it("status is derived from insert-only decisions: postponed until a final decision", () => {
    const d = (decision: TaskReplanDecisionRow["decision"], at: string) => ({ proposal_id: "p", decision, created_at: at }) as TaskReplanDecisionRow;
    expect(replanStatus({ id: "p" }, [])).toBe("pending");
    expect(replanStatus({ id: "p" }, [d("postponed", "1")])).toBe("postponed");
    expect(replanStatus({ id: "p" }, [d("postponed", "1"), d("approved", "2")])).toBe("approved");
  });
});
