import { describe, expect, it } from "vitest";
import { rollUpCosts, type CostInput } from "@/lib/cost-rollup";

const input: CostInput = {
  runs: [
    {
      task_id: "t1",
      status: "succeeded",
      estimated_credits: 8,
      credits_charged: 6,
      specialist_key: "seo",
    },
    {
      task_id: "t1",
      status: "failed",
      estimated_credits: 8,
      credits_charged: 0,
      specialist_key: "seo",
    },
    {
      task_id: "t2",
      status: "succeeded",
      estimated_credits: 8,
      credits_charged: 5,
      specialist_key: "copywriter",
    },
    {
      task_id: "t3",
      status: "queued",
      estimated_credits: 8,
      credits_charged: null,
      specialist_key: "seo",
    },
    {
      task_id: "t4",
      status: "failed",
      estimated_credits: 8,
      credits_charged: 3,
      specialist_key: "crm",
    },
  ],
  tasks: [
    { id: "t1", title: "Keywords", project_id: "p1", campaign_id: "c1" },
    { id: "t2", title: "Copy", project_id: null, campaign_id: "c1" },
    { id: "t3", title: "Audit", project_id: "p2", campaign_id: null },
    { id: "t4", title: "Loose", project_id: null, campaign_id: null },
  ],
  projects: [
    { id: "p1", title: "Site", goal_id: "g1" },
    { id: "p2", title: "Other", goal_id: null },
  ],
  campaigns: [{ id: "c1", title: "Launch", goal_id: "g1", budget_eur: 500 }],
  initiatives: [{ id: "i1", title: "SEO base", project_id: "p1", plan_version_id: "v1" }],
  plans: [{ id: "v1", title: "Plan", version: 2, goal_id: "g1", strategy_id: "s1" }],
  goals: [{ id: "g1", title: "More bookings" }],
  budget: [
    { goal_id: "g1", planned: 300, actual: 120, currency: "EUR" },
    { goal_id: "g1", planned: 100, actual: 0, currency: "USD" },
    { goal_id: null, planned: 50, actual: 50, currency: "EUR" },
  ],
};
const r = rollUpCosts(input);
const node = (lvl: keyof Omit<typeof r, "workspace" | "unlinkedTasks">, id: string) =>
  r[lvl].find((x) => x.id === id);

describe("AI cost roll-up across the growth hierarchy", () => {
  it("workspace: consumed = charged credits, reserved = open runs' estimates, released = unused part of finished-without-success runs", () => {
    expect(r.workspace).toEqual({
      runs: 5,
      consumed: 14,
      reserved: 8,
      released: 13,
      releasedRuns: 2,
    });
  });
  it("a task linked to both a project and a campaign of the same goal counts once for that goal", () => {
    expect(node("goal", "g1")?.credits.consumed).toBe(11); // t1 (6) + t2 (5), not 6 twice
  });
  it("initiative and plan costs follow the initiative's project", () => {
    expect(node("initiative", "i1")?.credits.consumed).toBe(6);
    expect(node("plan", "v1")?.credits).toMatchObject({ consumed: 6, released: 8, runs: 2 });
  });
  it("per specialist and per task", () => {
    expect(node("specialist", "seo")?.credits).toMatchObject({ consumed: 6, reserved: 8, runs: 3 });
    expect(node("task", "t4")?.credits).toMatchObject({ consumed: 3, released: 5 });
    expect(r.unlinkedTasks).toBe(1);
  });
  it("marketing budgets stay per currency and per goal, never mixed with credits or other currencies", () => {
    expect(node("goal", "g1")?.budget).toEqual({
      EUR: { planned: 300, actual: 120 },
      USD: { planned: 100, actual: 0 },
    });
    expect(node("campaign", "c1")?.campaignBudgetEur).toBe(500);
  });
});
