import { describe, expect, it } from "vitest";
import { SPECIALIST_KEYS, TASK_SPECIALISTS, suggestSpecialist, runActions, parseTaskOutput, reviewOutput, readyForBatch, MAX_ATTEMPTS } from "@/lib/task-execution";

describe("AI task execution rules", () => {
  it("offers all fifteen specialists from the directive, each with an accounted request family", () => {
    expect(SPECIALIST_KEYS).toHaveLength(15);
    for (const k of SPECIALIST_KEYS) expect(["research", "strategy", "seo", "content"]).toContain(TASK_SPECIALISTS[k].kind);
  });
  it("suggests a specialist from the task wording in English, Dutch and French", () => {
    expect(suggestSpecialist("Write the landing page copy").specialist).toBe("copywriter");
    expect(suggestSpecialist("Zoekwoorden voor de cateringpagina").specialist).toBe("seo");
    expect(suggestSpecialist("Préparer un salon professionnel").specialist).toBe("event_marketing");
    expect(suggestSpecialist("Something vague").specialist).toBe("growth_strategist");
  });
  it("viewers and external tasks get no run actions", () => {
    expect(runActions({ latest: null, attempts: 0, role: "viewer", taskType: "analysis", taskStatus: "todo", blocked: false })).toEqual([]);
    expect(runActions({ latest: null, attempts: 0, role: "admin", taskType: "external", taskStatus: "todo", blocked: false })).toEqual([]);
  });
  it("a blocked task cannot be run, and a running run cannot be cancelled", () => {
    expect(runActions({ latest: null, attempts: 0, role: "member", taskType: "analysis", taskStatus: "todo", blocked: true })).toEqual([]);
    expect(runActions({ latest: { status: "running" }, attempts: 1, role: "admin", taskType: "analysis", taskStatus: "in_progress", blocked: false })).toEqual([]);
  });
  it("only admins can approve or reject a waiting run; members may cancel it", () => {
    expect(runActions({ latest: { status: "awaiting_approval" }, attempts: 0, role: "member", taskType: "analysis", taskStatus: "in_progress", blocked: false })).toEqual(["cancel"]);
    expect(runActions({ latest: { status: "awaiting_approval" }, attempts: 0, role: "admin", taskType: "analysis", taskStatus: "in_progress", blocked: false })).toEqual(["approve", "reject", "cancel"]);
  });
  it("a queued run (for example after approval) can be started unless the task is blocked", () => {
    expect(runActions({ latest: { status: "queued" }, attempts: 0, role: "member", taskType: "analysis", taskStatus: "in_progress", blocked: false })).toEqual(["start", "pause", "cancel"]);
    expect(runActions({ latest: { status: "queued" }, attempts: 0, role: "member", taskType: "analysis", taskStatus: "in_progress", blocked: true })).toEqual(["pause", "cancel"]);
  });
  it("a failed run can be retried until three attempts; an uncertain run never offers a retry", () => {
    expect(runActions({ latest: { status: "failed" }, attempts: 2, role: "member", taskType: "analysis", taskStatus: "in_progress", blocked: false })).toContain("retry");
    expect(runActions({ latest: { status: "failed" }, attempts: MAX_ATTEMPTS, role: "member", taskType: "analysis", taskStatus: "in_progress", blocked: false })).not.toContain("retry");
    expect(runActions({ latest: { status: "uncertain" }, attempts: 1, role: "admin", taskType: "analysis", taskStatus: "in_progress", blocked: false })).toEqual([]);
  });
  it("parses structured specialist output and flags external actions and evidence gaps for review", () => {
    const o = parseTaskOutput('```json\n{"title":"Offer","summary":"Short.","sections":[{"heading":"Draft","body":"Text"}],"evidence_gaps":["Real lunch prices"],"external_actions":[{"action":"Post on LinkedIn","system":"LinkedIn"}]}\n```');
    expect(o.deliverables).toEqual([]);
    expect(reviewOutput(o)).toEqual({ flags: ["evidence_gaps", "external_actions", "no_deliverables"], next: "approve_external" });
    expect(() => parseTaskOutput('{"title":"x"}')).toThrow();
  });
  it("the bounded batch picks at most three ready tasks by priority then deadline, skipping blocked, active, external and finished work", () => {
    const base = { status: "todo", type: "analysis" as const, blocked: false, active: false, attempts: 0, succeeded: false, due_date: null };
    const picked = readyForBatch([
      { ...base, id: "low", priority: "low" }, { ...base, id: "urgent", priority: "urgent" }, { ...base, id: "high-late", priority: "high", due_date: "2026-12-30" },
      { ...base, id: "high-soon", priority: "high", due_date: "2026-11-25" }, { ...base, id: "blocked", priority: "urgent", blocked: true },
      { ...base, id: "ext", priority: "urgent", type: "external" as never }, { ...base, id: "done", priority: "urgent", succeeded: true },
    ]);
    expect(picked.map((t) => t.id)).toEqual(["urgent", "high-soon", "high-late"]);
  });
});
