// Resolves the record references in an AI statement (`#F-…`, see `recordRef` in business-context.ts) against records
// the viewer read under their own permissions, and says plainly how well the statement is supported (pure). Nothing
// here is a confidence score: support comes only from whether a cited record exists, is confirmed and is unchanged.
import type { ClaimKind, RecordRef, RefType, StatedEvidence } from "@/lib/claims";

export type EvidenceRecord = {
  type: RefType;
  id: string;
  title: string;
  detail?: string;
  /** fact source type (user, website, document, ai_assumption, external) */
  source?: string;
  verified?: boolean;
  /** stored on the record by whoever recorded it; never computed here */
  confidence?: number | null;
  date?: string | null;
  updatedAt?: string | null;
};
export type ResolvedRef = {
  ref: RecordRef;
  status: "found" | "ambiguous" | "not_found";
  record?: EvidenceRecord;
  changedAfter: boolean;
};

const hex = (id: string) =>
  id
    .toLowerCase()
    .replace(/[^0-9a-f]/g, "")
    .slice(0, 8);

export function resolveRefs(
  refs: readonly RecordRef[],
  records: readonly EvidenceRecord[],
  asOf?: string | null,
): ResolvedRef[] {
  return refs.map((ref) => {
    const hits = records.filter((r) => r.type === ref.type && hex(r.id) === ref.short);
    if (hits.length !== 1)
      return { ref, status: hits.length ? "ambiguous" : "not_found", changedAfter: false };
    const record = hits[0]!;
    const changed = !!asOf && !!record.updatedAt && record.updatedAt > asOf;
    return { ref, status: "found", record, changedAfter: changed };
  });
}

export type Support =
  | "linked" // a cited record exists and, for facts, is confirmed
  | "unconfirmed" // the cited fact exists but is not confirmed
  | "inputs_linked" // a calculation names records that exist
  | "stated" // only a source/formula written by the AI, not linked to a record
  | "broken" // references were given but none could be found
  | "none" // no source at all
  | "not_result" // estimate, hypothesis or recommendation: never a verified result
  | "missing"; // the statement itself says information is missing

export function support(
  kind: ClaimKind,
  resolved: readonly ResolvedRef[],
  stated: StatedEvidence,
): Support {
  if (kind === "missing") return "missing";
  const found = resolved.filter((r) => r.status === "found");
  const statedAny = !!(stated.source || stated.formula || stated.basis || stated.period);
  if (kind === "fact") {
    if (found.some((r) => r.record?.type !== "fact" || r.record.verified)) return "linked";
    if (found.length) return "unconfirmed";
    if (resolved.length) return "broken";
    return statedAny ? "stated" : "none";
  }
  if (kind === "calc") {
    if (found.length) return "inputs_linked";
    if (resolved.length) return "broken";
    return statedAny ? "stated" : "none";
  }
  return "not_result";
}
