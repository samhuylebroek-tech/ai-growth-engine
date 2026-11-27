// AI cost attribution (pure). Every AI credit enters as one atom (a task run, a retry, a second review) with the time
// it was used, and is valued at the credit price in effect at that moment (credit-pricing.ts). Atoms without an
// applicable price stay unpriced credits; pending charges and unknown outcomes are listed apart and never valued.
// A credit is attributed to the campaign of its task only; parent levels take the atoms of their campaigns once
// (rollup.ts creditAtoms), so a campaign inside an initiative is never added twice.
import { priceAt, type PriceVersion } from "@/lib/econ/credit-pricing";

export type AiAtomKind = "run" | "retry" | "review";
export type AiAtom = {
  credits: number;
  at: string;
  state: "charged" | "pending" | "uncertain";
  kind: AiAtomKind;
  specialist: string;
  taskId: string | null;
  runId: string | null;
};
export type AiCostLine = { key: string; credits: number; amount: number; unpriced: number };
export type AiCostBreakdown = {
  currency: string;
  credits: number;
  amount: number;
  priced: number;
  unpriced: number;
  /** null until every charged credit has an applicable price */
  complete: boolean;
  pendingCredits: number;
  uncertainRuns: number;
  retries: AiCostLine;
  reviews: AiCostLine;
  bySpecialist: AiCostLine[];
  byTask: AiCostLine[];
  byRun: AiCostLine[];
  priceVersions: number;
};

const c2 = (n: number) => Math.round(n * 100) / 100;
const line = (key: string): AiCostLine => ({ key, credits: 0, amount: 0, unpriced: 0 });

/** Values charged AI atoms at their historical price; groups by specialist, task and run. */
export function aiCostBreakdown(
  atoms: readonly AiAtom[],
  prices: readonly PriceVersion[],
  planKey: string | null,
  currency: string,
): AiCostBreakdown {
  const out: AiCostBreakdown = {
    currency,
    credits: 0,
    amount: 0,
    priced: 0,
    unpriced: 0,
    complete: true,
    pendingCredits: 0,
    uncertainRuns: 0,
    retries: line("retry"),
    reviews: line("review"),
    bySpecialist: [],
    byTask: [],
    byRun: [],
    priceVersions: 0,
  };
  const spec = new Map<string, AiCostLine>(),
    task = new Map<string, AiCostLine>(),
    run = new Map<string, AiCostLine>();
  const versions = new Set<string>();
  const bump = (
    m: Map<string, AiCostLine> | AiCostLine,
    key: string | null,
    credits: number,
    amount: number | null,
  ) => {
    const l =
      m instanceof Map
        ? key === null
          ? null
          : (m.get(key) ?? m.set(key, line(key)).get(key)!)
        : m;
    if (!l) return;
    l.credits += credits;
    if (amount === null) l.unpriced += credits;
    else l.amount = c2(l.amount + amount);
  };
  for (const a of atoms) {
    if (a.state === "pending") {
      out.pendingCredits += a.credits;
      continue;
    }
    if (a.state === "uncertain") {
      if (a.kind !== "review") out.uncertainRuns += 1;
      continue;
    }
    if (a.credits <= 0) continue;
    const v = priceAt(prices, planKey, currency, a.at);
    const amount = v ? a.credits * Number(v.price_per_credit) : null;
    if (v) versions.add(`${v.scope}:${v.plan_key ?? ""}:${v.effective_from}`);
    out.credits += a.credits;
    if (amount === null) out.unpriced += a.credits;
    else {
      out.priced += a.credits;
      out.amount += amount;
    }
    bump(spec, a.specialist, a.credits, amount);
    bump(task, a.taskId, a.credits, amount);
    bump(run, a.runId, a.credits, amount);
    if (a.kind === "retry") bump(out.retries, null, a.credits, amount);
    if (a.kind === "review") bump(out.reviews, null, a.credits, amount);
  }
  out.amount = c2(out.amount);
  out.complete = out.unpriced === 0;
  out.priceVersions = versions.size;
  const sort = (m: Map<string, AiCostLine>) =>
    [...m.values()].sort((a, b) => b.credits - a.credits || a.key.localeCompare(b.key));
  out.bySpecialist = sort(spec);
  out.byTask = sort(task);
  out.byRun = sort(run);
  return out;
}

type Run = {
  id: string;
  task_id: string;
  specialist_key: string;
  status: string;
  credits_charged: number | null;
  estimated_credits: number;
  created_at: string;
  finished_at?: string | null;
  attempt?: number | null;
};
type Review = {
  task_run_id: string;
  reviewer_specialist: string;
  credits: number | null;
  created_at?: string | null;
};
const NOCHARGE = ["failed", "cancelled", "rejected"];

/** Atoms of the given tasks' runs and their second reviews; a run with attempt > 1 is a retry. */
export function taskAiAtoms(
  taskIds: ReadonlySet<string>,
  runs: readonly Run[],
  reviews: readonly Review[],
): AiAtom[] {
  const rs = runs.filter((r) => taskIds.has(r.task_id));
  const byId = new Map(rs.map((r) => [r.id, r]));
  const atoms: AiAtom[] = rs.map((r) => ({
    credits: r.credits_charged ?? (NOCHARGE.includes(r.status) ? 0 : r.estimated_credits),
    at: r.finished_at ?? r.created_at,
    state:
      r.credits_charged !== null || NOCHARGE.includes(r.status)
        ? "charged"
        : r.status === "uncertain"
          ? "uncertain"
          : "pending",
    kind: (r.attempt ?? 1) > 1 ? "retry" : "run",
    specialist: r.specialist_key,
    taskId: r.task_id,
    runId: r.id,
  }));
  for (const v of reviews) {
    const r = byId.get(v.task_run_id);
    if (!r) continue;
    atoms.push({
      credits: v.credits ?? 0,
      at: v.created_at ?? r.finished_at ?? r.created_at,
      state: "charged",
      kind: "review",
      specialist: v.reviewer_specialist,
      taskId: r.task_id,
      runId: r.id,
    });
  }
  return atoms;
}
