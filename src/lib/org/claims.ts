// Organization Growth Officer output in the same six statement kinds as every other AI answer (pure). An AI
// "verified"/"recorded" claim is a fact only when it cites a business record reference (#F-…), which the screen then
// resolves under the viewer's own access; otherwise it is shown as a hypothesis (proposal 0073). Figures the platform
// computed for the organization overview are calculations. Each strategy section has one fixed kind.
import { recordRefs, type ClaimKind } from "@/lib/claims";

export type OrgClaim = { kind: ClaimKind; downgraded: boolean };

export function orgClaim(cls: string, origin: "ai" | "rule", text: string): OrgClaim {
  switch (cls) {
    case "verified":
    case "recorded":
      if (origin === "rule" || recordRefs(text).length > 0) return { kind: "fact", downgraded: false };
      return { kind: "hypothesis", downgraded: true };
    case "calculated": return { kind: "calc", downgraded: false };
    case "estimate": return { kind: "estimate", downgraded: false };
    case "missing": return { kind: "missing", downgraded: false };
    default: return { kind: "hypothesis", downgraded: false };
  }
}

/** Kind of every item in a strategy section: what to do is a recommendation, untested synergies and risks are hypotheses. */
export const SECTION_KIND = {
  priorities: "recommendation",
  collaboration: "hypothesis",
  resources: "recommendation",
  specialists: "recommendation",
  initiatives: "recommendation",
  risks: "hypothesis",
  kpis: "recommendation",
  gaps: "missing",
} as const satisfies Record<string, ClaimKind>;

/** Whether an item concerns one business or the organization as a whole. */
export function claimScope(businessIds: readonly (string | null | undefined)[]): "business" | "organization" {
  return businessIds.filter(Boolean).length === 1 ? "business" : "organization";
}
