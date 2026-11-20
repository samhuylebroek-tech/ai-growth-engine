// Remembered decisions about next best actions (pure; proposal 0075). A dismissed recommendation stays hidden until
// what it is based on changes (its fingerprint); a postponed one returns after its date or earlier when its
// information changes; "restored" undoes either. The latest decision per recommendation counts; history is kept.

export type RecDecision = {
  item_key: string;
  decision: "postponed" | "dismissed" | "restored";
  until: string | null;
  fingerprint: string;
  created_at: string;
  note?: string;
};
export type Fingerprinted = {
  id: string;
  code: string;
  quality: string;
  vars: Record<string, string | number>;
};

/** Short stable fingerprint of the information behind a recommendation (code, evidence quality and its figures). */
export function fingerprintOf(a: Fingerprinted): string {
  const vars = Object.keys(a.vars)
    .sort()
    .map((k) => `${k}=${a.vars[k]}`)
    .join("&");
  const src = `${a.code}|${a.quality}|${vars}`;
  let h = 5381;
  for (let i = 0; i < src.length; i++) h = ((h << 5) + h + src.charCodeAt(i)) >>> 0;
  return `v1:${h.toString(36)}`;
}

export function latestDecisions(decisions: readonly RecDecision[]): Map<string, RecDecision> {
  const m = new Map<string, RecDecision>();
  for (const d of decisions) {
    const cur = m.get(d.item_key);
    if (!cur || d.created_at > cur.created_at) m.set(d.item_key, d);
  }
  return m;
}

export function isSuppressed(d: RecDecision | undefined, fingerprint: string, now: Date): boolean {
  if (!d || d.decision === "restored" || d.fingerprint !== fingerprint) return false;
  if (d.decision === "dismissed") return true;
  return !!d.until && d.until > now.toISOString().slice(0, 10);
}

export function partitionByDecisions<T extends Fingerprinted>(
  actions: readonly T[],
  decisions: readonly RecDecision[],
  now: Date,
): { visible: T[]; hidden: { action: T; decision: RecDecision }[] } {
  const latest = latestDecisions(decisions);
  const visible: T[] = [];
  const hidden: { action: T; decision: RecDecision }[] = [];
  for (const a of actions) {
    const d = latest.get(a.id);
    if (d && isSuppressed(d, fingerprintOf(a), now)) hidden.push({ action: a, decision: d });
    else visible.push(a);
  }
  return { visible, hidden };
}
