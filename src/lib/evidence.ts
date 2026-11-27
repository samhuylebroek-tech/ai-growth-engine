// Evidence governance (proposal 0073). Pure: one vocabulary for every kind of evidence in the product, an
// understandable quality label instead of a confidence percentage, the approval gates of improvement proposals
// (mirroring the SQL so the screen can say what is missing) and the standard recommendation stages.
// The database is the authority: it checks sources, assigns reliability and refuses approvals; this module explains.

export const EVIDENCE_TYPES = [
  "verified_fact",
  "measured_observation",
  "estimate",
  "assumption",
  "hypothesis",
  "missing_information",
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];
export type EvidenceStatus =
  | "discovered"
  | "classified"
  | "reviewed"
  | "accepted"
  | "rejected"
  | "used_in_decision"
  | "reevaluated";
export type EvidenceOrigin = "user" | "rule" | "ai";
export type SourceKind =
  | "business_fact"
  | "measurement"
  | "revenue_event"
  | "crm_deal"
  | "experiment"
  | "seo_audit"
  | "competitor_observation"
  | "budget_line"
  | "document"
  | "user_statement"
  | "website"
  | "ai_analysis"
  | "other";
/** Source kinds that point at a record of the business; verified facts / measurements require one. */
export const RECORD_SOURCES: readonly SourceKind[] = [
  "business_fact",
  "measurement",
  "revenue_event",
  "crm_deal",
  "experiment",
  "seo_audit",
  "competitor_observation",
  "budget_line",
];
export const FACT_SOURCES: readonly SourceKind[] = [
  "business_fact",
  "measurement",
  "revenue_event",
  "competitor_observation",
];

/** The common shape every evidence representation is normalized into. */
export type NormalEvidence = {
  type: EvidenceType;
  /** Counts as independent support: not AI-originated and not a restatement by the recommender itself. */
  independent: boolean;
  /** Reviewed and accepted (or a deterministic read of a record, which needs no review). */
  accepted: boolean;
  role: "supports" | "contradicts";
  /** Set when an AI claimed something stronger than it can establish (e.g. "fact"); shown as unverified. */
  downgradedFrom?: EvidenceType;
  /** Expired, source deleted or no longer confirmed: counts at most as an estimate until refreshed. */
  stale?: boolean;
};

export type Quality = "strong" | "some" | "limited" | "hypothesis" | "missing";
export const QUALITY_ORDER: readonly Quality[] = [
  "strong",
  "some",
  "limited",
  "hypothesis",
  "missing",
];
export type QualityReason =
  | "facts"
  | "measurements"
  | "estimates_only"
  | "assumptions_only"
  | "ai_only"
  | "unreviewed"
  | "contradicted"
  | "gaps"
  | "stale"
  | "none";
export type QualityResult = {
  level: Quality;
  reasons: QualityReason[];
  counts: {
    facts: number;
    measurements: number;
    estimates: number;
    assumptions: number;
    gaps: number;
  };
};

const down = (q: Quality): Quality => QUALITY_ORDER[Math.min(QUALITY_ORDER.indexOf(q) + 1, 3)]!;

/**
 * Strong: at least two accepted independent facts/measurements, one of them a verified fact, nothing contradicting and
 * no open gap. Some: at least one accepted independent fact or measurement. Limited: only independent estimates.
 * Hypothesis only: only assumptions, hypotheses or AI statements. Information missing: nothing, or only gaps.
 * Accepted contradicting evidence lowers the label one step; a named information gap caps it at "some".
 */
