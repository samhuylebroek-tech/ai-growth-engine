import { describe, expect, it } from "vitest";
import { nextSteps, type NextStepInput } from "@/lib/next-step";
import type { Signal } from "@/lib/signals";

const sig = (id: string, impact: Signal["impact"], urgency: Signal["urgency"], score: number, code: Signal["code"] = "budget_over_cap"): Signal => ({
  id, code, kind: "risk", impact, urgency, feasibility: "medium", basis: "budget", to: "/app/goals", vars: {}, score,
});
const admin: NextStepInput = {
  canEdit: true, canConfirm: true, canDecide: true, canUseAi: true, onboardingDone: true, confirmedFacts: 5, unconfirmedFacts: 0,
  pendingApprovals: 0, highRiskApprovals: 0, overdueTasks: 0, hasActiveGoal: true, signals: [],
};
const viewer: NextStepInput = { ...admin, canEdit: false, canConfirm: false, canDecide: false, canUseAi: false };
const member: NextStepInput = { ...admin, canConfirm: false, canDecide: false };

describe("one clear next step", () => {
  it("sends an editor without a business setup to the setup first", () => {
    expect(nextSteps({ ...admin, onboardingDone: false, confirmedFacts: 0, highRiskApprovals: 2, pendingApprovals: 2 }).primary.code).toBe("setup_business");
  });
  it("never sends a member to the setup only editors can confirm", () => {
    const r = nextSteps({ ...member, onboardingDone: false, confirmedFacts: 0 });
    expect(r.primary.code).toBe("setup_waiting");
    expect([r.primary, ...r.alternatives].some((s) => s.to === "/app/onboarding")).toBe(false);
  });
  it("puts high-risk decisions before warnings and late tasks for an admin", () => {
    const r = nextSteps({ ...admin, highRiskApprovals: 1, pendingApprovals: 1, overdueTasks: 3, signals: [sig("a", "high", "high", 20)] });
    expect(r.primary).toMatchObject({ code: "decide_urgent", to: "/app/approvals", urgent: true, vars: { n: 1 } });
    expect(r.alternatives.map((s) => s.code)).toEqual(["signal", "overdue_tasks"]);
  });
  it("never offers decisions to someone below admin", () => {
    const r = nextSteps({ ...member, highRiskApprovals: 2, pendingApprovals: 5 });
    expect([r.primary, ...r.alternatives].some((s) => s.code === "decide_urgent" || s.code === "decide_approvals")).toBe(false);
  });
  it("tells a member that proposals wait for an administrator, and never a viewer", () => {
    expect(nextSteps({ ...member, pendingApprovals: 3 }).primary).toMatchObject({ code: "awaiting_decision", to: "/app/approvals", vars: { n: 3 }, urgent: false });
    expect(nextSteps({ ...viewer, pendingApprovals: 3 }).primary.code).toBe("read_overview");
    expect(nextSteps({ ...admin, pendingApprovals: 3 }).primary.code).toBe("decide_approvals");
  });
  it("picks the highest-scoring pressing warning, whatever order it arrives in", () => {
    const r = nextSteps({ ...admin, signals: [sig("low", "high", "high", 10), sig("top", "high", "high", 25)] });
    expect(r.primary.signal?.id).toBe("top");
  });
  it("treats an unknown goal as unknown, not as missing", () => {
    expect(nextSteps({ ...admin, hasActiveGoal: null }).primary.code).toBe("ask_officer");
    expect(nextSteps({ ...admin, hasActiveGoal: false }).primary.code).toBe("set_goal");
  });
  it("does not repeat late tasks as a separate warning", () => {
    const r = nextSteps({ ...admin, overdueTasks: 2, signals: [sig("t", "medium", "high", 15, "tasks_overdue")] });
    expect(r.primary.code).toBe("overdue_tasks");
    expect(r.alternatives.some((s) => s.signal?.code === "tasks_overdue")).toBe(false);
  });
  it("gives a viewer only something to read", () => {
    const r = nextSteps({ ...viewer, overdueTasks: 4, hasActiveGoal: false, unconfirmedFacts: 3, signals: [sig("a", "high", "high", 20)] });
    expect(r.primary.code).toBe("read_overview");
    expect(r.alternatives).toEqual([]);
  });
  it("offers at most two alternatives", () => {
    const r = nextSteps({ ...admin, highRiskApprovals: 1, pendingApprovals: 4, overdueTasks: 1, hasActiveGoal: false, unconfirmedFacts: 2, signals: [sig("a", "high", "high", 20)] });
    expect(r.alternatives).toHaveLength(2);
  });
  it("asks an editor to finish the guided questions before setting a goal, with the count", () => {
    const r = nextSteps({ ...admin, hasActiveGoal: false, understanding: { answered: 4, total: 14 } });
    expect(r.primary).toMatchObject({ code: "tell_more", to: "/app/onboarding", vars: { answered: 4, total: 14 } });
    expect(r.alternatives[0]?.code).toBe("set_goal");
  });
  it("never asks members or viewers to answer, and says nothing when progress is unknown or complete", () => {
    const u = { answered: 0, total: 14 };
    expect([nextSteps({ ...member, understanding: u }).primary, ...nextSteps({ ...member, understanding: u }).alternatives].some((s) => s.code === "tell_more")).toBe(false);
    expect(nextSteps({ ...viewer, understanding: u }).primary.code).not.toBe("tell_more");
    expect(nextSteps({ ...admin, understanding: null }).primary.code).not.toBe("tell_more");
    expect(nextSteps({ ...admin, understanding: { answered: 14, total: 14 } }).primary.code).not.toBe("tell_more");
  });
  it("keeps urgent decisions ahead of the guided questions", () => {
    expect(nextSteps({ ...admin, highRiskApprovals: 1, pendingApprovals: 1, understanding: { answered: 0, total: 14 } }).primary.code).toBe("decide_urgent");
  });
});
