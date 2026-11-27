import { describe, expect, it } from "vitest";
import { campaignAssignment, campaignWorkIdentity, campaignWorkStage } from "@/lib/campaign-work";
import {
  executionRole,
  runActions,
  taskOutputMarkdown,
  parseTaskOutput,
  reviewOutput,
} from "@/lib/task-execution";

const output = {
  title: "Draft",
  summary: "Prepared copy",
  sections: [{ heading: "Copy", body: "Concrete draft" }],
  deliverables: ["Landing copy"],
};
describe("campaign work evidence", () => {
  it("editors retain member-level execution access but cannot approve AI runs", () => {
    expect(executionRole("editor")).toBe("member");
    expect(executionRole("viewer")).toBe("viewer");
    expect(executionRole("admin")).toBe("admin");
  });
  it("permits explicit paid rework only for a known finished outcome below the attempt cap", () => {
    const rule = {
      latest: { status: "succeeded" as const },
      attempts: 1,
      role: "admin" as const,
      taskType: "preparation" as const,
      taskStatus: "review",
      blocked: false,
      resultNeedsRework: true,
    };
    expect(runActions(rule)).toContain("retry");
    expect(runActions({ ...rule, attempts: 3 })).not.toContain("retry");
    expect(runActions({ ...rule, latest: { status: "uncertain" } })).not.toContain("retry");
  });
  it("exports the actual delivered material without implying external execution", () => {
    const result = parseTaskOutput(
      JSON.stringify({
        ...output,
        external_actions: [{ action: "Publish draft", system: "LinkedIn" }],
      }),
    );
    expect(taskOutputMarkdown(result)).toContain("Concrete draft");
    expect(taskOutputMarkdown(result)).toContain("not authorized or executed");
  });
  it("does not recommend acceptance of an invalid recorded output", () => {
    expect(reviewOutput({})).toEqual({ flags: ["recovered"], next: "fill_gaps" });
  });
  it("cannot complete a succeeded task before its result is accepted", () => {
    const rule = {
      latest: { status: "succeeded" as const },
      attempts: 1,
      role: "admin" as const,
      taskType: "preparation" as const,
      taskStatus: "review",
      blocked: false,
    };
    expect(runActions(rule)).not.toContain("accept");
    expect(runActions({ ...rule, resultAccepted: true })).toContain("accept");
  });
  it("recognizes recovered structured delivery only after validating it", () => {
    expect(
      campaignWorkStage(
        undefined,
        { status: "succeeded", output: { recovered: true, markdown: JSON.stringify(output) } },
        { decision: "accepted" },
      ),
    ).toBe("reviewed");
    expect(
      campaignWorkStage(
        undefined,
        { status: "succeeded", output: { markdown: "unusable" } },
        { decision: "accepted" },
      ),
    ).toBe("result_missing");
  });
  it("created and assigned tasks are never classified as executed", () => {
    expect(campaignWorkStage(undefined, undefined, undefined)).toBe("created");
    expect(campaignWorkStage({ specialist_key: "content" }, undefined, undefined)).toBe("assigned");
  });
  it("successful execution without a concrete deliverable is not reviewed", () => {
    expect(
      campaignWorkStage(undefined, { status: "succeeded", output: {} }, { decision: "accepted" }),
    ).toBe("result_missing");
  });
  it("a concrete result still requires a human decision", () => {
    expect(campaignWorkStage(undefined, { status: "succeeded", output }, undefined)).toBe(
      "executed",
    );
    expect(
      campaignWorkStage(undefined, { status: "succeeded", output }, { decision: "accepted" }),
    ).toBe("reviewed");
  });
  it("corrections and rework do not approve an unchanged deliverable", () => {
    expect(
      campaignWorkStage(
        undefined,
        { status: "succeeded", output },
        { decision: "accepted_with_corrections" },
      ),
    ).toBe("corrections");
    expect(
      campaignWorkStage(undefined, { status: "succeeded", output }, { decision: "needs_rework" }),
    ).toBe("rework");
  });
  it("an uncertain outcome stays uncertain even with a supplied acceptance", () => {
    expect(
      campaignWorkStage(undefined, { status: "uncertain", output }, { decision: "accepted" }),
    ).toBe("uncertain");
  });
  it("prepares internal specialist work requiring separate run approval", () => {
    expect(campaignAssignment("Write landing page copy")).toEqual({
      specialist: "copywriter",
      type: "preparation",
      requiresApproval: true,
    });
    expect(campaignAssignment("Publish LinkedIn post").type).toBe("preparation");
  });
  it("concurrent repeats use the same task primary keys; edits have different identities", async () => {
    const first = await campaignWorkIdentity("note", "approved text", ["Copy", "SEO"]);
    const repeat = await campaignWorkIdentity("note", "approved text", ["Copy", "SEO"]);
    const edited = await campaignWorkIdentity("note", "changed text", ["Copy", "SEO"]);
    expect(repeat).toEqual(first);
    expect(new Set(first.ids).size).toBe(2);
    expect(edited.ids[0]).not.toBe(first.ids[0]);
    expect(edited.label).not.toBe(first.label);
  });
});
