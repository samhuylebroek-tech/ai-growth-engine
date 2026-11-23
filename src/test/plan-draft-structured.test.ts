import { describe, expect, it } from "vitest";
import { draftExecutionPlan, planSchema } from "@/lib/execution";

describe("drafting work from a saved recommendation", () => {
  it("uses the title and next steps of a structured analysis, never a raw brace", () => {
    const content = JSON.stringify(
      {
        title: "Business lunch demand",
        summary: "We cannot yet confirm demand. Gather evidence first.",
        next_steps: [
          { title: "Confirm the delivery area", owner: "team" },
          { title: "Interview three offices" },
        ],
      },
      null,
      2,
    );
    const plan = draftExecutionPlan(content);
    expect(plan.title).toBe("Business lunch demand");
    expect(plan.tasks.map((t) => t.title)).toEqual([
      "Confirm the delivery area",
      "Interview three offices",
    ]);
    expect(planSchema.safeParse(plan).success).toBe(true);
  });
  it("takes a strategy's first summary sentence as title and its actions with detail as tasks", () => {
    const content = JSON.stringify({
      summary: "Build a cost-based lunch offer. Then test it with partners.",
      actions: [{ title: "Price the offer", detail: "Use real ingredient costs" }],
    });
    const plan = draftExecutionPlan(content);
    expect(plan.title).toBe("Build a cost-based lunch offer.");
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0]?.description).toBe("Use real ingredient costs");
  });
  it("still drafts plain-text answers from their bullet points", () => {
    const plan = draftExecutionPlan("# Plan\n- Step one\n- Step two");
    expect(plan.title).toBe("Plan");
    expect(plan.tasks.map((t) => t.title)).toEqual(["Step one", "Step two"]);
  });
});
