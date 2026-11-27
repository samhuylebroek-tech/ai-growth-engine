import { describe, expect, it } from "vitest";
import {
  approvalGates,
  evidenceQuality,
  experimentQuality,
  fromClassified,
  fromEvidenceItem,
  independentCount,
  proposalStage,
  type NormalEvidence,
} from "@/lib/evidence";

const ev = (type: NormalEvidence["type"], o: Partial<NormalEvidence> = {}): NormalEvidence => ({
  type,
  independent: true,
  accepted: true,
  role: "supports",
  ...o,
});
const link = (type: string | null, o: Record<string, string> = {}) =>
  ({
    type,
    origin: "user",
    status: "accepted",
    role: "supports",
    source_ref: "ref",
    ...o,
  }) as never;

describe("evidence quality labels", () => {
  it("is strong with a verified fact plus another measurement", () => {
    expect(evidenceQuality([ev("verified_fact"), ev("measured_observation")]).level).toBe("strong");
  });
  it("two measurements without a verified fact are only some evidence", () => {
    expect(evidenceQuality([ev("measured_observation"), ev("measured_observation")]).level).toBe(
      "some",
    );
  });
  it("estimates alone are limited evidence", () => {
    expect(evidenceQuality([ev("estimate")]).level).toBe("limited");
  });
  it("AI statements alone are a hypothesis, whatever they claim", () => {
    const r = evidenceQuality([fromClassified("fact", "ai"), fromClassified("estimate", "ai")]);
    expect(r.level).toBe("hypothesis");
    expect(r.reasons).toContain("ai_only");
  });
  it("an AI 'fact' is downgraded to an unverified assumption", () => {
    expect(fromClassified("verified", "ai")).toMatchObject({
      type: "assumption",
      independent: false,
      downgradedFrom: "verified_fact",
    });
  });
  it("a rule's recorded observation stands as accepted evidence", () => {
    expect(fromClassified("recorded", "rule")).toMatchObject({
      type: "measured_observation",
      independent: true,
      accepted: true,
    });
  });
  it("nothing is information missing", () => {
    expect(evidenceQuality([]).level).toBe("missing");
    expect(evidenceQuality([ev("missing_information")]).level).toBe("missing");
  });
  it("unaccepted facts do not count yet", () => {
    expect(evidenceQuality([ev("verified_fact", { accepted: false })]).level).toBe("hypothesis");
  });
  it("accepted contradicting evidence lowers the label one step", () => {
    expect(
      evidenceQuality([
        ev("verified_fact"),
        ev("measured_observation"),
        ev("measured_observation", { role: "contradicts" }),
      ]).level,
    ).toBe("some");
  });
  it("a named gap caps strong at some", () => {
    expect(
      evidenceQuality([ev("verified_fact"), ev("measured_observation"), ev("missing_information")])
        .level,
    ).toBe("some");
  });
  it("rejected and superseded items are ignored", () => {
    expect(
      fromEvidenceItem({ evidence_type: "verified_fact", origin: "user", status: "rejected" }),
    ).toBeNull();
    expect(
      fromEvidenceItem({ evidence_type: "verified_fact", origin: "user", status: "reevaluated" }),
    ).toBeNull();
  });
  it("only completed controlled experiments are strong", () => {
    expect(experimentQuality("completed", "controlled")).toBe("strong");
    expect(experimentQuality("completed", "correlational")).toBe("limited");
    expect(experimentQuality("running", "controlled")).toBe("hypothesis");
  });
});

describe("improvement proposal gates", () => {
  const base = { status: "proposed", reviewed: true, gapReason: "", linked: [] as never[] };
  it("an observation can never become work", () => {
    expect(approvalGates({ ...base, level: "observation" })).toEqual(["observation_never_work"]);
  });
  it("a formal proposal needs independent evidence or a stated gap", () => {
    expect(approvalGates({ ...base, level: "formal" })).toEqual(["needs_independent_evidence"]);
    expect(approvalGates({ ...base, level: "formal", gapReason: "No tracking yet" })).toEqual([]);
  });
  it("AI evidence does not satisfy a formal proposal", () => {
    expect(
      approvalGates({ ...base, level: "formal", linked: [link("estimate", { origin: "ai" })] }),
    ).toEqual(["needs_independent_evidence"]);
  });
  it("an unsourced estimate is not independent; a sourced one is", () => {
    expect(independentCount([link("estimate", { source_ref: "" })]).independent).toBe(0);
    expect(independentCount([link("estimate")]).independent).toBe(1);
  });
  it("an execution proposal needs a record-backed fact or measurement", () => {
    expect(approvalGates({ ...base, level: "execution", linked: [link("estimate")] })).toEqual([
      "needs_record_evidence",
    ]);
    expect(
      approvalGates({ ...base, level: "execution", linked: [link("measured_observation")] }),
    ).toEqual([]);
  });
  it("review is required and undecided evidence is flagged", () => {
    expect(
      approvalGates({
        ...base,
        level: "formal",
        reviewed: false,
        linked: [link("verified_fact", { status: "classified" })],
      }),
    ).toEqual(["unreviewed_evidence", "needs_independent_evidence", "needs_review"]);
  });
  it("stages follow the shared lifecycle", () => {
    expect(proposalStage(null)).toBe("analyzed");
    expect(proposalStage({ status: "proposed" })).toBe("proposed");
    expect(proposalStage({ status: "proposed", reviewed_at: "2026-11-20" })).toBe("reviewed");
    expect(proposalStage({ status: "withdrawn" })).toBe("rejected");
    expect(proposalStage({ status: "converted" })).toBe("converted");
  });
});