export function evidenceQuality(items: readonly NormalEvidence[]): QualityResult {
  const sup = items.filter((e) => e.role === "supports");
  const usable = sup.filter((e) => e.independent && e.accepted);
  const hard = (e: NormalEvidence) =>
    e.type === "verified_fact" || e.type === "measured_observation";
  const stale = usable.filter((e) => e.stale && hard(e)).length;
  const facts = usable.filter((e) => e.type === "verified_fact" && !e.stale).length;
  const measurements = usable.filter((e) => e.type === "measured_observation" && !e.stale).length;
  const estimates = usable.filter((e) => e.type === "estimate").length + stale;
  const assumptions = sup.filter((e) => e.type === "assumption" || e.type === "hypothesis").length;
  const gaps = items.filter((e) => e.type === "missing_information").length;
  const contradicted = items.some(
    (e) => e.role === "contradicts" && e.accepted && e.type !== "missing_information",
  );
  const unreviewed = sup.some(
    (e) => e.independent && !e.accepted && e.type !== "missing_information",
  );
  const aiOnly = sup.length > 0 && sup.every((e) => !e.independent);
  const reasons: QualityReason[] = [];
  let level: Quality;
  if (facts + measurements >= 2 && facts >= 1) level = "strong";
  else if (facts + measurements >= 1) level = "some";
  else if (estimates >= 1) level = "limited";
  else if (sup.some((e) => e.type !== "missing_information")) level = "hypothesis";
  else level = "missing";
  if (facts) reasons.push("facts");
  if (measurements) reasons.push("measurements");
  if (level === "limited") reasons.push("estimates_only");
  if (level === "hypothesis") reasons.push(aiOnly ? "ai_only" : "assumptions_only");
  if (unreviewed) reasons.push("unreviewed");
  if (contradicted) {
    reasons.push("contradicted");
    if (level !== "missing" && level !== "hypothesis") level = down(level);
  }
  if (gaps) {
    reasons.push("gaps");
    if (level === "strong") level = "some";
  }
  if (stale) reasons.push("stale");
  if (!items.length) reasons.push("none");
  return { level, reasons, counts: { facts, measurements, estimates, assumptions, gaps } };
}

// ---- normalizers for the existing evidence vocabularies -------------------------------------------------------

/** A stored evidence item (evidence_items) as linked to a proposal. */
export function fromEvidenceItem(
  e: { evidence_type: EvidenceType | null; origin: EvidenceOrigin; status: EvidenceStatus },
  role: "supports" | "contradicts" = "supports",
  stale = false,
): NormalEvidence | null {
  if (!e.evidence_type || e.status === "reevaluated" || e.status === "rejected") return null;
  return {
    type: e.evidence_type,
    independent: e.origin !== "ai",
    accepted: e.status === "accepted" || e.status === "used_in_decision",
    role,
    ...(stale ? { stale: true } : {}),
  };
}

/**
 * Evidence written by the AI into opportunities (fact / estimate / hypothesis) or organization opportunities
 * (verified / recorded / estimate / assumption / missing). Deterministic rules read records, so their classes
 * stand; anything the AI calls a fact is an unverified claim until a person links the record behind it.
 */
export function fromClassified(cls: string, origin: "ai" | "rule" | "user"): NormalEvidence {
  const map: Record<string, EvidenceType> = {
    fact: "verified_fact",
    verified: "verified_fact",
    recorded: "measured_observation",
    measured: "measured_observation",
    calculated: "measured_observation",
    estimate: "estimate",
    assumption: "assumption",
    hypothesis: "hypothesis",
    missing: "missing_information",
  };
  const claimed = map[cls] ?? "assumption";
  if (origin === "ai" && (claimed === "verified_fact" || claimed === "measured_observation"))
    return {
      type: "assumption",
      independent: false,
      accepted: false,
      role: "supports",
      downgradedFrom: claimed,
    };
  return {
    type: claimed,
    independent: origin !== "ai",
    accepted: origin === "rule",
    role: "supports",
  };
}

/** Experiments carry their own method-based strength; only a controlled result is strong evidence. */
export function experimentQuality(status: string, strength: string | null): Quality {
  if (status !== "completed") return "hypothesis";
  if (strength === "controlled") return "strong";
  if (strength === "correlational") return "limited";
  return "hypothesis";
}

