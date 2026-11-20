import { describe, expect, it } from "vitest";
import { bottlenecks, nextBestActions, possibleDuplicates, type OrchInput, type OrchTask } from "@/lib/orchestration";
import { gateCode, taskScore, windowOpen } from "@/lib/scheduler";

const T = (id: string, extra: Partial<OrchTask> = {}): OrchTask => ({ id, title: id, status: "todo", priority: "medium", due_date: null, project_id: null, campaign_id: null, ...extra });
const base = (tasks: OrchTask[], extra: Partial<OrchInput> = {}): OrchInput => ({
  today: "2026-11-20", tasks, dependencies: [], profiles: new Map(), latestRun: new Map(), goalOfProject: new Map(), goalOfCampaign: new Map(), goals: new Map(), initiativeProjects: new Set(), ...extra,
});

describe("scheduler score (same weights as the database)", () => {
  it("adds priority, deadline, goal importance and plan link, and subtracts past failures", () => {
    expect(taskScore({ priority: "urgent", due_date: "2026-11-18", goalPriority: "primary", inInitiative: true, failedRuns: 0 }, "2026-11-20")).toBe(40 + 25 + 15 + 10);
    expect(taskScore({ priority: "low", due_date: "2026-11-25", goalPriority: "secondary", inInitiative: false, failedRuns: 2 }, "2026-11-20")).toBe(10 + 15 + 8 - 10);
    expect(taskScore({ priority: "high", due_date: "2026-12-30", goalPriority: null, inInitiative: false, failedRuns: 0 }, "2026-11-20")).toBe(30);
  });
  it("execution window: same-day and overnight windows", () => {
    expect(windowOpen(9, 17, 9)).toBe(true); expect(windowOpen(9, 17, 17)).toBe(false);
    expect(windowOpen(22, 6, 23)).toBe(true); expect(windowOpen(22, 6, 12)).toBe(false); expect(windowOpen(null, null, 3)).toBe(true);
  });
  it("reads the database refusal code and ignores unknown details", () => {
    expect(gateCode({ details: "gate:daily_cap" })).toBe("daily_cap");
    expect(gateCode({ details: "gate:drop_tables" })).toBeNull();
    expect(gateCode({ message: "boom" })).toBeNull();
  });
});

describe("Growth Officer next best actions", () => {
  it("puts decisions first (uncertain, approval, review), then unblocking, then the highest-value ready work", () => {
    const tasks = [T("ready", { priority: "urgent" }), T("blocked", { priority: "urgent" }), T("blocker"), T("approve"), T("unsure"), T("unassigned", { priority: "high" })];
    const i = base(tasks, {
      dependencies: [{ task_id: "blocked", depends_on: "blocker" }],
      profiles: new Map(["ready", "blocked", "blocker", "approve", "unsure"].map((k) => [k, { task_type: "analysis" }])),
      latestRun: new Map([["approve", { status: "awaiting_approval", failed: 0 }], ["unsure", { status: "uncertain", failed: 0 }]]),
    });
    const a = nextBestActions(i, 10);
    expect(a.map((x) => `${x.kind}:${x.task.id}`)).toEqual(["resolve:unsure", "approve:approve", "unblock:blocked", "run:ready", "run:blocker", "assign:unassigned"]);
    expect(a.find((x) => x.task.id === "blocked")?.blocker?.id).toBe("blocker");
    expect(a.find((x) => x.task.id === "blocker")?.why).toContain("blocks_others");
  });
  it("explains goal and plan links, and never proposes external or already-running work", () => {
    const tasks = [T("g", { project_id: "p1", due_date: "2026-11-19" }), T("ext"), T("busy")];
    const i = base(tasks, {
      profiles: new Map([["g", { task_type: "analysis" }], ["ext", { task_type: "external" }], ["busy", { task_type: "analysis" }]]),
      latestRun: new Map([["busy", { status: "running", failed: 0 }]]),
      goalOfProject: new Map([["p1", "goal1"]]), goals: new Map([["goal1", { priority: "primary", status: "active" }]]), initiativeProjects: new Set(["p1"]),
    });
    const a = nextBestActions(i);
    expect(a.map((x) => x.task.id)).toEqual(["g"]);
    expect(a[0]?.why).toEqual(["overdue", "primary_goal", "plan"]);
  });
});

describe("duplicates and bottlenecks", () => {
  it("flags open tasks with nearly the same title, across accents and stop words", () => {
    const d = possibleDuplicates([T("1", { title: "Schrijf de LinkedIn-post over catering" }), T("2", { title: "LinkedIn post over catering schrijven" }), T("3", { title: "Kostprijsblad bouwen" }), T("4", { title: "Schrijf LinkedIn post catering", status: "done" })]);
    expect(d.map((p) => [p.a.id, p.b.id])).toEqual([["1", "2"]]);
  });
  it("a task holding up two open tasks is a bottleneck; finished dependents do not count", () => {
    const tasks = [T("root"), T("a"), T("b"), T("c", { status: "done" })];
    const deps = [{ task_id: "a", depends_on: "root" }, { task_id: "b", depends_on: "root" }, { task_id: "c", depends_on: "a" }];
    expect(bottlenecks(tasks, deps)).toEqual([{ task: tasks[0], blocks: 2 }]);
  });
});
