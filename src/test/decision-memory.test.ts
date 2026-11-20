import { describe, expect, it } from "vitest";
import { conflictDependents, conflictStatus, detectFactConflicts, proposalsOnConfirmedConflicts, type ConflictEvent } from "@/lib/fact-conflicts";
import { fingerprintOf, isSuppressed, partitionByDecisions, type RecDecision } from "@/lib/recommendation-memory";
import { growthActionsWithHidden, nextGrowthActions, type ActionInput } from "@/lib/bi/growth-actions";
import { fromEvidenceItem } from "@/lib/evidence";

const fact = (id: string, value: string, verified: boolean, created_at = "2026-11-01T10:00:00Z") =>
  ({ id, key: "Price", value, source_type: "user", verified, created_at });
const ev = (kind: ConflictEvent["kind"], created_at: string, kept: string | null = null): ConflictEvent =>
  ({ id: created_at, topic: "price", kind, kept_fact_id: kept, kept_value: kept ? "x" : null, note: "", actor_id: "u", created_at });

describe("conflict status from the decision history", () => {
  const both = detectFactConflicts([fact("a", "€25", true), fact("b", "€29", true)])[0]!;
  const chosen = detectFactConflicts([fact("a", "€25", false), fact("b", "€29", true)])[0]!;
  it("is open without any decision and in review after a review was started", () => {
    expect(conflictStatus(both, []).status).toBe("open");
    expect(conflictStatus(both, [ev("review_started", "2026-11-02T00:00:00Z")]).status).toBe("in_review");
  });
  it("is resolved while the chosen value is the confirmed one", () => {
    expect(conflictStatus(chosen, [ev("resolved", "2026-11-02T00:00:00Z", "b")]).status).toBe("resolved");
  });
  it("is disputed again when another value is confirmed or added after the decision, or after a reopen", () => {
    expect(conflictStatus(both, [ev("resolved", "2026-11-02T00:00:00Z", "b")]).status).toBe("redisputed");
    const later = detectFactConflicts([fact("a", "€25", false), fact("b", "€29", true), fact("c", "€31", false, "2026-11-03T00:00:00Z")])[0]!;
    expect(conflictStatus(later, [ev("resolved", "2026-11-02T00:00:00Z", "b")]).status).toBe("redisputed");
    expect(conflictStatus(chosen, [ev("resolved", "2026-11-02T00:00:00Z", "b"), ev("reopened", "2026-11-04T00:00:00Z")]).status).toBe("redisputed");
  });
  it("keeps every earlier decision, newest first", () => {
    const h = conflictStatus(chosen, [ev("review_started", "2026-11-01T12:00:00Z"), ev("resolved", "2026-11-02T00:00:00Z", "b")]).history;
    expect(h.map((e) => e.kind)).toEqual(["resolved", "review_started"]);
  });
  it("names the proposals that rely on a fact in the conflict, and only those", () => {
    const evidence = [{ id: "e1", source_kind: "business_fact", source_ref: "a" }, { id: "e2", source_kind: "business_fact", source_ref: "zz" }];
    const links = [{ evidence_id: "e1", proposal_id: "p1" }, { evidence_id: "e2", proposal_id: "p2" }];
    const props = [{ id: "p1", title: "Raise price", status: "proposed" }, { id: "p2", title: "Other", status: "proposed" }];
    expect(conflictDependents(both, evidence, links, props).map((p) => p.id)).toEqual(["p1"]);
    expect([...proposalsOnConfirmedConflicts([fact("a", "€25", true), fact("b", "€29", true)], evidence, links)]).toEqual(["p1"]);
    expect([...proposalsOnConfirmedConflicts([fact("a", "€25", false), fact("b", "€29", true)], evidence, links)]).toEqual([]);
  });
});

const now = new Date("2026-11-20T12:00:00Z");
const base = (over: Partial<ActionInput> = {}): ActionInput => ({
  candidates: [],
  proposals: [{ id: "p1", title: "Raise catering price", status: "proposed", category: "opportunity", required_level: "none", measure_after: null, goal_id: null, est_credits: 0 }],
  experiments: [],
  opportunities: [{ id: "o1", title: "Launch loyalty card for regulars", status: "open", impact: 4, feasibility: 4, risk: 1, time_to_value: 3, confidence: "medium" }],
  goalPriority: new Map(), budgetLeft: new Map(), creditBalance: 100, openWork: 0, grantedBudgetLevel: false, now,
  ...over,
});

describe("remembered recommendation decisions", () => {
  const [a] = nextGrowthActions(base(), 8).filter((x) => x.id === "opportunity:o1");
  const fp = fingerprintOf(a!);
  const d = (decision: RecDecision["decision"], until: string | null = null, fingerprint = fp, created_at = "2026-11-19T00:00:00Z"): RecDecision =>
    ({ item_key: "opportunity:o1", decision, until, fingerprint, created_at });
  it("hides a dismissed recommendation until its information changes", () => {
    expect(isSuppressed(d("dismissed"), fp, now)).toBe(true);
    expect(isSuppressed(d("dismissed", null, "v1:other"), fp, now)).toBe(false);
  });
  it("brings a postponed recommendation back after its date", () => {
    expect(isSuppressed(d("postponed", "2026-12-04"), fp, now)).toBe(true);
    expect(isSuppressed(d("postponed", "2026-11-20"), fp, now)).toBe(false);
  });
  it("lets the latest decision count, so restore undoes a dismissal", () => {
    const r = partitionByDecisions([a!], [d("dismissed"), d("restored", null, fp, "2026-11-20T00:00:00Z")], now);
    expect(r.visible).toHaveLength(1);
  });
  it("lists hidden recommendations separately so they can be restored", () => {
    const r = growthActionsWithHidden(base({ decisions: [d("dismissed")] }));
    expect(r.actions.some((x) => x.id === "opportunity:o1")).toBe(false);
    expect(r.hidden.map((h) => h.action.id)).toEqual(["opportunity:o1"]);
  });
});

describe("next best actions are honest about what holds them back", () => {
  it("flags a proposal relying on conflicting confirmed facts and lowers its confidence", () => {
    const [p] = nextGrowthActions(base({ conflictedProposals: new Set(["p1"]) })).filter((x) => x.id === "proposal:p1");
    expect(p?.blockers).toContain("fact_conflict");
    expect(p?.uncertain).toBe(true);
    expect(p?.components.confidence).toBe(1);
  });
  it("flags a proposal whose supporting evidence is outdated", () => {
    const stale = fromEvidenceItem({ evidence_type: "verified_fact", origin: "user", status: "accepted" }, "supports", true)!;
    const [p] = nextGrowthActions(base({ proposalEvidence: new Map([["p1", [stale]]]) })).filter((x) => x.id === "proposal:p1");
    expect(p?.blockers).toContain("stale_evidence");
  });
  it("flags a suggestion that overlaps a running experiment", () => {
    const [o] = nextGrowthActions(base({ experiments: [{ id: "x", title: "Loyalty card for regulars launch", status: "running", started_at: "2026-11-10", duration_days: 30 }] })).filter((x) => x.id === "opportunity:o1");
    expect(o?.blockers).toContain("running_experiment");
  });
  it("says on which factor an action ranks above the next one", () => {
    const list = nextGrowthActions(base());
    expect(list[0]?.ranksAboveBy).toBeDefined();
    expect(list.at(-1)?.ranksAboveBy).toBeUndefined();
  });
});
