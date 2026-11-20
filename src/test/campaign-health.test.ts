import { describe, expect, it } from "vitest";
import { campaignHealth } from "@/lib/campaign-health";

const today = "2026-11-20";
const c = (over = {}) => ({ status: "active", start_date: "2026-11-01", end_date: "2026-11-30", goal_id: "g", results: "", ...over });
const task = (status: string, due_date: string | null = null) => ({ status, due_date });

describe("campaign health", () => {
  it("is on track when work keeps pace with time and nothing is overdue", () => {
    const h = campaignHealth(c(), [task("done"), task("done"), task("in_progress", "2026-11-25")], today);
    expect(h.state).toBe("on_track");
    expect(h.warnings).toEqual([]);
  });
  it("needs attention without a goal link or without tasks", () => {
    expect(campaignHealth(c({ goal_id: null }), [task("done")], today).warnings).toContain("no_goal");
    expect(campaignHealth(c(), [], today).warnings).toContain("no_tasks");
  });
  it("is at risk when tasks are overdue and time runs ahead of finished work", () => {
    const h = campaignHealth(c(), [task("todo", "2026-11-10"), task("todo"), task("todo"), task("done")], today);
    expect(h.warnings).toEqual(expect.arrayContaining(["overdue_tasks", "behind_schedule"]));
    expect(h.state).toBe("at_risk");
    expect(h.overdue).toBe(1);
  });
  it("flags an active campaign past its end date without recorded results", () => {
    expect(campaignHealth(c({ end_date: "2026-11-15" }), [task("done")], today).warnings).toContain("ended_without_results");
    expect(campaignHealth(c({ end_date: "2026-11-15", results: "212 leads" }), [task("done")], today).warnings).toContain("past_end_open");
  });
  it("a planned campaign whose start date passed needs attention", () => {
    expect(campaignHealth(c({ status: "planned" }), [task("todo")], today).state).toBe("needs_attention");
    expect(campaignHealth(c({ status: "planned", start_date: "2026-12-01", end_date: "2026-12-31" }), [task("todo")], today).state).toBe("planning");
  });
  it("is evaluated only once results are recorded after completion", () => {
    expect(campaignHealth(c({ status: "completed" }), [], today).state).toBe("completed");
    expect(campaignHealth(c({ status: "completed", results: "Sold 40 boxes" }), [], today).state).toBe("evaluated");
  });
  it("ignores cancelled tasks", () => {
    expect(campaignHealth(c(), [task("cancelled", "2026-11-01"), task("done")], today).overdue).toBe(0);
  });
});
