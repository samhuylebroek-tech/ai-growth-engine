import { describe, expect, it } from "vitest";
import { growthJourney, type JourneyInput } from "@/lib/growth-journey";

const empty: JourneyInput = {
  onboarding: { answered: 0, total: 12 },
  understanding: { known: 0, total: 7, unconfirmed: 0, conflicts: 0 },
  conversations: 0,
  opportunities: 0,
  goals: { active: 0, measurable: 0 },
  strategies: 0,
  plans: { approvedWithInitiatives: 0, approved: 0, draft: 0 },
  campaigns: 0,
  budgetLines: 0,
  pendingApprovals: 0,
};
const state = (j: ReturnType<typeof growthJourney>, s: string) =>
  j.items.find((x) => x.step === s)?.state;

describe("first growth journey", () => {
  it("has twelve steps in the agreed order", () => {
    expect(growthJourney(empty, "owner").items.map((x) => x.step)).toEqual([
      "onboarding",
      "review",
      "confirm",
      "situation",
      "ask",
      "opportunity",
      "goal",
      "strategy",
      "initiatives",
      "campaign",
      "resources",
      "next",
    ]);
  });
  it("starts with the questions and keeps later steps waiting until a measurable goal exists", () => {
    const j = growthJourney(empty, "owner");
    expect(j.current).toBe("onboarding");
    expect(state(j, "strategy")).toBe("waiting");
    expect(state(j, "campaign")).toBe("waiting");
  });
  it("a goal without baseline or target needs attention, not done", () => {
    const j = growthJourney(
      {
        ...empty,
        onboarding: { answered: 12, total: 12 },
        understanding: { known: 7, total: 7, unconfirmed: 0, conflicts: 0 },
        conversations: 1,
        goals: { active: 1, measurable: 0 },
      },
      "owner",
    );
    expect(state(j, "goal")).toBe("attention");
    expect(j.current).toBe("goal");
  });
  it("a draft plan waits for approval; pending approvals make resources need attention", () => {
    const j = growthJourney(
      {
        ...empty,
        goals: { active: 1, measurable: 1 },
        strategies: 1,
        plans: { approvedWithInitiatives: 0, approved: 0, draft: 1 },
        pendingApprovals: 2,
      },
      "owner",
    );
    expect(state(j, "initiatives")).toBe("attention");
    expect(state(j, "resources")).toBe("attention");
  });
  it("a failed read is unknown, never done", () => {
    const j = growthJourney({ ...empty, campaigns: "unknown", budgetLines: "unknown" }, "owner");
    expect(state(j, "campaign")).toBe("unknown");
    expect(state(j, "resources")).toBe("unknown");
    expect(j.done).toBe(0);
  });
  it("the optional opportunity step is never the current step", () => {
    const j = growthJourney(
      {
        ...empty,
        onboarding: { answered: 12, total: 12 },
        understanding: { known: 7, total: 7, unconfirmed: 0, conflicts: 0 },
        conversations: 3,
      },
      "owner",
    );
    expect(state(j, "opportunity")).toBe("todo");
    expect(j.current).toBe("goal");
  });
  it("only the roles that may act are offered the action", () => {
    const viewer = growthJourney(empty, "viewer");
    expect(viewer.items.find((x) => x.step === "onboarding")?.canAct).toBe(false);
    expect(viewer.items.find((x) => x.step === "situation")?.canAct).toBe(true);
    const member = growthJourney(empty, "member");
    expect(member.items.find((x) => x.step === "goal")?.canAct).toBe(true);
    expect(member.items.find((x) => x.step === "initiatives")?.canAct).toBe(false);
  });
});

describe("current journey step per role", () => {
  it("skips steps only an editor can take when a member can act on a later one", () => {
    const j = growthJourney(
      {
        ...empty,
        onboarding: { answered: 3, total: 12 },
        understanding: { known: 3, total: 7, unconfirmed: 0, conflicts: 0 },
      },
      "member",
    );
    expect(j.current).toBe("ask");
    expect(j.items.find((x) => x.step === "onboarding")?.state).toBe("attention");
  });
});
