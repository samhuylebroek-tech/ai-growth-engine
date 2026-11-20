// Recorded business checks (proposal 0076), pure part. A check snapshots which records were inspected per area
// and which deterministic findings (src/lib/signals.ts) were produced; the database computes what changed since
// the previous check. No AI is called. Frequencies only mark a check as due: nothing runs in the background.
import type { BusinessDomains, DomainRead } from "@/lib/security/business-context";
import type { Signal } from "@/lib/signals";

export type Frequency = "off" | "daily" | "weekly" | "monthly";
export type CheckKind = "manual" | "daily" | "weekly" | "monthly" | "after_campaign" | "after_experiment";
export type Finding = { id: string; code: string; kind: Signal["kind"]; impact: Signal["impact"]; vars: Record<string, string | number> };
/** Count per record type; null means the records could not be read, which is never shown as zero. */
export type Inspected = Record<"financial" | "marketing" | "sales" | "customers" | "operations", Record<string, number | null>>;

const count = <T,>(r: DomainRead<T> | undefined): number | null => (!r ? null : r.status === "ok" ? r.rows.length : null);
const RETENTION = /retent|churn|repeat|terugke|herhaal|returning|fidél|récurr|abonn|subscri/i;

export function inspectedRecords(d: BusinessDomains, now: Date = new Date()): Inspected {
  const today = now.toISOString().slice(0, 10);
  const metrics = d.metrics && d.metrics.status === "ok" ? d.metrics.rows : null;
  const runs = d.taskRuns && d.taskRuns.status === "ok" ? d.taskRuns.rows : null;
  const open = d.tasks.filter((t) => t.status !== "done" && t.status !== "cancelled");
  return {
    financial: { revenue_entries: count(d.revenue), budget_lines: count(d.budget) },
    marketing: { campaigns: count(d.campaigns), metrics: metrics ? metrics.length : null, content: count(d.content) },
    sales: { deals: count(d.deals), opportunities: count(d.opportunities) },
    customers: { retention_metrics: metrics ? metrics.filter((m) => RETENTION.test(m.label)).length : null },
    operations: {
      open_tasks: open.length,
      overdue_tasks: open.filter((t) => t.due_date !== null && t.due_date < today).length,
      blocked_tasks: open.filter((t) => t.status === "blocked").length,
      ai_runs: runs ? runs.length : null,
      experiments: count(d.experiments),
    },
  };
}

/** 32-bit FNV-1a in base 36: a stable, short identity for a signal whose id may contain free text. */
export function stableId(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export function findingsFrom(signals: readonly Signal[]): Finding[] {
  return signals.slice(0, 100).map((s) => ({
    id: `${s.code}:${stableId(s.id)}`,
    code: s.code,
    kind: s.kind,
    impact: s.impact,
    vars: Object.fromEntries(
      Object.entries(s.vars).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 120) : v]),
    ),
  }));
}

const DAY = 86_400_000;
const PERIOD: Record<Exclude<Frequency, "off">, number> = { daily: DAY, weekly: 7 * DAY, monthly: 30 * DAY };

/** Whether a check is due under the chosen frequency (never when off; always when no check exists yet). */
export function checkDue(frequency: Frequency, lastAt: string | null, now: Date = new Date()): { due: boolean; next: string | null } {
  if (frequency === "off") return { due: false, next: null };
  if (!lastAt) return { due: true, next: null };
  const next = new Date(new Date(lastAt).getTime() + PERIOD[frequency]);
  return { due: next.getTime() <= now.getTime(), next: next.toISOString() };
}

/** Which findings of the latest check are new, still open, or were resolved since the previous one. */
export function compareFindings(latest: readonly Finding[], previous: readonly Finding[] | null) {
  const before = new Set((previous ?? []).map((f) => f.id));
  const now = new Set(latest.map((f) => f.id));
  return {
    added: latest.filter((f) => !before.has(f.id)),
    open: latest.filter((f) => before.has(f.id)),
    resolved: (previous ?? []).filter((f) => !now.has(f.id)),
  };
}

export function parseFindings(raw: unknown): Finding[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (f): f is Finding =>
      !!f && typeof f === "object" && typeof (f as Finding).id === "string" && typeof (f as Finding).code === "string",
  ).map((f) => ({ ...f, vars: f.vars && typeof f.vars === "object" ? f.vars : {} }));
}