/** Rule findings are deterministic reads of records: their measured inputs count, model outputs are estimates. */
export function fromDrafts(drafts: readonly EvidenceDraft[]): NormalEvidence[] {
  return drafts.map((d) => ({
    type: d.type,
    independent: true,
    accepted: true,
    role: "supports" as const,
  }));
}

/** What a rule finding records as evidence when it is saved as a proposal (origin "rule"). */
export type EvidenceDraft = {
  type: EvidenceType;
  description: string;
  source_kind: SourceKind;
  source_ref: string;
  period_start?: string;
  period_end?: string;
  goal_id?: string;
  /** Interface text for the description (key + values), so it reads and is saved in the reader's language. */
  text?: { key: string; vars: Record<string, string | number> };
};

// ---- improvement proposal gates (mirror of advance_optimization_proposal) ----------------------------------------

export type ProposalLevel = "observation" | "formal" | "execution";
export type Gate =
  | "observation_never_work"
  | "needs_review"
  | "needs_independent_evidence"
  | "needs_record_evidence"
  | "unreviewed_evidence"
  | "needs_admin";
export type ProposalGateInput = {
  level: ProposalLevel;
  status: string;
  reviewed: boolean;
  gapReason: string;
  linked: readonly {
    type: EvidenceType | null;
    origin: EvidenceOrigin;
    status: EvidenceStatus;
    role: "supports" | "contradicts";
    source_ref: string;
  }[];
};
/** Independent = accepted, supporting, not AI, and a fact/measurement or a sourced estimate. */
export function independentCount(linked: ProposalGateInput["linked"]): {
  independent: number;
  recordBacked: number;
} {
  const ok = linked.filter(
    (e) => e.role === "supports" && (e.status === "accepted" || e.status === "used_in_decision"),
  );
  return {
    independent: ok.filter(
      (e) =>
        e.origin !== "ai" &&
        (e.type === "verified_fact" ||
          e.type === "measured_observation" ||
          (e.type === "estimate" && e.source_ref !== "")),
    ).length,
    recordBacked: ok.filter((e) => e.type === "verified_fact" || e.type === "measured_observation")
      .length,
  };
}
/** Everything still standing between an open proposal and an approval, in the order a team resolves it. */
export function approvalGates(p: ProposalGateInput): Gate[] {
  if (p.status !== "proposed") return [];
  if (p.level === "observation") return ["observation_never_work"];
  const g: Gate[] = [];
  const { independent, recordBacked } = independentCount(p.linked);
  if (p.linked.some((e) => e.status === "classified" || e.status === "reviewed"))
    g.push("unreviewed_evidence");
  if (p.level === "formal" && independent === 0 && !p.gapReason.trim())
    g.push("needs_independent_evidence");
  if (p.level === "execution" && recordBacked === 0) g.push("needs_record_evidence");
  if (!p.reviewed) g.push("needs_review");
  return g;
}
/** A formal proposal approved on an explanation instead of evidence stays visibly an unverified hypothesis. */
export function isUnverifiedHypothesis(p: ProposalGateInput): boolean {
  return p.level !== "execution" && independentCount(p.linked).independent === 0;
}

// ---- standard recommendation lifecycle -------------------------------------------------------------------------

export const STAGES = [
  "discovered",
  "analyzed",
  "proposed",
  "reviewed",
  "approved",
  "rejected",
  "converted",
  "measured",
] as const;
export type Stage = (typeof STAGES)[number];
/** Maps a stored improvement proposal (or an unsaved finding) onto the shared lifecycle. */
export function proposalStage(p: { status: string; reviewed_at?: string | null } | null): Stage {
  if (!p) return "analyzed";
  switch (p.status) {
    case "proposed":
      return p.reviewed_at ? "reviewed" : "proposed";
    case "approved":
      return "approved";
    case "rejected":
    case "withdrawn":
      return "rejected";
    case "converted":
      return "converted";
    case "measured":
      return "measured";
    default:
      return "discovered";
  }
}
