// Campaign spend summary (pure) over the insert-only campaign spend ledger (proposal 0077). Amounts stay per
// currency; only EUR is compared with the campaign budget (campaign budgets are stored in EUR), other currencies are
// shown but never converted or compared. Simulated entries are counted but labelled, so nothing simulated reads as real.
import type { CampaignSpendRow } from "@/lib/pending-schema";

export type SpendTotals = { spent: number; committed: number; entries: number; simulated: number };
export type SpendWarning = "budget_near" | "budget_over" | "committed_over" | "spend_without_budget" | "other_currency";
export type SpendSummary = {
  byCurrency: Record<string, SpendTotals>;
  eur: SpendTotals;
  budget: number;
  remaining: number | null;
  /** Spent share of the budget (0–n), null without a budget. */
  usedPct: number | null;
  warnings: SpendWarning[];
};

const cents = (n: number) => Math.round(n * 100) / 100;
export const NEAR_SHARE = 0.8;

export function spendSummary(budgetEur: number, rows: readonly Pick<CampaignSpendRow, "kind" | "amount" | "currency" | "data_class">[]): SpendSummary {
  const byCurrency: Record<string, SpendTotals> = {};
  for (const r of rows) {
    const t = (byCurrency[r.currency] ??= { spent: 0, committed: 0, entries: 0, simulated: 0 });
    const a = Number(r.amount);
    if (r.kind === "spend" || r.kind === "correction") t.spent = cents(t.spent + a);
    else t.committed = cents(t.committed + a);
    t.entries += 1;
    if (r.data_class === "simulated") t.simulated += 1;
  }
  const eur = byCurrency["EUR"] ?? { spent: 0, committed: 0, entries: 0, simulated: 0 };
  const budget = Math.max(0, Number(budgetEur) || 0);
  const w: SpendWarning[] = [];
  let remaining: number | null = null;
  let usedPct: number | null = null;
  if (budget > 0) {
    remaining = cents(budget - eur.spent - eur.committed);
    usedPct = eur.spent / budget;
    if (eur.spent > budget) w.push("budget_over");
    else if (eur.spent + eur.committed > budget) w.push("committed_over");
    else if (eur.spent + eur.committed >= budget * NEAR_SHARE) w.push("budget_near");
  } else if (eur.spent > 0) w.push("spend_without_budget");
  if (Object.keys(byCurrency).some((c) => c !== "EUR")) w.push("other_currency");
  return { byCurrency, eur, budget, remaining, usedPct, warnings: w };
}

/** Remaining amount that can still be corrected (spend) or released (commitment) for one entry. */
export function openAmount(entry: Pick<CampaignSpendRow, "id" | "amount">, rows: readonly Pick<CampaignSpendRow, "relates_to" | "amount">[]): number {
  return cents(Number(entry.amount) + rows.filter((r) => r.relates_to === entry.id).reduce((s, r) => s + Number(r.amount), 0));
}
