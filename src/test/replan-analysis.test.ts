import { describe, expect, it } from "vitest";
import { analysisStale, parseAnalysis } from "@/lib/replan-analysis";
import { buildReplan, dependents, type ReplanTask } from "@/lib/task-replan";

const ids = new Set(["t2", "t3"]);
const base = { cause: "Supplier prices missing", options: [{ key: "a", assessment: "fine", risk: "low" }], recommended: "a" };

describe("AI re-planning analysis", () => {
  it("keeps only the proposal's own options as a recommendation", () => {
    expect(parseAnalysis(JSON.stringify({ ...base, recommended: "c" }), ["a", "b"], ids).recommended).toBe("none");
    expect(parseAnalysis(JSON.stringify(base), ["a", "b"], ids).recommended).toBe("a");
  });
  it("drops tasks outside the supplied chain and unknown further ideas", () => {
    const a = parseAnalysis(JSON.stringify({ ...base, affected: [{ task_id: "t2", effect: "waits" }, { task_id: "zz", effect: "x" }], extra: [{ kind: "split", suggestion: "do half" }, { kind: "fire_supplier", suggestion: "x" }] }), ["a"], ids);
    expect(a.affected.map((x) => x.task_id)).toEqual(["t2"]);
    expect(a.extra.map((x) => x.kind)).toEqual(["split"]);
  });
  it("refuses an analysis without a cause", () => {
    expect(() => parseAnalysis(JSON.stringify({ ...base, cause: " " }), ["a"], ids)).toThrow();
  });
  it("is out of date once the task changed after it was written", () => {
    expect(analysisStale({ task_updated_at: "2026-11-20T10:00:00Z" }, { updated_at: "2026-11-20T10:00:00Z" })).toBe(false);
    expect(analysisStale({ task_updated_at: "2026-11-20T10:00:00Z" }, { updated_at: "2026-11-20T11:00:00Z" })).toBe(true);
  });
});

describe("one late task in a whole project", () => {
  const t = (id: string, due: string, status = "todo"): ReplanTask => ({ id, title: id, status, priority: "medium", due_date: due, start_date: null, owner_id: "u", campaign_id: null });
  // research → copy → design → launch, plus an unrelated task and a finished one
  const tasks = [t("research", "2026-11-18"), t("copy", "2026-11-22"), t("design", "2026-11-25"), t("launch", "2026-11-28"), t("other", "2026-11-23"), t("done", "2026-11-30", "done")];
  const deps = [{ task: "copy", on: "research" }, { task: "design", on: "copy" }, { task: "launch", on: "design" }, { task: "done", on: "launch" }];
  it("finds every open task down the chain and nothing else", () => {
    expect(dependents("research", deps, tasks)).toEqual(["copy", "design", "launch"]);
  });
  it("moves the chain in order when the late task gets a new deadline", () => {
    const plan = buildReplan(tasks[0]!, { tasks, deps, today: "2026-11-21" })!;
    expect(plan.reasons).toContain("overdue");
    expect(plan.affected).toEqual(["copy", "design", "launch"]);
    const a = plan.options[0]!;
    expect(a.kind).toBe("shift_chain");
    const order = [a.due_date, ...(a.shifts ?? []).map((s) => s.due_date)];
    expect([...order].sort()).toEqual(order);
    expect((a.shifts ?? []).map((s) => s.task_id)).not.toContain("other");
  });
});
