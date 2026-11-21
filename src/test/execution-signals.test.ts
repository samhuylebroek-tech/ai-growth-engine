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
  it("warns when recorded campaign spend passes the budget, and not when the spend read was truncated", () => {
    const camp = { id: "c1", title: "Autumn", status: "active", category: "advertising", budget_eur: 500, results: "", start_date: null, end_date: null };
    const spend = [{ campaign_id: "c1", kind: "spend" as const, amount: 520, currency: "EUR", data_class: "manual" as const }];
    const s = detectSignals({ ...base(), campaigns: ok([camp]), campaignSpend: ok(spend) }, NOW).find((x) => x.code === "campaign_budget_over");
    expect(s?.vars).toEqual({ campaign: "Autumn", p: 104 });
    expect(s?.to).toBe("/app/campaigns");
    const near = [{ ...spend[0]!, amount: 410 }];
    expect(codes({ ...base(), campaigns: ok([camp]), campaignSpend: ok(near) })).toContain("campaign_budget_near");
    expect(codes({ ...base(), campaigns: ok([camp]), campaignSpend: { status: "ok", rows: spend, truncated: true } })).not.toContain("campaign_budget_over");
    expect(codes({ ...base(), campaigns: ok([camp]), campaignSpend: ok([{ ...spend[0]!, currency: "USD" }]) })).not.toContain("campaign_budget_over");
    // Simulated spending never produces a real budget signal.
    const simulated = codes({ ...base(), campaigns: ok([camp]), campaignSpend: ok([{ ...spend[0]!, data_class: "simulated" as const }]) });
    expect(simulated).not.toContain("campaign_budget_over");
    expect(simulated).not.toContain("campaign_budget_near");
  });
  it("counts re-planning proposals without a final decision; postponed ones still wait", () => {
    const replans = ok([{ id: "p1", task_id: "t1", created_at: "x" }, { id: "p2", task_id: "t2", created_at: "x" }, { id: "p3", task_id: "t3", created_at: "x" }]);
    const d = { ...base(), replans, replanDecisions: [{ proposal_id: "p1", decision: "approved" }, { proposal_id: "p2", decision: "postponed" }] };
    expect(detectSignals(d, NOW).find((x) => x.code === "replan_pending")?.vars).toEqual({ n: 2 });
  });
  it("also counts overdue tasks outside growth initiatives, each task once", () => {
    const late = { id: "t1", project_id: "p", title: "Price sheet", status: "todo", priority: "high", due_date: "2026-11-18", owner_id: null };
    const loose = { id: "t9", project_id: null, title: "Call supplier", status: "in_progress", priority: "low", due_date: "2026-11-02", owner_id: null };
    const d = { ...base(), tasks: [late], overdueTasks: ok([late, loose]) };
    expect(detectSignals(d, NOW).find((x) => x.code === "tasks_overdue")?.vars["n"]).toBe(2);
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
