import { describe, expect, it } from "vitest";
import { detectSignals } from "@/lib/signals";
import type { BusinessDomains } from "@/lib/security/business-context";

const NOW = new Date("2026-11-20T08:00:00Z");
const ok = <T>(rows: T[]) => ({ status: "ok" as const, rows, truncated: false });
const base = (): BusinessDomains => ({
  workspace: { id: "w", name: "Main" }, objectives: null, facts: [], goals: [], recommendations: [], plans: ok([]), initiatives: [], operations: [], projects: [], tasks: [],
  budget: ok([]), deals: ok([]), competitors: ok([]), observations: [], seo: ok([]), content: ok([]), versions: [], decisions: [], campaigns: ok([]), connections: ok([]), metrics: ok([]), measurements: [],
});
const codes = (d: BusinessDomains) => detectSignals(d, NOW).map((s) => s.code);
const run = (task_id: string, status: string) => ({ task_id, status, specialist_key: "seo", credits_charged: null, created_at: "2026-11-19T00:00:00Z" });

describe("execution signals from real records", () => {
  it("flags open plan tasks past their deadline, but not done or cancelled ones", () => {
    const d = { ...base(), tasks: [
      { id: "t1", project_id: "p", title: "Price sheet", status: "todo", priority: "high", due_date: "2026-11-18", owner_id: null },
      { id: "t2", project_id: "p", title: "Done one", status: "done", priority: "high", due_date: "2026-11-01", owner_id: null },
      { id: "t3", project_id: "p", title: "Later", status: "todo", priority: "high", due_date: "2026-12-01", owner_id: null },
    ] };
    const s = detectSignals(d, NOW).find((x) => x.code === "tasks_overdue");
    expect(s?.vars).toEqual({ n: 1, task: "Price sheet" });
    expect(s?.to).toBe("/app/tasks");
  });
  it("flags an initiative whose planned week has passed since plan approval, unless it is completed", () => {
    const plans = ok([{ id: "v1", goal_id: "g", version: 1, title: "P", summary: "", approved_at: "2026-10-01T00:00:00Z" }]);
    const init = (id: string, week: number, status: string) => ({ id, plan_version_id: "v1", title: id, detail: "", channel: "", target_week: week, effort: null, status, project_id: null });
    const d = { ...base(), plans, initiatives: [init("late", 2, "planned"), init("finished", 2, "completed"), init("future", 12, "planned")] };
    const s = detectSignals(d, NOW).filter((x) => x.code === "initiative_behind");
    expect(s.map((x) => x.vars["initiative"])).toEqual(["late"]);
    expect(s[0]?.vars["days"]).toBe(36);
  });
  it("flags tasks that failed with AI twice, runs waiting for approval and uncertain runs", () => {
    const d = { ...base(), taskRuns: ok([run("a", "failed"), run("a", "failed"), run("b", "failed"), run("c", "awaiting_approval"), run("d", "uncertain")]) };
    const s = detectSignals(d, NOW);
    expect(s.find((x) => x.code === "runs_failing")?.vars).toEqual({ n: 1 });
    expect(s.find((x) => x.code === "runs_waiting")?.vars).toEqual({ n: 1 });
    expect(s.find((x) => x.code === "runs_uncertain")?.vars).toEqual({ n: 1 });
  });
  it("raises no execution signals when there is no execution data", () => {
    expect(codes(base()).filter((c) => ["tasks_overdue", "initiative_behind", "runs_failing", "runs_waiting", "runs_uncertain"].includes(c))).toEqual([]);
  });
});
