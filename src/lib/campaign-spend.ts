// Campaign spend summary (pure) over the insert-only campaign spend ledger (proposal 0077). This is the single
// classification of campaign money used by every screen, report, signal and AI context:
//   * actual entries (entered by the team) and simulated entries are totalled separately;
//   * spend and corrections are expenditure, commitments are reservations and releases reduce reservations — a
//     reservation never becomes expenditure by itself;
//   * budget warnings come from actual entries only; what simulated entries would add is reported separately as
//     simulated warnings, so a simulated overrun can never read as a real one;
//   * amounts stay per currency; only EUR is compared with the EUR campaign budget, nothing is converted.
// A missing ledger read is the caller's null, never a zero summary.
import type { CampaignSpendRow } from "@/lib/pending-schema";

export type SpendTotals = { spent: number; committed: number; released: number; entries: number };
export type SpendWarning = "budget_near" | "budget_over" | "committed_over" | "spend_without_budget" | "other_currency";
export type SpendSummary = {
  /** Actual (non-simulated) totals per currency. */
  byCurrency: Record<string, SpendTotals>;
  /** Simulated totals per currency, never added to the actual ones. */
  simulatedByCurrency: Record<string, SpendTotals>;
  eur: SpendTotals;
  simulatedEur: SpendTotals;
  /** Number of simulated entries over all currencies. */
  simulatedEntries: number;
  budget: number;
  /** Budget minus actual EUR spending and reservations; null without a budget. */
  remaining: number | null;
  /** Actual spent share of the budget (0–n), null without a budget. */
  usedPct: number | null;
  /** Warnings from actual entries only. */
  warnings: SpendWarning[];
  /** Additional warnings that appear only when simulated entries are counted too; always labelled as simulated. */
  simulatedWarnings: SpendWarning[];
};

type Row = Pick<CampaignSpendRow, "kind" | "amount" | "currency" | "data_class">;
const cents = (n: number) => Math.round(n * 100) / 100;
const zero = (): SpendTotals => ({ spent: 0, committed: 0, released: 0, entries: 0 });
export const NEAR_SHARE = 0.8;
export const isSimulatedSpend = (r: Pick<CampaignSpendRow, "data_class">) => r.data_class === "simulated";
/** Expenditure (spend and its corrections) as opposed to reservations and releases. */
export const isExpenditure = (r: Pick<CampaignSpendRow, "kind">) => r.kind === "spend" || r.kind === "correction";

function totals(rows: readonly Row[]): Record<string, SpendTotals> {
  const out: Record<string, SpendTotals> = {};
  for (const r of rows) {
    const t = (out[r.currency] ??= zero());
    const a = Number(r.amount);
    if (isExpenditure(r)) t.spent = cents(t.spent + a);
    else {
      t.committed = cents(t.committed + a);
      if (r.kind === "release") t.released = cents(t.released - a);
    }
    t.entries += 1;
  }
  return out;
}

function budgetWarnings(budget: number, eur: SpendTotals): SpendWarning[] {
  if (budget > 0) {
    if (eur.spent > budget) return ["budget_over"];
    if (eur.spent + eur.committed > budget) return ["committed_over"];
    if (eur.spent + eur.committed >= budget * NEAR_SHARE) return ["budget_near"];
    return [];
  }
  return eur.spent > 0 ? ["spend_without_budget"] : [];
}

export function spendSummary(budgetEur: number, rows: readonly Row[]): SpendSummary {
  const actualRows = rows.filter((r) => !isSimulatedSpend(r));
  const simRows = rows.filter(isSimulatedSpend);
  const byCurrency = totals(actualRows);
  const simulatedByCurrency = totals(simRows);
  const eur = byCurrency["EUR"] ?? zero();
  const simulatedEur = simulatedByCurrency["EUR"] ?? zero();
  const budget = Math.max(0, Number(budgetEur) || 0);
  const warnings = budgetWarnings(budget, eur);
  const combined = budgetWarnings(budget, { spent: cents(eur.spent + simulatedEur.spent), committed: cents(eur.committed + simulatedEur.committed), released: 0, entries: 0 });
  const simulatedWarnings = simRows.length ? combined.filter((w) => !warnings.includes(w)) : [];
  if (Object.keys(byCurrency).some((c) => c !== "EUR")) warnings.push("other_currency");
  const remaining = budget > 0 ? cents(budget - eur.spent - eur.committed) : null;
  const usedPct = budget > 0 ? eur.spent / budget : null;
  return { byCurrency, simulatedByCurrency, eur, simulatedEur, simulatedEntries: simRows.length, budget, remaining, usedPct, warnings, simulatedWarnings };
}

/** A real (actual) budget overrun: spending or spending plus reservations above the budget. */
export const isRealOverrun = (s: SpendSummary | null | undefined) => !!s && (s.warnings.includes("budget_over") || s.warnings.includes("committed_over"));

/** Remaining amount that can still be corrected (spend) or released (commitment) for one entry. */
export function openAmount(entry: Pick<CampaignSpendRow, "id" | "amount">, rows: readonly Pick<CampaignSpendRow, "relates_to" | "amount">[]): number {
  return cents(Number(entry.amount) + rows.filter((r) => r.relates_to === entry.id).reduce((s, r) => s + Number(r.amount), 0));
}
