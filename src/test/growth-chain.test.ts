import { describe, expect, it } from "vitest";
import { buildGrowthChain, duplicateTitles, type ChainInput } from "@/lib/growth-chain";

const empty: ChainInput = {
  opportunity: null,
  strategies: 0,
  plans: [],
  initiatives: [],
  work: [],
  tasks: [],
  results: { withActual: 0, total: 0 },
};
const state = (c: ReturnType<typeof buildGrowthChain>, s: string) =>
  c.steps.find((x) => x.stage === s)?.state;

describe("growth chain for one goal", () => {
  it("a goal set directly has no opportunity and its next step is a strategy", () => {
    const c = buildGrowthChain(empty);
    expect(state(c, "opportunity")).toBe("missing");
    expect(c.next).toBe("strategy");
  });
  it("a draft plan waits for approval and initiatives count only once a plan is approved", () => {
    const c = buildGrowthChain({
      ...empty,
      strategies: 1,
      plans: [{ version: 1, status: "draft" }],
      initiatives: [{ status: "planned", project_id: null }],
    });
    expect(state(c, "plan")).toBe("waiting");
    expect(state(c, "initiatives")).toBe("missing");
    expect(c.next).toBe("plan");
  });
  it("tracks initiatives and tasks done out of total, ignoring cancelled ones", () => {
    const c = buildGrowthChain({
      ...empty,
      opportunity: { title: "Weekend workshops", status: "converted" },
      strategies: 2,
      plans: [
        { version: 2, status: "approved" },
        { version: 1, status: "superseded" },
      ],
      initiatives: [
        { status: "completed", project_id: "p" },
        { status: "in_progress", project_id: null },
        { status: "cancelled", project_id: null },
      ],
      work: [{ kind: "projects", title: "Workshops", status: "active" }],
      tasks: [{ status: "done" }, { status: "todo" }, { status: "cancelled" }],
      results: { withActual: 1, total: 2 },
    });
    expect(c.steps.find((s) => s.stage === "initiatives")).toMatchObject({
      state: "in_progress",
      count: 1,
      total: 2,
    });
    expect(c.steps.find((s) => s.stage === "tasks")).toMatchObject({
      state: "in_progress",
      count: 1,
      total: 2,
    });
    expect(c.steps.find((s) => s.stage === "plan")?.label).toBe("V2");
    expect(c.next).toBeNull();
  });
  it("marks stages whose data is not switched on as off rather than missing", () => {
    const c = buildGrowthChain({ ...empty, opportunity: "off", plans: "off", results: "off" });
    expect([state(c, "opportunity"), state(c, "plan"), state(c, "results")]).toEqual([
      "off",
      "off",
      "off",
    ]);
  });
  it("flags linked campaigns or projects that repeat the same title, ignoring case, accents and archived ones", () => {
    expect(
      duplicateTitles([
        { title: "Spring Café promo", status: "active" },
        { title: "spring cafe promo!", status: "planned" },
        { title: "Other", status: "active" },
        { title: "Other", status: "archived" },
      ]),
    ).toEqual(["Spring Café promo"]);
  });
});
