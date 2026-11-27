import { describe, expect, it } from "vitest";
import {
  campaignPhase,
  completionProblem,
  linkGaps,
  nextSteps,
  transitionAllowed,
  transitionNeedsReason,
  transitionRole,
} from "@/lib/campaign-lifecycle";

describe("campaign lifecycle (mirrors proposal 0083)", () => {
  it("allows only the defined transitions", () => {
    expect(transitionAllowed("draft", "awaiting_approval")).toBe(true);
    expect(transitionAllowed("draft", "active")).toBe(false);
    expect(transitionAllowed("awaiting_approval", "approved")).toBe(true);
    expect(transitionAllowed("completed", "active")).toBe(false);
    expect(transitionAllowed("archived", "draft")).toBe(false);
    expect(transitionAllowed("planned", "active")).toBe(true); // campaigns created before the lifecycle keep working
  });

  it("members propose, submit and stop; editors approve, start, complete and cancel", () => {
    expect(transitionRole("draft", "awaiting_approval")).toBe("member");
    expect(transitionRole("active", "paused")).toBe("member");
    expect(transitionRole("awaiting_approval", "approved")).toBe("editor");
    expect(transitionRole("awaiting_approval", "draft")).toBe("editor");
    expect(transitionRole("active", "completed")).toBe("editor");
    expect(transitionRole("draft", "cancelled")).toBe("editor");
    const member = nextSteps("awaiting_approval", "member");
    expect(member.find((s) => s.to === "approved")?.allowed).toBe(false);
    expect(nextSteps("awaiting_approval", "editor").find((s) => s.to === "approved")?.allowed).toBe(
      true,
    );
    expect(nextSteps("active", "viewer").every((s) => !s.allowed)).toBe(true);
  });

  it("needs a reason to pause, cancel, flag or send back for changes", () => {
    expect(transitionNeedsReason("active", "paused")).toBe(true);
    expect(transitionNeedsReason("draft", "cancelled")).toBe(true);
    expect(transitionNeedsReason("awaiting_approval", "draft")).toBe(true);
    expect(transitionNeedsReason("approved", "active")).toBe(false);
  });

  it("completion needs a result or an explanation, an outcome, and 'achieved' only when the KPI reached the target", () => {
    const c = {
      results: "",
      primary_kpi: "orders",
      kpi_baseline: 100,
      kpi_target: 120,
      kpi_actual: null,
    };
    expect(
      completionProblem(c, { outcome: "achieved", resultsUnavailable: "", kpiActual: "" }),
    ).toBe("result_required");
    expect(
      completionProblem(c, { outcome: "", resultsUnavailable: "Export pending", kpiActual: "" }),
    ).toBe("outcome_required");
    expect(
      completionProblem(c, {
        outcome: "achieved",
        resultsUnavailable: "Export pending",
        kpiActual: "",
      }),
    ).toBe("outcome_unsupported");
    expect(
      completionProblem(c, { outcome: "achieved", resultsUnavailable: "x", kpiActual: "110" }),
    ).toBe("outcome_unsupported");
    expect(
      completionProblem(c, { outcome: "achieved", resultsUnavailable: "x", kpiActual: "125" }),
    ).toBeNull();
    expect(
      completionProblem(c, {
        outcome: "partially_achieved",
        resultsUnavailable: "x",
        kpiActual: "110",
      }),
    ).toBeNull();
    // A falling KPI (e.g. cost per lead 40 → 30) is achieved at or below the target.
    const down = {
      results: "Done",
      primary_kpi: "cpl",
      kpi_baseline: 40,
      kpi_target: 30,
      kpi_actual: 28,
    };
    expect(
      completionProblem(down, { outcome: "achieved", resultsUnavailable: "", kpiActual: "" }),
    ).toBeNull();
    expect(
      completionProblem(
        { ...down, kpi_actual: 33 },
        { outcome: "achieved", resultsUnavailable: "", kpiActual: "" },
      ),
    ).toBe("outcome_unsupported");
  });

  it("reports missing goal, strategy and KPI links without inventing them", () => {
    expect(linkGaps({})).toEqual(["no_goal", "no_strategy", "no_kpi"]);
    expect(linkGaps({ goal_id: "g", strategy_id: "s", primary_kpi: "leads" })).toEqual([
      "no_target",
    ]);
    expect(
      linkGaps({ goal_id: "g", initiative_id: "i", primary_kpi: "leads", kpi_target: 40 }),
    ).toEqual([]);
  });

  it("groups the board in four phases", () => {
    expect(campaignPhase("awaiting_approval")).toBe("preparing");
    expect(campaignPhase("optimizing")).toBe("running");
    expect(campaignPhase("paused")).toBe("paused");
    expect(campaignPhase("cancelled")).toBe("finished");
  });
});

import { campaignHealth } from "@/lib/campaign-health";
describe("campaign progress understands the lifecycle statuses", () => {
  const base = { start_date: "2026-12-01", end_date: "2026-12-31", goal_id: "g", results: "" };
  it("a campaign awaiting approval is in preparation, not running without tasks", () => {
    expect(campaignHealth({ ...base, status: "awaiting_approval" }, [], "2026-11-20").state).toBe(
      "not_started",
    );
  });
  it("a cancelled campaign is finished and not judged as running", () => {
    expect(campaignHealth({ ...base, status: "cancelled" }, [], "2026-11-20").state).toBe(
      "completed",
    );
  });
  it("a campaign that needs attention is judged like a running one", () => {
    expect(
      campaignHealth(
        { ...base, status: "needs_attention", start_date: "2026-11-01" },
        [],
        "2026-11-20",
      ).warnings,
    ).toContain("no_tasks");
  });
});
