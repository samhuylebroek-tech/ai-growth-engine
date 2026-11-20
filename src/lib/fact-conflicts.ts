// Conflicting business facts (pure). Two or more facts about the same topic with different values are a conflict.
// The more authoritative value is named only when it is clearly determinable (confirmed beats unconfirmed, then a
// person's or a document's statement beats the website, which beats an AI guess); otherwise the conflict stays open
// for a person to decide. Nothing is chosen silently: resolution goes through resolve_fact_conflict (proposal 0074).

export type FactRow = {
  id: string;
  key: string;
  value: string;
  source_type: string;
  source_ref?: string | null;
  verified: boolean;
  created_at?: string | null;
};
export type FactConflict = {
  topic: string;
  /** Display key of the most recent fact on the topic. */
  key: string;
  facts: FactRow[];
  /** Number of distinct values. */
  values: number;
  /** Two or more different values are confirmed: the Growth Officer currently reads both. */
  confirmedConflict: boolean;
  preferred: string | null;
  basis: "confirmed" | "source" | "undetermined";
};

/** Mirrors public.fact_topic in SQL: case, punctuation and spacing do not make a different topic. */
export const factTopic = (key: string) =>
  key
    // Same rule as SQL fact_topic ([[:punct:]] = ASCII punctuation), so the screen never groups facts the database refuses.
    .replace(/[!-/:-@[-`{-~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** Values that only differ in case, spacing or a currency sign/thousands separator are the same value. */
export function sameValue(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  if (norm(a) === norm(b)) return true;
  const num = (s: string) => {
    const m = s
      .replace(/[€$£\s]|eur|usd|gbp/gi, "")
      .replace(/(\d)[.,](\d{3})(?!\d)/g, "$1$2")
      .replace(",", ".");
    return /^-?\d+(\.\d+)?$/.test(m) ? Number(m) : null;
  };
  const x = num(a),
    y = num(b);
  return x !== null && y !== null && x === y;
}

const SOURCE_RANK: Record<string, number> = {
  user: 3,
  document: 3,
  external: 2,
  website: 2,
  ai_assumption: 0,
};
const rank = (f: FactRow) => (f.verified ? 10 : 0) + (SOURCE_RANK[f.source_type] ?? 1);

/** Discovery stores opportunity suggestions as facts with an "Opportunity:" key; those are not claims to compare. */
const comparable = (f: FactRow) => !/^opportunity\s*:/i.test(f.key.trim());

export function detectFactConflicts(facts: readonly FactRow[]): FactConflict[] {
  const groups = new Map<string, FactRow[]>();
  for (const f of facts) {
    if (!comparable(f)) continue;
    const t = factTopic(f.key);
    if (!t) continue;
    groups.set(t, [...(groups.get(t) ?? []), f]);
  }
  const out: FactConflict[] = [];
  for (const [topic, list] of groups) {
    const distinct: FactRow[] = [];
    for (const f of list) if (!distinct.some((d) => sameValue(d.value, f.value))) distinct.push(f);
    if (distinct.length < 2) continue;
    const confirmedValues: FactRow[] = [];
    for (const f of list.filter((x) => x.verified))
      if (!confirmedValues.some((d) => sameValue(d.value, f.value))) confirmedValues.push(f);
    const sorted = [...list].sort(
      (a, b) => rank(b) - rank(a) || (b.created_at ?? "").localeCompare(a.created_at ?? ""),
    );
    const top = sorted[0]!;
    // the best-ranked value must outrank every fact that states a different value
    const rival = sorted.find((f) => !sameValue(f.value, top.value));
    const clear = rival !== undefined && rank(top) > rank(rival);
    const newest = [...list].sort((a, b) =>
      (b.created_at ?? "").localeCompare(a.created_at ?? ""),
    )[0]!;
    out.push({
      topic,
      key: newest.key,
      facts: sorted,
      values: distinct.length,
      confirmedConflict: confirmedValues.length >= 2,
      preferred: clear ? top.id : null,
      basis: !clear ? "undetermined" : top.verified && !rival!.verified ? "confirmed" : "source",
    });
  }
  return out.sort(
    (a, b) =>
      Number(b.confirmedConflict) - Number(a.confirmedConflict) || a.topic.localeCompare(b.topic),
  );
}

// ---- conflict lifecycle (proposal 0075) --------------------------------------------------------------------------
export type ConflictStatus = "open" | "in_review" | "resolved" | "redisputed";
export type ConflictEvent = {
  id: string;
  topic: string;
  kind: "review_started" | "resolved" | "reopened";
  kept_fact_id: string | null;
  kept_value: string | null;
  note: string;
  actor_id: string;
  created_at: string;
  snapshot?: readonly { id: string; value: string; verified: boolean; source_type: string }[];
};

/**
 * Status from the insert-only history: no decision yet = open; review started = in review; resolved stays resolved
 * only while the kept value is still the confirmed one and no different value was added afterwards or confirmed;
 * otherwise (or after an explicit reopen) it is disputed again. A later decision always supersedes an earlier one.
 */
export function conflictStatus(c: FactConflict, events: readonly ConflictEvent[]) {
  const history = events
    .filter((e) => e.topic === c.topic)
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const latest = history[0] ?? null;
  let status: ConflictStatus = "open";
  if (latest?.kind === "review_started") status = "in_review";
  else if (latest?.kind === "reopened") status = "redisputed";
  else if (latest?.kind === "resolved") {
    const kept = c.facts.find((f) => f.id === latest.kept_fact_id);
    const at = Date.parse(latest.created_at);
    const newer = (f: FactRow) => !!f.created_at && Date.parse(f.created_at) > at;
    const disputed =
      !kept ||
      !kept.verified ||
      c.facts.some((f) => f.id !== kept.id && !sameValue(f.value, kept.value) && (f.verified || newer(f)));
    status = disputed ? "redisputed" : "resolved";
  }
  return { status, latest, history };
}

/** Decisions that rely on a fact in this conflict: improvement proposals whose linked evidence points at one of its facts. */
export function conflictDependents(
  c: FactConflict,
  evidence: readonly { id: string; source_kind: string; source_ref: string }[],
  links: readonly { evidence_id: string; proposal_id: string }[],
  proposals: readonly { id: string; title: string; status: string }[],
) {
  const ids = new Set(c.facts.map((f) => f.id));
  const ev = new Set(evidence.filter((e) => e.source_kind === "business_fact" && ids.has(e.source_ref)).map((e) => e.id));
  const pids = new Set(links.filter((l) => ev.has(l.evidence_id)).map((l) => l.proposal_id));
  return proposals.filter((p) => pids.has(p.id));
}

/** Proposals relying on a fact whose topic has two or more different confirmed values (unresolved by definition). */
export function proposalsOnConfirmedConflicts(
  facts: readonly FactRow[],
  evidence: readonly { id: string; source_kind: string; source_ref: string }[],
  links: readonly { evidence_id: string; proposal_id: string }[],
): Set<string> {
  const ids = new Set(detectFactConflicts(facts).filter((c) => c.confirmedConflict).flatMap((c) => c.facts.map((f) => f.id)));
  const ev = new Set(evidence.filter((e) => e.source_kind === "business_fact" && ids.has(e.source_ref)).map((e) => e.id));
  return new Set(links.filter((l) => ev.has(l.evidence_id)).map((l) => l.proposal_id));
}
