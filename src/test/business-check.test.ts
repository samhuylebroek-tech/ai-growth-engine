import { describe, expect, it } from "vitest";
import { checkDue, compareFindings, findingsFrom, inspectedRecords, stableId } from "@/lib/business-check";
import type { Signal } from "@/lib/signals";
import type { BusinessDomains } from "@/lib/security/business-context";

const sig = (id: string, code: Signal["code"] = "budget_over_cap", vars: Signal["vars"] = {}): Signal => ({
  id, code, kind: "risk", impact: "high", urgency: "high", feasibility: "medium", basis: "budget", to: "/app/goals", vars, score: 1,
});

describe("business check frequency", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  it("is never due when switched off", () => expect(checkDue("off", null, now).due).toBe(false));
  it("is due when no check was recorded yet", () => expect(checkDue("weekly", null, now).due).toBe(true));
  it("is due a day, a week or 30 days after the last check", () => {
    expect(checkDue("daily", "2026-11-19T12:00:00Z", now).due).toBe(true);
    expect(checkDue("daily", "2026-11-19T12:00:01Z", now).due).toBe(false);
    expect(checkDue("weekly", "2026-11-14T12:00:00Z", now).due).toBe(false);
    expect(checkDue("weekly", "2026-11-13T12:00:00Z", now).due).toBe(true);
    expect(checkDue("monthly", "2026-10-21T12:00:00Z", now).due).toBe(true);
  });
});

describe("findings and what changed", () => {
  it("gives signals with free-text ids a short stable id the database accepts", () => {
    const [f] = findingsFrom([sig("budget:cap:Google Ads / Search:EUR")]);
    expect(f!.id).toMatch(/^[a-z_]+:[a-z0-9]+$/);
    expect(f!.id).toBe(findingsFrom([sig("budget:cap:Google Ads / Search:EUR")])[0]!.id);
    expect(stableId("a")).not.toBe(stableId("b"));
  });
  it("clips long text so a finding stays within the stored size", () => {
    const [f] = findingsFrom([sig("x", "goal_stale", { title: "a".repeat(500) })]);
    expect(String(f!.vars["title"]).length).toBe(120);
  });
  it("splits findings into new, still open and resolved", () => {
    const prev = findingsFrom([sig("a"), sig("b")]);
    const next = findingsFrom([sig("b"), sig("c")]);
    const c = compareFindings(next, prev);
    expect([c.added.length, c.open.length, c.resolved.length]).toEqual([1, 1, 1]);
    expect(compareFindings(next, null).added).toHaveLength(2);
  });
});

describe("inspected records", () => {
  it("counts overdue and blocked open tasks and reports unreadable areas as unknown, not zero", () => {
    const d = {
      tasks: [
        { id: "t1", title: "Late", status: "todo", due_date: "2026-11-01" },
        { id: "t2", title: "Waiting", status: "in_progress", due_date: null },
        { id: "t3", title: "Done", status: "done", due_date: "2026-11-01" },
      ],
      // t2 waits on the open t1 (blocked); t1 waits on the finished t3 (not blocked).
      dependencies: { status: "ok", rows: [{ task_id: "t2", depends_on: "t1" }, { task_id: "t1", depends_on: "t3" }], truncated: false },
      revenue: { status: "unavailable" },
      budget: { status: "ok", rows: [{}, {}], truncated: false },
      campaigns: { status: "ok", rows: [], truncated: false },
      content: { status: "ok", rows: [], truncated: false },
      deals: { status: "ok", rows: [{}], truncated: false },
    } as unknown as BusinessDomains;
    const i = inspectedRecords(d, new Date("2026-11-20T00:00:00Z"));
    expect(i.operations).toMatchObject({ initiative_tasks_open: 2, overdue_tasks: 1, blocked_tasks: 1 });
    expect(i.financial).toEqual({ revenue_entries: null, budget_lines: 2 });
    expect(i.customers["retention_metrics"]).toBeNull();
    // Without a dependency read the blocked count is unknown, never zero.
    expect(inspectedRecords({ ...d, dependencies: { status: "unavailable" } } as BusinessDomains).operations["blocked_tasks"]).toBeNull();
  });
});
