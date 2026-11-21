// Strategy version comparison (pure; Phase 9). Compares two saved plan versions of one goal: what changed in the
// summary and thesis, which initiatives were added or removed, and how assumptions, risks, KPIs, channels,
// dependencies, evidence, expected outcome and budget changed. It reports only differences between the recorded
// snapshots and the recorded state of the previous version's initiatives; it never claims why results differed.
export type VersionInitiative = { title: string; channel: string; status: string };
export type ComparableVersion = {
  id: string; version: number; status: string; title: string; summary: string; strategic_thesis?: string | null;
  plan_snapshot: unknown; initiatives: readonly VersionInitiative[];
};
export const COMPARED_LISTS = ["assumptions", "risks", "kpis", "channels", "dependencies", "evidence"] as const;
export type ComparedList = (typeof COMPARED_LISTS)[number];
export type ListDiff = { added: string[]; removed: string[]; kept: number };
export type Budget = { amount: number | null; currency: string; basis: string } | null;
export type VersionComparison = {
  from: number; to: number;
  titleChanged: boolean; summaryChanged: boolean; thesisChanged: boolean; outcomeChanged: boolean;
  outcome: { before: string; after: string };
  initiatives: ListDiff;
  lists: Record<ComparedList, ListDiff>;
  budget: { before: Budget; after: Budget; changed: boolean };
  /** Recorded state of the previous version's initiatives (its results so far), by status. */
  previousInitiatives: Record<string, number>;
  unchanged: boolean;
};

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
/** Text of one list item: a string, or the first descriptive field of an object (title, metric, action, name, step). */
export function itemText(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  const o = obj(v);
  for (const k of ["title", "metric", "action", "name", "step", "claim", "source"]) if (typeof o[k] === "string" && (o[k] as string).trim()) return (o[k] as string).trim();
  return "";
}
function diff(before: readonly string[], after: readonly string[]): ListDiff {
  const b = new Map(before.filter(Boolean).map((x) => [norm(x), x]));
  const a = new Map(after.filter(Boolean).map((x) => [norm(x), x]));
  return {
    added: [...a.entries()].filter(([k]) => !b.has(k)).map(([, v]) => v),
    removed: [...b.entries()].filter(([k]) => !a.has(k)).map(([, v]) => v),
    kept: [...a.keys()].filter((k) => b.has(k)).length,
  };
}
const list = (snap: unknown, k: string) => { const v = obj(snap)[k]; return Array.isArray(v) ? v.map(itemText) : []; };
const text = (snap: unknown, k: string) => { const v = obj(snap)[k]; return typeof v === "string" ? v.trim() : ""; };
export function budgetOf(snap: unknown): Budget {
  const b = obj(obj(snap)["budget"]);
  if (!Object.keys(b).length) return null;
  const amount = typeof b["amount"] === "number" ? b["amount"] : b["amount"] === null ? null : Number.isFinite(Number(b["amount"])) && b["amount"] !== undefined && b["amount"] !== "" ? Number(b["amount"]) : null;
  return { amount, currency: typeof b["currency"] === "string" ? b["currency"] : "", basis: typeof b["basis"] === "string" ? b["basis"] : "" };
}

/** Differences from `prev` to `next` (two versions of the same goal). */
export function compareVersions(prev: ComparableVersion, next: ComparableVersion): VersionComparison {
  const lists = Object.fromEntries(COMPARED_LISTS.map((k) => [k, diff(list(prev.plan_snapshot, k), list(next.plan_snapshot, k))])) as Record<ComparedList, ListDiff>;
  const initiatives = diff(prev.initiatives.map((n) => n.title), next.initiatives.map((n) => n.title));
  const before = budgetOf(prev.plan_snapshot), after = budgetOf(next.plan_snapshot);
  const budgetChanged = JSON.stringify(before) !== JSON.stringify(after);
  const outcome = { before: text(prev.plan_snapshot, "outcome"), after: text(next.plan_snapshot, "outcome") };
  const previousInitiatives: Record<string, number> = {};
  for (const n of prev.initiatives) previousInitiatives[n.status] = (previousInitiatives[n.status] ?? 0) + 1;
  const r = {
    from: prev.version, to: next.version,
    titleChanged: norm(prev.title) !== norm(next.title),
    summaryChanged: norm(prev.summary) !== norm(next.summary),
    thesisChanged: norm(prev.strategic_thesis ?? "") !== norm(next.strategic_thesis ?? ""),
    outcomeChanged: norm(outcome.before) !== norm(outcome.after),
    outcome, initiatives, lists, budget: { before, after, changed: budgetChanged }, previousInitiatives,
  };
  const listChanged = [initiatives, ...Object.values(lists)].some((d) => d.added.length || d.removed.length);
  return { ...r, unchanged: !r.titleChanged && !r.summaryChanged && !r.thesisChanged && !r.outcomeChanged && !budgetChanged && !listChanged };
}
