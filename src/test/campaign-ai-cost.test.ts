import { describe, expect, it } from "vitest";
import { campaignAiEconomics } from "@/lib/campaign-ai-cost";

const tasks = [
  { id: "t1", campaign_id: "C", agent_key: "seo", status: "done" },
  { id: "t2", campaign_id: "C", agent_key: "content", status: "todo" },
  { id: "t3", campaign_id: "C", agent_key: null, status: "todo" },
  { id: "t9", campaign_id: "OTHER", agent_key: "seo", status: "todo" },
];
const run = (id: string, task_id: string, specialist_key: string, status: string, credits_charged: number | null, estimated_credits = 5) => ({ id, task_id, specialist_key, status, credits_charged, estimated_credits, created_at: `2026-11-2${id.length}T10:00:00Z` });
const runs = [run("r1", "t1", "seo", "succeeded", 6), run("r2", "t2", "content", "uncertain", null), run("r3", "t2", "content", "queued", null, 4), run("r9", "t9", "seo", "succeeded", 50)];
const reviews = [{ task_run_id: "r1", reviewer_specialist: "business_analyst", credits: 3, score: 80 }, { task_run_id: "r9", reviewer_specialist: "x", credits: 9, score: 10 }];

describe("campaign AI economics", () => {
  const e = campaignAiEconomics("C", tasks, runs, reviews);
  it("counts only this campaign's runs and reviews, from recorded charges", () => {
    expect(e).toMatchObject({ tasks: 3, runs: 3, chargedCredits: 6, reviewCredits: 3, totalCredits: 9 });
  });
  it("keeps uncertain outcomes and not-yet-charged runs apart instead of guessing", () => {
    expect(e.uncertainRuns).toBe(1);
    expect(e).toMatchObject({ pendingRuns: 1, pendingEstimate: 4 });
  });
  it("derives the specialist team from assigned tasks, runs and reviews", () => {
    const seo = e.team.find((s) => s.specialist === "seo");
    expect(seo).toMatchObject({ tasks: 1, doneTasks: 1, runs: 1, credits: 6, reviewsReceived: 1, avgReviewScore: 80 });
    expect(e.team.find((s) => s.specialist === "business_analyst")?.reviewCredits).toBe(3);
    expect(e.team.find((s) => s.specialist === "content")).toMatchObject({ openTasks: 1, runs: 2, credits: 0 });
    expect(e.unassignedOpenTasks).toBe(1);
  });
  it("reports an incomplete read instead of a smaller total", () => {
    expect(campaignAiEconomics("C", tasks, runs, reviews, false).complete).toBe(false);
  });
});
