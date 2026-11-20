import { describe, expect, it } from "vitest";
import { buildExecutionTiles, type ExecInput } from "@/lib/execution-tiles";

const now = new Date("2026-11-20T10:00:00Z");
const input: ExecInput = {
  now,
  tasks: [
    { id: "a", status: "todo", due_date: null, updated_at: "2026-11-01T00:00:00Z" },
    { id: "b", status: "in_progress", due_date: null, updated_at: "2026-11-01T00:00:00Z" },
    { id: "c", status: "done", due_date: "2026-11-10", updated_at: "2026-11-09T12:00:00Z" },
    { id: "d", status: "done", due_date: "2026-11-10", updated_at: "2026-11-12T12:00:00Z" },
    { id: "e", status: "cancelled", due_date: null, updated_at: "2026-11-01T00:00:00Z" },
  ],
  dependencies: [{ task_id: "a", depends_on: "b" }, { task_id: "b", depends_on: "c" }],
  runs: [
    { task_id: "b", status: "failed", estimated_credits: 8, credits_charged: 2, created_at: "2026-11-18T00:00:00Z" },
    { task_id: "b", status: "running", estimated_credits: 8, credits_charged: null, created_at: "2026-11-19T00:00:00Z" },
    { task_id: "c", status: "succeeded", estimated_credits: 8, credits_charged: 6, created_at: "2026-11-05T00:00:00Z" },
    { task_id: "a", status: "awaiting_approval", estimated_credits: 8, credits_charged: null, created_at: "2026-11-19T00:00:00Z" },
    { task_id: "c", status: "succeeded", estimated_credits: 8, credits_charged: 9, created_at: "2026-10-05T00:00:00Z" },
  ],
  activeInitiatives: 4,
};
const v = (k: string) => buildExecutionTiles(input).find((x) => x.key === k);

describe("Command Center execution tiles", () => {
  it("counts open, completed and blocked tasks; a dependency on a finished task does not block", () => {
    expect(v("openTasks")?.value).toBe(2);
    expect(v("completed")?.value).toBe(2);
    expect(v("blocked")?.value).toBe(1);
  });
  it("uses each task's latest run: a retried task is running, not failed", () => {
    expect(v("running")?.value).toBe(1);
    expect(v("failed")?.value).toBe(0);
    expect(v("approvals")?.value).toBe(1);
  });
  it("completed on time compares the last change with the deadline day", () => {
    expect(v("onTime")).toMatchObject({ value: 1, total: 2 });
  });
  it("credits used count only this month's charged runs; reserved counts open runs' estimates", () => {
    expect(v("creditsUsed")?.value).toBe(8);
    expect(v("creditsReserved")?.value).toBe(16);
  });
  it("omits active initiatives when Growth Plans are not switched on", () => {
    expect(buildExecutionTiles({ ...input, activeInitiatives: null }).some((t) => t.key === "initiatives")).toBe(false);
  });
});
